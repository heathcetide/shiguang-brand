import { Router } from "express";
import { z } from "zod";
import {
  appUpdateApplicationIdSchema,
  appUpdateChannelSchema,
  appUpdateReleaseSchema,
} from "@dietdigidose/contracts";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import { auditAdminAction } from "./shared.js";
import {
  mutateAppUpdateManifest,
  readAppUpdateManifest,
  replaceManifestRelease,
  revokeManifestRelease,
  validateAllowedOrigins,
} from "../../services/appUpdateManifestService.js";

const revokeBodySchema = z.object({
  applicationId: appUpdateApplicationIdSchema,
  channel: appUpdateChannelSchema,
}).strict();

export function createAdminAppUpdatesRouter(options = {
  manifestPath: process.env.APP_UPDATE_MANIFEST_PATH,
  allowedOrigins: process.env.APP_UPDATE_ALLOWED_ORIGINS,
}) {
  const router = Router();

  router.get("/app-updates", async (_req, res, next) => {
    try {
      const { origins: allowedOrigins, error: originsError } = validateAllowedOrigins(options.allowedOrigins);
      const { configured, path, manifest, missing, error: manifestError } = await readAppUpdateManifest(options.manifestPath);
      const error = originsError || manifestError
        || (missing ? "清单文件尚不存在，请发布首个版本或部署有效清单" : null)
        || (manifest.releases.some((release) => !allowedOrigins.includes(new URL(release.url).origin))
          ? "清单包含未授权的 APK 下载源，请撤下对应版本或修正下载源配置" : null);
      res.json({
        configured: configured && !error && allowedOrigins.length > 0,
        manifestPath: path,
        allowedOrigins,
        manifest,
        error,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/app-updates/publish",
    validateBody(appUpdateReleaseSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const manifestPath = options.manifestPath;
        const { origins: allowedOrigins, error: originsError } = validateAllowedOrigins(options.allowedOrigins);
        if (originsError) {
          return sendError(res, 500, `服务端下载源白名单配置错误: ${originsError}`, "APP_UPDATE_CONFIG_INVALID");
        }
        if (!manifestPath || allowedOrigins.length === 0) {
          return sendError(res, 400, "服务端尚未配置 APP_UPDATE_MANIFEST_PATH 或 APP_UPDATE_ALLOWED_ORIGINS", "APP_UPDATE_CONFIG_MISSING");
        }
        const release = req.body;
        const urlOrigin = new URL(release.url).origin.toLowerCase();
        if (!allowedOrigins.some((allowed) => allowed.toLowerCase() === urlOrigin)) {
          return sendError(res, 400, `APK 下载域名 ${urlOrigin} 不在受信任的下载源白名单中`, "UNTRUSTED_APK_ORIGIN");
        }

        let updatedManifest;
        try {
          updatedManifest = await mutateAppUpdateManifest(manifestPath, (currentManifest) => {
            const next = replaceManifestRelease(currentManifest, release);
            return { result: next, manifest: next };
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "无法更新清单版本";
          if (message.includes("清单存在错误") || message.includes("更新清单未配置")) {
            return sendError(res, 500, message, "APP_UPDATE_READ_ERROR");
          }
          return sendError(res, 400, message, "INVALID_RELEASE_OPERATION");
        }

        await auditAdminAction(req, {
          action: "app_updates.publish",
          resourceType: "app_updates",
          resourceId: `${release.channel}:${release.snapshot}`,
          summary: `发布 ${release.channel} 渠道应用更新 (${release.snapshot})`,
          details: {
            applicationId: release.applicationId,
            channel: release.channel,
            version: release.version,
            snapshot: release.snapshot,
            buildNumber: release.buildNumber,
            url: release.url,
            sizeBytes: release.sizeBytes,
            sha256: release.sha256,
          },
        });

        res.json({
          success: true,
          message: `已发布 ${release.channel} 渠道版本 ${release.snapshot}`,
          manifest: updatedManifest,
          release,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/app-updates/revoke",
    validateBody(revokeBodySchema),
    async (req: AuthRequest, res, next) => {
      try {
        const manifestPath = options.manifestPath;
        if (!manifestPath) {
          return sendError(res, 400, "服务端尚未配置 APP_UPDATE_MANIFEST_PATH", "APP_UPDATE_CONFIG_MISSING");
        }
        const { applicationId, channel } = req.body;
        let revokedRelease: any = null;
        let updatedManifest;
        try {
          const result = await mutateAppUpdateManifest(manifestPath, (currentManifest) => {
            const target = currentManifest.releases.find(
              (item) => item.applicationId === applicationId && item.channel === channel,
            );
            if (!target) {
              const err = new Error(`未找到应用 ${applicationId} 在 ${channel} 渠道的在线版本`);
              (err as any).code = "NOT_FOUND";
              throw err;
            }
            const next = revokeManifestRelease(currentManifest, applicationId, channel);
            return { result: { target, next }, manifest: next };
          });
          revokedRelease = result.target;
          updatedManifest = result.next;
        } catch (err: unknown) {
          if ((err as any)?.code === "NOT_FOUND") {
            return sendError(res, 404, (err as Error).message, "RELEASE_NOT_FOUND");
          }
          const message = err instanceof Error ? err.message : "无法撤下版本";
          return sendError(res, 500, message, "APP_UPDATE_MUTATION_ERROR");
        }

        await auditAdminAction(req, {
          action: "app_updates.revoke",
          resourceType: "app_updates",
          resourceId: `${channel}:${revokedRelease.snapshot}`,
          summary: `撤下 ${channel} 渠道应用更新 (${revokedRelease.snapshot})`,
          details: {
            applicationId,
            channel,
            revokedSnapshot: revokedRelease.snapshot,
            revokedBuildNumber: revokedRelease.buildNumber,
          },
        });

        res.json({
          success: true,
          message: `已撤下 ${channel} 渠道版本 ${revokedRelease.snapshot}`,
          manifest: updatedManifest,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
