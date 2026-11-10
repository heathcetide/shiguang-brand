import os
import sys
import json
import zipfile
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'reclean'))
import add_cn6 as c


class CN6Tests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                         'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
    def test_preservation_provenance_and_reproduction(self):
        with tempfile.TemporaryDirectory() as temp:
            a,b=Path(temp)/'a',Path(temp)/'b'
            s=c.build(a);c.build(b)
            self.assertEqual((a/(c.VERSION+'.zip')).read_bytes(),(b/(c.VERSION+'.zip')).read_bytes())
            with zipfile.ZipFile('artifacts/base-data/concept-base-1.0.0-rc.1/concept-base-1.0.0-rc.1.zip') as z:
                for n in ['concepts.json','ingredient-forms.json','search-index.json','methods.json','nutrition-links.json','usda-observations.json','nutrition-observations.json']:
                    self.assertEqual((a/n).read_bytes(),z.read(n))
            foods=json.loads((a/'cn6-foods.json').read_bytes());obs=json.loads((a/'cn6-observations.json').read_bytes());links=json.loads((a/'cn6-candidate-links.json').read_bytes())
            ids={r['id'] for r in foods};forms={r['id']:r for r in json.loads((a/'ingredient-forms.json').read_bytes())}
            self.assertEqual(len(ids),1677)
            self.assertEqual(len({o['id'] for o in obs}),51987)
            self.assertTrue(all(l['source_food_id'] in ids and forms[l['ingredient_form_id']]['concept_id']==l['ingredient_concept_id'] for l in links))
            self.assertTrue(all(not l['automatic_calculation_allowed'] for l in links))
            self.assertTrue(any(o['status']=='trace' and o['amount'] is None for o in obs))
            self.assertTrue(any(o['status']=='missing' and o['amount'] is None for o in obs))
            for r in foods:self.assertEqual(c.sha(c.encoded(r['raw_record'])),r['source_record_sha256'])
            self.assertEqual(s['cn6_source_corrections'],136)
            with self.assertRaises(FileExistsError):c.build(a)


if __name__=='__main__':unittest.main()
