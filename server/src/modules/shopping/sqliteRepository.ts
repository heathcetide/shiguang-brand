import type Database from "better-sqlite3";
import type { ShoppingRepository } from "./repository.js";
import type { ShoppingItem, ShoppingItemInput, ShoppingItemUpdate } from "./types.js";

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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SqliteShoppingRepository implements ShoppingRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async list(userId: number) {
    const rows = this.database.prepare(`
      SELECT * FROM shopping_list_items
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY checked ASC, updated_at DESC
    `).all(userId) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  }

  async create(id: string, userId: number, input: ShoppingItemInput) {
    this.database.prepare(`
      INSERT INTO shopping_list_items
        (id, user_id, client_id, name, amount, category, checked, purchase_date, storage_location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      input.clientId || null,
      input.name,
      input.amount,
      input.category,
      input.checked ? 1 : 0,
      input.purchaseDate || null,
      input.storageLocation || null,
    );
    return mapRow(this.database.prepare("SELECT * FROM shopping_list_items WHERE id = ?").get(id) as Record<string, unknown>);
  }

  async update(id: string, userId: number, input: ShoppingItemUpdate) {
    const result = this.database.prepare(`
      UPDATE shopping_list_items SET
        name = COALESCE(?, name), amount = COALESCE(?, amount), category = COALESCE(?, category),
        checked = COALESCE(?, checked), purchase_date = COALESCE(?, purchase_date),
        storage_location = COALESCE(?, storage_location), version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL
    `).run(
      input.name ?? null,
      input.amount ?? null,
      input.category ?? null,
      input.checked === undefined ? null : input.checked ? 1 : 0,
      input.purchaseDate ?? null,
      input.storageLocation ?? null,
      id,
      userId,
      input.version,
    );
    if (result.changes !== 1) return null;
    return mapRow(this.database.prepare("SELECT * FROM shopping_list_items WHERE id = ?").get(id) as Record<string, unknown>);
  }

  async remove(id: string, userId: number) {
    const result = this.database.prepare(`
      UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP, version = version + 1
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(id, userId);
    return result.changes === 1;
  }

  async importItems(userId: number, items: Array<{ id: string; clientId: string; input: ShoppingItemInput }>) {
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO shopping_list_items
        (id, user_id, client_id, name, amount, category, checked, purchase_date, storage_location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.database.transaction(() => {
      for (const { id, clientId, input } of items) {
        insert.run(
          id,
          userId,
          clientId,
          input.name,
          input.amount,
          input.category,
          input.checked ? 1 : 0,
          input.purchaseDate || null,
          input.storageLocation || null,
        );
      }
    })();
  }
}
