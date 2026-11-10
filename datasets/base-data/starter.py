"""Validate and render the bounded, project-authored food starter drafts."""
import json
import math
from starter_data import INGREDIENTS, RECIPES

SAFETY_URL = 'https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures'
ALLERGENS = {'egg': ['egg'], 'milk': ['milk'], 'tofu': ['soy'], 'soy': ['soy', 'wheat'],
             'noodles': ['wheat'], 'flour': ['wheat'], 'shrimp': ['crustacean'],
             'sesame': ['sesame'], 'sesameoil': ['sesame']}


def check(ok, message):
    if not ok:
        raise ValueError(message)


def validate(ingredients, recipes, kitchen_ids):
    check(len(ingredients) == 50 and len(recipes) == 20, 'Unexpected starter counts')
    ids = {r['ingredient_id'] for r in ingredients}
    check(len(ids) == 50 and len({r['recipe_id'] for r in recipes}) == 20, 'Duplicate starter IDs')
    check(len({r['name_zh'] for r in ingredients}) == 50, 'Duplicate ingredient names')
    for r in ingredients:
        check(r['nutrition_per_100g'] is None and r['nutrition_status'] == 'unmapped', 'Unverified ingredient nutrition')
        check(r['state'] and r['quantity_basis'] == 'edible_portion_before_cooking', 'Missing ingredient basis')
    for r in recipes:
        check(r['review_status'] == 'draft_not_kitchen_tested' and r['nutrition'] is None, 'Draft recipe promoted')
        check(r['servings'] > 0 and r['estimated_total_minutes'] > 0, 'Invalid recipe yield or time')
        used = [x['ingredient_id'] for x in r['ingredients']]
        check(len(set(used)) == len(used) and set(used) <= ids, 'Duplicate or orphan recipe ingredient')
        for x in r['ingredients']:
            check(isinstance(x['quantity'], (int, float)) and not isinstance(x['quantity'], bool)
                  and math.isfinite(x['quantity']) and x['quantity'] > 0, 'Invalid ingredient quantity')
            check(x['unit'] == ('ml' if x['ingredient_id'] == 'DDD-I-milk' else 'g'), 'Invalid ingredient unit')
        check(set(r['kitchenware_ids']) <= kitchen_ids, 'Orphan recipe kitchenware')
        check(len(r['steps']) >= 3 and all(len(s['text']) >= 10 for s in r['steps']), 'Incomplete recipe steps')
        check([s['order'] for s in r['steps']] == list(range(1, len(r['steps']) + 1)), 'Invalid step sequence')
        check(all(math.isfinite(v) and v >= 0 for v in r['water_ml'].values()), 'Invalid recipe water')
        expected = sorted({a for x in used for a in ALLERGENS.get(x.removeprefix('DDD-I-'), [])})
        check(r['declared_allergens'] == expected, 'Missing known recipe allergen')


def compile_data(kitchen_concepts, source_entities):
    kitchen = {r['name_zh']: r['concept_id'] for r in kitchen_concepts}
    ingredients = []
    for slug, name, aliases, state, category in INGREDIENTS:
        candidates = [r['entity_id'] for r in source_entities if r['canonical_name_zh'] in [name, *aliases]]
        ingredients.append(dict(ingredient_id='DDD-I-' + slug, name_zh=name, aliases=aliases,
                                state=state, category_zh=category, quantity_basis='edible_portion_before_cooking',
                                nutrition_per_100g=None, nutrition_status='unmapped',
                                source_concept_candidates=sorted(candidates), mapping_status='not_confirmed',
                                provenance='project_authored_selection_2026-09-07',
                                review_status='editorial_draft'))
    recipes = []
    for slug, title, servings, minutes, quantities, retained, process, utensils, steps in RECIPES:
        common = ['菜刀', '砧板', '碗', '厨房秤', '量杯']
        if '蒸锅' in utensils:
            common += ['隔热手套']
        if any('盖' in text for text in steps) and '电饭煲' not in utensils:
            common += ['锅盖']
        recipes.append(dict(recipe_id='DDD-R-' + slug, title=title, servings=servings,
                            estimated_total_minutes=minutes,
                            ingredients=[dict(ingredient_id='DDD-I-' + s, quantity=q, unit='ml' if s == 'milk' else 'g')
                                         for s, q in quantities.items()],
                            water_ml={'retained': retained, 'process_discarded': process},
                            kitchenware_ids=sorted({kitchen[name] for name in common + utensils}),
                            steps=[dict(order=i + 1, text=text) for i, text in enumerate(steps)],
                            declared_allergens=sorted({a for s in quantities for a in ALLERGENS.get(s, [])}),
                            nutrition=None, review_status='draft_not_kitchen_tested',
                            provenance='project_authored_ai_assisted_2026-09-07',
                            safety_reference=SAFETY_URL))
    validate(ingredients, recipes, set(kitchen.values()))
    used = {x['ingredient_id'] for r in recipes for x in r['ingredients']}
    report = dict(ingredients=50, recipe_drafts=20, kitchen_tested_recipes=0,
                  ingredients_used_in_recipes=len(used),
                  reserve_ingredient_ids=sorted({r['ingredient_id'] for r in ingredients} - used),
                  confirmed_nutrition_mappings=0)
    return ingredients, recipes, report


def render(ingredients, recipes, kitchen_concepts):
    names = {r['ingredient_id']: r['name_zh'] for r in ingredients}
    kitchen = {r['concept_id']: r['name_zh'] for r in kitchen_concepts}
    states = {'dry': '干品', 'raw': '生鲜', 'raw_shell_removed': '生、去壳',
              'raw_peeled': '生、去皮', 'raw_deseeded': '生、去籽',
              'raw_peeled_deseeded': '生、去皮去籽', 'raw_trimmed': '生、去根',
              'raw_cored': '生、去核', 'pasteurized': '巴氏杀菌',
              'as_sold': '商品原态', 'roasted': '炒熟'}
    lines = ['# 首批食材与家常菜整理稿', '',
             '50 种食材（含调味品，不含水）与 20 道菜谱。菜谱为本次自行编写的 AI 辅助草稿，尚未实做验证。',
             '不包含营养估算；食材重量为烹饪前可食部净重，鸡蛋按去壳重量计。水单独列出，普通清洗用水不计。',
             '份数是分装数量，不代表完整一餐或营养建议。已列过敏原仅作基础提示，仍需核对实际包装及交叉接触。',
             '', '## 食材目录', '', '| ID | 食材 | 状态 | 别名 |', '|---|---|---|---|']
    for r in ingredients:
        lines.append(f"| {r['ingredient_id']} | {r['name_zh']} | {states[r['state']]} | {'、'.join(r['aliases']) or '—'} |")
    for r in recipes:
        lines += ['', '## ' + r['title'], '', f"{r['recipe_id']} · {r['servings']} 份 · 预计 {r['estimated_total_minutes']} 分钟", '',
                  '用料：' + '；'.join(f"{names[x['ingredient_id']]} {x['quantity']}{x['unit']}" for x in r['ingredients']) + '。',
                  f"入菜饮用水：{r['water_ml']['retained']} ml；焯洗/蒸制工艺用水：{r['water_ml']['process_discarded']} ml（弃去）。",
                  '厨具：' + '、'.join(kitchen[k] for k in r['kitchenware_ids']) + '。', '']
        lines += [f"{s['order']}. {s['text']}" for s in r['steps']]
    lines += ['', '## 来源与校验边界', '',
              '此稿没有复制附件中的菜谱正文，也没有把 Wikidata 食材关系扩写后冒充来源菜谱。',
              '菜名和烹饪方法为常见家常做法，具体文字和用量为本次整理草稿；尚未完成厨房试做、营养关联与正式发布审核。',
              '食材外部概念仅保存同名候选，不自动确认；USDA 数值未绑定到这些食材。',
              f'鸡肉、蛋类及虾的熟制判据参考 [FoodSafety.gov]({SAFETY_URL})，时间仅为估计，不能代替熟制判据。', '']
    return '\n'.join(lines).encode('utf-8')


def jsonl(rows):
    return ('\n'.join(json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows) + '\n').encode('utf-8')
