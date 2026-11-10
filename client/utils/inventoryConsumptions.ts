import { parseStructuredQuantity, structuredUnitLabel } from "@/utils/structuredQuantity";
import { addQuantityValues } from "@dietdigidose/contracts/quantity-decimal";
import type { InventoryConsumptionInput, InventoryConsumptionPreviewResponse } from "@dietdigidose/contracts";

type Deduction = InventoryConsumptionPreviewResponse["items"][number]["deductions"][number];

/** One API write per batch, retaining exact decimal amounts and only request fields. */
export function combineInventoryDeductions(deductions: Deduction[]): InventoryConsumptionInput["items"] {
  const combined = new Map<number, InventoryConsumptionInput["items"][number]>();
  for (const deduction of deductions) {
    const existing = combined.get(deduction.item_id);
    if (existing && existing.version !== deduction.version) throw new Error("库存已变化，请刷新后重试");
    if (!existing || deduction.mode === "all") {
      combined.set(deduction.item_id, deduction.mode === "all"
        ? { item_id: deduction.item_id, version: deduction.version, mode: "all" }
        : { item_id: deduction.item_id, version: deduction.version, mode: "amount",
          amount_value: deduction.amount_value, unit: deduction.unit });
    } else if (existing.mode === "amount") {
      if (existing.unit !== deduction.unit) throw new Error("同一库存批次的单位不一致，请刷新后重试");
      existing.amount_value = addQuantityValues(existing.amount_value!, deduction.amount_value);
    }
  }
  return [...combined.values()];
}


/** Keep unquantified ingredients visible instead of silently dropping their demand. */
export function ingredientConsumptionRequests(ingredients: { name: string; amount: string }[]) {
  const requests: { food_name: string; amount_value: number; unit: NonNullable<ReturnType<typeof parseStructuredQuantity>>["unit"] }[] = [];
  const unknown: string[] = [];
  for (const ingredient of ingredients) {
    const quantity = parseStructuredQuantity(ingredient.amount);
    if (quantity) requests.push({ food_name: ingredient.name, amount_value: quantity.amount, unit: quantity.unit });
    else unknown.push(ingredient.name);
  }
  return { requests, unknown };
}

export function inventoryPreviewWarnings(preview: InventoryConsumptionPreviewResponse, unknown: string[] = []) {
  return [...unknown.map(name => `${name}用量未知，请核对实际用量`), ...preview.items.filter(item => !item.fully_covered).map(item =>
    item.quantity_status === "unknown" ? `${item.food_name}库存数量或换算依据未知，请核对实际用量`
      : `${item.food_name}缺 ${item.missing_value}${structuredUnitLabel(item.unit)}`)];
}
