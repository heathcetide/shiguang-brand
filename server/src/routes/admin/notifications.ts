import { Router, type NextFunction } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { notificationsService } from "../../modules/notifications/runtime.js";
import { notificationCampaignSchema } from "../../validation/schemas.js";
import { auditAdminAction } from "./shared.js";

export function createAdminNotificationsRouter() {
  const router = Router();

  router.get("/notifications", (_req, res, next) => {
    void notificationsService().adminData().then((value) => res.json(value)).catch(next);
  });

  router.post("/notifications/campaigns", validateBody(notificationCampaignSchema), (req: AuthRequest, res, next: NextFunction) => {
    const { title, body } = req.body;
    void notificationsService().sendCampaign(req.userId!, title, body).then(async (result) => {
      await auditAdminAction(req, { action: "notifications.campaign.send", resourceType: "notification_campaign",
        resourceId: result.id, summary: `发送通知「${title}」给 ${result.recipients} 位用户` });
      res.status(201).json(result);
    }).catch(next);
  });

  return router;
}
