import os
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).with_name('reclean')))
from enrich_next import build, VERSION

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                     'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
class NextEnrichmentTests(unittest.TestCase):
    def test_frozen_sources_reproduce_release_and_preserve_gaps(self):
        root = ROOT / 'artifacts/base-data'
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / VERSION
            summary = build(root / 'concept-base-1.0.0-rc.2', root / 'concept-enrichment-2026-09-15.1',
                            ROOT / '.cache/base-data-sources/round2/tfda.zip', output)
            self.assertEqual(summary['scoped_profiles'], 31)
            self.assertEqual(summary['core_complete_recipes'], 8)
            self.assertEqual((output / (VERSION + '.zip')).read_bytes(), (root / VERSION / (VERSION + '.zip')).read_bytes())
            recipes = json.loads((output / 'recipe-nutrition.json').read_text(encoding='utf8'))
            self.assertTrue(all(r['gaps'] for r in recipes if r['status'] == 'incomplete'))
            profiles = json.loads((output / 'nutrition-profiles.json').read_text(encoding='utf8'))
            vinegar = next(p for p in profiles if p['source_food_id'] == 'TFDA:P0600101')
            self.assertIsNone(vinegar['nutrients_per_100g']['fat']['amount'])
            self.assertIsNone(vinegar['nutrients_per_100g']['protein']['amount'])
            self.assertTrue(all(p['source_kind'] != 'CN6' for p in profiles))


if __name__ == '__main__':
    unittest.main()
