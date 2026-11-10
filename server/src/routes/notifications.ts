import { interventionPreferencesUpdateSchema, interventionFeedbackSchema } from "@dietdigidose/contracts";
import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { notificationsService } from "../modules/notifications/runtime.js";
import {
  localNotificationEventSchema,
  notificationActionSchema,
  notificationPreferencesSchema,
  pushDeviceSchema,
} from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);

function run<T>(promise: Promise<T>, res: Response, next: NextFunction, respond: (value: T) => void) {
  void promise.then(respond).catch(next);
}

router.post("/interventions/:id/feedback",validateBody(interventionFeedbackSchema),(req: AuthRequest,res,next) => {
  const id = String(req.params.id);
  if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: "干预 ID 无效" });
  return run(notificationsService().feedbackIntervention(req.userId!,id,req.body),res,next,value => {
    if (value.ok) res.json(value.result);
    else res.status(value.status).json({ error: value.status === 404 ? "干预通知不存在" : "提醒或操作已变化，请刷新后重试",code: value.code });
  });
});

router.get("/interventions/:id", (req: AuthRequest,res,next) => {
  const id = String(req.params.id);
  if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: "干预 ID 无效" });
  return run(notificationsService().interventionCard(req.userId!,id),res,next,value => {
    if (!value) res.status(404).json({ error: "干预通知不存在" }); else res.json(value);
  });
});

router.get("/intervention-preferences", (req: AuthRequest,res,next) =>
  run(notificationsService().interventionPreferences(req.userId!),res,next,value => res.json(value)));
router.put("/intervention-preferences", validateBody(interventionPreferencesUpdateSchema), (req: AuthRequest,res,next) =>
  run(notificationsService().saveInterventionPreferences(req.userId!,req.body),res,next,value => {
    if (!value) res.status(409).json({ error: "干预设置已变化，请重新加载后修改" }); else res.json(value);
  }));

router.get("/preferences", (req: AuthRequest, res, next) =>
  run(notificationsService().preferences(req.userId!), res, next, (value) => res.json(value)));

router.put("/preferences", validateBody(notificationPreferencesSchema), (req: AuthRequest, res, next) =>
  run(notificationsService().savePreferences(req.userId!, req.body), res, next, (value) => res.json(value)));

router.put("/device", validateBody(pushDeviceSchema), (req: AuthRequest, res, next) =>
  run(notificationsService().saveDevice(req.userId!, req.body.expo_push_token, req.body.platform), res, next, () => res.status(204).end()));

router.get("/unread-count", (req: AuthRequest, res, next) =>
  run(notificationsService().unreadCount(req.userId!), res, next, (count) => res.json({ count })));

router.get("/history", (req: AuthRequest, res, next) => {
  const cursorValue = typeof req.query.cursor === "string" ? Number(req.query.cursor) : null;
  const cursor = Number.isSafeInteger(cursorValue) && Number(cursorValue) > 0 ? Number(cursorValue) : null;
  const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const filter = req.query.filter === "pending" || req.query.filter === "system" ? req.query.filter : "all";
  return run(notificationsService().history(req.userId!, filter, cursor, limit), res, next, (value) => res.json(value));
});

router.put("/read-all", (req: AuthRequest, res, next) =>
  run(notificationsService().readAll(req.userId!), res, next, (updated) => res.json({ updated })));

router.put("/:id/read", (req: AuthRequest, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "通知 ID 无效" });
  return run(notificationsService().read(req.userId!, id), res, next, (found) => {
    if (!found) res.status(404).json({ error: "通知不存在" });
    else res.json({ id, isRead: true });
  });
});

router.post("/:id/actions", validateBody(notificationActionSchema), (req: AuthRequest, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "通知 ID 无效" });
  const { action, metadata } = req.body;
  return run(notificationsService().action(req.userId!, id, action, metadata), res, next, (found) => {
    if (!found) res.status(404).json({ error: "通知不存在" });
    else res.json({ id, action, actionStatus: action === "complete" ? "completed" : "pending" });
  });
});

router.post("/local-event", validateBody(localNotificationEventSchema), (req: AuthRequest, res, next) => {
  const { kind, title, body, event, source_id: sourceId } = req.body;
  return run(notificationsService().localEvent({ userId: req.userId!, kind, title, body, event, sourceId }), res, next,
    (id) => res.status(201).json({ id }));
});

export default router;
