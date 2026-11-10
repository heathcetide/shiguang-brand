import { createHash } from "node:crypto";
import type { FeedbackItem, FeedbackReply, FeedbackStatus } from "./types.js";
export class FeedbackError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) { super(message); this.statusCode = statusCode; this.code = code; }
}
export const missingFeedback = () => new FeedbackError(404, "FEEDBACK_NOT_FOUND", "反馈不存在或无权查看");
export const replayConflict = () => new FeedbackError(409, "FEEDBACK_REPLAY_CONFLICT", "同一请求编号不能用于不同内容，请重新提交");
export function replyFingerprint(input: FeedbackReply) {
  return createHash("sha256").update(JSON.stringify([input.content, input.version, input.status || null, input.visibility || "public"])).digest("hex");
}
export function nextFeedbackStatus(item: FeedbackItem, input: FeedbackReply, admin: boolean): FeedbackStatus {
  if (item.version !== input.version) throw new FeedbackError(409, "FEEDBACK_VERSION_CONFLICT", "反馈已更新，请刷新后重试");
  if (!admin && item.status === "closed") throw new FeedbackError(409, "FEEDBACK_CLOSED", "反馈已关闭，请新建反馈并注明原编号");
  if (input.visibility === "internal" && input.status && input.status !== item.status) throw new FeedbackError(400, "FEEDBACK_INTERNAL_STATUS", "内部备注不能改变用户可见状态，请单独提交公开处理结果");
  if (!admin && (input.status || input.visibility === "internal")) throw new FeedbackError(403, "FEEDBACK_FORBIDDEN", "无权设置处理状态或内部备注");
  return admin ? input.status || item.status : ["waiting_user", "resolved"].includes(item.status) ? "processing" : item.status;
}
export function feedbackTimestamp(value: unknown) {
  const text = String(value);
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(" ", "T") + "Z" : text).toISOString();
}
export function feedbackItem(row: Record<string, unknown>): FeedbackItem {
  return { id: Number(row.id), userId: Number(row.user_id), category: row.category as FeedbackItem["category"], content: String(row.content),
    context: typeof row.context_json === "string" ? JSON.parse(row.context_json) : row.context_json || null,
    status: (row.status === "open" ? "received" : row.status) as FeedbackStatus, version: Number(row.version),
    createdAt: feedbackTimestamp(row.created_at), updatedAt: feedbackTimestamp(row.updated_at || row.created_at) };
}
