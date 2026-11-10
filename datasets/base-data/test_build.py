"""Integrity and isolation tests against the pinned local source archives."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import build
import kitchenware
import starter
import ingredient_catalog
import source_recipes
import clean_data


class PackageTests(unittest.TestCase):
    def clean_tables(self):
        with zipfile.ZipFile(self.package) as archive:
            return [json.loads(archive.read('clean/' + name + '.json')) for name in
                    ('ingredients', 'recipes', 'kitchenware', 'initial-data')]

    def test_clean_data_references_and_all_environment_examples(self):
        data = self.clean_tables()
        clean_data.validate(*data)
        initial = data[3]
        self.assertTrue(initial['policy']['include_examples_by_default'])
        self.assertEqual(len(initial['accounts']), 4)
        self.assertEqual(len(initial['posts']), 100)
        self.assertEqual(len({p['content'] for p in initial['posts']}), 100)
        self.assertTrue(all('【演示内容】' not in p['content'] for p in initial['posts']))
        self.assertEqual(len(initial['comments']), 6)
        self.assertEqual(len(initial['favorites']), 6)
        self.assertTrue(all(a['environment'] == 'all' for a in initial['accounts']))
        self.assertTrue(all(p['environment'] == 'all' and p['is_demo'] for p in initial['posts']))
        initial['posts'][0]['author_id'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'Unknown demo post reference'):
            clean_data.validate(*data)

    def test_clean_data_does_not_package_passwords(self):
        data = self.clean_tables()
        data[3]['accounts'][0]['password'] = 'example'
        with self.assertRaisesRegex(ValueError, 'Packaged account secret'):
            clean_data.validate(*data)

    def test_clean_amounts_do_not_guess(self):
        self.assertEqual(clean_data.parse_line('大米 1 kg')[2:], (1000, 'g'))
        self.assertEqual(clean_data.parse_line('鸡蛋 2 个')[2:], (None, None))
        self.assertEqual(clean_data.parse_line('盐 = 适量')[2:], (None, None))
        self.assertEqual(clean_data.parse_line('糖 6-15 g')[2:], (None, None))

    def test_source_steps_keep_continuations(self):
        text = '1. 加水\n   - 小火\n\n继续煮。\n2. 关火'
        parsed = source_recipes.steps(text)
        self.assertEqual(len(parsed), 2)
        self.assertIn('小火', parsed[0]['source_text'])
        self.assertIn('继续煮', parsed[0]['source_text'])

    def test_source_recipes_no_invented_quantities(self):
        with zipfile.ZipFile(self.package) as archive:
            recipes = [json.loads(line) for line in archive.read('review/howtocook_recipes.jsonl').splitlines()]
            ids = {json.loads(line)['ingredient_id'] for line in archive.read('reference/ingredient_catalog.jsonl').splitlines()}
        self.assertGreater(len(recipes), 300)
        source_recipes.validate(recipes, ids)
        recipes[0]['ingredients'][0]['quantity'] = 100
        with self.assertRaisesRegex(ValueError, 'quantity or mapping promoted'):
            source_recipes.validate(recipes, ids)

    def test_source_recipe_decision_coverage(self):
        with zipfile.ZipFile(self.package) as archive:
            decisions = [json.loads(line) for line in archive.read('review/howtocook_import_decisions.jsonl').splitlines()]
            recipes = [json.loads(line) for line in archive.read('review/howtocook_recipes.jsonl').splitlines()]
            self.assertIn('provenance/howtocook/LICENSE', archive.namelist())
        self.assertEqual(len(decisions), 370)
        self.assertEqual({r['source_path'] for r in recipes},
                         {r['source_path'] for r in decisions if r['reason'] == 'included_source_recipe'})
        self.assertFalse(any(r['category'] in ('template', 'drink', 'condiment') for r in recipes))

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.source_dir = build.ROOT / '.cache/base-data-sources'
        cls.package = build.build(cls.source_dir, cls.root / 'first')

    def tables(self):
        with zipfile.ZipFile(self.package) as archive:
            return {name: [json.loads(line) for line in archive.read(f'{tier}/{name}.jsonl').splitlines()]
                    for name, (tier, _) in build.TABLES.items()}

    def test_rebuild_is_byte_identical(self):
        second = build.build(self.source_dir, self.root / 'second')
        self.assertEqual(self.package.read_bytes(), second.read_bytes())
        build.verify(second)

    def test_tamper_is_rejected(self):
        corrupt = self.root / 'tampered.zip'
        with zipfile.ZipFile(self.package) as source, zipfile.ZipFile(corrupt, 'w') as target:
            for name in source.namelist():
                data = source.read(name)
                if name == 'reference/entities.jsonl':
                    data += b'{}\n'
                target.writestr(name, data)
        with self.assertRaisesRegex(ValueError, 'Package SHA mismatch'):
            build.verify(corrupt)

    def test_source_tamper_is_rejected(self):
        fake = self.root / 'fake-sources'
        fake.mkdir()
        (fake / 'china-food-cleanroom-v1-cc0.zip').write_bytes(b'not the pinned source')
        with self.assertRaisesRegex(ValueError, 'Source SHA mismatch'):
            build.build(fake, self.root / 'rejected')

    def test_orphan_and_promotion_are_rejected(self):
        original = self.tables()
        broken = copy.deepcopy(original)
        broken['usda_nutrients_long'][0]['fdc_id'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'Orphan nutrient'):
            build.validate_tables(broken)
        broken = copy.deepcopy(original)
        broken['wikidata_usda_mapping_candidates'][0]['review_status'] = 'approved'
        with self.assertRaisesRegex(ValueError, 'Unapproved mapping promoted'):
            build.validate_tables(broken)

    def test_review_and_kitchenware_do_not_enter_runtime(self):
        with zipfile.ZipFile(self.package) as archive:
            names = archive.namelist()
            self.assertFalse(any(name.startswith(('runtime/', 'kitchenware/')) for name in names))
            report = json.loads(archive.read('report.json'))
            self.assertFalse(report['runtime_import_allowed'])
            self.assertEqual(report['approved_nutrition_mappings'], 0)
            self.assertEqual(report['release_ready_recipes'], 0)
            self.assertEqual(report['negative_nutrient_observations'], 10)
        rows = self.tables()['wikidata_usda_mapping_candidates']
        # A real false positive in upstream data must remain an unapproved candidate.
        grape = next(r for r in rows if r['canonical_name_zh'] == '葡萄' and 'Tomatoes' in r['usda_description_en'])
        self.assertEqual(grape['review_status'], 'needs_human_review')

    def kitchen_tables(self):
        with zipfile.ZipFile(self.package) as archive:
            return ([json.loads(line) for line in archive.read('reference/kitchenware_concepts.jsonl').splitlines()],
                    [json.loads(line) for line in archive.read('review/kitchenware_aliases.jsonl').splitlines()])

    def test_kitchenware_projection_excludes_source_prose(self):
        concepts, aliases = self.kitchen_tables()
        kitchenware.validate(concepts, aliases)
        self.assertEqual(len(concepts), 241)
        self.assertEqual(len(aliases), 271)
        self.assertTrue(all(set(r) == kitchenware.CONCEPT_FIELDS for r in concepts))
        concepts[0]['description'] = 'Unlicensed source prose'
        with self.assertRaisesRegex(ValueError, 'Unexpected kitchenware concept fields'):
            kitchenware.validate(concepts, aliases)

    def test_kitchenware_orphan_and_promotion_rejected(self):
        concepts, aliases = self.kitchen_tables()
        aliases[0]['concept_id'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'Orphan kitchenware alias'):
            kitchenware.validate(concepts, aliases)
        concepts, aliases = self.kitchen_tables()
        aliases[0]['review_status'] = 'approved'
        with self.assertRaisesRegex(ValueError, 'Unreviewed kitchenware alias promoted'):
            kitchenware.validate(concepts, aliases)

    def starter_tables(self):
        with zipfile.ZipFile(self.package) as archive:
            return ([json.loads(line) for line in archive.read('review/starter_ingredients.jsonl').splitlines()],
                    [json.loads(line) for line in archive.read('review/starter_recipes.jsonl').splitlines()],
                    {json.loads(line)['concept_id'] for line in archive.read('reference/kitchenware_concepts.jsonl').splitlines()})

    def test_starter_references_and_units(self):
        ingredients, recipes, kitchen_ids = self.starter_tables()
        starter.validate(ingredients, recipes, kitchen_ids)
        recipes[0]['ingredients'][0]['ingredient_id'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'orphan recipe ingredient'):
            starter.validate(ingredients, recipes, kitchen_ids)
        ingredients, recipes, kitchen_ids = self.starter_tables()
        recipes[0]['ingredients'][0]['unit'] = '个'
        with self.assertRaisesRegex(ValueError, 'Invalid ingredient unit'):
            starter.validate(ingredients, recipes, kitchen_ids)

    def test_starter_allergens_and_nutrition(self):
        ingredients, recipes, kitchen_ids = self.starter_tables()
        recipes[0]['declared_allergens'] = []
        with self.assertRaisesRegex(ValueError, 'Missing known recipe allergen'):
            starter.validate(ingredients, recipes, kitchen_ids)

    def expanded_tables(self):
        with zipfile.ZipFile(self.package) as archive:
            return tuple([json.loads(line) for line in archive.read(path).splitlines()] for path in (
                'reference/ingredient_catalog.jsonl', 'review/ingredient_pending.jsonl',
                'review/ingredient_scope_decisions.jsonl'))

    def test_expanded_catalogue_preserves_source_and_recipe_ids(self):
        catalogue, pending, decisions = self.expanded_tables()
        starters, recipes, _ = self.starter_tables()
        ingredient_catalog.validate(catalogue, pending, decisions, self.tables(), starters)
        ids = {r['ingredient_id'] for r in catalogue}
        self.assertGreater(len(ids), 400)
        self.assertTrue({'WD-Q25416839', 'WD-Q372893'} <= ids)  # Same Chinese name, distinct QIDs.
        self.assertTrue({x['ingredient_id'] for r in recipes for x in r['ingredients']} <= ids)
        self.assertEqual(len(decisions), 2347)
        self.assertTrue(all(r['source_type'] in ('food', 'ingredient', 'project_starter') for r in catalogue))
        self.assertFalse(set(ingredient_catalog.EXCLUDED) & ids)

    def test_expansion_omissions_and_false_nutrition_rejected(self):
        catalogue, pending, decisions = self.expanded_tables()
        starters, _, _ = self.starter_tables()
        with self.assertRaisesRegex(ValueError, 'Missing ingredient scope decisions'):
            ingredient_catalog.validate(catalogue, pending, decisions[:-1], self.tables(), starters)
        catalogue[0]['nutrition'] = {'calories': 0}
        with self.assertRaisesRegex(ValueError, 'Unverified expanded nutrition'):
            ingredient_catalog.validate(catalogue, pending, decisions, self.tables(), starters)
        ingredients, recipes, kitchen_ids = self.starter_tables()
        ingredients[0]['nutrition_per_100g'] = {'calories': 0}
        with self.assertRaisesRegex(ValueError, 'Unverified ingredient nutrition'):
            starter.validate(ingredients, recipes, kitchen_ids)


if __name__ == '__main__':
    unittest.main()
