import { aiRuntimeService } from "./modules/aiRuntime/runtime.js";
import express, { type RequestHandler } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommunityError } from "./modules/community/errors.js";
import { initializeApplicationRuntime } from "./composition/runtime.js";
import { errorHandler, notFoundHandler, sendError } from "./utils/http.js";
import { requestContext, routerContext } from "./middleware/requestContext.js";
import { errorEnvelope } from "./middleware/errorEnvelope.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { SERVER_BUILD_TIME, SERVER_GIT_SHA, SERVER_VERSION } from "./version.js";
import { recoverAgentRuntime } from "./services/agent/runtime.js";
import { assertNoPublicServerSecrets, getProviderProfile } from "./providers/profiles.js";
import { createSiteSettingsRouter } from "./routes/site-settings.js";
import { observeOnboardingSaves } from "./modules/onboarding/observeSaves.js";
import { createAppUpdatesRouter } from "./routes/app-updates.js";

const staticAssetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

export async function createApp() {
  assertNoPublicServerSecrets();
  const providerProfile = getProviderProfile();
  const runtime = await initializeApplicationRuntime();
  const routes = runtime.routes;
  void recoverAgentRuntime().catch((error) => {
    console.error("[Agent recovery error]", error instanceof Error ? error.message : error);
  });
  const app = express();
  app.locals.closeRuntime = runtime.close;
  const uploadedMediaDir = path.resolve(process.env.MEDIA_LOCAL_ROOT || path.join(process.cwd(), "public"), "uploads");
  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:8080,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use(requestContext);
  app.use(requestLogger);
  app.use(errorEnvelope);
  app.use((req, res, next) => {
    if (process.env.NODE_ENV === "production" && process.env.REQUIRE_HTTPS !== "0" && !req.secure) {
      return sendError(res, 426, "生产环境仅允许 HTTPS", "HTTPS_REQUIRED");
    }
    return next();
  });
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  }));
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  app.use("/api/v1/ai", (_req, _res, next) => {
    void aiRuntimeService().withConfigurationSnapshot(() => next()).catch(next);
  });
  app.use(observeOnboardingSaves(runtime.onboardingService));
  app.use("/media/uploads", express.static(uploadedMediaDir, { maxAge: "1y", immutable: true }));
  app.use("/media", express.static(staticAssetsDir, { maxAge: "7d" }));
  app.get("/share/posts/:code", (req, res, next) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    const escapeHtml = (value: string) => value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]!));
    void runtime.communityService.resolveShare(code).then((share) => {
      const appUrl = `dietdigidose://post-detail?id=${share.post_id}&shareCode=${code}`;
      res.type("html").send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>食光社区分享</title><style>body{font-family:system-ui;background:#fdf8f0;color:#2d2924;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:520px;margin:24px;padding:28px;border-radius:24px;background:white;box-shadow:0 10px 40px #3d32291a}a{display:inline-block;margin-top:18px;padding:12px 20px;border-radius:999px;background:#2d6a4f;color:white;text-decoration:none}</style><div class="card"><h1>食光社区</h1><p><strong>${escapeHtml(String(share.username))}</strong> 的健康分享</p><p>${escapeHtml(String(share.content).slice(0, 220))}</p><a href="${appUrl}">打开食光烙记查看</a><p><small>未安装 App 时，可保存分享码 SG${code}，安装后打开 App 即可识别。</small></p></div></html>`);
    }).catch((error) => error instanceof CommunityError && error.status === 404
      ? res.status(404).type("html").send("<!doctype html><meta charset=utf-8><title>分享已失效</title><p>该食光分享已失效或不存在。</p>")
      : next(error));
  });

  app.get("/api/v1/health", (_req, res) => res.status(200).json({
    status: "ok",
    databaseDriver: runtime.driver,
    deploymentProfile: providerProfile.id,
    providers: providerProfile.providers,
  }));
  app.get("/api/v1/version", (req, res) => res.status(200).json({
    serverVersion: SERVER_VERSION,
    serverBuildTime: SERVER_BUILD_TIME,
    serverGitSha: SERVER_GIT_SHA,
    clientVersion: req.get("x-client-version") || null,
    clientBuildTime: req.get("x-client-build-time") || null,
  }));
  app.get("/api/v1/ai-data-policy", (_req, res) => res.json({
    providerName: process.env.AI_PROVIDER_NAME?.trim() || "由部署运营方配置的 AI 模型服务商",
    providerPrivacyUrl: process.env.AI_PROVIDER_PRIVACY_URL?.trim() || null,
    processingRegion: process.env.AI_PROCESSING_REGION?.trim() || "以部署运营方正式披露为准",
    conversationRetentionDays: Math.max(1, Number(process.env.AI_CONVERSATION_RETENTION_DAYS) || 90),
    supportContact: process.env.PRIVACY_SUPPORT_CONTACT?.trim() || "应用商店开发者联系方式",
  }));
  const mountRouter = (template: string, router: RequestHandler) => {
    app.use(template, routerContext(template), router);
  };
  mountRouter("/api/v1/site-settings", createSiteSettingsRouter());
  mountRouter("/api/v1/app-updates", createAppUpdatesRouter());
  mountRouter("/api/v1/auth", routes.auth);
  mountRouter("/api/v1/webhooks", routes.webhooks);
  mountRouter("/api/v1/inventory", routes.inventory);
  mountRouter("/api/v1/diet-records", routes.dietRecords);
  mountRouter("/api/v1/health-data", routes.healthData);
  mountRouter("/api/v1/onboarding", routes.onboarding);
  mountRouter("/api/v1/recipes", routes.recipes);
  mountRouter("/api/v1/foods", routes.foods);
  mountRouter("/api/v1/community", routes.community);
  mountRouter("/api/v1/admin", routes.admin);
  mountRouter("/api/v1/ai/realtime-voice", routes.realtimeVoice);
  mountRouter("/api/v1/ai/voice-packs", routes.voicePacks);
  mountRouter("/api/v1/ai", routes.ai);
  mountRouter("/api/v1/ai", routes.agentRuns);
  mountRouter("/api/v1/shopping-list", routes.shopping);
  mountRouter("/api/v1/cooking-queue", routes.cookingQueue);
  mountRouter("/api/v1/meal-plans", routes.mealPlans);
  mountRouter("/api/v1/insights", routes.insights);
  mountRouter("/api/v1/recommendations", routes.recommendations);
  mountRouter("/api/v1/plan-maintenance", routes.planMaintenance);
  mountRouter("/api/v1/kitchenware", routes.kitchenware);
  mountRouter("/api/v1/notifications", routes.notifications);
  mountRouter("/api/v1/media", routes.media);
  mountRouter("/api/v1/households", routes.households);
  mountRouter("/api/v1/feedback", routes.feedback);

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      return sendError(res, 400, "请求 JSON 格式错误", "INVALID_JSON");
    }
    if (typeof error === "object" && error && "type" in error && error.type === "entity.too.large") {
      return sendError(res, 413, "请求内容过大", "PAYLOAD_TOO_LARGE");
    }
    return next(error);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
