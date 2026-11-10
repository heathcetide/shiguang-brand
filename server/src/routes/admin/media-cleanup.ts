import { Router } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import type { MediaCleanupService } from "../../modules/mediaCleanup/service.js";
import { publicMediaCleanupJob, sanitizeMediaCleanupError } from "../../modules/mediaCleanup/service.js";
import { auditAdminAction } from "./shared.js";

export function createAdminMediaCleanupRouter(mediaCleanupService: MediaCleanupService) {
  const router = Router();
  router.param("id", positiveIntegerParam);
  router.get("/media-cleanup-jobs", (req, res) => {
    void mediaCleanupService.list({
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
      olderThanHours: req.query.olderThanHours,
    }).then((value) => res.json(value)).catch((error) => {
      console.error("[Admin Media Cleanup List Error]", error);
      res.status(500).json({ error: "获取媒体清理任务失败", code: "MEDIA_CLEANUP_LIST_FAILED" });
    });
  });
  router.post("/media-cleanup-jobs/:id/retry", async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const before = await mediaCleanupService.job(id);
    if (!before) return res.status(404).json({ error: "媒体清理任务不存在", code: "MEDIA_CLEANUP_JOB_NOT_FOUND" });
    if (before.status === "completed") return res.status(409).json({ error: "已完成的媒体清理任务无需重试", code: "MEDIA_CLEANUP_ALREADY_COMPLETED" });
    if (before.status === "processing" && !before.is_stale) return res.status(409).json({ error: "媒体清理任务正在执行，请稍后再试", code: "MEDIA_CLEANUP_JOB_BUSY" });
    try {
      if (!await mediaCleanupService.process(id)) return res.status(409).json({ error: "媒体清理任务已被其他执行器接管", code: "MEDIA_CLEANUP_JOB_CLAIMED" });
      const after = (await mediaCleanupService.job(id))!;
      await auditAdminAction(req, { action: "media_cleanup.retry", resourceType: "media_cleanup_job", resourceId: id, summary: `人工重试媒体清理任务 #${id} 成功`, details: { outcome: "completed", attempts: after.attempts, urlCount: publicMediaCleanupJob(after).urlCount } });
      return res.json({ success: true, job: publicMediaCleanupJob(after) });
    } catch (error) {
      const message = sanitizeMediaCleanupError(error);
      const after = await mediaCleanupService.job(id);
      await auditAdminAction(req, { action: "media_cleanup.retry", resourceType: "media_cleanup_job", resourceId: id, summary: `人工重试媒体清理任务 #${id} 失败`, details: { outcome: "failed", attempts: after?.attempts ?? before.attempts + 1, error: message } });
      return res.status(502).json({ error: "媒体清理重试失败", code: "MEDIA_CLEANUP_RETRY_FAILED", details: message });
    }
  });
  return router;
}
