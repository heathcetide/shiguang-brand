import { QuantityDecimal, QuantityPrecisionError } from "@dietdigidose/contracts/quantity-decimal";
import { nextQuantityEvidence } from "../modules/inventory/evidence.js";
import { appendSqliteMaintenanceEvent } from "../modules/planMaintenance/sqliteEventWriter.js";
import type Database from "better-sqlite3";

export const INVENTORY_UNITS = ["g", "kg", "ml", "l", "piece", "serving", "bag", "box", "bottle", "can"] as const;
export type InventoryUnit = typeof INVENTORY_UNITS[number];

type UnitDefinition = { family: string; factor: number; label: string };
const UNIT_DEFINITIONS: Record<InventoryUnit, UnitDefinition> = {
  g: { family: "mass", factor: 1, label: "g" },
  kg: { family: "mass", factor: 1000, label: "kg" },
  ml: { family: "volume", factor: 1, label: "ml" },
  l: { family: "volume", factor: 1000, label: "L" },
  piece: { family: "piece", factor: 1, label: "个" },
  serving: { family: "serving", factor: 1, label: "份" },
  bag: { family: "bag", factor: 1, label: "袋" },
  box: { family: "box", factor: 1, label: "盒" },
  bottle: { family: "bottle", factor: 1, label: "瓶" },
  can: { family: "can", factor: 1, label: "罐" },
};

export class InventoryQuantityError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryQuantityError";
    this.code = code;
  }
}

export type InventoryConsumption = {
  item_id: number;
  version: number;
  mode: "amount" | "all";
  amount_value?: number;
  unit?: InventoryUnit;
};

export type InventoryConsumptionState = {
  id: unknown;
  food_name: unknown;
  quantity: unknown;
  quantity_value: unknown;
  quantity_unit: unknown;
  is_available: unknown;
  version: unknown;
};

function displayQuantity(value: number, unit: InventoryUnit) {
  return QuantityDecimal.from(value).toString() + UNIT_DEFINITIONS[unit].label;
}

function convertDecimal(value: QuantityDecimal, from: InventoryUnit, to: InventoryUnit) {
  const source = UNIT_DEFINITIONS[from];
  const target = UNIT_DEFINITIONS[to];
  if (source.family !== target.family) {
    throw new InventoryQuantityError("INVENTORY_UNIT_MISMATCH", source.label + " 与 " + target.label + " 不能安全换算");
  }
  return value.shift(source.factor === target.factor ? 0 : source.factor > target.factor ? 3 : -3);
}

function quantityPrecisionError(error: unknown): never {
  if (error instanceof QuantityPrecisionError) {
    throw new InventoryQuantityError("QUANTITY_PRECISION_REQUIRED", error.message);
  }
  throw error;
}

/** Driver-neutral quantity transition used by SQLite and PostgreSQL adapters. */
export function calculateInventoryConsumption(item: InventoryConsumptionState, consumption: InventoryConsumption) {
  if (!item.is_available) {
    throw new InventoryQuantityError("INVENTORY_CONFLICT", "库存食材不存在、已用完或不属于当前账号");
  }
  if (Number(item.version) !== consumption.version) {
    throw new InventoryQuantityError("INVENTORY_VERSION_CONFLICT", "库存已在其他设备更新，请刷新后重试");
  }
  const storedValue = item.quantity_value == null ? null : Number(item.quantity_value);
  const storedUnit = typeof item.quantity_unit === "string" && INVENTORY_UNITS.includes(item.quantity_unit as InventoryUnit)
    ? item.quantity_unit as InventoryUnit
    : null;
  let amountUsed = storedValue;
  let remaining = 0;
  let available = false;
  if (consumption.mode === "amount") {
    if (storedValue === null || !storedUnit || !Number.isFinite(storedValue) || storedValue <= 0) {
      throw new InventoryQuantityError("STRUCTURED_QUANTITY_REQUIRED", `“${String(item.food_name)}”没有可安全部分扣减的结构化数量`);
    }
    if (!consumption.unit || !Number.isFinite(consumption.amount_value) || Number(consumption.amount_value) <= 0) {
      throw new InventoryQuantityError("INVALID_CONSUMPTION_AMOUNT", "扣减数量必须大于 0");
    }
    try {
      const used = convertDecimal(QuantityDecimal.from(Number(consumption.amount_value)), consumption.unit, storedUnit);
      const stored = QuantityDecimal.from(storedValue);
      if (used.compare(stored) > 0) {
        throw new InventoryQuantityError("INVENTORY_INSUFFICIENT", "“" + String(item.food_name) + "”的剩余数量不足");
      }
      amountUsed = used.toNumber();
      remaining = stored.subtract(used).toNumber();
    } catch (error) { quantityPrecisionError(error); }
    available = remaining > 0;
  }
  return {
    storedValue,
    storedUnit,
    amountUsed,
    remaining,
    available,
    nextQuantity: storedUnit && storedValue !== null ? displayQuantity(remaining, storedUnit) : String(item.quantity),
  };
}

export function applyInventoryConsumptions(
  database: Database.Database,
  userId: number,
  consumptions: InventoryConsumption[],
  options: { idempotencyKey: string; source: string; metadata?: Record<string, unknown> },
) {
  const select = database.prepare(`SELECT inventory_items.*,
    (SELECT metadata_json FROM inventory_change_logs e WHERE e.inventory_item_id=inventory_items.id
      AND e.user_id=inventory_items.user_id AND json_extract(e.metadata_json,'$.field_evidence.quantity.status') IS NOT NULL
      ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
    FROM inventory_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL`);
  const update = database.prepare(`
    UPDATE inventory_items SET quantity = ?, quantity_value = ?, is_available = ?,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ? AND is_available = 1 AND deleted_at IS NULL
  `);
  const log = database.prepare(`
    INSERT INTO inventory_change_logs
      (user_id, inventory_item_id, action, source, quantity_before, quantity_after,
       quantity_unit, delta_value, idempotency_key, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return consumptions.map((consumption, index) => {
    const item = select.get(consumption.item_id, userId) as Record<string, unknown> | undefined;
    if (!item || !item.is_available) {
      throw new InventoryQuantityError("INVENTORY_CONFLICT", "库存食材不存在、已用完或不属于当前账号");
    }
    const { storedValue, storedUnit, amountUsed, remaining, available, nextQuantity } =
      calculateInventoryConsumption(item as InventoryConsumptionState, consumption);
    const result = update.run(
      nextQuantity,
      storedValue === null ? null : remaining,
      available ? 1 : 0,
      consumption.item_id,
      userId,
      consumption.version,
    );
    if (result.changes !== 1) {
      throw new InventoryQuantityError("INVENTORY_VERSION_CONFLICT", "库存已变化，请刷新后重试");
    }
    log.run(
      userId,
      consumption.item_id,
      consumption.mode === "all" ? "consume_all" : "consume_partial",
      options.source,
      storedValue,
      storedValue === null ? null : remaining,
      storedUnit,
      amountUsed === null ? null : -amountUsed,
      `${options.idempotencyKey}:${consumption.item_id}:${index}`,
      JSON.stringify({ ...options.metadata, ...nextQuantityEvidence(item.quantity_evidence, consumption.version, consumption.version + 1, "preserve", storedValue !== null && storedUnit !== null) }),
    );
    appendSqliteMaintenanceEvent(database,{ userId,kind: "inventory_changed",sourceId: `consume:${options.idempotencyKey}:${consumption.item_id}:${index}`,
      subjectId: String(consumption.item_id),details: { version: consumption.version+1,mode: "consume" } });
    return {
      item_id: consumption.item_id,
      quantity_before: storedValue,
      quantity_after: storedValue === null ? null : remaining,
      quantity_unit: storedUnit,
      consumed_value: amountUsed,
      is_available: available,
      version: consumption.version + 1,
    };
  });
}

function normalizeFoodName(value: string) {
  return value.toLocaleLowerCase().replace(/[\s·、，,。()（）/\\_-]/g, "");
}

/** Shared by allocation and maintenance dependency tracking. */
export function inventoryFoodNamesMatch(left: string, right: string) {
  const a = normalizeFoodName(left);
  const b = normalizeFoodName(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

export function buildFefoConsumptionPreviewFromCandidates(
  inventory: Array<{
    quantity_evidence_status?: "known" | "estimated" | "unknown";
    id: unknown;
    food_name: unknown;
    quantity_value: unknown;
    quantity_unit: unknown;
    expiration_date: unknown;
    batch_code: unknown;
    version: unknown;
  }>,
  requests: Array<{ food_name: string; amount_value: number; unit: InventoryUnit }>,
  asOfDate?: string,
) {
  const available = new Map(inventory.map(item => [Number(item.id), Number(item.quantity_value)]));
  const zero = QuantityDecimal.from(0);
  return requests.map((request) => {
    const requested = QuantityDecimal.from(request.amount_value);
    let remaining = requested;
    let nameAvailable = false;
    let uncertainQuantity = false;
    // A request commits its temporary ledger only when its response is representable.
    const nextAvailable = new Map(available);
    const deductions: Array<Record<string, unknown>> = [];
    for (const item of inventory) {
      if (remaining.compare(zero) === 0) break;
      if (asOfDate && typeof item.expiration_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.expiration_date) && item.expiration_date < asOfDate) continue;
      if (!inventoryFoodNamesMatch(String(item.food_name), request.food_name)) continue;
      nameAvailable = true;
      if (item.quantity_evidence_status && item.quantity_evidence_status !== "known") { uncertainQuantity = true; continue; }
      const unit = item.quantity_unit as InventoryUnit | null;
      const value = nextAvailable.get(Number(item.id)) ?? 0;
      if (item.quantity_value == null || !unit || !INVENTORY_UNITS.includes(unit) || !Number.isFinite(value)) {
        uncertainQuantity = true;
        continue;
      }
      if (value <= 0) continue;
      try {
        const stored = QuantityDecimal.from(value);
        const availableInRequestUnit = convertDecimal(stored, unit, request.unit);
        const amount = remaining.compare(availableInRequestUnit) < 0 ? remaining : availableInRequestUnit;
        const allocated = convertDecimal(amount, request.unit, unit).toNumber();
        const rest = stored.subtract(QuantityDecimal.from(allocated)).toNumber();
        // Cooking clients combine all deductions for one batch into one write.
        QuantityDecimal.from(Number(item.quantity_value)).subtract(QuantityDecimal.from(rest)).toNumber();
        // Every emitted deduction can execute and conserves this batch's quantity.
        deductions.push({
          item_id: Number(item.id), version: Number(item.version), food_name: String(item.food_name),
          expiration_date: String(item.expiration_date), batch_code: item.batch_code ? String(item.batch_code) : null,
          mode: rest === 0 ? "all" : "amount", amount_value: allocated, unit,
        });
        nextAvailable.set(Number(item.id), rest);
        remaining = remaining.subtract(amount);
      } catch (error) {
        if (!(error instanceof QuantityPrecisionError) && !(error instanceof InventoryQuantityError)) throw error;
        uncertainQuantity = true;
      }
    }
    let missing: number;
    let covered: number;
    try {
      missing = remaining.toNumber();
      covered = requested.subtract(remaining).toNumber();
      for (const [id, value] of nextAvailable) available.set(id, value);
    } catch (error) {
      if (!(error instanceof QuantityPrecisionError)) throw error;
      // Do not claim a rounded partial allocation or reserve its stock for later requests.
      missing = request.amount_value;
      covered = 0;
      deductions.length = 0;
      uncertainQuantity = true;
    }
    const fullyCovered = missing === 0;
    return {
      food_name: request.food_name, requested_value: request.amount_value, unit: request.unit,
      covered_value: covered, missing_value: missing, fully_covered: fullyCovered,
      name_available: nameAvailable,
      quantity_status: fullyCovered ? "sufficient" as const : uncertainQuantity ? "unknown" as const
        : nameAvailable ? "insufficient" as const : "unavailable" as const,
      deductions,
    };
  });
}
