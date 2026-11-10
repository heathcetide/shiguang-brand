"""Frequency-prioritized, explicitly scoped TFDA reference options."""
import argparse
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from bindings_batch1 import sha, encoded, parse, CORE, TFDA_SHA, ASSESSMENT_SHA, REJECT

BASELINE_SHA = '037cc5a46b64125bf613aaf720aa55d99df2614f864ed63e65087a0c5edaad7c'
VERSION = 'nutrition-bindings-batch2'
# Explicit identity decisions. Multiple rows are alternatives, never averaged.
RULES = [
    ('DDD-I-egg', '鸡蛋', 'K01001', '去壳生全鸡蛋；按可用蛋液克重，非带壳重量、蛋黄、蛋白或熟蛋'),
    ('DDD-I-ginger', '生姜', 'E1900101', '生嫩姜；非老姜、姜粉或腌姜'),
    ('DDD-I-ginger', '生姜', 'E1900102', '生粉姜样品；非姜粉，需明确所选姜类型'),
    ('DDD-I-ginger', '生姜', 'E1900103', '生老姜；非嫩姜、姜粉或腌姜'),
    ('DDD-I-onion', '洋葱', 'E2400101', '生白洋葱，去根及外皮'),
    ('DDD-I-onion', '洋葱', 'E2400201', '生紫洋葱，去根及外皮'),
    ('DDD-I-onion', '洋葱', 'E2400301', '生黄洋葱，去根及外皮'),
    ('DDD-I-tomato', '番茄', 'E74001', '生红色系大番茄，去蒂；非小番茄或番茄制品'),
    ('DDD-I-carrot', '胡萝卜', 'E0200101', '生胡萝卜，去蒂及皮'),
    ('DDD-I-potato', '马铃薯', 'B0700201', '生黄皮马铃薯，去皮；非花生、熟土豆或脱水土豆'),
    ('DDD-I-SRC-9d1e11e8cba926ec', '香菜', 'E4000101', '生芫荽，去根部'),
    ('DDD-I-spinach', '菠菜', 'E5000101', '生菠菜，去根部'),
    ('DDD-I-SRC-ca90ce4930a1fb8e', '青椒', 'E75001', '生青皮甜椒，去蒂及籽；非辣味青辣椒'),
    ('DDD-I-eggplant', '茄子', 'E7300101', '生长茄子，去蒂'),
    ('DDD-I-eggplant', '茄子', 'E7300201', '生圆茄子，去蒂'),
    ('DDD-I-SRC-b892a42b9695881d', '牛奶', 'L01021', '全脂鲜乳，脂肪3.0至3.8%；非脱脂奶、奶粉或调制乳'),
    ('DDD-I-SRC-f2085535c5a5a860', '大葱', 'E2300102', '生山东大葱，去根、叶尾与外叶；仅适用于该类型参考'),
    ('WD-Q1760637', '八角', 'P0100101', '八角香辛料固体样品；非卤汁、浸泡液或五香粉'),
    ('DDD-I-SRC-e343a434416e3369', '白萝卜', 'E0400101', '生白皮白肉萝卜，去蒂及皮'),
    ('DDD-I-SRC-34a0cf8d3ca2fcec', '蟹味菇', 'G1900101', '生鸿喜菇，去菌柄基部'),
    ('DDD-I-R1-f7d591fa1f560119', '白玉菇', 'G1900201', '生鸿喜菇白变种，去菌柄基部'),
    ('DDD-I-R1-86f2fb88c5b3d5ce', '茭白', 'E1300101', '生茭白笋，去壳'),
    ('DDD-I-SRC-e9e73aa2dd8c70bc', '红豆', 'H0405101', '干红豆原粒，非鲜豆、泡发豆、熟豆或蜜豆'),
    ('DDD-I-SRC-0a20942cfb4ce796', '绿豆', 'H0705102', '干绿豆原粒，非泡发豆、熟豆或豆芽'),
]


def validate(rows, ingredients, refs, flagged):
    pairs = set()
    for iid, name, code, scope in rows:
        if ingredients[iid]['name'] != name or not scope:
            raise ValueError('Identity rule mismatch')
        sid = 'TFDA:' + code
        if sid not in refs or sid in flagged:
            raise ValueError('Missing or flagged source')
        if (iid, sid) in pairs:
            raise ValueError('Duplicate option')
        if name in REJECT:
            raise ValueError('Rejected identity reused')
        pairs.add((iid, sid))


def build(output):
    if output.exists():
        raise FileExistsError(output)
    root = Path('artifacts/base-data')
    baseline = root / '0.2.0-rc.2/dietdigidose-base-data-0.2.0-rc.2.zip'
    assessment = root / 'round2-assessment-1/round2-assessment-1.zip'
    source = Path('.cache/base-data-sources/round2/tfda.zip')
    for path, expected in [(baseline, BASELINE_SHA), (assessment, ASSESSMENT_SHA), (source, TFDA_SHA)]:
        if sha(path.read_bytes()) != expected:
            raise ValueError('Input fingerprint mismatch')
    batch1 = root / 'nutrition-bindings-batch1/nutrition-bindings-batch1.zip'
    if sha(batch1.read_bytes()) != 'c02fa82511ef45c2e3f5c51c08f5337bf8c1a425458dd51c8e42c1898dea34c9':
        raise ValueError('Batch1 fingerprint mismatch')
    with zipfile.ZipFile(batch1) as z:
        manifest = json.loads(z.read('manifest.json'))
        assert all(sha(z.read(n)) == h for n, h in manifest.items())
        old = json.loads(z.read('bindings.json'))
    with zipfile.ZipFile(baseline) as z:
        ingredients = {x['id']: x for x in json.loads(z.read('clean/ingredients.json'))}
        recipes = json.loads(z.read('clean/recipes.json'))
    with zipfile.ZipFile(assessment) as z:
        refs = {x['id']: x for x in json.loads(z.read('source-reference.json'))}
        matches = {x['ingredient_id']: x for x in json.loads(z.read('ingredient-matches.json'))}
        anomalies = json.loads(z.read('source-anomalies.json'))
        diffs = json.loads(z.read('nutrient-difference-signals.json'))
    flagged = {x['id'] for x in anomalies} | {x['tfda_id'] for x in diffs}
    validate(RULES, ingredients, refs, flagged)
    with zipfile.ZipFile(source) as z:
        source_file = z.namelist()[0]
        all_rows = json.loads(z.read(source_file).decode('utf-8-sig'))
    groups = defaultdict(list)
    for pos, row in enumerate(all_rows):
        groups[row['整合編號']].append((pos, row))
    usage = defaultdict(set)
    line_counts = Counter()
    for recipe in recipes:
        for line in recipe['ingredients']:
            iid = line.get('ingredient_id')
            if iid:
                usage[iid].add(recipe['id']); line_counts[iid] += 1
    count_options = Counter(r[0] for r in RULES)
    bindings, obs, selected, decisions = [], [], [], []
    for iid, name, code, scope in RULES:
        sid = 'TFDA:' + code
        rows = groups[code]
        if sha(encoded([r for _, r in rows])) != refs[sid]['record_sha256']:
            raise ValueError('Source record fingerprint mismatch')
        core = {}; oids = []; seen = set()
        for pos, row in rows:
            field = row['分析項']
            if field in seen:
                raise ValueError('Duplicate nutrient')
            seen.add(field)
            amount, status = parse(row['每100克含量'])
            oid = f'TFDA-OBS:{code}:{pos}'
            obs.append({'id': oid, 'food_id': sid, 'nutrient_name': field, 'amount': amount,
                        'raw_amount': row['每100克含量'], 'unit': row['含量單位'], 'status': status,
                        'basis': 'per_100_g_source_prepared_sample', 'sample_count_raw': row['樣本數'],
                        'standard_deviation_raw': row['標準差'], 'source_file': source_file,
                        'source_position': pos, 'source_row_sha256': sha(encoded(row))})
            selected.append({'source_position': pos, 'row': row}); oids.append(oid)
            if field in CORE:
                if row['含量單位'] != CORE[field]:
                    raise ValueError('Unit mismatch')
                core[field] = amount
        if set(core) != set(CORE):
            raise ValueError('Missing core field')
        bindings.append({'id': f'TFDA-BIND2:{iid}:{code}', 'ingredient_id': iid, 'ingredient_name': name,
                         'source_food_id': sid, 'source_name': refs[sid]['name'],
                         'sample_description': refs[sid]['description'], 'scope': scope, 'scope_key': code,
                         'binding_status': 'approved_conditional_reference',
                         'selection_group': iid, 'selection_rule': 'exactly_one_matching_scope_or_none',
                         'alternative_count': count_options[iid], 'default_selected': False,
                         'requires_explicit_scope_confirmation': True, 'automatic_runtime_binding': False,
                         'gross_weight_conversion_allowed': False, 'cooked_weight_conversion_allowed': False,
                         'basis': 'per_100_g_source_prepared_sample', 'observation_ids': oids,
                         'core_nutrients': core, 'core_complete': all(v is not None for v in core.values()),
                         'recipe_reference_count': len(usage[iid]), 'ingredient_line_count': line_counts[iid],
                         'review_method': 'assistant_explicit_identity_and_sample_description_review',
                         'professional_review_performed': False})
        decisions.append({'ingredient_id': iid, 'source_id': sid, 'scope': scope,
                          'original_candidate': sid in matches[iid]['candidates'],
                          'decision': 'conditional_option', 'reason': '明确食物及前处理范围；多类型保留独立选择，不默认套用'})
    added_ids = {b['ingredient_id'] for b in bindings}; old_ids = {b['ingredient_id'] for b in old}
    assert not (added_ids & old_ids)
    rejection = []
    for iid, prefix, reason in [('DDD-I-potato', 'TFDA:C17', '地区俗名土豆冲突：花生不是马铃薯'),
                                ('DDD-I-cucumber', 'TFDA:J04', '地区俗名冲突：黄鱼不是黄瓜')]:
        for sid in matches[iid]['candidates']:
            if sid.startswith(prefix):
                rejection.append({'ingredient_id': iid, 'source_id': sid, 'source_name': refs[sid]['name'], 'reason': reason})
    priority = []
    for iid, i in ingredients.items():
        if iid in added_ids | old_ids:
            continue
        reason = REJECT.get(i['name'], '需确认具体品种、状态或配方，尚无审定来源')
        if iid == 'DDD-I-garlic':
            reason = 'TFDA将样品标为乾貨；需核实指成熟鲜蒜还是脱水蒜，不自动解释'
        elif iid == 'DDD-I-salt':
            reason = '找到岩盐和低钠盐，不能作为通用食盐默认值'
        priority.append({'ingredient_id': iid, 'name': i['name'], 'recipe_reference_count': len(usage[iid]),
                         'ingredient_line_count': line_counts[iid], 'candidate_ids': matches[iid]['candidates'], 'reason': reason})
    priority.sort(key=lambda x: (-x['recipe_reference_count'], -x['ingredient_line_count'], x['ingredient_id']))
    potential = set().union(*(usage[iid] for iid in added_ids))
    old_potential = set().union(*(usage[iid] for iid in old_ids))
    summary = {'version': VERSION, 'new_ingredient_ids': len(added_ids), 'binding_options': len(bindings),
               'cumulative_ingredient_ids': len(added_ids | old_ids), 'cumulative_binding_options': len(old) + len(bindings),
               'core_complete_options': sum(b['core_complete'] for b in bindings), 'observations': len(obs),
               'potential_recipe_references': len(potential), 'additional_potential_recipes_vs_batch1': len(potential - old_potential),
               'actual_recipe_nutrition_calculations': 0, 'remaining_ingredients': len(priority),
               'rejected_regional_alias_pairs': len(rejection), 'runtime_bindings_applied': 0}
    output.mkdir(parents=True)
    files = {'summary.json': summary, 'bindings.json': bindings, 'observations.json': obs,
             'source-rows.json': selected, 'review-decisions.json': decisions, 'rejected-aliases.json': rejection,
             'remaining-priority.json': priority,
             'sources.lock.json': {'baseline_sha256': BASELINE_SHA, 'assessment_sha256': ASSESSMENT_SHA,
                                   'tfda_sha256': TFDA_SHA, 'batch1_sha256': sha(batch1.read_bytes()),
                                   'source_url': 'https://data.gov.tw/dataset/8543', 'license_url': 'https://data.gov.tw/license'}}
    for n, data in files.items():
        (output / n).write_bytes(encoded(data))
    lines = ['# 第二批营养参考绑定', '',
             f'新增{len(added_ids)}种食材、{len(bindings)}个有条件来源选项；累计{len(added_ids | old_ids)}种食材。', '',
             f'这些食材出现在{len(potential)}道菜谱中，比第一批的潜在涉及范围新增{len(potential-old_potential)}道。该数字仅是引用范围，不是营养计算完成量。', '',
             '| 食材 | 菜谱引用数 | 来源样品 | 适用条件 |', '|---|---:|---|---|']
    for b in sorted(bindings, key=lambda b: (-b['recipe_reference_count'], b['ingredient_id'], b['source_food_id'])):
        lines.append(f'| {b["ingredient_name"]} | {b["recipe_reference_count"]} | {b["source_name"]} ({b["source_food_id"]}) | {b["scope"]} |')
    lines += ['', '## 使用条件', '',
              '每个食材选择一个符合样品状态的来源，或不选择。嫩姜/粉姜/老姜、不同颜色洋葱、长茄/圆茄不能平均或相加。',
              '粉姜是生姜样品名称，不是姜粉。鸡蛋平均值为生全蛋，不用于熟蛋或带壳重量。',
              '所有数值以每100克来源前处理样品为基准；称重必须符合去皮、去壳、去根等条件。没有自动毛重转换、烹调损耗或份量推算。',
              '原始缺项、单位、样本数及标准差保留。核心值完整不等于全营养素完整。不同地区及品种仅作明确所选样品的参考。',
              '审核为助手依据固定样品描述作出的身份与范围判断，未进行营养师审核或厨房实测；仍不写入系统，不更改rc.2或第一批。', '',
              '## 剩余优先项', '', '| 食材 | 菜谱引用数 | 原因 |', '|---|---:|---|']
    for p in priority[:15]:
        lines.append(f'| {p["name"]} | {p["recipe_reference_count"]} | {p["reason"]} |')
    lines += ['', '全部剩余食材见 remaining-priority.json；地区别名错配见 rejected-aliases.json。', '',
              '## 来源与复现', '',
              '衛生福利部食品藥物管理署，2026年下载快照，《食品營養成分資料集》（8543）：https://data.gov.tw/dataset/8543 。',
              '依政府資料開放授權條款－第1版使用：https://data.gov.tw/license 。本衍生清单增加选择条件和解析字段，原始数值未修改；不代表来源机构认可本应用。',
              '仓库根目录执行 python datasets/base-data/reclean/bindings_batch2.py --output artifacts/base-data/batch2-reproduced。',
              '需要固定评估、rc.2、第一批及TFDA缓存。脚本包依赖同目录的bindings_batch1.py辅助函数。']
    (output / 'REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    for name in ['bindings_batch2.py', 'bindings_batch1.py']:
        (output / name).write_bytes((Path(__file__).parent / name).read_bytes())
    manifest = {p.name: sha(p.read_bytes()) for p in sorted(output.iterdir())}
    (output / 'manifest.json').write_bytes(encoded(manifest))
    target = output / (VERSION + '.zip')
    with zipfile.ZipFile(target, 'w') as z:
        for p in sorted(output.iterdir()):
            if p == target:
                continue
            info = zipfile.ZipInfo(p.name, (2026, 9, 15, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        assert all(sha(z.read(n)) == h for n, h in manifest.items())
    (output / (VERSION + '.zip.sha256')).write_text(sha(target.read_bytes()) + '\n')
    return summary


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output', type=Path, required=True)
    print(json.dumps(build(p.parse_args().output), ensure_ascii=False))
