import { expect, it } from 'vitest';
import { ingredientFormPayload } from './ingredientForm';

const original = {
  name: '样品', category: '其他', source: 'taiwan_fda',
  calories_100g: '0.04', protein_100g: '', carbs_100g: '0', fat_100g: '1.25',
};

it('sends only edited fields while preserving unknown, zero and decimal nutrition', () => {
  expect(ingredientFormPayload({ ...original, name: '新名称' }, original)).toEqual({ name: '新名称' });
  expect(ingredientFormPayload({ ...original, protein_100g: '0', fat_100g: '' }, original))
    .toEqual({ name: '样品', protein_100g: 0, fat_100g: null });
  expect(ingredientFormPayload({ ...original, calories_100g: '0.040' }, original)).toEqual({ name: '样品' });
  expect(ingredientFormPayload(original)).toEqual({
    name: '样品', category: '其他', source: 'taiwan_fda', calories_100g: 0.04,
    protein_100g: null, carbs_100g: 0, fat_100g: 1.25,
  });
});

it('does not serialize invalid nutrition as null or negative values', () => {
  for (const value of ['invalid', 'Infinity', '-1', '1001']) {
    expect(() => ingredientFormPayload({ ...original, calories_100g: value }, original)).toThrow('营养值');
  }
  expect(() => ingredientFormPayload({ ...original, protein_100g: '101' }, original)).toThrow('营养值');
});
