import { serviceIds, type ServiceId } from "../../modules/aiRuntime/resources.js";
import { testAIConnection } from "../../services/aiService.js";
import { AIResourceConflictError, AIResourceValidationError } from "../../modules/aiRuntime/service.js";
import { thinkingParameters } from "../../modules/aiRuntime/policy.js";
import { Router } from "express";
import { aiRuntimeService } from "../../modules/aiRuntime/runtime.js";
import { DEFAULT_AI_PERSONA_PROMPT } from "../../services/contextBuilder.js";
import { validateBody } from "../../middleware/validate.js";
import { adminAIConfigSchema } from "../../validation/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { auditAdminAction } from "./shared.js";

export function createAdminAIConfigRouter() {
  const router = Router();

  // All mutations below save a draft; only the version-checked publish operation changes runtime values.
  router.get("/ai-config/resources", async (_req, res) => {
    try { res.json(await aiRuntimeService().resourceConfiguration()); }
    catch { res.status(500).json({ error: "获取资源配置失败" }); }
  });
  router.post("/ai-config/resources/migrate", async (req: AuthRequest, res) => {
    try {
      const result = await aiRuntimeService().migrateResources();
      await auditAdminAction(req, { action: "ai_resources.migrate", resourceType: "ai_config", resourceId: "global", summary: "迁移 AI 资源配置" });
      res.json(result);
    } catch { res.status(400).json({ error: "迁移资源配置失败，请重新读取配置确认状态" }); }
  });
  router.put("/ai-config/resources", async (req: AuthRequest, res) => {
    try {
      const result = await aiRuntimeService().saveResourceConfiguration(req.body);
      await auditAdminAction(req, { action: "ai_resources.update", resourceType: "ai_config", resourceId: "global", summary: "更新 AI 资源与业务服务配置" });
      res.json(result);
    } catch (error) {
      if (error instanceof AIResourceConflictError) res.status(409).json({ code: "AI_RESOURCE_CONFLICT", error: "配置版本已变更，请重新读取" });
      else if (error instanceof AIResourceValidationError) res.status(400).json({ code: "AI_RESOURCE_INVALID", error: "资源、能力绑定或策略不兼容" });
      else res.status(500).json({ code: "AI_RESOURCE_SAVE_FAILED", error: "保存未确认，请重新读取核对" });
    }
  });

  for (const action of ["test", "publish", "discard"] as const) {
    router.post(`/ai-config/resources/${action}`, async (req: AuthRequest, res) => {
      if (!Number.isSafeInteger(req.body?.revision) || req.body.revision < 0 || Object.keys(req.body).some(key => key !== "revision" && !(action === "test" && key === "service")) || (req.body.service !== undefined && !serviceIds.includes(req.body.service))) {
        res.status(400).json({ error: "必须指定已保存草稿版本" }); return;
      }
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.on("close", cancel);
      try {
        const service = aiRuntimeService();
        const result = action === "test" ? await service.testDraft(req.body.revision, req.body.service ? { service: req.body.service as ServiceId, signal: controller.signal, run: config => testAIConnection({ ...config, signal: controller.signal }) } : undefined) : action === "discard" ? await service.discardDraft(req.body.revision) : await service.publishDraft(req.body.revision);
        await auditAdminAction(req, { action: `ai_resources.${action}`, resourceType: "ai_config", resourceId: "global", summary: action === "test" ? "校验 AI 草稿（不验证供应商能力）" : action === "discard" ? "放弃 AI 草稿" : "发布 AI 配置" });
        res.json(result);
      } catch (error) {
        res.status(error instanceof AIResourceConflictError ? 409 : error instanceof AIResourceValidationError ? 400 : 500)
          .json({ error: "操作未确认：版本冲突、未测试或配置不兼容；请重新读取核对" });
      } finally { res.off("close", cancel); }
    });
  }

  router.get("/ai-config", async (_req, res) => {
    try {
      const { values: settings, revision: draftRevision } = await aiRuntimeService().draftSettingsSnapshot();
      const config = await aiRuntimeService().config(settings);
      const [supervisor, nutrition, recipe, operations] = await Promise.all(
        (["SUPERVISOR", "NUTRITION", "RECIPE", "OPERATIONS"] as const).map(role => aiRuntimeService().agentConfig(role, settings)),
      );
      const formatMasked = (key?: string) =>
        key ? "********" : "";

      // Only non-secret editable values. Never spread settings: it includes credential
      // values and the credential-bearing resource document.
      const editableNames = {
        baseUrl: "AI_BASE_URL", model: "AI_MODEL", chatBaseUrl: "AI_CHAT_BASE_URL", chatModel: "AI_CHAT_MODEL",
        visionBaseUrl: "AI_VISION_BASE_URL", visionModel: "AI_VISION_MODEL", asrBaseUrl: "AI_ASR_BASE_URL", asrModel: "AI_ASR_MODEL",
        supervisorModel: "AI_SUPERVISOR_MODEL", nutritionModel: "AI_NUTRITION_MODEL", recipeModel: "AI_RECIPE_MODEL", operationsModel: "AI_OPERATIONS_MODEL",
        systemPrompt: "AI_SYSTEM_PROMPT",
      };
      const editable = Object.fromEntries(Object.entries(editableNames).map(([name, key]) => [name, settings[key] ?? ""]));
      res.json({
        editable,
        draftRevision,
        credentialState: { global: !!settings.AI_API_KEY, chat: !!settings.AI_CHAT_API_KEY, vision: !!settings.AI_VISION_API_KEY, asr: !!settings.AI_ASR_API_KEY },
        maskedKey: formatMasked(config.apiKey),
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        visionModel: config.visionModel,
        asrModel: config.asrModel,
        runtimePolicy: await aiRuntimeService().runtimePolicy(settings),
        effectiveModels: [
          { role: "主助手", model: supervisor.model, source: "有效业务服务配置", baseUrl: supervisor.baseUrl },
          { role: "规划", model: nutrition.model, source: "有效业务服务配置", baseUrl: nutrition.baseUrl },
          { role: "图片", model: config.vision.model, source: settings.AI_RESOURCE_CONFIG_V1 ? "有效业务服务配置" : settings.AI_VISION_MODEL ? "图片设置" : "环境变量或内置默认", baseUrl: config.vision.baseUrl },
          { role: "转写", model: config.asr.model, source: settings.AI_RESOURCE_CONFIG_V1 ? "有效业务服务配置" : settings.AI_ASR_MODEL ? "转写设置" : "环境变量或内置默认", baseUrl: config.asr.baseUrl },
          { role: "对话", model: config.chat.model, source: "有效业务服务配置", baseUrl: config.chat.baseUrl },
          { role: "菜谱", model: recipe.model, source: "有效业务服务配置", baseUrl: recipe.baseUrl },
          { role: "运营", model: operations.model, source: "有效业务服务配置", baseUrl: operations.baseUrl },
        ],
        agents: {
          supervisorModel: supervisor.model,
          nutritionModel: nutrition.model,
          recipeModel: recipe.model,
          operationsModel: operations.model,
        },

        chat: {
          maskedKey: formatMasked(config.chat.apiKey),
          hasApiKey: !!config.chat.apiKey,
          baseUrl: config.chat.baseUrl,
          model: config.chat.model,
          isCustomKey: !!settings.AI_CHAT_API_KEY,
          isCustomUrl: !!settings.AI_CHAT_BASE_URL,
        },
        vision: {
          maskedKey: formatMasked(config.vision.apiKey),
          hasApiKey: !!config.vision.apiKey,
          baseUrl: config.vision.baseUrl,
          model: config.vision.model,
          isCustomKey: !!settings.AI_VISION_API_KEY,
          isCustomUrl: !!settings.AI_VISION_BASE_URL,
        },
        asr: {
          maskedKey: formatMasked(config.asr.apiKey),
          hasApiKey: !!config.asr.apiKey,
          baseUrl: config.asr.baseUrl,
          model: config.asr.model,
          isCustomKey: !!settings.AI_ASR_API_KEY,
          isCustomUrl: !!settings.AI_ASR_BASE_URL,
        },

        systemPrompt: settings.AI_SYSTEM_PROMPT?.trim() || DEFAULT_AI_PERSONA_PROMPT,
        isSystemPromptCustomized: !!settings.AI_SYSTEM_PROMPT?.trim(),
        isConfiguredFromDB: !!settings.AI_API_KEY,
      });
    } catch {
      res.status(500).json({ error: "获取 AI 配置失败" });
    }
  });

  router.put("/ai-config", validateBody(adminAIConfigSchema), async (req: AuthRequest, res) => {
    try {
      const {
        apiKey, baseUrl, model, visionModel, asrModel,
        supervisorModel, nutritionModel, recipeModel, operationsModel,
        chatApiKey, chatBaseUrl, chatModel,
        visionApiKey, visionBaseUrl,
        asrApiKey, asrBaseUrl,
        systemPrompt,
      } = req.body;

      const entries: Array<{ key: string; value: string }> = [];
      const add = (key: string, value: string | undefined) => {
        if (value !== undefined) entries.push({ key, value: value.trim() });
      };
      add("AI_API_KEY", apiKey);
      add("AI_BASE_URL", baseUrl); add("AI_MODEL", model); add("AI_VISION_MODEL", visionModel); add("AI_ASR_MODEL", asrModel);
      add("AI_SUPERVISOR_MODEL", supervisorModel); add("AI_NUTRITION_MODEL", nutritionModel);
      add("AI_RECIPE_MODEL", recipeModel); add("AI_OPERATIONS_MODEL", operationsModel);
      add("AI_CHAT_API_KEY", chatApiKey); add("AI_CHAT_BASE_URL", chatBaseUrl);
      if (chatModel !== undefined) {
        add("AI_CHAT_MODEL", chatModel);
        add("AI_MODEL", chatModel);
      }
      add("AI_VISION_API_KEY", visionApiKey); add("AI_VISION_BASE_URL", visionBaseUrl);
      add("AI_ASR_API_KEY", asrApiKey); add("AI_ASR_BASE_URL", asrBaseUrl); add("AI_SYSTEM_PROMPT", systemPrompt);
      const current = await aiRuntimeService().draftSettings();
      {
        const merged = { ...current, ...Object.fromEntries(entries.map((entry) => [entry.key, entry.value])) };
        const effective = await aiRuntimeService().config(merged);
        const policy = req.body.runtimePolicy || await aiRuntimeService().runtimePolicy(current);
        for (const role of ["SUPERVISOR", "RECIPE", "OPERATIONS", "NUTRITION"] as const) {
          const agent = await aiRuntimeService().agentConfig(role, merged);
          thinkingParameters(agent.baseUrl, agent.model, role === "NUTRITION" ? policy.planner : policy.main);
        }
        thinkingParameters(effective.chat.baseUrl, effective.chat.model, policy.main);
        thinkingParameters(effective.vision.baseUrl, effective.vision.model, policy.vision);
        if (policy.asr.thinking !== "default" || policy.asr.thinkingBudget !== undefined) throw new Error("语音转写不支持思考策略，请选择提供商默认");
        entries.push({ key: "AI_RUNTIME_POLICY", value: JSON.stringify(policy) });
      }
      await aiRuntimeService().saveValidatedSettings(entries, current, req.body.draftRevision);

      if (req.userId) {
        await auditAdminAction(req, {
          action: "ai_config.update",
          resourceType: "ai_config",
          resourceId: "global",
          summary: "更新 AI 模型服务配置",
          details: {
            apiKeyChanged: apiKey !== undefined,
            baseUrlChanged: baseUrl !== undefined,
            modelChanged: model !== undefined,
            visionModelChanged: visionModel !== undefined,
            asrModelChanged: asrModel !== undefined,
            supervisorModelChanged: supervisorModel !== undefined,
            nutritionModelChanged: nutritionModel !== undefined,
            recipeModelChanged: recipeModel !== undefined,
            operationsModelChanged: operationsModel !== undefined,
            systemPromptChanged: systemPrompt !== undefined,
          },
        });
      }
      res.json({ success: true, message: "AI 草稿已保存，请在业务服务页测试并发布" });
    } catch (error) {
      if (error instanceof AIResourceConflictError) res.status(409).json({ code: "AI_RESOURCE_CONFLICT", error: "配置版本已变更，请重新读取" });
      else res.status(400).json({ error: error instanceof Error && /思考|参数/.test(error.message) ? error.message : "更新 AI 配置失败，请检查模型与策略配置" });
    }
  });

  router.post("/ai-config/test", (_req, res) => {
    res.status(410).json({ error: "请使用带草稿版本的 /ai-config/resources/test；此接口不再执行无版本连接测试" });
  });

  return router;
}
