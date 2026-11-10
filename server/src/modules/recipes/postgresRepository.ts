import { assertPlanExecution, planExecutionRecipeIds } from "./planExecution.js";
import type { Pool, PoolClient } from "pg";
import type { RecipesRepository } from "./repository.js";
import type { PublicRecipeQuery, RecipeRequirementWrite, RecipeSubmissionWrite, Row } from "./types.js";

const PUBLIC_BOUNDARY = "r.deleted_at IS NULL AND r.status = 'approved' AND COALESCE(r.quality_status, 'trusted') <> 'needs_review'";

export class PostgresRecipesRepository implements RecipesRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async listPublic(input: PublicRecipeQuery) {
    const values: unknown[] = [];
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const filters = [PUBLIC_BOUNDARY];
    if (input.scope !== 'personal') filters.push("COALESCE(r.base_data_payload->>'is_primary','true') <> 'false'");
    if (input.scope === "official") filters.push("r.source <> 'user'");
    else if (input.scope === "community") filters.push("r.source = 'user'");
    else if (input.scope === "personal") {
      const user = parameter(input.userId);
      filters.push(`(r.author_user_id = ${user} OR EXISTS(SELECT 1 FROM recipe_favorites f WHERE f.recipe_id = r.id AND f.user_id = ${user}))`);
    }
    if (input.category && input.category !== "全部") filters.push(`r.category = ${parameter(input.category)}`);
    if (input.search) {
      const term = parameter(`%${input.search}%`);
      filters.push(`(r.title ILIKE ${term} OR r.description ILIKE ${term} OR COALESCE(r.tags::text, '') ILIKE ${term}
        OR COALESCE(r.ingredients_json::text, '') ILIKE ${term})`);
    }
    if (input.maxCookTime !== null) filters.push(`r.cook_time <= ${parameter(input.maxCookTime)}`);
    const total = Number((await this.pool.query(`SELECT COUNT(*)::integer AS total FROM recipes r WHERE ${filters.join(" AND ")}`, values)).rows[0]?.total || 0);
    const pageFilters = [...filters];
    const pageValues = [...values];
    if (input.cursorId) { pageValues.push(input.cursorId); pageFilters.push(`r.id < $${pageValues.length}`); }
    pageValues.push(input.limit);
    const rows = (await this.pool.query(`SELECT r.*, COALESCE(u.username, '食友' || u.id) AS author_username,
      u.avatar_url AS author_avatar_url FROM recipes r LEFT JOIN users u ON u.id = r.author_user_id
      WHERE ${pageFilters.join(" AND ")} ORDER BY r.id DESC LIMIT $${pageValues.length}`, pageValues)).rows as Row[];
    return { rows, total };
  }

  async librarySummary(userId?: number) {
    const result = await this.pool.query(`SELECT
      (SELECT COUNT(*)::integer FROM recipes r WHERE ${PUBLIC_BOUNDARY} AND r.source <> 'user'
        AND COALESCE(r.base_data_payload->>'is_primary','true') <> 'false') AS official,
      (SELECT COUNT(*)::integer FROM recipes r WHERE ${PUBLIC_BOUNDARY} AND r.source = 'user') AS community,
      (SELECT COUNT(*)::integer FROM recipes r WHERE $1::integer IS NOT NULL AND ${PUBLIC_BOUNDARY}
        AND (r.author_user_id = $1 OR EXISTS(SELECT 1 FROM recipe_favorites f WHERE f.recipe_id = r.id AND f.user_id = $1))) AS personal,
      (SELECT COUNT(*)::integer FROM recipe_favorites f JOIN recipes r ON r.id = f.recipe_id
        WHERE $1::integer IS NOT NULL AND f.user_id = $1 AND ${PUBLIC_BOUNDARY}) AS favorites`, [userId || null]);
    const row = result.rows[0]!;
    return { official: Number(row.official), community: Number(row.community), personal: Number(row.personal), favorites: Number(row.favorites) };
  }

  async listMine(userId: number) { return (await this.pool.query(`SELECT * FROM recipes WHERE author_user_id = $1
    AND source = 'user' AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC`, [userId])).rows as Row[]; }

  async listFavorites(userId: number) { return (await this.pool.query(`SELECT r.*, f.created_at AS favorited_at,
    COALESCE(u.username, '食友' || u.id) AS author_username, u.avatar_url AS author_avatar_url
    FROM recipe_favorites f JOIN recipes r ON r.id = f.recipe_id LEFT JOIN users u ON u.id = r.author_user_id
    WHERE f.user_id = $1 AND ${PUBLIC_BOUNDARY} ORDER BY f.created_at DESC`, [userId])).rows as Row[]; }

  async favoriteCount(userId: number) { return Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM recipe_favorites f
    JOIN recipes r ON r.id = f.recipe_id WHERE f.user_id = $1 AND ${PUBLIC_BOUNDARY}`, [userId])).rows[0]?.count || 0); }

  async requirementsForRecipes(recipeIds: number[]) {
    if (!recipeIds.length) return [];
    return (await this.pool.query(`SELECT r.recipe_id, r.role, r.notes, r.confidence, r.capability_code,
      c.id AS catalog_id, c.name AS catalog_name FROM recipe_kitchenware_requirements r
      LEFT JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id = ANY($1::integer[])
      ORDER BY r.recipe_id, CASE r.role WHEN 'required' THEN 0 WHEN 'optional' THEN 1 ELSE 2 END, r.id`, [recipeIds])).rows as Row[];
  }

  async createSubmission(input: RecipeSubmissionWrite) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const values = this.createValues(input);
      const result = await client.query(`INSERT INTO recipes
        (title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, nutrition_json,
         category, tags, steps_json, ingredients_json, author_user_id, source, status, quality_status, nutrition_basis,
         canonical_key, source_content_hash, serving_size, prep_time, cuisine, meal_types_json,
         required_kitchenware_json, optional_kitchenware_json, data_license, source_revision, source_attribution, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,
          'user','pending','needs_review','user_declared',$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,
          'User-Submitted-Terms-v1','ugc-v1',$24,CURRENT_TIMESTAMP) RETURNING id`, [...values, `用户 ${input.authorUserId} 投稿`]);
      const recipeId = Number(result.rows[0]!.id);
      await this.replaceRequirements(client, recipeId, input.requirements);
      await client.query("COMMIT");
      return recipeId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async findSubmission(userId: number, recipeId: number) { return ((await this.pool.query(`SELECT id, status FROM recipes
    WHERE id = $1 AND author_user_id = $2 AND source = 'user' AND deleted_at IS NULL`, [recipeId, userId])).rows[0] as Row | undefined) || null; }

  async updateSubmission(recipeId: number, input: RecipeSubmissionWrite) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const values = this.updateValues(input);
      const result = await client.query(`UPDATE recipes SET title=$1, description=$2, image_url=$3, cook_time=$4,
        difficulty=$5, calories=$6, protein=$7, carbs=$8, fat=$9, nutrition_json=$10::jsonb, category=$11,
        tags=$12::jsonb, steps_json=$13::jsonb, ingredients_json=$14::jsonb, status='pending', quality_status='needs_review',
        canonical_key=$15, source_content_hash=$16, serving_size=$17, prep_time=$18, cuisine=$19,
        meal_types_json=$20::jsonb, required_kitchenware_json=$21::jsonb, optional_kitchenware_json=$22::jsonb,
        data_license='User-Submitted-Terms-v1', source_revision='ugc-v1', source_attribution=$23,
        reject_reason=NULL, reviewed_by=NULL, reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=$24 AND author_user_id=$25 AND source='user' AND deleted_at IS NULL`,
      [...values, `用户 ${input.authorUserId} 投稿`, recipeId, input.authorUserId]);
      if (result.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      await this.replaceRequirements(client, recipeId, input.requirements);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async withdrawSubmission(userId: number, recipeId: number) { return (await this.pool.query(`UPDATE recipes
    SET deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, updated_at=CURRENT_TIMESTAMP
    WHERE id=$2 AND author_user_id=$1 AND source='user' AND deleted_at IS NULL`, [userId, recipeId])).rowCount === 1; }

  async isFavorite(userId: number, recipeId: number) { return Boolean((await this.pool.query(
    "SELECT 1 FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2", [userId, recipeId])).rows[0]); }

  async addFavorite(userId: number, recipeId: number) {
    const result = await this.pool.query(`INSERT INTO recipe_favorites (user_id, recipe_id)
      SELECT $1, r.id FROM recipes r WHERE r.id=$2 AND ${PUBLIC_BOUNDARY}
      ON CONFLICT(user_id, recipe_id) DO NOTHING RETURNING recipe_id`, [userId, recipeId]);
    if (result.rows[0]) return true;
    return Boolean((await this.pool.query(`SELECT 1 FROM recipes r WHERE r.id=$1 AND ${PUBLIC_BOUNDARY}`, [recipeId])).rows[0]);
  }

  async removeFavorite(userId: number, recipeId: number) { await this.pool.query(
    "DELETE FROM recipe_favorites WHERE user_id=$1 AND recipe_id=$2", [userId, recipeId]); }

  async findPublic(recipeId: number) { return ((await this.pool.query(`SELECT r.*,
    COALESCE(u.username, '食友' || u.id) AS author_username, u.avatar_url AS author_avatar_url
    FROM recipes r LEFT JOIN users u ON u.id = r.author_user_id WHERE r.id=$1 AND ${PUBLIC_BOUNDARY}`, [recipeId])).rows[0] as Row | undefined) || null; }

  private createValues(input: RecipeSubmissionWrite) {
    const recipe = input.recipe;
    return [recipe.title, recipe.description, recipe.imageUrl || null, recipe.cookTime, recipe.difficulty,
      recipe.calories, recipe.protein, recipe.carbs, recipe.fat, JSON.stringify(recipe.nutrition), recipe.category,
      JSON.stringify(recipe.tags), JSON.stringify(recipe.steps), JSON.stringify(recipe.ingredients), input.authorUserId,
      input.canonicalKey, input.sourceContentHash, recipe.servingSize, recipe.prepTime, recipe.cuisine,
      JSON.stringify(recipe.mealTypes), JSON.stringify(recipe.requiredKitchenware), JSON.stringify(recipe.optionalKitchenware)];
  }

  private updateValues(input: RecipeSubmissionWrite) {
    const values = this.createValues(input);
    return [...values.slice(0, 14), ...values.slice(15)];
  }

  private async replaceRequirements(client: PoolClient, recipeId: number, requirements: RecipeRequirementWrite[]) {
    await client.query("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id=$1 AND role IN ('required','optional')", [recipeId]);
    for (const requirement of requirements) {
      if (requirement.catalogId) {
        await client.query(`INSERT INTO recipe_kitchenware_requirements
          (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
          VALUES ($1,$2,NULL,$3,'user_submission',$4,$5) ON CONFLICT DO NOTHING`,
        [recipeId, requirement.catalogId, requirement.role, requirement.confidence, `映射自：${requirement.rawName}`]);
      } else {
        await client.query(`INSERT INTO kitchenware_mapping_reviews
          (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id)
          VALUES ($1,$2,'recipe',$3,$4,NULL) ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET
          raw_name=excluded.raw_name, confidence=excluded.confidence, suggested_catalog_id=excluded.suggested_catalog_id,
          status='pending', reviewed_at=NULL`, [requirement.rawName.trim(), requirement.normalizedName, String(recipeId), requirement.confidence]);
      }
    }
  }
}

export async function assertPostgresPlanExecution(client: PoolClient, items: Row[]) {
  const ids = planExecutionRecipeIds(items);
  const rows = ids.length ? (await client.query("SELECT * FROM recipes WHERE id=ANY($1::integer[]) ORDER BY id FOR SHARE", [ids])).rows as Row[] : [];
  assertPlanExecution(items, new Map(rows.map(row => [Number(row.id), row])));
}
