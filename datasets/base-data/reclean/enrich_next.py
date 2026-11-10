"""Second additive enrichment; retain exact samples, missing observations and weighing evidence."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import zipfile

from enrich_core import CORE, DISCLOSURE, encoded, estimate, sha, scalar

VERSION = 'concept-enrichment-2026-09-15.2'
TFDA_SHA = 'c1ef5502ceceead6d5ce3b7ee21fe544702b1e508be73b196fce2cf0e61985cb'
TFDA_URL = 'https://data.gov.tw/dataset/8543'
SAMPLES = [
    ('seaweed', 'F0210101', '紫菜', '未调味干紫菜，按泡发前干重；非海带、即食海苔或熟紫菜'),
    ('noodles', 'R2000101', '乾麵條', '含盐的原味小麦干面条，按下锅前干重；区域样品配料为面粉、盐、水及食用淀粉等，不适用于无盐面、鸡蛋面或荞麦面'),
    ('vinegar', 'P0600101', '米醋', '液态白米醋，按投料克重；非醋饮料或陈醋；来源未报告蛋白质和脂肪'),
    ('milk', 'L01021', '全脂鮮乳平均值', '未调味全脂鲜牛乳（乳脂 3.0–3.8%），来源为分月样品平均；按克计，不能直接用于毫升用量'),
]
REVIEW = [
    ('tofu', 'R4700902', '传统豆腐样品未明确凝固剂，不能据名称等同原方北豆腐'),
    ('soy', 'P0700401', '淡色酱油的加工与调味配方未与原方生抽对齐'),
    ('sesameoil', 'P0900201', '来源香油为白芝麻油与沙拉油调和，不是原方纯芝麻香油'),
    ('sesameoil', 'M1500101', '白芝麻油未报告焙炒状态，尚不能确认原方芝麻香油的加工形式'),
    ('shrimp', 'J2200501', '来源限定草虾仁，原方未限定虾种；来源未说明是否添加保水剂'),
]


def build(base, previous, tfda, output):
    base, previous, tfda, output = map(Path, (base, previous, tfda, output))
    if output.exists():
        raise FileExistsError(output)
    if sha(tfda.read_bytes()) != TFDA_SHA:
        raise ValueError('TFDA snapshot checksum mismatch')
    locks = {}
    def load(folder, name):
        manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf8'))
        raw = (folder / name).read_bytes()
        if sha(raw) != manifest[name]:
            raise ValueError(f'Parent checksum mismatch: {name}')
        locks[f'{folder.name}/{name}'] = sha(raw)
        return json.loads(raw)
    methods = load(base, 'methods.json')
    forms = {f['id']: f for f in load(base, 'ingredient-forms.json')}
    profiles = load(previous, 'nutrition-profiles.json')
    with zipfile.ZipFile(tfda) as z:
        raw_rows = json.loads(z.read(z.namelist()[0]).decode('utf-8-sig'))
    grouped = defaultdict(list)
    for position, row in enumerate(raw_rows):
        grouped[row['整合編號']].append({'source_position': position, 'row': row})
    names = {'calories': '熱量', 'protein': '粗蛋白', 'fat': '粗脂肪', 'carbs': '總碳水化合物'}
    selected = []
    for suffix, code, expected, scope in SAMPLES:
        rows = grouped[code]
        if not rows or any(r['row']['樣品名稱'] != expected for r in rows):
            raise ValueError('TFDA sample identity mismatch')
        nutrients = {}
        for key, name in names.items():
            matches = [r for r in rows if r['row']['分析項'] == name]
            if len(matches) != 1 or matches[0]['row']['含量單位'] != CORE[key][1]:
                raise ValueError('TFDA nutrient identity/unit mismatch')
            record = matches[0]
            nutrients[key] = {'amount': scalar(record['row']['每100克含量']), 'unit': CORE[key][1],
                'observation_id': f"TFDA-OBS:{code}:{record['source_position']}"}
        form = forms['FORM:DDD-I-' + suffix]
        profiles.append({'id': 'ENRICH-PROFILE:' + form['id'], 'ingredient_form_id': form['id'],
            'ingredient_concept_id': form['concept_id'], 'display_name': form['display_name'],
            'scope': scope, 'source_food_id': 'TFDA:' + code, 'source_name': expected, 'source_kind': 'TFDA',
            'source_description': rows[0]['row']['內容物描述'], 'source_url': TFDA_URL,
            'source_license': '政府資料開放授權條款-第1版', 'basis': 'per_100g_source_prepared_sample',
            'nutrients_per_100g': nutrients, 'binding_status': 'scoped_reference',
            'requires_scope_confirmation': True, 'automatic_runtime_binding': False, 'professional_review_performed': False})
        selected.extend(rows)
    # Supply attribution for the four reused TFDA profiles without altering their observations.
    for profile in profiles:
        if profile['source_kind'] == 'TFDA':
            profile.update(source_url=TFDA_URL, source_license='政府資料開放授權條款-第1版')
    decisions = []
    for suffix, code, reason in REVIEW:
        record = grouped[code][0]['row']
        decisions.append({'ingredient_form_id': 'FORM:DDD-I-' + suffix, 'source_food_id': 'TFDA:' + code,
            'source_name': record['樣品名稱'], 'source_description': record['內容物描述'],
            'source_url': TFDA_URL, 'status': 'not_bound', 'reason': reason})
        selected.extend(grouped[code])
    by_form = {p['ingredient_form_id']: p for p in profiles}
    evaluated, contracts = [], []
    for method in methods:
        if not method['source_method_id'].startswith('DDD-R-'):
            continue
        selections = []
        for line in method['ingredients']:
            profile = by_form.get(line.get('ingredient_form_id'))
            quantity = line.get('measurement') or {}
            if not profile or quantity.get('kind') != 'exact' or quantity.get('unit') != 'g' or not quantity.get('value'):
                continue
            selections.append({'line_id': line['line_id'], 'profile_id': profile['id'], 'grams': quantity['value'],
                'weight_basis': 'pre_cooking_edible_grams', 'scope': profile['scope'],
                'evidence_kind': 'project_recipe_editorial_weighing_contract', 'scope_is_recipe_assumption': True,
                'instruction': f"{line['name']}：按 {profile['scope']}，烹调前可食部称重 {quantity['value']:g} g。"})
        result = estimate(method, selections, profiles)
        for gap in result['gaps']:
            line = next(i for i in method['ingredients'] if i['line_id'] == gap['line_id'])
            reasons = [d['reason'] for d in decisions if d['ingredient_form_id'] == line.get('ingredient_form_id')]
            gap['reason_text'] = '；'.join(reasons) or '原方以毫升计量，缺少适用密度；未换算为克。'
        for line in method['ingredients']:
            selection = next((s for s in selections if s['line_id'] == line['line_id']), None)
            if not selection:
                continue
            profile = by_form[line['ingredient_form_id']]
            missing = [k for k in CORE if profile['nutrients_per_100g'][k]['amount'] is None]
            if missing:
                result['gaps'].append({'line_id': line['line_id'], 'name': line['name'], 'reason': 'source_nutrient_missing',
                    'missing_nutrients': missing, 'reason_text': '来源缺少' + '、'.join({'protein':'蛋白质','fat':'脂肪','carbs':'碳水','calories':'热量'}[k] for k in missing) + '数值；未按零计算。'})
        evaluated.append(result)
        contracts.append({'method_id': method['id'], 'version': VERSION, 'original_recipe_sha256': method['source_recipe_sha256'],
            'weighing_instructions': [s['instruction'] for s in selections], 'disclosure': DISCLOSURE,
            'original_amounts_unchanged': True})
    complete = [r for r in evaluated if r['status'] == 'core_complete_under_declared_assumptions']
    payload = {name: load(previous, name) for name in ['equipment-role-updates.json', 'duplicate-review.json', 'source-selected-records.json', 'source.lock.json']}
    payload['previous-source.lock.json'] = payload.pop('source.lock.json')
    summary = {'version': VERSION, 'parent_version': previous.name, 'scoped_profiles': len(profiles),
        'new_profiles_this_round': len(SAMPLES), 'recipes_assessed': len(evaluated), 'core_complete_recipes': len(complete),
        'incomplete_recipes': len(evaluated) - len(complete), 'complete_recipe_titles': [r['title'] for r in complete],
        'equipment_role_records': len(payload['equipment-role-updates.json']), 'runtime_applied': False,
        'concepts_merged': 0, 'source_candidates_not_bound': len(decisions)}
    payload.update({'summary.json': summary, 'nutrition-profiles.json': profiles, 'recipe-nutrition.json': evaluated,
        'recipe-inputs.json': [m for m in methods if m['source_method_id'].startswith('DDD-R-')],
        'recipe-weighing-contracts.json': contracts, 'matching-decisions.json': decisions, 'tfda-selected-records.json': selected,
        'source.lock.json': {'tfda_sha256': TFDA_SHA, 'tfda_url': TFDA_URL,
            'tfda_download_url': 'https://data.fda.gov.tw/data/opendata/export/20/json', 'parent_files': locks}})
    output.mkdir(parents=True)
    for name, value in payload.items():
        (output / name).write_bytes(encoded(value))
    for script in ['enrich_next.py', 'enrich_core.py']:
        (output / script).write_bytes(Path(__file__).with_name(script).read_bytes())
    (output / 'REPORT.md').write_text(f'# 第二批营养补充\n\n共 {len(profiles)} 个形态样品参考、20 道家常菜评估，{len(complete)} 道具备四项主要营养的整份/每份估算，12 道保留具体缺项。\n\n新增干紫菜、干面条、米醋、全脂鲜乳参考。米醋缺蛋白质与脂肪，牛奶毫升用量未作无依据换算。5 个近似样品保留不绑定决定及原始依据。同名概念 11 组继续保留 ID，未强行合并。\n\n'+DISCLOSURE+'\n\n称量和样品选择属于本版本项目假设，原方数值未修改；所有参考配方仍不参加自动配餐。\n\n来源：[TFDA 食品营养成分资料集](https://data.gov.tw/dataset/8543)，政府資料開放授權條款-第1版；USDA 来源及快照见来源锁文件。\n', encoding='utf8')
    (output / 'manifest.json').write_bytes(encoded({f.name: sha(f.read_bytes()) for f in sorted(output.iterdir())}))
    with zipfile.ZipFile(output / (VERSION + '.zip'), 'w') as z:
        for f in sorted(output.iterdir()):
            if f.suffix != '.zip':
                info = zipfile.ZipInfo(f.name, (2026, 9, 15, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, f.read_bytes())
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['base', 'previous', 'tfda', 'output']:
        parser.add_argument(name)
    args = parser.parse_args()
    print(json.dumps(build(args.base, args.previous, args.tfda, args.output), ensure_ascii=False, indent=2))
