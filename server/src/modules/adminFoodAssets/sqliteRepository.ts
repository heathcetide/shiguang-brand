import type Database from "better-sqlite3";
import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { mergeIngredientUpdate } from "./ingredientUpdate.js";
import type { AdminFoodAssetsRepository } from "./repository.js";
import type { AdminAudit, IngredientInput, IngredientUpdateInput, IngredientQuery, Row } from "./types.js";

export class SqliteAdminFoodAssetsRepository implements AdminFoodAssetsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async listIngredients(input: IngredientQuery) {
    const filters = [input.deleted === "deleted" ? "deleted_at IS NOT NULL" : input.deleted === "all" ? "1=1" : "deleted_at IS NULL"];
    const values: Array<string | number> = [];
    if (input.search) { filters.push("(name LIKE ? OR brands LIKE ? OR barcode LIKE ?)");
      const term = `%${input.search}%`; values.push(term, term, term); }
    if (input.category) { filters.push("category = ?"); values.push(input.category); }
    if (input.source) { filters.push("source = ?"); values.push(input.source); }
    const where = filters.join(" AND ");
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM ingredients_library WHERE ${where}`)
      .get(...values) as Row).count);
    const items = this.database.prepare(`SELECT * FROM ingredients_library WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...values, input.pageSize, (input.page - 1) * input.pageSize) as Row[];
    return { items, total };
  }

  async createIngredient(input: IngredientInput, audit: AdminAudit) { return this.database.transaction(() => {
    const inserted = this.database.prepare(`INSERT INTO ingredients_library
      (name, normalized_name, aliases_json, search_keywords, preparation_state, calories_100g, protein_100g,
       carbs_100g, fat_100g, category, source, source_version, source_updated_at, data_license, edible_ratio, nutrition_status, quality_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`)
      .run(input.name, input.normalizedName, JSON.stringify(input.aliases.map((item) => item.value)), input.searchKeywords,
        input.preparationState, input.calories100g, input.protein100g, input.carbs100g, input.fat100g, input.category,
        input.source, input.sourceVersion, input.dataLicense, input.edibleRatio, input.nutritionStatus,
        input.nutritionStatus === "core_complete" ? "trusted" : "needs_review");
    const id = Number(inserted.lastInsertRowid); this.replaceAliases(id, input);
    this.insertAudit({ ...audit, resourceId: id }); return id;
  })(); }

  async updateIngredient(id: number, patch: IngredientUpdateInput, audit: AdminAudit) { return this.database.transaction(() => {
    const current = this.getIngredient(id);
    if (!current) return false;
    const input = mergeIngredientUpdate(current, patch);
    const updated = this.database.prepare(`UPDATE ingredients_library SET name=?, normalized_name=?, aliases_json=COALESCE(?,aliases_json),
      search_keywords=COALESCE(?,search_keywords), preparation_state=COALESCE(?,preparation_state),
      calories_100g=?, protein_100g=?, carbs_100g=?, fat_100g=?, category=?, source=COALESCE(?,source),
      source_version=?, data_license=?,
      edible_ratio=COALESCE(?,edible_ratio), nutrition_status=?,
      quality_status=CASE WHEN (? <> 'core_complete' OR ?) AND quality_status='trusted' THEN 'needs_review' ELSE quality_status END,
      source_updated_at=CASE WHEN ? THEN NULL ELSE source_updated_at END
      WHERE id=? AND deleted_at IS NULL`).run(input.name, input.normalizedName,
      input.aliases === undefined ? null : JSON.stringify(input.aliases.map((item) => item.value)),
      input.searchKeywords ?? null, input.preparationState ?? null, input.calories100g, input.protein100g, input.carbs100g, input.fat100g,
      input.category, input.source ?? null, input.sourceVersion ?? null, input.dataLicense ?? null, input.edibleRatio ?? null, input.nutritionStatus,
      input.nutritionStatus, Number(input.sourceChanged), Number(input.sourceChanged), id);
    if (!updated.changes) return false;
    this.replaceAliases(id, input);
    this.insertAudit(audit); return true;
  })(); }

  async removeIngredient(id: number, audit: AdminAudit) { return this.database.transaction(() => {
    const item = this.getIngredient(id);
    if (!item) return false;
    this.database.prepare("UPDATE ingredients_library SET deleted_at=CURRENT_TIMESTAMP, deleted_by=? WHERE id=? AND deleted_at IS NULL")
      .run(audit.adminUserId, id);
    this.insertAudit({ ...audit, summary: `将食材移入回收站：${item.name}` }); return true;
  })(); }

  async addAlias(id: number, alias: string, normalized: string, audit: AdminAudit) { return this.database.transaction(() => {
    const item = this.getIngredient(id);
    if (!item) return { kind: "missing" as const };
    this.database.prepare(`INSERT OR IGNORE INTO ingredient_aliases
      (ingredient_id, alias, normalized_alias, alias_type) VALUES (?, ?, ?, 'synonym')`).run(id, alias, normalized);
    const aliases = this.aliases(id); this.database.prepare("UPDATE ingredients_library SET aliases_json=? WHERE id=?")
      .run(JSON.stringify(aliases), id);
    this.insertAudit({ ...audit, summary: `为 ${item.name} 添加别名：${alias}` });
    return { kind: "added" as const, aliases };
  })(); }

  async mergeIngredient(sourceId: number, targetId: number, audit: AdminAudit) { return this.database.transaction(() => {
    const source = this.getIngredient(sourceId);
    const target = this.getIngredient(targetId);
    if (!source || !target) return { kind: "missing" as const };
    const insert = this.database.prepare(`INSERT OR IGNORE INTO ingredient_aliases
      (ingredient_id, alias, normalized_alias, alias_type) VALUES (?, ?, ?, 'merged')`);
    insert.run(targetId, String(source.name), normalizeContentTerm(String(source.name)));
    const sourceAliases = this.database.prepare("SELECT alias, normalized_alias FROM ingredient_aliases WHERE ingredient_id=?")
      .all(sourceId) as Array<{ alias: string; normalized_alias: string }>;
    for (const item of sourceAliases) insert.run(targetId, item.alias, item.normalized_alias);
    const aliases = this.aliases(targetId); this.database.prepare("UPDATE ingredients_library SET aliases_json=? WHERE id=?")
      .run(JSON.stringify(aliases), targetId);
    this.database.prepare(`UPDATE ingredients_library SET deleted_at=CURRENT_TIMESTAMP, deleted_by=?, quality_status='merged',
      review_notes=? WHERE id=?`).run(audit.adminUserId, `merged_into:${targetId}`, sourceId);
    this.insertAudit({ ...audit, summary: `合并食材：${source.name} → ${target.name}` });
    return { kind: "merged" as const, source: String(source.name), target: String(target.name) };
  })(); }

  async coverage() {
    const categories = this.database.prepare(`SELECT COALESCE(category, '未分类') AS category, COUNT(*) AS count,
      SUM(CASE WHEN quality_status='trusted' AND data_license IS NOT NULL AND source_version IS NOT NULL THEN 1 ELSE 0 END) AS governed
      FROM ingredients_library WHERE deleted_at IS NULL GROUP BY COALESCE(category, '未分类') ORDER BY count DESC`).all() as Row[];
    const gaps = this.database.prepare("SELECT * FROM ingredient_search_gaps ORDER BY hit_count DESC, last_seen_at DESC LIMIT 100").all() as Row[];
    const anomalies = this.database.prepare(`SELECT id, name FROM ingredients_library WHERE deleted_at IS NULL AND
      (calories_100g < 0 OR calories_100g > 1000 OR protein_100g < 0 OR carbs_100g < 0 OR fat_100g < 0
       OR COALESCE(protein_100g,0)+COALESCE(carbs_100g,0)+COALESCE(fat_100g,0) > 105) LIMIT 100`).all() as Row[];
    return { categories, gaps, anomalies };
  }

  async pendingCustomFoods() { return this.database.prepare(`SELECT ucf.*, u.username AS author_name FROM user_custom_foods ucf
    LEFT JOIN users u ON u.id=ucf.user_id WHERE ucf.status='pending' ORDER BY ucf.created_at DESC`).all() as Row[]; }

  async approveCustomFood(id: number, audit: AdminAudit) { return this.database.transaction(() => {
    const item = this.database.prepare("SELECT * FROM user_custom_foods WHERE id=? AND status='pending'").get(id) as Row | undefined;
    if (!item) return { kind: "missing" as const };
    this.database.prepare("UPDATE user_custom_foods SET status='approved' WHERE id=? AND status='pending'").run(id);
    this.database.prepare(`INSERT INTO ingredients_library (name, calories_100g, protein_100g, carbs_100g, fat_100g, source)
      VALUES (?, ?, ?, ?, ?, 'ugc')`).run(item.name, item.calories_100g, item.protein_100g, item.carbs_100g, item.fat_100g);
    this.insertAudit({ ...audit, summary: `审核通过自定义食材：${item.name}` });
    return { kind: "reviewed" as const, name: String(item.name) };
  })(); }

  async rejectCustomFood(id: number, audit: AdminAudit) { return this.database.transaction(() => {
    const item = this.database.prepare("SELECT name FROM user_custom_foods WHERE id=? AND status='pending'").get(id) as Row | undefined;
    if (!item) return { kind: "missing" as const };
    this.database.prepare("UPDATE user_custom_foods SET status='rejected' WHERE id=? AND status='pending'").run(id);
    this.insertAudit({ ...audit, summary: `驳回自定义食材：${item.name}` });
    return { kind: "reviewed" as const, name: String(item.name) };
  })(); }

  private getIngredient(id: number) {
    return this.database.prepare("SELECT * FROM ingredients_library WHERE id=? AND deleted_at IS NULL").get(id) as Row | undefined;
  }
  private aliases(id: number) { return (this.database.prepare(`SELECT alias FROM ingredient_aliases
    WHERE ingredient_id=? AND alias_type <> 'canonical' ORDER BY alias`).all(id) as Array<{ alias: string }>).map((item) => item.alias); }
  private replaceAliases(id: number, input: Pick<IngredientUpdateInput, "name" | "normalizedName" | "aliases">) {
    this.database.prepare("DELETE FROM ingredient_aliases WHERE ingredient_id=? AND (? OR alias_type='canonical')")
      .run(id, Number(input.aliases !== undefined));
    const insert = this.database.prepare(`INSERT OR IGNORE INTO ingredient_aliases
      (ingredient_id, alias, normalized_alias, alias_type) VALUES (?, ?, ?, ?)`);
    insert.run(id, input.name, input.normalizedName, "canonical");
    for (const alias of input.aliases ?? []) insert.run(id, alias.value, alias.normalized, "synonym");
  }
  private insertAudit(audit: AdminAudit) { this.database.prepare(`INSERT INTO admin_audit_logs
    (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(audit.adminUserId, audit.action, audit.resourceType, String(audit.resourceId),
    audit.summary, audit.details ? JSON.stringify(audit.details) : null, audit.ipAddress || null, audit.userAgent || null); }
}
