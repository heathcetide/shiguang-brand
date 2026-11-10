import type { Pool, PoolClient } from "pg";
import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { mergeIngredientUpdate } from "./ingredientUpdate.js";
import type { AdminFoodAssetsRepository } from "./repository.js";
import type { AdminAudit, IngredientInput, IngredientUpdateInput, IngredientQuery, Row } from "./types.js";

export class PostgresAdminFoodAssetsRepository implements AdminFoodAssetsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async listIngredients(input: IngredientQuery) {
    const filters = [input.deleted === "deleted" ? "deleted_at IS NOT NULL" : input.deleted === "all" ? "TRUE" : "deleted_at IS NULL"];
    const values: unknown[] = [];
    if (input.search) { values.push(`%${input.search}%`); const value = `$${values.length}`;
      filters.push(`(name ILIKE ${value} OR brands ILIKE ${value} OR barcode ILIKE ${value})`); }
    if (input.category) { values.push(input.category); filters.push(`category=$${values.length}`); }
    if (input.source) { values.push(input.source); filters.push(`source=$${values.length}`); }
    const where = filters.join(" AND ");
    const total = Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM ingredients_library WHERE ${where}`, values)).rows[0]?.count);
    values.push(input.pageSize, (input.page - 1) * input.pageSize);
    const items = (await this.pool.query(`SELECT * FROM ingredients_library WHERE ${where} ORDER BY id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows as Row[];
    return { items, total };
  }

  async createIngredient(input: IngredientInput, audit: AdminAudit) { return this.tx(async (client) => {
    const result = await client.query(`INSERT INTO ingredients_library
      (name, normalized_name, aliases_json, search_keywords, preparation_state, calories_100g, protein_100g,
       carbs_100g, fat_100g, category, source, source_version, source_updated_at, data_license, edible_ratio, nutrition_status, quality_status)
      VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP,$13,$14,$15,$16) RETURNING id`,
    [input.name, input.normalizedName, JSON.stringify(input.aliases.map((item) => item.value)), input.searchKeywords,
      input.preparationState, input.calories100g, input.protein100g, input.carbs100g, input.fat100g, input.category,
      input.source, input.sourceVersion, input.dataLicense, input.edibleRatio, input.nutritionStatus,
      input.nutritionStatus === "core_complete" ? "trusted" : "needs_review"]);
    const id = Number(result.rows[0]!.id); await this.replaceAliases(client, id, input);
    await this.insertAudit(client, { ...audit, resourceId: id }); return id;
  }); }

  async updateIngredient(id: number, patch: IngredientUpdateInput, audit: AdminAudit) { return this.tx(async (client) => {
    const current = (await client.query("SELECT * FROM ingredients_library WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])).rows[0] as Row | undefined;
    if (!current) return false;
    const input = mergeIngredientUpdate(current, patch);
    const updated = await client.query(`UPDATE ingredients_library SET name=$1, normalized_name=$2, aliases_json=COALESCE($3::jsonb,aliases_json),
      search_keywords=COALESCE($4,search_keywords), preparation_state=COALESCE($5,preparation_state),
      calories_100g=$6, protein_100g=$7, carbs_100g=$8, fat_100g=$9,
      category=$10, source=COALESCE($11,source), source_version=$12, data_license=$13,
      edible_ratio=COALESCE($14,edible_ratio), nutrition_status=$15,
      quality_status=CASE WHEN ($15 <> 'core_complete' OR $17::boolean) AND quality_status='trusted' THEN 'needs_review' ELSE quality_status END,
      source_updated_at=CASE WHEN $17::boolean THEN NULL ELSE source_updated_at END
      WHERE id=$16 AND deleted_at IS NULL`,
    [input.name, input.normalizedName, input.aliases === undefined ? null : JSON.stringify(input.aliases.map((item) => item.value)), input.searchKeywords,
      input.preparationState, input.calories100g, input.protein100g, input.carbs100g, input.fat100g, input.category,
      input.source, input.sourceVersion, input.dataLicense, input.edibleRatio, input.nutritionStatus, id, input.sourceChanged]);
    if (updated.rowCount !== 1) return false;
    await this.replaceAliases(client, id, input);
    await this.insertAudit(client, audit); return true;
  }); }

  async removeIngredient(id: number, audit: AdminAudit) { return this.tx(async (client) => {
    const result = await client.query(`UPDATE ingredients_library SET deleted_at=CURRENT_TIMESTAMP, deleted_by=$1
      WHERE id=$2 AND deleted_at IS NULL RETURNING name`, [audit.adminUserId, id]);
    const item = result.rows[0] as Row | undefined; if (!item) return false;
    await this.insertAudit(client, { ...audit, summary: `将食材移入回收站：${item.name}` }); return true;
  }); }

  async addAlias(id: number, alias: string, normalized: string, audit: AdminAudit) { return this.tx(async (client) => {
    const item = (await client.query("SELECT name FROM ingredients_library WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])).rows[0] as Row | undefined;
    if (!item) return { kind: "missing" as const };
    await client.query(`INSERT INTO ingredient_aliases (ingredient_id, alias, normalized_alias, alias_type)
      VALUES ($1,$2,$3,'synonym') ON CONFLICT (ingredient_id, normalized_alias) DO NOTHING`, [id, alias, normalized]);
    const aliases = await this.aliases(client, id);
    await client.query("UPDATE ingredients_library SET aliases_json=$1::jsonb WHERE id=$2", [JSON.stringify(aliases), id]);
    await this.insertAudit(client, { ...audit, summary: `为 ${item.name} 添加别名：${alias}` });
    return { kind: "added" as const, aliases };
  }); }

  async mergeIngredient(sourceId: number, targetId: number, audit: AdminAudit) { return this.tx(async (client) => {
    const rows = (await client.query(`SELECT id, name, normalized_name FROM ingredients_library
      WHERE id=ANY($1::integer[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [[sourceId, targetId]])).rows as Row[];
    const source = rows.find((row) => Number(row.id) === sourceId); const target = rows.find((row) => Number(row.id) === targetId);
    if (!source || !target) return { kind: "missing" as const };
    await client.query(`INSERT INTO ingredient_aliases (ingredient_id, alias, normalized_alias, alias_type)
      VALUES ($1,$2,$3,'merged') ON CONFLICT (ingredient_id, normalized_alias) DO NOTHING`,
    [targetId, String(source.name), String(source.normalized_name || normalizeContentTerm(String(source.name)))]);
    await client.query(`INSERT INTO ingredient_aliases (ingredient_id, alias, normalized_alias, alias_type)
      SELECT $1, alias, normalized_alias, 'merged' FROM ingredient_aliases WHERE ingredient_id=$2
      ON CONFLICT (ingredient_id, normalized_alias) DO NOTHING`, [targetId, sourceId]);
    const aliases = await this.aliases(client, targetId);
    await client.query("UPDATE ingredients_library SET aliases_json=$1::jsonb WHERE id=$2", [JSON.stringify(aliases), targetId]);
    await client.query(`UPDATE ingredients_library SET deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, quality_status='merged',
      review_notes=$2 WHERE id=$3`, [audit.adminUserId, `merged_into:${targetId}`, sourceId]);
    await this.insertAudit(client, { ...audit, summary: `合并食材：${source.name} → ${target.name}` });
    return { kind: "merged" as const, source: String(source.name), target: String(target.name) };
  }); }

  async coverage() {
    const categories = (await this.pool.query(`SELECT COALESCE(category, '未分类') AS category, COUNT(*)::integer AS count,
      COUNT(*) FILTER (WHERE quality_status='trusted' AND data_license IS NOT NULL AND source_version IS NOT NULL)::integer AS governed
      FROM ingredients_library WHERE deleted_at IS NULL GROUP BY COALESCE(category, '未分类') ORDER BY count DESC`)).rows as Row[];
    const gaps = (await this.pool.query("SELECT * FROM ingredient_search_gaps ORDER BY hit_count DESC, last_seen_at DESC LIMIT 100")).rows as Row[];
    const anomalies = (await this.pool.query(`SELECT id, name FROM ingredients_library WHERE deleted_at IS NULL AND
      (calories_100g < 0 OR calories_100g > 1000 OR protein_100g < 0 OR carbs_100g < 0 OR fat_100g < 0
       OR COALESCE(protein_100g,0)+COALESCE(carbs_100g,0)+COALESCE(fat_100g,0) > 105) LIMIT 100`)).rows as Row[];
    return { categories, gaps, anomalies };
  }

  async pendingCustomFoods() { return (await this.pool.query(`SELECT ucf.*, u.username AS author_name FROM user_custom_foods ucf
    LEFT JOIN users u ON u.id=ucf.user_id WHERE ucf.status='pending' ORDER BY ucf.created_at DESC`)).rows as Row[]; }

  async approveCustomFood(id: number, audit: AdminAudit) { return this.tx(async (client) => {
    const item = (await client.query("SELECT * FROM user_custom_foods WHERE id=$1 AND status='pending' FOR UPDATE", [id])).rows[0] as Row | undefined;
    if (!item) return { kind: "missing" as const };
    await client.query("UPDATE user_custom_foods SET status='approved' WHERE id=$1 AND status='pending'", [id]);
    await client.query(`INSERT INTO ingredients_library (name, calories_100g, protein_100g, carbs_100g, fat_100g, source)
      VALUES ($1,$2,$3,$4,$5,'ugc')`, [item.name, item.calories_100g, item.protein_100g, item.carbs_100g, item.fat_100g]);
    await this.insertAudit(client, { ...audit, summary: `审核通过自定义食材：${item.name}` });
    return { kind: "reviewed" as const, name: String(item.name) };
  }); }

  async rejectCustomFood(id: number, audit: AdminAudit) { return this.tx(async (client) => {
    const result = await client.query(`UPDATE user_custom_foods SET status='rejected'
      WHERE id=$1 AND status='pending' RETURNING name`, [id]);
    const item = result.rows[0] as Row | undefined; if (!item) return { kind: "missing" as const };
    await this.insertAudit(client, { ...audit, summary: `驳回自定义食材：${item.name}` });
    return { kind: "reviewed" as const, name: String(item.name) };
  }); }

  private async aliases(client: PoolClient, id: number) { return (await client.query(`SELECT alias FROM ingredient_aliases
    WHERE ingredient_id=$1 AND alias_type <> 'canonical' ORDER BY alias`, [id])).rows.map((item) => String(item.alias)); }
  private async replaceAliases(client: PoolClient, id: number, input: Pick<IngredientUpdateInput, "name" | "normalizedName" | "aliases">) {
    await client.query("DELETE FROM ingredient_aliases WHERE ingredient_id=$1 AND ($2::boolean OR alias_type='canonical')",
      [id, input.aliases !== undefined]);
    await client.query(`INSERT INTO ingredient_aliases (ingredient_id, alias, normalized_alias, alias_type)
      VALUES ($1,$2,$3,'canonical') ON CONFLICT (ingredient_id, normalized_alias) DO NOTHING`, [id, input.name, input.normalizedName]);
    for (const alias of input.aliases ?? []) await client.query(`INSERT INTO ingredient_aliases
      (ingredient_id, alias, normalized_alias, alias_type) VALUES ($1,$2,$3,'synonym')
      ON CONFLICT (ingredient_id, normalized_alias) DO NOTHING`, [id, alias.value, alias.normalized]);
  }
  private insertAudit(client: PoolClient, audit: AdminAudit) { return client.query(`INSERT INTO admin_audit_logs
    (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [audit.adminUserId, audit.action, audit.resourceType, String(audit.resourceId),
    audit.summary, audit.details ? JSON.stringify(audit.details) : null, audit.ipAddress || null, audit.userAgent || null]); }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
