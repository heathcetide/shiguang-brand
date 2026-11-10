"""Route every review gap to evidence work; classification never grants approval."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

# Every known gap has an explicit owner and required evidence. New gaps fail closed.
RULES = {
    'source_url_missing': ('source', '来源维护人', '查锁定源码、原始记录与版本；缺原出处时请来源方补证，不以搜索到同名页面替代'),
    'declared_license_missing': ('license', '来源/许可审核人', '补原版本许可文本、权利主体与适用范围'),
    'redistribution_license_review': ('license', '许可审核人', '确认再分发/修改/署名要求及正式包适用性；公开可见不等于许可通过'),
    'identity_aliases_and_classification_review': ('identity', '数据审核人', '确认身份、别名、分类及重复概念；不得仅凭同名合并'),
    'ingredient_form_identity_and_state_review': ('identity', '数据审核人', '确认食材形态、生熟、部位及加工状态'),
    'dish_identity_and_method_relationship_review': ('recipe', '配方审核人', '确认菜品与方法关系及重复/变体归属'),
    'recipe_method_missing': ('recipe', '配方审核人', '补有来源许可的完整方法；不得从菜名编造配方'),
    'ingredient_form_scope_review': ('nutrition', '营养审核人', '核对营养样品和目标食材形态、部位、生熟及可食部范围'),
    'nutrition_reference_missing': ('nutrition', '营养审核人', '补可追溯样品、单位和适用范围；未知不填零、不套近似食材'),
    'nutrition_scope_review': ('nutrition', '营养审核人', '核对既有营养参考的适用范围与绑定依据'),
    'professional_nutrition_review': ('nutrition', '营养审核人', '逐项核对原始观测值、单位、每100g基准及营养计算'),
    'source_observations_missing': ('nutrition', '来源/营养审核人', '补原样品观测值与字段定义，不用链接或估算值代替'),
    'servings': ('quantity', '配方审核人', '确认整批产量/食用人数、条件及份量口径；无法确认保持未知'),
    'ingredient_identity_or_exact_quantity': ('quantity', '配方/数据审核人', '逐行确认身份、用量、单位与替代/共享关系；字段补证不整体清除缺项'),
    'ingredient_mapping_and_amount_review': ('quantity', '配方/数据审核人', '审核全部食材行，包括已解析值、补证字段、可选项与计量依据'),
    'equipment': ('equipment', '配方审核人', '从步骤补厨具依据，再确认实际设备可用性'),
    'capacity_and_substitution_review': ('equipment', '厨具审核人', '确认容量、适配和替代限制，不仅按名称匹配'),
    'equipment_capacity_and_task_duration_review': ('equipment', '配方审核人及实测人', '确认任务依赖、容量、并发、实际总耗时'),
    'kitchen_execution_review': ('real_trial', '配方审核人及实测人', '实际制作，记录份量、原料扣减、安全步骤与偏差'),
    'storage_transport_reheat_review': ('real_trial', '配方审核人及实测人', '提供储存、运输、复热依据和适用条件；保留跨日实测'),
}


def measurement_route(source):
    if re.search(r'比例|体积|倍|量\s*=|每\s*\d', source):
        return 'relation', '确认关系的基准、单位、批次和条件；不能直接转固定量'
    if re.search(r'\+|(?:个|片|把|卷|盒|包|瓶).*\d.*(?:g|克|ml)|\d.*(?:g|克).*\d.*(?:g|克)', source, re.I):
        return 'compound', '核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和'
    if re.search(r'或|可不|可选|按|口味|没过|浸没|根据|选择|看|建议|即可|最佳|少辣|中辣|大辣|人多|以上|更多|不放|依次|推荐', source):
        return 'conditional', '确认选项、适用条件及实际用量；保留未知与可选状态'
    if re.search(r'约|大半|小半|几滴|两三|差不多', source):
        return 'approximate', '确认来源计量口径；约数和模糊量不得变为精确克重'
    return 'source_structure', '回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核'


def identity_route(source):
    if '容器' in source:
        return 'equipment_role', '核对是否厨具及目录角色；不得当食材绑定营养或计入摄入'
    if re.search(r'混合|肉类|蔬菜|菜类|菜码|奶制品|其他调料|风味调料|面类|白[（(]红|小米辣干辣椒|菜椒甜椒|方法二', source):
        return 'group_identity', '确认混合组/替代关系及成员；不能把组总量分配给单项'
    if re.search(r'1\s*:\s*1|方法一|葱姜末|两个火枪腿|江南米|北方大米|五珠|其中', source):
        return 'identity_source_structure', '回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断'
    return 'identity_scope', '确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材'


def classify(inventory):
    records, lines = [], []
    for row in inventory['records']:
        tasks = []
        for gap in row['missing_or_unverified']:
            if gap not in RULES:
                raise ValueError('Unclassified gap: ' + gap)
            category, owner, evidence = RULES[gap]
            tasks.append(dict(gap=gap, category=category, owner=owner, required_evidence=evidence,
                              human_review_required=True, status='pending_review'))
        records.append(dict(kind=row['kind'], id=row['id'], name=row['name'],
                            record_sha256=row['record_sha256'], tasks=tasks,
                            automatic_execution_allowed=False))
        if row['kind'] != 'recipe_method':
            continue
        corrections = {line['line_id']: line['fields'] for line in row['confirmed_source_fields'].get('ingredient_lines', [])}
        for line in row['record']['ingredients']:
            fields = corrections.get(line['line_id'], {})
            for gap, pending in [('measurement', line.get('measurement', {}).get('kind') == 'unparsed' and 'measurement' not in fields),
                                 ('identity', line.get('mapping_status') == 'unresolved' and 'mapping' not in fields)]:
                if not pending:
                    continue
                source = line.get('original_source_text', line['source_text'])
                category, question = measurement_route(source) if gap == 'measurement' else identity_route(source)
                lines.append(dict(method_id=row['id'], line_id=line['line_id'], title=row['record']['title'],
                                  gap=gap, category=category, source=source, question=question,
                                  owner='配方审核人' if gap == 'measurement' else '数据审核人',
                                  source_url=row['record']['source'].get('source_url'),
                                  human_review_required=True, automatic_execution_allowed=False,
                                  status='pending_review'))
    if len({(r['kind'], r['id']) for r in records}) != len(records):
        raise ValueError('Duplicate review record')
    if len({(r['line_id'], r['gap']) for r in lines}) != len(lines):
        raise ValueError('Duplicate line task')
    gap_counts = dict(sorted(Counter(t['gap'] for r in records for t in r['tasks']).items()))
    if gap_counts != inventory['gap_counts']:
        raise ValueError('Gap summary does not match records')
    return dict(format_version=1, base_archive_sha256=inventory['base_archive_sha256'],
                supplement_sha256=inventory['supplement_sha256'],
                inventory_sha256=hashlib.sha256(json.dumps(inventory, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
                category_counts=dict(sorted(Counter(t['category'] for r in records for t in r['tasks']).items())),
                gap_counts=gap_counts,
                line_counts=dict(sorted(Counter(r['gap'] for r in lines).items())),
                line_category_counts=dict(sorted(Counter(r['category'] for r in lines).items())),
                semantic_approval=False, records=records, line_tasks=lines)


def markdown(report):
    out = ['# #187 完整缺项分类与人工审核清单', '',
           '生成内容；用 review_worklist.py 从当前审核清单重建。分类是待办路由，不是审核结论。', '',
           f"覆盖 {len(report['records'])} 条记录；同一记录可有多个缺项，分类次数不能相加当作记录数。", '',
           '机器清单逐记录保留 kind/id/原记录摘要及每个缺项的责任角色、所需证据和待审核状态。所有语义批准仍需人工签署。', '',
           '仓库内可做：锁定原文定位、字段解析修复、证据挂接、摘要/单位/引用一致性检查。',
           '需人工：来源权利与许可、身份/形态、份量与混合/替代关系、营养适用性、厨具容量与配方语义。',
           '需实际资源：厨房/跨日验证，以及正式包目标环境导入、幂等、保留用户修改和回滚。',
           '未取得证据的记录保持不可自动执行；不通过分类删除、批准或移出正式验收范围。', '',
           '## 全部记录级缺项', '', '| 缺项 | 次数 | 类别 | 审核责任 | 必须补的证据 |', '|---|---:|---|---|---|']
    for gap, count in sorted(report['gap_counts'].items()):
        category, owner, evidence = RULES[gap]
        out.append(f'| `{gap}` | {count} | {category} | {owner} | {evidence} |')
    out += ['', '## 剩余食材行问题', '',
            '仅以下明细对应未解析测量和未解析身份；已解析但有条件、缺失量、营养与整道配方审核仍由上表覆盖。',
            '同一行可同时有两类问题；分类依据原文保守分流，人工可修订类别，必须保留稳定行 ID。', '',
            '| 问题 | 类别 | 菜谱 / 行 ID | 保留原文 | 审核问题 |', '|---|---|---|---|---|']
    for line in report['line_tasks']:
        source = line['source'].replace('|', '\\|').replace('\n', ' ')
        out.append(f"| {line['gap']} | {line['category']} | {line['title']} / `{line['line_id']}` | {source} | {line['question']} |")
    out += ['', '## 审核结果模板', '', '每条决定记录：记录 kind/id、line_id（如适用）、原记录 SHA、缺项、原文/来源版本、证据链接与摘要、审核人及角色、上海时间、通过/退回/补证、理由、适用范围、复核人。',
            '“通过字段”不等于“批准配方执行”；执行资格须单独审核整道配方所有缺项。缺审核人、时间、证据或范围的决定仍为待审核。', '']
    return '\n'.join(out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inventory', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--markdown', type=Path, required=True)
    args = parser.parse_args()
    if len({p.resolve() for p in (args.inventory, args.output, args.markdown)}) != 3:
        parser.error('Input and outputs must differ')
    result = classify(json.loads(args.inventory.read_text(encoding='utf8')))
    with args.output.open('x', encoding='utf8') as out:
        out.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    args.markdown.write_text(markdown(result), encoding='utf8')
