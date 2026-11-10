import os
import copy
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from reclean.enrich_core import build, estimate, sha, VERSION

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'artifacts/base-data/concept-base-1.0.0-rc.2'
PACKAGE = ROOT / 'artifacts/base-data' / VERSION
ARCHIVE = ROOT / 'artifacts/base-data/enrichment-inputs/usda-sr-legacy-2018-04.zip'


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


class EnrichmentTests(unittest.TestCase):
    def setUp(self):
        with zipfile.ZipFile(ROOT / 'datasets/releases/system-data-2026-09-15.2.zip') as archive:
            prefix = 'system-data-2026-09-15.2/data/nutrition/'
            load = lambda name: json.loads(archive.read(prefix + name + '.json'))
            self.method = next(m for m in load('recipe-inputs') if m['title'] == '番茄炒蛋' and m['source_method_id'].startswith('DDD-R-'))
            self.results = load('recipe-nutrition')
            self.result = next(m for m in self.results if m['method_id'] == self.method['id'])
            self.profiles = load('nutrition-profiles')
        self.selections = copy.deepcopy(self.result['selections'])

    def test_recalculation_matches_package(self):
        self.assertEqual(estimate(self.method, self.selections, self.profiles), self.result)
        self.assertEqual(self.result['per_serving']['calories'], round(self.result['whole_recipe']['calories'] / 2, 4))

    def test_missing_line_is_not_zero(self):
        result = estimate(self.method, self.selections[1:], self.profiles)
        self.assertIsNone(result['per_serving'])
        self.assertTrue(all(v is None for v in result['whole_recipe'].values()))
        self.assertEqual(len(result['gaps']), 1)

    def test_missing_nutrient_is_not_zero(self):
        profile = next(p for p in self.profiles if p['id'] == self.selections[0]['profile_id'])
        profile['nutrients_per_100g']['protein']['amount'] = None
        result = estimate(self.method, self.selections, self.profiles)
        self.assertIsNone(result['whole_recipe']['protein'])
        self.assertIsNone(result['per_serving'])

    def test_rejects_wrong_scope_and_invalid_weights(self):
        for key, value in [('scope', 'unconfirmed'), ('grams', True), ('grams', float('nan')), ('grams', -1), ('weight_basis', 'cooked_grams')]:
            with self.subTest(key=key, value=value):
                selections = copy.deepcopy(self.selections)
                selections[0][key] = value
                with self.assertRaises(ValueError):
                    estimate(self.method, selections, self.profiles)

    def test_no_implicit_ml_conversion_or_choice_resolution(self):
        for update in [{'measurement': {'kind': 'exact', 'unit': 'ml', 'value': self.selections[0]['grams']}}, {'ingredient_options': ['alternative']}]:
            method = copy.deepcopy(self.method)
            method['ingredients'][0].update(update)
            with self.assertRaises(ValueError):
                estimate(method, self.selections, self.profiles)

    def test_empty_recipe_and_unknown_servings(self):
        self.method['servings'] = None
        self.assertIsNone(estimate(self.method, self.selections, self.profiles)['per_serving'])
        self.method['ingredients'] = []
        result = estimate(self.method, [], self.profiles)
        self.assertTrue(all(v is None for v in result['whole_recipe'].values()))

    def test_no_automatic_approval(self):
        self.assertTrue(all(not p['automatic_runtime_binding'] and p['requires_scope_confirmation'] for p in self.profiles))
        results = self.results
        self.assertEqual(sum(r['per_serving'] is not None for r in results), 8)
        self.assertTrue(all(not r['automatic_meal_planning_allowed'] for r in results))

    @unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                         'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
    def test_manifest_and_reproducible_build(self):
        for name, digest in read(PACKAGE / 'manifest.json').items():
            self.assertEqual(sha((PACKAGE / name).read_bytes()), digest, name)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'rebuilt'
            build(BASE, ARCHIVE, output)
            self.assertEqual((output / (VERSION + '.zip')).read_bytes(), (PACKAGE / (VERSION + '.zip')).read_bytes())


if __name__ == '__main__':
    unittest.main()
