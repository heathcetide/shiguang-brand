"""Auditable ingredient scope selection from the pinned food vocabulary."""
from collections import Counter, defaultdict
import json

# Exact source labels inspected for this snapshot. No substring admission rule.
# Inclusion describes culinary scope, not species identification or food safety certification.
GROUPS = {
 '谷物及淀粉': '五常大米|晋祠大米|秋田小町|蓬萊米|泰式米线|日本絹光米|七星 (大米)|玉里米|山田錦|竹芋粉|印度麵粉|香蕉粉|米粉|面粉|全麦面粉|無筋面粉|无筋面粉|高粱米|在來米|玉米|玉米澱粉|淀粉|西米|粗粒小麥粉|麦芽糖|谷粉|越光米|麦仁|麥達麵粉|麦米|大燕麥片|燕麥碎粒|去皮豌豆|蒸谷米|粉丝|面条|藜麥|沙河粉|通心粉|吸管麵|蝴蝶麵|螺旋粉|扁意粉|米粒麵|螺絲粉|鳥巢麵|线面|意大利面|直通粉|緞帶麵|伊麵|江西米粉|饵丝',
 '蔬菜及香草': '分蔥|矢切蔥|海老芋|九条葱|練馬蘿蔔|東京獨活|結崎蔥|芦笋|苦瓜|西兰苔|菜花|茴香嫩叶|羽衣甘藍|秋葵|南瓜|萝卜叶子菜|万愿寺绿辣椒|笋|香芹|朝天椒|辣椒|野甘藍|大蒜|莲藕|西红柿|白菜|冬瓜|青蔥|番茄|胡萝卜|马铃薯|长豇豆|佛手瓜|茖葱|薤|单花韭|單花韭|笋干|蘿蔔乾|冬菜|榨菜|德国酸菜|朝鲜泡菜|潮汕咸菜|橄榄菜|腊八蒜',
 '水果及坚果': '角豆|大杏仁|椰子|杜松子|葡萄乾|胡桃|李子|榛子|花生|食用堅果|奉化水蜜桃|奇異橙|夏朗德甜瓜|日本土柑|瓯柑|唐柚子|加利亞甜瓜|清见|桃杏李|车厘李|宣化牛奶葡萄|针叶樱桃果|阿萨伊果|黑莓|黑醋栗|瓶橘|小紅莓|蟠桃|鵝莓|葡萄|柚子|草莓|金橘|藍莓|树西红柿|油桃|榴梿|橙|檸檬|浆果|火龙果|菠萝蜜|树莓|哈密瓜|混合堅果|葵花籽|瓜子',
 '肉蛋及水产': '鱗頭犬牙南極魚|海扇貝|干海产|鄱阳湖大闸蟹|鮭魚冬葉|刀貝|欧白鱼|鲤鱼|鳗鱼肉|蛋液|肥肉|魚頭|花膠|茴魚|火腿|兔肉|魚膠|食用肝|龙虾|雞生蠔|豬肝|鹌鹑蛋|鹌鹑肉|龙利鱼|南方牙鲆|小牛肉|鹿肉|牡蛎|鯰魚|瘦肉|猪大肠|真乌贼|食用壳菜蛤|蛋|蛋白|蛋黄|鸡蛋|牛肉|鮟肝|黑椎鲷|大鳞钩吻鲑|沙丁鱼属|歐洲北魷|骨髓|银鲑|乾魚物|腰子|猪板油|鲭鱼肉|驼背大马哈鱼|鮭魚|黄鳍金枪鱼|大马哈鱼|大西洋鲑|比目魚|明虾|毛鳞鱼|鰨|干贝|虾|红马哈鱼|板油|日本鲭|长鳍金枪鱼|黑线鳕|香肠|贡丸|竹輪|皮蛋|咸鸭蛋',
 '菌菇': '双孢蘑菇|猴头菇|刺芹侧耳|香菇|金针菇|长裙竹荪|欧洲黑木耳|灰树花|银耳|草菇|大球盖菇|毛木耳|金顶侧耳|平菇|鸡腿菇|白松露菌|黑孢块菌|夏块菌|美味羊肚菌|绣球菌',
 '油脂': '菜籽油|红花油|亚麻仁油|棕榈油|黄油|紫苏油|葵花油|芝麻油|椰浆|椰絲|花生粉|黑加仑籽油|碧根果油',
 '调味及烘焙配料': '肉醬|莳萝芥末酱|伊朗香料|波尔多酱汁|桂皮|瓦萨卡卡酱|瑞士汁|千岛酱|永春老醋|阿吉卡|蘋果醬|意大利香醋|月桂叶|黑醋|焦糖色素|丁香|咖喱粉|棕醬 (醬料)|费里粉|盐之花|高良薑|蒜粉|葡萄糖糖浆|果葡糖浆|苦椒酱|高果玉米糖浆|高果糖浆|蜂蜜|牙买加烟熏香料|肉汁清湯|蒜茸|芥菜籽|營養酵母|水蘸汁|洋葱粉|烟熏红椒|泡菜汁|北非综合香料|海盐|燒烤醬|酱菜|蔗糖|甘蔗糖漿|番茄汁|番茄糊|番茄酱|香草精|胡椒粉|酵母提取物|四川保宁醋|凝乳酶|复配膨松剂|可可粉|八角|大高良姜|茴芹籽|洋菜|肉桂|花椒|葡萄糖异构糖浆|蛋黄酱|白汁|紅辣椒碎|丝绒酱|酸豆|荷蘭醬|萨尔萨酱|乾酪白汁|蓮茸|葛縷子|肉豆蔻|商業酵母|酵母|阿勒颇辣椒|奇米丘里酱|糖|芫荽籽|虾酱|卡拉胶|哈里薩辣醬|芝麻酱|紅糖|青瓜酸乳酪酱汁|英式奶黃醬|花生酱|印度薄荷醬|醪糟|腐乳|百里香',
 '蛋奶及豆制品': '酸化乳|羊凝乳|乳扇|奶豆腐|乳饼|乳清|奶粉|豆腐|燕麦奶|丹貝|煉奶|酸奶|百頁豆腐|豆卜|烤麸',
}

# Persisted selection is resolved to source IDs during build; each missing label is reported.
EXCLUDED = {
 'WD-Q6457326': '实验室缓冲液，不属于食材目录',
 'WD-Q16844581': '实验室缓冲液，不属于食材目录',
 'WD-Q134244240': '历史出土物条目，不是当前食材概念',
 'WD-Q134244141': '历史出土物条目，不是当前食材概念',
 'WD-Q134242474': '历史出土物条目，不是当前食材概念',
 'WD-Q2995740': '人物与饮食话题，不是食材',
 'WD-Q146970': '事件条目，不是食材',
 'WD-Q42950959': '宠物饲料，不属于本目录范围',
 'WD-Q42950965': '宠物饲料，不属于本目录范围',
}


def check(ok, message):
    if not ok:
        raise ValueError(message)


def project(tables, starters):
    groups = {name: group for group, names in GROUPS.items() for name in names.split('|')}
    aliases = defaultdict(set)
    for r in tables['aliases']:
        aliases[r['entity_id']].add(r['alias_zh'])
    catalogue, pending, decisions = [], [], []
    seen_labels = set()
    for r in sorted(tables['entities'], key=lambda x: x['entity_id']):
        id_, name, type_ = r['entity_id'], r['canonical_name_zh'], r['entity_type']
        group = groups.get(name)
        reason = 'explicit_label_scope_selection'
        # Only named cheese types in the source ingredient class; no arbitrary food suffix search.
        if not group and type_ == 'ingredient' and name.endswith(('奶酪', '芝士', '乾酪', '干酪', '乳酪', '起司')):
            group, reason = '蛋奶及豆制品', 'source_ingredient_named_cheese'
        if id_ in EXCLUDED:
            disposition, reason = 'excluded', EXCLUDED[id_]
        elif type_ not in ('ingredient', 'food'):
            disposition, reason = 'excluded', 'source_type_outside_ingredient_scope:' + type_
        elif group:
            disposition = 'included'
            seen_labels.add(name)
        else:
            disposition, reason = 'pending', 'needs_identity_or_culinary_scope_review'
        decisions.append(dict(source_id=id_, name_zh=name, source_type=type_,
                              disposition=disposition, reason=reason))
        if disposition == 'excluded':
            continue
        row = dict(ingredient_id=id_, name=name, language='zh', aliases=sorted(aliases[id_]),
                   category_zh=group or '待确认', state='unspecified_by_source',
                   source_type=type_, source_root_types=r['all_root_types'], source_url=r['source_url'],
                   source_license=r['source_license'], source_id=id_,
                   nutrition=None, nutrition_status='unmapped',
                   review_status='scope_selected_identity_unverified' if disposition == 'included' else 'pending_scope_review',
                   selection_reason=reason)
        (catalogue if disposition == 'included' else pending).append(row)
    # Preserve project recipe IDs. Do not merge source concepts by label or attach candidate nutrients.
    for r in starters:
        catalogue.append(dict(ingredient_id=r['ingredient_id'], name=r['name_zh'], language='zh',
                              aliases=r['aliases'], category_zh=r['category_zh'], state=r['state'],
                              source_type='project_starter', source_root_types='', source_url='',
                              source_license=None, source_id=r['ingredient_id'], nutrition=None,
                              nutrition_status='unmapped', review_status=r['review_status'],
                              selection_reason='preserve_recipe_ingredient_id'))
    catalogue.sort(key=lambda r: r['ingredient_id'])
    counts = Counter(r['disposition'] for r in decisions)
    index = defaultdict(set)
    for r in catalogue:
        for label in [r['name'], *r['aliases']]:
            index[label.strip().casefold()].add(r['ingredient_id'])
    report = dict(source_entities=len(decisions), source_dispositions=dict(counts),
                  catalogue_records=len(catalogue), project_starter_records=len(starters),
                  pending_records=len(pending),
                  label_collisions={n: sorted(ids) for n, ids in sorted(index.items()) if len(ids) > 1},
                  unused_selection_labels=sorted(set(groups) - seen_labels),
                  counting_note='Records are source concepts, not deduplicated species or unique culinary ingredients. USDA reference foods remain separate.')
    validate(catalogue, pending, decisions, tables, starters)
    return catalogue, pending, decisions, report


def validate(catalogue, pending, decisions, tables, starters):
    source_ids = {r['entity_id'] for r in tables['entities']}
    check(len(decisions) == len(source_ids) and {r['source_id'] for r in decisions} == source_ids, 'Missing ingredient scope decisions')
    source_types = {r['entity_id']: r['entity_type'] for r in tables['entities']}
    check(all(d['disposition'] in ('included', 'pending', 'excluded') for d in decisions), 'Invalid ingredient disposition')
    included = {d['source_id'] for d in decisions if d['disposition'] == 'included'}
    review = {d['source_id'] for d in decisions if d['disposition'] == 'pending'}
    starter_ids = {r['ingredient_id'] for r in starters}
    check(len(catalogue) == len({r['ingredient_id'] for r in catalogue}), 'Duplicate expanded ingredient ID')
    check(len(pending) == len({r['ingredient_id'] for r in pending}), 'Duplicate pending ingredient ID')
    check({r['ingredient_id'] for r in catalogue} == included | starter_ids, 'Ingredient inclusion mismatch')
    check({r['ingredient_id'] for r in pending} == review, 'Ingredient pending mismatch')
    check(not (included & review), 'Ingredient tiers overlap')
    check(all(source_types[i] in ('food', 'ingredient') for i in included | review), 'Non-ingredient source type admitted')
    check(not (set(EXCLUDED) & (included | review)), 'Excluded source admitted')
    for row in catalogue + pending:
        check(row['nutrition'] is None and row['nutrition_status'] == 'unmapped', 'Unverified expanded nutrition')
        check(row['name'] and row['source_id'] == row['ingredient_id'], 'Missing ingredient identity')


def jsonl(rows):
    return ('\n'.join(json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows) + '\n').encode('utf-8')


def render(catalogue, pending, report):
    def escape(s):
        return s.replace('|', '\\|').replace('\n', ' ')
    lines = ['# 扩展食材目录', '',
             f"共 {len(catalogue)} 条目录记录，其中来源概念 {report['source_dispositions'].get('included', 0)} 条、项目食材 50 条；另有 {len(pending)} 条待确认。", '',
             '这里统计的是记录，不是去重后的食材种数。同名不同 ID 保留，尚未核验品种、生熟状态或全部别名。',
             '食材收录不依赖营养关联；本表营养均未绑定。USDA 的 363 条食品参考另行保留，不叠加充当中文食材数。',
             '分类仅表示烹饪目录范围，不是食用安全、野生物种鉴定或供应许可认证。', '',
             '| ID | 名称 | 分类 | 别名 |', '|---|---|---|---|']
    for r in catalogue:
        lines.append('| ' + ' | '.join(escape(v) for v in [r['ingredient_id'], r['name'], r['category_zh'], '、'.join(r['aliases'])]) + ' |')
    lines += ['', '## 待确认条目', '', '| ID | 名称 | 原始类型 |', '|---|---|---|']
    for r in pending:
        lines.append('| ' + ' | '.join(escape(v) for v in [r['ingredient_id'], r['name'], r['source_type']]) + ' |')
    lines += ['', '完整逐条分类理由见 review/ingredient_scope_decisions.jsonl；来源数据均在原参考层保留。', '']
    return '\n'.join(lines).encode('utf-8')
