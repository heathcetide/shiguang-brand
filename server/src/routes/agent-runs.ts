import { timestampMs, reversibleAgentActions } from "../modules/agentOperations/helpers.js";
import { Router } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uuidParam } from "../middleware/validateParam.js";
import { agentRunResumeSchema } from "../validation/schemas.js";
import { getAgentRunMedia, getRunActions, getAgentRunRow, listAgentEvents, toAgentRunSummary } from "../services/agent/repository.js";
import { cancelSupervisorRun, resumeSupervisorRun, retrySupervisorRun, undoSupervisorRun } from "../services/agent/runtime.js";
import { buildAgentSolutionCards } from "../services/agent/cards.js";

const router = Router();
router.use(authMiddleware);
router.param("runId", uuidParam);

router.get("/agent-runs/:runId", async (req: AuthRequest, res) => {
  const row = await getAgentRunRow(String(req.params.runId), req.userId!);
  if (!row) return res.status(404).json({ error: "Agent Run 不存在或无权访问", code: "AGENT_RUN_NOT_FOUND" });
  const afterSequence = Math.max(0, Number(req.query.afterSequence) || 0);
  const run = toAgentRunSummary(row);
  const actions = (await getRunActions(row.id, req.userId!)).map((action) => ({
    id: action.id, actionType: action.actionType, status: action.status,
    name: String(action.payload.name || action.payload.foodName || action.payload.title || ""),
    undoAvailableUntil: reversibleAgentActions.has(action.actionType) && action.status === "executed" && action.executedAt
      ? new Date(timestampMs(action.executedAt) + 10 * 60_000).toISOString() : undefined,
  }));
  return res.json({ run, actions, events: await listAgentEvents(row.id, req.userId!, afterSequence), solutionCards: buildAgentSolutionCards(run.id, run.artifacts) });
});

router.get("/agent-runs/:runId/media", async (req: AuthRequest, res) => {
  const runId = String(req.params.runId);
  const row = await getAgentRunRow(runId, req.userId!);
  if (!row) return res.status(404).json({ error: "Agent Run 不存在或无权访问", code: "AGENT_RUN_NOT_FOUND" });
  const media = await getAgentRunMedia(runId, req.userId!);
  if (!media || media.kind !== "image") {
    return res.status(404).json({ error: "图片附件不存在", code: "AGENT_MEDIA_NOT_FOUND" });
  }
  const mimeType = media.mime_type || "image/jpeg";
  const dataUrl = media.data_base64.startsWith("data:")
    ? media.data_base64
    : `data:${mimeType};base64,${media.data_base64}`;
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ kind: "image", mimeType, dataUrl });
});

router.post("/agent-runs/:runId/resume", validateBody(agentRunResumeSchema), async (req: AuthRequest, res) => {
  try {
    const run = await resumeSupervisorRun(req.userId!, String(req.params.runId), req.body);
    return res.status(run.status === "running" || run.status === "queued" ? 202 : 200).json({ mode: "agent", run, reply: run.reply, artifacts: run.artifacts, solutionCards: buildAgentSolutionCards(run.id, run.artifacts), pendingApproval: run.pendingApproval });
  } catch (error) {
    const message = error instanceof Error ? error.message : "恢复 Agent Run 失败";
    return res.status(/不存在|无权/.test(message) ? 404 : /当前不等待/.test(message) ? 409 : 400).json({ error: message, code: "AGENT_RESUME_FAILED" });
  }
});

router.post("/agent-runs/:runId/cancel", async (req: AuthRequest, res) => {
  try {
    await cancelSupervisorRun(req.userId!, String(req.params.runId));
    return res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "取消 Agent Run 失败";
    return res.status(/不存在|无权/.test(message) ? 404 : 409).json({ error: message, code: "AGENT_CANCEL_FAILED" });
  }
});

router.post("/agent-runs/:runId/retry", async (req: AuthRequest, res) => {
  try {
    const run = await retrySupervisorRun(req.userId!, String(req.params.runId));
    return res.status(run.status === "running" || run.status === "queued" ? 202 : 200).json({ mode: "agent", run, reply: run.reply, artifacts: run.artifacts, solutionCards: buildAgentSolutionCards(run.id, run.artifacts), pendingApproval: run.pendingApproval });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重试 Agent Run 失败";
    return res.status(/不存在|无权/.test(message) ? 404 : 409).json({ error: message, code: "AGENT_RETRY_FAILED" });
  }
});

router.post("/agent-runs/:runId/undo", async (req: AuthRequest, res) => {
  try {
    return res.json({ success: true, result: await undoSupervisorRun(req.userId!, String(req.params.runId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "撤销 Agent 操作失败";
    return res.status(/不存在|无权/.test(message) ? 404 : /过期/.test(message) ? 409 : 400).json({ error: message, code: "AGENT_UNDO_FAILED" });
  }
});

export default router;
