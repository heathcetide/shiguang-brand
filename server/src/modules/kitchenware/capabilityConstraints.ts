import { kitchenwareAttributesSchema, kitchenwareCapabilityConstraintsSchema } from "@dietdigidose/contracts";

function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** Unknown or malformed conditions never grant a capability. Empty conditions need no attributes. */
export function satisfiesCapabilityConstraints(conditions: unknown, attributes: unknown): boolean {
  const constraint = kitchenwareCapabilityConstraintsSchema.safeParse(decode(conditions));
  if (!constraint.success) return false;
  const required = constraint.data;
  if (Object.keys(required).length === 0) return true;
  const specification = kitchenwareAttributesSchema.safeParse(decode(attributes));
  if (!specification.success) return false;
  const actual = specification.data;
  return (required.minCapacityMl === undefined || (actual.capacityMl != null && actual.capacityMl >= required.minCapacityMl))
    && (required.minDiameterCm === undefined || (actual.diameterCm != null && actual.diameterCm >= required.minDiameterCm))
    && (required.requiredFunctions === undefined || required.requiredFunctions.every(value => actual.functions?.includes(value) === true))
    && (required.heatSource === undefined || actual.heatSources?.includes(required.heatSource) === true);
}
