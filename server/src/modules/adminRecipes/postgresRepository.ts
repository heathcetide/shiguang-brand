import { adminRecipeUpdateColumns, adminRecipeJsonColumns, adminRecipeExpectedValues } from "./updateSnapshot.js";
import type { Pool, PoolClient } from "pg";
import type { AdminRecipesRepository } from "./repository.js";
import type {
  AdminAudit, AdminRecipeQuery, AdminRecipeWrite, AuditContext, DuplicateWrite, RequirementWrite, Row,
} from "./types.js";

const COVERAGE_BOUNDARY = "deleted_at IS NULL AND status = 'approved' AND COALESCE(quality_status, 'trusted') <> 'needs_review'";

export class PostgresAdminRecipesRepository implements AdminRecipesRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async list(input: AdminRecipeQuery) {
    const values: unknown[] = [];
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const filters = [input.deleted === "deleted" ? "r.deleted_at IS NOT NULL" : input.deleted === "all" ? "TRUE" : "r.deleted_at IS NULL"];
    if (input.source === "user") filters.push(`r.source = ${parameter("user")}`);
    else if (input.source === "official") filters.push("(r.source IS NULL OR r.source <> 'user')");
    if (input.reviewStatus) filters.push(`r.status = ${parameter(input.reviewStatus)}`);
    if (input.qualityStatus) filters.push(`r.quality_status = ${parameter(input.qualityStatus)}`);
    if (input.category) filters.push(`r.category = ${parameter(input.category)}`);
    if (input.search) { const search = parameter(`%${input.search}%`); filters.push(`(r.title ILIKE ${search} OR r.description ILIKE ${search})`); }
    const summaryRow = (await this.pool.query(`SELECT COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE r.source IS DISTINCT FROM 'user')::integer AS platform,
      COUNT(*) FILTER (WHERE r.source = 'user')::integer AS user,
      COUNT(*) FILTER (WHERE r.status = 'pending')::integer AS pending,
      COUNT(*) FILTER (WHERE r.quality_status = 'needs_review')::integer AS needs_review
      FROM recipes r WHERE ${filters.join(" AND ")}`, values)).rows[0] as Row;
    const pageFilters = [...filters]; const pageValues = [...values];
    if (input.cursorId) { pageValues.push(input.cursorId); pageFilters.push(`r.id < $${pageValues.length}`); }
    if (input.limit) pageValues.push(input.limit);
    const rows = (await this.pool.query(`SELECT r.*, u.username AS author_username, u.avatar_url AS author_avatar_url
      FROM recipes r LEFT JOIN users u ON u.id = r.author_user_id WHERE ${pageFilters.join(" AND ")}
      ORDER BY r.id DESC ${input.limit ? `LIMIT $${pageValues.length}` : ""}`, pageValues)).rows as Row[];
    return { rows, summary: { total: Number(summaryRow.total || 0), platform: Number(summaryRow.platform || 0),
      user: Number(summaryRow.user || 0), pending: Number(summaryRow.pending || 0), needs_review: Number(summaryRow.needs_review || 0) } };
  }

  async duplicateSources(excludeRecipeId?: number) { return (await this.pool.query(`SELECT id, title, ingredients_json, steps_json
    FROM recipes WHERE deleted_at IS NULL ${excludeRecipeId ? "AND id <> $1" : ""}`, excludeRecipeId ? [excludeRecipeId] : [])).rows as Row[]; }

  async create(input: AdminRecipeWrite, context: AuditContext) {
    return this.tx(async (client) => {
      const result = await client.query(`INSERT INTO recipes
        (title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags,
         steps_json, ingredients_json, source, status, reviewed_by, reviewed_at, quality_status, nutrition_basis,
         quality_issues_json, quality_reviewed_by, quality_reviewed_at, quality_review_reason, canonical_key,
         source_content_hash, serving_size, prep_time, cuisine, meal_types_json, required_kitchenware_json,
         optional_kitchenware_json, source_url, data_license, source_revision, source_attribution, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,'official','approved',$14,CURRENT_TIMESTAMP,
          'trusted','source','[]'::jsonb,$15,CURRENT_TIMESTAMP,'管理员创建的官方菜谱',$16,$17,$18,$19,$20,$21::jsonb,
          $22::jsonb,$23::jsonb,$24,$25,$26,$27,CURRENT_TIMESTAMP) RETURNING id`,
      [...this.writeValues(input), context.adminUserId, context.adminUserId, ...this.metadataValues(input)]);
      const recipeId = Number(result.rows[0]!.id);
      await this.replaceRequirements(client, recipeId, input.requirements);
      await this.upsertDuplicates(client, recipeId, input.duplicates);
      await this.insertAudit(client, { ...context, action: "recipe.create", resourceId: recipeId, summary: `创建食谱：${input.title}` });
      return recipeId;
    });
  }

  async update(recipeId: number, input: AdminRecipeWrite, context: AuditContext, expected: Row) {
    return this.tx(async (client) => {
      const result = await client.query(`UPDATE recipes SET title=$1, description=$2, image_url=$3, cook_time=$4,
        difficulty=$5, calories=$6, protein=$7, carbs=$8, fat=$9, category=$10, tags=$11::jsonb,
        steps_json=$12::jsonb, ingredients_json=$13::jsonb, canonical_key=$14, source_content_hash=$15,
        serving_size=$16, prep_time=$17, cuisine=$18, meal_types_json=$19::jsonb, required_kitchenware_json=$20::jsonb,
        optional_kitchenware_json=$21::jsonb, source_url=$22, data_license=$23, source_revision=$24,
        source_attribution=$25, updated_at=CURRENT_TIMESTAMP WHERE id=$26 AND deleted_at IS NULL
        AND ${adminRecipeUpdateColumns.map((column, index) => `${column} IS NOT DISTINCT FROM $${27 + index}${adminRecipeJsonColumns.has(column) ? "::jsonb" : ""}`).join(" AND ")}`,
      [...this.writeValues(input), ...this.metadataValues(input), recipeId, ...adminRecipeExpectedValues(expected, true)]);
      if (result.rowCount !== 1) return false;
      await this.replaceRequirements(client, recipeId, input.requirements);
      await this.upsertDuplicates(client, recipeId, input.duplicates);
      await this.insertAudit(client, { ...context, action: "recipe.update", resourceId: recipeId, summary: `更新食谱：${input.title}` });
      return true;
    });
  }

  async find(recipeId: number) { return ((await this.pool.query(`SELECT *, ${[...adminRecipeJsonColumns].map(column => `${column}::text AS __update_${column}`).join(", ")} FROM recipes WHERE id=$1 AND deleted_at IS NULL`, [recipeId])).rows[0] as Row | undefined) || null; }

  async replaceKitchenware(recipeId: number, required: unknown[], optional: unknown[], requirements: RequirementWrite[], event: AdminAudit) {
    return this.tx(async (client) => {
      const locked = await client.query("SELECT 1 FROM recipes WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [recipeId]);
      if (!locked.rows[0]) return false;
      await this.replaceRequirements(client, recipeId, requirements);
      await client.query(`UPDATE recipes SET required_kitchenware_json=$1::jsonb, optional_kitchenware_json=$2::jsonb,
        updated_at=CURRENT_TIMESTAMP WHERE id=$3`, [JSON.stringify(required), JSON.stringify(optional), recipeId]);
      await this.insertAudit(client, event); return true;
    });
  }

  async scanDuplicates(recipeId: number, duplicates: DuplicateWrite[], event: AdminAudit) { await this.tx(async (client) => {
    await this.upsertDuplicates(client, recipeId, duplicates); await this.insertAudit(client, event);
  }); }

  async coverage() {
    const [byCategory, byDifficulty, byTime, sources, qualityFailures, duplicates, baselineResult] = await Promise.all([
      this.pool.query(`SELECT COALESCE(category, '未分类') AS value, COUNT(*)::integer AS count FROM recipes WHERE ${COVERAGE_BOUNDARY}
        GROUP BY COALESCE(category, '未分类') ORDER BY count DESC`),
      this.pool.query(`SELECT COALESCE(difficulty, '未知') AS value, COUNT(*)::integer AS count FROM recipes WHERE ${COVERAGE_BOUNDARY}
        GROUP BY COALESCE(difficulty, '未知') ORDER BY count DESC`),
      this.pool.query(`SELECT CASE WHEN cook_time <= 15 THEN '15分钟' WHEN cook_time <= 30 THEN '30分钟'
        WHEN cook_time <= 60 THEN '60分钟' ELSE '60分钟以上' END AS value, COUNT(*)::integer AS count FROM recipes
        WHERE ${COVERAGE_BOUNDARY} GROUP BY CASE WHEN cook_time <= 15 THEN '15分钟' WHEN cook_time <= 30 THEN '30分钟'
        WHEN cook_time <= 60 THEN '60分钟' ELSE '60分钟以上' END ORDER BY value`),
      this.pool.query(`SELECT source, data_license, COUNT(*)::integer AS count FROM recipes WHERE ${COVERAGE_BOUNDARY}
        GROUP BY source, data_license ORDER BY count DESC`),
      this.pool.query(`SELECT id, title, quality_status, quality_issues_json FROM recipes WHERE deleted_at IS NULL
        AND (status <> 'approved' OR quality_status='needs_review' OR data_license IS NULL OR source_content_hash IS NULL)
        ORDER BY id DESC LIMIT 200`),
      this.pool.query("SELECT * FROM recipe_duplicate_candidates WHERE status='pending' ORDER BY similarity DESC LIMIT 200"),
      this.pool.query("SELECT dimension, value, minimum_candidates FROM recipe_coverage_baselines ORDER BY dimension, value"),
    ]);
    const baselines = await Promise.all((baselineResult.rows as Row[]).map(async (baseline) => {
      const value = String(baseline.value); let result;
      if (baseline.dimension === "time") result = await this.pool.query(`SELECT COUNT(*)::integer AS count FROM recipes
        WHERE ${COVERAGE_BOUNDARY} AND cook_time <= $1`, [Number.parseInt(value, 10)]);
      else if (baseline.dimension === "difficulty") result = await this.pool.query(`SELECT COUNT(*)::integer AS count FROM recipes
        WHERE ${COVERAGE_BOUNDARY} AND difficulty=$1`, [value]);
      else result = await this.pool.query(`SELECT COUNT(*)::integer AS count FROM recipes WHERE ${COVERAGE_BOUNDARY}
        AND (COALESCE(tags::text,'') ILIKE $1 OR COALESCE(category,'') ILIKE $1 OR COALESCE(meal_types_json::text,'') ILIKE $1)`, [`%${value}%`]);
      const actual = Number(result.rows[0]?.count || 0);
      return { ...baseline, actual, met: actual >= Number(baseline.minimum_candidates) };
    }));
    return { byCategory: byCategory.rows, byDifficulty: byDifficulty.rows, byTime: byTime.rows, sources: sources.rows,
      qualityFailures: qualityFailures.rows, duplicates: duplicates.rows, baselines };
  }

  async approve(recipeId: number, reviewerId: number, event: AdminAudit) { return this.reviewTransaction(
    `UPDATE recipes SET status='approved', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, reject_reason=NULL,
      quality_status='trusted', nutrition_basis='source', quality_issues_json='[]'::jsonb, quality_reviewed_by=$1,
      quality_reviewed_at=CURRENT_TIMESTAMP, quality_review_reason='用户投稿审核通过', updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND source='user' AND deleted_at IS NULL`, [reviewerId, recipeId], event); }

  async reviewQuality(recipeId: number, status: "trusted" | "needs_review", reason: string, event: AdminAudit) { return this.reviewTransaction(
    `UPDATE recipes SET quality_status=$1, quality_reviewed_by=$2, quality_reviewed_at=CURRENT_TIMESTAMP,
      quality_review_reason=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND deleted_at IS NULL`,
    [status, event.adminUserId, reason, recipeId], event); }

  async reviewExecution(recipeId: number, execution: import("@dietdigidose/contracts").ReviewedRecipeExecution | null, expected: Row, event: AdminAudit) {
    return this.reviewTransaction(`UPDATE recipes SET execution_json=$1::jsonb, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND deleted_at IS NULL AND title IS NOT DISTINCT FROM $3 AND serving_size IS NOT DISTINCT FROM $4
      AND cook_time IS NOT DISTINCT FROM $5 AND prep_time IS NOT DISTINCT FROM $6
      AND ingredients_json IS NOT DISTINCT FROM $7::jsonb AND steps_json IS NOT DISTINCT FROM $8::jsonb
      AND required_kitchenware_json IS NOT DISTINCT FROM $9::jsonb AND optional_kitchenware_json IS NOT DISTINCT FROM $10::jsonb AND execution_json IS NOT DISTINCT FROM $11::jsonb`,
    [execution ? JSON.stringify(execution) : null, recipeId, expected.title, expected.serving_size ?? null, expected.cook_time ?? null,
      expected.prep_time ?? null, JSON.stringify(expected.ingredients_json), JSON.stringify(expected.steps_json),
      JSON.stringify(expected.required_kitchenware_json), JSON.stringify(expected.optional_kitchenware_json), expected.execution_json == null ? null : JSON.stringify(expected.execution_json)], event);
  }

  async reject(recipeId: number, reviewerId: number, reason: string, event: AdminAudit) { return this.reviewTransaction(
    `UPDATE recipes SET status='rejected', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, reject_reason=$2,
      updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND source='user' AND deleted_at IS NULL`, [reviewerId, reason, recipeId], event); }

  async remove(recipeId: number, reviewerId: number, event: AdminAudit) { return this.reviewTransaction(
    "UPDATE recipes SET deleted_at=CURRENT_TIMESTAMP, deleted_by=$1 WHERE id=$2 AND deleted_at IS NULL", [reviewerId, recipeId], event); }

  private writeValues(input: AdminRecipeWrite) { return [input.title, input.description, input.imageUrl, input.cookTime, input.difficulty,
    input.calories, input.protein, input.carbs, input.fat, input.category, JSON.stringify(input.tags), JSON.stringify(input.steps),
    JSON.stringify(input.ingredients)]; }
  private metadataValues(input: AdminRecipeWrite) { return [input.canonicalKey, input.sourceContentHash, input.servingSize, input.prepTime,
    input.cuisine, JSON.stringify(input.mealTypes), JSON.stringify(input.requiredKitchenware), JSON.stringify(input.optionalKitchenware),
    input.sourceUrl, input.dataLicense, input.sourceRevision, input.sourceAttribution]; }

  private async replaceRequirements(client: PoolClient, recipeId: number, requirements: RequirementWrite[]) {
    await client.query("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id=$1 AND role IN ('required','optional')", [recipeId]);
    for (const item of requirements) {
      if (item.catalogId || item.capabilityCode) await client.query(`INSERT INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes) VALUES ($1,$2,$3,$4,'admin',$5,$6)
        ON CONFLICT DO NOTHING`, [recipeId, item.catalogId, item.capabilityCode, item.role, item.confidence, item.rawName]);
      if (!item.catalogId || item.confidence < 1) await client.query(`INSERT INTO kitchenware_mapping_reviews
        (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id) VALUES ($1,$2,'recipe',$3,$4,$5)
        ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET raw_name=excluded.raw_name,
        confidence=excluded.confidence, suggested_catalog_id=excluded.suggested_catalog_id, status='pending', reviewed_at=NULL`,
      [item.rawName, item.normalizedName, String(recipeId), item.confidence, item.catalogId]);
    }
  }

  private async upsertDuplicates(client: PoolClient, recipeId: number, duplicates: DuplicateWrite[]) {
    for (const item of duplicates) await client.query(`INSERT INTO recipe_duplicate_candidates
      (recipe_id, candidate_recipe_id, similarity, reasons_json) VALUES ($1,$2,$3,$4::jsonb)
      ON CONFLICT(recipe_id, candidate_recipe_id) DO UPDATE SET similarity=excluded.similarity, reasons_json=excluded.reasons_json`,
    [Math.min(recipeId, item.candidateRecipeId), Math.max(recipeId, item.candidateRecipeId), item.similarity, JSON.stringify(item.reasons)]);
  }

  private insertAudit(client: PoolClient, event: AdminAudit) { return client.query(`INSERT INTO admin_audit_logs
    (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
    VALUES ($1,$2,'recipes',$3,$4,$5::jsonb,$6,$7)`, [event.adminUserId, event.action, String(event.resourceId), event.summary,
    event.details ? JSON.stringify(event.details) : null, event.ipAddress || null, event.userAgent || null]); }

  private reviewTransaction(sql: string, values: unknown[], event: AdminAudit) { return this.tx(async (client) => {
    const result = await client.query(sql, values); if (result.rowCount !== 1) return false; await this.insertAudit(client, event); return true;
  }); }

  private async tx<T>(operation: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect();
    try { await client.query("BEGIN"); const value = await operation(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
