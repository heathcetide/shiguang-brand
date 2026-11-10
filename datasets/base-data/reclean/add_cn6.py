"""Add the pinned CN6 source as local candidate data, preserving concept identity."""
import argparse
import json
import zipfile
from pathlib import Path
from collections import Counter
from bindings_batch1 import sha, encoded, parse

VERSION = 'concept-base-1.0.0-rc.2'
SOURCE_SHA = 'ea041186cf4aa3428f7aadfa8f28a5889a56185c25b2eca419790c7b3b33f906'
COMMIT = 'd15675c27582748307023b7ee7aca2a63fc52756'


def build(output):
    if output.exists(): raise FileExistsError(output)
    base = Path('artifacts/base-data/concept-base-1.0.0-rc.1/concept-base-1.0.0-rc.1.zip')
    source = Path('.cache/base-data-sources/round2/sanotsu.zip')
    assessment = Path('artifacts/base-data/round2-assessment-1/round2-assessment-1.zip')
    if sha(base.read_bytes()) != '09dae6e1b043df3dfa0c1f9e85b45e5940d8341f47ef80ea4f9fea0f7bae4ef2': raise ValueError('Base snapshot changed')
    if sha(source.read_bytes()) != SOURCE_SHA: raise ValueError('CN6 source changed')
    with zipfile.ZipFile(base) as z:
        contents = {n:z.read(n) for n in z.namelist()}
        manifest = json.loads(contents['manifest.json'])
        if not all(sha(contents[n])==h for n,h in manifest.items()): raise ValueError('Base manifest mismatch')
    with zipfile.ZipFile(assessment) as z:
        if sha(assessment.read_bytes()) != 'a06d04a43e99b27139e277ccb8c3c4bd6ba8587deb38c5f6be68fb9f1dc256c6': raise ValueError('Assessment changed')
        matches = json.loads(z.read('ingredient-matches.json'))
        anomalies = json.loads(z.read('source-anomalies.json'))
    forms = {f['legacy_ingredient_id']:f for f in json.loads(contents['ingredient-forms.json'])}
    records, observations, corrections = [], [], []
    selected_files = {}
    with zipfile.ZipFile(source) as z:
        root = z.namelist()[0]
        paths = sorted(n for n in z.namelist() if '/json_data_v3_20260825_qwen38max_kimi_k3_fixed_en/merged_' in n and n.endswith('.json'))
        for path in paths:
            original_path = path.replace('_fixed_en/', '/')
            fixed_path = path.replace('_fixed_en/', '_fixed/')
            variants = {}
            for kind, p in [('recognized',original_path),('corrected',fixed_path),('english_enriched',path)]:
                data=z.read(p); selected_files['cn6-provenance/'+p[len(root):]]=data
                variants[kind]={r['foodCode']:r for r in json.loads(data)}
            for pos,r in enumerate(json.loads(z.read(path))):
                rid='CN6:'+r['foodCode']; oids=[]
                for field,value in r.items():
                    if field in ['foodCode','foodName','englishName','remark']:continue
                    oid=rid+':'+field; amount,status=parse(value)
                    observations.append({'id':oid,'food_id':rid,'nutrient_or_attribute':field,'raw_value':value,
                                         'amount':amount,'status':status,'unit':{'energyKCal':'kcal','energyKJ':'kJ'}.get(field),
                                         'unit_status':'explicit_field_name' if field in ['energyKCal','energyKJ'] else 'pending_header_verification',
                                         'measurement_basis':'pending_original_table_verification','automatic_calculation_allowed':False,
                                         'source_path':path,'source_position':pos,'source_record_sha256':sha(encoded(r))})
                    oids.append(oid)
                records.append({'id':rid,'food_code':r['foodCode'],'source_name':r['foodName'],'english_name':r.get('englishName'),
                                'remark':r.get('remark'),'observation_ids':oids,'source_path':path,'source_position':pos,
                                'source_record_sha256':sha(encoded(r)),'raw_record':r,'source_commit':COMMIT,
                                'source_url':'https://github.com/Sanotsu/china-food-composition-data/blob/'+COMMIT+'/'+path[len(root):],
                                'usage_status':'local_candidate','license_status':'original_rights_reserved_redistribution_not_confirmed'})
                old=variants['recognized'][r['foodCode']]
                fixed=variants['corrected'][r['foodCode']]
                for field in old.keys() | fixed.keys():
                    if old.get(field)!=fixed.get(field):
                        corrections.append({'food_id':rid,'field':field,'recognized':old.get(field),'corrected':fixed.get(field),
                                            'decision':'upstream_correction_preserved_not_locally_invented'})
        for p in z.namelist():
            if p.endswith('README.md') and p==root+'README.md' or p.endswith(('energy_swap_fix_log.json','enrich_log.json','apply_log.json')):
                selected_files['cn6-provenance/'+p[len(root):]]=z.read(p)
    assert len(records)==1677 and len({r['id'] for r in records})==1677
    ids={r['id'] for r in records}; flagged={a['id'] for a in anomalies}
    links=[]
    for m in matches:
        for sid in m['candidates']:
            if sid not in ids:continue
            f=forms[m['ingredient_id']]
            links.append({'id':'CN6-CANDIDATE:'+m['ingredient_id']+':'+sid,'ingredient_form_id':f['id'],
                          'ingredient_concept_id':f['concept_id'],'source_food_id':sid,
                          'evidence':m['evidence'][sid],'matching_level':'name_candidate_only',
                          'identity_part_state_verified':False,'source_anomaly_flag':sid in flagged,
                          'automatic_calculation_allowed':False,'usage_status':'local_candidate'})
    assert all(l['source_food_id'] in ids for l in links)
    summary=json.loads(contents['summary.json']); summary.update(version=VERSION, cn6_source_foods=len(records),
        cn6_observations=len(observations),cn6_candidate_links=len(links),cn6_linked_legacy_ingredients=len({m['ingredient_form_id'] for m in links}),
        cn6_source_corrections=len(corrections),distribution_status='local_candidate_contains_CN6_rights_reserved_source')
    updates={'cn6-foods.json':records,'cn6-observations.json':observations,'cn6-candidate-links.json':links,
             'cn6-corrections.json':corrections,'cn6-source-anomalies.json':[a for a in anomalies if a['id'].startswith('CN6:')],
             'summary.json':summary,'cn6-source.lock.json':{'archive_sha256':SOURCE_SHA,'commit':COMMIT,
                 'base_sha256':sha(base.read_bytes()),'assessment_sha256':sha(assessment.read_bytes()),
                 'source_url':'https://github.com/Sanotsu/china-food-composition-data','license_status':'redistribution_not_confirmed'}}
    contents.pop('manifest.json')
    contents.update({n:encoded(v) for n,v in updates.items()});contents.update(selected_files)
    contents['previous-REPORT.md']=contents['REPORT.md']
    contents['REPORT.md']=f'''# 概念基础包 {VERSION} · 大陆营养来源接入

已将 Sanotsu/china-food-composition-data 固定提交 {COMMIT} 的营养数据接入为独立来源。

- 1677条食品原始记录；{len(observations)}条营养/属性观测。
- {len(links)}条候选关联，涉及{summary['cn6_linked_legacy_ingredients']}条旧原料形态；均已连接到现有概念ID。
- {len(corrections)}处上游识别版到修正版字段变化保留在cn6-corrections.json。
- 原有概念、食谱、厨具、38条TFDA条件关联及USDA数据保持不变。

## 使用入口

cn6-foods.json保留来源名称与原始编码，不写入概念名称或检索索引。
cn6-observations.json保留数值、原文标记和出处；edible等属性也单独保留，不擅自解释为营养素。
cn6-candidate-links.json连接现有食材概念和形态。候选名称一致尚不等于部位、状态一致，不能用于自动计算。
能量字段单位由字段名明确；其他单位和测量基准在核对原表头前标记未知，未填造。
缺失与Tr分别保留，不当零，不覆盖或混拼TFDA/USDA数值。

## 来源与范围

来源：https://github.com/Sanotsu/china-food-composition-data 。使用fixed_en版；识别版、修正版、增强版JSON与修正日志保存在cn6-provenance。
本包包含该来源数据，仅作为本地候选包。原书版权及再分发授权尚未确认，不能将整包当成统一开放许可的数据发布。
保留既有来源署名和数据说明见previous-REPORT.md。本轮未修改系统数据库，未新增已确认营养绑定。

## 复现

仓库根目录运行 python datasets/base-data/reclean/add_cn6.py --output artifacts/base-data/cn6-reproduced。
需要固定的原概念包、第二轮评估包及Sanotsu源ZIP，指纹见cn6-source.lock.json。
本包原有concepts.py只重建上一版主干；完整本版必须运行add_cn6.py。
'''.encode('utf-8')
    contents['add_cn6.py']=Path(__file__).read_bytes()
    contents['manifest.json']=encoded({n:sha(b) for n,b in sorted(contents.items())})
    output.mkdir(parents=True)
    for n,b in contents.items():
        p=output/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
    target=output/(VERSION+'.zip')
    with zipfile.ZipFile(target,'w') as z:
        for n,b in sorted(contents.items()):
            info=zipfile.ZipInfo(n,(2026,9,15,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,b)
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        assert all(sha(z.read(n))==h for n,h in json.loads(z.read('manifest.json')).items())
    (output/(target.name+'.sha256')).write_text(sha(target.read_bytes())+'\n')
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
    print(json.dumps(build(p.parse_args().output),ensure_ascii=False))
