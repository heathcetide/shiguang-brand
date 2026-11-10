import type { InventoryOutcome, InventoryOutcomeEvent } from "./types.js";

type Row = Record<string, unknown>;

function timestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value || "");
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`;
}

function parseObject(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
  } catch {
    return {};
  }
}

export function formatOutcomeEvent(row: Row): InventoryOutcomeEvent {
  return {
    id: String(row.id),
    traceType: "outcome",
    itemId: Number(row.inventory_item_id ?? row.household_inventory_item_id),
    foodName: String(row.food_name || "未知食材"),
    category: String(row.category || "其他"),
    outcome: String(row.outcome) as InventoryOutcome,
    source: String(row.source),
    quantityValue: row.quantity_value === null ? null : Number(row.quantity_value),
    quantityUnit: row.quantity_unit ? String(row.quantity_unit) : null,
    quantityText: row.quantity_text ? String(row.quantity_text) : null,
    expirationDate: row.expiration_date ? String(row.expiration_date) : null,
    occurredAt: timestamp(row.occurred_at),
    version: Number(row.version),
    corrected: Number(row.version) > 1,
  };
}

export function formatChangeEvent(row: Row): InventoryOutcomeEvent {
  const metadata = parseObject(row.metadata_json);
  return {
    id: `change:${row.id}`,
    traceType: "change_log",
    itemId: Number(row.inventory_item_id),
    foodName: String(row.food_name),
    category: String(row.category || "其他"),
    outcome: (row.source === "cooking" ? "cooked" : "used") as InventoryOutcome,
    source: metadata.recipeId ? "recommendation" : String(row.source || "manual"),
    quantityValue: row.delta_value === null ? null : Math.abs(Number(row.delta_value)),
    quantityUnit: row.quantity_unit ? String(row.quantity_unit) : null,
    quantityText: null,
    expirationDate: row.expiration_date ? String(row.expiration_date) : null,
    occurredAt: timestamp(row.created_at),
    version: 1,
    corrected: false,
  };
}
