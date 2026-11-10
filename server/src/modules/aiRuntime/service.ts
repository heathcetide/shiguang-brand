import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { sanitizeAIErrorMessage } from "../../services/aiErrors.js";
import { RESOURCE_SETTING_KEY, legacyResourceDocument, resourceDocumentSchema, resourceUpdateSchema, applyResourceUpdate, publicResourceDocument, resolveResourceService, serviceIds, serviceCatalog, validateResourceDocument, type ServiceId, resolveToolService, toolServiceIds, toolServiceCatalog, type ToolServiceId } from "./resources.js";
import { thinkingParameters, runtimePolicySchema } from "./policy.js";
import type { AIRuntimeRepository } from "./repository.js";
import type { AIConfig, AIUsageInput } from "./types.js";

export const AI_SETTING_KEYS = [
  "AI_API_KEY", "AI_BASE_URL", "AI_MODEL",
  "AI_CHAT_API_KEY", "AI_CHAT_BASE_URL", "AI_CHAT_MODEL",
  "AI_VISION_API_KEY", "AI_VISION_BASE_URL", "AI_VISION_MODEL",
  "AI_ASR_API_KEY", "AI_ASR_BASE_URL", "AI_ASR_MODEL",
  "AI_SUPERVISOR_MODEL", "AI_NUTRITION_MODEL", "AI_RECIPE_MODEL", "AI_OPERATIONS_MODEL",
  "AI_SYSTEM_PROMPT", "AI_RUNTIME_POLICY", RESOURCE_SETTING_KEY,
] as const;

export const AI_DRAFT_KEY = "AI_CONFIGURATION_DRAFT_V1";
const draftSchema = z.object({
  revision: z.number().int().nonnegative(), pending: z.boolean(),
  base: z.record(z.string(), z.string()), values: z.record(z.string(), z.string()),
  test: z.object({ revision: z.number().int(), scope: z.enum(["configuration-validation", "connection-probe"]), success: z.boolean(),
    service: z.enum(serviceIds).optional(), latencyMs: z.number().nonnegative().optional() }).optional(),
});

export type AIAgentRole = "SUPERVISOR" | "NUTRITION" | "RECIPE" | "OPERATIONS";

export class AIResourceConflictError extends Error { constructor() { super("配置版本已变更，请重新读取"); } }
export class AIResourceValidationError extends Error { constructor() { super("资源、能力绑定、角色模型或策略配置无效"); } }

export class AIRuntimeService {
  private readonly repository: AIRuntimeRepository;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly requestSettings = new AsyncLocalStorage<Record<string, string>>();

  constructor(repository: AIRuntimeRepository, environment: NodeJS.ProcessEnv = process.env) {
    this.repository = repository;
    this.environment = environment;
  }

  async settings(keys: string[] = [...AI_SETTING_KEYS]) {
    const snapshot = this.requestSettings.getStore();
    if (!snapshot) return this.repository.settings(keys);
    const other = keys.filter(key => !AI_SETTING_KEYS.includes(key as typeof AI_SETTING_KEYS[number]));
    return { ...await this.repository.settings(other), ...Object.fromEntries(keys.filter(key => key in snapshot).map(key => [key, snapshot[key]])) };
  }

  /** One read fixes all model, policy and credential values for this execution. */
  async withConfigurationSnapshot<T>(work: () => T, fresh = false): Promise<Awaited<T>> {
    if (!fresh && this.requestSettings.getStore()) return await work();
    const values = await this.repository.settings([...AI_SETTING_KEYS]);
    // Materialize environment fallbacks, so even environment mutation cannot alter an in-flight request.
    const legacy = this.resolveConfig(values, this.environment);
    const snapshot = { ...values, AI_API_KEY: legacy.apiKey, AI_BASE_URL: legacy.baseUrl, AI_MODEL: legacy.model,
      AI_CHAT_API_KEY: legacy.chat.apiKey, AI_CHAT_BASE_URL: legacy.chat.baseUrl, AI_CHAT_MODEL: legacy.chat.model,
      AI_VISION_API_KEY: legacy.vision.apiKey, AI_VISION_BASE_URL: legacy.vision.baseUrl, AI_VISION_MODEL: legacy.vision.model,
      AI_ASR_API_KEY: legacy.asr.apiKey, AI_ASR_BASE_URL: legacy.asr.baseUrl, AI_ASR_MODEL: legacy.asr.model };
    return await this.requestSettings.run(snapshot, work);
  }

  async captureConfigurationSnapshot() {
    return this.withConfigurationSnapshot(() => {
      const captured = this.requestSettings.getStore()!;
      return <T>(work: () => T) => this.requestSettings.run(captured, work);
    });
  }

  private async draftState() {
    const all = await this.repository.settings([...AI_SETTING_KEYS, AI_DRAFT_KEY]);
    const raw = all[AI_DRAFT_KEY] ?? null;
    delete all[AI_DRAFT_KEY];
    const stored = raw ? draftSchema.parse(JSON.parse(raw)) : undefined;
    const draft = stored?.pending ? stored : { revision: Math.max(stored?.revision ?? 0, this.resourceDocument(all).revision), pending: false, base: all, values: all };
    return { all, raw, draft };
  }

  async draftSettingsSnapshot() {
    const { draft } = await this.draftState();
    return { values: { ...draft.values }, revision: draft.revision };
  }
  async draftSettings() { return (await this.draftSettingsSnapshot()).values; }

  private validateValues(values: Record<string, string>) {
    const document = this.resourceDocument(values);
    const policy = runtimePolicySchema.parse(values.AI_RUNTIME_POLICY ? JSON.parse(values.AI_RUNTIME_POLICY) : {});
    for (const service of serviceIds) {
      const effective = resolveResourceService(document, service, this.resolveConfig(values), values);
      const modelPolicy = service === "vision" ? policy.vision : service === "asr" ? policy.asr : service === "nutrition" ? policy.planner : policy.main;
      if (service === "asr" && (modelPolicy.thinking !== "default" || modelPolicy.thinkingBudget !== undefined)) throw new AIResourceValidationError();
      thinkingParameters(effective.baseUrl, effective.model, modelPolicy);
    }
  }

  private async writeDraft(state: Awaited<ReturnType<AIRuntimeService["draftState"]>>, values: Record<string, string>) {
    try { this.validateValues(values); } catch { throw new AIResourceValidationError(); }
    const revision = state.draft.revision + 1;
    values = { ...values, [RESOURCE_SETTING_KEY]: JSON.stringify({ ...this.resourceDocument(values), revision }) };
    const draft = { revision, pending: true, base: state.draft.base, values };
    if (!await this.repository.compareAndSaveSetting(AI_DRAFT_KEY, state.raw, JSON.stringify(draft), this.validationSnapshot(state.all))) throw new AIResourceConflictError();
  }

  async testDraft(revision: number, probe?: { service: ServiceId; signal?: AbortSignal;
    run: (config: { apiKey: string; baseUrl: string; model: string }) => Promise<{ latencyMs: number }> }) {
    probe?.signal?.throwIfAborted();
    const state = await this.draftState();
    if (!state.draft.pending || state.draft.revision !== revision) throw new AIResourceConflictError();
    try { this.validateValues(state.draft.values); } catch { throw new AIResourceValidationError(); }
    let test: NonNullable<ReturnType<typeof draftSchema.parse>["test"]> = { revision, scope: "configuration-validation", success: true };
    if (probe) {
      const { apiKey, baseUrl, model } = resolveResourceService(this.resourceDocument(state.draft.values), probe.service, this.resolveConfig(state.draft.values), state.draft.values);
      test = { revision, scope: "connection-probe", service: probe.service, success: false };
      try {
        if (!apiKey) throw new Error("Missing credential");
        const result = await probe.run({ apiKey, baseUrl, model });
        test = { ...test, success: true, latencyMs: Math.max(0, result.latencyMs) };
      } catch { /* Provider bodies may contain credentials; persist only the bounded outcome. */ }
    }
    probe?.signal?.throwIfAborted();
    // A late result can never certify a different draft or replace an intervening result/publication.
    if (!await this.repository.compareAndSaveSetting(AI_DRAFT_KEY, state.raw, JSON.stringify({ ...state.draft, test }), this.validationSnapshot(state.all))) throw new AIResourceConflictError();
    return this.resourceConfiguration();
  }

  async discardDraft(revision: number) {
    const state = await this.draftState();
    if (state.draft.revision !== revision) throw new AIResourceConflictError();
    const cleared = { revision: revision + 1, pending: false, base: {}, values: {} };
    if (!await this.repository.compareAndSaveSetting(AI_DRAFT_KEY, state.raw, JSON.stringify(cleared), this.validationSnapshot(state.all))) throw new AIResourceConflictError();
    return this.resourceConfiguration();
  }

  async publishDraft(revision: number) {
    const state = await this.draftState();
    if (!state.draft.pending || state.draft.revision !== revision || state.draft.test?.revision !== revision || !state.draft.test.success) throw new AIResourceConflictError();
    try { this.validateValues(state.draft.values); } catch { throw new AIResourceValidationError(); }
    const values = state.draft.values;
    const cleared = { revision, pending: false, base: {}, values: {} };
    if (!await this.repository.compareAndSaveSetting(AI_DRAFT_KEY, state.raw, JSON.stringify(cleared), this.validationSnapshot(state.draft.base),
      Object.entries(values).map(([key, value]) => ({ key, value })))) throw new AIResourceConflictError();
    return this.resourceConfiguration();
  }


  saveSettings(entries: Array<{ key: string; value: string }>) {
    return entries.length ? this.repository.saveSettings(entries) : Promise.resolve();
  }

  async saveValidatedSettings(entries: Array<{ key: string; value: string }>, values: Record<string, string>, revision: number) {
    const state = await this.draftState();
    if (state.draft.revision !== revision) throw new AIResourceConflictError();
    if (AI_SETTING_KEYS.some(key => values[key] !== state.draft.values[key])) throw new AIResourceConflictError();
    await this.writeDraft(state, { ...values, ...Object.fromEntries(entries.map(entry => [entry.key, entry.value])) });
  }

  private validationSnapshot(values: Record<string, string>) {
    return Object.fromEntries(AI_SETTING_KEYS.map(key => [key, values[key] ?? null]));
  }

  async legacyChatConfig() { return this.resolveConfig(await this.settings()).chat; }

  async config(settings?: Record<string, string>): Promise<AIConfig> {
    const values = settings || await this.settings();
    const legacy = this.resolveConfig(values);
    const document = this.resourceDocument(values);
    const resolve = (service: ServiceId) => {
      const { apiKey, baseUrl, model } = resolveResourceService(document, service, legacy, values);
      return { apiKey, baseUrl, model };
    };
    const chat = resolve("chat"), vision = resolve("vision"), asr = resolve("asr");
    return { ...legacy, visionModel: vision.model, asrModel: asr.model, chat, vision, asr };
  }

  async runtimePolicy(settings?: Record<string, string>) {
    const values = settings ?? await this.settings();
    return runtimePolicySchema.parse(values.AI_RUNTIME_POLICY ? JSON.parse(values.AI_RUNTIME_POLICY) : {});
  }

  async agentConfig(agent: AIAgentRole, settings?: Record<string, string>) {
    const values = settings || await this.settings();
    const resolved = resolveResourceService(this.resourceDocument(values), agent.toLowerCase() as ServiceId, this.resolveConfig(values), values);
    return { apiKey: resolved.apiKey, baseUrl: resolved.baseUrl, model: resolved.model };
  }

  private resourceDocument(values: Record<string, string>) {
    const document = values[RESOURCE_SETTING_KEY]
      ? resourceDocumentSchema.parse(JSON.parse(values[RESOURCE_SETTING_KEY])) : legacyResourceDocument();
    validateResourceDocument(document);
    return document;
  }

  /** Idempotent, atomic metadata migration; secrets and legacy/env fallback remain in their existing storage. */
  async migrateResources() {
    const state = await this.draftState();
    if (state.draft.pending) throw new AIResourceConflictError();
    await this.repository.compareAndSaveSetting(RESOURCE_SETTING_KEY, null, JSON.stringify(legacyResourceDocument()), { ...this.validationSnapshot(state.all), [AI_DRAFT_KEY]: state.raw });
    return this.resourceConfiguration();
  }

  async toolConfig(service: ToolServiceId) {
    return resolveToolService(this.resourceDocument(await this.settings()), service);
  }

  async resourceConfiguration() {
    const { draft, all } = await this.draftState();
    const values = draft.values;
    const document = this.resourceDocument(values);
    const legacy = this.resolveConfig(values);
    const effective = Object.fromEntries(serviceIds.map(service => {
      const { apiKey, ...resolved } = resolveResourceService(document, service, legacy, values);
      return [service, { ...resolved, hasApiKey: !!apiKey, maskedKey: apiKey ? "********" : "" }];
    }));
    for (const service of toolServiceIds) {
      const { apiKey, ...resolved } = resolveToolService(document, service);
      Object.assign(effective, { [service]: { ...resolved, hasApiKey: !!apiKey, maskedKey: apiKey ? "********" : "" } });
    }
    const published = this.resourceDocument(all);
    const changedServices = [...serviceIds, ...toolServiceIds].filter(service => {
      const resolve = (doc: typeof document, settings: Record<string, string>) => serviceIds.includes(service as ServiceId)
        ? resolveResourceService(doc, service as ServiceId, this.resolveConfig(settings), settings)
        : resolveToolService(doc, service as ToolServiceId);
      if (serviceIds.includes(service as ServiceId) && ["AI_RUNTIME_POLICY", "AI_SYSTEM_PROMPT"].some(key => values[key] !== all[key])) return true;
      const comparable = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "revision"));
      return JSON.stringify(comparable(resolve(document, values))) !== JSON.stringify(comparable(resolve(published, all)));
    });
    const changedSettings = AI_SETTING_KEYS.filter(key => key !== RESOURCE_SETTING_KEY && values[key] !== all[key]);
    return { ...publicResourceDocument(document), revision: draft.revision,
      lifecycle: { pending: draft.pending, publishedRevision: published.revision, test: draft.test ?? null,
        publishedEffective: Object.fromEntries(serviceIds.map(service => {
          const { apiKey, ...resolved } = resolveResourceService(published, service, this.resolveConfig(all), all);
          return [service, { ...resolved, hasApiKey: !!apiKey }];
        })), changedServices, changedSettings, conflict: Object.entries(this.validationSnapshot(draft.base)).some(([key, value]) => (all[key] ?? null) !== value) }, migrated: !!values[RESOURCE_SETTING_KEY], catalog: [...serviceCatalog, ...toolServiceCatalog], effective };
  }

  async saveResourceConfiguration(input: unknown) {
    let update: ReturnType<typeof resourceUpdateSchema.parse>;
    try { update = resourceUpdateSchema.parse(input); }
    catch { throw new AIResourceValidationError(); }
    const state = await this.draftState();
    if (update.revision !== state.draft.revision) throw new AIResourceConflictError();
    const previous = this.resourceDocument(state.draft.values);
    let next: ReturnType<typeof applyResourceUpdate>;
    try { next = applyResourceUpdate({ ...update, revision: previous.revision }, previous); }
    catch { throw new AIResourceValidationError(); }
    await this.writeDraft(state, { ...state.draft.values, [RESOURCE_SETTING_KEY]: JSON.stringify(next) });
    return this.resourceConfiguration();
  }

  private resolveConfig(values: Record<string, string>, environment: NodeJS.ProcessEnv = this.requestSettings.getStore() ? {} : this.environment): AIConfig {
    const globalKey = values.AI_API_KEY || environment.AI_API_KEY || environment.OPENAI_API_KEY || "";
    const globalUrl = (values.AI_BASE_URL || environment.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const chat = {
      apiKey: values.AI_CHAT_API_KEY || globalKey,
      baseUrl: (values.AI_CHAT_BASE_URL || globalUrl).replace(/\/$/, ""),
      model: values.AI_CHAT_MODEL || values.AI_MODEL || environment.AI_MODEL || "deepseek-ai/DeepSeek-V3",
    };
    const vision = {
      apiKey: values.AI_VISION_API_KEY || globalKey,
      baseUrl: (values.AI_VISION_BASE_URL || globalUrl).replace(/\/$/, ""),
      model: values.AI_VISION_MODEL || environment.AI_VISION_MODEL || "Qwen/Qwen2.5-VL-72B-Instruct",
    };
    const asr = {
      apiKey: values.AI_ASR_API_KEY || globalKey,
      baseUrl: (values.AI_ASR_BASE_URL || globalUrl).replace(/\/$/, ""),
      model: values.AI_ASR_MODEL || environment.AI_ASR_MODEL || "FunAudioLLM/SenseVoiceSmall",
    };
    return { apiKey: globalKey, baseUrl: globalUrl, model: chat.model, visionModel: vision.model, asrModel: asr.model,
      chat, vision, asr };
  }

  async recordUsage(input: AIUsageInput) {
    const promptTokens = Math.max(0, input.promptTokens || 0);
    const completionTokens = Math.max(0, input.completionTokens || 0);
    const totalTokens = Math.max(0, input.totalTokens ?? promptTokens + completionTokens);
    const inputRate = Number(this.environment.AI_INPUT_COST_PER_MILLION_USD) || 0;
    const outputRate = Number(this.environment.AI_OUTPUT_COST_PER_MILLION_USD) || 0;
    const estimatedCostUsd = input.estimatedCostUsd ?? (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000;
    try {
      await this.repository.recordUsage({ ...input, promptTokens, completionTokens, totalTokens,
        latencyMs: input.latencyMs || 0, success: input.success !== false,
        estimatedCostUsd: Math.max(0, estimatedCostUsd), failureReason: input.failureReason ? sanitizeAIErrorMessage(input.failureReason) : undefined });
    } catch (error) {
      console.error("[AI usage persistence error]", error instanceof Error ? error.message : error);
    }
  }
}
