import { Router } from "express";
import { aiRuntimeService } from "../modules/aiRuntime/runtime.js";

export const SITE_SETTING_KEYS = [
  "SITE_FILING_ENABLED",
  "SITE_FILING_TEXT",
  "SITE_FILING_URL",
] as const;

export function createSiteSettingsRouter() {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const settings = await aiRuntimeService().settings([...SITE_SETTING_KEYS]);
      const text = settings.SITE_FILING_TEXT?.trim() || "";
      res.json({
        filing: {
          enabled: settings.SITE_FILING_ENABLED === "true" && text.length > 0,
          text,
          url: settings.SITE_FILING_URL?.trim() || "",
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
