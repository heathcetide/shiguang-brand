import { Router, type NextFunction, type Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import { VoicePacksError } from "./errors.js";
import type { VoicePacksService } from "./service.js";
const statuses = ["draft", "published", "disabled", "revoked"];
function handle(error: unknown, res: Response, next: NextFunction) { return error instanceof VoicePacksError ? sendError(res, error.status, error.message, error.code) : next(error); }
function context(req: AuthRequest) { return { ipAddress: req.ip, userAgent: req.get("user-agent") || null }; }
export function createAdminVoicePackRouter(service: VoicePacksService) {
  const router = Router(); router.param("id", positiveIntegerParam);
  router.get("/voice-packs", (req, res, next) => { const status = typeof req.query.status === "string" && statuses.includes(req.query.status) ? req.query.status : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""; void service.adminList(status, search).then((value) => res.json(value)).catch(next); });
  router.get("/voice-packs/:id/history", (req, res: Response, next) => { void service.history(Number(req.params.id)).then((value) => res.json(value)).catch((error) => handle(error, res, next)); });
  router.post("/voice-packs", (req: AuthRequest, res: Response, next) => { void service.create(req.userId!, req.body || {}, context(req)).then((item) => res.status(201).json({ item })).catch((error) => handle(error, res, next)); });
  router.put("/voice-packs/:id", (req: AuthRequest, res: Response, next) => { void service.update(req.userId!, Number(req.params.id), req.body || {}, context(req)).then((item) => res.json({ item })).catch((error) => handle(error, res, next)); });
  for (const target of ["published", "disabled", "revoked"] as const) {
    const path = target === "published" ? "publish" : target === "disabled" ? "disable" : "revoke";
    router.post(`/voice-packs/:id/${path}`, (req: AuthRequest, res: Response, next) => { void service.transition(req.userId!, Number(req.params.id), target, req.body || {}, context(req))
      .then((item) => res.json({ item })).catch((error) => handle(error, res, next)); });
  }
  return router;
}
