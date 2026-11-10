import copy
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

from source_coverage import ARCHIVE, EVIDENCE, TFDA_EVIDENCE, audit, read_package, review_inventory, with_supplement, ingredient_corrections


from review_worklist import classify, markdown


class SourceCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = read_package(ARCHIVE)
        cls.evidence = json.loads(EVIDENCE.read_text(encoding='utf8'))
        cls.tfda_evidence = json.loads(TFDA_EVIDENCE.read_text(encoding='utf8'))

    def test_complete_worklist_preserves_every_gap_and_pending_line(self):
        expanded = with_supplement(self.data, ARCHIVE.with_name('concept-enrichment-2026-10-03.1.zip'))
        inventory = review_inventory(expanded, self.evidence, self.tfda_evidence)
        original = copy.deepcopy(inventory)
        report = classify(inventory)
        self.assertEqual(len(report['records']), 3874)
        self.assertEqual(report['line_counts'], {'identity': 31, 'measurement': 67})
        self.assertEqual(report['gap_counts'], inventory['gap_counts'])
        expected = {(r['kind'], r['id'], g) for r in inventory['records'] for g in r['missing_or_unverified']}
        actual = {(r['kind'], r['id'], t['gap']) for r in report['records'] for t in r['tasks']}
        self.assertEqual(actual, expected)
        self.assertFalse(report['semantic_approval'])
        self.assertTrue(all(t['human_review_required'] and t['status'] == 'pending_review' for r in report['records'] for t in r['tasks']))
        self.assertTrue(all(not r['automatic_execution_allowed'] for r in report['records'] + report['line_tasks']))
        for line in report['line_tasks']:
            self.assertIn(line['line_id'], markdown(report))
        self.assertEqual(inventory, original)
        self.assertEqual(report, classify(inventory))
        self.assertEqual(markdown(report), (ARCHIVE.parents[1].parent / 'docs/w44-data-review-worklist.md').read_text())
        bad = copy.deepcopy(inventory)
        bad['records'][0]['missing_or_unverified'].append('future_unknown_gap')
        with self.assertRaisesRegex(ValueError, 'Unclassified gap'):
            classify(bad)
        bad = copy.deepcopy(inventory)
        bad['gap_counts']['servings'] += 1
        with self.assertRaisesRegex(ValueError, 'summary'):
            classify(bad)

    def test_shipped_evidence_and_report_are_reproducible(self):
        self.assertEqual(hashlib.sha256(EVIDENCE.read_bytes()).hexdigest(),
                         '1c00265e1191de69017154d6d14ede20301100a7a852f7949fdc9a794424250a')
        self.assertEqual(hashlib.sha256(TFDA_EVIDENCE.read_bytes()).hexdigest(),
                         'a1b005fb463138f7d4c861bb77fc3a853804e8b122525b218fefde641992d36e')
        report = audit(self.data, self.evidence, self.tfda_evidence)
        self.assertEqual(report, json.loads(Path(__file__).with_name('source-coverage.json').read_text(encoding='utf8')))
        self.assertEqual(report['ingredient_concepts'], 1079)
        self.assertEqual(report['recipe_concepts_with_methods'], 385)
        self.assertEqual(report['profiles_with_checked_source_observations'], 31)
        self.assertEqual(len(report['profiles_missing_source_observations']), 0)
        self.assertEqual(report['recipes_with_four_core_nutrients_per_serving'], 8)
        self.assertEqual(report['nutrition_gap_priority'][0]['ingredient'], '生抽酱油')
        self.assertEqual(report['nutrition_gap_priority'][0]['affected_recipe_count'], 5)

    def test_missing_evidence_is_reported_not_inferred_from_a_link(self):
        report = audit(self.data)
        self.assertEqual(report['profiles_with_checked_source_observations'], 26)
        self.assertIn('USDA-FDC-2646170', [p['source_food_id'] for p in report['profiles_missing_source_observations']])
        self.assertEqual(len(audit(self.data, self.evidence)['profiles_missing_source_observations']), 4)

    def test_restored_tfda_observation_must_match_its_exact_source_position(self):
        evidence = copy.deepcopy(self.tfda_evidence)
        evidence['records'][0]['source_position'] += 1
        with self.assertRaisesRegex(ValueError, 'Source observation position mismatch'):
            audit(self.data, self.evidence, evidence)

    def test_changed_observation_or_unit_cannot_pass_even_with_consistent_estimates(self):
        for field, value in [('amount', '999'), ('fdc_id', 'wrong')]:
            data = copy.deepcopy(self.data)
            record = data['source-selected-records'][0]
            profile = next(p for p in data['nutrition-profiles'] if p['source_food_id'] == 'USDA-FDC-' + record['food']['fdc_id'])
            row = next(n for n in record['food_nutrient'] if n['id'] == profile['nutrients_per_100g']['protein']['observation_id'])
            row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                audit(data, self.evidence)
        evidence = copy.deepcopy(self.evidence)
        next(n for n in evidence['food']['foodNutrients'] if n['nutrient']['id'] == 1003)['nutrient']['unitName'] = 'mg'
        with self.assertRaises(ValueError):
            audit(self.data, evidence)

    def test_missing_values_do_not_pass_as_zero_or_recipe_totals(self):
        data = copy.deepcopy(self.data)
        vinegar = next(p for p in data['nutrition-profiles'] if p['source_food_id'] == 'TFDA:P0600101')
        vinegar['nutrients_per_100g']['protein']['amount'] = 0
        with self.assertRaises(ValueError):
            audit(data, self.evidence)
        data = copy.deepcopy(self.data)
        complete = next(r for r in data['recipe-nutrition'] if r['per_serving'])
        complete['per_serving']['calories'] += 1
        with self.assertRaises(ValueError):
            audit(data, self.evidence)

    def test_relabeling_protein_as_fat_is_not_valid_source_evidence(self):
        for source_kind in ('SR_Legacy', 'Foundation_Foods'):
            data = copy.deepcopy(self.data)
            profile = next(p for p in data['nutrition-profiles'] if p['source_kind'] == source_kind)
            nutrients = profile['nutrients_per_100g']
            nutrients['protein'], nutrients['fat'] = nutrients['fat'], nutrients['protein']
            with self.subTest(source_kind=source_kind), self.assertRaisesRegex(ValueError, 'Nutrient definition mismatch'):
                audit(data, self.evidence)

    def test_review_inventory_covers_current_records_without_promoting_complete_rows(self):
        inventory = review_inventory(self.data, self.evidence, self.tfda_evidence)
        self.assertEqual(inventory, review_inventory(self.data, self.evidence, self.tfda_evidence))
        self.assertEqual(inventory['base_archive_sha256'], self.data['archive_sha256'])
        self.assertEqual(inventory['counts'], {'catalogue_concept': 1340, 'ingredient_form': 984,
                                              'recipe_concept': 1115, 'recipe_method': 389, 'nutrition_profile': 31})
        self.assertFalse(inventory['semantic_approval'])
        for row in inventory['records']:
            self.assertEqual(row['disposition'], 'pending_evidence')
            self.assertFalse(row['automatic_execution_allowed'])
            self.assertTrue(row['missing_or_unverified'])
            encoded = json.dumps(row['record'], ensure_ascii=False, sort_keys=True,
                                 separators=(',', ':'), allow_nan=False).encode()
            self.assertEqual(row['record_sha256'], hashlib.sha256(encoded).hexdigest())
        complete = next(r for r in inventory['records'] if r['kind'] == 'recipe_method'
                        and not r['record']['missing_fields'])
        self.assertIn('kitchen_execution_review', complete['missing_or_unverified'])
        self.assertEqual(inventory['gap_counts']['recipe_method_missing'],
                         sum(not r['method_ids'] for r in self.data['catalogue']['recipe-concepts']))

    def test_review_inventory_preserves_missing_evidence_and_rejects_contradictions(self):
        inventory = review_inventory(self.data)
        self.assertEqual(inventory['gap_counts']['source_observations_missing'], 5)
        data = copy.deepcopy(self.data)
        data['catalogue']['methods'].append(data['catalogue']['methods'][0])
        with self.assertRaisesRegex(ValueError, 'Duplicate review identity'):
            review_inventory(data)
        evidence = copy.deepcopy(self.tfda_evidence)
        evidence['records'][0]['source_position'] += 1
        with self.assertRaisesRegex(ValueError, 'Source observation position mismatch'):
            review_inventory(self.data, self.evidence, evidence)
        supplement = ARCHIVE.with_name('concept-enrichment-2026-10-03.1.zip')
        enriched = with_supplement(self.data, supplement)
        self.assertEqual(review_inventory(enriched, self.evidence, self.tfda_evidence)['supplement_sha256'],
                         hashlib.sha256(supplement.read_bytes()).hexdigest())

    def test_review_cli_creates_reproducible_artifact_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'review.json'
            summary = Path(directory) / 'summary.json'
            command = [sys.executable, str(Path(__file__).with_name('source_coverage.py')),
                       '--review-output', str(output), '--output', str(summary)]
            subprocess.run(command, check=True, capture_output=True)
            before = output.read_bytes()
            expected = review_inventory(self.data, self.evidence, self.tfda_evidence)
            self.assertEqual(json.loads(before), expected)
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            collision = Path(directory) / 'collision.json'
            result = subprocess.run(command[:2] + ['--review-output', str(collision), '--output', str(collision)],
                                    capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(collision.exists())

    def test_existing_documentary_evidence_is_attached_without_approval(self):
        inventory = review_inventory(self.data, self.evidence, self.tfda_evidence)
        self.assertEqual(inventory['supporting_document_counts'], {
            'recipe-weighing-contracts': 20, 'equipment-role-updates': 18,
            'duplicate-review': 11, 'matching-decisions': 5})
        methods = [r for r in inventory['records'] if r['kind'] == 'recipe_method']
        self.assertEqual(sum(any(e['document'].endswith('recipe-weighing-contracts.json')
                                 for e in r['supporting_evidence']) for r in methods), 20)
        soy = next(r for r in inventory['records'] if r['id'] == 'FORM:DDD-I-soy')
        decision = soy['supporting_evidence'][0]['record']
        self.assertEqual(decision['source_food_id'], 'TFDA:P0700401')
        self.assertEqual(decision['status'], 'not_bound')
        for row in inventory['records']:
            self.assertFalse(row['automatic_execution_allowed'])
            for evidence in row['supporting_evidence']:
                self.assertFalse(evidence['semantic_approval'])
                document = evidence['document'].removeprefix('data/nutrition/').removesuffix('.json')
                self.assertEqual(evidence['record'], self.data[document][evidence['record_index']])
        expanded = with_supplement(self.data, ARCHIVE.with_name('concept-enrichment-2026-10-03.1.zip'))
        self.assertEqual(review_inventory(expanded, self.evidence, self.tfda_evidence)['supporting_document_counts'],
                         inventory['supporting_document_counts'])

    def test_stale_or_cross_record_supporting_evidence_is_rejected(self):
        cases = [('recipe-weighing-contracts', 'original_recipe_sha256', '0' * 64),
                 ('recipe-weighing-contracts', 'method_id', 'missing'),
                 ('equipment-role-updates', 'concept_id', 'missing'),
                 ('equipment-role-updates', 'evidence', [{'step': 2, 'text': 'unrelated step'}]),
                 ('matching-decisions', 'status', 'approved'),
                 ('matching-decisions', 'source_name', 'wrong sample'),
                 ('duplicate-review', 'concept_ids', ['missing', 'missing2'])]
        for document, key, value in cases:
            data = copy.deepcopy(self.data)
            data[document][0][key] = value
            with self.subTest(document=document, key=key), self.assertRaises(ValueError):
                review_inventory(data, self.evidence, self.tfda_evidence)
        data = copy.deepcopy(self.data)
        data['matching-decisions'].append(data['matching-decisions'][0])
        with self.assertRaisesRegex(ValueError, 'Duplicate supporting evidence'):
            review_inventory(data, self.evidence, self.tfda_evidence)

    def test_source_serving_corrections_are_scoped_and_leave_frozen_records_unchanged(self):
        original = copy.deepcopy(self.data)
        inventory = review_inventory(self.data, self.evidence, self.tfda_evidence)
        corrected = {r['name']: r for r in inventory['records'] if 'servings' in r['confirmed_source_fields']}
        expected = {'柱候牛腩': 2, '腊八粥': 1, '排骨山药玉米汤': 2, '菠菜炒鸡蛋': 1,
                    '带把肘子': 3, '银耳莲子粥': 1, '牛油果拉西': 1, '西葫芦炒鸡蛋': 2,
                    '肉蛋盖饭': 1, '烤茄子': 2, '红柚蛋糕': 1, '凉拌木耳': 1, '蒸箱鸡蛋羹': 1,
                    '鸡蛋羹': 1, '黔式腊肠娃娃菜': 1, '甜辣烤全翅': 1, '商芝肉': 2}
        self.assertEqual(set(corrected), set(expected))
        for name, count in expected.items():
            row = corrected[name]
            self.assertEqual(row['confirmed_source_fields']['servings']['value'], count)
            self.assertIsNone(row['record']['servings'])
            self.assertNotIn('servings', row['missing_or_unverified'])
            self.assertFalse(row['automatic_execution_allowed'])
            self.assertFalse(row['confirmed_source_fields']['servings']['runtime_applied'])
        self.assertEqual(inventory['gap_counts']['servings'], 262)
        self.assertEqual(inventory['confirmed_source_field_counts']['servings'], 17)
        self.assertEqual(self.data, original)
        for row in inventory['records']:
            if row['kind'] == 'recipe_method' and row['record']['servings'] is None and row['name'] not in corrected:
                self.assertNotIn('servings', row['confirmed_source_fields'])
                self.assertIn('servings', row['missing_or_unverified'])

    def test_changed_context_does_not_confirm_stale_diner_evidence(self):
        data = copy.deepcopy(self.data)
        method = next(m for m in data['catalogue']['methods'] if m['title'] == '柱候牛腩')
        method['yield']['evidence']['context'] = '以下为三人食用的量'
        inventory = review_inventory(data, self.evidence, self.tfda_evidence)
        row = next(r for r in inventory['records'] if r['id'] == method['id'])
        self.assertEqual(row['confirmed_source_fields'], {})
        self.assertIn('servings', row['missing_or_unverified'])

    def test_ingredient_evidence_preserves_units_ranges_and_shared_amounts(self):
        original = copy.deepcopy(self.data)
        inventory = review_inventory(self.data, self.evidence, self.tfda_evidence)
        self.assertEqual(inventory['ingredient_line_correction_counts'], {'measurement': 19, 'mapping': 6, 'name': 2})
        lines = [line for row in inventory['records'] for line in row['confirmed_source_fields'].get('ingredient_lines', [])]
        measures = {line['original_source_text']: line['fields']['measurement']['value']
                    for line in lines if 'measurement' in line['fields']}
        self.assertEqual({text: (m['value'], m['minimum'], m['maximum'], m['unit']) for text, m in measures.items()}, {
            '大葱 2 根  1 根切段,1 根备用': (2, None, None, '根'),
            '肥肉末 20g #不喜可不加': (20, None, None, 'g'),
            '冰块 160 克以上': (None, 160, None, 'g'), '生姜 1 拇指块': (1, None, None, '拇指块'),
            '手抓饼 1 份-2 份（看鸡蛋大小）': (None, 1, 2, '份'),
            '芹菜 两根中等大小的芹菜': (2, None, None, '根'),
            '葱 = 一根大葱': (1, None, None, '根'), '蒜 = 7 瓣大蒜': (7, None, None, '瓣'),
            '大葱 10cm': (10, None, None, 'cm'), '生姜 3 厘米长，拍散备用': (3, None, None, 'cm'),
            '1 : 1 蔗糖糖浆 10 克（可选）': (10, None, None, 'g'),
            '1 : 1 蔗糖糖浆 30~40 克': (None, 30, 40, 'g'),
            '香菜 5 条 切段': (5, None, None, '条'), '蒜 5 颗 剁成蒜蓉': (5, None, None, '颗'),
            '洋葱 25g-40g 切成碎': (None, 25, 40, 'g'), '蒜苗 2 根 切段备用': (2, None, None, '根'),
            '鸡蛋 8 个 普通鸡蛋即可': (8, None, None, '个'), '牛奶 200 毫升 普通袋装牛奶即可': (200, None, None, 'ml'),
            '白砂糖 80 克 普通砂糖即可 细砂糖更优 易于融化': (80, None, None, 'g')})
        self.assertEqual(measures['生姜 3 厘米长，拍散备用']['source_notes'], ['长,拍散备用'])
        names = [line for line in lines if 'name' in line['fields']]
        self.assertEqual(len(names), 2)
        self.assertTrue(all(not line['fields']['name']['mapping_confirmed'] and 'mapping' not in line['fields'] for line in names))
        mappings = [line for line in lines if 'mapping' in line['fields']]
        self.assertEqual({line['fields']['mapping']['name'] for line in mappings}, {'猪肉', '洋葱', '冰块', '花生油', '茄子'})
        ice = [line for line in mappings if line['fields']['mapping']['name'] == '冰块']
        self.assertEqual(len(ice), 2)
        self.assertEqual({line['original_source_text']: line['optional'] for line in ice}, {'冰几块（可选）': True, '大冰块差不多就行': False})
        self.assertTrue(all('measurement' not in line['fields'] for line in ice))
        eggplant = next(line for line in mappings if line['fields']['mapping']['name'] == '茄子')
        self.assertIn('不得使用浙茄和圆茄', eggplant['fields']['mapping']['qualifier'])
        self.assertFalse(eggplant['fields']['mapping']['nutrition_binding_confirmed'])
        self.assertNotIn('measurement', eggplant['fields'])
        fat = next(line for line in lines if line['original_source_text'] == '肥肉末 20g #不喜可不加')
        self.assertTrue(fat['optional'])
        oil = next(line for line in mappings if line['fields']['mapping']['name'] == '花生油')
        self.assertIn('100-150ml', oil['shared_amount_evidence'])
        self.assertNotIn('measurement', oil['fields'])
        self.assertIn('替代选项', oil['fields']['mapping']['qualifier'])
        self.assertEqual(measures['冰块 160 克以上']['kind'], 'lower_bound')
        pork = next(line for line in mappings if line['fields']['mapping']['name'] == '猪肉')
        self.assertIn('430', pork['shared_amount_evidence'])
        self.assertNotIn('measurement', pork['fields'])
        self.assertEqual(self.data, original)
        self.assertTrue(all(not line['automatic_execution_allowed'] and not line['runtime_applied'] for line in lines))

    def test_ratio_correction_requires_matching_old_evidence(self):
        original = next(m for m in self.data['catalogue']['methods'] if m['title'] == '耙耙柑茶')
        for field, value in [('amount_text', '1 蔗糖糖浆 1 克(可选)'),
                             ('original_source_text', '2 : 1 蔗糖糖浆 10 克（可选）'),
                             ('shared_amount_evidence', '总共 10 克'), ('ingredient_id', 'already-bound')]:
            method = copy.deepcopy(original)
            next(i for i in method['ingredients'] if i['name'] == '1')[field] = value
            self.assertEqual(ingredient_corrections(method, self.data['catalogue'], {}), [])

    def test_ingredient_corrections_refuse_ambiguous_or_stale_identity_and_quantity(self):
        method = copy.deepcopy(next(m for m in self.data['catalogue']['methods'] if m['title'] == '西红柿土豆炖牛肉'))
        rules = {'比拳头大一点的洋葱': ['洋葱', '保留原文尺寸']}
        catalogue = copy.deepcopy(self.data['catalogue'])
        onion = next(f for f in catalogue['ingredient-forms'] if f['display_name'] == '洋葱')
        catalogue['ingredient-forms'].append({**onion, 'id': 'another-onion-form'})
        self.assertEqual(ingredient_corrections(method, catalogue, rules), [])
        line = next(i for i in method['ingredients'] if i['name'] == '比拳头大一点的洋葱')
        line['original_source_text'] = '未确认混合蔬菜一个'
        self.assertEqual(ingredient_corrections(method, self.data['catalogue'], rules), [])
        method = copy.deepcopy(next(m for m in self.data['catalogue']['methods'] if m['title'] == '烤蛋挞'))
        for line in method['ingredients']:
            line['amount_text'] = '999g 切段'
        self.assertEqual(ingredient_corrections(method, self.data['catalogue'], {}), [])
        method = copy.deepcopy(next(m for m in self.data['catalogue']['methods'] if m['title'] == '奶酪培根通心粉'))
        next(i for i in method['ingredients'] if i['amount_text'] == '25g-40g 切成碎')['amount_text'] = '5g-40g 切成碎'
        self.assertEqual(ingredient_corrections(method, self.data['catalogue'], {}), [])


if __name__ == '__main__':
    unittest.main()
