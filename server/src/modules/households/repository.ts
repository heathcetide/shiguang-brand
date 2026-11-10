import type {
  IntakeRepositoryResult, InventoryCreateInput, InventoryMutationResult, InventoryUpdateInput, JoinResult,
  LeaveResult, Row, ShoppingCreateInput, ShoppingCreateResult, ShoppingDeleteResult, ShoppingIntakeInput,
  ShoppingMutationResult, ShoppingUpdateInput, TransferResult,
} from "./types.js";

export interface HouseholdsRepository {
  diningSupply(userId: number,householdId: number,target: { planId: string; itemId: string; version: number },totalServings: number,recipeFingerprint: string): Promise<import("@dietdigidose/contracts").HouseholdDiningSupply>;
  diningPlanContext(userId: number,planId: string,itemId: string): Promise<{ item: Row; queue?: Row; purchases: Row[] } | null>;
  reserveMeal(userId: number,householdId: number,mealId: string,input: import("@dietdigidose/contracts").HouseholdMealReservationInput): Promise<Row>;
  meals(userId: number,householdId: number): Promise<Row[]>;
  eatMeal(userId: number,householdId: number,mealId: string,input: import("@dietdigidose/contracts").HouseholdMealEatingInput): Promise<Row>;
  produceMeal(userId: number, householdId: number, input: import("@dietdigidose/contracts").HouseholdMealProductionInput): Promise<Row>;
  diningRecipe(recipeId: number): Promise<Row | null>;
  diningMembers(userId: number, householdId: number): Promise<Row[]>;
  diningPreferences(userId: number, householdId: number): Promise<Row | null>;
  saveDiningPreferences(userId: number, householdId: number, input: import("@dietdigidose/contracts").HouseholdDiningPreferencesInput): Promise<boolean>;

  create(userId: number, name: string, inviteCode: string): Promise<Row | null>;
  mine(userId: number): Promise<Row[]>;
  join(userId: number, inviteCode: string): Promise<JoinResult>;
  leave(userId: number, householdId: number): Promise<LeaveResult>;
  transferOwner(userId: number, householdId: number, newOwnerUserId: number, version: number): Promise<TransferResult>;
  shoppingList(userId: number, householdId: number): Promise<Row[] | null>;
  createShopping(userId: number, householdId: number, id: string, input: ShoppingCreateInput): Promise<ShoppingCreateResult>;
  updateShopping(userId: number, householdId: number, itemId: string, input: ShoppingUpdateInput): Promise<ShoppingMutationResult>;
  removeShopping(userId: number, householdId: number, itemId: string, version: number): Promise<ShoppingDeleteResult>;
  intake(userId: number, householdId: number, batchId: string, input: ShoppingIntakeInput): Promise<IntakeRepositoryResult>;
  inventory(userId: number, householdId: number): Promise<Row[] | null>;
  createInventory(userId: number, householdId: number, input: InventoryCreateInput): Promise<InventoryMutationResult>;
  updateInventory(userId: number, householdId: number, itemId: number, input: InventoryUpdateInput): Promise<InventoryMutationResult>;
  removeInventory(userId: number, householdId: number, itemId: number, version: number): Promise<"not_member" | "not_found" | "version_conflict" | "removed">;
  history(userId: number, householdId: number): Promise<Row[] | null>;
}
