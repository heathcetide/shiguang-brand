"""Rebuild a versioned data asset from locked archives; never opens an app database."""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import quote
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import audit
from reclean import normalize as n


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n').encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def jsonl(rows):
    return b''.join((json.dumps(r, ensure_ascii=False, sort_keys=True, allow_nan=False) + '\n').encode('utf-8') for r in rows)


def require(ok, message):
    if not ok:
        raise ValueError(message)


def load_jsonl(data):
    return [json.loads(line) for line in data.splitlines() if line.strip()]


def source_documents(archive_path, lock):
    source = next(s for s in lock['sources'] if s['id'] == 'howtocook')
    raw_archive = Path(archive_path).read_bytes()
    require(digest(raw_archive) == source['sha256'], 'HowToCook archive checksum mismatch')
    root = 'HowToCook-' + source['revision'] + '/'
    documents, files, decisions = [], {}, []
    with zipfile.ZipFile(io.BytesIO(raw_archive)) as z:
        require(len(z.namelist()) == len(set(z.namelist())), 'Duplicate source member')
        for member in sorted(z.namelist()):
            if not member.startswith(root + 'dishes/') or not member.endswith('.md'):
                continue
            path = member[len(root):]
            group = path.split('/')[1]
            raw = z.read(member)
            text = raw.decode('utf-8-sig').replace('\r\n', '\n')
            recipe_id = 'HTC-' + digest(path.encode('utf-8'))[:20]
            title_match = re.search(r'^#\s+(.+)', text, re.M)
            title = n.plain(title_match[1]).removesuffix('的做法') if title_match else ''
            sections = {key: n.section(text, heading) for key, heading in (
                ('required', '必备原料和工具'), ('calculation', '计算'), ('operation', '操作'), ('notes', '附加内容'))}
            status = 'template_excluded' if group == 'template' else 'included' if title and sections['operation'] and sections['required'] else 'incomplete'
            decisions.append(dict(id=recipe_id, source_path=path, disposition=status, source_sha256=digest(raw)))
            files['provenance/howtocook/' + recipe_id + '.md'] = raw
            if status != 'included':
                continue
            documents.append(dict(id=recipe_id, title=title, category=group, sections=sections,
                                  source_url='https://github.com/Anduin2017/HowToCook/blob/' + source['revision'] + '/' + quote(path, safe='/'),
                                  source_path=path, source_sha256=digest(raw), source_revision=source['revision'],
                                  source_license=source['declared_license']))
        files['provenance/howtocook/LICENSE'] = z.read(root + 'LICENSE')
    require(len(decisions) == 370, 'Unexpected locked recipe document count')
    return documents, files, decisions


def catalogue(old, documents, rules):
    rows = deepcopy(old)
    for row in rows:
        replacement = rules['name_normalizations'].get(row['name'])
        if replacement:
            row['source_name'] = row['name']
            row['aliases'] = sorted(set(row['aliases']) | {row['name']})
            row['name'] = replacement
            row['name_normalization_method'] = 'explicit_script_variant_rule'
        correction = rules['category_corrections'].get(row['name'])
        if correction:
            row['category_correction'] = dict(before=row['category'], **correction)
            row['category'] = correction['category']
    evidence = defaultdict(list)
    for document in documents:
        for section in ('calculation', 'required'):
            for line in n.bullets(document['sections'][section]):
                name, _ = n.split_item(line['source_text'])
                evidence[n.key(name)].append(dict(recipe_id=document['id'], source_url=document['source_url'],
                                                  section=section, source_text=line['source_text']))
        for variant in n.table_variants(document['sections']['calculation']):
            for item in variant['ingredients']:
                evidence[n.key(item['name'])].append(dict(recipe_id=document['id'], source_url=document['source_url'],
                                                         section='calculation_table', source_text=item['source_text']))
    existing_names = {n.key(r['name']) for r in rows}
    additions = []
    for category, labels in rules['new_catalogue_terms'].items():
        for name in labels.split('|'):
            if n.key(name) in existing_names:
                continue
            forms = [name, *rules['ingredient_aliases'].get(name, [])]
            refs = [e for form in forms for e in evidence.get(n.key(form), [])]
            if not refs:
                continue
            row = dict(id='DDD-I-SRC-' + digest(name.encode())[:16], name=name, aliases=[], category=category,
                       state='unspecified_by_source', nutrition=None, nutrition_status='unknown',
                       source_id='howtocook-term:' + name, source_url=refs[0]['source_url'],
                       source_license='Unlicense', usage=['catalogue_lookup'], name_evidence=refs)
            rows.append(row)
            additions.append(row['id'])
            existing_names.add(n.key(name))
    alias_decisions = []
    for row in rows:
        row['name'] = n.norm(row['name'])
        row['aliases'] = sorted({n.norm(a) for a in row['aliases'] if n.key(a) != n.key(row['name'])})
        row['quality'] = dict(identity='catalogue_term', nutrition='unknown', culinary_state=row['state'],
                              semantic_review='rules_assisted_not_human_certified')
        row['source_record_sha256'] = digest(encoded(next((x for x in old if x['id'] == row['id']), row)))
    by_name = defaultdict(list)
    for row in rows:
        by_name[row['name']].append(row)
    for name, aliases in rules['ingredient_aliases'].items():
        candidates = by_name.get(name, [])
        project = [x for x in candidates if x['id'].startswith('DDD-I-')]
        target = project[0] if len(project) == 1 else candidates[0] if len(candidates) == 1 else None
        for alias in aliases:
            if target:
                target['aliases'] = sorted(set(target['aliases']) | {alias})
            alias_decisions.append(dict(name=name, alias=alias, target_id=target['id'] if target else None,
                                        disposition='explicit_rule' if target else 'target_ambiguous_or_missing'))
    return sorted(rows, key=lambda r: r['id']), additions, alias_decisions


def clean_kitchen(old):
    rows = deepcopy(old)
    for row in rows:
        row['name'] = n.norm(row['name'])
        row['aliases'] = sorted({n.norm(a) for a in row['aliases'] if n.key(a) != n.key(row['name'])})
        row.update(capacity=None, automatic_substitution_allowed=False,
                   quality=dict(identity='source_concept', capacity='unknown', substitution='not_asserted'),
                   source_record_sha256=digest(encoded(next(x for x in old if x['id'] == row['id']))))
    return sorted(rows, key=lambda r: r['id'])


def recipe_item(raw, index, rules, section, line=None):
    name, amount = n.split_item(raw)
    measure = n.measurement(amount)
    mapping = n.resolve(name, index, rules['prepared_terms'])
    qualifier = None
    annotated = re.fullmatch(r'([^()]+)\(([^()]*)\)', name)
    if not mapping['ingredient_id'] and annotated and re.search(r'可选|推荐|选用|用于', annotated[2]):
        qualifier = annotated[2]
        mapping = n.resolve(annotated[1].strip(), index, rules['prepared_terms'])
        if mapping['ingredient_id']:
            mapping['mapping_status'] = 'exact_term_with_preserved_qualifier'
    # Compatibility fields represent only exact metric values for the stated source batch.
    literal = measure['kind'] == 'exact' and measure['dimension'] in ('mass', 'volume') and not measure['approximate']
    return dict(name=name, source_text=raw, source_section=section, section_line=line,
                amount_text=amount, measurement=measure, quantity=measure['value'] if literal else None,
                unit=measure['unit'] if literal else None, optional=bool(re.search('可选|按需|不放也', raw)),
                name_qualifier=qualifier, **mapping)


def clean_recipes(documents, old_recipes, ingredients, kitchen, rules):
    index = n.make_index(ingredients)
    kitchen_index = n.make_index(kitchen)
    rows, issues = [], []
    for old in old_recipes:
        if old['source'] != 'project_draft':
            continue
        row = deepcopy(old)
        for item in row['ingredients']:
            item.update(measurement=n.measurement(item['amount_text']), mapping_status='preserved_project_reference',
                        candidate_ingredient_ids=[item['ingredient_id']], source_section='project_draft')
        row.update(category='project_draft', step_details=[dict(order=i+1, text=s, section=None) for i, s in enumerate(row['steps'])],
                   variants=[], required_materials=[], kitchenware_mentions=[], step_ingredient_evidence=[],
                   serving_evidence=dict(servings=row['servings'], status='project_declared', evidence=[], scale_automatically=False),
                   source_record_sha256=digest(encoded(old)))
        rows.append(row)
    for document in documents:
        sections = document['sections']
        source_lines = n.bullets(sections['calculation'])
        variants = n.table_variants(sections['calculation'])
        source_section = 'calculation'
        if not source_lines:
            source_lines = n.bullets(sections['required'])
            source_section = 'required'
        items, equipment_lines, calculation_notes = [], [], []
        for line in source_lines:
            item = recipe_item(line['source_text'], index, rules, source_section, line['section_line'])
            item['group'] = line['group']
            tool_ids = sorted(kitchen_index.get(n.key(item['name']), set()))
            if (line['group'] and '工具' in line['group']) or (tool_ids and not item['candidate_ingredient_ids']):
                equipment_lines.append(dict(source_text=item['source_text'], candidate_kitchenware_ids=tool_ids,
                                            source_section=source_section, role='source_listed_unreviewed'))
            elif re.match(r'^(?:一般|每次|每人|每份|根据|\d+\s*人)', item['source_text']) and not item['candidate_ingredient_ids']:
                calculation_notes.append(item)
            elif item['name']:
                items.append(item)
        required = []
        for line in n.bullets(sections['required']):
            item = recipe_item(line['source_text'], index, rules, 'required', line['section_line'])
            ids = sorted(kitchen_index.get(n.key(item['name']), set()))
            is_tool = bool((line['group'] and '工具' in line['group']) or (ids and not item['candidate_ingredient_ids']))
            required.append(dict(**item, candidate_kitchenware_ids=ids, group=line['group'], is_equipment=is_tool))
        represented = {item['ingredient_id'] for item in items if item['ingredient_id']}
        if source_section == 'calculation':
            for material in required:
                if material['ingredient_id'] and material['ingredient_id'] not in represented:
                    # Material list omissions must appear as missing amounts, not disappear.
                    items.append({**material, 'added_from_required_list': True})
                    represented.add(material['ingredient_id'])
        for variant in variants:
            for item in variant['ingredients']:
                item.update(n.resolve(item['name'], index, rules['prepared_terms']))
        step_details = n.parse_steps(sections['operation'])
        step_evidence = n.step_amounts(step_details, index, rules['prepared_terms'])
        mentions = list(equipment_lines)
        # Mentions are evidence, NOT inferred required equipment. Keep negations and alternatives.
        for section in ('required', 'operation'):
            for line in sections[section].splitlines():
                normalized_line = n.key(n.plain(line))
                hits = {i for term, ids in kitchen_index.items() if len(term) >= 2 and term in normalized_line for i in ids}
                if hits:
                    mentions.append(dict(source_text=line, source_section=section, candidate_kitchenware_ids=sorted(hits),
                                         role='mention_only', may_be_alternative_or_negated=True))
        servings = n.serving_evidence(sections['calculation'])
        # The counts of diners and the batch size of expressions are separate.
        row = {key: value for key, value in document.items() if key != 'sections'}
        row.update(source='howtocook', ingredients=items, steps=[n.plain(s['text']) for s in step_details],
                   step_details=step_details, variants=variants, required_materials=required, calculation_notes=calculation_notes,
                   step_ingredient_evidence=step_evidence,
                   kitchenware_ids=[], kitchenware_mentions=mentions, servings=servings['servings'],
                   serving_evidence=servings, estimated_minutes=None, water_ml=None, declared_allergens=None,
                   nutrition=None, can_display=True, cooking_review_status='source_content_needs_review',
                   automatic_inventory_write_allowed=False,
                   source_operation_text=sections['operation'], source_calculation_text=sections['calculation'],
                   source_required_materials_text=sections['required'], source_notes=sections['notes'])
        rows.append(row)
    for row in rows:
        blockers = []
        repeated = Counter(i['ingredient_id'] for i in row['ingredients'] if i['ingredient_id'])
        for evidence in row['step_ingredient_evidence']:
            if evidence['ingredient_id'] and evidence['ingredient_id'] not in repeated:
                issues.append(dict(kind='step_ingredient_not_in_list', recipe_id=row['id'], evidence=evidence))
                blockers.append('step_ingredients_require_review')
        for ingredient_id, count in repeated.items():
            if count > 1:
                issues.append(dict(kind='repeated_recipe_ingredient', recipe_id=row['id'], ingredient_id=ingredient_id, occurrences=count,
                                   reason='may_be_stage_allocations_or_duplicate_totals_do_not_sum_automatically'))
                blockers.append('repeated_ingredient_allocation_review')
        for material in row['required_materials']:
            if not material['ingredient_id'] and not material['is_equipment']:
                issues.append(dict(kind='required_material_unresolved', recipe_id=row['id'], source_text=material['source_text']))
                blockers.append('required_materials_unresolved')
        for position, item in enumerate(row['ingredients']):
            if not item['ingredient_id']:
                issues.append(dict(kind='ingredient_mapping', recipe_id=row['id'], position=position,
                                   source_text=item.get('source_text', item['name']), name=item['name'],
                                   candidates=item.get('candidate_ingredient_ids', [])))
                blockers.append('unresolved_ingredient')
            if item['measurement']['kind'] != 'exact' or item['measurement']['approximate']:
                issues.append(dict(kind='ingredient_amount', recipe_id=row['id'], position=position,
                                   source_text=item.get('source_text', item['name']), status=item['measurement']['kind']))
                blockers.append('non_exact_amount')
        if not row['ingredients']:
            blockers.append('no_structured_ingredients')
        if row['servings'] is None:
            blockers.append('servings_unknown')
        if row['variants']:
            blockers.append('variant_selection_required')
        if row['source'] == 'howtocook':
            blockers.extend(['source_recipe_review_required', 'batch_scaling_not_verified', 'equipment_requirements_not_verified'])
        else:
            blockers.append('project_draft_not_kitchen_tested')
        row['has_structured_amounts'] = bool(row['ingredients']) and all(
            i['ingredient_id'] and i.get('quantity') is not None for i in row['ingredients']) and not row['variants']
        row['readiness'] = dict(catalogue_readable=True, ingredient_links_complete=bool(row['ingredients']) and all(i['ingredient_id'] for i in row['ingredients']),
                                literal_amounts_complete=row['has_structured_amounts'],
                                automatic_planning_allowed=False, automatic_inventory_write_allowed=False,
                                blockers=sorted(set(blockers)))
        row['content_sha256'] = digest(encoded(row))
    return sorted(rows, key=lambda r: r['id']), issues


def typed_nutrition(upstream):
    units = {'G': 'g', 'MG': 'mg', 'ΜG': 'µg', 'KCAL': 'kcal', 'KJ': 'kJ', 'IU': 'IU', 'SP GR': 'specific_gravity'}
    observations, issues = [], []
    raw_rows = load_jsonl(upstream['reference/usda_nutrients_long.jsonl'])
    seen = Counter((r['fdc_id'], r['nutrient_id']) for r in raw_rows)
    for ordinal, row in enumerate(raw_rows, 1):
        raw = row['amount']
        amount, status = None, 'missing'
        if raw.strip():
            try:
                number = Decimal(raw)
                if not number.is_finite():
                    status = 'invalid'
                elif number < 0:
                    status = 'negative_source_value'
                else:
                    amount, status = float(number), 'reported'
            except InvalidOperation:
                status = 'invalid'
        record = dict(id=f'USDA-OBS-{ordinal:05}', fdc_id=row['fdc_id'], nutrient_id=row['nutrient_id'],
                      nutrient_name=row['nutrient_name_en'], amount=amount, unit=units.get(row['unit']),
                      raw_amount=raw, raw_unit=row['unit'], status=status, source_license=row['source_license'],
                      measurement_basis='not_encoded_in_source_row', duplicate_key=seen[row['fdc_id'], row['nutrient_id']] > 1)
        if status not in ('reported', 'missing') or not record['unit'] or record['duplicate_key']:
            issues.append(dict(kind='nutrition_observation', observation=record))
        observations.append(record)
    by_food = defaultdict(list)
    for observation in observations:
        by_food[observation['fdc_id']].append(observation['id'])
    foods = []
    for raw in load_jsonl(upstream['reference/usda_foundation_foods.jsonl']):
        food = dict(id='USDA-FDC-' + raw['fdc_id'], fdc_id=raw['fdc_id'], name_en=raw['description_en'],
                    category_en=raw['food_category_en'], source_url=raw['source_url'], source_license=raw['source_license'],
                    source_publication_date=datetime.strptime(raw['publication_date'], '%m/%d/%Y').date().isoformat(),
                    observation_ids=by_food[raw['fdc_id']], chinese_ingredient_id=None, mapping_status='unmapped',
                    source_record_sha256=digest(encoded(raw)))
        foods.append(food)
    return sorted(foods, key=lambda r: r['fdc_id']), observations, issues


def stats(ingredients, recipes, kitchen):
    items = [i for r in recipes for i in r['ingredients']]
    htc = [i for r in recipes if r['source'] == 'howtocook' for i in r['ingredients']]
    return dict(ingredients=len(ingredients), recipes=len(recipes), source_recipes=sum(r['source'] == 'howtocook' for r in recipes),
                kitchenware=len(kitchen), ingredient_lines=len(items), linked_ingredient_lines=sum(bool(i['ingredient_id']) for i in items),
                htc_ingredient_lines=len(htc), htc_linked_lines=sum(bool(i['ingredient_id']) for i in htc),
                exact_metric_lines=sum(i.get('quantity') is not None for i in items),
                recipes_with_explicit_servings=sum(r.get('servings') is not None for r in recipes),
                recipes_with_equipment_evidence=sum(bool(r.get('kitchenware_mentions') or r['kitchenware_ids']) for r in recipes))


def validate(data):
    def ids(rows):
        keys = {r['id'] for r in rows}
        require(len(keys) == len(rows) and all(keys), 'Duplicate or empty ID')
        return keys
    ingredient_ids, recipe_ids, kitchen_ids = (ids(data[name]) for name in ('ingredients', 'recipes', 'kitchenware'))
    for row in data['ingredients']:
        require(row['nutrition'] is None and row['nutrition_status'] == 'unknown', 'Unverified ingredient nutrition')
        require(row['name'] == n.norm(row['name']) and row['name'], 'Invalid canonical name')
        require(len(row['aliases']) == len(set(row['aliases'])), 'Duplicate alias')
    for row in data['recipes']:
        require(row['automatic_inventory_write_allowed'] is False and row['readiness']['automatic_planning_allowed'] is False, 'Unreviewed execution enabled')
        require(row['title'] and row['steps'], 'Recipe title/steps missing')
        require(row['nutrition'] is None, 'Inferred recipe nutrition')
        require(set(row['kitchenware_ids']) <= kitchen_ids, 'Orphan equipment')
        for mention in row['kitchenware_mentions']:
            require(set(mention['candidate_kitchenware_ids']) <= kitchen_ids, 'Orphan equipment mention')
        for item in row['ingredients'] + row['step_ingredient_evidence'] + [i for v in row['variants'] for i in v['ingredients']]:
            require(item['ingredient_id'] is None or item['ingredient_id'] in ingredient_ids, 'Orphan ingredient')
            require(set(item.get('candidate_ingredient_ids', [])) <= ingredient_ids, 'Orphan mapping candidate')
            m = item['measurement']
            if m['kind'] == 'exact':
                require(isinstance(m['value'], (int, float)) and m['value'] > 0 and m['unit'], 'Invalid exact measurement')
            if m['kind'] == 'range':
                require(m['value'] is None and 0 < m['minimum'] <= m['maximum'] and m['unit'], 'Invalid range')
            if item.get('quantity') is not None:
                require(m['kind'] == 'exact' and not m['approximate'] and m['dimension'] in ('mass', 'volume') and item['quantity'] == m['value'], 'Unsafe scalar quantity')
        expected = digest(encoded({k: v for k, v in row.items() if k != 'content_sha256'}))
        require(row['content_sha256'] == expected, 'Recipe content hash mismatch')
    initial = data['initial-data']
    account_ids, post_ids = ids(initial['accounts']), ids(initial['posts'])
    for row in initial['accounts']:
        require(not {'password', 'password_hash', 'token'} & row.keys(), 'Account secret packaged')
        require(row['password_env'] and row['must_change_password'], 'Missing account credential policy')
        require(not row['is_demo'] or row['role'] == 'user', 'Demo privilege escalation')
    for row in initial['posts']:
        require(row['author_id'] in account_ids and row['recipe_id'] in recipe_ids and row['is_demo'], 'Orphan demo post')
    for row in initial['comments']:
        require(row['author_id'] in account_ids and row['post_id'] in post_ids, 'Orphan demo comment')
    for row in initial['inventory']:
        require(row['owner_id'] in account_ids and row['ingredient_id'] in ingredient_ids, 'Orphan demo inventory')
    for row in initial['favorites']:
        require(row['owner_id'] in account_ids and row['recipe_id'] in recipe_ids, 'Orphan favorite')
    for name in ('comments', 'inventory', 'favorites'):
        ids(initial[name])
    observations = data['nutrition-observations']
    observation_ids = ids(observations)
    fdc_ids = {r['fdc_id'] for r in data['nutrition-foods']}
    require(len(fdc_ids) == 363 and len(observations) == 15193, 'Nutrition source coverage changed')
    for observation in observations:
        require(observation['fdc_id'] in fdc_ids, 'Orphan nutrient food')
        if observation['status'] == 'reported':
            require(observation['amount'] is not None and observation['amount'] >= 0, 'Invalid nutrient amount')
        else:
            require(observation['amount'] is None, 'Invalid observation entered usable amount')
    for food in data['nutrition-foods']:
        require(food['chinese_ingredient_id'] is None, 'Unverified USDA mapping')
        require(set(food['observation_ids']) <= observation_ids, 'Orphan observation reference')


def build(rc7_path, howtocook_path, target_dir):
    target_dir = Path(target_dir)
    require(not target_dir.exists(), 'Output directory already exists; choose a new directory')
    # Git may check JSON out as CRLF on Windows. The archive pins canonical LF bytes.
    lock_raw = (HERE.parent / 'sources.lock.json').read_bytes().replace(b'\r\n', b'\n')
    lock = json.loads(lock_raw)
    archive_lock = json.loads((HERE.parent / 'archive.lock.json').read_bytes())
    upstream = audit.verified_files(rc7_path, archive_lock, lock_raw)
    rules = json.loads((HERE / 'rules.json').read_bytes())
    documents, files, decisions = source_documents(howtocook_path, lock)
    old = {name: json.loads(upstream['clean/' + name + '.json']) for name in ('ingredients', 'recipes', 'kitchenware', 'initial-data')}
    ingredients, additions, alias_decisions = catalogue(old['ingredients'], documents, rules)
    kitchen = clean_kitchen(old['kitchenware'])
    recipes, issues = clean_recipes(documents, old['recipes'], ingredients, kitchen, rules)
    foods, observations, nutrition_issues = typed_nutrition(upstream)
    concepts = []
    aliases = defaultdict(set)
    for row in load_jsonl(upstream['reference/aliases.jsonl']):
        aliases[row['entity_id']].add(n.norm(row['alias_zh']))
    for raw in load_jsonl(upstream['reference/entities.jsonl']):
        concepts.append(dict(id=raw['entity_id'], name=n.norm(raw['canonical_name_zh']),
                             source_type=raw['entity_type'], aliases_unreviewed=sorted(aliases[raw['entity_id']]),
                             source_url=raw['source_url'], source_license=raw['source_license'],
                             ingredient_id=raw['entity_id'] if raw['entity_id'] in {r['id'] for r in ingredients} else None,
                             source_record_sha256=digest(encoded(raw))))
    data = dict(ingredients=ingredients, recipes=recipes, kitchenware=kitchen, **{
        'initial-data': old['initial-data'], 'food-concepts': sorted(concepts, key=lambda r: r['id']),
        'nutrition-foods': foods, 'nutrition-observations': observations})
    validate(data)
    search = {}
    collisions = []
    for name, collection in (('ingredients', ingredients), ('kitchenware', kitchen)):
        search[name] = [dict(term=term, ids=sorted(ids), ambiguous=len(ids) > 1) for term, ids in sorted(n.make_index(collection).items())]
        collisions += [dict(collection=name, **r) for r in search[name] if r['ambiguous']]
    titles = defaultdict(list)
    for recipe in recipes:
        titles[n.key(recipe['title'])].append(recipe['id'])
    collisions += [dict(collection='recipes', term=term, ids=ids, ambiguous=True) for term, ids in sorted(titles.items()) if len(ids) > 1]
    old_ids = {r['id'] for r in old['recipes']}
    recovered = [dict(id=r['id'], title=r['title'], category=r['category']) for r in recipes if r['id'] not in old_ids]
    before, after = stats(old['ingredients'], old['recipes'], old['kitchenware']), stats(ingredients, recipes, kitchen)
    report = dict(version=rules['version'], status='cleaned_candidate', before=before, after=after,
                  added_ingredient_ids=additions, recovered_recipes=recovered, recipe_document_decisions=dict(Counter(d['disposition'] for d in decisions)),
                  measurement_kinds=dict(Counter(i['measurement']['kind'] for r in recipes for i in r['ingredients'])),
                  nutrition_statuses=dict(Counter(r['status'] for r in observations)),
                  nutrition_foods=len(foods), food_concepts=len(concepts),
                  collision_groups=len(collisions), review_issues=dict(Counter(r['kind'] for r in issues + nutrition_issues)),
                  recipes_with_variants=sum(bool(r['variants']) for r in recipes),
                  recipes_with_complete_links=sum(r['readiness']['ingredient_links_complete'] for r in recipes),
                  automatic_execution_recipes=0, human_or_kitchen_review_performed=False,
                  runtime_import_applied=False, source_archive_sha256=archive_lock['sha256'])
    for name, value in data.items():
        files['clean/' + name + '.json'] = encoded(value)
    files.update({'clean/search-index.json': encoded(search), 'quality/report.json': encoded(report),
                  'review/recipe-issues.jsonl': jsonl(issues), 'review/nutrition-issues.jsonl': jsonl(nutrition_issues),
                  'review/collisions.json': encoded(collisions), 'review/alias-decisions.json': encoded(alias_decisions),
                  'review/source-document-decisions.json': encoded(decisions), 'rules.json': encoded(rules),
                  'sources.lock.json': lock_raw, 'archive.lock.json': encoded(archive_lock)})
    # Preserve the entire previous package as read-only evidence, including all review queues.
    for path, raw in upstream.items():
        files['upstream/rc7/' + path] = raw
    for path in ('package.py', 'normalize.py', 'rules.json', 'README.md'):
        files['build/reclean/' + path] = (HERE / path).read_bytes().replace(b'\r\n', b'\n')
    files['build/audit.py'] = (HERE.parent / 'audit.py').read_bytes().replace(b'\r\n', b'\n')
    files['build/test_reclean.py'] = (HERE.parent / 'test_reclean.py').read_bytes().replace(b'\r\n', b'\n')
    files['build/archive.lock.json'] = encoded(archive_lock)
    files['build/sources.lock.json'] = lock_raw
    files['README.md'] = (HERE / 'README.md').read_bytes().replace(b'\r\n', b'\n')
    files['quality/REPORT.md'] = render_report(report)
    files['CATALOGUE.md'] = render_catalogue(recipes)
    manifest = dict(package='dietdigidose-base-data', version=rules['version'], schema_version=2,
                    status='cleaned_candidate', runtime_import_allowed=False,
                    files=[dict(path=path, bytes=len(raw), sha256=digest(raw)) for path, raw in sorted(files.items())])
    files['manifest.json'] = encoded(manifest)
    target_dir.mkdir(parents=True)
    target = target_dir / ('dietdigidose-base-data-' + rules['version'] + '.zip')
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_STORED) as z:
        for path, raw in sorted(files.items()):
            info = zipfile.ZipInfo(path, date_time=(2026, 9, 15, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, raw)
    for path, raw in files.items():
        if not path.startswith(('upstream/', 'provenance/', 'build/')):
            destination = target_dir / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
    (target_dir / (target.name + '.sha256')).write_text(digest(target.read_bytes()) + '  ' + target.name + '\n', encoding='utf-8')
    verify(target)
    return target, report


def render_report(report):
    before, after = report['before'], report['after']
    labels = {'ingredients': '食材目录记录', 'recipes': '菜谱记录（含项目草稿）', 'source_recipes': '来源菜谱',
              'kitchenware': '厨具目录', 'ingredient_lines': '用料行', 'linked_ingredient_lines': '已关联食材的用料行',
              'exact_metric_lines': '明确公制数量行', 'recipes_with_explicit_servings': '有明确人数的菜谱',
              'recipes_with_equipment_evidence': '有厨具原文证据的菜谱'}
    lines = ['# 基础数据包清洗报告 ' + report['version'], '',
             '本包完成来源重解析、常见食材补录、单位结构化和逐条问题清单。没有导入系统数据库。', '',
             '| 项目 | rc.7 | 新包 |', '|---|---:|---:|']
    lines += [f'| {label} | {before[key]} | {after[key]} |' for key, label in labels.items()]
    lines += ['', '新增菜谱和从原料表补回的用料改变了统计分母；名称关联不等于人工身份认证。',
              '所有旧 ID 保留；同名来源记录不强行合并。精确同名匹配优先已有项目食材，候选 ID 同时保留。', '',
              '## 可直接用于数据接入开发', '',
              '1. clean/ingredients.json、kitchenware.json：目录与精确别名。',
              '2. clean/recipes.json：原文、结构化数量、范围、份数证据、厨具提及和配方分支。',
              '3. clean/food-concepts.json：全部 2,347 个概念，明确区分来源类型和未审核别名。',
              '4. clean/nutrition-foods.json、nutrition-observations.json：USDA 独立食品和逐条数值，不自动绑定中文食材。',
              '5. clean/initial-data.json：沿用原有稳定 ID 和示例标记，包内无密码。', '',
              '## 数量规则', '',
              '克/千克、毫升/升按单位精确换算；个、瓣、勺、斤、两保留原单位，不猜克重。',
              '范围保存上下限；适量为空；含人数变量的公式保留原文。配方人数与计算批次分开，不擅自代入公式。',
              '厨具提及保留否定与替代上下文，不转成必需设备。烘焙表格的不同尺寸保留为独立变体。', '',
              '## 营养清洗', '',
              f"363 个 USDA 食品和 15,193 条观测完整保留；状态分布：`{json.dumps(report['nutrition_statuses'], ensure_ascii=False)}`。",
              '负数观测的可用数值设为 null，原值和异常原因保留。真实零与缺失值区分，单位大小写规范化。',
              '测量基准未编码在源行中，标记未确认；中文映射候选继续保留在 upstream/rc7/review。', '',
              '## 尚需处理', '',
              f"逐条问题：`{json.dumps(report['review_issues'], ensure_ascii=False)}`；名称冲突组：{report['collision_groups']}。",
              '来源配方一致性、份数缩放、烹饪实测和许可语义审核未完成。新包不启用自动推荐执行或库存扣减。',
              '饮品与酱料以独立 category 收录，调用端按实际用途筛选；公开发布前按来源说明完成审核。',
              '旧 rc.7 导入器固定了包哈希和旧契约；本包 schema_version=2，需适配后才能接入运行时。', '',
              '## 恢复的来源菜谱', '']
    lines += [f"- {r['title']}（{r['category']}）" for r in report['recovered_recipes']]
    return ('\n'.join(lines) + '\n').encode('utf-8')


def render_catalogue(recipes):
    lines = ['# 菜谱浏览目录', '', '完整数据见 clean/recipes.json；数字范围与变量保留，不表示已可自动执行。', '']
    for row in sorted(recipes, key=lambda r: (r['category'], r['title'])):
        linked = sum(bool(i['ingredient_id']) for i in row['ingredients'])
        lines += ['## ' + row['title'], '', f"ID：{row['id']} · 分类：{row['category']} · 食材关联：{linked}/{len(row['ingredients'])}", '',
                  f"来源：{row.get('source_url') or '项目草稿'}", '', '| 原文食材 | 原文数量 | 数量状态 |', '|---|---|---|']
        for item in row['ingredients']:
            values = [item['name'], item['amount_text'] or '未说明', item['measurement']['kind']]
            lines.append('| ' + ' | '.join(v.replace('|', '\\|').replace('\n', ' ') for v in values) + ' |')
        lines.append('')
    return ('\n'.join(lines) + '\n').encode('utf-8')


def verify(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP member')
        for name in names:
            p = PurePosixPath(name)
            require(not p.is_absolute() and '..' not in p.parts and '\\' not in name and ':' not in name, 'Unsafe member path')
        manifest = json.loads(z.read('manifest.json'))
        entries = manifest['files']
        require(len(entries) == len({e['path'] for e in entries}), 'Duplicate manifest entry')
        require(set(names) == {'manifest.json', *(e['path'] for e in entries)}, 'Manifest coverage mismatch')
        require(manifest['schema_version'] == 2 and manifest['runtime_import_allowed'] is False, 'Unexpected package contract')
        for entry in entries:
            data = z.read(entry['path'])
            require(len(data) == entry['bytes'] and digest(data) == entry['sha256'], 'Member checksum mismatch: ' + entry['path'])
        data = {name: json.loads(z.read('clean/' + name + '.json')) for name in
                ('ingredients', 'recipes', 'kitchenware', 'initial-data', 'nutrition-foods', 'nutrition-observations')}
        validate(data)
        for recipe in data['recipes']:
            if recipe['source'] == 'howtocook':
                require(digest(z.read('provenance/howtocook/' + recipe['id'] + '.md')) == recipe['source_sha256'], 'Recipe provenance mismatch')
        old_ids = {name: {r['id'] for r in json.loads(z.read('upstream/rc7/clean/' + name + '.json'))} for name in ('ingredients', 'recipes', 'kitchenware')}
        for name, ids_ in old_ids.items():
            require(ids_ <= {r['id'] for r in data[name]}, 'Old logical ID lost')
        report = json.loads(z.read('quality/report.json'))
        require(report['after'] == stats(data['ingredients'], data['recipes'], data['kitchenware']), 'Report totals mismatch')
        concepts = json.loads(z.read('clean/food-concepts.json'))
        require(len(concepts) == 2347 and len({r['id'] for r in concepts}) == 2347, 'Food concept coverage mismatch')
        indexes = json.loads(z.read('clean/search-index.json'))
        for collection in ('ingredients', 'kitchenware'):
            expected = [dict(term=term, ids=sorted(ids), ambiguous=len(ids) > 1) for term, ids in sorted(n.make_index(data[collection]).items())]
            require(indexes[collection] == expected, 'Search index mismatch')
    return dict(valid=True, files=len(names), sha256=digest(Path(path).read_bytes()))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rc7', type=Path)
    parser.add_argument('--howtocook', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify(args.verify)))
    else:
        parser.error('--rc7, --howtocook and --output are required') if not all((args.rc7, args.howtocook, args.output)) else None
        target, report = build(args.rc7, args.howtocook, args.output)
        print(json.dumps(dict(path=str(target), before=report['before'], after=report['after']), ensure_ascii=False))
