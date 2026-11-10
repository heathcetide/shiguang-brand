"""Read-only Chinese source screening. No runtime data or nutrition promotion."""
import argparse
import hashlib
import json
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

try:
    from reclean.chinese import simplify as simplify_characters
except ModuleNotFoundError:
    from chinese import simplify as simplify_characters

VERSION = 'round2-assessment-1'
BASELINE_SHA = '037cc5a46b64125bf613aaf720aa55d99df2614f864ed63e65087a0c5edaad7c'
SOURCE_HASHES = {'sanotsu': 'ea041186cf4aa3428f7aadfa8f28a5889a56185c25b2eca419790c7b3b33f906',
                 'tfda': 'c1ef5502ceceead6d5ce3b7ee21fe544702b1e508be73b196fce2cf0e61985cb'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def simplify(value):
    """Convert characters consistently without removing preparation qualifiers."""
    return simplify_characters(unicodedata.normalize('NFKC', value or ''))


def key(value):
    return re.sub(r'\s+', '', simplify(value)).casefold()


def number(value):
    if value is None or not str(value).strip() or str(value).strip() in {'—', '-', '--'}:
        return None, 'missing'
    value = str(value).strip()
    if value.lower() == 'tr':
        return None, 'trace'
    if re.fullmatch(r'\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?){2}', value):
        return None, 'ratio'
    if not re.fullmatch(r'\d+(?:\.\d+)?', value):
        return None, 'unparsed'
    return float(value), 'numeric'


def names(name, aliases=()):
    return {key(s) for s in [name, *aliases] if s and key(s)}


def source_names(name, aliases=()):
    result = names(name, aliases)
    # Square brackets are explicit alternate names, parentheses remain states.
    for s in re.findall(r'[\[［]([^\]］]+)[\]］]', name):
        result.update(names('', re.split(r'[,，、;；]', s)))
    base = re.sub(r'[\[［][^\]］]+[\]］]', '', name).strip()
    result.add(key(base))
    return result - {''}


def read_sources(cache):
    records, anomalies, states = [], [], Counter()
    z = zipfile.ZipFile(cache / 'sanotsu.zip')
    paths = sorted(n for n in z.namelist() if '/json_data_v3_20260825_qwen38max_kimi_k3_fixed_en/merged_' in n and n.endswith('.json'))
    assert len(paths) == 61, len(paths)
    for path in paths:
        for pos, row in enumerate(json.loads(z.read(path))):
            rid = 'CN6:' + row['foodCode']
            for k, v in row.items():
                if k not in {'foodCode', 'foodName', 'englishName', 'remark'}:
                    _, status = number(v); states['CN6:' + status] += 1
                    if status == 'unparsed':
                        anomalies.append({'id': rid, 'type': 'unparsed_nutrient_value', 'field': k, 'raw_value': v, 'source_file': path, 'source_position': pos})
            kcal, _ = number(row['energyKCal']); kj, _ = number(row['energyKJ'])
            if kcal is not None and kj is not None and abs(kj - kcal * 4.184) > max(10, kcal * 4.184 * .1):
                anomalies.append({'id': rid, 'type': 'energy_unit_discrepancy', 'field': ['energyKCal', 'energyKJ'], 'action': 'review_source_no_correction'})
            parts = [number(row[k])[0] for k in ['water', 'protein', 'fat', 'CHO', 'ash']]
            if all(v is not None for v in parts) and sum(parts) > 105:
                anomalies.append({'id': rid, 'type': 'proximate_sum_over_105', 'action': 'review_definitions_and_source_no_correction'})
            records.append({'id': rid, 'source': 'CN6', 'name': row['foodName'], 'aliases': [], 'names': sorted(source_names(row['foodName'])),
                            'description': row.get('remark', ''), 'source_file': path, 'source_position': pos,
                            'record_sha256': sha(encode(row)), 'raw': row})
    assert len(records) == 1677
    z = zipfile.ZipFile(cache / 'tfda.zip')
    paths = [n for n in z.namelist() if n.endswith('.json')]
    assert len(paths) == 1
    rows = json.loads(z.read(paths[0]).decode('utf-8-sig'))
    grouped = defaultdict(list)
    for pos, row in enumerate(rows):
        grouped[row['整合編號']].append((pos, row))
        _, status = number(row['每100克含量']); states['TFDA:' + status] += 1
        if status == 'unparsed':
            anomalies.append({'id': 'TFDA:' + row['整合編號'], 'type': 'unparsed_nutrient_value', 'field': row['分析項'], 'raw_value': row['每100克含量'], 'source_position': pos})
    duplicates = []
    for code, items in sorted(grouped.items()):
        row = items[0][1]
        aliases = re.split(r'[,，;；、]', row.get('俗名') or '')
        obs = defaultdict(list)
        for pos, r in items:
            obs[r['分析項']].append({'raw_amount': r['每100克含量'], 'unit': r['含量單位'], 'position': pos, 'sample_count': r['樣本數']})
        for nutrient, vals in obs.items():
            if len(vals) > 1:
                duplicates.append({'id': 'TFDA:' + code, 'nutrient': nutrient, 'rows': len(vals), 'positions': [v['position'] for v in vals]})
        metadata_fields = ['樣品名稱', '俗名', '內容物描述', '廢棄率']
        for f in metadata_fields:
            if len({r[f] for _, r in items}) > 1:
                anomalies.append({'id': 'TFDA:' + code, 'type': 'metadata_disagreement', 'field': f})
        records.append({'id': 'TFDA:' + code, 'source': 'TFDA', 'name': row['樣品名稱'], 'aliases': aliases,
                        'names': sorted(source_names(row['樣品名稱'], aliases)), 'description': row.get('內容物描述'),
                        'source_file': paths[0], 'source_positions': [p for p, _ in items],
                        'record_sha256': sha(encode([r for _, r in items])), 'observations': obs})
    ids = Counter(r['id'] for r in records)
    if any(n > 1 for n in ids.values()):
        raise ValueError('Duplicate source record IDs')
    return records, anomalies, duplicates, dict(states), len(rows)


def match(ingredients, records):
    index = defaultdict(set)
    for r in records:
        for n in r['names']:
            index[n].add(r['id'])
    matches = []
    for i in ingredients:
        ns = names(i['name'], i.get('aliases', []))
        candidates = sorted(set().union(*(index[n] for n in ns)))
        matches.append({'ingredient_id': i['id'], 'name': i['name'], 'status': 'unmatched' if not candidates else 'single_name_candidate' if len(candidates) == 1 else 'multiple_name_candidates',
                        'candidates': candidates, 'evidence': {r: sorted(n for n in ns if r in index[n]) for r in candidates},
                        'approved_nutrition_mapping': False, 'state_review_required': bool(candidates)})
    return matches, index


def differences(records, index):
    byid = {r['id']: r for r in records}
    pairs = set()
    for ids in index.values():
        for a in ids:
            for b in ids:
                if a.startswith('CN6:') and b.startswith('TFDA:'):
                    pairs.add((a, b))
    results = []
    # Screening only: common field labels; basis and method not yet harmonized.
    fields = [('energyKCal', '熱量', 'kcal', 20), ('protein', '粗蛋白', 'g', 2), ('fat', '粗脂肪', 'g', 2)]
    for a, b in sorted(pairs):
        ca, tb = byid[a], byid[b]
        for cn, tw, unit, floor in fields:
            av, _ = number(ca['raw'][cn]); obs = tb['observations'].get(tw, [])
            if len(obs) != 1 or obs[0]['unit'] != unit:
                continue
            bv, _ = number(obs[0]['raw_amount'])
            if av is None or bv is None:
                continue
            delta = abs(av - bv)
            if delta > max(floor, max(av, bv) * .3):
                results.append({'cn_id': a, 'tfda_id': b, 'cn_name': ca['name'], 'tfda_name': tb['name'],
                                'cn_field': cn, 'tfda_field': tw, 'nominal_unit': unit,
                                'relative_difference': round(delta / max(av, bv), 4),
                                'status': 'screening_signal_not_confirmed_conflict',
                                'reason': 'name_match_only; food_state_edible_basis_and_methods_not_harmonized'})
    return results, len(pairs)


def build(cache, baseline, output):
    if output.exists():
        raise FileExistsError(output)
    if sha(baseline.read_bytes()) != BASELINE_SHA:
        raise ValueError('Baseline SHA mismatch')
    for source, expected in SOURCE_HASHES.items():
        if sha((cache / (source + '.zip')).read_bytes()) != expected:
            raise ValueError('Source SHA mismatch: ' + source)
    with zipfile.ZipFile(baseline) as z:
        ingredients = json.loads(z.read('clean/ingredients.json'))
    assert len(ingredients) == 984
    records, anomalies, duplicates, states, row_count = read_sources(cache)
    mappings, index = match(ingredients, records)
    diffs, pair_count = differences(records, index)
    linked = set(c for m in mappings for c in m['candidates'])
    coverage = {s: sum(any(c.startswith(s + ':') for c in m['candidates']) for m in mappings) for s in ['CN6', 'TFDA']}
    both = sum(all(any(c.startswith(s + ':') for c in m['candidates']) for s in ['CN6', 'TFDA']) for m in mappings)
    collisions = [{'normalized_name': n, 'record_ids': sorted(ids)} for n, ids in sorted(index.items()) if len(ids) > 1]
    compact = [{k: v for k, v in r.items() if k not in {'raw', 'observations', 'source_positions'}} for r in records]
    # Review references, not a redistribution of full third-party nutrient tables.
    source_unmatched = [r['id'] for r in records if r['id'] not in linked]
    summary = {'version': VERSION, 'baseline_ingredients': len(ingredients), 'source_records': dict(Counter(r['source'] for r in records)),
               'tfda_observation_rows': row_count, 'coverage_by_source': coverage, 'coverage_both_sources': both,
               'match_status': dict(Counter(m['status'] for m in mappings)), 'source_unmatched_records': len(source_unmatched),
               'duplicate_nutrient_keys': len(duplicates), 'name_collision_groups': len(collisions),
               'source_anomaly_signals': len(anomalies), 'cross_source_name_pairs': pair_count,
               'nutrient_difference_signals': len(diffs), 'value_states': states,
               'runtime_import_applied': False, 'approved_nutrition_mappings': 0,
               'usda_comparison': 'deferred: baseline USDA has no approved Chinese mapping or encoded measurement basis'}
    lock = {'baseline_sha256': BASELINE_SHA, 'sanotsu_commit': (cache / 'sanotsu.commit').read_text().strip(),
            'source_archives': {s: sha((cache / (s + '.zip')).read_bytes()) for s in ['sanotsu', 'tfda']},
            'sources': {'CN6': {'url': 'https://github.com/Sanotsu/china-food-composition-data', 'license_status': 'rights_reserved_no_explicit_redistribution_grant_found'},
                        'TFDA': {'url': 'https://data.gov.tw/dataset/8543', 'download_url': 'https://data.fda.gov.tw/data/opendata/export/20/json', 'license': '政府資料開放授權條款-第1版'}},
            'name_conversion': 'Windows LCMapStringEx zh-CN LCMAP_SIMPLIFIED_CHINESE + NFKC; resulting keys frozen in source-reference.json',
            'matching': 'exact normalized names or explicit aliases; parentheses preserved; no fuzzy matching',
            'screening_threshold': 'absolute delta > max(30% of larger value, 20 kcal or 2 g); not a validity standard'}
    output.mkdir(parents=True)
    files = {'summary.json': summary, 'sources.lock.json': lock, 'ingredient-matches.json': mappings,
             'source-reference.json': compact, 'unmatched-source-records.json': source_unmatched,
             'name-collisions.json': collisions, 'duplicate-observations.json': duplicates,
             'source-anomalies.json': anomalies, 'nutrient-difference-signals.json': diffs}
    for name, value in files.items():
        (output / name).write_bytes(encode(value))
    matched = len(ingredients) - summary['match_status'].get('unmatched', 0)
    report = f'''# 第二轮中文来源评估

## 结果

984 条现有食材中，{matched} 条找到名称候选（{matched / 984:.1%}）；{984-matched} 条尚无精确名称候选。
大陆来源覆盖 {coverage['CN6']} 条，台湾来源覆盖 {coverage['TFDA']} 条，两者重叠 {both} 条。
这不是已确认营养覆盖率；所有候选仍需检查生熟、部位、加工状态、品种及可食部。

| 指标 | 数量 |
|---|---:|
| 大陆来源食品 | {summary['source_records']['CN6']} |
| 台湾来源食品 | {summary['source_records']['TFDA']} |
| 台湾营养观测行 | {row_count} |
| 单一名称候选的现有食材 | {summary['match_status'].get('single_name_candidate',0)} |
| 多个名称候选的现有食材 | {summary['match_status'].get('multiple_name_candidates',0)} |
| 未关联现有目录的来源记录 | {len(source_unmatched)} |
| 同名/别名重叠组 | {len(collisions)} |
| 同一食品营养字段重复键 | {len(duplicates)} |
| 来源内部异常线索 | {len(anomalies)} |
| 跨来源数值差异线索 | {len(diffs)} |

## 如何读清单

1. ingredient-matches.json：全部 984 条食材及名称证据；无候选也保留。
2. source-reference.json / unmatched-source-records.json：新增候选出处；未匹配不等于新物种，不自动新增目录。
3. name-collisions.json / duplicate-observations.json：名字重叠与营养字段重复分别记录，不据此删除。
4. source-anomalies.json / nutrient-difference-signals.json：需要复核的线索，未修改源值。
5. sources.lock.json：固定提交、下载地址、SHA256、规则与授权状态。

## 比较边界

仅精确名称、原目录别名、来源明确别名与繁简字符转换参与匹配。保留括号状态，不做模糊匹配；地区词汇尚未人工补齐，因此覆盖率是保守下限。
数值筛查只对同名候选的热量、蛋白质/粗蛋白、脂肪/粗脂肪进行，阈值为差额超过较大值的30%，且超过20 kcal或2 g。这是排查优先级，不是营养有效性标准。
两地样品、可食部基准及分析方法尚未统一，差异不能认定为错误。大陆字段单位按字段名称作初筛，正式使用前须复核原表表头及基准。
Tr、缺失、未解析值不置零。保留台湾原始观测 ZIP 和大陆固定版本 ZIP 于本地缓存；本评估包不含完整营养原表。
现有 USDA 数据没有已确认中文映射，且观测未编码测量基准，因此本轮不与其强行比较、不覆盖其数据。

## 来源与入包结论

- 大陆来源：https://github.com/Sanotsu/china-food-composition-data 。使用 fixed_en 版；目前版权声明未提供明确再分发授权，先作为评估来源。
- 台湾来源：https://data.gov.tw/dataset/8543 。官方标注政府资料开放授权条款第1版；可继续准备带署名的独立来源包，先完成映射复核。

本轮交付评估结果；未改动 rc.2、数据库、食材营养值或自动执行权限。正式目录新增与营养绑定均为0。

## 复现

Python 标准库即可；随包附带固定版本的 OpenCC 字符字典。源 ZIP 放在 .cache/base-data-sources/round2，并保留 sanotsu.commit。
运行 python datasets/base-data/reclean/round2.py --output artifacts/base-data/round2-reproduced。
下载可变端点时须核对 sources.lock.json 的 SHA256；用其他版本得到的结果不视为同一评估。
'''
    (output / 'REPORT.md').write_text(report, encoding='utf-8')
    (output / 'round2.py').write_bytes(Path(__file__).read_bytes())
    (output / 'chinese.py').write_bytes(Path(__file__).with_name('chinese.py').read_bytes())
    (output / 'opencc').mkdir()
    for name in ['TSCharacters.txt', 'LICENSE', 'README.md']:
        (output / 'opencc' / name).write_bytes((Path(__file__).parent / 'opencc' / name).read_bytes())
    test_path = Path(__file__).parent.parent / 'test_round2.py'
    if test_path.exists():
        (output / 'test_round2.py').write_bytes(test_path.read_bytes())
    manifest = {p.relative_to(output).as_posix(): sha(p.read_bytes())
                for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'manifest.json').write_bytes(encode(manifest))
    target = output / (VERSION + '.zip')
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(output.rglob('*')):
            if not p.is_file() or p == target:
                continue
            info = zipfile.ZipInfo(p.relative_to(output).as_posix(), (2026, 9, 15, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        for name, h in manifest.items():
            assert sha(z.read(name)) == h
    (output / (target.name + '.sha256')).write_text(sha(target.read_bytes()) + '  ' + target.name + '\n')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=Path('.cache/base-data-sources/round2'))
    parser.add_argument('--baseline', type=Path, default=Path('artifacts/base-data/0.2.0-rc.2/dietdigidose-base-data-0.2.0-rc.2.zip'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.cache, args.baseline, args.output), ensure_ascii=False))
