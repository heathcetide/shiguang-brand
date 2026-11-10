import { mealChangeDecision } from "../mealPlans/changePolicy.js";
import { checkDiningRecipe } from "./recipeConstraints.js";
import { householdMealReservationSchema, type HouseholdMealReservationInput, householdMealEatingSchema, type HouseholdMealEatingInput, householdMealProductionSchema, type HouseholdMealProductionInput, householdDiningAllocationSchema, householdDiningMembersSchema, type HouseholdDiningAllocationInput, type HouseholdDiningAllocationPreview } from "@dietdigidose/contracts";
import crypto from "node:crypto";
import { HouseholdsError } from "./errors.js";
import { formatInventory, formatShoppingItem, normalizeItemName } from "./formatters.js";
import type { HouseholdsRepository } from "./repository.js";
import type { InventoryCreateInput, InventoryUpdateInput, ShoppingCreateInput, ShoppingIntakeInput, ShoppingUpdateInput } from "./types.js";

function inviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

export class HouseholdsService {
  private readonly repository: HouseholdsRepository;
  private readonly codeFactory: () => string;

  constructor(repository: HouseholdsRepository, codeFactory: () => string = inviteCode) {
    this.repository = repository; this.codeFactory = codeFactory;
  }

  async reserveMeal(userId: number,householdId: number,mealId: string,input: HouseholdMealReservationInput) {
    return this.repository.reserveMeal(userId,householdId,mealId,householdMealReservationSchema.parse(input));
  }
  async meals(userId: number,householdId: number) { return this.repository.meals(userId,householdId); }
  async eatMeal(userId: number,householdId: number,mealId: string,input: HouseholdMealEatingInput) {
    return this.repository.eatMeal(userId,householdId,mealId,householdMealEatingSchema.parse(input));
  }
  async produceMeal(userId: number, householdId: number, input: HouseholdMealProductionInput) {
    return this.repository.produceMeal(userId,householdId,householdMealProductionSchema.parse(input));
  }

  async previewDiningAllocation(userId: number, householdId: number, raw: HouseholdDiningAllocationInput) {
    const input = householdDiningAllocationSchema.parse(raw);
    const current = await this.diningMembers(userId,householdId);
    const participants = input.participants.map(selection => {
      const member = current.members.find(value => value.membershipId === selection.membershipId);
      if (!member || member.version !== selection.version)
        throw new HouseholdsError(409,"共餐成员或忌口已变化，请重新读取后选择","DINING_MEMBERS_CHANGED");
      if (!member.shared)
        throw new HouseholdsError(409,"参与成员尚未授权共餐忌口，请先由本人确认并授权","DINING_CONSENT_REQUIRED");
      return { ...member,servings: selection.servings };
    });
    const totalServings = participants.reduce((sum,item) => sum + Math.round(item.servings * 1_000_000),0) / 1_000_000;
    let recipeCheck; let planItem: HouseholdDiningAllocationPreview["planItem"]; let supplyEligible = false; let recipeId = input.recipeId;
    if (input.planItem) {
      const context = await this.repository.diningPlanContext(userId,input.planItem.planId,input.planItem.itemId);
      if (!context) throw new HouseholdsError(404,"个人餐次不存在或不可用于共餐预览","PLAN_ITEM_UNAVAILABLE");
      if (Number(context.item.version) !== input.planItem.version) throw new HouseholdsError(409,"个人餐次已变化，请刷新后重新预览","PLAN_ITEM_CHANGED");
      supplyEligible = context.item.status === "planned";
      const currentRecipe = context.item.recipe_id == null ? undefined : Number(context.item.recipe_id);
      if (recipeId !== undefined && recipeId !== currentRecipe) throw new HouseholdsError(409,"所选菜谱与当前餐次不一致，请刷新后重试","PLAN_RECIPE_CHANGED");
      recipeId = currentRecipe;
      planItem = { ...input.planItem,plannedDate: String(context.item.planned_date),mealType: String(context.item.meal_type),title: String(context.item.title),decision: mealChangeDecision(context.item,context.queue,context.purchases),applied: false as const };
    }
    if (recipeId !== undefined) {
      const recipe = await this.repository.diningRecipe(recipeId);
      if (!recipe) throw new HouseholdsError(404,"菜谱不可用于共餐检查","RECIPE_UNAVAILABLE");
      recipeCheck = checkDiningRecipe(recipe,participants,totalServings);
    }
    const supply = supplyEligible && planItem && planItem.decision!=="keep" && recipeCheck ? await this.repository.diningSupply(userId,householdId,planItem,totalServings,recipeCheck.fingerprint) : undefined;
    return {
      ...(supply ? { supply } : {}),householdId,totalServings,participants,...(recipeCheck ? { recipeCheck } : {}),...(planItem ? { planItem } : {}),
      // These are requirements for subsequent recipe checking, never proof a dish is safe.
      allergies: [...new Set(participants.flatMap(member => member.allergies))],
      restrictions: [...new Set(participants.flatMap(member => member.restrictions))],
      recipeValidationRequired: true as const,
    };
  }

  async diningMembers(userId: number, householdId: number) {
    const rows = await this.repository.diningMembers(userId,householdId);
    if (!rows.length) throw new HouseholdsError(403,"你不是该家庭的成员","NOT_MEMBER");
    return householdDiningMembersSchema.parse({ members: rows.map(row => {
      const identity = { membershipId: Number(row.id),userId: Number(row.user_id),name: String(row.name),version: Number(row.dining_version) };
      if (!row.dining_shared) return { ...identity,shared: false };
      const preferences = typeof row.dining_preferences_json === "string" ? JSON.parse(row.dining_preferences_json) : row.dining_preferences_json as { allergies?: string[]; restrictions?: string[] };
      return { ...identity,shared: true,allergies: preferences?.allergies ?? [],restrictions: preferences?.restrictions ?? [] };
    }) });
  }

  async diningPreferences(userId: number, householdId: number) {
    const row = await this.repository.diningPreferences(userId,householdId);
    if (!row) throw new HouseholdsError(403,"你不是该家庭的成员","NOT_MEMBER");
    const preferences = typeof row.dining_preferences_json === "string" ? JSON.parse(row.dining_preferences_json) : row.dining_preferences_json as { allergies?: string[]; restrictions?: string[] };
    return { membershipId: Number(row.id),version: Number(row.dining_version),shared: Boolean(row.dining_shared),allergies: preferences?.allergies ?? [],restrictions: preferences?.restrictions ?? [] };
  }
  async saveDiningPreferences(userId: number, householdId: number, input: import("@dietdigidose/contracts").HouseholdDiningPreferencesInput) {
    await this.diningPreferences(userId,householdId);
    if (!await this.repository.saveDiningPreferences(userId,householdId,input)) throw new HouseholdsError(409,"共餐设置或家庭成员状态已变化，请刷新后重试","VERSION_CONFLICT");
    return { ...input,version: input.version+1 };
  }

  async create(userId: number, rawName: unknown) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) throw new HouseholdsError(400, "请输入家庭空间名称", "INVALID_NAME");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const household = await this.repository.create(userId, name, this.codeFactory());
      if (household) return household;
    }
    throw new Error("Unable to allocate a unique household invite code");
  }

  mine(userId: number) { return this.repository.mine(userId); }

  async join(userId: number, rawCode: unknown) {
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (!code) throw new HouseholdsError(400, "请输入 8 位家庭邀请码", "INVALID_CODE");
    const result = await this.repository.join(userId, code);
    if (result.kind === "not_found") throw new HouseholdsError(440, "未找到对应的家庭空间，请检查邀请码是否正确", "HOUSEHOLD_NOT_FOUND");
    return { status: result.kind === "joined" ? 201 : 200,
      body: { message: result.kind === "joined" ? "加入家庭空间成功" : "你已经是该家庭空间的成员", household: result.household } };
  }

  async leave(userId: number, householdId: number) {
    const result = await this.repository.leave(userId, householdId);
    if (result.kind === "not_member") throw new HouseholdsError(404, "你不是该家庭空间的成员", "NOT_MEMBER");
    if (result.kind === "transferred") return { message: "已转移所有者并退出家庭空间", new_owner_user_id: result.newOwnerUserId };
    if (result.kind === "dissolved") return { message: "家庭空间已解散" };
    return { message: "已退出家庭空间" };
  }

  async transferOwner(userId: number, householdId: number, input: { newOwnerUserId: number; version: number }) {
    const result = await this.repository.transferOwner(userId, householdId, input.newOwnerUserId, input.version);
    if (result.kind === "not_owner") throw new HouseholdsError(404, "家庭空间不存在或你不是所有者", "HOUSEHOLD_NOT_FOUND");
    if (result.kind === "target_not_member") throw new HouseholdsError(400, "新所有者必须是当前家庭成员", "TARGET_NOT_MEMBER");
    if (result.kind === "version_conflict") throw new HouseholdsError(409, "家庭空间已更新，请刷新后重试", "HOUSEHOLD_VERSION_CONFLICT");
    return { transferred: true, new_owner_user_id: input.newOwnerUserId, version: result.version };
  }

  async shoppingList(userId: number, householdId: number) {
    const rows = await this.repository.shoppingList(userId, householdId);
    if (!rows) throw this.shoppingNotFound();
    return rows.map(formatShoppingItem);
  }

  async createShopping(userId: number, householdId: number, id: string, input: ShoppingCreateInput) {
    const result = await this.repository.createShopping(userId, householdId, id, input);
    if (result.kind === "not_member") throw this.shoppingNotFound();
    const normalized = normalizeItemName(input.name);
    const mergeCandidates = result.active.filter((item) => normalizeItemName(String(item.name)) === normalized)
      .map((item) => ({ id: String(item.id), name: String(item.name), amount: String(item.amount), category: String(item.category) }));
    return { item: formatShoppingItem(result.item), mergeCandidates };
  }

  async updateShopping(userId: number, householdId: number, itemId: string, input: ShoppingUpdateInput) {
    const result = await this.repository.updateShopping(userId, householdId, itemId, input);
    if (result.kind === "not_member" || result.kind === "not_found") throw this.shoppingItemNotFound();
    if (result.kind === "version_conflict") throw this.shoppingConflict();
    return formatShoppingItem(result.item);
  }

  async removeShopping(userId: number, householdId: number, itemId: string, version: number) {
    if (!Number.isInteger(version) || version < 1) throw new HouseholdsError(400, "缺少有效版本号", "INVALID_VERSION");
    const result = await this.repository.removeShopping(userId, householdId, itemId, version);
    if (result === "not_member" || result === "not_found") throw this.shoppingItemNotFound();
    if (result === "version_conflict") throw this.shoppingConflict();
    return { deleted: true };
  }

  async intake(userId: number, householdId: number, batchId: string, input: ShoppingIntakeInput) {
    const result = await this.repository.intake(userId, householdId, batchId, input);
    if (result.kind === "not_member") throw this.shoppingNotFound();
    if (result.kind === "version_conflict") throw new HouseholdsError(409,
      "部分采购项已被修改、取消勾选或入库，请刷新后重试", "HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
    return { status: result.kind === "created" ? 201 : 200, body: result.value };
  }

  async inventory(userId: number, householdId: number) {
    const rows = await this.repository.inventory(userId, householdId);
    if (!rows) throw new HouseholdsError(403, "你无权查看该家庭保鲜仓", "FORBIDDEN");
    return rows.map(formatInventory);
  }

  async createInventory(userId: number, householdId: number, input: InventoryCreateInput) {
    if (!input.food_name || !input.expiration_date) throw new HouseholdsError(400, "食材名称与到期日为必填项", "INVALID_INPUT");
    const result = await this.repository.createInventory(userId, householdId, input);
    if (result.kind !== "completed") throw new HouseholdsError(403, "无权向该家庭添加食材", "FORBIDDEN");
    return formatInventory(result.item);
  }

  async updateInventory(userId: number, householdId: number, itemId: number, input: InventoryUpdateInput) {
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new HouseholdsError(400,"请读取食材最新版本后再修改","VERSION_REQUIRED");
    const result = await this.repository.updateInventory(userId, householdId, itemId, input);
    if (result.kind === "version_conflict") throw new HouseholdsError(409,"家庭食材已被其他成员更新，请刷新后重试","VERSION_CONFLICT");
    if (result.kind === "not_member") throw new HouseholdsError(403, "无权修改该家庭食材", "FORBIDDEN");
    if (result.kind === "not_found") throw new HouseholdsError(404, "食材不存在", "NOT_FOUND");
    return formatInventory(result.item);
  }

  async removeInventory(userId: number, householdId: number, itemId: number, version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw new HouseholdsError(400,"请读取食材最新版本后再移除","VERSION_REQUIRED");
    const result = await this.repository.removeInventory(userId, householdId, itemId, version);
    if (result === "version_conflict") throw new HouseholdsError(409,"家庭食材已被其他成员更新，请刷新后重试","VERSION_CONFLICT");
    if (result === "not_member") throw new HouseholdsError(403, "无权操作该家庭食材", "FORBIDDEN");
    if (result === "not_found") throw new HouseholdsError(404, "食材不存在", "NOT_FOUND");
    return { message: "家庭食材已用完下架" };
  }

  async history(userId: number, householdId: number) {
    const rows = await this.repository.history(userId, householdId);
    if (!rows) throw new HouseholdsError(403, "无权查看该家庭变动日志", "FORBIDDEN");
    return rows;
  }

  private shoppingNotFound() { return new HouseholdsError(404, "家庭采购清单不存在", "HOUSEHOLD_SHOPPING_NOT_FOUND"); }
  private shoppingItemNotFound() { return new HouseholdsError(404, "家庭采购项不存在", "HOUSEHOLD_SHOPPING_ITEM_NOT_FOUND"); }
  private shoppingConflict() { return new HouseholdsError(409, "采购项已被其他成员更新，请刷新后重试", "HOUSEHOLD_SHOPPING_VERSION_CONFLICT"); }
}
