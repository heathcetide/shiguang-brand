import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchFoodUSDA } from '../src/services/foodApiAdapter.js';

test('USDA search preserves missing values, observed zero and source identity', async (context) => {
  context.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    assert.equal(new URL(input).searchParams.get('query'), 'water & salt');
    return Response.json({ foods: [
      { fdcId: 1, description: 'Water', dataType: 'SR Legacy', publishedDate: '2019-04-01', foodNutrients: [
        { nutrientId: 1008, unitName: 'kcal', value: 0 },
        { nutrientId: 1003, unitName: 'g', value: 0 },
        { nutrientId: 1005, unitName: 'G', value: 0.01 },
      ] },
      { fdcId: 2, description: 'Unmeasured sample', foodNutrients: [] },
    ] });
  });
  const results = await searchFoodUSDA('water & salt');
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    name: 'Water', calories_100g: 0, protein_100g: 0, carbs_100g: 0.01, fat_100g: null,
    source: 'open_api', source_provider: 'usda_fdc', fdc_id: 1,
    source_url: 'https://fdc.nal.usda.gov/food-details/1/nutrients',
    source_data_type: 'SR Legacy', source_published_at: '2019-04-01',
    source_serving_size_unit: null,
    data_license: 'CC0-1.0', nutrition_basis: 'per_100g',
  });
  assert.equal(results[1]!.calories_100g, null);
  assert.equal(results[1]!.protein_100g, null);
  assert.equal(results[1]!.source_published_at, null);
});

test('USDA nutrient IDs and units prevent invalid or unrelated observations from becoming nutrition', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ foods: [
    null,
    { description: 'Missing FDC identity' },
    { fdcId: 9, description: 'Invalid observations', dataType: 'SR Legacy', foodNutrients: [
      null,
      { nutrientId: 1008, nutrientName: 'Energy', unitName: 'KJ', value: 400 },
      { nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: '4' },
      { nutrientId: 1004, unitName: 'G', value: -1 },
      { nutrientId: 1005, unitName: 'G', value: Number.NaN },
      { nutrientId: 1005, unitName: 'G', value: Number.POSITIVE_INFINITY },
      { nutrientId: 9999, nutrientName: 'Protein', unitName: 'G', value: 5 },
    ] },
    { fdcId: 10, description: 'Valid neighbor', dataType: 'SR Legacy', foodNutrients: [
      { nutrientId: 1008, unitName: 'KCAL', value: 25 },
    ] },
  ] }) }));
  const results = await searchFoodUSDA('test');
  assert.equal(results.length, 2);
  const invalid = results[0]!;
  assert.deepEqual([invalid.calories_100g, invalid.protein_100g, invalid.carbs_100g, invalid.fat_100g], [null, null, null, null]);
  assert.equal(results[1]!.calories_100g, 25);
});

test('USDA Foundation energy uses an explicit Atwater priority regardless of array order', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ foods: [
    { fdcId: 3, description: 'Foundation sample', dataType: 'Foundation', foodNutrients: [
      { nutrientId: 2048, unitName: 'KCAL', value: 97 },
      { nutrientId: 2047, unitName: 'KCAL', value: 100 },
    ] },
    { fdcId: 4, description: 'General factor sample', dataType: 'Foundation', publicationDate: '4/1/2019', foodNutrients: [
      { nutrientId: 2047, unitName: 'KCAL', value: 100 },
    ] },
    { fdcId: 5, description: 'Legacy sample', dataType: 'SR Legacy', foodNutrients: [
      { nutrientId: 1008, unitName: 'KCAL', value: 95 },
      { nutrientId: 2048, unitName: 'KCAL', value: 97 },
    ] },
  ] }));
  const results = await searchFoodUSDA('test');
  assert.deepEqual(results.map(food => food.calories_100g), [97, 100, 95]);
  assert.equal(results[1]!.source_published_at, '4/1/2019');
});

test('USDA branded volume and unspecified bases cannot become per-100g nutrition', async (context) => {
  const cases = [
    { dataType: 'Branded', servingSizeUnit: 'ml', basis: 'per_100ml' },
    { dataType: 'Branded', servingSizeUnit: ' ML ', basis: 'per_100ml' },
    { dataType: 'Branded', basis: 'unknown' },
    { dataType: 'Branded', servingSizeUnit: 'oz', basis: 'unknown' },
    { dataType: 'Branded', servingSizeUnit: ' g ', basis: 'per_100g' },
    { dataType: 'Survey (FNDDS)', basis: 'per_100g' },
    { basis: 'unknown' },
  ];
  context.mock.method(globalThis, 'fetch', async () => Response.json({ foods: cases.map((item, index) => ({
    ...item, fdcId: index + 1, description: `Sample ${index}`, servingSize: 240,
    foodNutrients: [
      { nutrientId: 1008, unitName: 'KCAL', value: 42 },
      { nutrientId: 1003, unitName: 'G', value: 1.2 },
      { nutrientId: 1005, unitName: 'G', value: 10.8 },
      { nutrientId: 1004, unitName: 'G', value: 0 },
    ],
  })) }));
  const results = await searchFoodUSDA('sample');
  assert.equal(results.length, cases.length);
  for (const [index, food] of results.entries()) {
    assert.equal(food.nutrition_basis, cases[index]!.basis);
    assert.equal(food.source_serving_size_unit, cases[index]!.servingSizeUnit?.trim() ?? null);
    assert.equal(food.source_url, `https://fdc.nal.usda.gov/food-details/${index + 1}/nutrients`);
    assert.deepEqual([food.calories_100g, food.protein_100g, food.carbs_100g, food.fat_100g],
      cases[index]!.basis === 'per_100g' ? [42, 1.2, 10.8, 0] : [null, null, null, null]);
  }
});
