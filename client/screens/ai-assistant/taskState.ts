import type { AgentResponse, AgentRunEvent, AgentRunSummary, Message } from "./types";
export function agentMessageText(run: AgentRunSummary, reply?: string) {
  if (run.status === "failed") return run.error?.message || "任务执行失败，请重试。";
  if (run.status === "awaiting_input") return run.pendingInput?.question || "请补充信息以继续当前任务。";
  if (run.status === "awaiting_approval") return "方案已经准备好，请检查并确认下方操作。";
  if (run.status === "cancelled") return "任务已取消；已提交的操作不会自动撤销，请查看操作记录。";
  if (run.status === "expired") return "任务已过期，请新建任务。";
  if (reply || run.reply) return reply || run.reply || "";
  if (run.status === "queued") return "任务正在排队，我会在这里持续更新进度。";
  return "正在处理这项任务…";
}
export function mergeTaskResponse(message: Message, response: AgentResponse & { events?: AgentRunEvent[] }): Message {
  const previous = message.agentRun;
  if (previous && previous.run.id !== response.run.id) return message;
  if (previous && Date.parse(previous.run.updatedAt) > Date.parse(response.run.updatedAt)) return message;
  const events = [...new Map([...(previous?.events || []), ...(response.events || [])].map((event) => [event.sequence, event])).values()].sort((a, b) => a.sequence - b.sequence);
  const streamStart = [...events].reverse().find((event) => event.eventType === "reply_started")?.sequence;
  const partialReply = streamStart === undefined ? "" : events.filter((event) => event.sequence > streamStart && event.eventType === "reply_delta")
    .map((event) => typeof event.payload?.delta === "string" ? event.payload.delta : "").join("");
  return { ...message, text: response.run.status === "running" && partialReply ? partialReply : agentMessageText(response.run, response.reply),
    status: response.run.status === "failed" ? "failed" : response.run.status === "completed" ? "completed" : undefined,
    solutionCards: response.solutionCards ?? message.solutionCards,
    responseTimeMs: response.run.durationMs,
    agentRun: { ...previous, connectionError: false, run: response.run, events, actions: response.actions ?? previous?.actions } };
}
