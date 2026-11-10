"""Portable query and nutrition validation against a built concept package."""
import re
import unicodedata
import math
from collections import Counter


def key(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s or '')).casefold()


def search(index, query, region=None):
    hits = index.get(key(query), [])
    result = {}
    for hit in hits:
        cid = hit['concept_id']
        if cid not in result:
            result[cid] = {'concept_id': cid, 'name': hit['name'], 'kind': hit['kind'], 'matched_aliases': [], 'region_preferred': False}
        result[cid]['matched_aliases'].append(hit['alias'])
        if region and region in hit['regions']:
            result[cid]['region_preferred'] = True
    return sorted(result.values(), key=lambda x: (not x['region_preferred'], x['name'], x['concept_id']))


def estimate(method, selections, links, observations):
    """Explicit selection only; source-prepared gram weight cannot be inferred."""
    totals, covered, gaps = {}, 0, []
    bylink = {x['id']: x for x in links}
    byobs = {x['id']: x for x in observations}
    required_fields = set()
    missing_fields = set()
    field_counts = Counter()
    if set(selections) - {line['line_id'] for line in method['ingredients']}:
        raise ValueError('Unknown recipe line')
    for line in method['ingredients']:
        sel = selections.get(line['line_id'])
        if not sel:
            gaps.append({'line_id': line['line_id'], 'reason': 'no_confirmed_sample_and_weight'})
            continue
        link = bylink.get(sel.get('link_id'))
        if not link or link['ingredient_form_id'] != line.get('ingredient_form_id'):
            raise ValueError('Wrong ingredient form')
        if sel.get('scope_key') != link['scope_key'] or sel.get('basis') != 'per_100_g_source_prepared_sample':
            raise ValueError('Unconfirmed sample state or weight basis')
        grams = sel.get('prepared_sample_grams')
        if not isinstance(grams, (int, float)) or isinstance(grams, bool) or not math.isfinite(grams) or grams < 0:
            raise ValueError('Explicit nonnegative gram weight required')
        if line.get('mapping_status') in ['choice_unresolved', 'bundle_unresolved'] or line.get('ingredient_options'):
            raise ValueError('Unresolved ingredient choice')
        for oid in link['observation_ids']:
            obs = byobs[oid]
            if obs['food_id'] != link['source_food_id']:
                raise ValueError('Mixed source observations')
            if obs['unit'] is None:
                continue
            k = obs['nutrient_name'] + '|' + obs['unit']
            required_fields.add(k)
            field_counts[k] += 1
            if obs['amount'] is None:
                missing_fields.add(k)
            else:
                totals[k] = totals.get(k, 0) + obs['amount'] * grams / 100
        covered += 1
    missing_fields.update(k for k in required_fields if field_counts[k] != covered)
    complete = bool(method['ingredients']) and not gaps and not missing_fields
    return {'basis': 'whole_recipe_batch', 'status': 'complete_for_reported_fields' if complete else 'incomplete',
            'known_subtotal': totals, 'unavailable_or_partial_fields': sorted(missing_fields),
            'covered_lines': covered, 'total_lines': len(method['ingredients']), 'gaps': gaps,
            'per_serving': {k: v / method['servings'] for k, v in totals.items()} if complete and method.get('servings') else None,
            'per_100_g_finished': None}
