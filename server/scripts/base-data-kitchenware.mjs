import { isDeepStrictEqual } from 'node:util';

// Caller owns the import transaction. Only repair the exact legacy importer shape;
// an administrator's JSON or relational edits must remain untouched.
export async function repairBaseDataKitchenware(db, recipeId, logicalId, version, required) {
  const recipe = (await db.query(`SELECT required_kitchenware_json FROM recipes
    WHERE id=$1 AND source='base_data' AND external_id=$2 AND source_revision=$3 FOR UPDATE`,
  [recipeId, logicalId, version])).rows[0];
  const legacy = required.map(item => ({ catalog_id: item.catalog_id }));
  if (!recipe || !isDeepStrictEqual(recipe.required_kitchenware_json, legacy)) return false;
  if ((await db.query('SELECT 1 FROM recipe_kitchenware_requirements WHERE recipe_id=$1 LIMIT 1', [recipeId])).rowCount) return false;
  for (const item of required) {
    await db.query(`INSERT INTO recipe_kitchenware_requirements
      (recipe_id,catalog_id,role,source,confidence,notes) VALUES($1,$2,'required','base_data',1,$3)`,
    [recipeId, item.catalog_id, item.name]);
  }
  await db.query('UPDATE recipes SET required_kitchenware_json=$1::jsonb WHERE id=$2', [JSON.stringify(required), recipeId]);
  return required.length > 0;
}
