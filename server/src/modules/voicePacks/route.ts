import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { sharedRateLimit } from "../../middleware/sharedRateLimit.js";
import { aiRuntimeService } from "../aiRuntime/runtime.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";
import { sendError } from "../../utils/http.js";
import { safeHttpsUrl } from "./manifest.js";
import { VoicePacksError } from "./errors.js";
import type { VoicePacksService } from "./service.js";

function handle(error: unknown, res: Response, next: NextFunction) { return error instanceof VoicePacksError ? sendError(res, error.status, error.message, error.code) : next(error); }
export function createVoicePacksRouter(service: VoicePacksService) {
  const router = Router(); router.use(authMiddleware);
  const limiter = sharedRateLimit({ namespace: "tts-user", limit: Math.max(10, Number(process.env.TTS_RATE_LIMIT) || 120), windowMs: 15 * 60 * 1000,
    key: (req) => String((req as AuthRequest).userId || "unknown"), message: "语音合成请求过于频繁，请稍后重试", code: "TTS_RATE_LIMITED" });
  router.get("/", (req, res, next) => { void service.catalog(String(req.get("x-client-version") || "0.0.0")).then((catalog) => {
    res.set("ETag", `W/\"voice-catalog-${catalog.catalogVersion}\"`); res.json({ ...catalog, syntheticVoiceDisclosure: "音色包生成的内容属于合成语音；模型文件安装到设备后可能被提取。" });
  }).catch(next); });
  router.get("/preference", (req: AuthRequest, res, next) => { void service.preference(req.userId!).then((value) => res.json(value)).catch(next); });
  router.put("/preference", (req: AuthRequest, res: Response, next: NextFunction) => { void service.updatePreference(req.userId!, req.body || {})
    .then((value) => res.json(value)).catch((error: unknown) => handle(error, res, next)); });
  router.post("/synthesize", limiter, async (req: AuthRequest, res, next) => {
    const text = String(req.body?.text || "").trim(); if (!text || text.length > 600) return sendError(res, 400, "朗读文本需为 1-600 个字符", "INVALID_TTS_TEXT");
    const voiceId = req.body?.voiceId == null ? null : String(req.body.voiceId); const version = req.body?.version == null ? null : String(req.body.version);
    try {
      const selected = voiceId ? await service.findPublished(voiceId, version) : null;
      if (voiceId && !selected) return sendError(res, 400, "音色未发布或已撤销", "VOICE_PACK_NOT_AVAILABLE");
      const configuredBase = String(process.env.TTS_BASE_URL || "").trim().replace(/\/$/, ""); const configuredKey = String(process.env.TTS_API_KEY || "").trim();
      const chat = await aiRuntimeService().legacyChatConfig(); const baseUrl = configuredBase || chat.baseUrl; const apiKey = configuredKey || chat.apiKey;
      if (!apiKey || !safeHttpsUrl(baseUrl)) return sendError(res, 503, "云端语音暂不可用", "TTS_NOT_CONFIGURED");
      const response = await fetchWithTimeout(`${baseUrl}/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: process.env.TTS_MODEL || "gpt-4o-mini-tts", voice: selected?.provider_voice || process.env.TTS_VOICE || "alloy", input: text, response_format: "mp3" }) }, 30_000);
      if (!response.ok) return sendError(res, 502, "云端语音生成失败", "TTS_UPSTREAM_FAILED");
      const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length || bytes.length > 8_000_000) return sendError(res, 502, "云端语音响应无效", "TTS_INVALID_RESPONSE");
      return res.json({ audioBase64: bytes.toString("base64"), mimeType: "audio/mpeg", source: "server", userId: req.userId });
    } catch (error) { if (error instanceof VoicePacksError) return handle(error, res, next); return sendError(res, 504, "云端语音请求超时", "TTS_TIMEOUT"); }
  });
  return router;
}
