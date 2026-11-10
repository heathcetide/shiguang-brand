import type Database from "better-sqlite3";
import type { KitchenwareRepository } from "./repository.js";
import type { Row, StoredKitchenwareInput } from "./types.js";

export class SqliteKitchenwareRepository implements KitchenwareRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async listItems(userId: number) { return this.database.prepare(`SELECT * FROM kitchenware_items WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC`).all(userId) as Row[]; }
  async listCatalog() { return this.database.prepare(`SELECT * FROM kitchenware_catalog WHERE quality_status = 'trusted' OR (source = 'concept_base' AND quality_status = 'reference')
    ORDER BY category, name`).all() as Row[]; }
  async listCapabilities() { return this.database.prepare("SELECT * FROM kitchenware_capabilities ORDER BY code").all() as Row[]; }
  async capabilitiesForCatalog(catalogId: number) { return this.database.prepare(`SELECT c.code, c.name, c.description, c.safety_level, cc.constraints_json
    FROM kitchenware_catalog_capabilities cc JOIN kitchenware_capabilities c ON c.code = cc.capability_code
    WHERE cc.catalog_id = ? ORDER BY c.code`).all(catalogId) as Row[]; }
  async substitutionsForCatalog(catalogId: number) { return this.database.prepare(`SELECT c.id, c.name, s.relation_type, s.impact_json, s.safety_note
    FROM kitchenware_substitutions s JOIN kitchenware_catalog c ON c.id = s.substitute_catalog_id
    WHERE s.source_catalog_id = ? ORDER BY CASE s.relation_type WHEN 'equivalent' THEN 0 WHEN 'conditional' THEN 1 ELSE 2 END, c.name`)
    .all(catalogId) as Row[]; }
  async recipeAvailable(recipeId: number) { return Boolean(this.database.prepare(`SELECT id FROM recipes
    WHERE id = ? AND deleted_at IS NULL AND status = 'approved'`).get(recipeId)); }
  async requirementsForRecipe(recipeId: number) { return this.database.prepare(`SELECT r.role, r.notes, r.confidence, r.capability_code,
    c.id AS catalog_id, c.name AS catalog_name FROM recipe_kitchenware_requirements r
    LEFT JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id = ?
    ORDER BY CASE r.role WHEN 'required' THEN 0 WHEN 'optional' THEN 1 ELSE 2 END, r.id`).all(recipeId) as Row[]; }
  async ownedItems(userId: number) { return this.database.prepare(`SELECT id, name, catalog_id, attributes_json FROM kitchenware_items
    WHERE user_id = ? AND deleted_at IS NULL AND status <> '维修中'`).all(userId) as Row[]; }
  async substitutionFor(sourceCatalogId: number, ownedCatalogIds: number[]) {
    if (!ownedCatalogIds.length) return null;
    const placeholders = ownedCatalogIds.map(() => "?").join(",");
    return (this.database.prepare(`SELECT s.relation_type, s.impact_json, s.safety_note, c.name
      FROM kitchenware_substitutions s JOIN kitchenware_catalog c ON c.id = s.substitute_catalog_id
      WHERE s.source_catalog_id = ? AND s.substitute_catalog_id IN (${placeholders}) AND s.relation_type <> 'forbidden'
      ORDER BY CASE s.relation_type WHEN 'equivalent' THEN 0 ELSE 1 END LIMIT 1`).get(sourceCatalogId, ...ownedCatalogIds) as Row | undefined) || null;
  }
  async findOwnedItem(userId: number, id: number) { return (this.database.prepare(`SELECT * FROM kitchenware_items
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).get(id, userId) as Row | undefined) || null; }
  async createItem(userId: number, input: StoredKitchenwareInput) {
    const result = this.database.prepare(`INSERT INTO kitchenware_items
      (user_id, name, original_name, catalog_id, category, status, note, image_url, purchase_date, attributes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, input.name, input.originalName, input.catalogId, input.category,
      input.status, input.note || null, input.imageUrl || null, input.purchaseDate || null,JSON.stringify(input.attributes ?? {}));
    return this.database.prepare("SELECT * FROM kitchenware_items WHERE id = ?").get(result.lastInsertRowid) as Row;
  }
  async updateItem(userId: number, id: number, input: StoredKitchenwareInput) {
    const result = this.database.prepare(`UPDATE kitchenware_items SET name = ?, original_name = ?, catalog_id = ?, category = ?,
      status = ?, note = ?, image_url = ?, purchase_date = ?, attributes_json = COALESCE(?,attributes_json), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).run(input.name, input.originalName, input.catalogId, input.category,
      input.status, input.note || null, input.imageUrl || null, input.purchaseDate || null,input.attributes === undefined ? null : JSON.stringify(input.attributes), id, userId);
    return result.changes ? this.findOwnedItem(userId, id) : null;
  }
  async maintainItem(userId: number, id: number) {
    const result = this.database.prepare(`UPDATE kitchenware_items SET status = '良好', last_maintained_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).run(id, userId);
    return result.changes ? this.findOwnedItem(userId, id) : null;
  }
  async removeItem(userId: number, id: number) { return this.database.prepare(`UPDATE kitchenware_items SET deleted_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).run(id, userId).changes === 1; }
  async upsertMappingReview(input: Parameters<KitchenwareRepository["upsertMappingReview"]>[0]) {
    this.database.prepare(`INSERT INTO kitchenware_mapping_reviews
      (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET raw_name = excluded.raw_name,
        confidence = excluded.confidence, suggested_catalog_id = excluded.suggested_catalog_id,
        status = 'pending', reviewed_at = NULL`).run(input.rawName, input.normalizedName, input.sourceType, input.sourceId,
      input.confidence, input.suggestedCatalogId);
  }
}
