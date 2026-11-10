export function stringValue(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

export function nonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function nonNegativeInteger(value: unknown) {
  const parsed = nonNegativeNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

export function arrayValue(value: unknown, fallback: unknown[] = []) {
  return Array.isArray(value) ? value : fallback;
}

export function timestampMs(value: unknown) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  const normalized = String(value).replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
}

export const reversibleAgentActions = new Set([
  "add_inventory_item",
  "update_inventory_item",
  "create_meal_plan",
  "update_meal_plan",
  "add_shopping_items",
  "update_shopping_item",
]);

// Restore domain fields only; identity and the monotonic version never roll back.
export const inventoryUndoFields = ["food_name", "category", "quantity", "expiration_date", "storage_location", "image_url",
  "is_available", "quantity_value", "quantity_unit", "package_size_value", "package_size_unit", "batch_code"] as const;

/** Action IDs are not execution order; inventory versions are. */
export function inventoryUndoOrder<T extends { action_type: string; result_json: unknown }>(actions: T[]): T[] {
  const key = (action: T) => {
    if (!["add_inventory_item", "update_inventory_item"].includes(action.action_type)) return null;
    const result = typeof action.result_json === "string" ? JSON.parse(action.result_json) : action.result_json;
    const id = Number(result?.inventoryItemId);
    const version = Number(result?.item?.version);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(version) || version <= 0) throw new Error("库存操作缺少版本证据，无法安全撤销");
    return { id, version };
  };
  const reversed = [...actions].reverse();
  const groups = new Map<number, Array<{ action: T; version: number }>>();
  for (const action of reversed) {
    const metadata = key(action);
    if (metadata) {
      const group = groups.get(metadata.id) ?? [];
      group.push({ action, version: metadata.version }); groups.set(metadata.id, group);
    }
  }
  for (const group of groups.values()) group.sort((left, right) => right.version - left.version);
  return reversed.map(action => {
    const metadata = key(action);
    return metadata ? groups.get(metadata.id)!.shift()!.action : action;
  });
}

export class InventoryUndoVersions {
  private readonly chains = new Map<number, { stored: number; original: number }>();
  expected(id: unknown, version: unknown) {
    const previous = this.chains.get(Number(id));
    if (previous && previous.original !== Number(version)) throw new Error("库存修改之间有其他操作，无法安全撤销");
    return previous?.stored ?? Number(version);
  }
  restored(id: unknown, storedVersion: unknown, originalVersion: unknown) {
    const original = Number(originalVersion);
    if (!Number.isInteger(original) || original <= 0) throw new Error("缺少库存原始版本，无法安全撤销");
    this.chains.set(Number(id), { stored: Number(storedVersion) + 1, original });
  }
}
