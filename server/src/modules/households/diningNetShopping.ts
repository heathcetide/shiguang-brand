import { createHash } from "node:crypto";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { diningSupply } from "./diningSupply.js";

type Snapshot = Parameters<typeof diningSupply>[0];
type Line = { key: string; name: string; beforeAmount: string | null; afterAmount: string | null };
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}
export function diningNetShopping(snapshot: Snapshot) {
  const existing = (snapshot.shopping ?? []).filter(row => String(row.source_plan_item_id)===snapshot.targetId);
  const checks: string[] = [];
  if (existing.some(row => row.checked || row.transferred_at || row.deleted_at || row.source_demand_key == null || row.source_generated_version == null || Number(row.version)!==Number(row.source_generated_version)))
    checks.push("这餐的来源采购已购买、入库、删除或手动修改，请先核对家庭清单");
  const supply = diningSupply({ ...snapshot,shopping: (snapshot.shopping ?? []).filter(row => String(row.source_plan_item_id)!==snapshot.targetId) });
  checks.push(...supply.checks);
  const lines: Line[] = [];
  if (checks.length || supply.status!=="known") return { status: "needs_review" as const,fingerprint: null,lines,checks };
  const units: Record<string,string> = { piece: '个',serving: '份',bag: '袋',box: '盒',bottle: '瓶',can: '罐' };
  const desired = new Map<string,{ name: string; amount: number; unit: string }>();
  for (const demand of supply.demands) {
    if (demand.unplanned == null) return { status: "needs_review" as const,fingerprint: null,lines: [],checks: ["尚未安排量不确定，请重新核对"] };
    const key = JSON.stringify([demand.food_name.trim().toLocaleLowerCase(),demand.unit]);
    const amount = Math.round(((desired.get(key)?.amount ?? 0)+demand.unplanned)*1_000_000)/1_000_000;
    desired.set(key,{ name: demand.food_name,amount,unit: demand.unit });
  }
  const keys = [...new Set([...desired.keys(),...existing.map(row => String(row.source_demand_key))])].sort();
  for (const key of keys) {
    const previous = existing.find(row => row.source_demand_key===key);
    const next = desired.get(key);
    if (!previous && !next?.amount) continue;
    lines.push({ key,name: next?.name ?? String(previous!.name),beforeAmount: previous ? String(previous.amount) : null,
      afterAmount: next?.amount ? `${next.amount}${units[next.unit] ?? next.unit}` : null });
  }
  const sorted = (rows: Snapshot['plans']) => [...rows].sort((a,b) => String(a.id).localeCompare(String(b.id)));
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical({ ...snapshot,plans: sorted(snapshot.plans),inventory: sorted(snapshot.inventory),shopping: sorted(snapshot.shopping ?? []) }))).digest("hex");
  return { status: "ready" as const,fingerprint,lines,checks: [] };
}
export function prepareNetDiningShopping(snapshot: Snapshot,fingerprint: string) {
  const proposal = diningNetShopping(snapshot);
  if (proposal.status!=="ready" || proposal.fingerprint!==fingerprint)
    throw new InventoryQuantityError("DINING_SUPPLY_CHANGED","库存、餐次或清单已变化，请重新预览净采购调整");
  return proposal.lines.flatMap(line => line.afterAmount===null ? [] : [{ key: line.key,name: line.name,amount: line.afterAmount }]);
}
