import type { CoreLoopFact } from "./coreLoopMetric.js";
import type { Row } from "./types.js";
import { consumeProductionItem } from "../households/production.js";
import { INVENTORY_UNITS, type InventoryUnit } from "../../services/inventoryQuantity.js";
export type CoreLoopDataset = { productions: Row[]; intakes: Row[]; logs: Row[]; legacy: Row[]; shared: Row[]; settings: Row };
export function object(value: unknown): Row {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function array(value: unknown): Row[] { return Array.isArray(value) ? value.filter(item => item && typeof item === "object") : []; }
export function utc(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return "";
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value) ? value.replace(" ","T") + "Z" : value;
}
const actor = (value: unknown) => `user:${Number(value)}`;
function actorClass(value: unknown): CoreLoopFact["actorClass"] { return ["real","test","automation","demo"].includes(String(value)) ? value as CoreLoopFact["actorClass"] : "unknown"; }
const amount = (value: unknown) => value == null ? null : Number(value);
const isStrictNumeric = (value: unknown): value is number | string => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return /^\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*$/.test(value) && Number.isFinite(Number(value));
  return false;
};
export function projectCoreLoops(data: CoreLoopDataset): CoreLoopFact[] {
  const facts: CoreLoopFact[] = data.productions.map(row => {
    const result = object(row.result_json), selection = object(result.selection_evidence), inventory = object(selection.inventory);
    const allocations = array(inventory.allocations), changes = array(result.inventory_consumption_changes);
    const logs = data.logs.filter(log => Number(log.user_id) === Number(row.user_id));
    const intakes = data.intakes.filter(item => item.prepared_meal_id === row.id);
    return {
      productionId: String(row.id), actorKey: actor(row.user_id), producerKey: actor(row.user_id), actorClass: actorClass(row.kind),
      environment: typeof result.metric_environment === "string" ? result.metric_environment : "unknown", scope: "personal" as const,
      producedAt: utc(row.produced_at), recipeId: row.recipe_id == null ? null : Number(row.recipe_id),
      selection: selection.version === 1 ? { requestId: String(selection.requestId || ""), recipeId: Number(selection.recipeId),
        selectedAt: utc(selection.selectedAt ?? row.selection_created_at), matchedItemIds: inventory.version === 1 ? allocations.map(item => Number(item.itemId)) : null } : null,
      stock: logs.filter(log => log.action === "created").map(log => ({ itemId: Number(log.inventory_item_id), confirmedAt: utc(log.created_at),
        confirmed: log.acceptance === "manual" || (log.source === "manual" && log.acceptance == null), scope: "personal" as const, ownerKey: actor(log.user_id) })),
      deductions: changes.map((change,index) => {
        const log = logs.find(log => log.idempotency_key === `cooking:${row.idempotency_key}:${change.item_id}:${index}` && Number(log.inventory_item_id) === Number(change.item_id)
          && log.source === "cooking" && ["consume_all","consume_partial"].includes(String(log.action)));
        return { itemId: Number(change.item_id), before: amount(change.quantity_before), after: amount(change.quantity_after), amount: amount(change.consumed_value),
          verified: Boolean(log && amount(log.quantity_before) === amount(change.quantity_before) && amount(log.quantity_after) === amount(change.quantity_after)
            && amount(log.delta_value) !== null && Math.abs(-Number(log.delta_value) - Number(change.consumed_value)) < 0.000001) };
      }),
      intake: intakes.map(item => ({ recordId: String(item.diet_record_id || ""), actorKey: actor(item.user_id), servings: Number(item.servings),
        committedAt: utc(item.created_at), survivesCorrection: Boolean(item.record_exists) && !item.corrected })),
    };
  });
  // Legacy successful completions have intake evidence but no verified selection chain.
  for (const row of data.legacy) facts.push({ productionId: `legacy:${row.id}`, actorKey: actor(row.user_id), producerKey: actor(row.user_id),
    actorClass: actorClass(row.kind), environment: typeof row.metric_environment === "string" && row.metric_environment ? row.metric_environment : (typeof data.settings?.environment === "string" && data.settings.environment ? data.settings.environment : "unknown"), scope: "personal",
    producedAt: utc(row.created_at), recipeId: row.recipe_id == null ? null : Number(row.recipe_id), selection: null, stock: [], deductions: [],
    intake: [{ recordId: String(row.diet_record_id), actorKey: actor(row.user_id), servings: 1, committedAt: utc(row.created_at), survivesCorrection: Boolean(row.record_exists) }] });
  const sharedFacts = new Map<string, CoreLoopFact>();
  for (const row of data.shared) {
    const key = `household:${row.id}`;
    let fact = sharedFacts.get(key);
    if (!fact) {
      const householdKey = row.household_id ? `household:${row.household_id}` : (row.householdKey ? String(row.householdKey) : undefined);
      const request = object(row.request_json);
      const rawInventory = Array.isArray(row.inventory_json)
        ? row.inventory_json
        : (typeof row.inventory_json === "string" ? (() => { try { const parsed = JSON.parse(row.inventory_json); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })() : array(row.inventory_json));

      const rawSelection = row.selection ? object(row.selection) : (row.selection_evidence ? object(row.selection_evidence) : null);
      const inventory = rawSelection ? object(rawSelection.inventory) : null;
      const allocations = inventory ? array(inventory.allocations) : [];
      const recipeId = row.recipe_id == null ? (row.recipeId == null ? null : Number(row.recipeId)) : Number(row.recipe_id);

      let selection: CoreLoopFact["selection"] = null;
      if (rawSelection && rawSelection.version === 1) {
        selection = {
          requestId: String(rawSelection.requestId || ""),
          recipeId: Number(rawSelection.recipeId ?? recipeId),
          selectedAt: utc(rawSelection.selectedAt ?? row.selection_created_at ?? row.produced_at),
          matchedItemIds: inventory && inventory.version === 1
            ? allocations.map(item => Number(item.itemId))
            : (Array.isArray(rawSelection.matchedItemIds) ? rawSelection.matchedItemIds.map(Number) : null),
        };
      }

      const stock: CoreLoopFact["stock"] = Array.isArray(row.stock) ? row.stock.map(item => ({
        itemId: Number(item.itemId),
        confirmedAt: utc(item.confirmedAt),
        confirmed: Boolean(item.confirmed),
        scope: "household" as const,
        ownerKey: String(item.ownerKey || householdKey || ""),
      })) : [];

      const deductions: CoreLoopFact["deductions"] = Array.isArray(row.deductions) ? row.deductions.map(item => ({
        itemId: Number(item.itemId),
        before: amount(item.before),
        after: amount(item.after),
        amount: amount(item.amount),
        verified: Boolean(item.verified),
      })) : (Array.isArray(rawInventory) ? rawInventory.map((item: Row) => {
        const itemId = Number(item.itemId ?? item.item_id);
        if (isStrictNumeric(item.before) && isStrictNumeric(item.after)) {
          const b = Number(item.before);
          const a = Number(item.after);
          const amt = isStrictNumeric(item.amount) ? Number(item.amount) : null;
          return {
            itemId,
            before: b,
            after: a,
            amount: amt,
            verified: item.verified !== false && amt !== null && amt > 0 && b > a && a >= 0 && Math.abs(b - a - amt) < 0.000001,
          };
        }
        if (typeof item.before === "string" && typeof item.after === "string") {
          const unit = typeof item.unit === "string" && (INVENTORY_UNITS as readonly string[]).includes(item.unit)
            ? (item.unit as InventoryUnit)
            : undefined;
          if (unit && typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0) {
            try {
              const foodName = typeof item.foodName === "string" ? item.foodName : (typeof item.food_name === "string" ? item.food_name : "");
              const consumed = consumeProductionItem(
                { id: itemId, food_name: foodName, quantity: item.before, is_available: true, version: Number(item.version ?? 1) },
                { itemId, version: Number(item.version ?? 1), amount: item.amount, unit }
              );
              if (consumed.nextQuantity === item.after.trim()) {
                const b = consumed.storedValue;
                const a = consumed.remaining;
                const amt = consumed.amountUsed;
                return {
                  itemId,
                  before: b,
                  after: a,
                  amount: amt,
                  verified: item.verified !== false && b !== null && a !== null && amt !== null && b > a && a >= 0 && Math.abs(b - a - amt) < 0.000001,
                };
              }
            } catch {
              // Replay failed; fall through to unverified result
            }
          }
        }
        return {
          itemId,
          before: amount(item.before),
          after: amount(item.after),
          amount: typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : null,
          verified: false,
        };
      }) : []);

      const environment = (typeof row.metric_environment === "string" && row.metric_environment)
        || (typeof request.metric_environment === "string" && request.metric_environment)
        || (typeof data.settings?.environment === "string" && data.settings.environment)
        || "unknown";

      fact = {
        productionId: key,
        actorKey: actor(row.created_by_user_id),
        producerKey: actor(row.created_by_user_id),
        actorClass: actorClass(row.kind),
        environment,
        scope: "household",
        householdKey,
        producedAt: utc(row.produced_at),
        recipeId,
        selection,
        stock,
        deductions,
        intake: [],
      };
      sharedFacts.set(key, fact);
    }
    const dinerKey = actor(row.diner_user_id ?? row.user_id ?? row.created_by_user_id);
    fact.intake.push({
      recordId: String(row.diet_record_id),
      actorKey: dinerKey,
      servings: Number(row.servings),
      committedAt: utc(row.intake_at),
      survivesCorrection: row.survivesCorrection !== false && !row.corrected,
    });
  }
  facts.push(...sharedFacts.values());
  return facts;
}

export function coreLoopInventoryIds(productions: Row[]): number[] {
  return [...new Set(productions.flatMap(row => {
    const result = object(row.result_json), selection = object(result.selection_evidence);
    return [...array(object(selection.inventory).allocations).map(item => Number(item.itemId)), ...array(result.inventory_consumption_changes).map(item => Number(item.item_id))];
  }).filter(id => Number.isSafeInteger(id) && id > 0))];
}
