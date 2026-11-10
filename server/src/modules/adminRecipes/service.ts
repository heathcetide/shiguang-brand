import { createHash } from "node:crypto";
import { recipeExecutionReviewSchema } from "@dietdigidose/contracts";
import { executionRecipeKey, executionReviewKey, reviewedExecution } from "../recipes/execution.js";
import { substitutionMatches } from "../recipes/substitutions.js";
import { recipeMinutesSchema } from "../../utils/recipeMinutes.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { AdminRecipesError } from "./errors.js";
import type { AdminRecipesRepository } from "./repository.js";
import type { AdminAudit, AdminRecipeWrite, AuditContext, DuplicateWrite, RequirementWrite, Row } from "./types.js";

type CatalogResolver = {
  resolveCatalog(rawName: string): Promise<{
    id: number;
    confidence: number;
    qualityStatus?: string;
    capabilities: Array<{ code: string }>;
  } | null>;
};

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringSet(value: unknown) {
  return new Set(parseArray(value).flatMap((item) => {
    const raw = typeof item === "string" ? item : String((item as Row)?.name || "");
    const normalized = normalizeContentTerm(raw);
    return normalized ? [normalized] : [];
  }));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

function similarity(left: Row, right: Row) {
  const leftTitle = normalizeContentTerm(String(left.title || ""));
  const rightTitle = normalizeContentTerm(String(right.title || ""));
  const title = leftTitle === rightTitle ? 1 : leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle) ? 0.75 : 0;
  const ingredients = jaccard(stringSet(left.ingredients_json ?? left.ingredients), stringSet(right.ingredients_json));
  const steps = jaccard(stringSet(left.steps_json ?? left.steps), stringSet(right.steps_json));
  const score = Math.round((title * 0.45 + ingredients * 0.4 + steps * 0.15) * 10_000) / 10_000;
  return { score, reasons: [...(title >= 0.75 ? ["title"] : []), ...(ingredients >= 0.7 ? ["ingredients"] : []), ...(steps >= 0.7 ? ["steps"] : [])] };
}

function fingerprint(title: string, ingredients: unknown[], steps: unknown[]) {
  return createHash("sha256").update(JSON.stringify({
    title: normalizeContentTerm(title),
    ingredients: [...stringSet(ingredients)].sort(),
    steps: steps.map((step) => normalizeContentTerm(String(step))).filter(Boolean),
  })).digest("hex");
}

function inferredKitchenware(text: string) {
  const rules: Array<[RegExp, string]> = [
    [/空气炸锅/, "空气炸锅"], [/微波炉/, "微波炉"], [/(?:破壁机|料理机|搅拌机)/, "破壁机"],
    [/(?:烤箱|烘焙)/, "烤箱"], [/(?:蒸|蒸笼)/, "蒸锅"], [/(?:炒|爆|煎)/, "炒锅"], [/(?:煮|炖|煲)/, "汤锅"],
  ];
  const inferred = rules.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
  return [...new Set(inferred.length ? inferred : ["菜刀", "砧板"])];
}

function publicationIssues(input: AdminRecipeWrite) {
  const issues: string[] = [];
  if (!input.title) issues.push("missing_title");
  if (!input.dataLicense) issues.push("missing_license");
  if (!Number.isInteger(input.servingSize) || (input.servingSize ?? 0) <= 0) issues.push("missing_serving_size");
  if ((input.prepTime ?? 0) + input.cookTime <= 0) issues.push("missing_time");
  if (!input.ingredients.length) issues.push("missing_ingredients");
  if (input.steps.length < 2) issues.push("missing_steps");
  if (!input.requiredKitchenware.length) issues.push("missing_kitchenware_mapping");
  return issues;
}

function audit(context: AuditContext, input: Omit<AdminAudit, keyof AuditContext>): AdminAudit {
  return { ...context, ...input };
}

export class AdminRecipesService {
  private readonly repository: AdminRecipesRepository;
  private readonly catalog: CatalogResolver;
  constructor(repository: AdminRecipesRepository, catalog: CatalogResolver) { this.repository = repository; this.catalog = catalog; }

  async list(query: Row) {
    const cursorMode = query.pageSize !== undefined || query.cursor !== undefined;
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
    const cursor = query.cursor ? decodeCursor(String(query.cursor)) : null;
    const cursorId = cursor ? Number(cursor.id) : null;
    if (query.cursor && (!cursor || cursor.v !== 1 || !Number.isInteger(cursorId) || cursorId! <= 0)) {
      throw new AdminRecipesError(400, "分页游标无效", "INVALID_CURSOR");
    }
    const source = query.source === "official" || query.source === "user" ? query.source : undefined;
    const reviewStatus = ["pending", "approved", "rejected"].includes(String(query.reviewStatus))
      ? query.reviewStatus as "pending" | "approved" | "rejected" : undefined;
    const qualityStatus = ["trusted", "estimated", "needs_review"].includes(String(query.qualityStatus))
      ? query.qualityStatus as "trusted" | "estimated" | "needs_review" : undefined;
    const result = await this.repository.list({
      deleted: query.deleted === "deleted" || query.deleted === "all" ? query.deleted : "active",
      source, reviewStatus, qualityStatus,
      category: typeof query.category === "string" && query.category.trim() ? query.category.trim() : undefined,
      search: typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined,
      cursorId: cursorMode ? cursorId : null, limit: cursorMode ? pageSize + 1 : null,
    });
    const hasMore = cursorMode && result.rows.length > pageSize;
    const items = (cursorMode ? result.rows.slice(0, pageSize) : result.rows).map((row): Row & { diagnostics: { publicationIssues: string[] } } => ({ ...row,
      diagnostics: { publicationIssues: publicationIssues(this.writeFromStored(row)) },
    }));
    if (!cursorMode) return items;
    return { items, total: result.summary.total, summary: result.summary,
      nextCursor: hasMore ? encodeCursor({ v: 1, id: Number(items.at(-1)!.id) }) : null };
  }

  async create(adminUserId: number, body: Row, context: AuditContext) {
    const input = await this.write(body);
    const issues = publicationIssues(input).filter((issue) => issue !== "missing_kitchenware_mapping");
    if (issues.length) throw new AdminRecipesError(400, "食谱发布质量校验未通过", undefined, { issues });
    input.duplicates = this.duplicates(input, await this.repository.duplicateSources());
    return { success: true, id: await this.repository.create(input, { ...context, adminUserId }) };
  }

  async update(adminUserId: number, recipeId: number, body: Row, context: AuditContext) {
    const existing = await this.repository.find(recipeId);
    if (!existing) throw new AdminRecipesError(404, "食谱未找到");
    const input = await this.write(body, existing);
    const issues = publicationIssues(input);
    if (issues.length) throw new AdminRecipesError(400, "食谱发布质量校验未通过", undefined, { issues });
    input.duplicates = this.duplicates(input, await this.repository.duplicateSources(recipeId));
    if (!await this.repository.update(recipeId, input, { ...context, adminUserId }, existing)) throw new AdminRecipesError(409, "食谱已改变，请重新读取后保存", "RECIPE_UPDATE_CONFLICT");
    return { success: true };
  }

  async replaceKitchenware(adminUserId: number, recipeId: number, body: Row, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const required = Array.isArray(body.required) ? body.required.slice(0, 30) : [];
    const optional = Array.isArray(body.optional) ? body.optional.slice(0, 30) : [];
    const requirements = await this.requirements(required, optional);
    const event = audit({ ...context, adminUserId }, { action: "recipe.kitchenware_update", resourceId: recipeId,
      summary: `更新食谱厨具能力：${recipe.title}` });
    if (!await this.repository.replaceKitchenware(recipeId, required, optional, requirements, event)) throw new AdminRecipesError(404, "食谱未找到");
    return { success: true, required, optional };
  }

  async scanDuplicates(adminUserId: number, recipeId: number, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const duplicates = this.duplicates(recipe, await this.repository.duplicateSources(recipeId));
    await this.repository.scanDuplicates(recipeId, duplicates, audit({ ...context, adminUserId }, {
      action: "recipe.duplicate_scan", resourceId: recipeId, summary: `执行食谱相似度扫描，发现 ${duplicates.length} 项`,
    }));
    return { candidates: duplicates.map((item) => ({ recipeId: item.candidateRecipeId, score: item.similarity, reasons: item.reasons })) };
  }

  coverage() { return this.repository.coverage(); }

  async execution(recipeId: number) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    return { title: String(recipe.title), ingredients: parseArray(recipe.ingredients_json), steps: parseArray(recipe.steps_json), servingSize: Number(recipe.serving_size),
      recipeKey: executionRecipeKey(recipe), reviewKey: executionReviewKey(recipe), execution: reviewedExecution(recipe) };
  }

  async reviewExecution(adminUserId: number, recipeId: number, body: Row, context: AuditContext) {
    const input = recipeExecutionReviewSchema.parse(body);
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    if (input.recipeKey !== executionRecipeKey(recipe) || input.reviewKey !== executionReviewKey(recipe)) throw new AdminRecipesError(409, "食谱内容或制作审核已改变，请重新核对", "RECIPE_EXECUTION_CONFLICT");
    if (input.profile) {
      for (const rule of input.profile.substitutions ?? []) {
        const target = await this.repository.find(rule.recipeId);
        if (!target || target.deleted_at || target.status !== "approved" || target.quality_status !== "trusted" || !reviewedExecution(target)
          || rule.recipeKey !== executionRecipeKey(target) || !substitutionMatches(recipe, target, rule)) throw new AdminRecipesError(400, "替代菜谱须公开可信、制作流程仍已审核、份数相同且仅替换所列原料；请重新核对完整变体");
      }
      if (Math.max(input.profile.maxBatchServings, input.profile.reheating?.maxBatchServings ?? 0) > Number(recipe.serving_size || 0)) throw new AdminRecipesError(400, "批次份量不能超过菜谱已声明产出，请先核对菜谱份数");
      const reviewedCapabilities = new Set<string>();
      for (const tool of [...input.profile.tools, ...(input.profile.reheating?.tools ?? [])]) {
        const catalog = await this.catalog.resolveCatalog(tool.name);
        if (!catalog || catalog.confidence !== 1 || catalog.id !== tool.catalogId || (catalog.qualityStatus && catalog.qualityStatus !== "trusted")) throw new AdminRecipesError(400, `请为「${tool.name}」选择已审核的厨具目录项`);
        if (input.profile.tools.includes(tool)) for (const capability of catalog.capabilities) reviewedCapabilities.add(capability.code);
      }
      for (const required of parseArray(recipe.required_kitchenware_json)) {
        const name = typeof required === "string" ? required : String((required as Row)?.name || "");
        const capability = typeof required === "object" && required ? String((required as Row).capabilityCode || "") : "";
        const catalog = name ? await this.catalog.resolveCatalog(name) : null;
        if ((name ? !catalog || !input.profile.tools.some(tool => tool.catalogId === catalog.id) : !capability)
          || (capability && !reviewedCapabilities.has(capability))) throw new AdminRecipesError(400, `制作流程尚未覆盖所需厨具「${name || capability || "未映射设备"}」`);
      }
    }
    const execution = input.profile ? { recipeKey: input.recipeKey, profile: input.profile, reviewedBy: adminUserId, reviewedAt: new Date().toISOString() } : null;
    if (!await this.repository.reviewExecution(recipeId, execution, recipe, audit({ ...context, adminUserId }, {
      action: "recipe.execution_review", resourceId: recipeId, summary: `${execution ? "审核制作流程" : "撤销制作流程审核"}：${recipe.title}`,
      details: { recipeKey: input.recipeKey, reference: input.profile?.reference ?? null, handling: input.profile?.handling ?? null, reheating: input.profile?.reheating ?? null, substitutions: input.profile?.substitutions ?? [] },
    }))) throw new AdminRecipesError(409, "食谱内容已改变，请重新核对制作流程", "RECIPE_EXECUTION_CONFLICT");
    return { success: true, execution, reviewKey: executionReviewKey({ ...recipe, execution_json: execution }) };
  }

  async approve(adminUserId: number, recipeId: number, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe || recipe.source !== "user") throw new AdminRecipesError(404, "未找到用户投稿");
    const input = this.writeFromStored(recipe);
    const issues = publicationIssues(input);
    if (issues.length) throw new AdminRecipesError(400, "食谱发布质量校验未通过", undefined, { issues });
    const event = audit({ ...context, adminUserId }, { action: "recipe_submission.approve", resourceId: recipeId,
      summary: `审核通过用户食谱：${recipe.title}`, details: { before: String(recipe.status), after: "approved" } });
    if (!await this.repository.approve(recipeId, adminUserId, event)) throw new AdminRecipesError(404, "未找到用户投稿");
    return { success: true, message: "用户食谱已审核通过" };
  }

  async reviewQuality(adminUserId: number, recipeId: number, status: "trusted" | "needs_review", reason: string, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const event = audit({ ...context, adminUserId }, { action: "recipe.quality_review", resourceId: recipeId,
      summary: `${status === "trusted" ? "设为可信" : "设为待复核"}：${recipe.title}`,
      details: { before: recipe.quality_status, after: status, reason } });
    if (!await this.repository.reviewQuality(recipeId, status, reason, event)) throw new AdminRecipesError(404, "食谱未找到");
    return { success: true, quality_status: status };
  }

  async reject(adminUserId: number, recipeId: number, reason: string, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe || recipe.source !== "user") throw new AdminRecipesError(404, "未找到用户投稿");
    const event = audit({ ...context, adminUserId }, { action: "recipe_submission.reject", resourceId: recipeId,
      summary: `驳回用户食谱：${recipe.title}`, details: { before: recipe.status, after: "rejected", reason } });
    if (!await this.repository.reject(recipeId, adminUserId, reason, event)) throw new AdminRecipesError(404, "未找到用户投稿");
    return { success: true, message: "用户食谱已驳回" };
  }

  async remove(adminUserId: number, recipeId: number, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const event = audit({ ...context, adminUserId }, { action: "recipe.delete", resourceId: recipeId,
      summary: `将食谱移入回收站：${recipe.title || recipeId}` });
    if (!await this.repository.remove(recipeId, adminUserId, event)) throw new AdminRecipesError(404, "食谱未找到");
    return { success: true, message: "食谱已移入回收站" };
  }

  private async write(body: Row, existing?: Row): Promise<AdminRecipeWrite> {
    // The editor does not send provenance fields. Omission is not permission to
    // replace imported attribution, serving size, or source evidence with defaults.
    const supplied = body;
    if (existing) body = { ...existing,
      steps: existing.steps_json, ingredients: existing.ingredients_json,
      required_kitchenware: existing.required_kitchenware_json,
      optional_kitchenware: existing.optional_kitchenware_json,
      meal_types: existing.meal_types_json, ...body };
    if (supplied.steps_json !== undefined && supplied.steps === undefined) body.steps = supplied.steps_json;
    if (supplied.ingredients_json !== undefined && supplied.ingredients === undefined) body.ingredients = supplied.ingredients_json;
    const metadata = (key: string, fallback: string): string | null => {
      const value = body[key];
      if (!existing) return String(value || fallback);
      if (existing && supplied[key] === undefined) return value == null ? null : String(value);
      if (value === undefined) return existing ? null : fallback;
      if (value === null) return null;
      if (typeof value !== "string") throw new AdminRecipesError(400, `${key} 必须为文本或 null`);
      return value.trim();
    };
    const servingSize = body.serving_size === undefined ? (existing ? null : 2) : body.serving_size;
    if (existing && supplied.serving_size !== undefined &&
      (!["number", "string"].includes(typeof supplied.serving_size) || !Number.isInteger(Number(supplied.serving_size)) || Number(supplied.serving_size) <= 0 || Number(supplied.serving_size) > 2_147_483_647)) {
      throw new AdminRecipesError(400, "份数必须为正整数");
    }
    const sourceUrl = metadata("source_url", "");
    if (existing && supplied.source_url != null && sourceUrl) {
      try { const url = new URL(sourceUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { throw new AdminRecipesError(400, "来源链接必须为不含登录信息的 HTTP 或 HTTPS 地址"); }
    }
    const nutrient = (key: string) => existing && supplied[key] === undefined && existing[key] == null ? null : Number(body[key]) || 0;
    const steps = parseArray(body.steps ?? body.steps_json);
    const ingredients = parseArray(body.ingredients ?? body.ingredients_json);
    const explicitRequired = parseArray(body.required_kitchenware);
    const requiredKitchenware = explicitRequired.length ? explicitRequired : inferredKitchenware(`${body.title || ""} ${steps.join(" ")}`);
    const optionalKitchenware = parseArray(body.optional_kitchenware);
    const title = String(body.title || "").trim();
    return {
      title, description: String(body.description || "").trim(), imageUrl: body.image_url ? String(body.image_url) : null,
      cookTime: recipeMinutesSchema.parse(body.cook_time) ?? 0, difficulty: String(body.difficulty || "简单"), calories: nutrient("calories"),
      protein: nutrient("protein"), carbs: nutrient("carbs"), fat: nutrient("fat"),
      category: String(body.category || "其他"), tags: parseArray(body.tags), steps, ingredients,
      canonicalKey: normalizeContentTerm(title), sourceContentHash: existing ? (existing.source_content_hash as string | null) ?? null : fingerprint(title, ingredients, steps),
      servingSize: existing ? (servingSize == null ? null : Number(servingSize)) : Number(body.serving_size) || 2, prepTime: recipeMinutesSchema.parse(body.prep_time),
      cuisine: body.cuisine ? String(body.cuisine) : null, mealTypes: parseArray(body.meal_types), requiredKitchenware,
      optionalKitchenware, sourceUrl: existing ? sourceUrl : sourceUrl || null,
      dataLicense: metadata("data_license", "DietDigiDose-Original"), sourceRevision: metadata("source_revision", "manual-v1"),
      sourceAttribution: metadata("source_attribution", "DietDigiDose 编辑团队"),
      requirements: await this.requirements(requiredKitchenware, optionalKitchenware), duplicates: [],
    };
  }

  private writeFromStored(row: Row): AdminRecipeWrite {
    return {
      title: String(row.title || ""), description: String(row.description || ""), imageUrl: row.image_url ? String(row.image_url) : null,
      cookTime: Number(row.cook_time), difficulty: String(row.difficulty || ""), calories: Number(row.calories), protein: Number(row.protein),
      carbs: Number(row.carbs), fat: Number(row.fat), category: String(row.category || ""), tags: parseArray(row.tags),
      steps: parseArray(row.steps_json), ingredients: parseArray(row.ingredients_json), canonicalKey: String(row.canonical_key || ""),
      sourceContentHash: String(row.source_content_hash || ""), servingSize: Number(row.serving_size), prepTime: recipeMinutesSchema.catch(null).parse(row.prep_time),
      cuisine: row.cuisine ? String(row.cuisine) : null, mealTypes: parseArray(row.meal_types_json),
      requiredKitchenware: parseArray(row.required_kitchenware_json), optionalKitchenware: parseArray(row.optional_kitchenware_json),
      sourceUrl: row.source_url ? String(row.source_url) : null, dataLicense: String(row.data_license || ""),
      sourceRevision: String(row.source_revision || ""), sourceAttribution: String(row.source_attribution || ""), requirements: [], duplicates: [],
    };
  }

  private async requirements(required: unknown[], optional: unknown[]) {
    const output: RequirementWrite[] = [];
    for (const [items, role] of [[required, "required"], [optional, "optional"]] as const) {
      for (const raw of items) {
        const row = raw && typeof raw === "object" ? raw as Row : null;
        const rawName = (typeof raw === "string" ? raw : String(row?.name || "")).trim();
        const explicitCapability = String(row?.capabilityCode || "").trim() || null;
        if (!rawName && !explicitCapability) continue;
        const resolved = rawName ? await this.catalog.resolveCatalog(rawName) : null;
        const accepted = resolved?.confidence === 1 ? resolved : null;
        output.push({ rawName: rawName || explicitCapability!, normalizedName: normalizeContentTerm(rawName || explicitCapability!),
          catalogId: accepted?.id || null, capabilityCode: explicitCapability || accepted?.capabilities[0]?.code || null,
          role, confidence: resolved?.confidence || (explicitCapability ? 1 : 0) });
      }
    }
    return output;
  }

  private duplicates(recipe: Row, candidates: Row[]): DuplicateWrite[] {
    return candidates.flatMap((candidate) => {
      const result = similarity(recipe, candidate);
      return result.score < 0.72 ? [] : [{ candidateRecipeId: Number(candidate.id), similarity: result.score, reasons: result.reasons }];
    }).sort((left, right) => right.similarity - left.similarity);
  }
}
