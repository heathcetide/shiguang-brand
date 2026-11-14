"""Tests for the Go SQLite importer; no real application database is accessed."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('food_import', Path(__file__).with_name('import-go-food-data.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FoodImportTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript((module.ROOT / 'server/internal/db/schema/004_reference_data.sql').read_text())
        self.db.execute('CREATE TABLE ingredients_library(id INTEGER PRIMARY KEY, name TEXT)')
        self.importer = module.Importer(self.db)
        self.importer.release('test', 'a' * 64, 'https://example.test', 'CC0')

    def tearDown(self):
        self.db.close()

    def test_exact_zero_and_decimal_are_preserved_but_unknowns_are_not_zero(self):
        self.assertEqual(module.number(' 0 '), 0)
        self.assertEqual(module.number('0.04'), 0.04)
        for raw in [None, '', 'Tr', '<0.5', '-', 'nan', '-1']:
            self.assertIsNone(module.number(raw))

    def test_repeat_preserves_business_edits_and_does_not_duplicate(self):
        ident = self.importer.record('test', 'food', 'one', {'source': 'original'}, 'ingredients_library', {'name': 'Original'})
        self.db.execute('UPDATE ingredients_library SET name=? WHERE id=?', ('Edited', ident))
        repeated = self.importer.record('test', 'food', 'one', {'source': 'original'}, 'ingredients_library', {'name': 'Original'})
        self.assertEqual(ident, repeated)
        self.assertEqual(self.db.execute('SELECT name FROM ingredients_library').fetchall(), [('Edited',)])

    def test_same_name_different_id_is_not_overwritten(self):
        for ident in ['one', 'two']:
            self.importer.record('test', 'food', ident, {'id': ident}, 'ingredients_library', {'name': 'Same'})
        self.assertEqual(self.db.execute('SELECT count(*) FROM ingredients_library').fetchone()[0], 2)

    def test_immutable_version_conflict_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Immutable'):
            self.importer.release('test', 'b' * 64, 'https://example.test', 'CC0')
        self.importer.record('test', 'food', 'one', {'v': 1})
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.importer.record('test', 'food', 'one', {'v': 2})

    def test_missing_imported_target_is_rejected(self):
        ident = self.importer.record('test', 'food', 'one', {}, 'ingredients_library', {'name': 'One'})
        self.db.execute('DELETE FROM ingredients_library WHERE id=?', (ident,))
        with self.assertRaisesRegex(ValueError, 'target missing'):
            self.importer.record('test', 'food', 'one', {}, 'ingredients_library', {'name': 'One'})

    def test_rollback_removes_all_partial_records(self):
        self.db.commit()
        self.db.execute('BEGIN')
        self.importer.record('test', 'food', 'one', {}, 'ingredients_library', {'name': 'One'})
        self.db.rollback()
        self.assertEqual(self.db.execute('SELECT count(*) FROM ingredients_library').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM reference_data_records').fetchone()[0], 0)

    def test_wrong_unit_is_not_silently_converted(self):
        sample = {'observations': [{'row': {'分析項': name, '含量單位': unit, '每100克含量': '0'}} for name, unit in module.CORE.values()]}
        self.assertEqual(module.tfda_nutrients(sample)['calories']['amount'], 0)
        sample['observations'][0]['row']['含量單位'] = 'kJ'
        with self.assertRaisesRegex(ValueError, 'unit'):
            module.tfda_nutrients(sample)

    def test_backup_includes_wal_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / 'source.db', Path(folder) / 'backup.db'
            with sqlite3.connect(source) as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE sentinel(value TEXT)')
                db.execute("INSERT INTO sentinel VALUES('preserved')")
                db.commit()
                report = module.backup_database(source, output)
                self.assertEqual(report['sha256'], hashlib.sha256(output.read_bytes()).hexdigest())
                with sqlite3.connect(output) as copied:
                    self.assertEqual(copied.execute('SELECT * FROM sentinel').fetchall(), [('preserved',)])
                with self.assertRaises(FileExistsError):
                    module.backup_database(source, output)

    def test_frozen_packages_validate_full_counts(self):
        data, nutrition, profiles = module.load_packages(module.ROOT / 'datasets/releases/system-data-2026-09-15.2.zip',
            module.ROOT / 'datasets/releases/concept-enrichment-2026-10-03.1.zip')
        self.assertEqual(len(data['methods']), 389)
        self.assertEqual(len(profiles), 46)
        self.assertEqual(sum(r['per_serving'] is not None for r in nutrition['recipe-nutrition']), 8)


if __name__ == '__main__':
    unittest.main()
