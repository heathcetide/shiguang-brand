#!/usr/bin/env python3
"""Verified, additive SQLite import for the native Go schema. Dry-run by default.

Run with python3 -I. Archives are read as data only, never extracted or executed.
All projections and source snapshots commit in one transaction. Existing rows and
administrator edits are preserved; missing mappings or changed releases fail closed.
"""
import argparse
import collections
import datetime
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = '5bc9345bf6e232e34a0c6cbd4091d55f1a7f1ecce3f2e930f847431c19db3f30'
SUPPLEMENT_SHA = '2ac8fc7032be26155e4365bdf4113d425c7b3def37c31d70e721ec7c609daa80'
TFDA_URL = 'https://data.fda.gov.tw/data/opendata/export/20/json'
CORE = {'calories': ('熱量', 'kcal'), 'protein': ('粗蛋白', 'g'),
        'fat': ('粗脂肪', 'g'), 'carbs': ('總碳水化合物', 'g')}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def checked_zip(path, expected, max_size=240_000_000):
    raw = Path(path).read_bytes()
    if digest(raw) != expected:
        raise ValueError('Archive checksum mismatch: ' + str(path))
    z = zipfile.ZipFile(path)
    names = z.namelist()
    if len(names) != len(set(names)) or sum(i.file_size for i in z.infolist()) > max_size:
        z.close()
        raise ValueError('Duplicate or oversized archive')
    for name in names:
        p = PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or '\\' in name:
            z.close()
            raise ValueError('Unsafe archive path')
    return z


def load_packages(base, supplement):
    with checked_zip(base, BASE_SHA) as z:
        prefix = 'system-data-2026-09-15.2/'
        manifest = json.loads(z.read(prefix + 'manifest.json'))
        for name, sha in manifest['files'].items():
            if digest(z.read(prefix + name)) != sha:
                raise ValueError('Package member checksum mismatch: ' + name)
        data = json.loads(z.read(prefix + 'data/runtime-input.json'))
        nutrition = {name: json.loads(z.read(prefix + 'data/nutrition/' + name + '.json'))
                     for name in ['recipe-nutrition', 'recipe-inputs', 'recipe-weighing-contracts', 'equipment-role-updates']}
    with checked_zip(supplement, SUPPLEMENT_SHA) as z:
        prefix = 'concept-enrichment-2026-10-03.1/'
        manifest = json.loads(z.read(prefix + 'manifest.json'))
        for name, sha in manifest.items():
            if digest(z.read(prefix + name)) != sha:
                raise ValueError('Supplement member checksum mismatch: ' + name)
        profiles = json.loads(z.read(prefix + 'nutrition-profiles.json'))
    if data['version'] != 'concept-base-1.0.0-rc.2' or len(data['methods']) != 389 or len(data['concepts']) != 3566 or len(profiles) != 46:
        raise ValueError('Unexpected frozen package counts/version')
    ingredients = [c for c in data['concepts'] if c['active_catalogue'] and (c['kind'] == 'ingredient' or 'ingredient' in c.get('application_roles', []))]
    if len(ingredients) != 1079 or len(data['baseline']['kitchenware']) != 261:
        raise ValueError('Unexpected business projection counts')
    # Reject any future package that silently promotes these references.
    if any(m.get('automatic_execution_allowed') is not False or m.get('kitchen_tested') is not False for m in data['methods']):
        raise ValueError('Unexpected recipe approval state')
    for p in profiles:
        if p['automatic_runtime_binding'] is not False or not p['requires_scope_confirmation']:
            raise ValueError('Unexpected nutrition binding state')
    return data, nutrition, profiles


def number(raw):
    """Only exact nonnegative decimal observations are numeric. Tr/< remain unknown."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not re.fullmatch(r'\d+(?:\.\d+)?', text):
        return None
    value = float(text)
    return value if math.isfinite(value) else None


def load_tfda(path, lock):
    with checked_zip(path, lock['archive_sha256']) as z:
        raw = z.read(lock['member'])
        if digest(raw) != lock['member_sha256']:
            raise ValueError('TFDA member checksum mismatch')
        rows = json.loads(raw.decode('utf-8-sig'))
    if len(rows) != lock['observations']:
        raise ValueError('TFDA observation count mismatch')
    samples = {}
    for position, row in enumerate(rows):
        sample_id = row.get('整合編號')
        if not sample_id or not row.get('樣品名稱') or not row.get('分析項'):
            raise ValueError('Invalid TFDA observation identity')
        sample = samples.setdefault(sample_id, {'metadata': {k: row.get(k) for k in
            ['整合編號', '樣品名稱', '樣品英文名稱', '俗名', '食品分類', '內容物描述', '廢棄率']}, 'observations': []})
        if any(sample['metadata'][k] != row.get(k) for k in sample['metadata']):
            raise ValueError('Conflicting sample description: ' + sample_id)
        sample['observations'].append({'source_position': position, 'row': row})
    if len(samples) != lock['samples']:
        raise ValueError('TFDA sample count mismatch')
    return samples


def tfda_nutrients(sample):
    observations = collections.defaultdict(list)
    for item in sample['observations']:
        observations[item['row']['分析項']].append(item['row'])
    result = {}
    for key, (name, unit) in CORE.items():
        selected = observations[name]
        if len(selected) != 1:
            raise ValueError('Ambiguous core nutrient: ' + name)
        row = selected[0]
        if row['含量單位'] != unit:
            raise ValueError('Unexpected nutrient unit: ' + name)
        result[key] = {'amount': number(row['每100克含量']), 'unit': unit, 'source_text': row['每100克含量']}
    return result


def backup_database(database, output):
    # SQLite backup API includes WAL contents; a raw file copy would not.
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True) as src:
        with sqlite3.connect(output) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Backup integrity check failed')
    return {'path': str(output), 'sha256': digest(output.read_bytes())}


class Importer:
    def __init__(self, connection):
        self.db = connection
        self.added = collections.Counter()
        self.preserved = collections.Counter()

    def release(self, name, sha, url, license_name):
        old = self.db.execute('SELECT archive_sha256 FROM reference_data_releases WHERE dataset_id=?', (name,)).fetchone()
        if old and old[0] != sha:
            raise ValueError('Immutable release changed: ' + name)
        if not old:
            self.db.execute('INSERT INTO reference_data_releases VALUES(?,?,?,?,?)',
                (name, sha, url, license_name, datetime.datetime.now(datetime.timezone.utc).isoformat()))

    def record(self, dataset, collection, logical, payload, table=None, row=None):
        raw = encoded(payload)
        old = self.db.execute('SELECT payload_sha256,target_table,target_id FROM reference_data_records WHERE dataset_id=? AND collection=? AND logical_id=?',
            (dataset, collection, logical)).fetchone()
        if old:
            if old[0] != digest(raw.encode()) or old[1] != table:
                raise ValueError('Source identity/content conflict: ' + logical)
            if table and not self.db.execute('SELECT 1 FROM ' + table + ' WHERE id=?', (old[2],)).fetchone():
                raise ValueError('Previously imported target missing: ' + logical)
            self.preserved[collection] += 1
            return old[2]
        target = None
        if table:
            # Never upsert by name: homonyms and different samples are distinct.
            keys = list(row)
            target = self.db.execute('INSERT INTO ' + table + ' (' + ','.join(keys) + ') VALUES (' + ','.join('?' for _ in keys) + ')',
                tuple(row[k] for k in keys)).lastrowid
        self.db.execute('INSERT INTO reference_data_records VALUES(?,?,?,?,?,?,?)',
            (dataset, collection, logical, raw, digest(raw.encode()), table, target))
        self.added[collection] += 1
        return target

    def sample(self, dataset, sample_id, ingredient, name, kind, url, license_name, scope, nutrients, payload):
        values = (dataset, sample_id, ingredient, name, kind, url, license_name, scope, 'per_100g_edible_portion',
            *(nutrients[k]['amount'] for k in ['calories', 'protein', 'fat', 'carbs']), encoded(nutrients), encoded(payload), 0, 0)
        old = self.db.execute('SELECT * FROM nutrition_source_samples WHERE dataset_id=? AND sample_id=?', (dataset, sample_id)).fetchone()
        if old:
            if tuple(old) != values:
                raise ValueError('Existing nutrition sample modified/conflicting: ' + sample_id)
            return
        self.db.execute('INSERT INTO nutrition_source_samples VALUES(' + ','.join('?' for _ in values) + ')', values)

    def packages(self, data, nutrition, profiles):
        base = 'system-data-2026-09-15.2'
        supplement = 'concept-enrichment-2026-10-03.1'
        self.release(base, BASE_SHA, 'repository:datasets/releases/' + base + '.zip', 'mixed; see per-record sources')
        self.release(supplement, SUPPLEMENT_SHA, 'repository:datasets/releases/' + supplement + '.zip', 'CC0-1.0; OGDL-1.0')
        # Preserve the full catalogue (including inactive concepts, unreviewed aliases,
        # forms and original records), not only what can enter business tables.
        for collection, rows in data.items():
            if isinstance(rows, list):
                for index, row in enumerate(rows):
                    self.record(base, 'raw:' + collection, str(index), row)
        self.record(base, 'raw:baseline', 'baseline', data['baseline'])
        concepts = {c['id']: c for c in data['concepts']}
        aliases = collections.defaultdict(list)
        forms = collections.defaultdict(list)
        for a in data['aliases']:
            if a['status'] != 'unreviewed_not_indexed':
                aliases[a['concept_id']].append(a['text'])
        for f in data['ingredient-forms']:
            forms[f['concept_id']].append(f)
        ingredient_ids = {}
        for c in data['concepts']:
            if not c['active_catalogue'] or not (c['kind'] == 'ingredient' or 'ingredient' in c.get('application_roles', [])):
                continue
            payload = {'concept': c, 'forms': forms[c['id']], 'automatic_calculation_allowed': False}
            row = {'name': c['name_zh'], 'category': next((x['value'] for x in c.get('application_categories', [])), '其他'),
                'aliases_json': encoded(sorted(set(aliases[c['id']]))), 'source': 'concept_base', 'source_ref': c['id'],
                'source_version': data['version'], 'data_license': '; '.join(sorted({s['source_license'] for s in c['sources'] if s.get('source_license')})),
                'quality_status': 'reference', 'nutrition_basis': 'unknown', 'base_data_payload': encoded(payload)}
            ingredient_ids[c['id']] = self.record(base, 'ingredients', c['id'], payload, 'ingredients_library', row)
        legacy = {(m['legacy_table'], m['legacy_id']): m['concept_id'] for m in data['legacy-map']}
        for tool in data['baseline']['kitchenware']:
            concept_id = legacy[('kitchenware', tool['id'])]
            c = concepts[concept_id]
            self.record(base, 'kitchenware', concept_id, {'concept': c, 'source_record': tool}, 'kitchenware_catalog',
                {'name': c['name_zh'], 'category': tool.get('category'), 'source': 'concept_base', 'quality_status': 'reference',
                 'description': '目录参考；能力、容量及替代关系尚未审核。', 'base_data_payload': encoded({'concept': c, 'source_record': tool})})
        assessments = {r['method_id']: r for r in nutrition['recipe-nutrition']}
        original = {r['id']: r for r in data['baseline']['recipes']}
        for m in data['methods']:
            source = m['source']
            payload = {'method': m, 'nutrition_assessment': assessments.get(m['id']), 'automatic_execution_allowed': False}
            recipe = original[m['source_method_id']]
            self.record(base, 'recipes', m['id'], payload, 'recipes', {
                'title': m['title'], 'summary': '做法参考，尚未完成制作与发布审核；不得自动执行。',
                'cook_time_minutes': recipe.get('estimated_minutes'), 'difficulty': recipe.get('difficulty'),
                'ingredients_json': encoded([{**i, 'amount': i.get('amount_text') or '', 'ingredient_id': ingredient_ids.get(i.get('ingredient_concept_id'))} for i in m['ingredients']]),
                'steps_json': encoded([s['text'] for s in m['steps']]), 'source': 'concept_base',
                'source_url': source.get('source_url'), 'source_revision': data['version'], 'data_license': source.get('source_license'),
                'external_id': m['id'], 'status': 'pending', 'quality_status': 'needs_review', 'serving_size': m.get('servings'),
                'automatic_inventory_write_allowed': 0, 'base_data_payload': encoded(payload)})
        for name, payload in nutrition.items():
            self.record(base, 'nutrition_evidence', name, payload)
        for p in profiles:
            ingredient = ingredient_ids[p['ingredient_concept_id']]
            self.record(supplement, 'scoped_nutrition', p['id'], p)
            self.sample(supplement, p['id'], ingredient, p['display_name'], p['source_kind'], p['source_url'],
                p['source_license'], p['scope'], p['nutrients_per_100g'], p)

    def tfda(self, samples, lock):
        dataset = lock['dataset_id']
        self.release(dataset, lock['archive_sha256'], lock['source_url'], lock['license'])
        for sample_id, sample in sorted(samples.items()):
            meta = sample['metadata']
            nutrients = tfda_nutrients(sample)
            scope = meta['內容物描述'] or '原始样品描述未提供；使用前须核对适用范围'
            ingredient = self.record(dataset, 'food_samples', sample_id, sample, 'ingredients_library', {
                'name': meta['樣品名稱'], 'category': meta['食品分類'], 'unit': 'g',
                **{k + '_100g': v['amount'] for k, v in nutrients.items()},
                'source': 'taiwan_fda', 'source_ref': sample_id, 'source_version': dataset,
                'data_license': lock['license'], 'quality_status': 'reference', 'nutrition_basis': 'source_sample',
                'aliases_json': encoded([x.strip() for x in (meta.get('俗名') or '').split(',') if x.strip()]),
                'base_data_payload': encoded({'sample_id': sample_id, 'scope': scope, 'automatic_calculation_allowed': False,
                    'source_url': lock['source_url'], 'archive_sha256': lock['archive_sha256']})})
            self.sample(dataset, sample_id, ingredient, meta['樣品名稱'], 'TFDA', lock['source_url'], lock['license'], scope, nutrients, sample)


def import_all(database, data, nutrition, profiles, samples, lock, apply=False, backup=None):
    if apply and not backup:
        raise ValueError('--apply requires a new --backup path')
    if not Path(database).is_file():
        raise ValueError('Target database must already exist and be migrated')
    backup_report = backup_database(database, backup) if apply else None
    db = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=rw', uri=True, timeout=30)
    db.execute('PRAGMA foreign_keys=ON')
    try:
        expected = digest((ROOT / 'server-go/internal/db/schema/004_reference_data.sql').read_bytes())
        row = db.execute("SELECT checksum FROM go_schema_migrations WHERE version='004_reference_data.sql'").fetchone()
        if not row or row[0] != expected:
            raise ValueError('Run the current Go server -migrate before importing')
        db.execute('BEGIN IMMEDIATE')
        importer = Importer(db)
        importer.packages(data, nutrition, profiles)
        importer.tfda(samples, lock)
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Foreign key check failed')
        counts = {table: db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] for table in
            ['ingredients_library', 'recipes', 'kitchenware_catalog', 'nutrition_source_samples', 'reference_data_records']}
        db.commit() if apply else db.rollback()
        return {'mode': 'committed' if apply else 'dry_run_rolled_back', 'added': dict(importer.added),
            'preserved': dict(importer.preserved), 'totals': counts, 'backup': backup_report}
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--base', type=Path, default=ROOT / 'datasets/releases/system-data-2026-09-15.2.zip')
    parser.add_argument('--supplement', type=Path, default=ROOT / 'datasets/releases/concept-enrichment-2026-10-03.1.zip')
    parser.add_argument('--tfda', type=Path, required=True)
    parser.add_argument('--tfda-lock', type=Path, default=ROOT / 'datasets/base-data/tfda-full-2026-11-11.lock.json')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup', type=Path)
    args = parser.parse_args()
    data, nutrition, profiles = load_packages(args.base, args.supplement)
    lock = json.loads(args.tfda_lock.read_text())
    samples = load_tfda(args.tfda, lock)
    print(json.dumps(import_all(args.database, data, nutrition, profiles, samples, lock, args.apply, args.backup), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
