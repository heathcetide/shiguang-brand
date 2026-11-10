import { Router } from "express";
import { open } from "node:fs/promises";
import { APP_UPDATE_MANIFEST_MAX_BYTES, appUpdateManifestSchema, appUpdateQuerySchema } from "@dietdigidose/contracts";
import { sendError } from "../utils/http.js";
import { validateAllowedOrigins } from "../services/appUpdateManifestService.js";

export function createAppUpdatesRouter(options = {
  manifestPath: process.env.APP_UPDATE_MANIFEST_PATH,
  allowedOrigins: process.env.APP_UPDATE_ALLOWED_ORIGINS,
}) {
  const router = Router();
  router.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");
    const query = appUpdateQuerySchema.safeParse(req.query);
    if (!query.success) return sendError(res, 400, "更新检查参数无效", "INVALID_UPDATE_QUERY");
    const unavailable = () => sendError(res, 503, "暂时无法检查更新，请稍后重试", "APP_UPDATES_UNAVAILABLE");
    const { origins, error: originsError } = validateAllowedOrigins(options.allowedOrigins);
    if (!options.manifestPath || originsError || origins.length === 0) return unavailable();
    void (async () => {
      const file = await open(options.manifestPath!, "r");
      let contents: string;
      try {
        const buffer = Buffer.alloc(APP_UPDATE_MANIFEST_MAX_BYTES + 1);
        const { bytesRead } = await file.read(buffer);
        if (bytesRead > APP_UPDATE_MANIFEST_MAX_BYTES) throw new Error("Update manifest is too large");
        contents = buffer.subarray(0, bytesRead).toString("utf8");
      } finally { await file.close(); }
      const manifest = appUpdateManifestSchema.parse(JSON.parse(contents));
      if (manifest.releases.some((release) => !origins.includes(new URL(release.url).origin))) throw new Error("Untrusted APK origin");
      const update = manifest.releases.find((release) => release.applicationId === query.data.applicationId
        && release.channel === query.data.channel && release.buildNumber > query.data.buildNumber) ?? null;
      res.json({ update });
    })().catch(unavailable);
  });
  return router;
}
