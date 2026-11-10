import type { Row } from "./types.js";

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase().replace(/\([^)]*\)|（[^）]*）/g, "").replace(/[\d\s.,，。克千毫升斤个只颗片份盒包袋瓶罐根勺]/g, "");
}

function text(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }

export function formatShoppingItem(row: Row) {
  return {
    id: String(row.id), householdId: Number(row.household_id), name: String(row.name), amount: String(row.amount),
    category: String(row.category), checked: Boolean(row.checked),
    storageLocation: row.storage_location ? String(row.storage_location) : null,
    expirationDate: row.expiration_date ? String(row.expiration_date) : null,
    createdByUserId: Number(row.created_by_user_id), updatedByUserId: Number(row.updated_by_user_id),
    purchasedByUserId: row.purchased_by_user_id === null ? null : Number(row.purchased_by_user_id),
    creatorName: String(row.creator_name), updaterName: String(row.updater_name),
    purchaserName: row.purchaser_name ? String(row.purchaser_name) : null,
    version: Number(row.version), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

export function formatInventory(row: Row): Row & { is_available: boolean } {
  return { ...row, is_available: Boolean(row.is_available) };
}
