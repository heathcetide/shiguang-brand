"""Audit the shipped data, source observations and recipe gaps without a database."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import re
from pathlib import Path
import zipfile

from reclean.enrich_core import CORE, estimate, scalar
from reclean import normalize, round1_parser

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'datasets/releases/system-data-2026-09-15.2.zip'
EVIDENCE = Path(__file__).with_name('evidence') / 'usda-foundation-2646170.json'
TFDA_EVIDENCE = Path(__file__).with_name('evidence') / 'tfda-core-samples.json'
REVIEW_DOCUMENTS = ('recipe-weighing-contracts', 'equipment-role-updates', 'duplicate-review', 'matching-decisions')
TFDA_NAMES = {'calories': '熱量', 'protein': '粗蛋白', 'fat': '粗脂肪', 'carbs': '總碳水化合物'}


def read_package(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive member')
        manifests = [name for name in names if name.count('/') == 1 and name.endswith('/manifest.json')]
        if len(manifests) != 1:
            raise ValueError('Expected one package manifest')
        root = manifests[0].removesuffix('manifest.json')
        manifest = json.loads(archive.read(manifests[0]))
        if set(names) != {root + name for name in manifest['files']} | {manifests[0]}:
            raise ValueError('Package manifest membership mismatch')
        for name, digest in manifest['files'].items():
            if hashlib.sha256(archive.read(root + name)).hexdigest() != digest:
                raise ValueError('Package checksum mismatch: ' + name)
        load = lambda name: json.loads(archive.read(root + 'data/' + name + '.json'))
        return {'version': manifest['version'], 'archive_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                'catalogue': load('runtime-input'),
                **{name: load('nutrition/' + name) for name in (
                    'nutrition-profiles', 'recipe-nutrition', 'recipe-inputs',
                    'source-selected-records', 'tfda-selected-records', *REVIEW_DOCUMENTS)}}


def with_supplement(data, path):
    """Overlay a manifest-checked references-only archive on its exact base catalogue."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        manifests = [n for n in names if n.count('/') == 1 and n.endswith('/manifest.json')]
        if len(manifests) != 1 or len(names) != len(set(names)):
            raise ValueError('Invalid supplement manifest')
        root = manifests[0].removesuffix('manifest.json')
        manifest = json.loads(archive.read(manifests[0]))
        if set(names) != {root + n for n in manifest} | {manifests[0]}:
            raise ValueError('Supplement manifest membership mismatch')
        for name, digest in manifest.items():
            if hashlib.sha256(archive.read(root + name)).hexdigest() != digest:
                raise ValueError('Supplement checksum mismatch: ' + name)
        load = lambda name: json.loads(archive.read(root + name + '.json'))
        if load('source.lock')['parent_archive_sha256'] != data['archive_sha256']:
            raise ValueError('Supplement base archive mismatch')
        summary = load('summary')
        if summary['import_mode'] != 'scoped_reference_additions':
            raise ValueError('Unexpected supplement mode')
        for key in ('recipe-inputs', 'recipe-nutrition', *REVIEW_DOCUMENTS):
            if load(key) != data[key]:
                raise ValueError('References-only supplement changed recipes')
        profiles = load('nutrition-profiles')
        if profiles[:len(data['nutrition-profiles'])] != data['nutrition-profiles']:
            raise ValueError('References-only supplement changed existing profiles')
        return {**data, 'version': summary['version'],
                'supplement_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                'nutrition-profiles': profiles,
                'tfda-selected-records': load('tfda-selected-records'),
                'foundation-source-record': load('foundation-source-record')}


def verify_profile(profile, sr, tfda, foundation):
    """Return missing evidence; contradicting evidence fails instead of being hidden."""
    food_id = profile['source_food_id']
    if not profile.get('source_url') or not profile.get('source_license'):
        raise ValueError('Missing source attribution: ' + food_id)
    for key, (nutrient_id, unit) in CORE.items():
        nutrient = profile['nutrients_per_100g'][key]
        allowed_ids = {'1008', '2047', '2048'} if key == 'calories' else {nutrient_id}
        if nutrient['unit'] != unit or (profile['source_kind'] in {'SR_Legacy', 'Foundation_Foods'}
                                      and nutrient.get('nutrient_id') not in allowed_ids):
            raise ValueError(f'Nutrient definition mismatch: {food_id} / {key}')
    observations = {}
    if profile['source_kind'] == 'SR_Legacy' and food_id in sr:
        record = sr[food_id]
        if record['food']['description'] != profile['source_name']:
            raise ValueError('Source food identity mismatch: ' + food_id)
        for key, nutrient in profile['nutrients_per_100g'].items():
            rows = [row for row in record['food_nutrient'] if row['nutrient_id'] == nutrient['nutrient_id']]
            if len(rows) != 1 or rows[0]['id'] != nutrient['observation_id'] or rows[0]['fdc_id'] != record['food']['fdc_id']:
                raise ValueError('Source observation identity mismatch: ' + food_id)
            observations[key] = (rows[0]['amount'], record['nutrient_definitions'][nutrient['nutrient_id']]['unit_name'])
    elif profile['source_kind'] == 'TFDA' and food_id in tfda:
        rows = tfda[food_id]
        if any(row['row']['樣品名稱'] != profile['source_name'] for row in rows):
            raise ValueError('Source food identity mismatch: ' + food_id)
        for key, name in TFDA_NAMES.items():
            selected = [row for row in rows if row['row']['分析項'] == name]
            if len(selected) != 1:
                raise ValueError('Source observation identity mismatch: ' + food_id)
            row = selected[0]
            if profile['nutrients_per_100g'][key]['observation_id'] != f"TFDA-OBS:{food_id[5:]}:{row['source_position']}":
                raise ValueError('Source observation position mismatch: ' + food_id)
            observations[key] = (row['row']['每100克含量'], row['row']['含量單位'])
    elif profile['source_kind'] == 'Foundation_Foods' and food_id in foundation:
        food = foundation[food_id]
        if food['description'] != profile['source_name'] or food['dataType'] != 'Foundation':
            raise ValueError('Source food identity mismatch: ' + food_id)
        for key, nutrient in profile['nutrients_per_100g'].items():
            rows = [row for row in food['foodNutrients'] if str(row['nutrient']['id']) == nutrient['nutrient_id']]
            if len(rows) != 1:
                raise ValueError('Source observation identity mismatch: ' + food_id)
            observations[key] = (rows[0].get('amount'), rows[0]['nutrient']['unitName'])
    else:
        return False
    for key in CORE:
        amount, unit = observations[key]
        nutrient = profile['nutrients_per_100g'][key]
        if unit.lower() != nutrient['unit'].lower() or scalar(amount) != nutrient['amount']:
            raise ValueError(f'Source nutrient mismatch: {food_id} / {key}')
    return True


def audit(data, evidence=None, tfda_evidence=None):
    catalogue, profiles = data['catalogue'], data['nutrition-profiles']
    if len({p['id'] for p in profiles}) != len(profiles):
        raise ValueError('Duplicate profile identity')
    forms = {f['id']: f for f in catalogue['ingredient-forms']}
    for profile in profiles:
        form = forms.get(profile['ingredient_form_id'])
        if not form or form['concept_id'] != profile['ingredient_concept_id']:
            raise ValueError('Profile form/concept mismatch')
    sr = {'USDA-FDC-' + row['food']['fdc_id']: row for row in data['source-selected-records']}
    tfda = defaultdict(list)
    positions = {}
    for row in data['tfda-selected-records'] + (tfda_evidence or {}).get('records', []):
        if row['source_position'] in positions:
            if positions[row['source_position']] != row:
                raise ValueError('Source observation position mismatch: conflicting TFDA rows')
            continue
        positions[row['source_position']] = row
        tfda['TFDA:' + row['row']['整合編號']].append(row)
    evidence = evidence or data.get('foundation-source-record')
    foundation = {} if evidence is None else {'USDA-FDC-' + str(evidence['food']['fdcId']): evidence['food']}
    missing = []
    for profile in profiles:
        if not verify_profile(profile, sr, tfda, foundation):
            missing.append({key: profile[key] for key in ('display_name', 'source_food_id', 'source_url')})
    methods = {method['id']: method for method in data['recipe-inputs']}
    blockers = defaultdict(lambda: {'recipes': set(), 'reasons': set()})
    for recipe in data['recipe-nutrition']:
        calculated = estimate(methods[recipe['method_id']], recipe['selections'], profiles)
        for key in ('whole_recipe', 'per_serving', 'known_subtotal', 'coverage', 'status'):
            if calculated[key] != recipe[key]:
                raise ValueError(f'Recipe calculation mismatch: {recipe["method_id"]} / {key}')
        for gap in recipe['gaps']:
            blockers[gap['name']]['recipes'].add(recipe['title'])
            blockers[gap['name']]['reasons'].add(gap.get('reason_text', gap['reason']))
    ingredients = [c for c in catalogue['concepts'] if c['active_catalogue'] and
                   (c['kind'] == 'ingredient' or 'ingredient' in c.get('application_roles', []))]
    covered = {profile['ingredient_concept_id'] for profile in profiles}
    if not covered <= {c['id'] for c in ingredients}:
        raise ValueError('Nutrition reference points outside ingredient catalogue')
    return {
        'package_version': data['version'],
        'ingredient_concepts': len(ingredients),
        'concepts_with_scoped_nutrition_reference': len(covered),
        'concepts_without_scoped_nutrition_reference': len(ingredients) - len(covered),
        'nutrition_profiles': len(profiles),
        'profiles_by_source': dict(sorted(Counter(p['source_kind'] for p in profiles).items())),
        'profiles_with_checked_source_observations': len(profiles) - len(missing),
        'profiles_missing_source_observations': missing,
        'recipe_concepts_with_methods': sum(bool(r['method_ids']) for r in catalogue['recipe-concepts']),
        'dish_concepts_without_recipe_method': sum(not r['method_ids'] for r in catalogue['recipe-concepts']),
        'recipe_methods': len(catalogue['methods']),
        'recipe_methods_with_source_url': sum(bool(m['source'].get('source_url')) for m in catalogue['methods']),
        'recipe_methods_with_declared_license': sum(bool(m['source'].get('source_license')) for m in catalogue['methods']),
        'recipe_methods_with_nutrition_assessment': len(data['recipe-nutrition']),
        'recipes_with_four_core_nutrients_per_serving': sum(r['per_serving'] is not None for r in data['recipe-nutrition']),
        'recipe_method_missing_fields': dict(sorted(Counter(f for m in catalogue['methods'] for f in m['missing_fields']).items())),
        'nutrition_gap_priority': [{'ingredient': name, 'affected_recipe_count': len(value['recipes']),
            'recipes': sorted(value['recipes']), 'reasons': sorted(value['reasons'])}
            for name, value in sorted(blockers.items(), key=lambda item: (-len(item[1]['recipes']), item[0]))],
        'scope': 'Frozen reference package only; source-value checks do not establish ingredient equivalence, professional review, cooking safety or live database state.',
    }


def ingredient_corrections(method, catalogue, prepared_terms):
    """Confirm literal source fields only; never allocate shared totals or bind nutrition."""
    forms = defaultdict(list)
    concepts = {c['id']: c for c in catalogue['concepts']}
    for form in catalogue['ingredient-forms']:
        forms[form['display_name']].append(form)
    corrections = []
    for line in method['ingredients']:
        fields = {}
        source = round1_parser.text(line.get('original_source_text', line.get('source_text')) or '')
        previous = line.get('measurement') or {}
        if (previous.get('kind') == 'unparsed' and not line.get('shared_amount_evidence')
                and line.get('amount_text') and round1_parser.text(line['amount_text']) in source
                and round1_parser.text(previous.get('source_text') or '') == round1_parser.text(line['amount_text'])):
            parsed = round1_parser.amount(line.get('amount_text'))
            if parsed['kind'] in ('exact', 'range', 'lower_bound', 'upper_bound') and not parsed['approximate']:
                fields['measurement'] = {'previous': previous, 'value': parsed}
        ratio = round1_parser.syrup_ratio(source)
        if (ratio and line.get('name') == '1' and line.get('mapping_status') == 'unresolved'
                and not any(line.get(key) for key in ('ingredient_id', 'ingredient_form_id', 'ingredient_concept_id', 'shared_amount_evidence'))
                and previous.get('kind') == 'unparsed'
                and round1_parser.text(line.get('amount_text') or '') == '1 蔗糖糖浆 ' + ratio[1]
                and round1_parser.text(previous.get('source_text') or '') == '1 蔗糖糖浆 ' + ratio[1]):
            parsed = round1_parser.amount(ratio[1])
            if parsed['kind'] in ('exact', 'range') and not parsed['approximate']:
                fields['name'] = {'previous': '1', 'value': '蔗糖糖浆', 'source_ratio': '1:1',
                                  'ratio_basis_confirmed': False, 'mapping_confirmed': False}
                fields['measurement'] = {'previous': previous, 'value': parsed}
        if (line.get('mapping_status') == 'unresolved' and not line.get('ingredient_id')
                and not line.get('ingredient_form_id') and not line.get('ingredient_concept_id')
                and line['name'] in prepared_terms and round1_parser.text(line['name']) in source):
            name, qualifier = prepared_terms[line['name']]
            candidates = forms[name]
            if len(candidates) == 1:
                form = candidates[0]
                concept = concepts.get(form['concept_id'], {})
                if concept.get('active_catalogue') and concept.get('name_zh') == name and (concept.get('kind') == 'ingredient'
                        or 'ingredient' in concept.get('application_roles', [])):
                    fields['mapping'] = {'ingredient_id': form['legacy_ingredient_id'],
                        'ingredient_form_id': form['id'], 'ingredient_concept_id': form['concept_id'],
                        'name': name, 'qualifier': qualifier,
                        'basis': 'explicit_source_term_and_unique_existing_form',
                        'nutrition_binding_confirmed': False}
        if fields:
            corrections.append({'line_id': line['line_id'],
                'original_source_text': line.get('original_source_text', line.get('source_text')),
                'shared_amount_evidence': line.get('shared_amount_evidence'),
                'optional': line.get('optional', False), 'fields': fields,
                'runtime_applied': False, 'automatic_execution_allowed': False})
    return corrections


def review_inventory(data, evidence=None, tfda_evidence=None):
    """Prepare review work, never grant approval from structural completeness."""
    prepared_rules = Path(__file__).with_name('reclean') / 'round1-rules.json'
    prepared_terms = json.loads(prepared_rules.read_bytes())['prepared_terms']
    report = audit(data, evidence, tfda_evidence)  # Contradicting source evidence fails closed.
    def digest(value):
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                        separators=(',', ':'), allow_nan=False).encode()).hexdigest()

    catalogue = data['catalogue']
    concepts = {c['id']: c for c in catalogue['concepts']}
    profiles = defaultdict(list)
    for profile in data['nutrition-profiles']:
        profiles[profile['ingredient_concept_id']].append(profile['id'])
    # Bring existing documentary evidence into the review queue without upgrading its meaning.
    methods = {m['id']: m for m in catalogue['methods']}
    forms = {f['id']: f for f in catalogue['ingredient-forms']}
    inputs = {m['id']: m for m in data['recipe-inputs']}
    supporting = defaultdict(list)
    def attach(document, index, row, identities, check):
        entry = {'document': 'data/nutrition/' + document + '.json', 'record_index': index,
                 'record_sha256': digest(row), 'record': row, 'check': check,
                 'semantic_approval': False}
        for identity in identities:
            supporting[identity].append(entry)

    for document in REVIEW_DOCUMENTS:
        seen = set()
        for index, row in enumerate(data[document]):
            fingerprint = digest(row)
            if fingerprint in seen:
                raise ValueError('Duplicate supporting evidence: ' + document)
            seen.add(fingerprint)
            if document == 'recipe-weighing-contracts':
                method = methods.get(row['method_id'])
                if (not method or inputs.get(row['method_id']) != method
                        or row['original_recipe_sha256'] != method['source_recipe_sha256']
                        or row['original_amounts_unchanged'] is not True):
                    raise ValueError('Weighing evidence recipe mismatch')
                attach(document, index, row, [('recipe_method', method['id'])],
                       'recipe_identity_hash_and_unchanged_inputs')
            elif document == 'equipment-role-updates':
                method, concept = methods.get(row['method_id']), concepts.get(row['concept_id'])
                if not method or not concept or concept['name_zh'] != row['name']:
                    raise ValueError('Equipment evidence identity mismatch')
                steps = {step['order']: step['text'] for step in method['steps']}
                if not row['evidence'] or any(steps.get(e['step']) != e['text'] for e in row['evidence']):
                    raise ValueError('Equipment evidence step mismatch')
                attach(document, index, row, [('recipe_method', method['id']), ('catalogue_concept', concept['id'])],
                       'equipment_identity_and_exact_source_step')
            elif document == 'matching-decisions':
                if row['ingredient_form_id'] not in forms or row['status'] != 'not_bound':
                    raise ValueError('Rejected nutrition binding evidence mismatch')
                # Rejected candidates remain rejected even when the source has four nutrient values.
                source_rows = [r['row'] for r in data['tfda-selected-records']
                               if 'TFDA:' + r['row']['整合編號'] == row['source_food_id']]
                if not source_rows or any(r['樣品名稱'] != row['source_name'] or
                                          r['內容物描述'] != row['source_description'] for r in source_rows):
                    raise ValueError('Rejected nutrition source identity mismatch')
                attach(document, index, row, [('ingredient_form', row['ingredient_form_id'])],
                       'existing_nonbinding_decision_and_source_identity')
            else:
                if len(set(row['concept_ids'])) < 2 or any(i not in concepts for i in row['concept_ids']):
                    raise ValueError('Duplicate concept evidence identity mismatch')
                identities = [('catalogue_concept', i) for i in row['concept_ids']]
                identities += [('recipe_concept', r['id']) for r in catalogue['recipe-concepts']
                               if r['dish_concept_id'] in row['concept_ids']]
                attach(document, index, row, identities, 'existing_duplicate_candidates_not_merged')

    records = []
    def add(kind, record, name, gaps, sources, related, corrections=None):
        records.append({'kind': kind, 'id': record['id'], 'name': name,
                        'record_sha256': digest(record), 'record': record, 'sources': sources,
                        'related_ids': related, 'confirmed_source_fields': corrections or {}, 'supporting_evidence': supporting[(kind, record['id'])],
                        'missing_or_unverified': sorted(set(gaps)),
                        'disposition': 'pending_evidence', 'reviewer': None,
                        'reviewed_at': None, 'approval_evidence': [],
                        'automatic_execution_allowed': False})

    for concept in catalogue['concepts']:
        if not concept['active_catalogue']:
            continue
        roles = {concept['kind'], *concept.get('application_roles', [])}
        if not roles & {'ingredient', 'kitchenware'}:
            continue
        gaps = ['identity_aliases_and_classification_review', 'redistribution_license_review']
        if 'ingredient' in roles:
            gaps.append('nutrition_scope_review' if profiles[concept['id']] else 'nutrition_reference_missing')
        if 'kitchenware' in roles:
            gaps.append('capacity_and_substitution_review')
        sources = concept.get('sources', [])
        if not sources or any(not source.get('source_url') for source in sources):
            gaps.append('source_url_missing')
        if not sources or any(not source.get('source_license') for source in sources):
            gaps.append('declared_license_missing')
        add('catalogue_concept', concept, concept['name_zh'], gaps, sources,
            sorted(profiles[concept['id']]))

    for form in catalogue['ingredient-forms']:
        add('ingredient_form', form, form['display_name'],
            ['ingredient_form_identity_and_state_review'], [form['source']], [form['concept_id']])
    for recipe in catalogue['recipe-concepts']:
        gaps = ['dish_identity_and_method_relationship_review']
        if not recipe['method_ids']:
            gaps.append('recipe_method_missing')
        add('recipe_concept', recipe, concepts.get(recipe['dish_concept_id'], {}).get('name_zh', recipe['id']),
            gaps, concepts.get(recipe['dish_concept_id'], {}).get('sources', []), recipe['method_ids'])

    for method in catalogue['methods']:
        corrections = {}
        previous = method.get('yield', {}).get('evidence', {})
        if method['servings'] is None and previous.get('status') in {'range_or_qualified', 'unknown'}:
            parsed = normalize.serving_evidence(previous.get('context', ''))
            same_evidence = parsed['evidence'] == previous.get('evidence')
            explicit_batch = (previous.get('status') == 'unknown' and not previous.get('evidence')
                              and re.search(r'按照|每份|一份为|一份正好够', previous.get('context', '')))
            if (parsed['status'] == 'explicit_diners' and parsed['servings'] > 0
                    and (same_evidence or explicit_batch)):
                corrections['servings'] = {'previous': None, 'value': parsed['servings'],
                    'basis': 'explicit_diners_in_preserved_source_context',
                    'source_context': previous['context'], 'evidence': parsed['evidence'],
                    'runtime_applied': False, 'scale_automatically': False}
        lines = ingredient_corrections(method, catalogue, prepared_terms)
        if lines:
            corrections['ingredient_lines'] = lines
        gaps = list(method['missing_fields']) + [
            'ingredient_mapping_and_amount_review', 'redistribution_license_review',
            'equipment_capacity_and_task_duration_review', 'kitchen_execution_review',
            'storage_transport_reheat_review']
        if 'servings' in corrections:
            gaps = [gap for gap in gaps if gap != 'servings']
        source = method['source']
        if not source.get('source_url'):
            gaps.append('source_url_missing')
        if not source.get('source_license'):
            gaps.append('declared_license_missing')
        add('recipe_method', method, concepts.get(method['dish_concept_id'], {}).get('name_zh', method['id']),
            gaps, [source], [method['dish_concept_id']], corrections)

    missing = {p['source_food_id'] for p in report['profiles_missing_source_observations']}
    for profile in data['nutrition-profiles']:
        gaps = ['ingredient_form_scope_review', 'professional_nutrition_review', 'redistribution_license_review']
        if profile['source_food_id'] in missing:
            gaps.append('source_observations_missing')
        add('nutrition_profile', profile, profile['display_name'], gaps,
            [{key: profile[key] for key in ('source_food_id', 'source_url', 'source_license')}],
            [profile['ingredient_concept_id'], profile['ingredient_form_id']])

    identities = [(r['kind'], r['id']) for r in records]
    if len(identities) != len(set(identities)):
        raise ValueError('Duplicate review identity')
    records.sort(key=lambda r: (r['kind'], r['id']))
    return {'format_version': 1, 'package_version': data['version'],
            'base_archive_sha256': data['archive_sha256'],
            'supplement_sha256': data.get('supplement_sha256'),
            'builder_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'serving_parser_sha256': hashlib.sha256(Path(normalize.__file__).read_bytes()).hexdigest(),
            'ingredient_parser_sha256': hashlib.sha256(Path(round1_parser.__file__).read_bytes()).hexdigest(),
            'ingredient_rules_sha256': hashlib.sha256(prepared_rules.read_bytes()).hexdigest(),
            'source_evidence_sha256': {'foundation': digest(evidence) if evidence else None,
                                       'tfda': digest(tfda_evidence) if tfda_evidence else None},
            'counts': dict(sorted(Counter(r['kind'] for r in records).items())),
            'gap_counts': dict(sorted(Counter(g for r in records for g in r['missing_or_unverified']).items())),
            'supporting_document_counts': {name: len(data[name]) for name in REVIEW_DOCUMENTS},
            'ingredient_line_correction_counts': dict(sorted(Counter(field for r in records
                for line in r['confirmed_source_fields'].get('ingredient_lines', []) for field in line['fields']).items())),
            'confirmed_source_field_counts': dict(sorted(Counter(key for r in records for key in r['confirmed_source_fields']).items())),
            'records_with_supporting_evidence': sum(bool(r['supporting_evidence']) for r in records),
            'semantic_approval': False, 'execution_eligible': 0,
            'scope': report['scope'], 'records': records}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', nargs='?', type=Path, default=ARCHIVE)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--review-output', type=Path, help='Create a new immutable per-record review inventory JSON')
    parser.add_argument('--enrichment', type=Path, help='Audit the base plus a references-only supplement ZIP')
    args = parser.parse_args()
    if args.review_output and args.output and args.review_output.resolve() == args.output.resolve():
        parser.error('--review-output and --output must be different files')
    data = read_package(args.archive)
    if args.enrichment:
        data = with_supplement(data, args.enrichment)
    evidence = json.loads(EVIDENCE.read_text(encoding='utf8'))
    tfda_evidence = json.loads(TFDA_EVIDENCE.read_text(encoding='utf8'))
    report = audit(data, evidence, tfda_evidence)
    if args.review_output:
        inventory = review_inventory(data, evidence, tfda_evidence)
        with args.review_output.open('x', encoding='utf8') as output:
            output.write(json.dumps(inventory, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n')
    text = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + '\n'
    if args.output:
        args.output.write_text(text, encoding='utf8')
    else:
        print(text, end='')
