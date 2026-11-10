import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { validateIngredientQuality } from "../../utils/ingredientQuality.js";
import { AdminFoodAssetsError } from "./errors.js";
import type { AdminFoodAssetsRepository } from "./repository.js";
import type { AdminAudit, AuditContext, IngredientInput, Row } from "./types.js";

function legacyJson(value: unknown) { return typeof value === "string" || value == null ? value : JSON.stringify(value); }
function formatIngredient(row: Row): Row {
  return { ...row, aliases_json: legacyJson(row.aliases_json), micronutrients_json: legacyJson(row.micronutrients_json) };
}
function event(context: AuditContext, input: Omit<AdminAudit, keyof AuditContext>): AdminAudit { return { ...context, ...input }; }

export class AdminFoodAssetsService {
  private readonly repository: AdminFoodAssetsRepository;
  constructor(repository: AdminFoodAssetsRepository) { this.repository = repository; }

  async ingredients(query: Row) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 50));
    const result = await this.repository.listIngredients({
      deleted: query.status === "deleted" || query.status === "all" ? query.status : "active",
      search: typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined,
      category: typeof query.category === "string" && query.category !== "全部" ? query.category : undefined,
      source: typeof query.source === "string" && query.source !== "全部" ? query.source : undefined,
      page, pageSize,
    });
    return { ...result, items: result.items.map(formatIngredient), page, pageSize };
  }

  async createIngredient(body: Row, context: AuditContext) {
    const input = this.ingredientInput(body); this.assertQuality(input);
    const audit = event(context, { action: "ingredient.create", resourceType: "ingredients", resourceId: 0,
      summary: `创建食材：${input.name}` });
    const id = await this.repository.createIngredient(input, audit);
    return { success: true, id, message: "食材添加成功" };
  }

  async updateIngredient(id: number, body: Row, context: AuditContext) {
    const input = this.ingredientInput(body); this.assertQuality(input);
    const audit = event(context, { action: "ingredient.update", resourceType: "ingredients", resourceId: id,
      summary: `更新食材：${input.name}` });
    // Creation defaults must not overwrite evidence omitted by the editor.
    if (!await this.repository.updateIngredient(id, {
      ...input,
      category: body.category === undefined ? undefined : input.category,
      calories100g: body.calories_100g === undefined ? undefined : input.calories100g,
      protein100g: body.protein_100g === undefined ? undefined : input.protein100g,
      carbs100g: body.carbs_100g === undefined ? undefined : input.carbs100g,
      fat100g: body.fat_100g === undefined ? undefined : input.fat100g,
      source: body.source === undefined ? undefined : input.source,
      aliases: body.aliases === undefined ? undefined : input.aliases,
      searchKeywords: body.search_keywords === undefined ? undefined : input.searchKeywords,
      preparationState: body.preparation_state === undefined ? undefined : input.preparationState,
      sourceVersion: body.source_version === undefined ? undefined : input.sourceVersion,
      dataLicense: body.data_license === undefined ? undefined : input.dataLicense,
      edibleRatio: body.edible_ratio === undefined ? undefined : input.edibleRatio,
    }, audit)) throw new AdminFoodAssetsError(404, "食材未找到");
    return { success: true, message: "食材更新成功" };
  }

  async removeIngredient(id: number, context: AuditContext) {
    const audit = event(context, { action: "ingredient.delete", resourceType: "ingredients", resourceId: id,
      summary: `将食材移入回收站：${id}` });
    if (!await this.repository.removeIngredient(id, audit)) throw new AdminFoodAssetsError(404, "食材未找到");
    return { success: true, message: "食材已移入回收站" };
  }

  async addAlias(id: number, body: Row, context: AuditContext) {
    const alias = String(body.alias || "").trim();
    if (!alias || alias.length > 80) throw new AdminFoodAssetsError(400, "别名需为 1-80 个字符");
    const audit = event(context, { action: "ingredient.alias_add", resourceType: "ingredients", resourceId: id,
      summary: `添加食材别名：${alias}` });
    const result = await this.repository.addAlias(id, alias, normalizeContentTerm(alias), audit);
    if (result.kind === "missing") throw new AdminFoodAssetsError(404, "食材未找到");
    return { aliases: result.aliases };
  }

  async mergeIngredient(sourceId: number, body: Row, context: AuditContext) {
    const targetId = Number(body.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0 || targetId === sourceId) throw new AdminFoodAssetsError(400, "目标食材无效");
    const audit = event(context, { action: "ingredient.merge", resourceType: "ingredients", resourceId: sourceId,
      summary: "合并食材", details: { targetId } });
    const result = await this.repository.mergeIngredient(sourceId, targetId, audit);
    if (result.kind === "missing") throw new AdminFoodAssetsError(404, "源食材或目标食材不存在");
    return { success: true, sourceId, targetId };
  }

  coverage() { return this.repository.coverage(); }
  pendingCustomFoods() { return this.repository.pendingCustomFoods(); }

  async approveCustomFood(id: number, context: AuditContext) {
    const audit = event(context, { action: "custom_food.approve", resourceType: "custom_food", resourceId: id,
      summary: `审核通过自定义食材：${id}` });
    const result = await this.repository.approveCustomFood(id, audit);
    if (result.kind === "missing") throw new AdminFoodAssetsError(404, "记录未找到");
    return { success: true, message: "审核通过并已入库" };
  }

  async rejectCustomFood(id: number, context: AuditContext) {
    const audit = event(context, { action: "custom_food.reject", resourceType: "custom_food", resourceId: id,
      summary: `驳回自定义食材：${id}` });
    const result = await this.repository.rejectCustomFood(id, audit);
    if (result.kind === "missing") throw new AdminFoodAssetsError(404, "记录未找到");
    return { success: true, message: "已拒绝" };
  }

  private ingredientInput(body: Row): IngredientInput {
    const aliases = Array.isArray(body.aliases) ? body.aliases.map(String) : [];
    const [calories100g, protein100g, carbs100g, fat100g] =
      [body.calories_100g, body.protein_100g, body.carbs_100g, body.fat_100g]
        .map((value) => value == null ? null : Number(value));
    const nutrients = [calories100g, protein100g, carbs100g, fat100g];
    return {
      name: String(body.name).trim(), normalizedName: normalizeContentTerm(String(body.name)),
      category: body.category ? String(body.category) : null, calories100g, protein100g, carbs100g, fat100g,
      nutritionStatus: nutrients.every((value) => value === null) ? "unknown"
        : nutrients.every((value) => value !== null) ? "core_complete" : "incomplete",
      source: String(body.source ?? "official"),
      aliases: aliases.map((value) => ({ value, normalized: normalizeContentTerm(value) })),
      searchKeywords: String(body.search_keywords || ""), preparationState: String(body.preparation_state || "unspecified"),
      sourceVersion: String(body.source_version || "manual-v1"), dataLicense: String(body.data_license || "DietDigiDose-Original"),
      edibleRatio: Number(body.edible_ratio ?? 1),
    };
  }

  private assertQuality(input: IngredientInput) {
    const issues = validateIngredientQuality({ calories100g: input.calories100g, protein100g: input.protein100g,
      carbs100g: input.carbs100g, fat100g: input.fat100g, source: input.source, dataLicense: input.dataLicense,
      sourceVersion: input.sourceVersion, edibleRatio: input.edibleRatio });
    if (issues.length) throw new AdminFoodAssetsError(400, "食材质量校验未通过", { issues });
  }
}
