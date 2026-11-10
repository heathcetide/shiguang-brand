import { createHash } from "node:crypto";
import { z } from "zod";
import { kitchenwareCapabilityConstraintsSchema } from "@dietdigidose/contracts";
import { AdminKitchenwareError } from "./errors.js";
import type { Row } from "./types.js";

export const capabilityUpdateSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  capabilities: z.array(z.object({ code: z.string().min(1).max(80), constraints: kitchenwareCapabilityConstraintsSchema }).strict()).max(100)
    .refine(rows => new Set(rows.map(row => row.code)).size === rows.length,"能力不能重复"),
}).strict();
export type CapabilityUpdate = z.infer<typeof capabilityUpdateSchema>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}
export function capabilityConfiguration(id: number, rows: Row[], available: Row[]) {
  const capabilities = rows.map(row => {
    let constraints: unknown = row.constraints_json;
    if (typeof constraints === "string") { try { constraints = JSON.parse(constraints); } catch { /* Keep malformed legacy data visible. */ } }
    return { code: String(row.capability_code), constraints };
  }).sort((a,b) => a.code.localeCompare(b.code));
  return { capabilities, available, token: createHash("sha256").update(JSON.stringify(canonical({ id,capabilities }))).digest("hex") };
}
export function assertCapabilityUpdate(id: number, rows: Row[], available: Row[], input: CapabilityUpdate) {
  if (capabilityConfiguration(id,rows,available).token !== input.token) throw new AdminKitchenwareError(409,"能力条件已变化，请重新加载后核对");
  if (input.capabilities.some(row => !available.some(item => item.code === row.code))) throw new AdminKitchenwareError(400,"包含未知能力");
}
