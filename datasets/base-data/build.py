"""Build a pinned reference-data candidate. Python 3.10+, standard library only."""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import urllib.request
import zipfile
import kitchenware
import starter
import ingredient_catalog
import source_recipes
import clean_data

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FOOD_PREFIX = 'china_food_cleanroom_v1/'
TABLES = {
    'entities': ('reference', 2347),
    'aliases': ('reference', 1660),
    'entity_root_memberships': ('reference', 3867),
    'taxonomy_edges': ('reference', 466),
    'usda_foundation_foods': ('reference', 363),
    'usda_nutrients_long': ('reference', 15193),
    'dish_ingredient_relations': ('review', 1591),
    'wikidata_usda_mapping_candidates': ('review', 204),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def unique(rows, key):
    ids = [row[key] for row in rows]
    require(all(ids) and len(set(ids)) == len(ids), f'Duplicate/empty ID: {key}')
    return set(ids)


def validate_tables(tables):
    for name, (_, count) in TABLES.items():
        require(len(tables[name]) == count, f'Unexpected count: {name}')
    entities = unique(tables['entities'], 'entity_id')
    foods = unique(tables['usda_foundation_foods'], 'fdc_id')
    for name in ('aliases', 'entity_root_memberships'):
        require(all(r['entity_id'] in entities for r in tables[name]), f'Orphan: {name}')
    for row in tables['taxonomy_edges']:
        require(row['child_entity_id'] in entities and row['parent_entity_id'] in entities, 'Orphan taxonomy')
    for row in tables['usda_nutrients_long']:
        require(row['fdc_id'] in foods, 'Orphan nutrient')
        require(bool(row['unit']) and bool(row['nutrient_id']), 'Missing nutrient metadata')
        if row['amount'] != '':
            require(math.isfinite(float(row['amount'])), 'Invalid nutrient amount')
    for row in tables['wikidata_usda_mapping_candidates']:
        require(row['wikidata_entity_id'] in entities and row['fdc_id'] in foods, 'Orphan mapping')
        require(row['review_status'] == 'needs_human_review', 'Unapproved mapping promoted')
    for row in tables['dish_ingredient_relations']:
        require(row['dish_entity_id'] in entities, 'Orphan dish')
        require(not row['ingredient_entity_id'] or row['ingredient_entity_id'] in entities, 'Orphan ingredient')
        require(row['review_status'] == 'source_statement_unreviewed', 'Unapproved relation promoted')


def build(source_dir, output_dir, download=False):
    lock = json.loads((HERE / 'sources.lock.json').read_text(encoding='utf-8'))
    archives = []
    for source in lock['sources']:
        path = source_dir / source['filename']
        if not path.exists() and download:
            source_dir.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(source['url'], timeout=90) as response:
                data = response.read()
            require(digest(data) == source['sha256'], f'Download SHA mismatch: {path.name}')
            path.write_bytes(data)
        data = path.read_bytes()
        require(digest(data) == source['sha256'], f'Source SHA mismatch: {path.name}')
        archives.append(data)
    files = {'sources.lock.json': encode(lock), 'README.md': (HERE / 'PACKAGE.md').read_bytes()}
    files['provenance/kitchenware/NOTICE.md'] = (HERE / 'KITCHENWARE-NOTICE.md').read_bytes()
    tables = {}
    with zipfile.ZipFile(io.BytesIO(archives[0])) as archive:
        for name, (tier, _) in TABLES.items():
            raw = archive.read(FOOD_PREFIX + 'machine_readable/' + name + '.csv').decode('utf-8-sig')
            rows = list(csv.DictReader(io.StringIO(raw)))
            tables[name] = rows
            # Preserve upstream strings, blank values, units and IDs; no inferred joins.
            lines = sorted(json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows)
            files[f'{tier}/{name}.jsonl'] = ('\n'.join(lines) + '\n').encode('utf-8')
        for name in ('README.md', 'SCHEMA.md', 'DATA_LICENSE.md', 'THIRD_PARTY_DATA.md', 'provenance.csv', 'validation_report.json'):
            files['provenance/food/' + name] = archive.read(FOOD_PREFIX + name)
    validate_tables(tables)
    negative_nutrients = [dict(row, review_reason='negative_source_amount', review_status='needs_human_review')
                          for row in tables['usda_nutrients_long'] if row['amount'] and float(row['amount']) < 0]
    files['review/negative_nutrient_observations.jsonl'] = b''.join(
        (json.dumps(row, ensure_ascii=False, sort_keys=True) + '\n').encode('utf-8') for row in negative_nutrients)
    with zipfile.ZipFile(io.BytesIO(archives[1])) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        for item in manifest['files']:
            data = archive.read(item['path'])
            require(len(data) == item['bytes'] and digest(data) == item['sha256'], 'Kitchenware member checksum mismatch')
        kitchen_counts = {}
        for name in ('canonical-concepts-v4', 'concept-aliases-v4', 'concept-hierarchy-v4', 'products-merged-v4', 'unresolved-records-v4'):
            kitchen_counts[name] = sum(1 for line in archive.read(name + '.jsonl').splitlines() if line.strip())
        require(kitchen_counts == {'canonical-concepts-v4': 250, 'concept-aliases-v4': 521,
                                  'concept-hierarchy-v4': 249, 'products-merged-v4': 6648,
                                  'unresolved-records-v4': 402}, 'Unexpected kitchenware counts')
        concepts, aliases, kitchen_report = kitchenware.project(archive)
        files['reference/kitchenware_concepts.jsonl'] = kitchenware.jsonl(concepts)
        files['review/kitchenware_aliases.jsonl'] = kitchenware.jsonl(aliases)
    starter_ingredients, starter_recipes, starter_report = starter.compile_data(concepts, tables['entities'])
    files['review/starter_ingredients.jsonl'] = starter.jsonl(starter_ingredients)
    files['review/starter_recipes.jsonl'] = starter.jsonl(starter_recipes)
    files['STARTER-CATALOG.md'] = starter.render(starter_ingredients, starter_recipes, concepts)
    expanded, pending, decisions, expansion_report = ingredient_catalog.project(tables, starter_ingredients)
    files['reference/ingredient_catalog.jsonl'] = ingredient_catalog.jsonl(expanded)
    files['review/ingredient_pending.jsonl'] = ingredient_catalog.jsonl(pending)
    files['review/ingredient_scope_decisions.jsonl'] = ingredient_catalog.jsonl(decisions)
    files['INGREDIENT-CATALOG.md'] = ingredient_catalog.render(expanded, pending, expansion_report)
    with zipfile.ZipFile(io.BytesIO(archives[2])) as archive:
        source = lock['sources'][2]
        imported_recipes, recipe_decisions, recipe_report = source_recipes.project(archive, source, expanded)
        files['provenance/howtocook/LICENSE'] = archive.read('HowToCook-' + source['revision'] + '/LICENSE')
    files['review/howtocook_recipes.jsonl'] = source_recipes.jsonl(imported_recipes)
    files['review/howtocook_import_decisions.jsonl'] = source_recipes.jsonl(recipe_decisions)
    files['SOURCE-RECIPES.md'] = source_recipes.render(imported_recipes)
    clean_ingredients, clean_recipes, clean_kitchen, clean_audit = clean_data.compile_data(
        expanded, concepts, aliases, starter_recipes, imported_recipes)
    initial = clean_data.fixtures(clean_recipes)
    clean_data.validate(clean_ingredients, clean_recipes, clean_kitchen, initial)
    for name, value in [('ingredients', clean_ingredients), ('recipes', clean_recipes),
                        ('kitchenware', clean_kitchen), ('initial-data', initial)]:
        files['clean/' + name + '.json'] = clean_data.encode(value)
    files['review/cleaning_issues.jsonl'] = source_recipes.jsonl(clean_audit)
    files['clean/README.md'] = (HERE / 'CLEAN-DATA.md').read_bytes()
    names = {}
    for row in tables['entities']:
        names.setdefault(row['canonical_name_zh'], []).append(row['entity_id'])
    report = {
        'version': lock['version'], 'schema_version': 1, 'status': 'reference_candidate',
        'production_ready': False, 'runtime_import_allowed': False,
        'counts': {name: len(rows) for name, rows in tables.items()},
        'kitchenware_source_inventory': kitchen_counts,
        'kitchenware_projection': kitchen_report,
        'starter_catalogue': starter_report,
        'expanded_ingredient_catalogue': expansion_report,
        'source_recipe_catalogue': recipe_report,
        'clean_datasets': dict(ingredients=len(clean_ingredients), recipes=len(clean_recipes),
                              kitchenware=len(clean_kitchen),
                              exact_kitchenware_aliases=sum(len(r['aliases']) for r in clean_kitchen),
                              structured_recipe_drafts=sum(r['has_structured_amounts'] for r in clean_recipes),
                              automatic_inventory_writes_allowed=0,
                              cleaning_issues=len(clean_audit),
                              accounts=len(initial['accounts']), demo_posts=len(initial['posts'])),
        'duplicate_chinese_names': {name: ids for name, ids in names.items() if len(ids) > 1},
        'external_ingredient_relations': sum(not r['ingredient_entity_id'] for r in tables['dish_ingredient_relations']),
        'approved_nutrition_mappings': 0, 'release_ready_recipes': 0,
        'negative_nutrient_observations': len(negative_nutrients),
        'release_blockers': [
            'Resolve the expanded ingredient scope queue and verify identity, state and aliases; no nutritional mapping required for catalogue inclusion.',
            'Review nutrition mappings by food identity, raw/cooked state and nutrient basis; never apply candidate matches automatically.',
            'Resolve negative source nutrient observations with a documented policy; do not silently clamp to zero.',
            'Finish semantic review of kitchenware aliases and document the minimal catalogue licensing before public release; no blanket CC0 claim.',
            'Kitchen-test the 20 project-authored recipe drafts and complete publication review.',
            'Review imported HowToCook quantities, ingredient/tool mappings and cooking instructions before runtime use.',
            'Implement a separate version-aware, idempotent SQLite/PostgreSQL importer after the package contract is approved.'
        ]
    }
    files['report.json'] = encode(report)
    files['manifest.json'] = encode({
        'package': lock['package'], 'version': lock['version'], 'schema_version': 1,
        'status': 'reference_candidate', 'runtime_import_allowed': False,
        'files': [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(files.items())]
    })
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"{lock['package']}-{lock['version']}.zip"
    # Fixed order, timestamp and uncompressed storage make bytes independent of zlib versions.
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 7, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    (output_dir / (target.name + '.sha256')).write_text(digest(target.read_bytes()) + '  ' + target.name + '\n', encoding='utf-8')
    (output_dir / 'report.json').write_bytes(files['report.json'])
    (output_dir / 'STARTER-CATALOG.md').write_bytes(files['STARTER-CATALOG.md'])
    (output_dir / 'INGREDIENT-CATALOG.md').write_bytes(files['INGREDIENT-CATALOG.md'])
    (output_dir / 'SOURCE-RECIPES.md').write_bytes(files['SOURCE-RECIPES.md'])
    clean_dir = output_dir / ('clean-' + lock['version'])
    clean_dir.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        if name.startswith('clean/'):
            (clean_dir / name.removeprefix('clean/')).write_bytes(data)
    return target


def verify(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP entries')
        manifest = json.loads(archive.read('manifest.json'))
        listed = [item['path'] for item in manifest['files']]
        require(len(listed) == len(set(listed)), 'Duplicate manifest entries')
        require(set(names) == set(listed) | {'manifest.json'}, 'Unexpected or missing package files')
        for item in manifest['files']:
            data = archive.read(item['path'])
            require(len(data) == item['bytes'] and digest(data) == item['sha256'], f"Package SHA mismatch: {item['path']}")
        require(manifest['runtime_import_allowed'] is False, 'Candidate must not be imported')
        tables = {name: [json.loads(line) for line in archive.read(f'{tier}/{name}.jsonl').splitlines()]
                  for name, (tier, _) in TABLES.items()}
        validate_tables(tables)
        if manifest['version'] != '0.1.0-rc.1':
            kitchenware.validate(
                [json.loads(line) for line in archive.read('reference/kitchenware_concepts.jsonl').splitlines()],
                [json.loads(line) for line in archive.read('review/kitchenware_aliases.jsonl').splitlines()])
        if manifest['version'] in ('0.1.0-rc.3', '0.1.0-rc.4', '0.1.0-rc.5', '0.1.0-rc.6', '0.1.0-rc.7'):
            starter.validate(
                [json.loads(line) for line in archive.read('review/starter_ingredients.jsonl').splitlines()],
                [json.loads(line) for line in archive.read('review/starter_recipes.jsonl').splitlines()],
                {json.loads(line)['concept_id'] for line in archive.read('reference/kitchenware_concepts.jsonl').splitlines()})
        if manifest['version'] in ('0.1.0-rc.4', '0.1.0-rc.5', '0.1.0-rc.6', '0.1.0-rc.7'):
            ingredient_catalog.validate(
                [json.loads(line) for line in archive.read('reference/ingredient_catalog.jsonl').splitlines()],
                [json.loads(line) for line in archive.read('review/ingredient_pending.jsonl').splitlines()],
                [json.loads(line) for line in archive.read('review/ingredient_scope_decisions.jsonl').splitlines()],
                tables,
                [json.loads(line) for line in archive.read('review/starter_ingredients.jsonl').splitlines()])
        if manifest['version'] in ('0.1.0-rc.5', '0.1.0-rc.6', '0.1.0-rc.7'):
            source_recipes.validate(
                [json.loads(line) for line in archive.read('review/howtocook_recipes.jsonl').splitlines()],
                {json.loads(line)['ingredient_id'] for line in archive.read('reference/ingredient_catalog.jsonl').splitlines()})
        if manifest['version'] in ('0.1.0-rc.6', '0.1.0-rc.7'):
            clean_data.validate(*[json.loads(archive.read('clean/' + name + '.json'))
                                  for name in ('ingredients', 'recipes', 'kitchenware', 'initial-data')])
        expected_negative = [dict(row, review_reason='negative_source_amount', review_status='needs_human_review')
                             for row in tables['usda_nutrients_long'] if row['amount'] and float(row['amount']) < 0]
        actual_negative = [json.loads(line) for line in archive.read('review/negative_nutrient_observations.jsonl').splitlines()]
        require(actual_negative == expected_negative or
                sorted(map(lambda r: json.dumps(r, sort_keys=True), actual_negative)) ==
                sorted(map(lambda r: json.dumps(r, sort_keys=True), expected_negative)), 'Missing negative nutrient review records')
    return digest(path.read_bytes())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT / '.cache/base-data-sources')
    parser.add_argument('--output-dir', type=Path, default=ROOT / '.cache/base-data-releases')
    parser.add_argument('--download', action='store_true', help='Download missing pinned sources')
    parser.add_argument('--verify', type=Path, help='Verify an existing candidate instead of building')
    args = parser.parse_args()
    target = args.verify or build(args.source_dir, args.output_dir, args.download)
    print(f'{target}\nSHA256 {verify(target)}')
