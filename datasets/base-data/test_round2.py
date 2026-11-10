import os
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

builder = Path(__file__).parent / 'reclean' / 'round2.py'
if not builder.exists():
    builder = Path(__file__).parent / 'round2.py'
spec = importlib.util.spec_from_file_location('round2', builder)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class Round2Tests(unittest.TestCase):
    def test_unknown_and_trace_not_zero(self):
        for x in [None, '', '—', 'Tr', '-1', '<0.1']:
            self.assertIsNone(r.number(x)[0])
        self.assertEqual(r.number('0'), (0.0, 'numeric'))
        self.assertEqual(r.number('1.0/2.0/3.0'), (None, 'ratio'))

    def test_preserve_states(self):
        self.assertEqual(r.key('馬鈴薯'), '马铃薯')
        self.assertNotEqual(r.key('鸡肉(熟)'), r.key('鸡肉'))
        self.assertNotEqual(r.key('鸡胸肉'), r.key('鸡肉'))

    def test_explicit_alias_only(self):
        self.assertIn('牛胸', r.source_names('牛肉（胸部肉）［牛胸］'))
        self.assertNotIn('牛肉', r.source_names('牛肉（胸部肉）［牛胸］'))

    def test_multiple_matches_never_auto_select(self):
        foods = [{'id': 'CN6:1', 'names': ['豆腐']}, {'id': 'TFDA:2', 'names': ['豆腐']}]
        m, _ = r.match([{'id': 'a', 'name': '豆腐'}], foods)
        self.assertEqual(m[0]['status'], 'multiple_name_candidates')
        self.assertFalse(m[0]['approved_nutrition_mapping'])

    def test_unit_mismatch_excluded(self):
        foods = [{'id': 'CN6:1', 'name': 'a', 'raw': {'energyKCal': '100', 'protein': '10', 'fat': '20'}},
                 {'id': 'TFDA:2', 'name': 'a', 'observations': {'熱量': [{'unit': 'kJ', 'raw_amount': '500'}]}}]
        diffs, count = r.differences(foods, {'a': {'CN6:1', 'TFDA:2'}})
        self.assertEqual(count, 1)
        self.assertEqual(diffs, [])

    @unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                         'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
    def test_full_build_and_reproducibility(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / 'a', Path(temp) / 'b'
            cache = Path('.cache/base-data-sources/round2')
            baseline = Path('artifacts/base-data/0.2.0-rc.2/dietdigidose-base-data-0.2.0-rc.2.zip')
            summary = r.build(cache, baseline, a)
            r.build(cache, baseline, b)
            self.assertEqual((a / (r.VERSION + '.zip')).read_bytes(), (b / (r.VERSION + '.zip')).read_bytes())
            matches = json.loads((a / 'ingredient-matches.json').read_bytes())
            refs = json.loads((a / 'source-reference.json').read_bytes())
            ids = {x['id'] for x in refs}
            self.assertEqual(len(matches), 984)
            self.assertEqual(len({m['ingredient_id'] for m in matches}), 984)
            self.assertTrue(all(set(m['candidates']) <= ids for m in matches))
            self.assertEqual(sum(summary['match_status'].values()), 984)
            self.assertEqual(summary['source_records'], {'CN6': 1677, 'TFDA': 2180})
            self.assertEqual(summary['approved_nutrition_mappings'], 0)
            self.assertTrue(all('raw' not in x and 'observations' not in x for x in refs))
            with self.assertRaises(FileExistsError):
                r.build(cache, baseline, a)

    def test_bad_baseline_rejected_without_output(self):
        with tempfile.TemporaryDirectory() as temp:
            bad = Path(temp) / 'bad.zip'; bad.write_bytes(b'bad')
            out = Path(temp) / 'out'
            with self.assertRaisesRegex(ValueError, 'Baseline SHA'):
                r.build(Path(temp), bad, out)
            self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
