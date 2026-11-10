import os
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('batch1', Path(__file__).parent / 'reclean' / 'bindings_batch1.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class BindingTests(unittest.TestCase):
    def test_unknown_not_zero(self):
        for raw in [None, '', '—', 'Tr', '1/2/3', '-1']:
            self.assertIsNone(b.parse(raw)[0])
        self.assertEqual(b.parse(' 0.0 ')[0], 0)

    def test_known_false_friends_excluded(self):
        self.assertTrue({'鸡精', '孜然粉', '红枣', '小龙虾', '腰子', '青辣椒', '洋葱粉'} <= set(b.REJECT))
        self.assertFalse(set(b.REJECT) & set(b.APPROVED))

    @unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                         'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
    def test_full_build_provenance_and_determinism(self):
        with tempfile.TemporaryDirectory() as temp:
            a, c = Path(temp) / 'a', Path(temp) / 'c'
            assessment = Path('artifacts/base-data/round2-assessment-1/round2-assessment-1.zip')
            source = Path('.cache/base-data-sources/round2/tfda.zip')
            summary = b.build(assessment, source, a)
            b.build(assessment, source, c)
            self.assertEqual((a / (b.VERSION + '.zip')).read_bytes(), (c / (b.VERSION + '.zip')).read_bytes())
            self.assertEqual(summary['single_candidates_reviewed'], 150)
            bindings = json.loads((a / 'bindings.json').read_bytes())
            observations = json.loads((a / 'observations.json').read_bytes())
            raw = {r['source_position']: r['row'] for r in json.loads((a / 'source-rows.json').read_bytes())}
            ids = {o['id'] for o in observations}
            self.assertEqual(len(ids), len(observations))
            for o in observations:
                r = raw[o['source_position']]
                self.assertEqual(b.sha(b.encoded(r)), o['source_row_sha256'])
                self.assertEqual(o['raw_amount'], r['每100克含量'])
                self.assertEqual(o['amount'], b.parse(r['每100克含量'])[0])
            for row in bindings:
                self.assertTrue(set(row['observation_ids']) <= ids)
                self.assertTrue(row['requires_explicit_scope_confirmation'])
                self.assertFalse(row['automatic_runtime_binding'])
                self.assertFalse(row['gross_weight_conversion_allowed'])
            self.assertTrue(any(not row['core_complete'] for row in bindings))
            with self.assertRaises(FileExistsError):
                b.build(assessment, source, a)

    def test_tampered_input_no_output(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / 'bad.zip'; p.write_bytes(b'bad')
            out = Path(temp) / 'out'
            with self.assertRaises(ValueError):
                b.build(p, p, out)
            self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
