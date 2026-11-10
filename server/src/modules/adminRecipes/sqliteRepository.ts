import { adminRecipeUpdateColumns, adminRecipeExpectedValues } from "./updateSnapshot.js";
import type Database from "better-sqlite3";
import type { AdminRecipesRepository } from "./repository.js";
import type {
  AdminAudit, AdminRecipeQuery, AdminRecipeWrite, AuditContext, DuplicateWrite, RequirementWrite, Row,
} from "./types.js";

const COVERAGE_BOUNDARY = "deleted_at IS NULL AND status = 'approved' AND COALESCE(quality_status, 'trusted') <> 'needs_review'";

export class SqliteAdminRecipesRepository implements AdminRecipesRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async list(input: AdminRecipeQuery) {
    const filters = [input.deleted === "deleted" ? "r.deleted_at IS NOT NULL" : input.deleted === "all" ? "1=1" : "r.deleted_at IS NULL"];
    const values: Array<string | number> = [];
    if (input.source === "user") { filters.push("r.source = ?"); values.push("user"); }
    else if (input.source === "official") filters.push("(r.source IS NULL OR r.source <> 'user')");
    if (input.reviewStatus) { filters.push("r.status = ?"); values.push(input.reviewStatus); }
    if (input.qualityStatus) { filters.push("r.quality_status = ?"); values.push(input.qualityStatus); }
    if (input.category) { filters.push("r.category = ?"); values.push(input.category); }
    if (input.search) { filters.push("(r.title LIKE ? OR r.description LIKE ?)"); values.push(`%${input.search}%`, `%${input.search}%`); }
    const summaryRow = this.database.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN r.source = 'user' THEN 0 ELSE 1 END) AS platform,
      SUM(CASE WHEN r.source = 'user' THEN 1 ELSE 0 END) AS user,
      SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN r.quality_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review
      FROM recipes r WHERE ${filters.join(" AND ")}`).get(...values) as Row;
    const pageFilters = [...filters]; const pageValues = [...values];
    if (input.cursorId) { pageFilters.push("r.id < ?"); pageValues.push(input.cursorId); }
    const rows = this.database.prepare(`SELECT r.*, u.username AS author_username, u.avatar_url AS author_avatar_url
      FROM recipes r LEFT JOIN users u ON u.id = r.author_user_id WHERE ${pageFilters.join(" AND ")}
      ORDER BY r.id DESC ${input.limit ? "LIMIT ?" : ""}`).all(...pageValues, ...(input.limit ? [input.limit] : [])) as Row[];
    return { rows, summary: { total: Number(summaryRow.total || 0), platform: Number(summaryRow.platform || 0),
      user: Number(summaryRow.user || 0), pending: Number(summaryRow.pending || 0), needs_review: Number(summaryRow.needs_review || 0) } };
  }

  async duplicateSources(excludeRecipeId?: number) {
    return this.database.prepare(`SELECT id, title, ingredients_json, steps_json FROM recipes
      WHERE deleted_at IS NULL ${excludeRecipeId ? "AND id <> ?" : ""}`).all(...(excludeRecipeId ? [excludeRecipeId] : [])) as Row[];
  }

  async create(input: AdminRecipeWrite, context: AuditContext) {
    return this.database.transaction(() => {
      const result = this.database.prepare(`INSERT INTO recipes
        (title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags,
         steps_json, ingredients_json, source, status, reviewed_by, reviewed_at, quality_status, nutrition_basis,
         quality_issues_json, quality_reviewed_by, quality_reviewed_at, quality_review_reason, canonical_key,
         source_content_hash, serving_size, prep_time, cuisine, meal_types_json, required_kitchenware_json,
         optional_kitchenware_json, source_url, data_license, source_revision, source_attribution, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official', 'approved', ?, CURRENT_TIMESTAMP, 'trusted',
          'source', '[]', ?, CURRENT_TIMESTAMP, '管理员创建的官方菜谱', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .run(...this.writeValues(input), context.adminUserId, context.adminUserId, ...this.metadataValues(input));
      const recipeId = Number(result.lastInsertRowid);
      this.replaceRequirements(recipeId, input.requirements);
      this.upsertDuplicates(recipeId, input.duplicates);
      this.insertAudit({ ...context, action: "recipe.create", resourceId: recipeId, summary: `创建食谱：${input.title}` });
      return recipeId;
    })();
  }

  async update(recipeId: number, input: AdminRecipeWrite, context: AuditContext, expected: Row) {
    return this.database.transaction(() => {
      const result = this.database.prepare(`UPDATE recipes SET title=?, description=?, image_url=?, cook_time=?, difficulty=?,
        calories=?, protein=?, carbs=?, fat=?, category=?, tags=?, steps_json=?, ingredients_json=?, canonical_key=?,
        source_content_hash=?, serving_size=?, prep_time=?, cuisine=?, meal_types_json=?, required_kitchenware_json=?,
        optional_kitchenware_json=?, source_url=?, data_license=?, source_revision=?, source_attribution=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND deleted_at IS NULL AND ${adminRecipeUpdateColumns.map(column => `${column} IS ?`).join(" AND ")}`)
        .run(...this.writeValues(input), ...this.metadataValues(input), recipeId, ...adminRecipeExpectedValues(expected));
      if (!result.changes) return false;
      this.replaceRequirements(recipeId, input.requirements);
      this.upsertDuplicates(recipeId, input.duplicates);
      this.insertAudit({ ...context, action: "recipe.update", resourceId: recipeId, summary: `更新食谱：${input.title}` });
      return true;
    })();
  }

  async find(recipeId: number) { return (this.database.prepare("SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL")
    .get(recipeId) as Row | undefined) || null; }

  async replaceKitchenware(recipeId: number, required: unknown[], optional: unknown[], requirements: RequirementWrite[], event: AdminAudit) {
    return this.database.transaction(() => {
      if (!this.database.prepare("SELECT 1 FROM recipes WHERE id = ? AND deleted_at IS NULL").get(recipeId)) return false;
      this.replaceRequirements(recipeId, requirements);
      this.database.prepare(`UPDATE recipes SET required_kitchenware_json = ?, optional_kitchenware_json = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`).run(JSON.stringify(required), JSON.stringify(optional), recipeId);
      this.insertAudit(event); return true;
    })();
  }

  async scanDuplicates(recipeId: number, duplicates: DuplicateWrite[], event: AdminAudit) {
    this.database.transaction(() => { this.upsertDuplicates(recipeId, duplicates); this.insertAudit(event); })();
  }

  async coverage() {
    const byCategory = this.database.prepare(`SELECT COALESCE(category, '未分类') AS value, COUNT(*) AS count FROM recipes
      WHERE ${COVERAGE_BOUNDARY} GROUP BY COALESCE(category, '未分类') ORDER BY count DESC`).all() as Row[];
    const byDifficulty = this.database.prepare(`SELECT COALESCE(difficulty, '未知') AS value, COUNT(*) AS count FROM recipes
      WHERE ${COVERAGE_BOUNDARY} GROUP BY COALESCE(difficulty, '未知') ORDER BY count DESC`).all() as Row[];
    const byTime = this.database.prepare(`SELECT CASE WHEN cook_time <= 15 THEN '15分钟' WHEN cook_time <= 30 THEN '30分钟'
      WHEN cook_time <= 60 THEN '60分钟' ELSE '60分钟以上' END AS value, COUNT(*) AS count FROM recipes
      WHERE ${COVERAGE_BOUNDARY} GROUP BY value ORDER BY value`).all() as Row[];
    const sources = this.database.prepare(`SELECT source, data_license, COUNT(*) AS count FROM recipes WHERE ${COVERAGE_BOUNDARY}
      GROUP BY source, data_license ORDER BY count DESC`).all() as Row[];
    const qualityFailures = this.database.prepare(`SELECT id, title, quality_status, quality_issues_json FROM recipes
      WHERE deleted_at IS NULL AND (status <> 'approved' OR quality_status = 'needs_review' OR data_license IS NULL
      OR source_content_hash IS NULL) ORDER BY id DESC LIMIT 200`).all() as Row[];
    const duplicates = this.database.prepare("SELECT * FROM recipe_duplicate_candidates WHERE status = 'pending' ORDER BY similarity DESC LIMIT 200").all() as Row[];
    const baselines = (this.database.prepare("SELECT dimension, value, minimum_candidates FROM recipe_coverage_baselines ORDER BY dimension, value").all() as Row[])
      .map((baseline) => { const value = String(baseline.value); let actual: number;
        if (baseline.dimension === "time") actual = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM recipes WHERE ${COVERAGE_BOUNDARY} AND cook_time <= ?`).get(Number.parseInt(value, 10)) as Row).count);
        else if (baseline.dimension === "difficulty") actual = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM recipes WHERE ${COVERAGE_BOUNDARY} AND difficulty = ?`).get(value) as Row).count);
        else actual = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM recipes WHERE ${COVERAGE_BOUNDARY}
          AND (tags LIKE ? OR category LIKE ? OR meal_types_json LIKE ?)`).get(`%${value}%`, `%${value}%`, `%${value}%`) as Row).count);
        return { ...baseline, actual, met: actual >= Number(baseline.minimum_candidates) }; });
    return { byCategory, byDifficulty, byTime, sources, qualityFailures, duplicates, baselines };
  }

  async approve(recipeId: number, reviewerId: number, event: AdminAudit) { return this.reviewTransaction(recipeId,
    `UPDATE recipes SET status='approved', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, reject_reason=NULL,
      quality_status='trusted', nutrition_basis='source', quality_issues_json='[]', quality_reviewed_by=?,
      quality_reviewed_at=CURRENT_TIMESTAMP, quality_review_reason='用户投稿审核通过', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND source='user' AND deleted_at IS NULL`, [reviewerId, reviewerId, recipeId], event); }

  async reviewQuality(recipeId: number, status: "trusted" | "needs_review", reason: string, event: AdminAudit) {
    return this.reviewTransaction(recipeId, `UPDATE recipes SET quality_status=?, quality_reviewed_by=?,
      quality_reviewed_at=CURRENT_TIMESTAMP, quality_review_reason=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at IS NULL`, [status, event.adminUserId, reason, recipeId], event);
  }

  async reviewExecution(recipeId: number, execution: import("@dietdigidose/contracts").ReviewedRecipeExecution | null, expected: Row, event: AdminAudit) {
    return this.reviewTransaction(recipeId, `UPDATE recipes SET execution_json=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at IS NULL AND title IS ? AND serving_size IS ? AND cook_time IS ? AND prep_time IS ?
      AND ingredients_json IS ? AND steps_json IS ? AND required_kitchenware_json IS ? AND optional_kitchenware_json IS ? AND execution_json IS ?`,
    [execution ? JSON.stringify(execution) : null, recipeId, expected.title, expected.serving_size ?? null, expected.cook_time ?? null,
      expected.prep_time ?? null, expected.ingredients_json, expected.steps_json, expected.required_kitchenware_json, expected.optional_kitchenware_json, expected.execution_json ?? null], event);
  }

  async reject(recipeId: number, reviewerId: number, reason: string, event: AdminAudit) { return this.reviewTransaction(recipeId,
    `UPDATE recipes SET status='rejected', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, reject_reason=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND source='user' AND deleted_at IS NULL`, [reviewerId, reason, recipeId], event); }

  async remove(recipeId: number, reviewerId: number, event: AdminAudit) { return this.reviewTransaction(recipeId,
    "UPDATE recipes SET deleted_at=CURRENT_TIMESTAMP, deleted_by=? WHERE id=? AND deleted_at IS NULL", [reviewerId, recipeId], event); }

  private writeValues(input: AdminRecipeWrite) { return [input.title, input.description, input.imageUrl, input.cookTime, input.difficulty,
    input.calories, input.protein, input.carbs, input.fat, input.category, JSON.stringify(input.tags), JSON.stringify(input.steps),
    JSON.stringify(input.ingredients)]; }
  private metadataValues(input: AdminRecipeWrite) { return [input.canonicalKey, input.sourceContentHash, input.servingSize, input.prepTime,
    input.cuisine, JSON.stringify(input.mealTypes), JSON.stringify(input.requiredKitchenware), JSON.stringify(input.optionalKitchenware),
    input.sourceUrl, input.dataLicense, input.sourceRevision, input.sourceAttribution]; }

  private replaceRequirements(recipeId: number, requirements: RequirementWrite[]) {
    this.database.prepare("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id = ? AND role IN ('required','optional')").run(recipeId);
    const insert = this.database.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
      (recipe_id, catalog_id, capability_code, role, source, confidence, notes) VALUES (?, ?, ?, ?, 'admin', ?, ?)`);
    const review = this.database.prepare(`INSERT INTO kitchenware_mapping_reviews
      (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id) VALUES (?, ?, 'recipe', ?, ?, ?)
      ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET raw_name=excluded.raw_name,
      confidence=excluded.confidence, suggested_catalog_id=excluded.suggested_catalog_id, status='pending', reviewed_at=NULL`);
    for (const item of requirements) {
      if (item.catalogId || item.capabilityCode) insert.run(recipeId, item.catalogId, item.capabilityCode, item.role, item.confidence, item.rawName);
      if (!item.catalogId || item.confidence < 1) review.run(item.rawName, item.normalizedName, String(recipeId), item.confidence, item.catalogId);
    }
  }

  private upsertDuplicates(recipeId: number, duplicates: DuplicateWrite[]) {
    const insert = this.database.prepare(`INSERT INTO recipe_duplicate_candidates
      (recipe_id, candidate_recipe_id, similarity, reasons_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(recipe_id, candidate_recipe_id) DO UPDATE SET similarity=excluded.similarity, reasons_json=excluded.reasons_json`);
    for (const item of duplicates) insert.run(Math.min(recipeId, item.candidateRecipeId), Math.max(recipeId, item.candidateRecipeId), item.similarity, JSON.stringify(item.reasons));
  }

  private insertAudit(event: AdminAudit) { this.database.prepare(`INSERT INTO admin_audit_logs
    (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
    VALUES (?, ?, 'recipes', ?, ?, ?, ?, ?)`).run(event.adminUserId, event.action, String(event.resourceId), event.summary,
    event.details ? JSON.stringify(event.details) : null, event.ipAddress || null, event.userAgent || null); }

  private reviewTransaction(recipeId: number, sql: string, values: unknown[], event: AdminAudit) {
    return Promise.resolve(this.database.transaction(() => { const result = this.database.prepare(sql).run(...values);
      if (!result.changes) return false; this.insertAudit(event); return true; })());
  }
}
