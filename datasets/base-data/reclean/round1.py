"""First-round completion of the immutable 0.2.0-rc.1 data asset; no database access."""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import json
from pathlib import Path
import re
import sys
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from reclean import package as pkg
from reclean import normalize as n
from reclean.round1_parser import Parser, amount, text


def read_baseline(path, rules):
    pkg.require(pkg.digest(Path(path).read_bytes()) == rules['baseline_sha256'], 'Baseline archive hash mismatch')
    pkg.verify(path)
    with zipfile.ZipFile(path) as z:
        files = {name: z.read(name) for name in z.namelist()}
    data = {name: json.loads(files['clean/' + name + '.json']) for name in (
        'ingredients', 'recipes', 'kitchenware', 'initial-data', 'nutrition-foods', 'nutrition-observations')}
    return files, data


def candidates(data, rules):
    ingredients, kitchen = deepcopy(data['ingredients']), deepcopy(data['kitchenware'])
    known = {n.key(s) for row in ingredients for s in [row['name'], *row['aliases']]}
    for category, labels in rules['terms'].items():
        for label in labels.split('|'):
            if n.key(label) in known:
                continue
            ingredients.append(dict(id='DDD-I-R1-' + pkg.digest(label.encode())[:16], name=label,
                                    aliases=[], category=category, state='unspecified_by_source', nutrition=None,
                                    nutrition_status='unknown', source_id='howtocook-term:' + label,
                                    source_url=None, source_license='Unlicense', usage=['catalogue_lookup'],
                                    quality=dict(identity='source_culinary_term', nutrition='unknown',
                                                 semantic_review='rule_assisted_source_evidence'), name_evidence=[]))
            known.add(n.key(label))
    for name, aliases in rules['aliases'].items():
        matches = [r for r in ingredients if r['name'] == name]
        project = [r for r in matches if r['id'].startswith('DDD-I-')]
        target = project[0] if len(project) == 1 else matches[0] if len(matches) == 1 else None
        if target:
            target['aliases'] = sorted(set(target['aliases']) | set(aliases))
    known_tools = {n.key(s) for row in kitchen for s in [row['name'], *row['aliases']]}
    for name in rules['equipment_terms'].split('|'):
        if n.key(name) in known_tools:
            continue
        kitchen.append(dict(id='concept-r1-' + pkg.digest(name.encode())[:16], name=name, aliases=[],
                            category='来源明确列出的工具', capacity=None, automatic_substitution_allowed=False,
                            source_url=None, source_release=rules['version'], name_evidence=[],
                            quality=dict(identity='source_equipment_term', capacity='unknown', substitution='not_asserted')))
    return ingredients, kitchen


def all_items(result):
    for item in result['items']:
        yield item
        yield from item.get('ingredient_options', [])


def evidence_registry(data, ingredients, kitchen, rules, base_rules):
    parser = Parser(ingredients, kitchen, rules, base_rules)
    evidence = defaultdict(list)
    for recipe in data['recipes']:
        if recipe['source'] != 'howtocook':
            continue
        for field in ('ingredients', 'required_materials'):
            for index, old in enumerate(recipe[field]):
                raw = old.get('source_text') or old['name']
                result = parser.parse(raw)
                for item in all_items(result):
                    ids = ([item['ingredient_id']] if item['ingredient_id'] else []) + item['candidate_kitchenware_ids']
                    for id_ in ids:
                        evidence[id_].append(dict(recipe_id=recipe['id'], source_url=recipe['source_url'],
                                                 source_sha256=recipe['source_sha256'], source_field=field,
                                                 position=index, source_text=raw))
    for collection, prefix in ((ingredients, 'DDD-I-R1-'), (kitchen, 'concept-r1-')):
        collection[:] = [row for row in collection if not row['id'].startswith(prefix) or evidence[row['id']]]
        for row in collection:
            if row['id'].startswith(prefix):
                row['name_evidence'] = sorted(evidence[row['id']], key=lambda r: (r['recipe_id'], r['source_field'], r['position']))
                row['source_url'] = row['name_evidence'][0]['source_url']
                row['source_record_sha256'] = pkg.digest(pkg.encoded(row))
    return ingredients, kitchen


def line_disposition(result):
    if result['kind'] in ('heading', 'instruction', 'equipment'):
        return result['kind']
    if result['kind'] == 'choice':
        return 'choice_explicit' if result['items'][0]['mapping_status'] == 'explicit_choice' else 'unresolved'
    if result['items'] and all(item['ingredient_id'] for item in result['items']):
        return 'bundle_linked' if result['kind'] == 'bundle' else 'ingredient_linked'
    return 'unresolved'


def update_readiness(recipe):
    blockers = set()
    ingredients = recipe['ingredients']
    for item in ingredients:
        if item.get('ingredient_options'):
            blockers.add('ingredient_choice_required')
        elif not item['ingredient_id']:
            blockers.add('unresolved_ingredient')
        if item['measurement']['kind'] != 'exact' or item['measurement']['approximate']:
            blockers.add('non_exact_amount')
        if item.get('shared_amount_evidence'):
            blockers.add('shared_amount_allocation_required')
        if item.get('qualifiers') or item.get('preparation'):
            blockers.add('preparation_or_qualifier_requires_match')
    if not ingredients:
        blockers.add('no_structured_ingredients')
    if recipe['servings'] is None:
        blockers.add('servings_unknown')
    if recipe['variants']:
        blockers.add('variant_selection_required')
    blockers.add('project_draft_not_kitchen_tested' if recipe['source'] == 'project_draft' else 'source_recipe_review_required')
    if recipe['source'] == 'howtocook':
        blockers.add('batch_scaling_not_verified')
    if recipe.get('source_inconsistencies'):
        blockers.add('source_quantity_inconsistency')
    if any(r['disposition'] == 'unresolved' for r in recipe.get('required_line_reviews', [])):
        blockers.add('required_materials_unresolved')
    recipe['has_structured_amounts'] = bool(ingredients) and all(i['ingredient_id'] and i.get('quantity') is not None for i in ingredients) and not recipe['variants']
    recipe['readiness'] = dict(catalogue_readable=True,
        ingredient_links_complete=bool(ingredients) and all(i['ingredient_id'] for i in ingredients),
        literal_amounts_complete=recipe['has_structured_amounts'], automatic_planning_allowed=False,
        automatic_inventory_write_allowed=False, blockers=sorted(blockers))


def process(data, parser, rules):
    recipes, ledger, issues = [], [], []
    for original in data['recipes']:
        recipe = deepcopy(original)
        recipe['content_sha256'] = None
        recipe['round1_baseline_content_sha256'] = original['content_sha256']
        recipe['round1_source_notes'] = []
        recipe['kitchenware_requirements'] = []
        recipe['required_line_reviews'] = []
        if recipe['source'] == 'project_draft':
            update_readiness(recipe)
            recipe['content_sha256'] = pkg.digest(pkg.encoded({k: v for k, v in recipe.items() if k != 'content_sha256'}))
            recipes.append(recipe)
            continue
        cleaned = []
        for position, prior in enumerate(original['ingredients']):
            raw = prior.get('source_text') or prior['name']
            parsed = parser.parse(raw)
            disposition = line_disposition(parsed)
            review = dict(id=f"{recipe['id']}:prior:{position}", recipe_id=recipe['id'], prior_position=position,
                          source_text=raw, previous_name=prior['name'], previous_ingredient_id=prior['ingredient_id'],
                          disposition=disposition, result_ingredient_ids=sorted({i['ingredient_id'] for i in all_items(parsed) if i['ingredient_id']}))
            if prior['ingredient_id'] is None:
                ledger.append(review)
            if parsed['kind'] in ('heading', 'instruction', 'equipment'):
                recipe['round1_source_notes'].append({**review, 'parsed': parsed})
                if parsed['kind'] == 'equipment':
                    for item in parsed['items']:
                        recipe['kitchenware_requirements'].append(equipment_requirement(item, raw, 'calculation', prior.get('group')))
                continue
            for subindex, item in enumerate(parsed['items']):
                item.update(source_line_id=review['id'], component_index=subindex, original_source_text=raw,
                            source_section=prior.get('source_section'), group=prior.get('group'),
                            section_line=prior.get('section_line'), original_position=position)
                if item['group'] and '可选' in item['group']:
                    item['optional'] = True
                cleaned.append(item)
        recipe['ingredients'] = cleaned
        represented = {i['ingredient_id'] for i in cleaned if i['ingredient_id']}
        represented.update(o['ingredient_id'] for i in cleaned for o in i.get('ingredient_options', []) if o['ingredient_id'])
        required = []
        for position, prior in enumerate(original['required_materials']):
            raw = prior['source_text']
            parsed = parser.parse(raw)
            is_tool_section = bool(prior.get('group') and '工具' in prior['group'] and '原料' not in prior['group'])
            disposition = 'equipment' if is_tool_section and parsed['kind'] not in ('heading', 'instruction') else line_disposition(parsed)
            recipe['required_line_reviews'].append(dict(position=position, source_text=raw, disposition=disposition,
                                                        parsed_kind=parsed['kind']))
            for item in parsed['items']:
                item.update(source_section='required', group=prior.get('group'), section_line=prior.get('section_line'),
                            source_line_id=f"{recipe['id']}:required:{position}",
                            is_equipment=disposition == 'equipment')
                if item['group'] and '可选' in item['group']:
                    item['optional'] = True
                required.append(item)
                if disposition == 'equipment':
                    recipe['kitchenware_requirements'].append(equipment_requirement(item, raw, 'required', prior.get('group')))
                elif item['ingredient_id'] and item['ingredient_id'] not in represented:
                    recipe['ingredients'].append({**deepcopy(item), 'added_from_required_list': True})
                    represented.add(item['ingredient_id'])
        recipe['required_materials'] = required
        # Restore numeric person counts separated by whitespace without interpreting recipe portions as diners.
        compact_serving_context = re.sub(r'人\s+(?=食用|吃)', '人', original.get('source_calculation_text', ''))
        improved_servings = n.serving_evidence(compact_serving_context)
        if recipe['servings'] is None and improved_servings['servings'] is not None:
            recipe['servings'], recipe['serving_evidence'] = improved_servings['servings'], improved_servings
        # Only explicit declarations become requirements. Operation mentions stay evidence-only.
        recipe['kitchenware_ids'] = sorted({id_ for req in recipe['kitchenware_requirements'] if req['role'] == 'required'
                                          for id_ in req['catalogue_ids']})
        for variant in recipe['variants']:
            for item in variant['ingredients']:
                result = parser.single(item['name'])
                item.update({key: result[key] for key in ('ingredient_id', 'candidate_ingredient_ids', 'mapping_status', 'preparation', 'lookup_name')})
                item['measurement'] = amount(item['amount_text'])
        supplement_from_steps(recipe, parser, rules)
        represented = {i['ingredient_id'] for i in recipe['ingredients'] if i['ingredient_id']}
        represented.update(o['ingredient_id'] for i in recipe['ingredients'] for o in i.get('ingredient_options', []) if o['ingredient_id'])
        for item in recipe['ingredients']:
            if not item['ingredient_id'] and not item.get('ingredient_options'):
                issues.append(dict(kind='ingredient_mapping', recipe_id=recipe['id'], source_text=item['source_text'],
                                   name=item['name'], source_line_id=item.get('source_line_id')))
            if item['measurement']['kind'] in ('missing', 'unparsed', 'invalid'):
                issues.append(dict(kind='quantity_requires_source_review', recipe_id=recipe['id'],
                                   source_text=item['source_text'], source_line_id=item.get('source_line_id')))
        for review in recipe['required_line_reviews']:
            if review['disposition'] == 'unresolved':
                issues.append(dict(kind='required_material_unresolved', recipe_id=recipe['id'], **review))
        recipe['step_ingredient_evidence'] = n.step_amounts(recipe['step_details'], parser.index, parser.prepared)
        for entry in recipe['step_ingredient_evidence']:
            if entry['ingredient_id'] and entry['ingredient_id'] not in represented:
                issues.append(dict(kind='step_ingredient_not_in_list', recipe_id=recipe['id'], evidence=entry))
        update_readiness(recipe)
        recipe['content_sha256'] = pkg.digest(pkg.encoded({k: v for k, v in recipe.items() if k != 'content_sha256'}))
        recipes.append(recipe)
    return recipes, ledger, issues


def supplement_from_steps(recipe, parser, rules):
    selected = rules.get('source_supplements', {}).get(recipe['id'])
    if not selected:
        return
    pkg.require(recipe['source_sha256'] == selected['sha256'], 'Supplement source revision differs')
    steps = {s['order']: s['text'] for s in recipe['step_details']}
    for declaration in selected['ingredients']:
        allocations = declaration['allocations']
        for allocation in allocations:
            pkg.require(allocation['fragment'] in steps[allocation['step']], 'Supplement evidence fragment missing')
        values = [amount(a['amount']) for a in allocations]
        pkg.require(len(values) == 1 or (all(v['kind'] == 'exact' for v in values) and len({v['unit'] for v in values}) == 1), 'Ambiguous supplement aggregation')
        measurement = deepcopy(values[0])
        if len(values) > 1:
            measurement['value'] = sum(v['value'] for v in values)
            measurement['source_text'] = ' + '.join(a['amount'] for a in allocations)
        item = parser.single(declaration['name'])
        pkg.require(item['ingredient_id'] is not None, 'Supplement ingredient unresolved')
        matches = [i for i in recipe['ingredients'] if i['ingredient_id'] == item['ingredient_id']]
        pkg.require(len(matches) <= 1, 'Duplicate existing ingredient prevents supplementation')
        if matches:
            item = matches[0]
            pkg.require(item['measurement']['kind'] == 'missing', 'Supplement would overwrite a stated source amount')
        else:
            recipe['ingredients'].append(item)
        item.update(measurement=measurement, amount_text=measurement['source_text'],
                    quantity=measurement['value'] if measurement['kind'] == 'exact' else None,
                    unit=measurement['unit'] if measurement['kind'] == 'exact' else None,
                    optional=declaration.get('optional', item['optional']),
                    amount_provenance=dict(method='explicit_source_stages', allocations=allocations,
                                           source_sha256=selected['sha256'], scope='listed_stage_additions_only'),
                    source_line_id=f"{recipe['id']}:supplement:{declaration['name']}")
    recipe['source_inconsistencies'] = selected.get('inconsistencies', [])
    for conflict in recipe['source_inconsistencies']:
        pkg.require(conflict['fragment'] in steps[conflict['step']], 'Conflict evidence missing')
    for equipment in selected.get('equipment', []):
        pkg.require(equipment['fragment'] in steps[equipment['step']], 'Equipment step evidence missing')
        ids = sorted(parser.kitchen_index[n.key(equipment['name'])])
        pkg.require(len(ids) == 1, 'Ambiguous step equipment')
        recipe['kitchenware_requirements'].append(dict(catalogue_ids=ids, source_text=steps[equipment['step']],
            source_section='operation', step_order=equipment['step'], role='required',
            quantity_evidence=amount(None), constraints_text=[], requirement_status='explicit_step_instruction', substitution_verified=False))
        recipe['kitchenware_ids'] = sorted(set(recipe['kitchenware_ids']) | set(ids))


def equipment_requirement(item, raw, section, group):
    alternative = any(word in text(raw) for word in ('或', '替代', '代替'))
    role = 'alternative_requires_choice' if alternative else 'optional' if item['optional'] or (group and '可选' in group) else 'required'
    return dict(catalogue_ids=item['candidate_kitchenware_ids'], source_text=raw, source_section=section,
                role=role, quantity_evidence=item['measurement'], constraints_text=item['qualifiers'],
                requirement_status='explicit_source_unreviewed', substitution_verified=False)


def validate(data, before, ledger):
    # Optional zero-based ranges are a new explicit type; no scalar compatibility field is emitted.
    pkg.validate(data)
    for name in ('ingredients', 'recipes', 'kitchenware'):
        pkg.require({r['id'] for r in before[name]} <= {r['id'] for r in data[name]}, 'Baseline ID lost: ' + name)
    expected = {(r['id'], pos) for r in before['recipes'] for pos, item in enumerate(r['ingredients']) if item['ingredient_id'] is None}
    actual = {(r['recipe_id'], r['prior_position']) for r in ledger}
    pkg.require(len(ledger) == len(actual) and expected == actual, 'Baseline unresolved ledger is incomplete')
    ingredient_ids = {r['id'] for r in data['ingredients']}
    kitchen_ids = {r['id'] for r in data['kitchenware']}
    for recipe in data['recipes']:
        for req in recipe['kitchenware_requirements']:
            pkg.require(set(req['catalogue_ids']) <= kitchen_ids, 'Orphan explicit equipment')
        for item in recipe['ingredients']:
            if item.get('ingredient_options'):
                pkg.require(item['ingredient_id'] is None and item['quantity'] is None, 'Choice silently selected')
                pkg.require(all(o['ingredient_id'] is None or o['ingredient_id'] in ingredient_ids for o in item['ingredient_options']), 'Orphan choice option')
            if item.get('shared_amount_evidence'):
                pkg.require(item['quantity'] is None and item['measurement']['value'] is None, 'Shared amount assigned to component')
            if item['measurement']['kind'] == 'optional_range':
                pkg.require(item['quantity'] is None and item['measurement']['minimum'] == 0, 'Invalid optional range')
    pkg.require(data['initial-data'] == before['initial-data'], 'Demo data changed')
    pkg.require(data['nutrition-foods'] == before['nutrition-foods'] and data['nutrition-observations'] == before['nutrition-observations'], 'Nutrition changed outside round-one scope')


def build(baseline_path, target_dir):
    target_dir = Path(target_dir)
    pkg.require(not target_dir.exists(), 'Output directory already exists')
    rules = json.loads((HERE / 'round1-rules.json').read_bytes())
    files, before = read_baseline(baseline_path, rules)
    original_files = dict(files)
    base_rules = json.loads(files['rules.json'])
    ingredients, kitchen = candidates(before, rules)
    ingredients, kitchen = evidence_registry(before, ingredients, kitchen, rules, base_rules)
    parser = Parser(ingredients, kitchen, rules, base_rules)
    recipes, ledger, issues = process(before, parser, rules)
    after = {**before, 'ingredients': sorted(ingredients, key=lambda r: r['id']),
             'kitchenware': sorted(kitchen, key=lambda r: r['id']), 'recipes': recipes}
    validate(after, before, ledger)
    stats_before = pkg.stats(before['ingredients'], before['recipes'], before['kitchenware'])
    stats_after = pkg.stats(ingredients, recipes, kitchen)
    outcomes = dict(Counter(r['disposition'] for r in ledger))
    report = dict(version=rules['version'], expansion_round=1, baseline_version=rules['baseline_version'],
                  baseline_sha256=rules['baseline_sha256'], before=stats_before, after=stats_after,
                  original_unresolved_lines=len(ledger), unresolved_line_outcomes=outcomes,
                  ingredient_unresolved_lines=sum(not i['ingredient_id'] and not i.get('ingredient_options') for r in recipes for i in r['ingredients']),
                  ingredient_choice_lines=sum(bool(i.get('ingredient_options')) for r in recipes for i in r['ingredients']),
                  quantity_states=dict(Counter(i['measurement']['kind'] for r in recipes for i in r['ingredients'])),
                  recipes_with_explicit_equipment=sum(bool(r['kitchenware_requirements']) for r in recipes),
                  source_supplemented_ingredient_lines=sum(bool(i.get('amount_provenance')) for r in recipes for i in r['ingredients']),
                  source_inconsistencies=sum(len(r.get('source_inconsistencies', [])) for r in recipes),
                  issue_counts=dict(Counter(i['kind'] for i in issues)),
                  automatic_execution_recipes=0, runtime_import_applied=False,
                  source_documents_added=0, human_or_kitchen_review_performed=False)
    # Preserve the immediately previous clean tables as evidence; the outer baseline ZIP is separately pinned.
    for name in ('ingredients', 'recipes', 'kitchenware', 'initial-data', 'nutrition-foods', 'nutrition-observations'):
        files['upstream/rc1/clean/' + name + '.json'] = original_files['clean/' + name + '.json']
        files['clean/' + name + '.json'] = pkg.encoded(after[name])
    for name in ('quality/report.json', 'quality/REPORT.md', 'manifest.json'):
        files['upstream/rc1/' + name] = original_files[name]
    for name in list(files):
        if name.startswith('review/') or name == 'CATALOGUE.md':
            files['upstream/rc1/' + name] = files.pop(name)
    indexes, collisions = {}, []
    for name in ('ingredients', 'kitchenware'):
        indexes[name] = [dict(term=term, ids=sorted(ids), ambiguous=len(ids)>1) for term, ids in sorted(n.make_index(after[name]).items())]
        collisions += [dict(collection=name, **row) for row in indexes[name] if row['ambiguous']]
    files['clean/search-index.json'] = pkg.encoded(indexes)
    files['review/round1-original-unresolved-ledger.json'] = pkg.encoded(ledger)
    files['review/round1-issues.jsonl'] = pkg.jsonl(issues)
    files['review/collisions.json'] = pkg.encoded(collisions)
    files['quality/report.json'] = pkg.encoded(report)
    files['quality/REPORT.md'] = render_report(report)
    files['CATALOGUE.md'] = pkg.render_catalogue(recipes)
    files['round1-rules.json'] = pkg.encoded(rules)
    files['README.md'] = (HERE / 'ROUND1.md').read_bytes().replace(b'\r\n', b'\n')
    for filename in ('round1.py', 'round1_parser.py', 'round1-rules.json', 'ROUND1.md'):
        files['build/reclean/' + filename] = (HERE / filename).read_bytes().replace(b'\r\n', b'\n')
    files['build/test_round1.py'] = (HERE.parent / 'test_round1.py').read_bytes().replace(b'\r\n', b'\n')
    files.pop('manifest.json')
    files['manifest.json'] = pkg.encoded(dict(package='dietdigidose-base-data', version=rules['version'],
        schema_version=2, expansion_round=1, status='cleaned_candidate', runtime_import_allowed=False,
        baseline_sha256=rules['baseline_sha256'],
        files=[dict(path=name, bytes=len(raw), sha256=pkg.digest(raw)) for name, raw in sorted(files.items())]))
    target_dir.mkdir(parents=True)
    target = target_dir / ('dietdigidose-base-data-' + rules['version'] + '.zip')
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_STORED) as z:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 15, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, raw)
    for name, raw in files.items():
        if not name.startswith(('upstream/', 'provenance/', 'build/')):
            out = target_dir / name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(raw)
    (target_dir / (target.name + '.sha256')).write_text(pkg.digest(target.read_bytes()) + '  ' + target.name + '\n', encoding='utf-8')
    verify(target)
    return target, report


def verify(path):
    pkg.verify(path)
    with zipfile.ZipFile(path) as z:
        after = {name: json.loads(z.read('clean/' + name + '.json')) for name in (
            'ingredients', 'recipes', 'kitchenware', 'initial-data', 'nutrition-foods', 'nutrition-observations')}
        before = {name: json.loads(z.read('upstream/rc1/clean/' + name + '.json')) for name in after}
        ledger = json.loads(z.read('review/round1-original-unresolved-ledger.json'))
        validate(after, before, ledger)
        report = json.loads(z.read('quality/report.json'))
        pkg.require(report['unresolved_line_outcomes'] == dict(Counter(r['disposition'] for r in ledger)), 'Ledger report mismatch')
    return dict(valid=True, sha256=pkg.digest(Path(path).read_bytes()))


def render_report(report):
    labels = {'ingredients':'食材目录记录', 'kitchenware':'厨具目录记录', 'recipes':'菜谱记录',
              'ingredient_lines':'用料行', 'linked_ingredient_lines':'单一食材关联行', 'exact_metric_lines':'明确公制数量行'}
    lines = ['# 第一轮补齐报告 · ' + report['version'], '', '本轮只处理原数据中的缺项，没有增加外部菜谱来源或修改数据库。', '',
             '| 指标 | rc.1 | 第一轮 rc.2 |', '|---|---:|---:|']
    lines += [f"| {label} | {report['before'][key]} | {report['after'][key]} |" for key, label in labels.items()]
    lines += ['', '## 原 712 条未匹配用料的去向', '', '| 处理结果 | 原始行数 |', '|---|---:|']
    names = {'ingredient_linked':'补齐单一食材关联','bundle_linked':'拆分多种材料并关联','choice_explicit':'明确二选一材料','heading':'识别为分组标题','instruction':'识别为说明文字','equipment':'识别为厨具','unresolved':'仍需复核'}
    lines += [f'| {names.get(key,key)} | {count} |' for key,count in report['unresolved_line_outcomes'].items()]
    lines += ['', '每条原始记录均能在 review/round1-original-unresolved-ledger.json 追踪；没有靠删除难匹配用料提高匹配率。',
              '用料行总数因复合材料拆分、标题/工具移出和补回原料表遗漏而改变。二选一不算作已选定单一食材。', '',
              '## 补齐内容', '',
              '1. 名称与状态分开：保留切丝、熟制、冷冻、带皮等限定，不混同为完全相同的库存物料。',
              '2. 数量提取保留主数量及括号中的参考重量；不把“2 个（约 100g）”变成确定的 100g。',
              '3. 中文计数、前置数量、杯量和可选零下限范围有独立结构；共享总量不分配到每种材料。',
              '4. 明确列出的厨具记录必需、可选与替代待选；步骤中的提及仍只作为原文证据。',
              '5. 原有目录 ID、营养数据和初始化记录全部保留。', '',
              '## 尚未解决', '',
              f"当前未解析到食材的行：{report['ingredient_unresolved_lines']}；明确待选材料行：{report['ingredient_choice_lines']}。",
              f"数量状态：`{json.dumps(report['quantity_states'],ensure_ascii=False)}`。",
              '原文未给出的重量、物种、份数和容量保持未知；来源食材名称不代表通过食用安全或厨房实测。',
              '营养映射与完整实做审核留待后续轮次；本包仍不启用自动执行或库存扣减。',
              'schema_version=2；原 rc.7 导入器不能直接导入本包。', '']
    return ('\n'.join(lines)+'\n').encode('utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify(args.verify)))
    else:
        if not args.baseline or not args.output:
            parser.error('--baseline and --output required')
        target, report = build(args.baseline, args.output)
        print(json.dumps(dict(path=str(target), **report), ensure_ascii=False))
