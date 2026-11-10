"""First-round source parser: separate identity, state, choice, quantity and notes."""
from copy import deepcopy
import re
from reclean import normalize as base

FRACTIONS = {'¼': '1/4', '½': '1/2', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'}
NUM = r'(?:\d+\s+\d+/\d+|\d+(?:\.\d+)?(?:/\d+)?|半|[一二两三四五六七八九十]+)'
EXTRA_UNITS = ('cup', 'cups', 'tsp', 'tbsp', 'cc', '支', '小块', '小勺', '大勺', '小把', '小段', '小半根', '小半个', '瓶盖', '株', '撮', '节', '圈', '扎', '卷', '份', '小片')
UNIT = '(?:' + '|'.join(sorted(set(base.UNITS) | set(EXTRA_UNITS), key=len, reverse=True)) + ')'
SCALAR = rf'{NUM}\s*{UNIT}'
PREFIX_AMOUNT = re.compile(rf'^(?P<amount>(?:大约|大概|约)?\s*{NUM}\s*(?:{UNIT})?\s*(?:(?:-|~|至|到|–|—)\s*{NUM}\s*)?{UNIT}?)', re.I)


def text(raw):
    for symbol, replacement in FRACTIONS.items():
        raw = re.sub(r'(\d)' + re.escape(symbol), r'\1 ' + replacement, raw)
        raw = raw.replace(symbol, replacement)
    return base.plain(raw).replace('⁄', '/').replace('\\*', '*').replace('℃', '°C')


def top_split(raw, separators):
    parts, start, depth, index = [], 0, 0, 0
    separators = sorted(separators, key=len, reverse=True)
    while index < len(raw):
        char = raw[index]
        if char in '([':
            depth += 1
        elif char in ')]':
            depth = max(0, depth - 1)
        if depth == 0:
            found = next((sep for sep in separators if raw.startswith(sep, index)), None)
            if found:
                parts.append(raw[start:index].strip())
                index += len(found)
                start = index
                continue
        index += 1
    parts.append(raw[start:].strip())
    return parts


def leading_notes(raw):
    notes = []
    while raw.startswith('('):
        depth, end = 0, None
        for index, char in enumerate(raw):
            depth += (char == '(') - (char == ')')
            if depth == 0:
                end = index
                break
        if end is None:
            break
        notes.append(raw[1:end])
        raw = raw[end+1:].strip()
    return raw, notes


def amount(raw):
    raw = text(raw) if raw else ''
    # Spaces make a mixed fraction unambiguous; it is an arithmetic representation, not a conversion.
    raw = re.sub(r'(\d+)\s+(\d+)/(\d+)', lambda m: str(int(m[1]) + int(m[2])/int(m[3])) if int(m[3]) else m[0], raw)
    value = base.measurement(raw)
    value.update(source_text=raw or None, source_notes=[], additional_measurements=[], stated_result=False)
    if not raw:
        return value
    raw = raw.strip(' ,:;。')
    raw = re.sub(r'^大概\s*', '约 ', raw)
    bound = re.fullmatch(r'(≥|>=|≤|<=)\s*(.+)', raw)
    suffix_bound = re.fullmatch(r'(.+?)(以上|以下)', raw)
    if not bound and suffix_bound:
        bound = (None, '>=' if suffix_bound[2] == '以上' else '<=', suffix_bound[1].strip())
    if bound:
        literal = base.measurement(bound[2])
        if literal['kind'] == 'exact' and not literal['approximate']:
            lower = bound[1] in ('≥', '>=')
            value.update(kind='lower_bound' if lower else 'upper_bound', minimum=literal['value'] if lower else None,
                         maximum=None if lower else literal['value'], unit=literal['unit'], dimension=literal['dimension'])
            return value
    equals = top_split(raw, ['='])
    if len(equals) == 2:
        declared = amount(equals[1])
        primary = base.measurement(equals[0])
        if primary['kind'] == 'exact' and declared['kind'] == 'exact':
            primary.update(source_text=raw, source_notes=[], additional_measurements=[declared], stated_result=False)
            return primary
        if declared['kind'] == 'exact':
            declared.update(source_text=raw, stated_result=True, source_expression=equals[0])
            return declared
    # Optional ranges may start at zero; zero is never turned into a required scalar amount.
    zero = re.fullmatch(rf'0\s*(?:-|~|至)\s*({NUM})\s*({UNIT})(.*)', raw, re.I)
    if zero:
        upper = amount(zero[1] + zero[2])
        if upper['kind'] == 'exact':
            value.update(kind='optional_range', minimum=0, maximum=upper['value'], unit=upper['unit'],
                         dimension=upper['dimension'], source_notes=[zero[3]] if zero[3] else [])
            return value
    # Parentheses and commas can carry preparation, alternatives or conditional amounts.
    prefix = PREFIX_AMOUNT.match(raw)
    if prefix:
        prefix_text = prefix['amount'].strip()
        remainder = raw[prefix.end():].strip()
        parsed = base.measurement(prefix_text)
        # Only known preparation/product notes may follow without punctuation.
        plain_note = bool(re.fullmatch(r'切段(?:备用)?|剁成蒜蓉|切成碎|普通(?:鸡蛋|袋装牛奶)即可|普通砂糖即可(?: 细砂糖更优 易于融化)?', remainder))
        plain_note = plain_note or (parsed['dimension'] == 'length' and remainder == '长,拍散备用')
        plain_note = plain_note or (parsed['unit'] == '根' and remainder in ('中等大小的芹菜', '大葱')) or (parsed['unit'] == '瓣' and remainder == '大蒜')
        partition = re.fullmatch(rf'({NUM})\s*根切段,\s*({NUM})\s*根备用', remainder)
        if partition and parsed['kind'] == 'exact' and parsed['unit'] == '根':
            parts = [base.numeric(partition[i]) for i in (1, 2)]
            plain_note = all(part is not None and part > 0 for part in parts) and sum(parts) == parsed['value']
        plain_note = plain_note or remainder == '#不喜可不加'
        if parsed['kind'] in ('exact', 'range') and (not remainder or remainder[0] in '(,;。' or plain_note):
            parsed.update(source_text=value['source_text'], source_notes=[remainder] if remainder else [],
                          additional_measurements=[], stated_result=False)
            if re.search(r'按.{0,8}口味|加减|适量|至少|最多|不超过|不少于|上下|左右|以上|以下', remainder):
                parsed['approximate'] = True
            # Secondary count/mass is evidence only; do not replace the leading count with grams.
            for secondary in re.finditer(rf'(?:约|大约)?\s*{NUM}\s*{UNIT}', remainder, re.I):
                candidate = base.measurement(secondary[0].strip())
                if candidate['kind'] == 'exact':
                    parsed['additional_measurements'].append(candidate)
            return parsed
    # English kitchen measures retain their source unit, even when a source offers a conversion.
    extra = re.fullmatch(rf'({NUM})\s*(?:[-~至]\s*({NUM})\s*)?(' + '|'.join(EXTRA_UNITS) + r')(.*)', raw, re.I)
    if extra and (not extra[4].strip() or extra[4].strip()[0] in '(,;。'):
        lo, hi = base.numeric(extra[1]), base.numeric(extra[2]) if extra[2] else None
        if lo is not None and lo > 0 and (hi is None or hi >= lo):
            value.update(kind='range' if hi is not None else 'exact', value=lo if hi is None else None,
                         minimum=lo if hi is not None else None, maximum=hi, unit=extra[3].lower(),
                         dimension='source_unit', source_notes=[extra[4]] if extra[4] else [])
            return value
    if re.fullmatch(rf'{NUM}\s*cc', raw, re.I):
        normalized = base.measurement(re.sub('cc$', 'ml', raw, flags=re.I))
        normalized.update(source_text=raw, source_notes=[], additional_measurements=[], stated_result=False,
                          conversion='cc->ml;factor=1')
        return normalized
    return value


def syrup_ratio(raw):
    """Recognize the literal source label, without interpreting the ratio basis."""
    return re.fullmatch(r'1\s*:\s*1\s+蔗糖糖浆\s+(.+)', text(raw))


class Parser:
    def __init__(self, ingredients, kitchen, rules, base_rules):
        self.ingredients = ingredients
        self.index = base.make_index(ingredients)
        self.kitchen_index = base.make_index(kitchen)
        self.rules = rules
        self.prepared = {**base_rules['prepared_terms'], **rules['prepared_terms']}
        self.terms = {base.key(s) for s in self.index} | {base.key(s) for s in self.kitchen_index} | {base.key(s) for s in self.prepared}
        self.pattern = re.compile('^(' + '|'.join(re.escape(s) for s in sorted(self.terms, key=lambda s: (-len(s), s))) +
                                  r')(?=$|[\s():=,、/或和共各约大概每多少\d一二两三四五六七八九十半≥≤><*]|的|数|总|用量|按照|根据|最佳|挽成|拳头|适量|少许|几滴|可选|小半|可准备)', re.I)

    def find_name(self, raw):
        match = self.pattern.match(raw)
        return (match[1], raw[match.end():].strip()) if match else (None, raw)

    def single(self, raw):
        clean = text(raw).strip(' *')
        clean = re.sub(r'^\[?可选\]?\s*', '', clean)
        egg_part = re.fullmatch(rf'({NUM})\s*个鸡蛋的鸡蛋(清|黄)', clean)
        if egg_part:
            clean = ('蛋清' if egg_part[2] == '清' else '蛋黄') + ' ' + egg_part[1] + ' 个'
        temperature = None
        temp = re.match(r'^(\d+\s*(?:°?C))\s*(温水|沸水|热水|水)', clean, re.I)
        if temp:
            temperature = temp[1]
            clean = clean[len(temp[1]):].strip()
        ratio = syrup_ratio(clean)
        name, remainder = ('蔗糖糖浆', ratio[1]) if ratio else self.find_name(clean)
        prefix_quantity = None
        if not name:
            prefix = PREFIX_AMOUNT.match(clean)
            if prefix:
                tail = clean[prefix.end():].lstrip(' 的')
                name, remainder = self.find_name(tail)
                if name:
                    prefix_quantity = prefix['amount'].strip()
        if not name:
            name, remainder = base.split_item(clean)
            remainder = remainder or ''
        remainder = remainder.lstrip(' =:')
        remainder = re.sub(r'^(?:的用量(?:为)?|用量(?:通常来说为|为)?|的数量|数量|共需|总共|总量|共|各|数|量)\s*', '', remainder).lstrip(' =:')
        rest, notes = leading_notes(remainder)
        if rest.startswith('可选'):
            rest = rest.removeprefix('可选').strip()
            notes.append('可选')
        descriptors = top_split(rest, [','])
        while len(descriptors) > 1 and (not descriptors[0] or descriptors[0] in ('葱白','葱绿','带皮')):
            note = descriptors.pop(0)
            if note:
                notes.append(note)
        rest = ','.join(descriptors)
        if notes and rest in ('g', 'ml', '克', '毫升') and any(re.search(r'[/倍份数张]', note) for note in notes):
            rest, notes = remainder, []
        # A quantity enclosed directly after the name is the primary measurement only when none preceded it.
        if not prefix_quantity and not rest and len(notes) == 1 and amount(notes[0])['kind'] not in ('missing', 'unparsed', 'invalid'):
            quantity_text, notes = notes[0], []
        else:
            quantity_text = prefix_quantity or rest or None
            if prefix_quantity and rest:
                quantity_text += ' ' + rest
        measure = amount(quantity_text)
        mapping = base.resolve(name, self.index, self.prepared)
        if ratio:
            notes.append('原文比例 1:1；比例依据及目录映射待审核')
            mapping.update(ingredient_id=None, mapping_status='unresolved')
        tool_ids = sorted(self.kitchen_index.get(base.key(name), set()))
        literal = measure['kind'] == 'exact' and measure['dimension'] in ('mass', 'volume') and not measure['approximate']
        return dict(name=name, source_text=raw, amount_text=quantity_text, measurement=measure,
                    quantity=measure['value'] if literal else None, unit=measure['unit'] if literal else None,
                    qualifiers=notes, source_temperature=temperature,
                    optional=bool(re.search(r'可选|按需|可不加|非必需|不放也|任选', text(raw))) or measure['kind'] == 'optional_range',
                    candidate_kitchenware_ids=tool_ids, **mapping)

    def parse(self, raw):
        clean = text(raw).strip(' *:')
        if clean in self.rules['headings'] or clean.startswith('腌制百香果部分') or clean == '酒(任选其一)':
            return dict(kind='heading', source_text=raw, items=[])
        if re.match(r'^(?:根据|基于|单人,|一碗容量|作为|每次|中断|米粥能够|冷藏时间|原则|当所有|如果|淹过|一个水饺约|其中青菜|煮玉米的时候|非黑暗料理)', clean):
            return dict(kind='instruction', source_text=raw, items=[])
        if re.fullmatch(r'1 (?:汤匙|茶匙)\s*=\s*\d+ml', clean) or clean == '调一个灵魂料汁儿':
            return dict(kind='instruction', source_text=raw, items=[])
        for phrase, names in self.rules.get('bundles', {}).items():
            if clean.startswith(phrase) and (self.single(clean)['name'] == phrase or clean[len(phrase):].lstrip(' :=').startswith(tuple('0123456789一二两三四五六七八九十'))):
                children = [self.single(name) for name in names]
                for child in children:
                    child.update(shared_amount_evidence=raw, quantity=None, unit=None, measurement=amount(None))
                return dict(kind='bundle', source_text=raw, items=children, allocation='unallocated_source_bundle')
        # Explicit item bundles are decomposed without duplicating their shared amount.
        colon = top_split(clean, [':'])
        bundle_text = colon[1] if len(colon) == 2 and colon[0] in ('调料', '主料', '香料包', '蘸料', '其他配料') else clean
        pieces = top_split(bundle_text, ['、', ' + ', '+', ' 和 ', '和', ','])
        if len(pieces) > 1:
            children = [self.single(piece) for piece in pieces]
            # Commas may introduce notes. Lists marked with 、 retain even unknown components.
            genuine = all(child['ingredient_id'] or child['candidate_ingredient_ids'] or child['candidate_kitchenware_ids'] for child in children)
            if genuine or ('、' in bundle_text and all(not char in piece for piece in pieces for char in ('。', ';'))):
                quantities = [child['measurement']['kind'] != 'missing' for child in children]
                if not all(quantities) and any(quantities):
                    for child in children:
                        child['shared_amount_evidence'] = raw
                        child['measurement'] = amount(None)
                        child['quantity'], child['unit'] = None, None
                return dict(kind='bundle', source_text=raw, items=children,
                            allocation='individual_source_amounts' if all(quantities) else 'unallocated_source_bundle')
        separators = ['或者', '或', ' or ']
        if not re.search(r'\d\s*/|/\s*(?:人|份|\d)|//', clean):
            separators.append('/')
        choices = top_split(clean, separators)
        if len(choices) > 1 and not choices[1].startswith('更多'):
            options = [self.single(piece) for piece in choices]
            if any(option['ingredient_id'] for option in options):
                parent = self.single(clean)
                parent.update(ingredient_id=None, candidate_ingredient_ids=sorted({o['ingredient_id'] for o in options if o['ingredient_id']}),
                              mapping_status='explicit_choice' if all(o['ingredient_id'] for o in options) else 'choice_unresolved', ingredient_options=options,
                              quantity=None, unit=None, measurement=amount(None), amount_text=None)
                return dict(kind='choice', source_text=raw, items=[parent])
        item = self.single(clean)
        if item['candidate_kitchenware_ids'] and not item['candidate_ingredient_ids']:
            return dict(kind='equipment', source_text=raw, items=[item])
        # Parenthetical alternatives remain explicit rather than being relabelled as aliases.
        for note in item['qualifiers']:
            alternative = re.match(r'^(?:或|或者)(.+)', note)
            if alternative:
                other = self.single(alternative[1])
                if item['ingredient_id'] and other['ingredient_id']:
                    original = deepcopy(item)
                    item.update(ingredient_id=None, candidate_ingredient_ids=sorted({original['ingredient_id'], other['ingredient_id']}),
                                mapping_status='explicit_choice', ingredient_options=[original, other], quantity=None, unit=None)
                    return dict(kind='choice', source_text=raw, items=[item])
        return dict(kind='ingredient', source_text=raw, items=[item])
