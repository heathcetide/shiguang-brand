import type { Row } from "./types.js";

// Every column overwritten by the editor participates in its optimistic lock.
// Compare values, not updated_at (SQLite timestamps have one-second precision).
export const adminRecipeUpdateColumns = [
  'title', 'description', 'image_url', 'cook_time', 'difficulty', 'calories', 'protein', 'carbs', 'fat', 'category',
  'tags', 'steps_json', 'ingredients_json', 'canonical_key', 'source_content_hash', 'serving_size', 'prep_time',
  'cuisine', 'meal_types_json', 'required_kitchenware_json', 'optional_kitchenware_json', 'source_url',
  'data_license', 'source_revision', 'source_attribution',
] as const;
export const adminRecipeJsonColumns = new Set<string>(['tags', 'steps_json', 'ingredients_json', 'meal_types_json', 'required_kitchenware_json', 'optional_kitchenware_json']);
export function adminRecipeExpectedValues(expected: Row, postgres = false) {
  return adminRecipeUpdateColumns.map(column => {
    // PostgreSQL find captures JSON text so jsonb scalar strings and JSON null
    // remain distinguishable from decoded strings and SQL NULL respectively.
    if (postgres && adminRecipeJsonColumns.has(column)) return expected[`__update_${column}`] ?? null;
    const value = expected[column] ?? null;
    return adminRecipeJsonColumns.has(column) && value !== null && typeof value !== 'string' ? JSON.stringify(value) : value;
  });
}
