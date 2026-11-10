"""Application-facing dataset contract with explicit feature readiness and demo fixtures."""
from collections import defaultdict
import json
import re
import unicodedata

SAFE_KITCHEN_ALIASES = {
 '炒锅': ['中式炒锅', 'wok'], '电饭煲': ['电饭锅', 'rice cooker'],
 '菜刀': ['切菜刀', 'cleaver'], '厨房秤': ['电子秤', 'kitchen scale'],
 '厨房温度计': ['食物温度计', 'food thermometer'], '砧板': ['菜板', '切菜板', 'cutting board'],
 '筷子': ['chopsticks'], '空气炸锅': ['air fryer'], '烤箱': ['电烤箱', 'oven'],
 '微波炉': ['microwave oven'], '蒸锅': ['steamer pot'], '蒸笼': ['蒸屉', 'bamboo steamer'],
 '平底锅': ['煎锅', 'frying pan', 'skillet'], '压力锅': ['高压锅', '压力快锅', 'pressure cooker'],
 '电压力锅': ['electric pressure cooker'], '电水壶': ['电热水壶', 'electric kettle'],
 '汤勺': ['汤匙', 'ladle'], '碗': ['饭碗', 'bowl'], '盘': ['餐盘', '碟', 'plate'],
 '量杯': ['measuring cup'], '量勺': ['measuring spoon'], '削皮器': ['刨皮器', 'peeler'],
 '漏勺': ['slotted spoon'], '漏斗': ['funnel'], '擀面杖': ['rolling pin'],
 '手动打蛋器': ['whisk'], '隔热手套': ['烤箱手套', 'oven mitt'], '锅盖': ['pot lid'],
}


def norm(value):
    return unicodedata.normalize('NFKC', value).strip()


def plain(value):
    value = re.sub(r'!\[[^\]]*\]\([^\n]*?\)', '', value)
    value = re.sub(r'\[([^\]]+)\]\([^\n]*?\)', r'\1', value)
    return value.replace('**', '').replace('`', '').strip()


def parse_line(text):
    text = norm(plain(text))
    match = re.match(r'^(.*?)\s*[=＝]\s*(.+)$', text)
    if not match:
        match = re.match(r'^(.*?)\s+(\d.*)$', text)
    if match:
        name, amount = match[1].strip(), match[2].strip()
    else:
        name, amount = text, None
    # Only an entire literal numeric measurement is machine-actionable.
    quantity, unit = None, None
    literal = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升)', amount or '', re.I)
    if literal:
        quantity = float(literal[1])
        unit = {'克': 'g', '千克': 'kg', '毫升': 'ml'}.get(literal[2].lower(), literal[2].lower())
        if unit == 'kg':
            quantity, unit = quantity * 1000, 'g'
    return name, amount, quantity, unit


def compile_data(ingredients, kitchen, kitchen_aliases, drafts, source_recipes):
    audit = []
    clean_ingredients = []
    for r in ingredients:
        # Only project-authored exact aliases are promoted; imported aliases stay in the audit.
        aliases = sorted(set(map(norm, r['aliases']))) if r['ingredient_id'].startswith('DDD-I-') else []
        for alias in r['aliases']:
            if norm(alias) not in aliases:
                audit.append(dict(kind='ingredient_alias', id=r['ingredient_id'], value=alias, reason='source_alias_not_semantically_verified'))
        clean_ingredients.append(dict(id=r['ingredient_id'], name=norm(r['name']), aliases=aliases,
                                      category=r['category_zh'], state=r['state'], nutrition=None,
                                      nutrition_status='unknown', source_id=r['source_id'], source_url=r['source_url'],
                                      source_license=r['source_license'], usage=['catalogue_lookup']))
    names = defaultdict(set)
    for r in clean_ingredients:
        for name in [r['name'], *r['aliases']]:
            names[norm(name)].add(r['id'])
    clean_kitchen = []
    for r in kitchen:
        accepted = []
        for a in kitchen_aliases:
            if a['concept_id'] != r['concept_id']:
                continue
            if a['alias'] in SAFE_KITCHEN_ALIASES.get(r['name_zh'], []):
                accepted.append(a['alias'])
            else:
                audit.append(dict(kind='kitchenware_alias', id=r['concept_id'], value=a['alias'], reason='not_an_approved_exact_alias'))
        clean_kitchen.append(dict(id=r['concept_id'], name=r['name_zh'], category=r['category_zh'],
                                 aliases=sorted(set(accepted)), source_url=r['source_url'],
                                 source_release=r['source_release'], automatic_substitution_allowed=False))
    recipes = []
    ingredient_names = {r['id']: r['name'] for r in clean_ingredients}
    for r in drafts:
        recipes.append(dict(id=r['recipe_id'], title=r['title'], source='project_draft', source_url=None,
                            source_license=None, servings=r['servings'], estimated_minutes=r['estimated_total_minutes'],
                            ingredients=[dict(ingredient_id=i['ingredient_id'], name=ingredient_names[i['ingredient_id']],
                                              amount_text=f"{i['quantity']} {i['unit']}", quantity=i['quantity'], unit=i['unit']) for i in r['ingredients']],
                            steps=[s['text'] for s in r['steps']], kitchenware_ids=r['kitchenware_ids'],
                            water_ml=r['water_ml'], declared_allergens=r['declared_allergens'],
                            nutrition=None, can_display=True, has_structured_amounts=True,
                            cooking_review_status='not_kitchen_tested', automatic_inventory_write_allowed=False))
    for r in source_recipes:
        items = []
        for line in r['ingredients']:
            name, amount, quantity, unit = parse_line(line['source_text'])
            candidates = names.get(name, set())
            id_ = next(iter(candidates)) if len(candidates) == 1 else None
            items.append(dict(ingredient_id=id_, name=name, amount_text=amount, quantity=quantity, unit=unit,
                              source_text=line['source_text']))
            if id_ is None or quantity is None:
                audit.append(dict(kind='recipe_ingredient', id=r['recipe_id'], value=line['source_text'], reason='unresolved_name_or_quantity'))
        recipes.append(dict(id=r['recipe_id'], title=r['title'], source='howtocook', source_url=r['source_url'],
                            source_license=r['source_license'], source_revision=r['source_revision'], source_sha256=r['source_sha256'],
                            servings=None, estimated_minutes=None, ingredients=items,
                            steps=[plain(s['source_text']) for s in r['steps']],
                            source_operation_text=r['operation_text'], source_calculation_text=r['calculation_text'],
                            source_required_materials_text=r['required_materials_and_tools_text'], source_notes=r['additional_notes_text'],
                            kitchenware_ids=[], water_ml=None, declared_allergens=None, nutrition=None,
                            can_display=True, has_structured_amounts=False,
                            cooking_review_status='source_content_needs_review', automatic_inventory_write_allowed=False))
    return clean_ingredients, recipes, clean_kitchen, audit


def fixtures(recipes):
    ids = {r['id'] for r in recipes}
    links = ['DDD-R-tomato-egg', 'DDD-R-garlic-broccoli', 'DDD-R-pumpkin-millet',
             'DDD-R-pepper-chicken', 'DDD-R-tomato-tofu', 'DDD-R-sweetpotato-rice']
    assert set(links) <= ids
    accounts = [dict(id='bootstrap-admin', username='admin', nickname='管理员', role='admin',
                     environment='all', password_env='DDD_BOOTSTRAP_ADMIN_PASSWORD',
                     must_change_password=True, is_demo=False)]
    for i, name in enumerate(['家常菜演示', '厨房练习演示', '备餐演示'], 1):
        accounts.append(dict(id=f'demo-user-{i}', username=f'ddd_demo_{i}', nickname=name, role='user',
                             environment='all', password_env=f'DDD_DEMO_PASSWORD_{i}',
                             must_change_password=True, is_demo=True))
    drafts = {r['id']: r for r in recipes if r['source'] == 'project_draft'}
    # Keep the first six post IDs linked to the same recipes across package versions.
    ordered_ids = links + sorted(set(drafts) - set(links))
    posts = []
    for topic in range(5):
        for recipe_id in ordered_ids:
            r = drafts[recipe_id]
            title = r['title']
            materials = '、'.join(i['name'] for i in r['ingredients'][:3])
            amounts = '；'.join(f"{i['name']} {i['amount_text']}" for i in r['ingredients'][:3])
            texts = [
                f'把{title}加入这周的做饭清单。先看看家里有没有{materials}，缺的再补进采购单，避免重复买菜。',
                f'{title}备料笔记：{amounts}。这是菜谱原始 {r["servings"]} 份的用量，准备前先核对实际吃饭人数，调味料也单独放好。',
                f'准备做{title}时，先把整份步骤读一遍，再安排清洗、称量和切配。把需要先处理的材料摆在顺手的位置，下锅时会从容一些。',
                f'{title}的份量怎么安排？关联菜谱按 {r["servings"]} 份整理。如果还搭配其他菜，可以先按整餐人数规划采购，不必每一道都做满份。',
                f'聊聊{title}：你更在意口感、调味，还是准备过程是否省事？可以分享自己的做法差异，具体用量和步骤见关联菜谱。',
            ]
            i = len(posts)
            posts.append(dict(id=f'demo-post-{i+1}', author_id=f'demo-user-{i % 3 + 1}', category='寻味',
                              content=texts[topic], recipe_id=recipe_id, images=[], likes_count=0,
                              views_count=0, is_demo=True, environment='all'))
    comments = [dict(id=f'demo-comment-{i+1}', post_id=p['id'], author_id=f'demo-user-{(i+1)%3+1}',
                     content='【演示评论】可以在关联菜谱中查看准备步骤。', is_demo=True, environment='all')
                for i, p in enumerate(posts[:6])]
    inventory = [dict(id=f'demo-inventory-{i+1}', owner_id=f'demo-user-{i % 3 + 1}',
                      ingredient_id=ingredient_id, quantity=quantity, unit='g',
                      expires_in_days=3, storage_location='冷藏', is_demo=True, environment='all')
                 for i, (ingredient_id, quantity) in enumerate([
                     ('DDD-I-tomato', 500), ('DDD-I-broccoli', 350), ('DDD-I-pumpkin', 250),
                     ('DDD-I-chicken', 250), ('DDD-I-tofu', 250), ('DDD-I-sweetpotato', 200)])]
    favorites = [dict(id=f'demo-favorite-{i+1}', owner_id=p['author_id'], recipe_id=p['recipe_id'],
                      is_demo=True, environment='all') for i, p in enumerate(posts[:6])]
    return dict(accounts=accounts, posts=posts, comments=comments, inventory=inventory, favorites=favorites,
                policy=dict(default_environment='all', include_examples_by_default=True,
                            passwords_in_package=False, on_existing_record='skip',
                            metrics_exclude_demo=True, relative_dates_at_import=True))


def validate(ingredients, recipes, kitchen, initial):
    def ids(rows):
        result = {r['id'] for r in rows}
        if len(result) != len(rows):
            raise ValueError('Duplicate clean dataset ID')
        return result
    ingredient_ids, recipe_ids, kitchen_ids = ids(ingredients), ids(recipes), ids(kitchen)
    account_ids, post_ids = ids(initial['accounts']), ids(initial['posts'])
    ids(initial['comments'])
    for r in recipes:
        if not r['title'] or len(r['steps']) < 2 or not r['ingredients']:
            raise ValueError('Incomplete clean recipe')
        if not set(r['kitchenware_ids']) <= kitchen_ids:
            raise ValueError('Unknown clean kitchenware reference')
        for i in r['ingredients']:
            if i['ingredient_id'] is not None and i['ingredient_id'] not in ingredient_ids:
                raise ValueError('Unknown clean ingredient reference')
        if r['automatic_inventory_write_allowed']:
            raise ValueError('Unreviewed automatic inventory write')
    for a in initial['accounts']:
        if any(k in a for k in ('password', 'password_hash', 'token')) or not a['password_env']:
            raise ValueError('Packaged account secret')
        if a['is_demo'] and (a['role'] != 'user' or a['environment'] != 'all'):
            raise ValueError('Unsafe demo account scope')
    for p in initial['posts']:
        if p['author_id'] not in account_ids or p['recipe_id'] not in recipe_ids or not p['is_demo']:
            raise ValueError('Unknown demo post reference')
    for c in initial['comments']:
        if c['author_id'] not in account_ids or c['post_id'] not in post_ids:
            raise ValueError('Unknown demo comment reference')
    for i in initial['inventory']:
        if i['owner_id'] not in account_ids or i['ingredient_id'] not in ingredient_ids:
            raise ValueError('Unknown demo inventory reference')
    for f in initial['favorites']:
        if f['owner_id'] not in account_ids or f['recipe_id'] not in recipe_ids:
            raise ValueError('Unknown demo favorite reference')


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description='Validate exported clean JSON files without accessing a database.')
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    data = [json.loads((args.directory / name).read_text(encoding='utf-8'))
            for name in ('ingredients.json', 'recipes.json', 'kitchenware.json', 'initial-data.json')]
    validate(*data)
    print(json.dumps(dict(ingredients=len(data[0]), recipes=len(data[1]), kitchenware=len(data[2]),
                          accounts=len(data[3]['accounts']), posts=len(data[3]['posts'])), ensure_ascii=True))
