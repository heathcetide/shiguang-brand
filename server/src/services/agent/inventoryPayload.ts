import { z } from "zod";
import {
  inventoryConsumptionSchema, inventoryCreateSchema, inventoryUpdateSchema, inventoryUnitSchema,
  type InventoryUnit, type InventoryUpdateData,
} from "@dietdigidose/contracts";
import { dateKeyAfterDays } from "../../utils/date.js";

const quantityLabels: Record<InventoryUnit, string> = {
  g: "g", kg: "kg", ml: "ml", l: "L", piece: "个", serving: "份", bag: "袋", box: "盒", bottle: "瓶", can: "罐",
};
const unitAliases: Record<string, InventoryUnit> = {
  克: "g", 千克: "kg", 公斤: "kg", 毫升: "ml", 升: "l", 个: "piece", 枚: "piece", 份: "serving",
  袋: "bag", 盒: "box", 瓶: "bottle", 罐: "can",
};

/** Preserve unknown quantities instead of interpreting a bag as a weight. */
function quantityInput(raw: Record<string, unknown>) {
  const value = raw.quantityValue ?? raw.quantity_value;
  const unit = raw.quantityUnit ?? raw.quantity_unit;
  if (value != null || unit != null) {
    const parsedValue = z.number().finite().positive().max(1_000_000).parse(value);
    const parsedUnit = inventoryUnitSchema.parse(unit);
    return { quantity: `${parsedValue}${quantityLabels[parsedUnit]}`, quantity_value: parsedValue, quantity_unit: parsedUnit };
  }
  if (raw.quantity === undefined) return {};
  const quantity = z.string().trim().min(1).max(40).parse(raw.quantity);
  const match = quantity.match(/^(\d+(?:\.\d+)?|半|一|二|两|三|四|五|六|七|八|九|十)\s*(kg|g|ml|l|千克|公斤|克|毫升|升|个|枚|份|袋|盒|瓶|罐)$/i);
  if (!match) return { quantity, quantity_value: null, quantity_unit: null };
  const numbers: Record<string, number> = { 半: 0.5, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const parsedValue = z.number().positive().max(1_000_000).parse(numbers[match[1]] ?? Number(match[1]));
  const parsedUnit = unitAliases[match[2]] ?? inventoryUnitSchema.parse(match[2].toLowerCase());
  return { quantity: `${parsedValue}${quantityLabels[parsedUnit]}`, quantity_value: parsedValue, quantity_unit: parsedUnit };
}

export function agentInventoryCreate(raw: Record<string, unknown>) {
  const days = z.coerce.number().int().min(0).max(3650).parse(raw.expireDays ?? 7);
  return inventoryCreateSchema.parse({
    food_name: raw.name ?? raw.foodName, category: raw.category ?? "其他",
    quantity: raw.quantity ?? "数量未知", ...quantityInput(raw),
    expiration_date: raw.expirationDate ?? dateKeyAfterDays(days), storage_location: raw.location ?? "冷藏",
    batch_code: raw.batchCode,
  });
}

export function agentInventoryUpdate(raw: Record<string, unknown>) {
  const itemId = z.number().int().positive().parse(raw.itemId);
  const version = z.number().int().positive("库存版本缺失，请刷新后确认").parse(raw.version);
  const fields: InventoryUpdateData = {};
  const mapping = { name: "food_name", category: "category", expirationDate: "expiration_date", location: "storage_location", isAvailable: "is_available", batchCode: "batch_code" } as const;
  for (const [key, target] of Object.entries(mapping)) if (raw[key] !== undefined) Object.assign(fields, { [target]: raw[key] });
  Object.assign(fields, quantityInput(raw));
  const patch = inventoryUpdateSchema.parse(fields);
  return { itemId, version, patch: { ...patch, version } };
}

export function agentInventoryConsumption(raw: Record<string, unknown>, idempotencyKey: string) {
  const reason = z.enum(["used", "discarded"]).parse(raw.reason ?? "used");
  // An old ID-only proposal cannot prove how much was used. Never silently turn it into all.
  if (!Array.isArray(raw.items)) throw new Error("请确认消耗的库存批次、数量或整项用完，以及当前版本");
  const items = raw.items.map(item => {
    const value = z.record(z.string(), z.unknown()).parse(item);
    if (value.mode === "all" && (value.amountValue != null || value.amount_value != null)) {
      throw new Error("部分数量与整项用完冲突，请确认实际消耗量");
    }
    return {
      item_id: value.itemId ?? value.item_id, version: value.version, mode: value.mode,
      amount_value: value.amountValue ?? value.amount_value, unit: value.unit,
    };
  });
  return { input: inventoryConsumptionSchema.parse({ idempotency_key: idempotencyKey, source: "ai", items }), reason };
}

export class InventoryActionClarificationError extends Error {}
