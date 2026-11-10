import { z } from "zod";
export const kitchenwareFunctionSchema = z.enum(["convection", "temperature_control", "pressure_cooking", "pulse_blending"]);
export { kitchenwareFunctionLabels } from "./kitchenwareOptions.ts";
const functions = z.array(kitchenwareFunctionSchema).max(4).refine(values => new Set(values).size === values.length, "功能不能重复");
/** Omitted/null means unverified, never an inferred device specification. */
export const kitchenwareAttributesSchema = z.object({
  functions: functions.nullable().optional(),
  capacityMl: z.number().finite().positive().max(1_000_000).nullable().optional(),
  diameterCm: z.number().finite().positive().max(1_000).nullable().optional(),
  heatSources: z.array(z.enum(["gas","induction","electric"])).max(3)
    .refine(values => new Set(values).size === values.length,"热源不能重复").nullable().optional(),
}).strict();
export type KitchenwareAttributes = z.infer<typeof kitchenwareAttributesSchema>;

/** Conditions on a catalog capability. All conditions apply to one owned device. */
export const kitchenwareCapabilityConstraintsSchema = z.object({
  requiredFunctions: functions.optional(),
  minCapacityMl: z.number().finite().positive().max(1_000_000).optional(),
  minDiameterCm: z.number().finite().positive().max(1_000).optional(),
  heatSource: z.enum(["gas", "induction", "electric"]).optional(),
}).strict();
export type KitchenwareCapabilityConstraints = z.infer<typeof kitchenwareCapabilityConstraintsSchema>;
