import { householdMealReservationResultSchema, type HouseholdMealReservationInput } from "@dietdigidose/contracts";
import { householdMealSchema, type HouseholdMealProductionInput } from "@dietdigidose/contracts";
import { householdMealsSchema, householdEatingResultSchema, type HouseholdMealEatingInput } from "@dietdigidose/contracts";
import { householdDiningAllocationPreviewSchema, type HouseholdDiningAllocationInput, householdDiningMembersSchema, householdDiningPreferencesSchema, type HouseholdDiningPreferencesInput } from "@dietdigidose/contracts";
import { requestJson, type ApiFetch } from "./client";

export interface HouseholdMember {
  user_id: number;
  username: string;
  nickname: string;
  avatar_url?: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface Household {
  id: number;
  name: string;
  invite_code: string;
  owner_id: number;
  created_at: string;
  my_role: "owner" | "admin" | "member";
  members: HouseholdMember[];
  version: number;
}

export interface HouseholdShoppingItem {
  id: string;
  householdId: number;
  name: string;
  amount: string;
  category: string;
  checked: boolean;
  storageLocation: string | null;
  expirationDate: string | null;
  createdByUserId: number;
  updatedByUserId: number;
  purchasedByUserId: number | null;
  creatorName: string;
  updaterName: string;
  purchaserName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdInventoryItem {
  id: number;
  household_id: number;
  created_by_user_id: number;
  creator_name: string;
  food_name: string;
  category: string;
  quantity: string;
  expiration_date: string;
  storage_location: string;
  image_url?: string | null;
  is_available: boolean;
  created_at: string;
  version: number;
}

export interface HouseholdActivityLog {
  id: number;
  household_id: number;
  operator_user_id: number;
  operator_name: string;
  operator_avatar?: string;
  action: "add" | "consume" | "expire_clear" | "edit";
  food_name: string;
  quantity: string;
  storage_location: string;
  created_at: string;
}

export const householdApi = {
  reserveMeal: (apiFetch: ApiFetch,householdId: number,mealId: string,input: HouseholdMealReservationInput) =>
    requestJson(apiFetch, `/api/v1/households/${householdId}/meals/${encodeURIComponent(mealId)}/reservation`, { method: "PUT",body: JSON.stringify(input) },householdMealReservationResultSchema),
  produceMeal: (apiFetch: ApiFetch, householdId: number, input: HouseholdMealProductionInput) =>
    requestJson(apiFetch, `/api/v1/households/${householdId}/meals`, { method: "POST",body: JSON.stringify(input) },householdMealSchema),
  meals: (apiFetch: ApiFetch, householdId: number) => requestJson(apiFetch, `/api/v1/households/${householdId}/meals`, {}, householdMealsSchema),
  eatMeal: (apiFetch: ApiFetch, householdId: number, mealId: string, input: HouseholdMealEatingInput) =>
    requestJson(apiFetch, `/api/v1/households/${householdId}/meals/${encodeURIComponent(mealId)}/eat`, { method: "POST",body: JSON.stringify(input) },householdEatingResultSchema),
  previewDiningAllocation: (apiFetch: ApiFetch, householdId: number, input: HouseholdDiningAllocationInput) =>
    requestJson(apiFetch, `/api/v1/households/${householdId}/dining-allocation-preview`, { method: "POST", body: JSON.stringify(input) }, householdDiningAllocationPreviewSchema),
  diningMembers: (apiFetch: ApiFetch, householdId: number) =>
    requestJson(apiFetch, `/api/v1/households/${householdId}/dining-members`, {}, householdDiningMembersSchema),
  diningPreferences: (apiFetch: ApiFetch, householdId: number) =>
    requestJson(apiFetch, `/api/v1/households/${householdId}/dining-preferences`, {}, householdDiningPreferencesSchema),
  saveDiningPreferences: (apiFetch: ApiFetch, householdId: number, input: HouseholdDiningPreferencesInput) =>
    requestJson(apiFetch, `/api/v1/households/${householdId}/dining-preferences`, { method: "PUT", body: JSON.stringify(input) }, householdDiningPreferencesSchema),

  create: (apiFetch: ApiFetch, name: string) =>
    requestJson<Household>(apiFetch, "/api/v1/households", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  mine: (apiFetch: ApiFetch) => requestJson<Household[]>(apiFetch, "/api/v1/households/mine"),

  join: (apiFetch: ApiFetch, inviteCode: string) =>
    requestJson<{ message: string; household: Household }>(apiFetch, "/api/v1/households/join", {
      method: "POST",
      body: JSON.stringify({ invite_code: inviteCode }),
    }),

  leave: (apiFetch: ApiFetch, householdId: number) =>
    requestJson<{ message: string }>(apiFetch, `/api/v1/households/${householdId}/leave`, {
      method: "POST",
    }),

  transferOwner: (apiFetch: ApiFetch, householdId: number, newOwnerUserId: number, version: number) =>
    requestJson<{ transferred: true; new_owner_user_id: number; version: number }>(apiFetch, `/api/v1/households/${householdId}/transfer-owner`, {
      method: "POST",
      body: JSON.stringify({ newOwnerUserId, version }),
    }),

  shoppingList: (apiFetch: ApiFetch, householdId: number) =>
    requestJson<HouseholdShoppingItem[]>(apiFetch, `/api/v1/households/${householdId}/shopping-list`),

  shoppingCreate: (apiFetch: ApiFetch, householdId: number, input: unknown) =>
    requestJson<{ item: HouseholdShoppingItem; mergeCandidates: Array<{ id: string; name: string; amount: string; category: string }> }>(apiFetch, `/api/v1/households/${householdId}/shopping-list`, {
      method: "POST", body: JSON.stringify(input),
    }),

  shoppingUpdate: (apiFetch: ApiFetch, householdId: number, itemId: string, input: unknown) =>
    requestJson<HouseholdShoppingItem>(apiFetch, `/api/v1/households/${householdId}/shopping-list/${encodeURIComponent(itemId)}`, {
      method: "PATCH", body: JSON.stringify(input),
    }),

  shoppingRemove: (apiFetch: ApiFetch, householdId: number, itemId: string, version: number) =>
    requestJson<{ deleted: true }>(apiFetch, `/api/v1/households/${householdId}/shopping-list/${encodeURIComponent(itemId)}?version=${version}`, {
      method: "DELETE",
    }),

  shoppingIntake: (apiFetch: ApiFetch, householdId: number, input: unknown) =>
    requestJson<{ batchId: string; inventoryIds: number[]; count: number; repeated: boolean }>(apiFetch, `/api/v1/households/${householdId}/shopping-list/intake`, {
      method: "POST", body: JSON.stringify(input),
    }),

  inventoryList: (apiFetch: ApiFetch, householdId: number) =>
    requestJson<HouseholdInventoryItem[]>(apiFetch, `/api/v1/households/${householdId}/inventory`),

  inventoryCreate: (apiFetch: ApiFetch, householdId: number, input: unknown) =>
    requestJson<HouseholdInventoryItem>(apiFetch, `/api/v1/households/${householdId}/inventory`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  inventoryUpdate: (apiFetch: ApiFetch, householdId: number, itemId: number, input: unknown) =>
    requestJson<HouseholdInventoryItem>(apiFetch, `/api/v1/households/${householdId}/inventory/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  inventoryRemove: (apiFetch: ApiFetch, householdId: number, itemId: number, version: number) =>
    requestJson<{ message: string }>(apiFetch, `/api/v1/households/${householdId}/inventory/${itemId}?version=${version}`, {
      method: "DELETE",
    }),

  historyList: (apiFetch: ApiFetch, householdId: number) =>
    requestJson<HouseholdActivityLog[]>(apiFetch, `/api/v1/households/${householdId}/history`),
};
