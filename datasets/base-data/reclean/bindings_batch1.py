"""Generate conditional reference bindings; never modify runtime or baseline."""
import argparse
import hashlib
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ASSESSMENT_SHA = 'a06d04a43e99b27139e277ccb8c3c4bd6ba8587deb38c5f6be68fb9f1dc256c6'
TFDA_SHA = 'c1ef5502ceceead6d5ce3b7ee21fe544702b1e508be73b196fce2cf0e61985cb'
VERSION = 'nutrition-bindings-batch1'
# Explicit food/state decisions, not an automatically approved name match.
APPROVED = {
    '方糖': ('N0100101', '纯糖块，未混入奶、香料或其他配料', 'source_sugar_cube'),
    '姜粉': ('P0102001', '姜制干粉，非加盐或混合调味粉', 'source_ginger_powder'),
    '猪油': ('M0200101', '纯猪油；不含猪油渣，不使用煎炸后吸水混合物', 'source_pure_lard'),
    '低筋面粉': ('A0320202', '低筋小麦面粉，未加水、未烹调', 'source_low_gluten_flour'),
    '白胡椒粉': ('P0101101', '白胡椒干粉，非混合椒盐', 'source_white_pepper_powder'),
    '高筋面粉': ('A0320404', '高筋小麦面粉，未加水、未烹调', 'source_high_gluten_flour'),
    '冰糖': ('N0100201', '蔗糖制冰糖，非糖浆或复配糖', 'source_rock_sugar'),
    '中筋面粉': ('A0320301', '中筋小麦面粉，未加水、未烹调', 'source_medium_gluten_flour'),
    '辣椒粉': ('P0101801', '单一辣椒干粉，非复配蘸料或辣椒油', 'source_chili_powder'),
    '姜黄粉': ('P0101901', '姜黄干粉，非咖喱混合粉', 'source_turmeric_powder'),
    '黑胡椒粉': ('P0101301', '黑胡椒干粉，非混合椒盐', 'source_black_pepper_powder'),
    '蒜粉': ('P0101701', '蒜制干粉，非蒜盐或鲜蒜泥', 'source_garlic_powder'),
    '越光米': ('A0500301', '越光品种白粳米，未煮熟；不得套用熟米饭', 'source_uncooked_koshihikari'),
    '亚麻仁油': ('M1400101', '冷压亚麻籽油，非调和油', 'source_cold_pressed_flaxseed_oil'),
}
REJECT = {
    '鸡精': '来源是瓶装鸡精饮品，与菜谱调味鸡精身份不同',
    '孜然粉': '来源是小茴香粉，不能据别名将其等同孜然粉',
    '红枣': '来源样品为绿皮带红鲜枣，不能用于未区分干鲜的红枣',
    '小龙虾': '来源为相模后海螯虾，不能据俗名绑定通用小龙虾',
    '腰子': '来源明确为猪肾，目录未限定动物种属',
    '青辣椒': '来源为青皮甜椒，未确认是同一椒类',
    '洋葱粉': '来源配料含盐，不能作为通用纯洋葱粉',
}
CORE = {'熱量': 'kcal', '粗蛋白': 'g', '粗脂肪': 'g', '總碳水化合物': 'g', '鈉': 'mg'}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def encoded(x):
    return (json.dumps(x, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def parse(raw):
    text = '' if raw is None else str(raw).strip()
    if text in {'', '—', '-'}:
        return None, 'missing'
    if text.lower() == 'tr':
        return None, 'trace'
    if re.fullmatch(r'\d+(?:\.\d+)?', text):
        return float(text), 'source_reported_numeric'
    return None, 'non_scalar_preserved'


def build(assessment, source, output):
    if output.exists():
        raise FileExistsError(output)
    if sha(assessment.read_bytes()) != ASSESSMENT_SHA or sha(source.read_bytes()) != TFDA_SHA:
        raise ValueError('Input SHA mismatch')
    with zipfile.ZipFile(assessment) as z:
        mappings = json.loads(z.read('ingredient-matches.json'))
        issues = json.loads(z.read('source-anomalies.json'))
        differences = json.loads(z.read('nutrient-difference-signals.json'))
        refs = {r['id']: r for r in json.loads(z.read('source-reference.json'))}
    flagged = {r['id'] for r in issues} | {r['tfda_id'] for r in differences}
    with zipfile.ZipFile(source) as z:
        source_file = z.namelist()[0]
        rows = json.loads(z.read(source_file).decode('utf-8-sig'))
    grouped = defaultdict(list)
    for position, row in enumerate(rows):
        grouped[row['整合編號']].append((position, row))
    decisions, bindings, observations, raw_selected = [], [], [], []
    for m in mappings:
        if len(m['candidates']) != 1:
            continue
        sid = m['candidates'][0]
        ref = refs[sid]
        d = {'ingredient_id': m['ingredient_id'], 'ingredient_name': m['name'], 'source_food_id': sid,
             'source_name': ref['name'], 'source_description': ref['description'], 'status': 'deferred',
             'reason': '样品品种、加工配方或含水状态尚未确认；未达到首批明确形态标准'}
        if not sid.startswith('TFDA:'):
            d['reason'] = '大陆来源授权及测量基准待确认；本批仅审核台湾来源'
        elif m['name'] in REJECT:
            d.update(status='rejected_candidate', reason=REJECT[m['name']])
        elif sid in flagged:
            d['reason'] = '第二轮存在来源异常或跨来源差异线索，暂缓绑定'
        elif m['name'] in APPROVED:
            code, scope, scope_key = APPROVED[m['name']]
            if sid != 'TFDA:' + code:
                raise ValueError('Explicit identity decision no longer matches')
            selected = grouped[code]
            if sha(encoded([r for _, r in selected])) != ref['record_sha256']:
                raise ValueError('Source record fingerprint mismatch')
            nutrient_ids = []
            core_values = {}
            seen = set()
            for pos, row in selected:
                field, unit = row['分析項'], row['含量單位']
                if field in seen:
                    raise ValueError('Duplicate nutrient key')
                seen.add(field)
                value, status = parse(row['每100克含量'])
                oid = f'TFDA-OBS:{code}:{pos}'
                observations.append({'id': oid, 'food_id': sid, 'nutrient_name': field,
                                     'amount': value, 'unit': unit, 'status': status,
                                     'raw_amount': row['每100克含量'], 'sample_count_raw': row['樣本數'],
                                     'standard_deviation_raw': row['標準差'],
                                     'basis': 'per_100_g_source_prepared_sample',
                                     'basis_source_field': '每100克含量',
                                     'source_file': source_file, 'source_position': pos,
                                     'source_row_sha256': sha(encoded(row))})
                nutrient_ids.append(oid)
                raw_selected.append({'source_position': pos, 'row': row})
                if field in CORE:
                    if unit != CORE[field]:
                        raise ValueError('Core nutrient unit mismatch')
                    core_values[field] = value
            if set(core_values) != set(CORE):
                raise ValueError('Missing core field rows')
            bid = 'TFDA-BIND:' + m['ingredient_id']
            bindings.append({'id': bid, 'ingredient_id': m['ingredient_id'], 'ingredient_name': m['name'],
                             'source_food_id': sid, 'source_name': ref['name'],
                             'binding_status': 'approved_conditional_reference',
                             'review_method': 'assistant_review_of_frozen_sample_description_and_explicit_allowlist',
                             'professional_review_performed': False,
                             'scope': scope, 'scope_key': scope_key,
                             'requires_explicit_scope_confirmation': True,
                             'basis': 'per_100_g_source_prepared_sample',
                             'sample_description': ref['description'],
                             'reference_kind': 'regional_sample_estimate_not_brand_measurement',
                             'observation_ids': nutrient_ids, 'core_nutrients': core_values,
                             'core_complete': all(x is not None for x in core_values.values()),
                             'automatic_runtime_binding': False,
                             'gross_weight_conversion_allowed': False,
                             'cooked_weight_conversion_allowed': False})
            d.update(status='approved_conditional_reference', reason=scope, binding_id=bid)
        decisions.append(d)
    assert len(decisions) == 150
    assert {b['ingredient_name'] for b in bindings} == set(APPROVED)
    assert len({b['ingredient_id'] for b in bindings}) == len(bindings)
    summary = {'version': VERSION, 'single_candidates_reviewed': len(decisions),
               'decision_counts': dict(Counter(d['status'] for d in decisions)),
               'conditional_bindings': len(bindings), 'core_complete_bindings': sum(b['core_complete'] for b in bindings),
               'observation_rows': len(observations), 'value_statuses': dict(Counter(o['status'] for o in observations)),
               'database_modified': False, 'baseline_modified': False, 'runtime_bindings_applied': 0}
    output.mkdir(parents=True)
    for name, data in {'summary.json': summary, 'bindings.json': bindings, 'observations.json': observations,
                       'review-decisions.json': decisions, 'source-rows.json': raw_selected,
                       'sources.lock.json': {'assessment_sha256': ASSESSMENT_SHA, 'tfda_zip_sha256': TFDA_SHA,
                                             'dataset_url': 'https://data.gov.tw/dataset/8543', 'license_url': 'https://data.gov.tw/license'}}.items():
        (output / name).write_bytes(encoded(data))
    lines = ['# 首批营养参考绑定清单', '',
             f'已生成 {len(bindings)} 条有适用条件的来源绑定，其中 {sum(b["core_complete"] for b in bindings)} 条具备本批五项核心值（热量、粗蛋白、粗脂肪、总碳水、钠）。', '',
             '这些是地区样品参考值，不是品牌实测值；生成清单不等于已写入数据库。', '',
             '| 食材 | 来源编号 | 适用条件 | 五项核心值完整 |', '|---|---|---|---|']
    for b in bindings:
        lines.append(f'| {b["ingredient_name"]} | {b["source_food_id"]} | {b["scope"]} | {"是" if b["core_complete"] else "否，缺项保留为空"} |')
    lines += ['', '## 如何使用', '',
              '1. bindings.json 是食材 ID 到来源食品 ID 的明确关系。系统接入时必须确认 scope_key 对应的形态；未确认不得自动选用。',
              '2. observations.json 保留来源营养素名称、单位、每100克原值、样本数及标准差，不把粗蛋白等字段静默改名。',
              '3. 基准严格记为每100克来源前处理样品；不把购买毛重、毫升、熟食重量自动换算为该基准。',
              '4. 缺项不当零，部分营养值也不能汇总为完整总量；source-rows.json 可逐行核验。',
              '5. review-decisions.json 覆盖全部150条单一候选，列出暂缓和拒绝原因；其余108条多候选仍沿用第二轮待复核状态。', '',
              '## 已拒绝的同名候选', '']
    lines.extend(f'- {d["ingredient_name"]}：{d["reason"]}。' for d in decisions if d['status'] == 'rejected_candidate')
    lines += ['', '## 验证和限制', '',
              '基于固定版本样品描述、第二轮异常清单及明确白名单审核；不是营养师复核或厨房实测。样品描述未列明的品牌配方和工艺不推断。',
              '完整性检查包含输入SHA256、来源行指纹、唯一营养字段、核心单位、150条决策覆盖及ZIP内部哈希。',
              'source-rows.json 是官方开放数据的选定行；其 source_position 为原JSON零基序号。未修改rc.2或USDA记录。', '',
              '## 来源署名', '',
              '衛生福利部食品藥物管理署，2026年下载快照，《食品營養成分資料集》（数据集8543）。',
              '数据集：https://data.gov.tw/dataset/8543 。依政府資料開放授權條款－第1版使用：https://data.gov.tw/license 。',
              '本衍生清单增加身份筛选、状态条件、数值解析和出处指纹；原始数值未修改，不代表来源机构认可本应用。', '',
              '## 复现', '',
              '在仓库根目录运行：python datasets/base-data/reclean/bindings_batch1.py --output artifacts/base-data/bindings-reproduced',
              '需要本地固定版本评估ZIP与TFDA ZIP；脚本拒绝版本不符和覆盖已有输出。']
    (output / 'REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (output / 'bindings_batch1.py').write_bytes(Path(__file__).read_bytes())
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
    (output / (target.name + '.sha256')).write_text(sha(target.read_bytes()) + '\n')
    return summary


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--assessment', type=Path, default=Path('artifacts/base-data/round2-assessment-1/round2-assessment-1.zip'))
    p.add_argument('--source', type=Path, default=Path('.cache/base-data-sources/round2/tfda.zip'))
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(build(a.assessment, a.source, a.output), ensure_ascii=False))
