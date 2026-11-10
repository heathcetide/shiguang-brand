import { assertPlanExecution, planExecutionRecipeIds } from "./planExecution.js";
import type Database from "better-sqlite3";
import type { RecipesRepository } from "./repository.js";
import type { PublicRecipeQuery, RecipeRequirementWrite, RecipeSubmissionWrite, Row } from "./types.js";

const PUBLIC_BOUNDARY = "r.deleted_at IS NULL AND r.status = 'approved' AND COALESCE(r.quality_status, 'trusted') <> 'needs_review'";

export class SqliteRecipesRepository implements RecipesRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async listPublic(input: PublicRecipeQuery) {
    const filters = [PUBLIC_BOUNDARY];
    if (input.scope !== 'personal') filters.push("COALESCE(json_extract(r.base_data_payload,'$.is_primary'),1) <> 0");
    const values: Array<string | number> = [];
    if (input.scope === "official") filters.push("r.source <> 'user'");
    else if (input.scope === "community") filters.push("r.source = 'user'");
    else if (input.scope === "personal") {
      filters.push("(r.author_user_id = ? OR EXISTS(SELECT 1 FROM recipe_favorites f WHERE f.recipe_id = r.id AND f.user_id = ?))");
      values.push(input.userId!, input.userId!);
    }
    if (input.category && input.category !== "全部") { filters.push("r.category = ?"); values.push(input.category); }
    if (input.search) {
      filters.push("(r.title LIKE ? OR r.description LIKE ? OR r.tags LIKE ? OR r.ingredients_json LIKE ?)");
      const term = `%${input.search}%`; values.push(term, term, term, term);
    }
    if (input.maxCookTime !== null) { filters.push("r.cook_time <= ?"); values.push(input.maxCookTime); }
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS total FROM recipes r WHERE ${filters.join(" AND ")}`)
      .get(...values) as { total: number }).total || 0);
    const pageFilters = [...filters];
    const pageValues = [...values];
    if (input.cursorId) { pageFilters.push("r.id < ?"); pageValues.push(input.cursorId); }
    const rows = this.database.prepare(`SELECT r.*, COALESCE(u.username, '食友' || u.id) AS author_username,
      u.avatar_url AS author_avatar_url FROM recipes r LEFT JOIN users u ON u.id = r.author_user_id
      WHERE ${pageFilters.join(" AND ")} ORDER BY r.id DESC LIMIT ?`).all(...pageValues, input.limit) as Row[];
    return { rows, total };
  }

  async librarySummary(userId?: number) {
    const boundary = "deleted_at IS NULL AND status = 'approved' AND COALESCE(quality_status, 'trusted') <> 'needs_review'";
    const totals = this.database.prepare(`SELECT
      SUM(CASE WHEN source <> 'user' AND COALESCE(json_extract(base_data_payload,'$.is_primary'),1) <> 0 THEN 1 ELSE 0 END) AS official,
      SUM(CASE WHEN source = 'user' THEN 1 ELSE 0 END) AS community FROM recipes WHERE ${boundary}`).get() as Row;
    const official = Number(totals.official || 0), community = Number(totals.community || 0);
    const personal = userId ? Number((this.database.prepare(`SELECT COUNT(*) AS count FROM recipes r WHERE ${boundary}
      AND (r.author_user_id = ? OR EXISTS(SELECT 1 FROM recipe_favorites f WHERE f.recipe_id = r.id AND f.user_id = ?))`)
      .get(userId, userId) as Row).count) : 0;
    const favorites = userId ? Number((this.database.prepare(`SELECT COUNT(*) AS count FROM recipe_favorites f JOIN recipes r ON r.id = f.recipe_id
      WHERE f.user_id = ? AND r.deleted_at IS NULL AND r.status = 'approved'
      AND COALESCE(r.quality_status, 'trusted') <> 'needs_review'`).get(userId) as Row).count) : 0;
    return { official, community, personal, favorites };
  }

  async listMine(userId: number) { return this.database.prepare(`SELECT * FROM recipes WHERE author_user_id = ?
    AND source = 'user' AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC`).all(userId) as Row[]; }

  async listFavorites(userId: number) { return this.database.prepare(`SELECT r.*, f.created_at AS favorited_at,
    COALESCE(u.username, '食友' || u.id) AS author_username, u.avatar_url AS author_avatar_url
    FROM recipe_favorites f JOIN recipes r ON r.id = f.recipe_id LEFT JOIN users u ON u.id = r.author_user_id
    WHERE f.user_id = ? AND ${PUBLIC_BOUNDARY} ORDER BY f.created_at DESC`).all(userId) as Row[]; }

  async favoriteCount(userId: number) { return Number((this.database.prepare(`SELECT COUNT(*) AS count FROM recipe_favorites f
    JOIN recipes r ON r.id = f.recipe_id WHERE f.user_id = ? AND ${PUBLIC_BOUNDARY}`).get(userId) as Row).count || 0); }

  async requirementsForRecipes(recipeIds: number[]) {
    if (!recipeIds.length) return [];
    const placeholders = recipeIds.map(() => "?").join(",");
    return this.database.prepare(`SELECT r.recipe_id, r.role, r.notes, r.confidence, r.capability_code,
      c.id AS catalog_id, c.name AS catalog_name FROM recipe_kitchenware_requirements r
      LEFT JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id IN (${placeholders})
      ORDER BY r.recipe_id, CASE r.role WHEN 'required' THEN 0 WHEN 'optional' THEN 1 ELSE 2 END, r.id`)
      .all(...recipeIds) as Row[];
  }

  async createSubmission(input: RecipeSubmissionWrite) {
    return this.database.transaction(() => {
      const recipe = input.recipe;
      const result = this.database.prepare(`INSERT INTO recipes
        (title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, nutrition_json,
         category, tags, steps_json, ingredients_json, author_user_id, source, status, quality_status, nutrition_basis,
         canonical_key, source_content_hash, serving_size, prep_time, cuisine, meal_types_json,
         required_kitchenware_json, optional_kitchenware_json, data_license, source_revision, source_attribution, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 'pending', 'needs_review', 'user_declared',
          ?, ?, ?, ?, ?, ?, ?, ?, 'User-Submitted-Terms-v1', 'ugc-v1', ?, CURRENT_TIMESTAMP)`)
        .run(...this.recipeValues(input), `用户 ${input.authorUserId} 投稿`);
      const recipeId = Number(result.lastInsertRowid);
      this.replaceRequirements(recipeId, input.requirements);
      return recipeId;
    })();
  }

  async findSubmission(userId: number, recipeId: number) { return (this.database.prepare(`SELECT id, status FROM recipes
    WHERE id = ? AND author_user_id = ? AND source = 'user' AND deleted_at IS NULL`).get(recipeId, userId) as Row | undefined) || null; }

  async updateSubmission(recipeId: number, input: RecipeSubmissionWrite) {
    return this.database.transaction(() => {
      const result = this.database.prepare(`UPDATE recipes SET title = ?, description = ?, image_url = ?, cook_time = ?,
        difficulty = ?, calories = ?, protein = ?, carbs = ?, fat = ?, nutrition_json = ?, category = ?, tags = ?,
        steps_json = ?, ingredients_json = ?, status = 'pending', quality_status = 'needs_review', canonical_key = ?,
        source_content_hash = ?, serving_size = ?, prep_time = ?, cuisine = ?, meal_types_json = ?,
        required_kitchenware_json = ?, optional_kitchenware_json = ?, data_license = 'User-Submitted-Terms-v1',
        source_revision = 'ugc-v1', source_attribution = ?, reject_reason = NULL, reviewed_by = NULL, reviewed_at = NULL,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND author_user_id = ? AND source = 'user' AND deleted_at IS NULL`)
        .run(...this.updateRecipeValues(input), `用户 ${input.authorUserId} 投稿`, recipeId, input.authorUserId);
      if (!result.changes) return false;
      this.replaceRequirements(recipeId, input.requirements);
      return true;
    })();
  }

  async withdrawSubmission(userId: number, recipeId: number) { return this.database.prepare(`UPDATE recipes
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND author_user_id = ? AND source = 'user' AND deleted_at IS NULL`).run(userId, recipeId, userId).changes === 1; }

  async isFavorite(userId: number, recipeId: number) { return Boolean(this.database.prepare(
    "SELECT 1 FROM recipe_favorites WHERE user_id = ? AND recipe_id = ?").get(userId, recipeId)); }

  async addFavorite(userId: number, recipeId: number) {
    return this.database.transaction(() => {
      const recipe = this.database.prepare(`SELECT id FROM recipes r WHERE r.id = ? AND ${PUBLIC_BOUNDARY}`).get(recipeId);
      if (!recipe) return false;
      this.database.prepare("INSERT OR IGNORE INTO recipe_favorites (user_id, recipe_id) VALUES (?, ?)").run(userId, recipeId);
      return true;
    })();
  }

  async removeFavorite(userId: number, recipeId: number) { this.database.prepare(
    "DELETE FROM recipe_favorites WHERE user_id = ? AND recipe_id = ?").run(userId, recipeId); }

  async findPublic(recipeId: number) { return (this.database.prepare(`SELECT r.*,
    COALESCE(u.username, '食友' || u.id) AS author_username, u.avatar_url AS author_avatar_url
    FROM recipes r LEFT JOIN users u ON u.id = r.author_user_id WHERE r.id = ? AND ${PUBLIC_BOUNDARY}`)
    .get(recipeId) as Row | undefined) || null; }

  private recipeValues(input: RecipeSubmissionWrite) {
    const recipe = input.recipe;
    return [recipe.title, recipe.description, recipe.imageUrl || null, recipe.cookTime, recipe.difficulty,
      recipe.calories, recipe.protein, recipe.carbs, recipe.fat, JSON.stringify(recipe.nutrition), recipe.category,
      JSON.stringify(recipe.tags), JSON.stringify(recipe.steps), JSON.stringify(recipe.ingredients), input.authorUserId,
      input.canonicalKey, input.sourceContentHash, recipe.servingSize, recipe.prepTime, recipe.cuisine,
      JSON.stringify(recipe.mealTypes), JSON.stringify(recipe.requiredKitchenware), JSON.stringify(recipe.optionalKitchenware)] as const;
  }

  private updateRecipeValues(input: RecipeSubmissionWrite) {
    const values = this.recipeValues(input);
    return [...values.slice(0, 14), ...values.slice(15)] as Array<string | number | null>;
  }

  private replaceRequirements(recipeId: number, requirements: RecipeRequirementWrite[]) {
    this.database.prepare("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id = ? AND role IN ('required', 'optional')").run(recipeId);
    const insert = this.database.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
      (recipe_id, catalog_id, capability_code, role, source, confidence, notes) VALUES (?, ?, NULL, ?, 'user_submission', ?, ?)`);
    const review = this.database.prepare(`INSERT INTO kitchenware_mapping_reviews
      (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id)
      VALUES (?, ?, 'recipe', ?, ?, ?) ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET
      raw_name = excluded.raw_name, confidence = excluded.confidence, suggested_catalog_id = excluded.suggested_catalog_id,
      status = 'pending', reviewed_at = NULL`);
    for (const requirement of requirements) {
      if (requirement.catalogId) insert.run(recipeId, requirement.catalogId, requirement.role, requirement.confidence, `映射自：${requirement.rawName}`);
      else review.run(requirement.rawName.trim(), requirement.normalizedName, String(recipeId), requirement.confidence, null);
    }
  }
}

export function assertSqlitePlanExecution(database: Database.Database, items: Row[]) {
  const ids = planExecutionRecipeIds(items);
  const rows = ids.length ? database.prepare(`SELECT * FROM recipes WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[] : [];
  assertPlanExecution(items, new Map(rows.map(row => [Number(row.id), row])));
}
