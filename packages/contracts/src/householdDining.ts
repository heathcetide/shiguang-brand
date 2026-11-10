import { inventoryUnitSchema } from "./inventory.ts";
import { z } from "zod";
const names = z.array(z.string().trim().min(1).max(100)).max(50);
export const householdDiningPreferencesSchema = z.object({
  membershipId: z.number().int().positive(),version: z.number().int().positive(),shared: z.boolean(),
  allergies: names,restrictions: names,
}).strict();
export type HouseholdDiningPreferencesInput = z.infer<typeof householdDiningPreferencesSchema>;

const diningMemberIdentity = z.object({
  membershipId: z.number().int().positive(), userId: z.number().int().positive(),
  name: z.string(), version: z.number().int().positive(),
});
export const householdDiningMembersSchema = z.object({
  members: z.array(z.discriminatedUnion("shared", [
    diningMemberIdentity.extend({ shared: z.literal(false) }).strict(),
    diningMemberIdentity.extend({ shared: z.literal(true), allergies: names, restrictions: names }).strict(),
  ])),
}).strict();
export type HouseholdDiningMembers = z.infer<typeof householdDiningMembersSchema>;

const diningServings = z.number().finite().min(0.000001).max(30).refine(
  value => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 0.000001,
  "份量最多保留六位小数",
);
export const householdDiningAllocationSchema = z.object({
  planItem: z.object({ planId: z.string().min(1).max(100),itemId: z.string().min(1).max(100),version: z.number().int().positive() }).strict().optional(),
  recipeId: z.number().int().positive().optional(),
  participants: z.array(z.object({
    membershipId: z.number().int().positive(), version: z.number().int().positive(), servings: diningServings,
  }).strict()).min(1).max(30),
}).strict().superRefine((value,ctx) => {
  if (new Set(value.participants.map(item => item.membershipId)).size !== value.participants.length)
    ctx.addIssue({ code: "custom",path: ["participants"],message: "共餐成员不能重复" });
  if (value.participants.reduce((sum,item) => sum + Math.round(item.servings * 1_000_000),0) > 30_000_000)
    ctx.addIssue({ code: "custom",path: ["participants"],message: "单次共餐总份量不能超过30份" });
});
export type HouseholdDiningAllocationInput = z.infer<typeof householdDiningAllocationSchema>;
export const householdDiningSupplySchema = z.object({
  netShopping: z.object({ status: z.enum(["ready","needs_review"]),fingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),checks: z.array(z.string()),lines: z.array(z.object({ key: z.string(),name: z.string(),beforeAmount: z.string().nullable(),afterAmount: z.string().nullable() }).strict()) }).strict().optional(),
  status: z.enum(["known","needs_review"]),otherMealCount: z.number().int().nonnegative(),checks: z.array(z.string()),
  demands: z.array(z.object({ food_name: z.string(),amount_value: z.number().finite().positive(),unit: inventoryUnitSchema,
    covered: z.number().finite().nonnegative().nullable(),missing: z.number().finite().nonnegative().nullable(),
    shoppingCovered: z.number().finite().nonnegative().nullable(),unplanned: z.number().finite().nonnegative().nullable(),
  }).strict()),
}).strict();
export type HouseholdDiningSupply = z.infer<typeof householdDiningSupplySchema>;
export const householdDiningAllocationPreviewSchema = z.object({
  supply: householdDiningSupplySchema.optional(),
  householdId: z.number().int().positive(), totalServings: diningServings,
  planItem: z.object({ planId: z.string(),itemId: z.string(),version: z.number().int().positive(),plannedDate: z.string(),mealType: z.string(),title: z.string(),decision: z.enum(["apply","suggest","keep"]),applied: z.literal(false) }).strict().optional(),
  recipeCheck: z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),recipeId: z.number().int().positive(), title: z.string(),status: z.enum(["blocked","needs_review"]),
    materials: z.object({
      status: z.enum(["known","unknown"]),recipeYield: z.number().finite().positive().nullable(),
      demands: z.array(z.object({ food_name: z.string(),amount_value: z.number().finite().positive().max(1_000_000_000),unit: inventoryUnitSchema }).strict()),
    }).strict(),
    conflicts: z.array(z.object({ membershipId: z.number().int().positive(),constraint: z.string(),kind: z.enum(["allergy","restriction"]) }).strict()),
    checks: z.array(z.string()),
  }).strict().optional(),
  participants: z.array(diningMemberIdentity.extend({ shared: z.literal(true),allergies: names,restrictions: names,servings: diningServings }).strict()).min(1).max(30),
  allergies: z.array(z.string()).max(1500),restrictions: z.array(z.string()).max(1500),recipeValidationRequired: z.literal(true),
}).strict();
export type HouseholdDiningAllocationPreview = z.infer<typeof householdDiningAllocationPreviewSchema>;

export const householdMealProductionSchema = z.object({
  planItem: z.object({ planId: z.string().min(1).max(100),itemId: z.string().min(1).max(100),version: z.number().int().positive() }).strict().optional(),
  idempotencyKey: z.string().uuid(), membershipId: z.number().int().positive(),
  foodName: z.string().trim().min(1).max(120), producedServings: diningServings,
  inventory: z.array(z.object({ itemId: z.number().int().positive(),version: z.number().int().positive(),
    amount: z.number().finite().positive().max(1_000_000_000),unit: inventoryUnitSchema,
  }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.inventory.map(item => item.itemId)).size === value.inventory.length,"原料不能重复");
export type HouseholdMealProductionInput = z.infer<typeof householdMealProductionSchema>;

export const householdMealEatingSchema = z.object({
  idempotencyKey: z.string().uuid(),membershipId: z.number().int().positive(),version: z.number().int().positive(),
  servings: diningServings,
  recordedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  },"食用日期无效"),
  recordedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  mealType: z.enum(["breakfast","lunch","dinner","snack"]),
}).strict();
export type HouseholdMealEatingInput = z.infer<typeof householdMealEatingSchema>;

export const householdMealSchema = z.object({
  id: z.string().uuid(),householdId: z.number().int().positive(),foodName: z.string(),
  producedServings: diningServings,remainingServings: z.number().finite().min(0).max(30),
  version: z.number().int().positive(),repeated: z.boolean(),
  reservedServings: z.number().finite().min(0).max(30).optional(),
  myReservedServings: z.number().finite().min(0).max(30).optional(),
  availableServings: z.number().finite().min(0).max(30).optional(),
}).strict().refine(value => value.remainingServings <= value.producedServings,"剩余份量不能超过产出");
export const householdMealsSchema = z.array(householdMealSchema);
export const householdEatingResultSchema = z.object({ meal: householdMealSchema,dietRecordId: z.number().int().positive(),repeated: z.boolean() }).strict();
export type HouseholdMeal = z.infer<typeof householdMealSchema>;

export const householdMealReservationSchema = z.object({
  membershipId: z.number().int().positive(),version: z.number().int().positive(),
  servings: z.union([z.literal(0),diningServings]),
}).strict();
export type HouseholdMealReservationInput = z.infer<typeof householdMealReservationSchema>;

export const householdMealReservationResultSchema = z.object({ version: z.number().int().positive(),myReservedServings: z.number().finite().min(0).max(30) }).strict();


export const householdDiningPlanSchema = z.object({
  householdId: z.number().int().positive(),
  participants: z.array(z.object({ membershipId: z.number().int().positive(),version: z.number().int().positive(),servings: diningServings }).strict()).min(1).max(30),
  constraintsReviewed: z.literal(true),
}).strict().superRefine((value,ctx) => {
  if (new Set(value.participants.map(item => item.membershipId)).size !== value.participants.length)
    ctx.addIssue({ code: "custom",message: "参与成员不能重复" });
  if (value.participants.reduce((sum,item) => sum+Math.round(item.servings*1_000_000),0)>30_000_000)
    ctx.addIssue({ code: "custom",message: "单次共餐总份量不能超过30份" });
});
export type HouseholdDiningPlan = z.infer<typeof householdDiningPlanSchema>;
