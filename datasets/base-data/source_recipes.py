"""Pinned HowToCook text projection; no DB writes, inferred amounts or nutrition."""
from collections import Counter, defaultdict
import hashlib
import json
import re
from urllib.parse import quote

GROUPS = {'aquatic', 'breakfast', 'dessert', 'meat_dish', 'semi-finished', 'soup', 'staple', 'vegetable_dish'}


def section(markdown, title):
    match = re.search(r'^##\s+' + re.escape(title) + r'\s*$', markdown, re.M)
    if not match:
        return ''
    tail = markdown[match.end():]
    end = re.search(r'^##\s+', tail, re.M)
    return (tail[:end.start()] if end else tail).strip()


def no_images(text):
    # Preserve reference text and links but never embed media into the output.
    text = re.sub(r'!\[[^\]]*\]\([^\n]*?\)', '', text)
    text = re.sub(r'<img\b[^>]*>', '', text, flags=re.I)
    return text.strip()


def steps(text):
    # Split only top-level markers. Indented bullets and paragraph continuations stay intact.
    matches = list(re.finditer(r'^(?:\d+[.、)]|[-*+])\s+', text, re.M))
    if not matches:
        return []
    return [dict(order=i + 1, source_text=text[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)].strip())
            for i, m in enumerate(matches)]


def project(archive, source, catalogue):
    revision = source['revision']
    root = 'HowToCook-' + revision + '/'
    names = sorted(n for n in archive.namelist() if n.startswith(root + 'dishes/') and n.endswith('.md'))
    index = defaultdict(set)
    for r in catalogue:
        for name in [r['name'], *r['aliases']]:
            index[name].add(r['ingredient_id'])
    recipes, decisions = [], []
    for member in names:
        path = member[len(root):]
        group = path.split('/')[1]
        raw = archive.read(member)
        text = raw.decode('utf-8-sig').replace('\r\n', '\n')
        required = no_images(section(text, '必备原料和工具'))
        calculation = no_images(section(text, '计算'))
        operation = no_images(section(text, '操作'))
        title_match = re.search(r'^#\s+(.+)', text, re.M)
        title = title_match[1].removesuffix('的做法').strip() if title_match else ''
        parsed_steps = steps(operation)
        lines = re.findall(r'^\s*[-*+]\s+(.+)$', calculation or required, re.M)
        if group not in GROUPS:
            reason = 'excluded_group'
        elif not title or not required or not calculation or len(lines) < 2 or len(parsed_steps) < 2:
            reason = 'incomplete_or_unsupported_structure'
        else:
            reason = 'included_source_recipe'
        decisions.append(dict(source_path=path, reason=reason))
        if reason != 'included_source_recipe':
            continue
        ingredients = []
        for line in lines:
            # Only propose matches where the complete name precedes an explicit amount boundary.
            candidates = set()
            for name, ids in index.items():
                if line.startswith(name) and re.match(r'^(?:\s*[=＝]|\s+\d|\s*$)', line[len(name):]):
                    candidates.update(ids)
            ingredients.append(dict(source_text=line, candidate_ingredient_ids=sorted(candidates),
                                    ingredient_id=None, quantity=None, unit=None, review_status='needs_mapping_review'))
        id_ = 'HTC-' + hashlib.sha256(path.encode('utf-8')).hexdigest()[:20]
        recipes.append(dict(recipe_id=id_, title=title, category=group,
                            source='howtocook', source_revision=revision, source_path=path,
                            source_url='https://github.com/Anduin2017/HowToCook/blob/' + revision + '/' + quote(path, safe='/'),
                            source_sha256=hashlib.sha256(raw).hexdigest(), source_license=source['declared_license'],
                            required_materials_and_tools_text=required, calculation_text=calculation,
                            operation_text=operation, additional_notes_text=no_images(section(text, '附加内容')),
                            ingredients=ingredients, steps=parsed_steps, servings=None, nutrition=None,
                            kitchenware_ids=[], review_status='source_text_pending_mapping_and_cooking_review'))
    validate(recipes, {r['ingredient_id'] for r in catalogue})
    return recipes, decisions, dict(source_documents=len(names), source_recipes=len(recipes),
                                    decisions=dict(Counter(d['reason'] for d in decisions)),
                                    category_counts=dict(sorted(Counter(r['category'] for r in recipes).items())),
                                    ingredient_lines=sum(len(r['ingredients']) for r in recipes),
                                    lines_with_candidates=sum(bool(i['candidate_ingredient_ids']) for r in recipes for i in r['ingredients']),
                                    confirmed_ingredient_mappings=0, kitchen_tested_recipes=0)


def validate(recipes, ingredient_ids):
    if not recipes or len({r['recipe_id'] for r in recipes}) != len(recipes):
        raise ValueError('Empty or duplicate source recipes')
    for r in recipes:
        if r['nutrition'] is not None or r['servings'] is not None:
            raise ValueError('Inferred source recipe nutrition or servings')
        if r['review_status'] != 'source_text_pending_mapping_and_cooking_review':
            raise ValueError('Unreviewed source recipe promoted')
        if len(r['steps']) < 2 or not r['calculation_text'] or not r['required_materials_and_tools_text']:
            raise ValueError('Incomplete source recipe')
        if r['source_revision'] not in r['source_url'] or not re.fullmatch('[0-9a-f]{64}', r['source_sha256']):
            raise ValueError('Missing pinned recipe provenance')
        for item in r['ingredients']:
            if not set(item['candidate_ingredient_ids']) <= ingredient_ids:
                raise ValueError('Orphan source recipe ingredient candidate')
            if any(item[k] is not None for k in ('ingredient_id', 'quantity', 'unit')):
                raise ValueError('Source recipe quantity or mapping promoted')


def jsonl(rows):
    return ('\n'.join(json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows) + '\n').encode('utf-8')


def render(recipes):
    lines = ['# 扩展来源菜谱库', '', f'收录 {len(recipes)} 篇固定版本 HowToCook 菜谱；另有 20 道项目草稿，不能直接相加为去重菜式数量。',
             '保留来源用量与操作，不复制简介中的营养宣传或热量估算。未完成份量标准化、食材/厨具映射及实做审核。',
             '原文可能有缺料、模糊用量或不适合直接执行的步骤；请结合来源附加说明审核。',
             '原始页面及其历史作者可通过每篇固定版本链接追溯；许可原文见包内 provenance/howtocook/LICENSE。', '']
    for r in recipes:
        lines += ['## ' + r['title'], '', f"[{r['recipe_id']}]({r['source_url']}) · {r['category']}", '',
                  '### 原料和工具', '', r['required_materials_and_tools_text'], '',
                  '### 原文用量', '', r['calculation_text'], '',
                  '### 原文操作', '', r['operation_text'], '',
                  '### 来源附加说明', '', r['additional_notes_text'] or '无', '']
    return '\n'.join(lines).encode('utf-8')
