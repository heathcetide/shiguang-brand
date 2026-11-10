export type IngredientForm = {
  name: string;
  category: string;
  calories_100g: string;
  protein_100g: string;
  carbs_100g: string;
  fat_100g: string;
  source: string;
};

export function ingredientFormPayload(form: IngredientForm, original?: IngredientForm) {
  const payload: Record<string, string | number | null> = { name: form.name.trim() };
  for (const key of ['category', 'source'] as const) {
    if (!original || form[key] !== original[key]) payload[key] = form[key];
  }
  for (const key of ['calories_100g', 'protein_100g', 'carbs_100g', 'fat_100g'] as const) {
    const value = form[key].trim() === '' ? null : Number(form[key]);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > (key === 'calories_100g' ? 1000 : 100))) {
      throw new Error('营养值需为有效的非负数字，热量不超过 1000 kcal，三大营养素各不超过 100g');
    }
    const previous = original && (original[key].trim() === '' ? null : Number(original[key]));
    if (!original || value !== previous) payload[key] = value;
  }
  return payload;
}
