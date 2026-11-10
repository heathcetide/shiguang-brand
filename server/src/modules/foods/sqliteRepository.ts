import type Database from "better-sqlite3";
import type { FoodRepository } from "./repository.js";
import type { CustomFoodCreateData, FoodLibraryRecord } from "./types.js";

export class SqliteFoodRepository implements FoodRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async findByBarcode(barcode: string) {
    const row = this.database.prepare(`
      SELECT id, name, category, image_url, brands, barcode, original_name
      FROM ingredients_library
      WHERE barcode = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(barcode) as FoodLibraryRecord | undefined;
    return row ?? null;
  }

  async searchTrusted(normalizedQuery: string, limit: number) {
    const pattern = `%${normalizedQuery}%`;
    return this.database.prepare(`
      SELECT DISTINCT i.id, i.name, i.category, i.calories_100g, i.protein_100g, i.carbs_100g, i.fat_100g,
        i.image_url, i.brands, i.barcode, i.micronutrients_json, i.source,
        i.quality_status, i.source_version, i.data_license, i.preparation_state,
        i.nutrition_basis, i.edible_ratio, i.nutrition_status, i.base_data_payload
      FROM ingredients_library i
      LEFT JOIN ingredient_aliases a ON a.ingredient_id = i.id
      WHERE i.deleted_at IS NULL
        AND (i.quality_status = 'trusted' OR (i.source = 'concept_base' AND i.quality_status = 'reference'))
        AND (i.normalized_name LIKE ? OR a.normalized_alias LIKE ? OR i.search_keywords LIKE ?)
      ORDER BY CASE WHEN i.normalized_name = ? THEN 0 WHEN a.normalized_alias = ? THEN 1 ELSE 2 END, i.id
      LIMIT ?
    `).all(pattern, pattern, pattern, normalizedQuery, normalizedQuery, limit) as FoodLibraryRecord[];
  }

  async recordSearchGap(normalizedQuery: string, sampleQuery: string) {
    this.database.prepare(`
      INSERT INTO ingredient_search_gaps (normalized_query, sample_query)
      VALUES (?, ?)
      ON CONFLICT(normalized_query) DO UPDATE SET
        hit_count = hit_count + 1,
        sample_query = excluded.sample_query,
        last_seen_at = CURRENT_TIMESTAMP
    `).run(normalizedQuery, sampleQuery.trim().slice(0, 80));
  }

  async createCustom(userId: number, input: CustomFoodCreateData) {
    const result = this.database.prepare(`
      INSERT INTO user_custom_foods
        (user_id, name, calories_100g, protein_100g, carbs_100g, fat_100g, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      userId,
      input.name,
      input.calories_100g,
      input.protein_100g,
      input.carbs_100g,
      input.fat_100g,
    );
    return Number(result.lastInsertRowid);
  }
}
