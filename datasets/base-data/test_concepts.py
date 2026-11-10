import os
import sys
import json
import tempfile
import unittest
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / 'reclean'))
import concepts as c
from concept_runtime import search, estimate
from concept_diff import compare


@unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                     'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
class ConceptPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.a = Path(cls.temp.name) / 'a'
        cls.data = c.build(cls.a)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_all_legacy_records_and_relations(self):
        c.validate(self.data)
        self.assertEqual(len(self.data['ingredient-forms.json']), 984)
        self.assertEqual(len(self.data['methods.json']), 389)
        self.assertEqual(len(self.data['nutrition-links.json']), 38)

    def test_confirmed_merges_and_species_separation(self):
        index = self.data['search-index.json']
        self.assertEqual([x['concept_id'] for x in search(index, '鸡蛋')], ['WD-Q15260613'])
        self.assertEqual({x['concept_id'] for x in search(index, '金针菇')}, {'WD-Q25416839','WD-Q372893'})
        self.assertEqual([x['concept_id'] for x in search(index, '毛腿冬菇')], ['WD-Q372893'])

    def test_regional_ambiguity_not_hidden(self):
        index = self.data['search-index.json']
        cn, tw = search(index, '土豆', 'CN'), search(index, '土豆', 'TW')
        self.assertGreaterEqual(len(cn), 2)
        self.assertEqual({x['concept_id'] for x in cn}, {x['concept_id'] for x in tw})
        self.assertEqual(cn[0]['concept_id'], 'WD-Q16587531')
        self.assertNotEqual(tw[0]['concept_id'], 'WD-Q16587531')

    def test_parts_share_core_without_losing_details(self):
        f = {r['legacy_ingredient_id']: r for r in self.data['ingredient-forms.json']}
        a, b = f['DDD-I-chicken'], f['DDD-I-SRC-51f14137547888ab']
        self.assertEqual(a['concept_id'], b['concept_id'])
        self.assertEqual(a['properties']['skin'], 'removed')
        self.assertNotIn('skin', b['properties'])

    def test_products_do_not_become_generic_search_results(self):
        self.assertEqual(search(self.data['search-index.json'], '老干妈'), [])
        self.assertEqual(search(self.data['search-index.json'], '可口可乐'), [])
        self.assertTrue(any(x['name']=='可口可乐' for x in self.data['products.json']))

    def test_dish_primary_and_variants(self):
        a = search(self.data['search-index.json'], '番茄炒蛋')
        b = search(self.data['search-index.json'], '西红柿炒鸡蛋')
        self.assertEqual(a[0]['concept_id'], b[0]['concept_id'])
        recipe = next(r for r in self.data['recipe-concepts.json'] if r['dish_concept_id']==a[0]['concept_id'])
        self.assertEqual(len(recipe['method_ids']), 2)
        self.assertEqual(recipe['primary_method_id'], recipe['primary_nutrition_method_id'])

    def test_no_invented_recipe_or_nutrition(self):
        self.assertTrue(any(not r['method_ids'] and r['primary_method_id'] is None for r in self.data['recipe-concepts.json']))
        self.assertTrue(all(n['status']=='incomplete' and n['per_100_g_finished'] is None for n in self.data['method-nutrition.json']))

    def test_release_reproducible_and_diff_empty(self):
        other = Path(self.temp.name) / 'b'
        c.build(other)
        a, b = self.a / (c.VERSION+'.zip'), other / (c.VERSION+'.zip')
        self.assertEqual(a.read_bytes(), b.read_bytes())
        self.assertTrue(all(not v['added'] and not v['removed'] and not v['changed'] for v in compare(a,b).values()))

    def test_packaged_builder_without_workspace_inputs(self):
        dest = Path(self.temp.name) / 'standalone'
        result = subprocess.run([sys.executable, str(self.a / 'concepts.py'), '--output', str(dest)], cwd=self.temp.name, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.a / (c.VERSION+'.zip')).read_bytes(), (dest / (c.VERSION+'.zip')).read_bytes())


class CalculationTests(unittest.TestCase):
    def fixture(self):
        method = {'ingredients': [{'line_id':'1','ingredient_form_id':'f'}], 'servings':2}
        link = {'id':'l','ingredient_form_id':'f','scope_key':'raw','source_food_id':'s','observation_ids':['o']}
        observation = {'id':'o','food_id':'s','nutrient_name':'energy','unit':'kcal','amount':100}
        selection = {'1':{'link_id':'l','scope_key':'raw','basis':'per_100_g_source_prepared_sample','prepared_sample_grams':50}}
        return method,selection,[link],[observation]

    def test_explicit_batch_and_serving(self):
        result = estimate(*self.fixture())
        self.assertEqual(result['known_subtotal']['energy|kcal'],50)
        self.assertEqual(result['per_serving']['energy|kcal'],25)
        self.assertIsNone(result['per_100_g_finished'])

    def test_missing_not_zero(self):
        m,s,l,o = self.fixture(); o[0]['amount']=None
        r = estimate(m,s,l,o)
        self.assertEqual(r['status'],'incomplete')
        self.assertNotIn('energy|kcal',r['known_subtotal'])
        self.assertIsNone(r['per_serving'])

    def test_wrong_state_form_and_weight_rejected(self):
        for field,value in [('scope_key','cooked'),('basis','gross_weight'),('prepared_sample_grams',float('nan')),('prepared_sample_grams',-1)]:
            m,s,l,o = self.fixture();s['1'][field]=value
            with self.assertRaises(ValueError): estimate(m,s,l,o)
        m,s,l,o=self.fixture();l[0]['ingredient_form_id']='different'
        with self.assertRaises(ValueError):estimate(m,s,l,o)

    def test_omitted_line_never_complete(self):
        m,s,l,o=self.fixture();m['ingredients'].append({'line_id':'2','ingredient_form_id':'other'})
        r=estimate(m,s,l,o)
        self.assertEqual(r['status'],'incomplete')
        self.assertIsNone(r['per_serving'])

    def test_empty_recipe_is_not_complete(self):
        r=estimate({'ingredients':[], 'servings':2}, {}, [], [])
        self.assertEqual(r['status'],'incomplete')
        self.assertIsNone(r['per_serving'])

    def test_supplementary_unicode_preserved(self):
        self.assertEqual(c.simplify('𣎴'), '𣎴')


if __name__ == '__main__': unittest.main()
