import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadRelease, validateRelease } from '../scripts/import-nutrition-enrichment.mjs';

const folder = fileURLToPath(new URL('../../artifacts/base-data/concept-enrichment-2026-09-15.2/', import.meta.url));
const checksum = createHash('sha256').update(readFileSync(`${folder}/manifest.json`)).digest('hex');
const release = () => loadRelease(folder, checksum);

test('release validates all 20 recipes and 31 sample scopes', () => {
  const data = release();
  assert.equal(data.recipes.filter(r => r.per_serving).length, 8);
  const vinegar = data.profiles.find(p => p.source_food_id === 'TFDA:P0600101');
  assert.equal(vinegar.nutrients_per_100g.protein.amount, null);
  assert.equal(vinegar.nutrients_per_100g.fat.amount, null);
  const noodles = data.recipes.find(r => r.method_id === 'METHOD:DDD-R-tomato-noodles');
  // Independent energy arithmetic: 160g dry noodles, 250g tomato, 100g egg, 8g oil, 2g salt, 5g scallion.
  assert.equal(noodles.whole_recipe.calories, 160 * 3.5 + 250 * 0.19 + 135 + 8 * 8.84 + 5 * 0.32);
});
test('missing milk density and vinegar nutrients remain explicit gaps', () => {
  const data = release();
  const milk = data.recipes.find(r => r.method_id === 'METHOD:DDD-R-corn-oat-milk');
  assert.equal(milk.per_serving, null);
  assert.match(milk.gaps[0].reason_text, /毫升/);
  const potato = data.recipes.find(r => r.method_id === 'METHOD:DDD-R-potato-strips');
  assert.ok(potato.whole_recipe.calories > 0);
  assert.equal(potato.whole_recipe.protein, null);
  assert.equal(potato.per_serving, null);
  assert.ok(potato.gaps.some(g => g.reason === 'source_nutrient_missing'));
});
test('rejects tampered manifest, arithmetic, form, units and missing-to-zero conversion', () => {
  assert.throws(() => loadRelease(folder, 'wrong'), /checksum/);
  const mutate = action => {
    const data = release();
    action(data);
    assert.throws(() => validateRelease(data));
  };
  mutate(d => { d.recipes.find(r => r.per_serving).per_serving.calories += 10; });
  mutate(d => { d.recipes[0].selections[0].scope = 'different'; });
  mutate(d => { d.recipes[0].selections.push(d.recipes[0].selections[0]); });
  mutate(d => { d.profiles[0].nutrients_per_100g.protein.unit = 'mg'; });
  mutate(d => { d.recipes.find(r => !r.per_serving).whole_recipe.protein = 0; });
});
