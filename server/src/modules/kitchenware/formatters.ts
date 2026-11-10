import { kitchenwareAttributesSchema } from "@dietdigidose/contracts";
import type { KitchenwareRequirement, Row } from "./types.js";

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === "object") return value as T;
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

export function formatRequirement(row: Row): KitchenwareRequirement {
  return {
    role: String(row.role),
    catalogId: row.catalog_id == null ? null : Number(row.catalog_id),
    catalogName: row.catalog_name == null ? null : String(row.catalog_name),
    capabilityCode: row.capability_code == null ? null : String(row.capability_code),
    confidence: Number(row.confidence),
    notes: String(row.notes || ""),
  };
}

export function formatCatalogItem(item: Row, capabilities: Row[], substitutions: Row[]): Row & {
  aliases: unknown[];
  cooking_methods: unknown[];
  attributes: Row;
  capabilities: Array<Row & { constraints: Row }>;
  substitutions: Array<Row & { impact: Row }>;
} {
  return {
    ...item,
    aliases: parseJson(item.aliases, []),
    cooking_methods: parseJson(item.cooking_methods, []),
    attributes: parseJson(item.attributes_json, {}),
    capabilities: capabilities.map((capability) => ({
      ...capability,
      constraints: parseJson(capability.constraints_json, {}),
      constraints_json: undefined,
    })),
    substitutions: substitutions.map((substitution) => ({
      ...substitution,
      impact: parseJson(substitution.impact_json, {}),
      impact_json: undefined,
    })),
  };
}

export function formatOwnedKitchenware(row: Row): Row & { attributes: import("@dietdigidose/contracts").KitchenwareAttributes } {
  const parsed = kitchenwareAttributesSchema.safeParse(parseJson(row.attributes_json,{}));
  return { ...row,attributes: parsed.success ? parsed.data : {} };
}
