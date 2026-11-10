import type { Pool } from "pg";
import type { KitchenwareRepository } from "./repository.js";
import type { Row, StoredKitchenwareInput } from "./types.js";

export class PostgresKitchenwareRepository implements KitchenwareRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async listItems(userId: number) { return (await this.pool.query(`SELECT * FROM kitchenware_items WHERE user_id = $1 AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC`, [userId])).rows as Row[]; }
  async listCatalog() { return (await this.pool.query(`SELECT * FROM kitchenware_catalog WHERE quality_status = 'trusted' OR (source = 'concept_base' AND quality_status = 'reference')
    ORDER BY category, name`)).rows as Row[]; }
  async listCapabilities() { return (await this.pool.query("SELECT * FROM kitchenware_capabilities ORDER BY code")).rows as Row[]; }
  async capabilitiesForCatalog(catalogId: number) { return (await this.pool.query(`SELECT c.code, c.name, c.description, c.safety_level, cc.constraints_json
    FROM kitchenware_catalog_capabilities cc JOIN kitchenware_capabilities c ON c.code = cc.capability_code
    WHERE cc.catalog_id = $1 ORDER BY c.code`, [catalogId])).rows as Row[]; }
  async substitutionsForCatalog(catalogId: number) { return (await this.pool.query(`SELECT c.id, c.name, s.relation_type, s.impact_json, s.safety_note
    FROM kitchenware_substitutions s JOIN kitchenware_catalog c ON c.id = s.substitute_catalog_id
    WHERE s.source_catalog_id = $1 ORDER BY CASE s.relation_type WHEN 'equivalent' THEN 0 WHEN 'conditional' THEN 1 ELSE 2 END, c.name`,
  [catalogId])).rows as Row[]; }
  async recipeAvailable(recipeId: number) { return Boolean((await this.pool.query(`SELECT id FROM recipes
    WHERE id = $1 AND deleted_at IS NULL AND status = 'approved'`, [recipeId])).rows[0]); }
  async requirementsForRecipe(recipeId: number) { return (await this.pool.query(`SELECT r.role, r.notes, r.confidence, r.capability_code,
    c.id AS catalog_id, c.name AS catalog_name FROM recipe_kitchenware_requirements r
    LEFT JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id = $1
    ORDER BY CASE r.role WHEN 'required' THEN 0 WHEN 'optional' THEN 1 ELSE 2 END, r.id`, [recipeId])).rows as Row[]; }
  async ownedItems(userId: number) { return (await this.pool.query(`SELECT id, name, catalog_id, attributes_json FROM kitchenware_items
    WHERE user_id = $1 AND deleted_at IS NULL AND status <> '维修中'`, [userId])).rows as Row[]; }
  async substitutionFor(sourceCatalogId: number, ownedCatalogIds: number[]) {
    if (!ownedCatalogIds.length) return null;
    return ((await this.pool.query(`SELECT s.relation_type, s.impact_json, s.safety_note, c.name
      FROM kitchenware_substitutions s JOIN kitchenware_catalog c ON c.id = s.substitute_catalog_id
      WHERE s.source_catalog_id = $1 AND s.substitute_catalog_id = ANY($2::integer[]) AND s.relation_type <> 'forbidden'
      ORDER BY CASE s.relation_type WHEN 'equivalent' THEN 0 ELSE 1 END LIMIT 1`, [sourceCatalogId, ownedCatalogIds])).rows[0] as Row | undefined) || null;
  }
  async findOwnedItem(userId: number, id: number) { return ((await this.pool.query(`SELECT * FROM kitchenware_items
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [id, userId])).rows[0] as Row | undefined) || null; }
  async createItem(userId: number, input: StoredKitchenwareInput) { return (await this.pool.query(`INSERT INTO kitchenware_items
    (user_id, name, original_name, catalog_id, category, status, note, image_url, purchase_date, attributes_json)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING *`, [userId, input.name, input.originalName, input.catalogId,
    input.category, input.status, input.note || null, input.imageUrl || null, input.purchaseDate || null,JSON.stringify(input.attributes ?? {})])).rows[0] as Row; }
  async updateItem(userId: number, id: number, input: StoredKitchenwareInput) { return ((await this.pool.query(`UPDATE kitchenware_items
    SET name = $1, original_name = $2, catalog_id = $3, category = $4, status = $5, note = $6, image_url = $7,
      purchase_date = $8, attributes_json = COALESCE($11::jsonb,attributes_json), updated_at = CURRENT_TIMESTAMP WHERE id = $9 AND user_id = $10 AND deleted_at IS NULL RETURNING *`,
  [input.name, input.originalName, input.catalogId, input.category, input.status, input.note || null, input.imageUrl || null,
    input.purchaseDate || null, id, userId,input.attributes === undefined ? null : JSON.stringify(input.attributes)])).rows[0] as Row | undefined) || null; }
  async maintainItem(userId: number, id: number) { return ((await this.pool.query(`UPDATE kitchenware_items SET status = '良好',
    last_maintained_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *`, [id, userId])).rows[0] as Row | undefined) || null; }
  async removeItem(userId: number, id: number) { return (await this.pool.query(`UPDATE kitchenware_items SET deleted_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [id, userId])).rowCount === 1; }
  async upsertMappingReview(input: Parameters<KitchenwareRepository["upsertMappingReview"]>[0]) {
    await this.pool.query(`INSERT INTO kitchenware_mapping_reviews
      (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET raw_name = excluded.raw_name,
        confidence = excluded.confidence, suggested_catalog_id = excluded.suggested_catalog_id,
        status = 'pending', reviewed_at = NULL`, [input.rawName, input.normalizedName, input.sourceType, input.sourceId,
    input.confidence, input.suggestedCatalogId]);
  }
}
