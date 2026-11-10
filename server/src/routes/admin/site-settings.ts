import { Router } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { aiRuntimeService } from "../../modules/aiRuntime/runtime.js";
import { adminSiteSettingsSchema } from "../../validation/schemas.js";
import { SITE_SETTING_KEYS } from "../site-settings.js";
import { auditAdminAction } from "./shared.js";

export function createAdminSiteSettingsRouter() {
  const router = Router();

  router.get("/site-settings", async (_req, res, next) => {
    try {
      const settings = await aiRuntimeService().settings([...SITE_SETTING_KEYS]);
      res.json({
        filingEnabled: settings.SITE_FILING_ENABLED === "true",
        filingText: settings.SITE_FILING_TEXT?.trim() || "",
        filingUrl: settings.SITE_FILING_URL?.trim() || "",
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/site-settings", validateBody(adminSiteSettingsSchema), async (req: AuthRequest, res, next) => {
    try {
      const { filingEnabled, filingText, filingUrl } = req.body;
      await aiRuntimeService().saveSettings([
        { key: "SITE_FILING_ENABLED", value: String(filingEnabled) },
        { key: "SITE_FILING_TEXT", value: filingText },
        { key: "SITE_FILING_URL", value: filingUrl },
      ]);
      await auditAdminAction(req, {
        action: "site_settings.update",
        resourceType: "site_settings",
        resourceId: "global",
        summary: "更新网站备案展示配置",
        details: { filingEnabled, hasFilingText: filingText.length > 0, hasFilingUrl: filingUrl.length > 0 },
      });
      res.json({ success: true, message: "网站设置已保存" });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
