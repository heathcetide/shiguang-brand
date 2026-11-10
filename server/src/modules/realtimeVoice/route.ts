import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { uuidParam } from "../../middleware/validateParam.js";
import { sharedRateLimit } from "../../middleware/sharedRateLimit.js";
import { sendError } from "../../utils/http.js";
import { realtimeVoiceAudioChunkSchema, realtimeVoiceHeartbeatSchema, realtimeVoiceSessionSchema, realtimeVoiceTurnSchema } from "../../validation/schemas.js";
import { RealtimeVoiceError } from "./errors.js";
import type { RealtimeVoiceService } from "./service.js";

function handle(error: unknown, res: Response, next: NextFunction) {
  return error instanceof RealtimeVoiceError ? sendError(res, error.status, error.message, error.code) : next(error);
}

export function createRealtimeVoiceRouter(service: RealtimeVoiceService) {
  const router = Router();
  router.use(authMiddleware);
  const turnLimit = sharedRateLimit({ namespace: "realtime-voice-user",
    limit: Math.max(10, Number(process.env.REALTIME_VOICE_RATE_LIMIT) || 90), windowMs: 15 * 60 * 1000,
    key: (req) => String((req as AuthRequest).userId || "unknown"), message: "实时语音请求过于频繁，请稍后重试", code: "REALTIME_VOICE_RATE_LIMITED" });
  const audioLimit = sharedRateLimit({ namespace: "realtime-voice-audio-user",
    limit: Math.max(30, Number(process.env.REALTIME_VOICE_AUDIO_RATE_LIMIT) || 300), windowMs: 15 * 60 * 1000,
    key: (req) => String((req as AuthRequest).userId || "unknown"), message: "实时语音分段过于频繁，请稍后重试", code: "REALTIME_VOICE_AUDIO_RATE_LIMITED" });
  router.use((req, res, next) => req.method === "POST" && req.path.endsWith("/turns") ? turnLimit(req, res, next)
    : req.method === "POST" && req.path.endsWith("/audio-chunks") ? audioLimit(req, res, next) : next());
  router.param("sessionId", uuidParam);

  router.post("/sessions", validateBody(realtimeVoiceSessionSchema), (req: AuthRequest, res, next) => {
    void service.create(req.userId!, req.body).then((value) => res.status(value.repeated ? 200 : 201).json(value))
      .catch((error) => handle(error, res, next));
  });
  router.post("/sessions/:sessionId/heartbeat", validateBody(realtimeVoiceHeartbeatSchema), (req: AuthRequest, res, next) => {
    void service.heartbeat(req.userId!, String(req.params.sessionId), req.body).then((value) => res.json(value))
      .catch((error) => handle(error, res, next));
  });
  router.post("/sessions/:sessionId/audio-chunks", validateBody(realtimeVoiceAudioChunkSchema), (req: AuthRequest, res, next) => {
    void service.audio(req.userId!, String(req.params.sessionId), req.body).then((value) => res.status(value.repeated ? 200 : 201).json(value))
      .catch((error) => handle(error, res, next));
  });
  router.post("/sessions/:sessionId/turns", validateBody(realtimeVoiceTurnSchema), (req: AuthRequest, res, next) => {
    void service.turn(req.userId!, String(req.params.sessionId), req.body).then((value) =>
      res.status(value.repeated ? 200 : "run" in value ? 202 : 201).json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/sessions/:sessionId/events", (req: AuthRequest, res, next) => {
    const after = Math.max(0, Number(req.query.after) || 0);
    void service.sessionEvents(req.userId!, String(req.params.sessionId), after).then((value) => res.json(value))
      .catch((error) => handle(error, res, next));
  });
  router.get("/sessions/:sessionId/stream", (req: AuthRequest, res, next) => {
    let after = Math.max(0, Number(req.query.after) || 0); let running = false;
    void service.sessionEvents(req.userId!, String(req.params.sessionId), after).then((initial) => {
      res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
      const write = (events: typeof initial.events) => events.forEach((event) => {
        after = event.sequence; res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      });
      write(initial.events);
      const send = async () => {
        if (running) return; running = true;
        try { write((await service.sessionEvents(req.userId!, String(req.params.sessionId), after)).events); res.write(": heartbeat\n\n"); }
        catch { res.end(); } finally { running = false; }
      };
      const timer = setInterval(() => void send(), 1_000);
      req.on("close", () => clearInterval(timer));
    }).catch((error) => handle(error, res, next));
  });
  router.delete("/sessions/:sessionId", (req: AuthRequest, res, next) => {
    void service.close(req.userId!, String(req.params.sessionId)).then((value) => res.json(value))
      .catch((error) => handle(error, res, next));
  });
  return router;
}
