"""Regression checks for first-round data completion."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

from reclean import round1_parser as r
from reclean import round1 as builder
from reclean import package as pkg

BASELINE = Path(os.environ.get('DDD_BASE_DATA_ROUND1_BASELINE', Path(__file__).resolve().parents[2] / 'artifacts/base-data/0.2.0-rc.1/dietdigidose-base-data-0.2.0-rc.1.zip'))


class ParserTests(unittest.TestCase):
    def setUp(self):
        ingredients = [dict(id=name, name=name, aliases=[]) for name in ('鸡蛋','蛋清','盐','油','水','黄油','玉米油','葱','姜','蒜','蚝油','青葱','玉米粒','青豆')]
        self.parser = r.Parser(ingredients, [dict(id='pan',name='平底锅',aliases=[])],
            dict(headings=['调料'], prepared_terms={}, bundles={'葱姜蒜':['葱','姜','蒜']}), dict(prepared_terms={}))

    def test_partition_total_and_optional_note_preserve_source_constraints(self):
        parsed = r.amount('2 根 1 根切段,1 根备用')
        self.assertEqual((parsed['kind'], parsed['value'], parsed['unit']), ('exact', 2, '根'))
        self.assertEqual(parsed['source_notes'], ['1 根切段,1 根备用'])
        self.assertEqual([m['value'] for m in parsed['additional_measurements']], [1, 1])
        for source in ['3 根 1 根切段,1 根备用', '2 根 2 根切段,1 根备用',
                       '2 根 0 根切段,2 根备用', '2 根 1 根切段,1 根备用或不放', '2 g 1 根切段,1 根备用']:
            self.assertEqual(r.amount(source)['kind'], 'unparsed', source)
        optional = self.parser.single('油 20g #不喜可不加')
        self.assertEqual(optional['measurement']['value'], 20)
        self.assertTrue(optional['optional'])
        self.assertEqual(optional['measurement']['source_notes'], ['#不喜可不加'])
        self.assertEqual(r.amount('20g #不喜可不加或改10g')['kind'], 'unparsed')

    def test_source_bounds_and_units_do_not_become_metric_scalars(self):
        for source, kind, lo, hi in [('160 克以上', 'lower_bound', 160, None),
                                     ('160 克以下', 'upper_bound', None, 160)]:
            parsed = r.amount(source)
            self.assertEqual((parsed['kind'], parsed['value'], parsed['minimum'], parsed['maximum']), (kind, None, lo, hi))
            self.assertIsNone(self.parser.single('水 ' + source)['quantity'])
        for source in ['约160克以上', '160克以上按需', '160克以上以下', '0克以上', '10-20克以上']:
            self.assertNotIn(r.amount(source)['kind'], ('lower_bound', 'upper_bound'), source)
        thumb = r.amount('1 拇指块')
        self.assertEqual((thumb['value'], thumb['unit'], thumb['dimension']), (1, '拇指块', 'source_unit'))
        self.assertIsNone(self.parser.single('姜 1 拇指块')['quantity'])
        portion = r.amount('1 份-2 份(看鸡蛋大小)')
        self.assertEqual((portion['kind'], portion['minimum'], portion['maximum'], portion['unit']), ('range', 1, 2, '份'))
        self.assertEqual(portion['source_notes'], ['(看鸡蛋大小)'])
        self.assertEqual(r.amount('2份-1份')['kind'], 'invalid')

    def test_explicit_counts_with_repeated_ingredient_names(self):
        for source, value, unit, note in [('两根中等大小的芹菜', 2, '根', '中等大小的芹菜'),
                                          ('一根大葱', 1, '根', '大葱'), ('7 瓣大蒜', 7, '瓣', '大蒜')]:
            parsed = r.amount(source)
            self.assertEqual((parsed['kind'], parsed['value'], parsed['unit']), ('exact', value, unit))
            self.assertEqual(parsed['source_notes'], [note])
            self.assertEqual(parsed['dimension'], 'source_unit')
        for source in ['2根中等大小的芹菜或大葱', '一根大葱以上', '7瓣大蒜按口味加减',
                       '7g大蒜', '2瓣大葱', '2根中等大小的芹菜共100g']:
            self.assertEqual(r.amount(source)['kind'], 'unparsed', source)

    def test_ice_identity_retains_unknown_amount_and_optional_source(self):
        rules = json.loads((Path(r.__file__).parent / 'round1-rules.json').read_text())
        parser = r.Parser([dict(id='ice', name='冰块', aliases=[])], [], rules, dict(prepared_terms={}))
        for source in ['冰几块（可选）', '大冰块差不多就行']:
            item = parser.single(source)
            self.assertEqual(item['ingredient_id'], 'ice')
            self.assertIsNone(item['quantity'])
            self.assertEqual(item['measurement']['kind'], 'missing')
            self.assertEqual(item['optional'], '可选' in source)
            self.assertIn('数量不明确', item['preparation'])

    def test_length_is_not_a_mass_or_scalar_recipe_quantity(self):
        for source, value in [('10cm', 10), ('3 厘米长,拍散备用', 3)]:
            parsed = r.amount(source)
            self.assertEqual((parsed['value'], parsed['unit'], parsed['dimension']), (value, 'cm', 'length'))
            self.assertIsNone(self.parser.single('姜 ' + source)['quantity'])
        for source in ['4 厘米一小片', '3 克长,拍散备用', '3 厘米长,拍散备用或不放']:
            self.assertEqual(r.amount(source)['kind'], 'unparsed')

    def test_ratio_label_preserves_quantity_but_does_not_confirm_identity(self):
        parser = r.Parser([dict(id='syrup', name='蔗糖糖浆', aliases=[])], [],
                          dict(headings=[], prepared_terms={}, bundles={}), dict(prepared_terms={}))
        for source in ['1 : 1 蔗糖糖浆 10 克（可选）', '1 : 1 蔗糖糖浆 30~40 克']:
            item = parser.parse(source)['items'][0]
            self.assertEqual(item['name'], '蔗糖糖浆')
            self.assertIsNone(item['ingredient_id'])
            self.assertEqual(item['mapping_status'], 'unresolved')
            self.assertEqual(item['candidate_ingredient_ids'], ['syrup'])
            self.assertIn('1:1', item['qualifiers'][-1])
            self.assertEqual(item['optional'], '可选' in source)
        self.assertIsNone(r.syrup_ratio('2 : 1 蔗糖糖浆 10 克'))

    def test_plain_preparation_notes_preserve_explicit_amounts_only(self):
        for text, value, unit in [('5 条 切段', 5, '条'), ('200 毫升 普通袋装牛奶即可', 200, 'ml'),
                                  ('80 克 普通砂糖即可 细砂糖更优 易于融化', 80, 'g')]:
            parsed = r.amount(text)
            self.assertEqual((parsed['kind'], parsed['value'], parsed['unit']), ('exact', value, unit))
            self.assertTrue(parsed['source_notes'])
        parsed = r.amount('25g-40g 切成碎')
        self.assertEqual((parsed['kind'], parsed['minimum'], parsed['maximum']), ('range', 25, 40))
        for text in ['5 条 切段或不放', '200 毫升 普通袋装牛奶即可按口味加减',
                     '1 个 50 g', '10 + 25 ml', '半瓶 250ml', '5 条 切段以上']:
            self.assertEqual(r.amount(text)['kind'], 'unparsed', text)

    def test_explicit_source_modifiers_map_without_allocating_shared_totals(self):
        rules = json.loads(Path(__file__).with_name('reclean').joinpath('round1-rules.json').read_bytes())
        parser = r.Parser([{'id': name, 'name': name, 'aliases': []}
                           for name in ['洋葱', '猪肉', '无骨肉', '牛肉', '鸡肉', '鱼丸', '火腿肠']],
                          [], rules, {'prepared_terms': {}})
        onion = parser.parse('比拳头大一点的洋葱一个')['items'][0]
        self.assertEqual(onion['ingredient_id'], '洋葱')
        self.assertEqual(onion['measurement']['unit'], '个')
        self.assertIsNone(onion['quantity'])
        mixed = parser.parse('无骨肉共需 430 克，其中猪肉、牛肉、鸡肉、鱼丸、火腿肠的比例按自己喜好分配即可')
        pork = next(line for line in mixed['items'] if line['name'] == '其中猪肉')
        self.assertEqual(pork['ingredient_id'], '猪肉')
        self.assertTrue(all(line['quantity'] is None and line['measurement']['kind'] == 'missing' for line in mixed['items']))

    def test_primary_count_is_not_replaced_by_parenthetical_weight(self):
        value = r.amount('2 个(约 100g)')
        self.assertEqual((value['value'], value['unit']), (2, '个'))
        self.assertEqual(value['additional_measurements'][0]['value'], 100)
        self.assertTrue(value['additional_measurements'][0]['approximate'])

    def test_amount_prefix_and_parentheses_do_not_corrupt_identity(self):
        for raw in ('鸡蛋 2 个（约 100g）', '2 个鸡蛋（约 100g）', '鸡蛋（可选）2 个'):
            item = self.parser.single(raw)
            self.assertEqual(item['ingredient_id'], '鸡蛋', raw)
            self.assertEqual(item['measurement']['value'], 2, raw)
            self.assertIsNone(item['quantity'])
        self.assertEqual(self.parser.single('盐的用量为:2g。')['quantity'], 2)

    def test_primary_unit_not_replaced_by_equality_reference(self):
        value = r.amount('1 块 = 10 克')
        self.assertEqual((value['value'], value['unit']), (1,'块'))
        self.assertEqual(value['additional_measurements'][0]['value'], 10)
        self.assertEqual(r.amount('70 x 5 = 350g')['value'], 350)
        self.assertTrue(r.amount('70 x 5 = 350g')['stated_result'])

    def test_fraction_does_not_disable_ingredient_choice(self):
        result = self.parser.parse('黄油或玉米油 ⅛ cup')
        self.assertEqual(result['kind'], 'choice')
        self.assertIsNone(result['items'][0]['ingredient_id'])
        self.assertEqual(result['items'][0]['ingredient_options'][1]['measurement']['value'], 0.125)
        self.assertEqual(r.amount('2½ cup')['value'], 2.5)

    def test_per_person_formula_is_not_a_choice(self):
        result = self.parser.parse('盐 5g/人')
        self.assertEqual(result['kind'], 'ingredient')
        self.assertEqual(result['items'][0]['measurement']['kind'], 'formula')
        self.assertIsNone(result['items'][0]['quantity'])

    def test_unknown_choice_never_selects_first_ingredient(self):
        result = self.parser.parse('黄油或其他油脂 20g')
        self.assertEqual(result['items'][0]['mapping_status'], 'choice_unresolved')
        self.assertIsNone(result['items'][0]['ingredient_id'])
        self.assertIsNone(result['items'][0]['quantity'])

    def test_shared_bundle_does_not_duplicate_total(self):
        result = self.parser.parse('葱姜蒜 50g')
        self.assertEqual(result['kind'], 'bundle')
        self.assertEqual(len(result['items']), 3)
        self.assertTrue(all(i['quantity'] is None and i['measurement']['value'] is None for i in result['items']))
        result = self.parser.parse('盐 3g、油 5ml')
        self.assertEqual([i['quantity'] for i in result['items']], [3,5])
        combined = self.parser.parse('玉米粒和青豆总共 30g')
        self.assertEqual(combined['kind'],'bundle')
        self.assertTrue(all(i['quantity'] is None for i in combined['items']))

    def test_bounded_quantity_and_part_qualifier_are_retained(self):
        value = r.amount('≥30 ml')
        self.assertEqual(value['kind'],'lower_bound')
        self.assertEqual(value['minimum'],30)
        self.assertIsNone(value['value'])
        item = self.parser.single('青葱，葱白，25g。')
        self.assertEqual(item['quantity'],25)
        self.assertIn('葱白',item['qualifiers'])

    def test_headings_equipment_and_unit_definitions_are_not_foods(self):
        self.assertEqual(self.parser.parse('调料')['kind'], 'heading')
        self.assertEqual(self.parser.parse('1 汤匙 = 15ml')['kind'], 'instruction')
        self.assertEqual(self.parser.parse('平底锅 1 个')['kind'], 'equipment')

    def test_optional_and_egg_part_survive_parsing(self):
        self.assertTrue(self.parser.single('[可选] 蚝油 3ml')['optional'])
        self.assertEqual(self.parser.single('一个鸡蛋的鸡蛋清')['ingredient_id'],'蛋清')
        value = r.amount('0-80g')
        self.assertEqual(value['kind'],'optional_range')
        self.assertIsNone(value['value'])

    def test_unknown_units_and_invalid_values_remain_unusable(self):
        for raw in ('0g','-5g','NaN g','1/0 g','2mm','适量','少许'):
            self.assertIsNone(r.amount(raw)['value'], raw)
        self.assertEqual(r.amount('2 斤')['unit'],'斤')


@unittest.skipUnless(os.environ.get('DDD_TEST_HISTORICAL_DATA') == '1',
                     'Historical rebuild: supply pinned inputs listed in TESTING.md and set DDD_TEST_HISTORICAL_DATA=1')
class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='ddd-round1-tests-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.archive, cls.report = builder.build(BASELINE, cls.root/'first')
        with zipfile.ZipFile(cls.archive) as z:
            cls.files = {name:z.read(name) for name in z.namelist()}
        cls.after = {name:json.loads(cls.files['clean/'+name+'.json']) for name in (
            'ingredients','recipes','kitchenware','initial-data','nutrition-foods','nutrition-observations')}
        cls.before = {name:json.loads(cls.files['upstream/rc1/clean/'+name+'.json']) for name in cls.after}
        cls.ledger = json.loads(cls.files['review/round1-original-unresolved-ledger.json'])

    def recipe(self,title):
        return next(r for r in self.after['recipes'] if r['title']==title and r['source']=='howtocook')

    def test_every_original_unresolved_line_is_accounted_for(self):
        self.assertEqual(len(self.ledger),712)
        self.assertEqual(len({x['id'] for x in self.ledger}),712)
        self.assertLess(self.report['unresolved_line_outcomes']['unresolved'],60)
        self.assertGreater(self.report['unresolved_line_outcomes']['ingredient_linked'],500)
        incomplete = self.ledger[:-1]
        with self.assertRaisesRegex(ValueError,'ledger is incomplete'):
            builder.validate(self.after,self.before,incomplete)

    def test_all_old_ids_and_out_of_scope_data_preserved(self):
        for name in ('ingredients','kitchenware','recipes'):
            self.assertLessEqual({r['id'] for r in self.before[name]},{r['id'] for r in self.after[name]})
        for name in ('initial-data','nutrition-foods','nutrition-observations'):
            self.assertEqual(self.before[name],self.after[name])
        self.assertEqual(len(self.after['recipes']),389)

    def test_new_catalogue_entries_have_actual_source_evidence(self):
        recipes = {r['id']:r for r in self.before['recipes']}
        for name in ('ingredients','kitchenware'):
            old = {r['id'] for r in self.before[name]}
            for row in self.after[name]:
                if row['id'] not in old:
                    self.assertTrue(row['name_evidence'])
                    for evidence in row['name_evidence']:
                        source = recipes[evidence['recipe_id']]
                        self.assertEqual(source[evidence['source_field']][evidence['position']]['source_text'],evidence['source_text'])
                        self.assertEqual(source['source_sha256'],evidence['source_sha256'])

    def test_step_supplements_and_conflicting_salt_are_distinct(self):
        fish = self.recipe('鱼香肉丝')
        water = next(i for i in fish['ingredients'] if i['name']=='水')
        self.assertEqual(water['quantity'],40)
        self.assertEqual(len(water['amount_provenance']['allocations']),2)
        salt = next(i for i in fish['ingredients'] if i['name']=='盐')
        self.assertEqual(salt['quantity'],5)
        self.assertTrue(fish['source_inconsistencies'])
        self.assertIn('source_quantity_inconsistency',fish['readiness']['blockers'])
        vegetable = self.recipe('水油焖蔬菜')
        oyster = next(i for i in vegetable['ingredients'] if i['name']=='蚝油')
        self.assertTrue(oyster['optional'])
        self.assertEqual(oyster['quantity'],3)

    def test_equipment_instructions_have_evidence(self):
        recipe = self.recipe('煎饺')
        explicit = [r for r in recipe['kitchenware_requirements'] if r['source_section']=='operation']
        self.assertEqual(len(explicit),2)
        self.assertTrue(all(r['role']=='required' for r in explicit))
        self.assertFalse(recipe['automatic_inventory_write_allowed'])

    def test_reproducible_package_and_self_contained_builder(self):
        second,_ = builder.build(BASELINE,self.root/'second')
        self.assertEqual(self.archive.read_bytes(),second.read_bytes())
        builder.verify(self.archive)
        extracted = self.root/'extracted'
        with zipfile.ZipFile(self.archive) as z:z.extractall(extracted)
        out = self.root/'self-contained'
        result = subprocess.run([sys.executable,str(extracted/'build/reclean/round1.py'),'--baseline',str(BASELINE.resolve()),'--output',str(out)],
                                capture_output=True,text=True,encoding='utf8',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.archive.read_bytes(),(out/self.archive.name).read_bytes())

    def test_source_tampering_and_output_overwrite_rejected(self):
        bad = self.root/'bad.zip';bad.write_bytes(BASELINE.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'Baseline archive hash mismatch'):
            builder.build(bad,self.root/'bad-output')
        self.assertFalse((self.root/'bad-output').exists())
        with self.assertRaisesRegex(ValueError,'already exists'):
            builder.build(BASELINE,self.root/'first')

    def test_shared_amount_and_choice_cannot_be_silently_applied(self):
        changed = deepcopy(self.after)
        item = next(i for recipe in changed['recipes'] for i in recipe['ingredients'] if i.get('ingredient_options'))
        item['ingredient_id'] = item['ingredient_options'][0]['ingredient_id']
        recipe = next(recipe for recipe in changed['recipes'] if item in recipe['ingredients'])
        recipe['content_sha256'] = pkg.digest(pkg.encoded({k:v for k,v in recipe.items() if k!='content_sha256'}))
        with self.assertRaisesRegex(ValueError,'Choice silently selected'):
            builder.validate(changed,self.before,self.ledger)


if __name__ == '__main__':
    unittest.main()
