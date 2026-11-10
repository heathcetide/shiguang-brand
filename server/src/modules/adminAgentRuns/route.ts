import { Router, type Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { auditAdminAction } from "../../routes/admin/shared.js";
import { AdminAgentRunsError } from "./errors.js";
import type { AdminAgentRunsService } from "./service.js";

function handle(error: unknown, res: Response, fallback: string) {
  if (error instanceof AdminAgentRunsError) return res.status(error.status).json({ error: error.message });
  console.error("[Admin Agent Runs Error]", error);
  return res.status(500).json({ error: fallback });
}

export function createAdminAgentRunsRouter(service: AdminAgentRunsService) {
  const router = Router();
  router.get("/agent-runs", (req, res) => {
    void service.list(req.query).then((value) => res.json(value))
      .catch((error) => handle(error, res, "获取 Agent Run 列表失败"));
  });
  router.get("/agent-runs/:runId", (req: AuthRequest, res) => {
    const runId = String(req.params.runId || "");
    void service.detail(runId).then(async (value) => {
      await auditAdminAction(req, { action: "agent_run.view", resourceType: "agent_run", resourceId: runId,
        summary: "查看 Agent Run 运行详情", details: { userId: value.run.userId, modality: value.run.modality,
          status: value.run.status } });
      return res.json(value);
    }).catch((error) => handle(error, res, "获取 Agent Run 详情失败"));
  });
  return router;
}
