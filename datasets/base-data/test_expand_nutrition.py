import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from expand_nutrition import ROWS, ROWS_SHA, SELECTIONS, VERSION, build, new_profiles, sha
from source_coverage import ARCHIVE, ROOT, audit, read_package, with_supplement

RELEASE = ROOT / 'datasets/releases' / (VERSION + '.zip')


class ExpandedNutritionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = read_package(ARCHIVE)
        cls.selections = json.loads(SELECTIONS.read_bytes())
        cls.evidence = json.loads(ROWS.read_bytes())

    def test_frozen_supplement_rebuilds_byte_for_byte_offline(self):
        self.assertEqual(sha(ROWS.read_bytes()), ROWS_SHA)
        with tempfile.TemporaryDirectory() as directory:
            rebuilt = Path(directory) / 'rebuilt.zip'
            build(rebuilt)
            self.assertEqual(rebuilt.read_bytes(), RELEASE.read_bytes())

    def test_importer_fix_does_not_rewrite_the_previous_archive_or_nutrient_values(self):
        previous = RELEASE.with_name('concept-enrichment-2026-10-02.1.zip')
        self.assertEqual(sha(previous.read_bytes()), '6f8dc8dc5cc3cb58614572a5730c7f8d3ac2026ec90d73f2e9e17c54ea4513e3')
        with zipfile.ZipFile(previous) as old, zipfile.ZipFile(RELEASE) as current:
            for name in ['nutrition-profiles', 'recipe-nutrition', 'recipe-inputs', 'tfda-selected-records']:
                self.assertEqual(old.read('concept-enrichment-2026-10-02.1/' + name + '.json'),
                                 current.read(VERSION + '/' + name + '.json'))

    def test_supplement_cannot_rewrite_existing_review_decisions(self):
        with zipfile.ZipFile(RELEASE) as source:
            files = {name: source.read(name) for name in source.namelist()}
        target = VERSION + '/matching-decisions.json'
        decisions = json.loads(files[target])
        decisions[0]['status'] = 'approved'
        files[target] = json.dumps(decisions).encode()
        manifest_name = VERSION + '/manifest.json'
        manifest = json.loads(files[manifest_name])
        manifest['matching-decisions.json'] = sha(files[target])
        files[manifest_name] = json.dumps(manifest).encode()
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'changed.zip'
            with zipfile.ZipFile(archive, 'w') as output:
                for name, content in files.items():
                    output.writestr(name, content)
            with self.assertRaisesRegex(ValueError, 'References-only supplement changed recipes'):
                with_supplement(self.base, archive)

    def test_added_samples_have_original_observations_without_changing_recipes(self):
        data = with_supplement(self.base, RELEASE)
        report = audit(data)
        self.assertEqual(report['nutrition_profiles'], 46)
        self.assertEqual(report['concepts_with_scoped_nutrition_reference'], 44)
        self.assertEqual(report['profiles_with_checked_source_observations'], 46)
        self.assertEqual(report['profiles_missing_source_observations'], [])
        self.assertEqual(report['recipes_with_four_core_nutrients_per_serving'], 8)
        self.assertEqual(data['recipe-nutrition'], self.base['recipe-nutrition'])
        old_prefix = 'system-data-2026-09-15.2/data/nutrition/'
        with zipfile.ZipFile(RELEASE) as supplement, zipfile.ZipFile(ARCHIVE) as base:
            for name in ['recipe-nutrition', 'recipe-inputs', 'recipe-weighing-contracts', 'equipment-role-updates']:
                self.assertEqual(supplement.read(VERSION + '/' + name + '.json'), base.read(old_prefix + name + '.json'))
            self.assertEqual(report, json.loads(supplement.read(VERSION + '/source-coverage.json')))
        self.assertEqual(report, json.loads(Path(__file__).with_name('source-coverage-expanded.json').read_bytes()))
        additions = data['nutrition-profiles'][31:]
        forbidden = {'FORM:DDD-I-soy', 'FORM:DDD-I-tofu', 'FORM:DDD-I-sesameoil'}
        self.assertFalse({p['ingredient_form_id'] for p in additions} & forbidden)
        self.assertTrue(all(p['requires_scope_confirmation'] and p['automatic_runtime_binding'] is False for p in additions))
        vinegar = next(p for p in data['nutrition-profiles'] if p['source_food_id'] == 'TFDA:P0600101')
        self.assertIsNone(vinegar['nutrients_per_100g']['fat']['amount'])
        wintermelon = next(p for p in additions if p['source_food_id'] == 'TFDA:E6200103')
        self.assertEqual(wintermelon['nutrients_per_100g']['fat']['amount'], 0)

    def test_misidentified_form_source_or_nutrient_cannot_be_selected(self):
        for field, value in [('樣品名稱', '另一食材'), ('內容物描述', '熟制'), ('含量單位', 'mg')]:
            evidence = copy.deepcopy(self.evidence)
            evidence['records'][0]['row'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                new_profiles(self.base['catalogue'], self.selections, evidence)
        selections = copy.deepcopy(self.selections)
        selections[0]['ingredient_form_id'] = 'FORM:DDD-I-soy'
        with self.assertRaisesRegex(ValueError, 'Catalogue form identity'):
            new_profiles(self.base['catalogue'], selections, self.evidence)

    def test_corrupted_evidence_and_package_fail_instead_of_becoming_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            corrupt = directory / 'rows.json'
            evidence = copy.deepcopy(self.evidence)
            evidence['records'][0]['row']['每100克含量'] = '999'
            corrupt.write_text(json.dumps(evidence))
            with patch('expand_nutrition.ROWS', corrupt), self.assertRaisesRegex(ValueError, 'evidence checksum'):
                build(directory / 'must-not-exist.zip')
            changed = directory / 'changed.zip'
            with zipfile.ZipFile(RELEASE) as source, zipfile.ZipFile(changed, 'w') as target:
                for name in source.namelist():
                    raw = source.read(name)
                    target.writestr(name, raw + b' ' if name.endswith('/nutrition-profiles.json') else raw)
            with self.assertRaisesRegex(ValueError, 'Supplement checksum'):
                with_supplement(self.base, changed)


if __name__ == '__main__':
    unittest.main()
