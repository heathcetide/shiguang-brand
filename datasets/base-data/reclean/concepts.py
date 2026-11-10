"""Concept-centric release from immutable cleaned sources, without runtime import."""
import argparse
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from bindings_batch1 import sha, encoded
from concept_runtime import key, search, estimate
from chinese import simplify

VERSION = 'concept-base-1.0.0-rc.1'
SNAPSHOTS = {
    'Q15260613.json': 'fac67f6595f3c2cd6c06e2739f11fc14a4e37b9e9481297202778f39a098d61d',
    'Q16587531.json': 'bba48b07d288d5346c192b4d0594fe22c9f118b1adf5627daf72660af5359e45',
    'Q21546392.json': '6f1adce40c0e3b02b099b950deee2a410ebf9fc840f878619bb5d6e6c3229c95',
    'Q23501.json': '6cc84b50e3f7e1ab893c9698d833cf9045e41fcd9518cc77b85d29777d101e92',
    'Q25416839.json': 'c483b18b239e68652bdf6a875ab7f89f32185790c9b7566c340c76df5e5fd7c6',
    'Q372893.json': '9bd8cc55a5772aa8be68cdd8161ab8cfb3adda95b57e12be185f15a2ffee5b3c',
    'Q81.json': '887c45211fbccf181e551e9b687ada585a2260ba2e8ba870cb74a446cdd0ea0d'}
INPUTS = {
    'base': ('artifacts/base-data/0.2.0-rc.2/dietdigidose-base-data-0.2.0-rc.2.zip', '037cc5a46b64125bf613aaf720aa55d99df2614f864ed63e65087a0c5edaad7c'),
    'batch1': ('artifacts/base-data/nutrition-bindings-batch1/nutrition-bindings-batch1.zip', 'c02fa82511ef45c2e3f5c51c08f5337bf8c1a425458dd51c8e42c1898dea34c9'),
    'batch2': ('artifacts/base-data/nutrition-bindings-batch2/nutrition-bindings-batch2.zip', '10ae6c4532ca37948203a5e8e3806e6ed76bc1a6dfd15ac03ede757f82730914'),
}
MERGE = {'DDD-I-egg': 'WD-Q15260613', 'DDD-I-garlic': 'WD-Q21546392',
         'DDD-I-potato': 'WD-Q16587531', 'DDD-I-carrot': 'WD-Q81'}
PRODUCT_NAMES = {'老干妈', '可口可乐', '新餐肉'}
PRODUCT_GENERIC = {'可口可乐': '可乐'}
FORM_RULES = {
    '鸡胸肉': ('鸡肉', {'part': 'breast'}), '去皮去骨鸡胸肉': ('鸡肉', {'part': 'breast', 'skin': 'removed', 'bone': 'removed'}),
    '鸡腿肉': ('鸡肉', {'part': 'leg'}), '鸡腿': ('鸡肉', {'part': 'leg'}), '大鸡腿': ('鸡肉', {'part': 'leg', 'size': 'large_source_unspecified'}),
    '五花肉': ('猪肉', {'part': 'belly'}), '带皮五花肉': ('猪肉', {'part': 'belly', 'skin': 'included'}),
    '蛋清': ('蛋', {'part': 'white', 'species': 'requires_recipe_confirmation'}),
    '蛋黄': ('蛋', {'part': 'yolk', 'species': None}), '蛋白': ('蛋', {'part': 'white', 'species': None}),
    '姜粉': ('生姜', {'processing': 'dried_ground'}), '蒜粉': ('大蒜', {'processing': 'dried_ground'}),
    '黑胡椒粉': ('黑胡椒', {'processing': 'ground'}), '白胡椒粉': ('白胡椒', {'processing': 'ground'}),
}
DISH_ALIASES = {'西红柿炒鸡蛋': '番茄炒蛋'}


def local(kind, name):
    return 'LOCAL:' + kind + ':' + sha(key(name).encode())[:16]


def provenance(row, table, position):
    return {'source_table': table, 'source_position': position, 'record_sha256': sha(encoded(row)),
            'source_url': row.get('source_url'), 'source_license': row.get('source_license')}


def step_fields(text):
    # Keep explicit text spans; no conversion of minutes to invented durations.
    return {'time_evidence': re.findall(r'\d+(?:\.\d+)?(?:\s*[-~至到]\s*\d+(?:\.\d+)?)?\s*(?:分钟|秒钟|小时|秒)', text),
            'temperature_evidence': re.findall(r'\d+(?:\s*[-~至到]\s*\d+)?\s*(?:℃|°C|摄氏度)', text)}


def build(output):
    if output.exists():
        raise FileExistsError(output)
    archives = {}
    resolved_inputs = {}
    for name, (path, expected) in INPUTS.items():
        resolved = Path(path)
        if not resolved.exists():
            resolved = Path(__file__).parent / ('baseline-sources.zip' if name == 'base' else 'inputs/' + name + '.zip')
        data = resolved.read_bytes()
        if sha(data) != expected:
            raise ValueError('Input changed: ' + name)
        archives[name] = zipfile.ZipFile(resolved)
        resolved_inputs[name] = resolved
    z = archives['base']
    tables = {n: json.loads(z.read('clean/' + n + '.json')) for n in ['food-concepts', 'ingredients', 'kitchenware', 'recipes', 'nutrition-foods', 'nutrition-observations']}
    concepts, redirects, forms, products, issues, relations = {}, [], [], [], [], []
    alias_rows = []
    def concept(cid, name, kind, source=None, active=True):
        if cid not in concepts:
            concepts[cid] = {'id': cid, 'name_zh': name, 'kind': kind, 'active_catalogue': active,
                             'wikidata_id': cid[3:] if cid.startswith('WD-') else None,
                             'application_categories': [], 'sources': [], 'source_classifications': [],
                             'semantic_review': 'source_asserted_pending_detailed_review'}
        if active:
            concepts[cid]['active_catalogue'] = True
        if source:
            concepts[cid]['sources'].append(source)
        return concepts[cid]
    def alias(cid, text, regions=None, status='source_asserted', source=None, language='zh'):
        if not text:
            return
        alias_rows.append({'concept_id': cid, 'text': text, 'language': language, 'regions': regions or [],
                           'status': status, 'source': source})
    snapshots = {}
    for filename, expected in sorted(SNAPSHOTS.items()):
        path = Path('.cache/base-data-sources/concept-v1') / filename
        if not path.exists(): path = Path(__file__).parent / 'wikidata' / filename
        data = path.read_bytes(); ent = json.loads(data)['entities'][path.stem]
        if sha(data) != expected:
            raise ValueError('Encyclopedia snapshot changed')
        snapshots[path.name] = data
        if ent.get('id') != path.stem:
            raise ValueError('Snapshot identity mismatch')
    for pos, row in enumerate(tables['food-concepts']):
        cid = row['id']; typ = row['source_type']; name = row['name']
        if cid == 'WD-Q372893':
            name = '毛腿冬菇'
        kind = {'dish': 'dish', 'ingredient': 'ingredient'}.get(typ, 'reference')
        if name in PRODUCT_NAMES:
            kind = 'product_reference'
        if cid == 'WD-Q23501':
            kind = 'biological_reference'
        c = concept(cid, name, kind, provenance(row, 'food-concepts', pos), active=kind in ['ingredient', 'dish'])
        c['source_classifications'].append({'value': typ, 'scheme': 'baseline_wikidata_extract'})
        if cid[3:] + '.json' in snapshots:
            ent = json.loads(snapshots[cid[3:] + '.json'])['entities'][cid[3:]]
            c['wikidata_snapshot'] = {'file': cid[3:] + '.json', 'revision': ent.get('lastrevid')}
            for lang, label in ent.get('labels', {}).items():
                if lang == 'en' or lang.startswith('zh'):
                    region = {'zh-cn':'CN','zh-tw':'TW','zh-hk':'HK','zh-sg':'SG'}.get(lang)
                    alias(cid, label['value'], [region] if region else [], status='snapshot_label', source=cid, language=lang)
            c['wikipedia_sitelinks'] = {lang: link['title'] for lang, link in ent.get('sitelinks', {}).items() if lang in ['zhwiki', 'enwiki']}
            for prop in ['P31', 'P279']:
                vals = []
                for cl in ent.get('claims', {}).get(prop, []):
                    value = cl.get('mainsnak', {}).get('datavalue', {}).get('value')
                    if isinstance(value, dict) and value.get('id'):
                        vals.append(value['id'])
                c.setdefault('encyclopedia_relations', {})[prop] = vals
        for a in row.get('aliases_unreviewed', []):
            alias(cid, a, status='unreviewed_not_indexed', source=cid)
    # Known same identity merges only. Similar names are not sufficient.
    byname = defaultdict(list)
    for row in tables['ingredients']:
        byname[row['name']].append(row)
    def core_id(name):
        if name == '鸡蛋': return 'WD-Q15260613'
        if name == '大蒜': return 'WD-Q21546392'
        if name == '马铃薯': return 'WD-Q16587531'
        return local('ingredient', name)
    imap = {}
    for pos, row in enumerate(tables['ingredients']):
        iid, name = row['id'], row['name']
        props = {'source_state': row.get('state'), 'part': None, 'processing': None}
        if iid == 'WD-Q372893':
            name = '毛腿冬菇'
        if name in PRODUCT_NAMES:
            generic = PRODUCT_GENERIC.get(name)
            cid = core_id(generic) if generic else None
            if cid:
                concept(cid, generic, 'ingredient')
            pid = local('product', name)
            products.append({'id': pid, 'name': name, 'ingredient_concept_id': cid,
                             'source': provenance(row, 'ingredients', pos), 'formula': None})
            if cid is None:
                cid = local('unresolved-product', name)
                concept(cid, name, 'product_reference', active=False)
                issues.append({'type': 'product_identity_requires_specific_product', 'legacy_id': iid})
        elif name in FORM_RULES:
            base, extra = FORM_RULES[name]; cid = core_id(base); props.update(extra)
            concept(cid, base, 'ingredient')
            if iid.startswith('WD-') and iid != cid:
                relations.append({'from': cid, 'to': iid, 'type': 'source_describes_form', 'evidence': name})
        else:
            cid = MERGE.get(iid, iid if iid.startswith('WD-') and iid != 'WD-Q23501' else core_id(name))
            concept(cid, name, 'ingredient')
        c = concepts[cid]
        c.setdefault('application_roles', [])
        if name not in PRODUCT_NAMES and 'ingredient' not in c['application_roles']:
            c['application_roles'].append('ingredient')
        state = row.get('state') or ''
        if state.startswith('raw'):
            props['cooking_state'] = 'raw'
        if 'peeled' in state: props['peel'] = 'removed'
        if 'shell_removed' in state: props['shell'] = 'removed'
        c['sources'].append(provenance(row, 'ingredients', pos))
        if row.get('category'):
            c['application_categories'].append({'value': row['category'], 'source': iid, 'scheme': 'baseline_application_classification'})
        fid = 'FORM:' + iid
        form = {'id': fid, 'concept_id': cid, 'legacy_ingredient_id': iid, 'display_name': name,
                'properties': props, 'source': provenance(row, 'ingredients', pos), 'nutrition_link_ids': []}
        forms.append(form); imap[iid] = form
        redirects.append({'legacy_table': 'ingredients', 'legacy_id': iid, 'concept_id': cid, 'form_id': fid,
                          'decision': 'explicit_equivalence' if iid in MERGE else 'preserved_identity_or_explicit_form'})
        if name not in PRODUCT_NAMES:
            alias(cid, name, status='source_name', source=iid)
            for a in row.get('aliases', []):
                # Parent concept aliases must not broaden to a more specific form.
                if name not in FORM_RULES and a not in ['老姜']:
                    alias(cid, a, source=iid)
    relations.append({'from': core_id('番茄'), 'to': 'WD-Q23501', 'type': 'food_from_biological_concept', 'evidence': 'Wikidata Q23501 describes plant; local ingredient denotes food'})
    # Explicit regional collision retained rather than globally assigning the word.
    peanut = next((f['concept_id'] for f in forms if f['display_name'] == '花生'), None)
    alias('WD-Q16587531', '土豆', ['CN'], 'regional_alias', 'baseline_alias_and_TFDA_regional_collision')
    if peanut: alias(peanut, '土豆', ['TW'], 'regional_alias', 'TFDA_explicit_alias')
    kmap = {}
    for pos, row in enumerate(tables['kitchenware']):
        cid = local('kitchenware', row['name']); kmap[row['id']] = cid
        c = concept(cid, row['name'], 'kitchenware', provenance(row, 'kitchenware', pos))
        c['application_categories'].append({'value': row.get('category'), 'source': row['id'], 'scheme': 'baseline_application_classification'})
        alias(cid, row['name'], source=row['id'])
        for a in row['aliases']: alias(cid, a, source=row['id'])
        redirects.append({'legacy_table': 'kitchenware', 'legacy_id': row['id'], 'concept_id': cid})
    # Methods retain original rows and bind through form IDs, not sample names.
    methods, dish_groups = [], defaultdict(list)
    for pos, row in enumerate(tables['recipes']):
        title = DISH_ALIASES.get(row['title'], row['title'])
        dish_id = local('dish', title)
        concept(dish_id, title, 'dish', provenance(row, 'recipes', pos))
        alias(dish_id, row['title'], source=row['id'])
        mid = 'METHOD:' + row['id']
        ingredients = []
        for n, line in enumerate(row['ingredients']):
            f = imap.get(line.get('ingredient_id'))
            item = dict(line, line_id=mid + ':line:' + str(n), ingredient_form_id=f['id'] if f else None,
                        ingredient_concept_id=f['concept_id'] if f else None)
            if not f:
                issues.append({'type': 'unresolved_recipe_ingredient', 'method_id': mid, 'line': n, 'source_text': line.get('name')})
            ingredients.append(item)
        reqs = []
        for req in row.get('kitchenware_requirements', []):
            reqs.append(dict(req, concept_ids=[kmap[i] for i in req.get('catalogue_ids', []) if i in kmap],
                             substitution_status='requires_evidence_and_selection' if req.get('role') == 'alternative_requires_choice' else 'not_asserted'))
        if not reqs:
            reqs = [{'concept_ids': [kmap[i]], 'role': 'unclassified_source_reference', 'source_id': i} for i in row.get('kitchenware_ids', []) if i in kmap]
        steps = [{'order': n+1, 'text': text, **step_fields(text)} for n, text in enumerate(row['steps'])]
        exact = sum(x.get('measurement', {}).get('kind') == 'exact' and x.get('ingredient_form_id') is not None for x in ingredients)
        missing = []
        if exact < len(ingredients): missing.append('ingredient_identity_or_exact_quantity')
        if not row.get('servings'): missing.append('servings')
        if not steps: missing.append('steps')
        if not reqs: missing.append('equipment')
        method = {'id': mid, 'dish_concept_id': dish_id, 'title': row['title'], 'ingredients': ingredients,
                  'steps': steps, 'equipment_requirements': reqs, 'servings': row.get('servings'),
                  'yield': {'servings': row.get('servings'), 'evidence': row.get('serving_evidence'), 'finished_weight_g': None},
                  'source': provenance(row, 'recipes', pos), 'source_method_id': row['id'],
                  'source_variants_unstructured': row.get('variants', []), 'source_step_details': row.get('step_details', []),
                  'source_recipe_sha256': sha(encoded(row)), 'missing_fields': missing,
                  'ranking_score': [int(bool(steps)), exact / max(1,len(ingredients)), int(bool(row.get('servings'))), int(bool(reqs))],
                  'kitchen_tested': False, 'automatic_execution_allowed': False}
        methods.append(method); dish_groups[dish_id].append(method)
    recipes = []
    for did, group in sorted(dish_groups.items()):
        ordered = sorted(group, key=lambda x: (tuple(-v for v in x['ranking_score']), x['id']))
        primary = ordered[0]
        recipes.append({'id': 'RECIPE:' + did, 'dish_concept_id': did, 'primary_method_id': primary['id'],
                        'method_ids': [m['id'] for m in ordered], 'primary_selection': {'rule': 'steps_then_exact_mapped_quantity_fraction_then_servings_then_equipment_then_stable_id',
                        'scores': {m['id']: m['ranking_score'] for m in ordered}, 'update_policy': 'frozen_per_release_diff_required'},
                        'primary_nutrition_method_id': primary['id']})
    # Encyclopedia-only dishes still have exactly one recipe container, with no invented method.
    for cid, c in concepts.items():
        if c['kind'] == 'dish' and cid not in dish_groups:
            recipes.append({'id': 'RECIPE:' + cid, 'dish_concept_id': cid, 'primary_method_id': None,
                            'method_ids': [], 'primary_nutrition_method_id': None, 'status': 'no_sourced_method'})
    # Keep distinct source records and conditional bindings; no automatic promotion.
    nutrition_links, observations, source_rows = [], {}, {}
    for batch in ['batch1', 'batch2']:
        bz = archives[batch]
        for o in json.loads(bz.read('observations.json')):
            if o['id'] in observations and observations[o['id']] != o:
                raise ValueError('Conflicting observation ID')
            observations[o['id']] = o
        for sr in json.loads(bz.read('source-rows.json')):
            source_rows[sr['source_position']] = sr
        for link in json.loads(bz.read('bindings.json')):
            f = imap[link['ingredient_id']]
            nutrition_links.append(dict(link, ingredient_form_id=f['id'], ingredient_concept_id=f['concept_id']))
            f['nutrition_link_ids'].append(link['id'])
    nutrients = [dict(estimate(m, {}, nutrition_links, list(observations.values())), method_id=m['id']) for m in methods]
    # Exact search index includes frozen simplified variants; portable query code.
    index = defaultdict(list)
    for cid, c in concepts.items():
        if c['active_catalogue'] and c['kind'] not in ['product_reference', 'biological_reference']:
            alias(cid, c['name_zh'], status='canonical', source=cid)
    for a in alias_rows:
        cid = a['concept_id']; c = concepts[cid]
        if a['status'] == 'unreviewed_not_indexed' or c['kind'] in ['product_reference', 'biological_reference']:
            continue
        for text in {a['text'], simplify(a['text'])}:
            hit = {'concept_id': cid, 'name': c['name_zh'], 'kind': c['kind'], 'alias': a['text'], 'regions': a['regions'], 'language': a['language']}
            if hit not in index[key(text)]: index[key(text)].append(hit)
    for term, hits in sorted(index.items()):
        ids = sorted({h['concept_id'] for h in hits})
        if len(ids) > 1: issues.append({'type': 'search_ambiguity_preserved', 'term': term, 'concept_ids': ids})
    # Snapshot update is explicit and does not silently rewrite historical sources.
    audit = {'input_counts': {k: len(v) for k,v in tables.items()}, 'confirmed_merges': MERGE,
             'snapshot_corrections': [{'id': 'WD-Q372893', 'old_name': '金针菇', 'new_name': '毛腿冬菇', 'source': 'Q372893.json'}],
             'product_names_separated': sorted(PRODUCT_NAMES), 'dish_title_equivalence': DISH_ALIASES,
             'unreviewed_source_concepts_preserved': sum(not c['active_catalogue'] for c in concepts.values())}
    summary = {'version': VERSION, 'concepts': len(concepts), 'active_concepts': sum(c['active_catalogue'] for c in concepts.values()),
               'ingredient_forms': len(forms), 'dish_recipe_concepts': len(recipes), 'methods': len(methods),
               'recipes_with_methods': len(dish_groups), 'multiple_method_recipes': sum(len(r['method_ids'])>1 for r in recipes), 'nutrition_links': len(nutrition_links),
               'source_observations': len(observations), 'products': len(products), 'review_issues': len(issues),
               'runtime_import_applied': False, 'complete_recipe_nutrition_estimates': 0}
    out = {'concepts.json': list(concepts.values()), 'ingredient-forms.json': forms, 'legacy-map.json': redirects,
           'aliases.json': alias_rows, 'relations.json': relations, 'products.json': products,
           'recipe-concepts.json': recipes, 'methods.json': methods, 'method-nutrition.json': nutrients,
           'nutrition-links.json': nutrition_links, 'nutrition-observations.json': list(observations.values()),
           'tfda-source-rows.json': list(source_rows.values()), 'usda-foods.json': tables['nutrition-foods'],
           'usda-observations.json': tables['nutrition-observations'], 'search-index.json': dict(index),
           'review-issues.json': issues, 'audit.json': audit, 'summary.json': summary,
           'sources.lock.json': {'inputs': INPUTS, 'wikidata_snapshots': {n: sha(b) for n,b in snapshots.items()},
                                 'normalization': 'NFKC + frozen Windows zh-CN simplified keys', 'update_policy': 'immutable_release_and_explicit_diff'}}
    out['search-verification.json'] = [{'query': q, 'region': region, 'results': search(dict(index), q, region)}
                                     for q, region in [('鸡蛋',None),('雞蛋',None),('土豆','CN'),('土豆','TW'),
                                                       ('鸡胸肉',None),('金针菇',None),('毛腿冬菇',None),
                                                       ('番茄炒蛋',None),('西红柿炒鸡蛋',None),('老干妈',None)]]
    validate(out)
    output.mkdir(parents=True)
    for n, obj in out.items(): (output / n).write_bytes(encoded(obj))
    (output / 'wikidata').mkdir()
    for n, data in snapshots.items(): (output / 'wikidata' / n).write_bytes(data)
    # Original source release provides provenance and lossless reconstruction.
    (output / 'baseline-sources.zip').write_bytes(resolved_inputs['base'].read_bytes())
    (output / 'inputs').mkdir()
    for name in ['batch1','batch2']:
        (output / 'inputs' / (name + '.zip')).write_bytes(resolved_inputs[name].read_bytes())
    for name in ['concepts.py', 'concept_runtime.py', 'concept_diff.py', 'bindings_batch1.py', 'chinese.py']:
        (output / name).write_bytes((Path(__file__).parent / name).read_bytes())
    (output / 'opencc').mkdir()
    for name in ['TSCharacters.txt', 'LICENSE', 'README.md']:
        (output / 'opencc' / name).write_bytes((Path(__file__).parent / 'opencc' / name).read_bytes())
    (output / 'CONCEPT-MODEL.md').write_bytes((Path(__file__).parent / 'CONCEPT-MODEL.md').read_bytes())
    report = f'''# 概念基础包 {VERSION}

以百科概念和本地核心概念组织数据，来源样品独立存放。首版覆盖现有清洗数据，不执行系统导入。

## 结果

- 概念总数 {len(concepts)}，当前目录概念 {summary['active_concepts']}；其余为保留的百科参考记录。
- 984条食材来源记录全部转换为可追溯的形态记录；261条厨具来源均有概念映射。
- {len(recipes)}个菜品各对应一个食谱概念，其中{len(dish_groups)}个有来源做法，共保存389个具体做法；{summary['multiple_method_recipes']}个食谱包含多个做法。其他百科菜品暂无来源做法。
- 营养层复用38条条件关联，保留两个TFDA批次的原始观测及全部USDA记录。
- 鸡蛋、大蒜、马铃薯、胡萝卜的4个确认重复入口已合并；鸡肉部位、蛋的组成部分和部分加工状态独立表达。

## 数据入口

concepts.json 为核心与参考概念；ingredient-forms.json 为部位/状态；recipe-concepts.json 为菜品的一对一食谱；methods.json 为具体做法。
legacy-map.json 保留旧ID对应关系。商品信息在products.json，来源营养样品不进入概念名称索引。
百科关系保留在encyclopedia_relations，应用分类单独保留，不将两者混用。仅新核验的7条百科记录带完整关系快照，其余不补造。

## 搜索与歧义

使用concept_runtime.search(index, query, region)；土豆同时保留马铃薯与花生的地区别名，地区只排序，不隐藏另一个结果。
鸡胸肉等形态名称指向核心食材；可通过ingredient-forms.json查看具体形态。金针菇与毛腿冬菇是不同物种，不按旧名合并。
本次只对明确规则作合并，review-issues.json保留其他名称歧义，不能宣称整个百科目录已完成人工语义审核。

## 做法与营养

主要做法按步骤、明确数量比例、份数、厨具信息选择，并记录分数和稳定选择理由。西红柿炒鸡蛋与番茄炒蛋归入同一菜品；未确认的其他近义标题不自动合并。
时间与温度仅提取原文明确文字，缺失保留。必需/可选/待选替代厨具角色沿用来源；未分类的项目不伪装必需。
主要营养严格引用主要做法。当前未自动确认每行来源样品与前处理重量，因此营养结果明确为不完整，不能视为整菜总量。
计算器estimate支持显式来源、形态条件和前处理克重，只计算整份配方；缺项不补零，不套用熟重、不自动换算每100克成品。

## 验收边界

可复现构建、外键完整、所有旧食材/工具/做法均可追溯；百科概念不因来源样品命名被覆盖。保留未解决项目，不将“不完整”当作删除理由。
本包为首版候选，不包含系统导入适配，也不声称所有概念已对齐、所有营养已绑定或厨房实测完成。

## 来源与使用说明

Wikidata结构化记录按CC0保留出处；HowToCook内容保留原包Unlicense与完整来源链。其他原包内容的来源说明见baseline-sources.zip，不统一改成一种许可。
TFDA：衛生福利部食品藥物管理署，2026下载快照，食品營養成分資料集8543（https://data.gov.tw/dataset/8543）；依政府資料開放授權條款第1版使用（https://data.gov.tw/license）。原值未更改，本应用不是来源机构认可产品。

## 构建

Windows Python标准库：python datasets/base-data/reclean/concepts.py --output artifacts/base-data/concept-reproduced
固定输入及百科快照哈希见sources.lock.json；搜索与计算函数不依赖Windows。新版要保留旧版，并对ID、主要做法、来源关联与数值输出差异。
独立复现：解压本包后，在空目录运行 python <解压目录>/concepts.py --output <新的输出目录>。输入ZIP与百科快照均已包含，无需联网。
检索样例与完整结果见search-verification.json；数据关系见CONCEPT-MODEL.md。
'''
    (output / 'REPORT.md').write_text(report, encoding='utf-8')
    manifest = {p.relative_to(output).as_posix(): sha(p.read_bytes()) for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'manifest.json').write_bytes(encoded(manifest))
    target = output / (VERSION + '.zip')
    with zipfile.ZipFile(target, 'w') as archive:
        for p in sorted(output.rglob('*')):
            if p.is_file() and p != target:
                info = zipfile.ZipInfo(p.relative_to(output).as_posix(), (2026,9,15,0,0,0)); info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, p.read_bytes())
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert all(sha(archive.read(n)) == h for n,h in manifest.items())
    (output / (target.name + '.sha256')).write_text(sha(target.read_bytes()) + '\n')
    return out


def validate(out):
    cs = {c['id'] for c in out['concepts.json']}
    fs = {f['id']: f for f in out['ingredient-forms.json']}
    ms = {m['id']: m for m in out['methods.json']}
    assert len(fs) == 984 and len(ms) == 389
    assert all(f['concept_id'] in cs for f in fs.values())
    assert len({r['dish_concept_id'] for r in out['recipe-concepts.json']}) == len(out['recipe-concepts.json'])
    for r in out['recipe-concepts.json']:
        assert (r['primary_method_id'] in r['method_ids']) if r['method_ids'] else r['primary_method_id'] is None
        assert all(ms[mid]['dish_concept_id'] == r['dish_concept_id'] for mid in r['method_ids'])
    for m in ms.values():
        assert all(i['ingredient_form_id'] is None or i['ingredient_form_id'] in fs for i in m['ingredients'])
        assert all(cid in cs for req in m['equipment_requirements'] for cid in req['concept_ids'])
    for l in out['nutrition-links.json']:
        assert fs[l['ingredient_form_id']]['concept_id'] == l['ingredient_concept_id']
        assert not l['automatic_runtime_binding']
    assert all(r['concept_id'] in cs for r in out['legacy-map.json'])
    assert len([r for r in out['legacy-map.json'] if r['legacy_table']=='kitchenware']) == 261


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output', type=Path, required=True)
    print(json.dumps(build(p.parse_args().output)['summary.json'], ensure_ascii=False))
