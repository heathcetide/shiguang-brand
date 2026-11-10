"""Original platform activities and FAQ. No fabricated users, feedback or outcomes."""
import json
from collections import Counter
from pathlib import Path

VERSION = 'community-content-2026-09-15.2'
ACTIVITIES = [
    ('inventory-week', '七天食材盘点：从冰箱里选一道菜', 0, 7, 'tomato-egg',
     '参与方式：任选一天盘点家中现有食材，记录名称、数量和需要优先使用的项目；从菜谱中选一道能利用现有食材的菜。\n分享模板：现有食材／打算做什么／还缺什么／实际使用后的记录。可在本活动评论区交流，也可以在“寻味”发布并注明活动名称。\n只记录实际拥有和使用的食材，不必每天打卡。请勿公开住址、订单或其他个人信息。'),
    ('weigh-one-recipe', '一起称一次：给家常菜留下清楚的用量', 0, 14, 'carrot-egg',
     '参与方式：选一道准备实际制作的菜，记录各原料用量、称量状态和计划份数；鸡蛋注明是否去壳，谷物注明干重或熟重。\n分享模板：菜名／原料与用量／称量状态／整份可分几份／实际做法调整。没有秤也可参与讨论，但“一个”“一勺”不要自行换成确定克数。\n本活动收集使用体验与配方记录，不据此认定为实测营养。'),
    ('tool-sharing', '周末厨具交流：说清你用什么完成这道菜', 3, 4, 'garlic-broccoli',
     '参与方式：选择一道菜，分享实际使用的锅具和工具，以及哪一步会用到。尝试替代工具时，请说明容量、加热方式和实际调整。\n分享模板：菜名／步骤／使用厨具／有无替代／完成后发现的问题。欢迎在评论区提出工具适配问题。\n以器具说明书和实际操作条件为准；未经验证的替代方案保持待确认。'),
    ('recipe-gap-feedback', '菜谱查漏行动：让一份做法更容易照着做', 7, 7, 'tomato-noodles',
     '参与方式：阅读或实际使用一份系统菜谱，找出妨碍理解的缺项，例如份数、原料状态、模糊用量或厨具说明。\n反馈模板：菜谱名称／哪一句有问题／缺少什么／有依据的建议。欢迎附上来源链接；不要把猜测写成已确认事实。\n反馈在活动评论区公开交流，不保证每条建议都会直接修改菜谱。'),
]
FAQ = [
    ('find-alias', '为什么搜“西红柿”也能找到“番茄”？', 'tomato-egg',
     '系统将食材的通用名称和别名关联到概念入口，帮助不同称呼检索到相关内容。部分别名有地区歧义，可能对应多个概念；请结合名称、部位和状态选择，不能只凭同名认定为同一种食材。'),
    ('nutrition-gap', '菜谱显示“营养待补全”，是不是热量为零？', None,
     '不是。“待补全”表示某些原料、用量或来源营养还不能可靠匹配。缺失值保留为空，不代表零，也不会拿已知原料的小计冒充完整配方。可在菜谱详情查看具体缺项。'),
    ('whole-serving', '整份营养和每份营养有什么区别？', 'tomato-egg',
     '整份值按配方全部原料和投料量汇总；已知配方份数时，再除以份数得到每份估算。例如整份分成两份，每份是整份值的一半。实际分食不均时，个人吃到的量也不同。缺少可靠份数时不提供每份换算。'),
    ('edible-weight', '原料重量按去皮前还是去皮后记录？', 'carrot-egg',
     '以菜谱中注明的称量条件为准。本批估算使用烹调前可食部重量，例如去壳蛋液，而不是连壳重量。若你记录的是毛重、熟重或泡发后重量，应注明状态，不要直接套用另一种状态的参考值。'),
    ('ml-not-grams', '300 毫升牛奶可以直接当作 300 克吗？', None,
     '在这套数据中不会这样处理。毫升描述体积，克描述质量，换算需要适用的密度依据，或实际称量记录。因此原方为毫升而缺少依据时保留缺项；也不把其他乳脂类型的样品直接当作同一样品。'),
    ('nutrition-sources', '菜谱的营养数值来自哪里？', 'tomato-noodles',
     '当前补充包使用 USDA 和台湾食药署的具体食物样品记录，与原料形态和重量关联。菜谱详情中的“称量条件与营养来源”可查看样品和来源。它们是注明条件下的参考估算，不是这盘成品的检测报告。'),
    ('cooked-yield', '为什么没有所有菜的“熟食每 100 克”营养？', None,
     '投料总重量不等于出锅重量；加水、蒸发和弃汤等会影响成品重量。本批没有足够的成品重量与烹调损失依据，因此不直接把生原料汇总换算为熟食每 100 克。'),
    ('tool-roles', '“必需厨具”和“可替代厨具”怎么理解？', 'garlic-broccoli',
     '必需关系针对当前选择的做法及其明确步骤；可替代需要额外的适配依据。仅仅名称相近，不说明容量、功率或加热方式相同。没有确认替代能力时，系统保留待确认，而不是承诺任何锅都能直接替换。'),
    ('recipe-variants', '同一道菜为什么会有不同做法？', None,
     '菜品概念提供统一入口，具体做法保留原料、步骤和来源差异。主要做法按数据完整度与可执行性选择；有其他做法时可以在详情切换。主要做法的营养估算不能直接套到另一份原料和用量不同的做法。'),
    ('post-recipe', '分享做菜记录时，需要提供哪些信息？', None,
     '建议写上菜名、实际原料和用量、称量状态、步骤调整及份数，并关联对应的系统菜谱。只描述真实做过或准备做的事；转载内容请注明来源。照片和记录不必包含个人位置、订单或联系方式。'),
    ('event-participation', '怎么参与平台活动？一定要每天打卡吗？', None,
     '先查看活动的起止时间和参与说明，登录后可报名，并在评论区交流。是否连续记录以该活动说明为准；本批活动均是自愿的线上交流，不设费用、奖品、排名或完成证明。尚未开始的活动可提前报名。'),
    ('portable-data', '导出的数据包会包含我的账号和私人记录吗？', None,
     '本次可导入包包含基础概念、菜谱、厨具、营养参考，以及平台编写的活动和常见问答。账号凭据、个人库存、饮食记录、用户评论、点赞和报名名单不包含在内。导入时把平台内容绑定到目标系统已有的管理员账号，并重新映射关联 ID。'),
]


def build():
    posts = []
    for slug, title, start, duration, recipe, body in ACTIVITIES:
        posts.append({'id': 'PLATFORM:activity:' + slug, 'category': '活动', 'title': title,
            'content': f'{title}\n\n【平台发起 · 线上自愿交流】\n{body}\n\n活动以页面显示的开始和结束时间为准，无费用、奖品或排名；报名和互动数来自真实操作。',
            'start_offset_days': start, 'duration_days': duration, 'linked_method_id': 'METHOD:DDD-R-' + recipe,
            'answer': None})
    for slug, title, recipe, answer in FAQ:
        posts.append({'id': 'PLATFORM:faq:' + slug, 'category': '问答', 'title': title,
            'content': f'{title}\n\n【平台常见问题】\n本条由平台整理，参考答复见评论区。欢迎补充实际使用中遇到的问题；不是用户提问记录，也不代表已获专家审核。',
            'linked_method_id': 'METHOD:DDD-R-' + recipe if recipe else None,
            'answer': '【平台参考答复】\n' + answer})
    root = Path(__file__).resolve().parents[2] / 'artifacts/base-data/concept-enrichment-2026-09-15.2'
    methods = json.loads((root / 'recipe-inputs.json').read_text(encoding='utf8'))
    nutrition = json.loads((root / 'recipe-nutrition.json').read_text(encoding='utf8'))
    equipment = json.loads((root / 'equipment-role-updates.json').read_text(encoding='utf8'))
    complete = {r['method_id'] for r in nutrition if r['per_serving'] is not None}
    recipes = sorted((m for m in methods if m['id'] in complete), key=lambda m: (len(m['ingredients']), m['id']))
    ingredients = Counter(name for m in methods for name in {i['name'] for i in m['ingredients']})
    tools = Counter(e['name'] for e in equipment)
    ranked = [
        ('recipe-ingredient-count', '原料项数榜：8 道营养参考齐全的家常菜',
         [f"{m['title']}：{len(m['ingredients'])} 项原料" for m in recipes], recipes[0]['id'],
         '从本批四项主要营养可估算的 8 道菜中，按原料条目数从少到多排列，含调味料；同数按稳定做法 ID 排列。原料少不等于更健康或制作更快。'),
        ('ingredient-frequency', '常见原料覆盖榜：20 道家常菜样本',
         [f'{name}：出现在 {count}/20 道菜中' for name, count in sorted(ingredients.items(), key=lambda x: (-x[1], x[0]))[:10]], None,
         '每道菜对同一名称只计一次，包含油、盐等调味料；按出现菜谱数降序，同数按名称排列。这是本批配方覆盖统计，不是全站消费量或人气排行。'),
        ('equipment-frequency', '必需厨具出场榜：按明确步骤统计',
         [f'{name}：{count} 条做法关联' for name, count in sorted(tools.items(), key=lambda x: (-x[1], x[0]))], None,
         '仅统计本批 20 道家常菜中有明确步骤证据的 18 条必需厨具关系，按关联数降序。未写明的工具不计入，出现较少不代表不需要。'),
    ]
    for slug, title, lines, method_id, rule in ranked:
        posts.append({'id': 'PLATFORM:ranking:' + slug, 'category': '榜单', 'title': title,
            'content': title + '\n\n【平台数据榜单】\n' + '\n'.join(f'{index + 1}. {line}' for index, line in enumerate(lines))
                + '\n\n统计口径：' + rule + '\n数据版本：concept-enrichment-2026-09-15.2。页面热度来自本帖真实互动，与上述数据排序分开计算。',
            'linked_method_id': method_id, 'answer': None})
    return {'version': VERSION, 'content_origin': 'platform_editorial', 'author_policy': 'existing_admin_only',
        'event_time_policy': 'relative_to_first_activation_utc; never_shift_on_reimport', 'posts': posts}


if __name__ == '__main__':
    output = Path('artifacts/base-data') / (VERSION + '.json')
    output.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(output)
