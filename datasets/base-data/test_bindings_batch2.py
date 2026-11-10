import os
import sys
import json
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / 'reclean'))
import bindings_batch2 as b


class Batch2Tests(unittest.TestCase):
    def test_flagged_source_rejected(self):
        with self.assertRaisesRegex(ValueError, 'flagged'):
            b.validate([('i', '姜', '1', '生')], {'i': {'name': '姜'}}, {'TFDA:1': {}}, {'TFDA:1'})

    def test_duplicate_and_identity_rejected(self):
        rule = ('i', '姜', '1', '生')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            b.validate([rule, rule], {'i': {'name': '姜'}}, {'TFDA:1': {}}, set())
        with self.assertRaisesRegex(ValueError, 'Identity'):
            b.validate([rule], {'i': {'name': '蒜'}}, {'TFDA:1': {}}, set())

    @unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                         'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
    def test_reproducibility_provenance_and_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, c = Path(tmp) / 'a', Path(tmp) / 'c'
            s = b.build(a); b.build(c)
            self.assertEqual((a / (b.VERSION + '.zip')).read_bytes(), (c / (b.VERSION + '.zip')).read_bytes())
            bindings = json.loads((a / 'bindings.json').read_bytes())
            obs = json.loads((a / 'observations.json').read_bytes())
            raw = {r['source_position']: r['row'] for r in json.loads((a / 'source-rows.json').read_bytes())}
            self.assertEqual(len({o['id'] for o in obs}), len(obs))
            for o in obs:
                self.assertEqual(o['source_row_sha256'], b.sha(b.encoded(raw[o['source_position']])))
                self.assertEqual(o['amount'], b.parse(raw[o['source_position']]['每100克含量'])[0])
            byid = {o['id']: o for o in obs}
            for row in bindings:
                self.assertTrue(all(byid[o]['food_id'] == row['source_food_id'] for o in row['observation_ids']))
                self.assertFalse(row['default_selected'])
                self.assertFalse(row['automatic_runtime_binding'])
                self.assertTrue(row['requires_explicit_scope_confirmation'])
                if row['ingredient_id'] == 'DDD-I-ginger':
                    self.assertEqual(row['alternative_count'], 3)
            self.assertEqual(s['new_ingredient_ids'], 19)
            self.assertEqual(s['binding_options'], 24)
            self.assertEqual(s['actual_recipe_nutrition_calculations'], 0)
            queue = json.loads((a / 'remaining-priority.json').read_bytes())
            self.assertEqual(len(queue), 951)
            self.assertEqual(len({q['ingredient_id'] for q in queue}), 951)
            self.assertFalse({q['ingredient_id'] for q in queue} & {x['ingredient_id'] for x in bindings})
            with self.assertRaises(FileExistsError):
                b.build(a)


if __name__ == '__main__':
    unittest.main()
