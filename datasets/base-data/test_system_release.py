"""Offline integrity and calculation checks for the actual distributed release."""
import hashlib
import json
from pathlib import Path
import unittest
import zipfile

from reclean.enrich_core import estimate

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'system-data-2026-09-15.2'
ARCHIVE = ROOT / 'datasets/releases' / (VERSION + '.zip')
SHA256 = '5bc9345bf6e232e34a0c6cbd4091d55f1a7f1ecce3f2e930f847431c19db3f30'


class SystemReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with zipfile.ZipFile(ARCHIVE) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError('Duplicate archive members')
            cls.files = {name.removeprefix(VERSION + '/'): archive.read(name) for name in names}

    def load(self, name):
        return json.loads(self.files[name])

    def test_frozen_archive_and_every_member_match_manifests(self):
        self.assertEqual(hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(), SHA256)
        manifest = self.load('manifest.json')
        self.assertEqual(manifest['version'], VERSION)
        self.assertEqual(set(self.files), set(manifest['files']) | {'manifest.json'})
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256(self.files[name]).hexdigest(), digest, name)
        for name, digest in self.load('data/nutrition/manifest.json').items():
            self.assertEqual(hashlib.sha256(self.files['data/nutrition/' + name]).hexdigest(), digest, name)

    def test_catalogue_references_are_unique_and_complete(self):
        data = self.load('data/runtime-input.json')
        ids = {}
        for table in ('concepts', 'ingredient-forms', 'recipe-concepts', 'methods'):
            ids[table] = {row['id'] for row in data[table]}
            self.assertEqual(len(ids[table]), len(data[table]), table)
        self.assertEqual(len(data['methods']), 389)
        for form in data['ingredient-forms']:
            self.assertIn(form['concept_id'], ids['concepts'])
        for alias in data['aliases']:
            self.assertIn(alias['concept_id'], ids['concepts'])
        for recipe in data['recipe-concepts']:
            self.assertIn(recipe['dish_concept_id'], ids['concepts'])
            self.assertLessEqual(set(recipe['method_ids']), ids['methods'])
            if recipe['primary_method_id'] is not None:
                self.assertIn(recipe['primary_method_id'], recipe['method_ids'])
            self.assertEqual(recipe['primary_method_id'], recipe['primary_nutrition_method_id'])
        for method in data['methods']:
            self.assertFalse(method['automatic_execution_allowed'])
            for ingredient in method['ingredients']:
                if ingredient.get('ingredient_form_id'):
                    self.assertIn(ingredient['ingredient_form_id'], ids['ingredient-forms'])

    def test_all_twenty_nutrition_results_recalculate_with_current_code(self):
        methods = {m['id']: m for m in self.load('data/nutrition/recipe-inputs.json')}
        profiles = self.load('data/nutrition/nutrition-profiles.json')
        results = self.load('data/nutrition/recipe-nutrition.json')
        self.assertEqual(len(results), 20)
        self.assertEqual(len(profiles), 31)
        self.assertEqual(sum(r['per_serving'] is not None for r in results), 8)
        self.assertTrue(all(not p['automatic_runtime_binding'] for p in profiles))
        for result in results:
            recalculated = estimate(methods[result['method_id']], result['selections'], profiles)
            for field in ('whole_recipe', 'per_serving', 'known_subtotal', 'coverage',
                          'status', 'per_100g_finished', 'automatic_meal_planning_allowed'):
                self.assertEqual(recalculated[field], result[field], (result['method_id'], field))
            if result['per_serving'] is None:
                self.assertTrue(result['gaps'])
        vinegar = next(p for p in profiles if p['source_food_id'] == 'TFDA:P0600101')
        self.assertIsNone(vinegar['nutrients_per_100g']['fat']['amount'])
        self.assertIsNone(vinegar['nutrients_per_100g']['protein']['amount'])
        self.assertTrue(all(p['source_kind'] != 'CN6' for p in profiles))


if __name__ == '__main__':
    unittest.main()
