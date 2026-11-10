"""Behavioral and source-integrity regression tests for the recleaned package."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

from reclean import normalize as n
from reclean import package as p

ROOT = Path(__file__).resolve().parents[2]
RC7 = Path(os.environ.get('DDD_BASE_DATA_RC7_ARCHIVE', ROOT / '.cache/base-data-releases/dietdigidose-base-data-0.1.0-rc.7.zip'))
HTC = Path(os.environ.get('DDD_BASE_DATA_HTC_ARCHIVE', ROOT / '.cache/base-data-sources/howtocook-2b19c9e9ee926fd925a68207a57582a338813f9c.zip'))


class MeasurementTests(unittest.TestCase):
    def test_metric_and_count_units(self):
        self.assertEqual(n.measurement('1.25 kg')['value'], 1250)
        self.assertEqual(n.measurement('半升')['value'], 500)
        self.assertEqual(n.measurement('两瓣')['value'], 2)
        self.assertEqual(n.measurement('1/2 茶匙')['unit'], '茶匙')
        self.assertEqual(n.measurement('2 斤')['unit'], '斤')
        self.assertEqual(n.measurement('2 斤')['dimension'], 'regional_mass')

    def test_ranges_never_become_scalar(self):
        for raw in ('6-15g', '6 g 至 15 g', '6g ~ 15g'):
            value = n.measurement(raw)
            self.assertEqual((value['minimum'], value['maximum']), (6, 15))
            self.assertIsNone(value['value'])
        self.assertEqual(n.measurement('15-6g')['kind'], 'invalid')
        self.assertEqual(n.measurement('1kg-2g')['kind'], 'unparsed')

    def test_unknown_invalid_and_approximate(self):
        for raw in (None, '', '适量', '少许', '0g', '-5g', 'NaN g', '1/0 g', '50g 加盐 5g'):
            self.assertIsNone(n.measurement(raw)['value'], raw)
        self.assertTrue(n.measurement('约 50g')['approximate'])
        self.assertEqual(n.measurement('10g(可选)')['note'], '可选')

    def test_formula_coefficient_without_evaluation(self):
        for raw in ('50g * 份数', '份数 * 50 g', '50 g/份'):
            value = n.measurement(raw)
            self.assertEqual(value['kind'], 'formula')
            self.assertEqual(value['coefficient']['value'], 50)
            self.assertEqual(value['basis'], 'per_source_portion')
            self.assertIsNone(value['value'])
        self.assertEqual(n.measurement('50g/人')['basis'], 'per_person')
        self.assertIsNone(n.measurement('1 g 每个鸡蛋')['coefficient'])
        self.assertEqual(n.measurement('__import__("os")')['kind'], 'unparsed')

    def test_ingredient_boundaries_and_preparation(self):
        for raw, expected in [('盐 6-15 g', ('盐', '6-15 g')), ('生抽（10-15ml）', ('生抽', '10-15ml')),
                              ('吐司两片', ('吐司', '两片')), ('鸡蛋的用量为 1 个。', ('鸡蛋', '1 个')),
                              ('木耳（干） 5g', ('木耳(干)', '5g')), ('生抽：10毫升', ('生抽', '10毫升'))]:
            self.assertEqual(n.split_item(raw), expected)

    def test_servings_are_not_batches_or_ranges(self):
        self.assertEqual(n.serving_evidence('一份够 2 个人吃。')['servings'], 2)
        for raw in ('每 2 份：', '3 人以上版本', '1-2 人食用', '大概 2 人食用', '每份 1 个鸡蛋', '- 鸡蛋 2 人份'):
            self.assertIsNone(n.serving_evidence(raw)['servings'], raw)
        self.assertEqual(n.serving_evidence('1 人食用；3 人食用')['status'], 'conflicting')

    def test_direction_words_do_not_qualify_explicit_diners(self):
        for text, count in [('以下为一份两人食用的量：', 2), ('按照两个人的份量：', 2),
                            ('每份：三人量', 3), ('一份正好够 2 人喝。', 2),
                            ('一份为一人餐，多人餐请等比例增加。', 1),
                            ('对于一人份（三小碗）的情况，一份的分量是：\n以上原料分量可以按照自己的口味偏好适当调整。', 1)]:
            self.assertEqual(n.serving_evidence(text)['servings'], count)
        for text in ['2 人份以上', '2 人份及以上', '2 人份及以下', '2 人份或以上',
                     '本人饭量较大，这是本人一人量', '每份按我的饭量为一人量', '2 人的份量以下', '一份正好够 4-5 个人饮用', '2 人以下食用', '3 人食用以上', '最多 2 人份',
                     '以下用量约 2 人份', '约两人份', '以下为 2-3 人食用', '以下为 2 人食用；另一版 4 人食用']:
            self.assertIsNone(n.serving_evidence(text)['servings'], text)

    def test_step_sections_and_nested_evidence(self):
        steps = n.parse_steps('### 腌料\n1. 混合\n  - 小火\n继续搅拌。\n### 炒菜\n1. 翻炒\n2. 盛盘')
        self.assertEqual(len(steps), 3)
        self.assertEqual([r['section'] for r in steps], ['腌料', '炒菜', '炒菜'])
        self.assertIn('继续搅拌', steps[0]['text'])
        self.assertEqual([r['order'] for r in steps], [1, 2, 3])

    def test_table_variants_preserve_all_columns(self):
        variants = n.table_variants('| 原料 | 6寸 | 8寸 |\n|---|---|---|\n| 鸡蛋 | 3个 | 5个 |\n| 白糖 | 50g | 80g |')
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[1]['ingredients'][1]['measurement']['value'], 80)

    def test_step_mentions_preserve_negation_and_do_not_sum(self):
        index = n.make_index([dict(id='salt', name='盐', aliases=[]), dict(id='oil', name='油', aliases=[])])
        steps = n.parse_steps('1. 加入 15ml 油。\n2. 不要加入盐 5g。')
        evidence = n.step_amounts(steps, index, {})
        self.assertEqual({e['ingredient_id'] for e in evidence}, {'salt', 'oil'})
        self.assertTrue(any('不要' in e['source_text'] for e in evidence))
        self.assertTrue(all('negation' in e['interpretation'] for e in evidence))


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not RC7.exists() or not HTC.exists():
            raise RuntimeError('Locked source ZIPs required; set DDD_BASE_DATA_RC7_ARCHIVE and DDD_BASE_DATA_HTC_ARCHIVE')
        cls.temp = tempfile.TemporaryDirectory(prefix='ddd-reclean-tests-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.work = Path(cls.temp.name)
        cls.archive, cls.report = p.build(RC7, HTC, cls.work / 'first')
        with zipfile.ZipFile(cls.archive) as z:
            cls.files = {name: z.read(name) for name in z.namelist()}
        cls.data = {name: json.loads(cls.files['clean/' + name + '.json']) for name in (
            'ingredients', 'recipes', 'kitchenware', 'initial-data', 'nutrition-foods', 'nutrition-observations')}

    def recipe(self, title):
        return next(r for r in self.data['recipes'] if r['title'] == title)

    def test_rebuild_bytes_are_identical(self):
        second, _ = p.build(RC7, HTC, self.work / 'second')
        self.assertEqual(self.archive.read_bytes(), second.read_bytes())

    def test_all_source_decisions_and_old_ids_preserved(self):
        decisions = json.loads(self.files['review/source-document-decisions.json'])
        self.assertEqual(len(decisions), 370)
        self.assertEqual(sum(d['disposition'] == 'included' for d in decisions), 369)
        for name in ('ingredients', 'recipes', 'kitchenware'):
            old = json.loads(self.files['upstream/rc7/clean/' + name + '.json'])
            self.assertLessEqual({r['id'] for r in old}, {r['id'] for r in self.data[name]})
        self.assertEqual(len(self.data['recipes']), 389)
        self.assertGreater(self.report['after']['linked_ingredient_lines'], 2500)

    def test_added_terms_have_pinned_recipe_evidence(self):
        added = set(self.report['added_ingredient_ids'])
        recipes = {r['id'] for r in self.data['recipes']}
        for row in self.data['ingredients']:
            if row['id'] in added:
                self.assertTrue(row['name_evidence'])
                for evidence in row['name_evidence']:
                    self.assertIn(evidence['recipe_id'], recipes)
                    self.assertIn('/2b19c9e9ee926fd925a68207a57582a338813f9c/', evidence['source_url'])

    def test_name_and_category_corrections_preserve_identity(self):
        row = next(r for r in self.data['ingredients'] if r['id'] == 'WD-Q11117594')
        self.assertEqual(row['name'], '椰丝')
        self.assertIn('椰絲', row['aliases'])
        self.assertEqual(row['category'], '水果及坚果')
        self.assertEqual(row['category_correction']['before'], '油脂')

    def test_narrow_food_identities_not_falsely_equated(self):
        index = n.make_index(self.data['ingredients'])
        for broad, narrow in [('食用油', '精炼菜籽油'), ('牛奶', '巴氏杀菌纯牛奶'), ('猪肉', '猪瘦肉'), ('葱', '小葱'), ('鸡胸肉', '去皮去骨鸡胸肉')]:
            self.assertFalse(index[n.key(broad)] & index[n.key(narrow)], (broad, narrow))
        rules = json.loads(self.files['rules.json'])
        self.assertEqual(n.resolve('姜末', index, rules['prepared_terms'])['preparation'], '切末')
        self.assertEqual(n.resolve('木耳(干)', index, rules['prepared_terms'])['lookup_name'], '木耳(干)')

    def test_restored_recipes_and_tool_separation(self):
        fish = self.recipe('鱼香肉丝')
        self.assertTrue(any(i['source_section'] == 'required' for i in fish['ingredients']))
        self.assertIsNone(fish['servings'])
        cake = self.recipe('戚风蛋糕')
        self.assertEqual(len(cake['variants']), 3)
        self.assertFalse(any(i.get('group') == '工具' for i in cake['ingredients']))
        self.assertIn('variant_selection_required', cake['readiness']['blockers'])
        self.assertFalse(cake['automatic_inventory_write_allowed'])

    def test_missing_required_materials_are_exposed(self):
        vegetable = self.recipe('水油焖蔬菜')
        self.assertTrue(any(i['name'] == '食用油' and i['measurement']['kind'] == 'missing' for i in vegetable['ingredients']))
        self.assertTrue(vegetable['readiness']['blockers'])
        fish = self.recipe('鱼香肉丝')
        self.assertIn('step_ingredients_require_review', fish['readiness']['blockers'])
        self.assertTrue(any(e['name'] == '水' for e in fish['step_ingredient_evidence']))

    def test_nutrition_negative_missing_zero_are_distinct(self):
        obs = self.data['nutrition-observations']
        negative = [o for o in obs if o['status'] == 'negative_source_value']
        self.assertEqual(len(negative), 10)
        self.assertTrue(all(o['amount'] is None and float(o['raw_amount']) < 0 for o in negative))
        self.assertEqual(sum(o['status'] == 'missing' for o in obs), 27)
        self.assertTrue(any(o['status'] == 'reported' and o['amount'] == 0 for o in obs))
        self.assertTrue(all(f['chinese_ingredient_id'] is None for f in self.data['nutrition-foods']))

    def test_demo_fixture_is_unchanged_and_secret_free(self):
        self.assertEqual(self.data['initial-data'], json.loads(self.files['upstream/rc7/clean/initial-data.json']))
        self.assertEqual(len(self.data['initial-data']['posts']), 100)
        self.assertEqual(len(self.data['initial-data']['accounts']), 4)

    def test_semantic_validation_rejects_orphan_and_promotion(self):
        data = deepcopy(self.data)
        data['recipes'][0]['ingredients'][0]['ingredient_id'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'Orphan ingredient'):
            p.validate(data)
        data = deepcopy(self.data)
        data['ingredients'][0]['nutrition'] = {'calories': 0}
        with self.assertRaisesRegex(ValueError, 'Unverified ingredient nutrition'):
            p.validate(data)
        data = deepcopy(self.data)
        data['recipes'][0]['automatic_inventory_write_allowed'] = True
        with self.assertRaisesRegex(ValueError, 'Unreviewed execution'):
            p.validate(data)

    def test_package_tampering_is_rejected(self):
        target = self.work / 'tampered.zip'
        with zipfile.ZipFile(target, 'w') as z:
            for name, raw in self.files.items():
                z.writestr(name, raw + b' ' if name == 'clean/ingredients.json' else raw)
        with self.assertRaisesRegex(ValueError, 'Member checksum mismatch'):
            p.verify(target)

    def test_source_tampering_is_rejected_without_output(self):
        source = self.work / 'bad-source.zip'
        source.write_bytes(RC7.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'Archive SHA-256'):
            p.build(source, HTC, self.work / 'bad-output')
        self.assertFalse((self.work / 'bad-output').exists())

    def test_existing_output_is_not_overwritten(self):
        original_hash = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            p.build(RC7, HTC, self.archive.parent)
        self.assertEqual(hashlib.sha256(self.archive.read_bytes()).hexdigest(), original_hash)

    def test_packaged_builder_is_self_contained(self):
        extracted = self.work / 'extracted'
        p.verify(self.archive)
        with zipfile.ZipFile(self.archive) as z:
            z.extractall(extracted)
        out = self.work / 'packaged-rebuild'
        result = subprocess.run([sys.executable, str(extracted / 'build/reclean/package.py'), '--rc7', str(RC7.resolve()),
                                 '--howtocook', str(HTC.resolve()), '--output', str(out)],
                                capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
        self.assertEqual(result.returncode, 0, result.stderr)
        rebuilt = out / self.archive.name
        self.assertEqual(self.archive.read_bytes(), rebuilt.read_bytes())


if __name__ == '__main__':
    unittest.main()
