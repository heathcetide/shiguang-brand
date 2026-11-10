import { db, initDatabase } from '../src/storage/db.js';
import { ensureIngredientGroups } from '../src/utils/ingredientGroups.js';

type RecipeRow = { id: number; title: string; ingredients_json: string | null };

function parseIngredients(value: string | null): Array<{ name: string; amount: string; group?: string }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === 'string') return { name: item.trim(), amount: '' };
        if (!item || typeof item !== 'object') return null;
        const ingredient = item as Record<string, unknown>;
        return {
          name: String(ingredient.name || '').trim(),
          amount: String(ingredient.amount || '').trim(),
          group: String(ingredient.group || '').trim() || undefined,
        };
      })
      .filter((item): item is { name: string; amount: string; group?: string } => Boolean(item?.name));
  } catch {
    return [];
  }
}

initDatabase();
const rows = db.prepare(`
  SELECT id, title, ingredients_json
  FROM recipes
  WHERE deleted_at IS NULL
`).all() as RecipeRow[];
const update = db.prepare('UPDATE recipes SET ingredients_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
let updated = 0;

db.transaction(() => {
  for (const row of rows) {
    const ingredients = parseIngredients(row.ingredients_json);
    if (!ingredients.length) continue;
    const grouped = ensureIngredientGroups(ingredients, row.title);
    if (JSON.stringify(ingredients) === JSON.stringify(grouped)) continue;
    update.run(JSON.stringify(grouped), row.id);
    updated += 1;
  }
})();

console.log(JSON.stringify({ scanned: rows.length, updated }, null, 2));
db.close();
