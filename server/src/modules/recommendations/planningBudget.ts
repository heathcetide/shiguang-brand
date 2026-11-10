import { QuantityDecimal, QuantityPrecisionError, subtractQuantityValues } from "@dietdigidose/contracts/quantity-decimal";
import type { WeeklyPlanPreview } from "@dietdigidose/contracts";
import { recipeDemands } from "./quantities.js";
import { unexpiredInventory } from "./inventoryAvailability.js";
import { buildFefoConsumptionPreviewFromCandidates } from "../../services/inventoryQuantity.js";
import { ingredient, parseJson } from "../mealPlans/formatters.js";
import type { Row } from "./types.js";
const canonicalUnit = (unit: string) => ({ unit: unit === "kg" ? "g" : unit === "l" ? "ml" : unit, factor: unit === "kg" || unit === "l" ? 1000 : 1 });

/** A disposable stock ledger: prior commitments are reserved before new meals. */
export function createPlanningBudget(inventory: Row[], existing: Row[] = [], shoppingWindow?: { startDate: string; endDate: string }) {
  const stock = inventory.map(item => ({ ...item }));
  let unknownCommitment = false;
  const checks = new Set<string>();
  const aggregate = new Map<string,WeeklyPlanPreview["shopping"][number]>();
  const totals = new Map<string, { required: QuantityDecimal; covered: QuantityDecimal; missing: QuantityDecimal }>();
  const consume = (demands: NonNullable<ReturnType<typeof recipeDemands>>, date: string, mealId: string) => {
    const available = unexpiredInventory(unknownCommitment ? [] : stock,date).map(item => ({ id: Number(item.id), food_name: String(item.food_name),quantity_value: item.quantity_value as number | null,quantity_unit: item.quantity_unit as string | null,expiration_date: String(item.expiration_date ?? ""),version: Number(item.version),batch_code: item.batch_code as string | null,quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined }));
    const preview = buildFefoConsumptionPreviewFromCandidates(available,demands);
    for (const [index,part] of preview.entries()) {
      if (unknownCommitment) part.quantity_status = "unknown";
      const requested = demands[index].amount_value;
      if (!shoppingWindow || (date >= shoppingWindow.startDate && date <= shoppingWindow.endDate)) {
        const normalized = canonicalUnit(part.unit);
        const key = `${part.food_name.trim().toLocaleLowerCase()}:${normalized.unit}`;
        const entry = aggregate.get(key) ?? { foodName: part.food_name,unit: normalized.unit,uncertain: false,required: 0,covered: 0,missing: 0,sources: [] };
        entry.uncertain ||= part.quantity_status === "unknown";
        const shift = normalized.factor === 1000 ? 3 : 0;
        const required = QuantityDecimal.from(requested).shift(shift);
        const covered = QuantityDecimal.from(part.covered_value).shift(shift);
        const missing = QuantityDecimal.from(part.missing_value).shift(shift);
        const old = totals.get(key);
        const next = {
          required: old ? old.required.add(required) : required,
          covered: old ? old.covered.add(covered) : covered,
          missing: old ? old.missing.add(missing) : missing,
        };
        totals.set(key, next);
        const display = (value: QuantityDecimal) => {
          try { return value.toNumber(); }
          catch (error) {
            if (!(error instanceof QuantityPrecisionError)) throw error;
            // Only the informational aggregate may approximate; its uncertainty
            // prevents it from certifying coverage or an automatic shopping amount.
            entry.uncertain = true;
            checks.add(part.food_name + " 的汇总用量超出显示精度，请核对采购缺口");
            return Number(value.toString());
          }
        };
        entry.required = display(next.required);
        entry.covered = display(next.covered);
        entry.missing = display(next.missing);
        entry.sources.push({ mealId, required: display(required), missing: display(missing) });
        aggregate.set(key,entry);
      }
      if (part.quantity_status === "unknown") checks.add(`${part.food_name} 的数量或规格无法换算，请核对采购缺口`);
      for (const deduction of part.deductions) {
        const item = stock.find(value => Number(value.id) === deduction.item_id);
        if (item) item.quantity_value = subtractQuantityValues(Number(item.quantity_value), Number(deduction.amount_value));
      }
    }
    return preview;
  };
  const commitmentPreviews = new Map<string,ReturnType<typeof consume>>();
  // An existing item's captured ingredients are its committed quantities. Missing
  // quantities cannot be guessed from a recipe or silently reused by another meal.
  for (const item of existing) {
    if (item.prepared_only || ["completed","skipped"].includes(String(item.status))) continue;
    const ingredients = parseJson<unknown[]>(item.ingredients_json,[]).map(ingredient).filter((value): value is NonNullable<ReturnType<typeof ingredient>> => Boolean(value));
    const demands = recipeDemands(ingredients,1,1);
    if (!demands) { unknownCommitment = true; checks.add(`已有安排「${item.title}」缺少明确原料用量，需先核对，未重复分配库存`); continue; }
    commitmentPreviews.set(String(item.id),consume(demands,String(item.planned_date),String(item.id)));
  }
  return { stock,checks,aggregate,consume,commitmentPreviews,markUnknownCommitment: () => { unknownCommitment = true; },get unknownCommitment() { return unknownCommitment; } };
}
