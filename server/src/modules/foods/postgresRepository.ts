import type { Pool, QueryResultRow } from "pg";
import type { FoodRepository } from "./repository.js";
import type { CustomFoodCreateData, FoodLibraryRecord } from "./types.js";

function foodRecord(row: QueryResultRow): FoodLibraryRecord {
  const { search_rank: _searchRank, ...record } = row;
  const result = {
    ...record,
    id: Number(row.id),
    name: String(row.name),
    category: row.category == null ? null : String(row.category),
    image_url: row.image_url == null ? null : String(row.image_url),
    brands: row.brands == null ? null : String(row.brands),
    barcode: row.barcode == null ? null : String(row.barcode),
  } as FoodLibraryRecord;
  for (const key of ["calories_100g", "protein_100g", "carbs_100g", "fat_100g", "edible_ratio"] as const) {
    if (Object.prototype.hasOwnProperty.call(row, key)) result[key] = row[key] == null ? null : Number(row[key]);
  }
  return result;
}

export class PostgresFoodRepository implements FoodRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findByBarcode(barcode: string) {
    const result = await this.pool.query(`
      SELECT id, name, category, image_url, brands, barcode, original_name
      FROM ingredients_library
      WHERE barcode = $1 AND deleted_at IS NULL
      LIMIT 1
    `, [barcode]);
    return result.rows[0] ? foodRecord(result.rows[0]) : null;
  }

  async searchTrusted(normalizedQuery: string, limit: number) {
    const pattern = `%${normalizedQuery}%`;
    const result = await this.pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (i.id)
          i.id, i.name, i.category, i.calories_100g, i.protein_100g, i.carbs_100g, i.fat_100g,
          i.image_url, i.brands, i.barcode, i.micronutrients_json, i.source,
          i.quality_status, i.source_version, i.data_license, i.preparation_state,
          i.nutrition_basis, i.edible_ratio, i.nutrition_status, i.base_data_payload,
          CASE WHEN i.normalized_name = $2 THEN 0 WHEN a.normalized_alias = $2 THEN 1 ELSE 2 END AS search_rank
        FROM ingredients_library i
        LEFT JOIN ingredient_aliases a ON a.ingredient_id = i.id
        WHERE i.deleted_at IS NULL
          AND (i.quality_status = 'trusted' OR (i.source = 'concept_base' AND i.quality_status = 'reference'))
          AND (i.normalized_name LIKE $1 OR a.normalized_alias LIKE $1 OR i.search_keywords LIKE $1)
        ORDER BY i.id, search_rank
      ) ranked_foods
      ORDER BY search_rank, id
      LIMIT $3
    `, [pattern, normalizedQuery, limit]);
    return result.rows.map(foodRecord);
  }

  async recordSearchGap(normalizedQuery: string, sampleQuery: string) {
    await this.pool.query(`
      INSERT INTO ingredient_search_gaps (normalized_query, sample_query)
      VALUES ($1, $2)
      ON CONFLICT(normalized_query) DO UPDATE SET
        hit_count = ingredient_search_gaps.hit_count + 1,
        sample_query = EXCLUDED.sample_query,
        last_seen_at = CURRENT_TIMESTAMP
    `, [normalizedQuery, sampleQuery.trim().slice(0, 80)]);
  }

  async createCustom(userId: number, input: CustomFoodCreateData) {
    const result = await this.pool.query<{ id: number }>(`
      INSERT INTO user_custom_foods
        (user_id, name, calories_100g, protein_100g, carbs_100g, fat_100g, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING id
    `, [
      userId,
      input.name,
      input.calories_100g,
      input.protein_100g,
      input.carbs_100g,
      input.fat_100g,
    ]);
    return Number(result.rows[0]!.id);
  }
}
