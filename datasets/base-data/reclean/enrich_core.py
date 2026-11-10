"""Frozen, additive enrichment: explicit sample scopes, recipe weighing contracts and evidence."""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import zipfile
from collections import defaultdict

VERSION = 'concept-enrichment-2026-09-15.1'
SR_SHA = 'b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0'
SR_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip'
SR_DOC = 'https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/methods-and-application-of-food-composition-laboratory/mafcl-site-pages/sr11-sr28/'
FOUNDATION_DOC = 'https://fdc.nal.usda.gov/Foundation_Foods_Documentation/'
# Form suffix, exact source ID/name, and the narrower sample condition. No fuzzy approvals.
SAMPLES = [
 ('cabbage','169979','Cabbage, chinese (pe-tsai), raw','生大白菜，去不可食部分'),
 ('ginger','169231','Ginger root, raw','生姜可食根茎，非姜粉或腌姜'),
 ('oil','172336','Oil, canola','纯低芥酸菜籽油，非调和油；配方全部投料油计入'),
 ('salt','173468','Salt, table','食用盐，非低钠替代盐；不推断碘含量'),
 ('celery','169988','Celery, raw','生芹菜可食部；来源为美国样品，非当地品种实测'),
 ('garlic','169230','Garlic, raw','生大蒜去外皮可食部，非蒜粉'),
 ('broccoli','170379','Broccoli, raw','生西兰花可食部，非焯水后重量'),
 ('cauliflower','169986','Cauliflower, raw','生花椰菜可食部，非西兰花'),
 ('pepper','170427','Peppers, sweet, green, raw','生青甜椒去蒂籽可食部，非辣椒'),
 ('starch','169698','Cornstarch','干玉米淀粉，非玉米面'),
 ('pumpkin','168448','Pumpkin, raw','生南瓜去皮去籽果肉'),
 ('millet','169702','Millet, raw','未烹调干小米，非熟粥重量'),
 ('scallion','170005','Onions, spring or scallions (includes tops and bulb), raw','生小葱可食葱白和葱绿，非大葱'),
 ('shiitake','169242','Mushrooms, shiitake, raw','生鲜香菇，非干香菇或泡发后干菇'),
 ('zucchini','169291','Squash, summer, zucchini, includes skin, raw','生西葫芦可食部，保留皮'),
 ('cucumber','168409','Cucumber, with peel, raw','生黄瓜可食部，保留皮'),
 ('sugar','169655','Sugars, granulated','干白砂糖，非糖浆或代糖'),
 ('rice','169756','Rice, white, long-grain, regular, raw, unenriched','未强化长粒白米，按淘洗前干重；不是所有大米的通用营养'),
 ('sweetpotato','168482',"Sweet potato, raw, unprepared (Includes foods for USDA's Food Distribution Program)",'生红薯可食部，非熟红薯'),
 ('eggplant','169228','Eggplant, raw','生茄子可食部，保留皮；未指定当地品种'),
 ('corn','169998','Corn, sweet, yellow, raw','生黄色甜玉米粒，不含玉米芯'),
 ('oats','173904','Cereals, oats, regular and quick, not fortified, dry','原味未强化干燕麦片，非添加奶糖的即食配方'),
]
CORE = {'calories': ('1008','kcal'), 'protein': ('1003','g'), 'fat': ('1004','g'), 'carbs': ('1005','g')}
TFDA = {'egg':'K01001','tomato':'E74001','carrot':'E0200101','potato':'B0700201'}
DEFERRED = {'tofu':'北豆腐未限定凝固剂和含水量；不以硫酸钙豆腐直接代替',
 'soy':'生抽与美式通用酱油配方及钠含量未对齐', 'vinegar':'米醋不能替换为蒸馏醋、苹果醋或葡萄酒醋',
 'sesameoil':'芝麻香油的焙炒与加工形式未对齐通用芝麻油样品', 'seaweed':'干紫菜不可绑定生紫菜、海带或螺旋藻',
 'noodles':'小麦挂面盐含量和配方未明确，不套用鸡蛋面或荞麦面',
 'milk':'毫升用量缺少密度与乳脂类型依据，不换算为同数克', 'shrimp':'虾种、处理方式及添加保水剂情况未明确'}
DISCLOSURE = '按本版本注明的烹调前可食部重量及所选区域样品估算，全部投料油计入；未校正焯水、弃汤、锅中残留及烹调损失。仅能量、蛋白质、脂肪、碳水四项覆盖完整时显示每份值，不代表全营养完整或成品实测。'


def encoded(value):
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def scalar(value):
    if value is None or isinstance(value,bool) or str(value).strip() == '': return None
    number = float(value)
    if not math.isfinite(number) or number < 0: raise ValueError('Invalid nutrient amount')
    return number


def estimate(method, selections, profiles):
    byid = {p['id']:p for p in profiles}
    byline = {s['line_id']:s for s in selections}
    if len(byline)!=len(selections) or set(byline)-{i['line_id'] for i in method['ingredients']}: raise ValueError('Invalid recipe selection lines')
    totals={k:0.0 for k in CORE};coverage={k:0 for k in CORE}; gaps=[]
    for line in method['ingredients']:
        s=byline.get(line['line_id'])
        if not s: gaps.append({'line_id':line['line_id'],'name':line['name'],'reason':'no_scoped_sample_or_edible_gram_weight'});continue
        p=byid[s['profile_id']]
        if p['ingredient_form_id']!=line['ingredient_form_id'] or s['scope']!=p['scope']: raise ValueError('Wrong form or sample scope')
        if s['weight_basis']!='pre_cooking_edible_grams':raise ValueError('Weight basis not confirmed')
        grams=s['grams']
        if isinstance(grams,bool) or not isinstance(grams,(float,int)) or not math.isfinite(grams) or grams<=0:raise ValueError('Invalid edible grams')
        m=line.get('measurement') or {}
        if m.get('unit')!='g' or m.get('kind')!='exact' or m.get('value')!=grams or line.get('ingredient_options') or line.get('mapping_status') in ['choice_unresolved','bundle_unresolved']:raise ValueError('Unresolved quantity/ingredient choice')
        for k in CORE:
            val=p['nutrients_per_100g'][k]['amount']
            if val is not None: totals[k]+=val*grams/100;coverage[k]+=1
    complete=bool(method['ingredients']) and all(c==len(method['ingredients']) for c in coverage.values())
    servings=method.get('servings')
    if isinstance(servings,bool) or not isinstance(servings,(int,float)) or not math.isfinite(servings) or servings<=0:servings=None
    return {'method_id':method['id'],'title':method['title'],'status':'core_complete_under_declared_assumptions' if complete else 'incomplete',
      'basis':'whole_recipe_raw_ingredient_sum','core_fields':list(CORE),'whole_recipe':{k:round(v,4) if method['ingredients'] and coverage[k]==len(method['ingredients']) else None for k,v in totals.items()},
      'known_subtotal':{k:round(v,4) if coverage[k] else None for k,v in totals.items()},'coverage':coverage,'total_lines':len(method['ingredients']),
      'per_serving':{k:round(v/servings,4) for k,v in totals.items()} if complete and servings else None,
      'servings':servings,'per_100g_finished':None,'micronutrient_completeness':'not_assessed','gaps':gaps,
      'selections':selections,'disclosure':DISCLOSURE,'automatic_meal_planning_allowed':False}


def build(base, archive, output):
    base,archive,output=Path(base),Path(archive),Path(output)
    if output.exists():raise FileExistsError(output)
    manifest=json.loads((base/'manifest.json').read_text(encoding='utf8'))
    used={}
    def load(name):
        content=(base/(name+'.json')).read_bytes();assert sha(content)==manifest[name+'.json'];used[name+'.json']=sha(content);return json.loads(content)
    if sha(archive.read_bytes())!=SR_SHA:raise ValueError('Source archive checksum mismatch')
    forms={f['id']:f for f in load('ingredient-forms')};methods=load('methods');concepts=load('concepts');recipes=load('recipe-concepts')
    links=load('nutrition-links');obs={o['id']:o for o in load('nutrition-observations')}
    with zipfile.ZipFile(archive) as z:
        def csvrows(name):
            return csv.DictReader(io.TextIOWrapper(z.open(next(n for n in z.namelist() if n.endswith('/'+name+'.csv'))),encoding='utf-8-sig'))
        source_foods={r['fdc_id']:r for r in csvrows('food')}
        nutrient_defs={r['id']:r for r in csvrows('nutrient')}
        selected_ids={sid for _,sid,_,_ in SAMPLES}
        source_obs=defaultdict(list)
        for r in csvrows('food_nutrient'):
            if r['fdc_id'] in selected_ids:source_obs[r['fdc_id']].append(r)
    profiles=[];source_records=[]
    for suffix,sid,expected,scope in SAMPLES:
        f=forms['FORM:DDD-I-'+suffix];food=source_foods[sid]
        if food['description']!=expected or food['data_type']!='sr_legacy_food':raise ValueError('Source identity mismatch')
        fields={}
        for key,(nid,unit) in CORE.items():
            rows=[r for r in source_obs[sid] if r['nutrient_id']==nid]
            if len(rows)>1 or nutrient_defs[nid]['unit_name'].lower()!=unit:raise ValueError('Duplicate nutrient or invalid unit')
            fields[key]={'amount':scalar(rows[0]['amount']) if rows else None,'unit':unit,'nutrient_id':nid,'observation_id':rows[0]['id'] if rows else None}
        profiles.append({'id':'ENRICH-PROFILE:'+f['id'],'ingredient_form_id':f['id'],'ingredient_concept_id':f['concept_id'],'display_name':f['display_name'],
          'scope':scope,'source_food_id':'USDA-FDC-'+sid,'source_name':expected,'source_kind':'SR_Legacy','source_url':f'https://fdc.nal.usda.gov/food-details/{sid}/nutrients',
          'source_license':'CC0-1.0','basis':'per_100g_edible_portion','basis_evidence':SR_DOC,'nutrients_per_100g':fields,
          'binding_status':'scoped_reference','requires_scope_confirmation':True,'automatic_runtime_binding':False,'professional_review_performed':False})
        source_records.append({'food':food,'food_nutrient':source_obs[sid],'nutrient_definitions':{r['nutrient_id']:nutrient_defs[r['nutrient_id']] for r in source_obs[sid]}})
    for suffix,scope_key in TFDA.items():
        f=forms['FORM:DDD-I-'+suffix];link=next(l for l in links if l['ingredient_form_id']==f['id'] and l['scope_key']==scope_key)
        names={'calories':'熱量','protein':'粗蛋白','fat':'粗脂肪','carbs':'總碳水化合物'};fields={}
        for key,name in names.items():
            rows=[obs[oid] for oid in link['observation_ids'] if obs[oid]['nutrient_name']==name]
            if len(rows)!=1 or rows[0]['food_id']!=link['source_food_id'] or rows[0]['unit']!=CORE[key][1]:raise ValueError('Invalid TFDA observation')
            fields[key]={'amount':scalar(rows[0]['amount']),'unit':rows[0]['unit'],'observation_id':rows[0]['id']}
        profiles.append({'id':'ENRICH-PROFILE:'+f['id'],'ingredient_form_id':f['id'],'ingredient_concept_id':f['concept_id'],'display_name':f['display_name'],
          'scope':link['scope'],'source_food_id':link['source_food_id'],'source_name':link['source_name'],'source_kind':'TFDA',
          'original_binding_id':link['id'],'basis':link['basis'],'nutrients_per_100g':fields,
          'binding_status':'scoped_reference','requires_scope_confirmation':True,'automatic_runtime_binding':False,'professional_review_performed':False})
    # A frozen Foundation Foods sample supplies the missing raw, skinless breast identity.
    foundation=load('usda-foods');foundation_obs=load('usda-observations');food=next(x for x in foundation if x['fdc_id']=='2646170')
    if food['name_en']!='Chicken, breast, boneless, skinless, raw':raise ValueError('Chicken identity mismatch')
    f=forms['FORM:DDD-I-chicken'];fields={}
    for key,(nid,unit) in CORE.items():
        if key=='calories':nid='2048'  # Explicit preference: reported specific Atwater energy, not mixed with general energy.
        rows=[x for x in foundation_obs if x['fdc_id']=='2646170' and x['nutrient_id']==nid]
        if len(rows)!=1 or rows[0]['duplicate_key'] or rows[0]['unit']!=unit:raise ValueError('Invalid Foundation nutrient')
        fields[key]={'amount':scalar(rows[0]['amount']),'unit':unit,'nutrient_id':nid,'observation_id':rows[0]['id']}
    profiles.append({'id':'ENRICH-PROFILE:'+f['id'],'ingredient_form_id':f['id'],'ingredient_concept_id':f['concept_id'],'display_name':f['display_name'],
        'scope':'去皮去骨生鸡胸肉，非带皮、注水调理或熟肉','source_food_id':food['id'],'source_name':food['name_en'],
        'source_kind':'Foundation_Foods','source_url':food['source_url'],'source_license':food['source_license'],'basis':'per_100g_edible_portion','basis_evidence':FOUNDATION_DOC,
        'nutrients_per_100g':fields,'binding_status':'scoped_reference','requires_scope_confirmation':True,'automatic_runtime_binding':False,'professional_review_performed':False})
    byform={p['ingredient_form_id']:p for p in profiles};evaluations=[];contracts=[];equipment=[]
    tools={c['name_zh']:c for c in concepts if c['kind']=='kitchenware' and c['active_catalogue']}
    for method in methods:
        if not method['source_method_id'].startswith('DDD-R-'):continue
        selections=[]
        for line in method['ingredients']:
            p=byform.get(line.get('ingredient_form_id'));m=line.get('measurement') or {}
            if not p or m.get('kind')!='exact' or m.get('unit')!='g' or not m.get('value'):continue
            selections.append({'line_id':line['line_id'],'profile_id':p['id'],'grams':m['value'],'weight_basis':'pre_cooking_edible_grams','scope':p['scope'],
              'evidence_kind':'project_recipe_editorial_weighing_contract','scope_is_recipe_assumption':True,'instruction':f"{line['name']}：按 {p['scope']}，烹调前可食部称重 {m['value']:g} g。"})
        contracts.append({'method_id':method['id'],'original_recipe_sha256':method['source_recipe_sha256'],'version':VERSION,
          'weighing_instructions':[s['instruction'] for s in selections],'disclosure':DISCLOSURE,'original_amounts_unchanged':True})
        evaluations.append(estimate(method,selections,profiles))
        for name in ['炒锅','汤锅','电饭煲','蒸锅','漏勺']:
            evidence=[{'step':s['order'],'text':s['text']} for s in method['steps'] if name in s['text']]
            if evidence and name in tools:equipment.append({'method_id':method['id'],'concept_id':tools[name]['id'],'name':name,'role':'required','basis':'explicit_named_device_in_selected_method','evidence':evidence,'alternative_evaluated':False})
    duplicates=defaultdict(list)
    for c in concepts:
        if c['active_catalogue']:duplicates[(c['kind'],c['name_zh'])].append(c['id'])
    duplicate_review=[{'kind':k,'name':n,'concept_ids':ids,'action':'review_identity_before_merge'} for (k,n),ids in duplicates.items() if len(ids)>1]
    complete=[e for e in evaluations if e['status']=='core_complete_under_declared_assumptions']
    summary={'version':VERSION,'parent_version':'concept-base-1.0.0-rc.2','scoped_profiles':len(profiles),'new_source_sample_links':len(SAMPLES)+1,
      'existing_tfda_profiles_reused':len(TFDA),'recipes_assessed':len(evaluations),'core_complete_recipes':len(complete),'incomplete_recipes':len(evaluations)-len(complete),
      'equipment_role_records':len(equipment),'exact_name_duplicate_groups':len(duplicate_review),'concepts_added':0,'concepts_merged':0,
      'runtime_applied':False,'complete_means':'four_core_fields_under_declared_assumptions_not_all_nutrients','complete_recipe_titles':[e['title'] for e in complete]}
    output.mkdir(parents=True)
    payload={'summary.json':summary,'nutrition-profiles.json':profiles,'recipe-nutrition.json':evaluations,'recipe-weighing-contracts.json':contracts,
      'equipment-role-updates.json':equipment,'duplicate-review.json':duplicate_review,'deferred-matches.json':DEFERRED,
      'source-selected-records.json':source_records,'source.lock.json':{'sr_archive_url':SR_URL,'sr_archive_sha256':SR_SHA,'parent_manifest_sha256':sha((base/'manifest.json').read_bytes()),'parent_files':used}}
    for name,value in payload.items():(output/name).write_bytes(encoded(value))
    (output/'enrich_core.py').write_bytes(Path(__file__).read_bytes())
    (output/'REPORT.md').write_text('# 常用食材与家常菜补充包\n\n'+f"{len(profiles)} 个具体形态营养参考；评估 {len(evaluations)} 道菜，{len(complete)} 道具备四项核心营养估算。\n\n"+DISCLOSURE+'\n\n完整估算：'+ '、'.join(e['title'] for e in complete)+'。\n\n数量、份数沿用原配方；称量及区域样品选择为本次明确声明的项目假设，不冒充原始来源说明或实测。未替换旧概念 ID，未公开 CN6 原始表。\n',encoding='utf8')
    (output/'manifest.json').write_bytes(encoded({f.name:sha(f.read_bytes()) for f in sorted(output.iterdir()) if f.is_file()}))
    with zipfile.ZipFile(output/(VERSION+'.zip'),'w',zipfile.ZIP_DEFLATED) as z:
        for f in sorted(output.iterdir()):
            if f.suffix!='.zip':
                info=zipfile.ZipInfo(f.name,date_time=(2026,9,15,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,f.read_bytes())
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('base');parser.add_argument('source');parser.add_argument('output');a=parser.parse_args()
    print(json.dumps(build(a.base,a.source,a.output),ensure_ascii=False,indent=2))
