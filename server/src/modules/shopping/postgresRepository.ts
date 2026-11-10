import type { Pool } from "pg";
import type { ShoppingRepository } from "./repository.js";
import type { ShoppingItem, ShoppingItemInput, ShoppingItemUpdate } from "./types.js";

function timestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: Record<string, unknown>): ShoppingItem {
  return {
    id: String(row.id),
    ...(row.client_id ? { clientId: String(row.client_id) } : {}),
    name: String(row.name),
    amount: String(row.amount),
    category: String(row.category),
    checked: Boolean(row.checked),
    ...(row.purchase_date ? { purchaseDate: String(row.purchase_date) } : {}),
    ...(row.storage_location ? { storageLocation: String(row.storage_location) } : {}),
    version: Number(row.version),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export class PostgresShoppingRepository implements ShoppingRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async list(userId: number) {
    const result = await this.pool.query(`
      SELECT * FROM shopping_list_items
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY checked ASC, updated_at DESC
    `, [userId]);
    return result.rows.map(mapRow);
  }

  async create(id: string, userId: number, input: ShoppingItemInput) {
    const result = await this.pool.query(`
      INSERT INTO shopping_list_items
        (id, user_id, client_id, name, amount, category, checked, purchase_date, storage_location)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      id,
      userId,
      input.clientId || null,
      input.name,
      input.amount,
      input.category,
      input.checked,
      input.purchaseDate || null,
      input.storageLocation || null,
    ]);
    return mapRow(result.rows[0]!);
  }

  async update(id: string, userId: number, input: ShoppingItemUpdate) {
    const result = await this.pool.query(`
      UPDATE shopping_list_items SET
        name = COALESCE($1, name), amount = COALESCE($2, amount), category = COALESCE($3, category),
        checked = COALESCE($4, checked), purchase_date = COALESCE($5, purchase_date),
        storage_location = COALESCE($6, storage_location), version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND user_id = $8 AND version = $9 AND deleted_at IS NULL
      RETURNING *
    `, [
      input.name ?? null,
      input.amount ?? null,
      input.category ?? null,
      input.checked ?? null,
      input.purchaseDate ?? null,
      input.storageLocation ?? null,
      id,
      userId,
      input.version,
    ]);
    return result.rowCount === 1 ? mapRow(result.rows[0]!) : null;
  }

  async remove(id: string, userId: number) {
    const result = await this.pool.query(`
      UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP, version = version + 1
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    `, [id, userId]);
    return result.rowCount === 1;
  }

  async importItems(userId: number, items: Array<{ id: string; clientId: string; input: ShoppingItemInput }>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const { id, clientId, input } of items) {
        await client.query(`
          INSERT INTO shopping_list_items
            (id, user_id, client_id, name, amount, category, checked, purchase_date, storage_location)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
        `, [
          id,
          userId,
          clientId,
          input.name,
          input.amount,
          input.category,
          input.checked,
          input.purchaseDate || null,
          input.storageLocation || null,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
