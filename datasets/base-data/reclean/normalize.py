"""Conservative, evidence-preserving recipe parsing. Python standard library only."""
from collections import defaultdict
from decimal import Decimal, InvalidOperation
import math
import re
import unicodedata


def norm(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', value)).strip()


def plain(value):
    value = re.sub(r'!\[[^\]]*\]\([^\n]*?\)', '', value)
    value = re.sub(r'<img\b[^>]*>', '', value, flags=re.I)
    value = re.sub(r'\[([^\]]+)\]\([^\n]*?\)', r'\1', value)
    return norm(value.replace('**', '').replace('`', ''))


def key(value):
    return norm(value).casefold()


NUMBER = r'(?:\d+(?:\.\d+)?(?:\s*/\s*\d+)?|半|[一二两三四五六七八九十]+)'
UNITS = {
    '厘米': ('cm', 1, 'length'), 'cm': ('cm', 1, 'length'),
    '千克': ('g', 1000, 'mass'), '公斤': ('g', 1000, 'mass'), 'kg': ('g', 1000, 'mass'),
    '克': ('g', 1, 'mass'), 'g': ('g', 1, 'mass'), '毫克': ('mg', 1, 'mass'),
    'mg': ('mg', 1, 'mass'), '升': ('ml', 1000, 'volume'), 'l': ('ml', 1000, 'volume'),
    '毫升': ('ml', 1, 'volume'), 'ml': ('ml', 1, 'volume'),
}
for _unit in ('个', '只', '根', '颗', '粒', '瓣', '片', '块', '条', '张', '枚', '头', '朵', '把', '滴', '段',
              '包', '袋', '盒', '罐', '瓶', '杯', '碗', '勺', '汤匙', '茶匙', '大勺', '小勺', '斤', '两', '棵', '叶', '小块', '份', '拇指块'):
    UNITS[_unit] = (_unit, 1, 'regional_mass' if _unit in ('斤', '两') else 'source_unit')
UNIT = '(?:' + '|'.join(sorted(UNITS, key=len, reverse=True)) + ')'
MEASURE = re.compile(rf'^(?P<lo>{NUMBER})\s*(?P<u1>{UNIT})?\s*'
                     rf'(?:(?:-|~|～|至|到|–|—)\s*(?P<hi>{NUMBER})\s*)?(?P<u2>{UNIT})?$', re.I)


def numeric(value):
    value = value.replace(' ', '')
    digits = dict(zip('一二两三四五六七八九', [1, 2, 2, 3, 4, 5, 6, 7, 8, 9]))
    if value == '半':
        return 0.5
    if value in digits:
        return digits[value]
    if re.fullmatch('[一二三四五六七八九]?十[一二三四五六七八九]?', value):
        left, right = value.split('十')
        return digits.get(left, 1) * 10 + digits.get(right, 0)
    try:
        if '/' in value:
            left, right = value.split('/')
            result = Decimal(left) / Decimal(right)
        else:
            result = Decimal(value)
        converted = float(result) if result.is_finite() else None
        return converted if converted is not None and math.isfinite(converted) else None
    except (InvalidOperation, ArithmeticError, ValueError):
        return None


def measurement(raw):
    result = dict(kind='missing', value=None, minimum=None, maximum=None, unit=None,
                  dimension=None, basis='source_batch', approximate=False, note=None,
                  formula_text=None, coefficient=None, source_text=raw, conversion=None)
    if not raw:
        return result
    text = plain(raw)
    result['kind'] = 'unparsed'
    if re.search(r'适量|少许|若干|随意|酌情|足量|一点', text):
        result['kind'] = 'to_taste'
        return result
    # Do not evaluate arbitrary expressions or assume a household spoon has a volume.
    if re.search(r'[*×]|每(?:人|份|个)|份数|人数|人份|[/÷]\s*\D|\bN\b', text, re.I):
        result.update(kind='formula', formula_text=text, basis='formula_unresolved')
        formula = re.fullmatch(r'(.+?)\s*[*×]\s*(份数|人数)', text)
        reverse = re.fullmatch(r'(份数|人数)\s*[*×]\s*(.+)', text)
        per = re.fullmatch(r'(.+?)\s*/\s*(人|份)', text)
        literal, variable = (formula[1], formula[2]) if formula else (reverse[2], reverse[1]) if reverse else (per[1], per[2]) if per else (None, None)
        if literal and not re.search(r'[*×]|每|份数|人数', literal):
            coefficient = measurement(literal)
            if coefficient['kind'] in ('exact', 'range'):
                result.update(coefficient=coefficient, basis='per_person' if variable in ('人', '人数') else 'per_source_portion')
        return result
    # Keep qualifiers; parse only an isolated entire measurement before a trailing note.
    note_match = re.fullmatch(r'(.+?)\s*\(([^()]*)\)', text)
    if note_match:
        text, result['note'] = note_match[1].strip(), note_match[2]
    if text.startswith(('约', '大约')):
        result['approximate'] = True
        text = re.sub(r'^(?:大约|约)\s*', '', text)
    match = MEASURE.fullmatch(text)
    if not match or not (match['u1'] or match['u2']):
        return result
    lo, hi = numeric(match['lo']), numeric(match['hi']) if match['hi'] else None
    if lo is None or lo <= 0 or (hi is not None and hi < lo):
        result['kind'] = 'invalid'
        return result
    unit1, unit2 = match['u1'], match['u2']
    unit = (unit2 or unit1).lower()
    if unit1 and unit2 and unit1.lower() != unit2.lower():
        return result
    canonical, factor, dimension = UNITS[unit]
    if not math.isfinite(lo * factor) or (hi is not None and not math.isfinite(hi * factor)):
        result['kind'] = 'invalid'
        return result
    result.update(kind='range' if hi is not None else 'exact', unit=canonical, dimension=dimension,
                  value=None if hi is not None else lo * factor,
                  minimum=lo * factor if hi is not None else None,
                  maximum=hi * factor if hi is not None else None,
                  conversion=f'{unit}->{canonical};factor={factor}')
    if dimension == 'regional_mass':
        result['note'] = '原文地区计量基准未确认；保留斤/两，不换算克。'
    return result


def split_item(raw):
    text = plain(raw).strip(' *-')
    text = re.sub(r'^\[?可选\]?\s*', '', text)
    # Strip typographic emoji, without removing Chinese text or meaningful punctuation.
    text = ''.join(c for c in text if unicodedata.category(c) not in ('So', 'Cf'))
    # A parenthesized amount is not part of the ingredient's name.
    wrapped = re.fullmatch(r'([^()]+)\(\s*([^()]*)\)', text)
    if wrapped and re.match(rf'(?:约\s*)?{NUMBER}', wrapped[2]) and measurement(wrapped[2])['kind'] in ('exact', 'range', 'formula'):
        return norm(wrapped[1]), wrapped[2].strip()
    match = re.match(r'^(.*?)\s*(?:=|:|的用量为|用量为)\s*(.+)$', text)
    if not match:
        match = re.match(rf'^(.*?)\s+((?:约\s*)?{NUMBER}.*)$', text)
    if not match:
        match = re.match(rf'^([^()]*?)\s*({NUMBER}\s*{UNIT}.*)$', text, re.I)
    if not match:
        match = re.match(r'^(.*?)\s+(适量|少许|若干|.*)$', text)
    if match and match[1].strip():
        name, amount = match[1].strip(' ,，:：'), match[2].strip().lstrip(':').rstrip('。')
        if re.search(r'(?:用量|的数量|量)$', name) and measurement(amount)['kind'] != 'missing':
            name = re.sub(r'(?:用量|的数量|量)$', '', name)
    else:
        name, amount = text, None
    # Parenthetical qualifiers remain on the name. e.g. 木耳(干) must not become fresh 木耳.
    return norm(name), amount


def section(text, heading):
    match = re.search(r'^##\s+' + re.escape(heading) + r'\s*$', text, re.M)
    if not match:
        return ''
    tail = text[match.end():]
    end = re.search(r'^##\s+', tail, re.M)
    return (tail[:end.start()] if end else tail).strip()


def bullets(text):
    result, group = [], None
    for number, line in enumerate(text.splitlines(), 1):
        heading = re.match(r'^###\s+(.+)', line)
        if heading:
            group = plain(heading[1])
        match = re.match(r'^\s*[-*+]\s+(.+)', line)
        if match:
            result.append(dict(source_text=match[1], section_line=number, group=group))
    return result


def table_variants(text):
    """Keep every explicit table column; never choose a cake size on the user's behalf."""
    variants, header = [], None
    for line in text.splitlines():
        if not line.strip().startswith('|'):
            header = None
            continue
        cells = [plain(x) for x in line.strip().strip('|').split('|')]
        if all(re.fullmatch(r'[:\- ]+', x) for x in cells):
            continue
        if header is None:
            if len(cells) < 2 or cells[0] not in ('原料', '食材', '材料', '配料'):
                continue
            header = cells
            variants.extend(dict(label=label, ingredients=[]) for label in cells[1:])
        elif len(cells) == len(header):
            for variant, amount in zip(variants[-(len(header)-1):], cells[1:]):
                variant['ingredients'].append(dict(source_text=line, name=cells[0], amount_text=amount,
                                                   measurement=measurement(amount)))
    return variants


def parse_steps(text):
    lines = text.splitlines()
    result, current, group = [], None, None
    for line in lines:
        heading = re.match(r'^###\s+(.+)', line)
        marker = re.match(r'^(?:\d+[.、)]|[-*+])\s+(.+)', line)
        if heading:
            if current:
                result.append(current)
                current = None
            group = plain(heading[1])
        elif marker:
            if current:
                result.append(current)
            current = dict(section=group, text=marker[1])
        elif current:
            current['text'] += '\n' + line
    if current:
        result.append(current)
    if not result and text.strip():
        result.append(dict(section=None, text=text.strip()))
    for index, row in enumerate(result, 1):
        row.update(order=index, text=row['text'].strip(), source_kind='operation_text')
    return result


def serving_evidence(text):
    """Diners != recipe batches. Extract evidence without evaluating batch formulas."""
    context = '\n'.join(line for line in text.splitlines() if not re.match(r'^\s*[-*+|]', line))
    pattern = rf'({NUMBER})\s*(?:[-~至到–]\s*({NUMBER})\s*)?(?:个)?人(?:食用|吃|份|的份量|的量|早饭|佐餐|喝|饮用|餐|量)'
    hits = [dict(minimum=numeric(m[1]), maximum=numeric(m[2] or m[1]), source_text=m[0])
            for m in re.finditer(pattern, context)]
    pairs = {(x['minimum'], x['maximum']) for x in hits}
    # Direction words such as 以下为/以上原料 do not qualify a diner count.
    uncertain = bool(re.search(rf'大概|大约|约\s*{NUMBER}|至少|最多|不足|饭量|本人|我自己', context)
                     or re.search(rf'{NUMBER}\s*(?:个)?人(?:食用|吃|份|的份量|的量|早饭|佐餐|喝|饮用|餐|量)?\s*(?:及|或)?\s*(?:以上|以下)', context))
    exact = len(pairs) == 1 and next(iter(pairs))[0] == next(iter(pairs))[1] and not uncertain
    return dict(servings=next(iter(pairs))[0] if exact else None,
                status='explicit_diners' if exact else ('range_or_qualified' if len(pairs) == 1 else 'conflicting' if pairs else 'unknown'),
                evidence=hits, context=context.strip(), scale_automatically=False)


def make_index(rows):
    index = defaultdict(set)
    for row in rows:
        for term in [row['name'], *row['aliases']]:
            index[key(term)].add(row['id'])
    return index


def step_amounts(step_details, index, prepared):
    """Extract explicit metric mentions for review, never add or sum them into the recipe."""
    terms = sorted({*index, *(key(term) for term in prepared)}, key=lambda s: (-len(s), s))
    names = '(?:' + '|'.join(re.escape(term) for term in terms) + ')'
    metric = r'(?:kg|mg|ml|g|l|千克|公斤|毫克|毫升|克|升)'
    amount = rf'{NUMBER}\s*{metric}'
    forward = re.compile(rf'(?:^|[\s,，、。:：;；(]|加入|倒入|放入|撒入|添加|加|用)(?P<name>{names})\s*(?P<amount>{amount})(?![\w])', re.I)
    reverse = re.compile(rf'(?P<amount>{amount})\s*(?P<name>{names})(?=$|[\s,，、。:：;；()])', re.I)
    evidence = []
    for step in step_details:
        text = plain(step['text'])
        seen = set()
        for pattern in (forward, reverse):
            for match in pattern.finditer(text):
                token = (match['name'], match['amount'], match.start('amount'))
                if token in seen:
                    continue
                seen.add(token)
                evidence.append(dict(step_order=step['order'], section=step['section'], source_text=step['text'],
                                     name=match['name'], measurement=measurement(match['amount']),
                                     **resolve(match['name'], index, prepared),
                                     interpretation='source_mention_only_may_be_stage_allocation_or_negation'))
    return evidence


def resolve(name, index, prepared):
    preparation, lookup = None, name
    if name in prepared:
        lookup, preparation = prepared[name]
    candidates = sorted(index.get(key(lookup), set()))
    project = [i for i in candidates if i.startswith('DDD-I-')]
    chosen = candidates[0] if len(candidates) == 1 else project[0] if len(project) == 1 else None
    return dict(ingredient_id=chosen, candidate_ingredient_ids=candidates,
                mapping_status=('preferred_project_culinary_term' if len(candidates) > 1 and chosen else
                                'explicit_preparation_term' if preparation and chosen else
                                'exact_catalogue_term' if chosen else 'ambiguous' if candidates else 'unresolved'),
                preparation=preparation, lookup_name=lookup)
