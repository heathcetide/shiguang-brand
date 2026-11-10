export type Row = Record<string, any>;
export type AuditContext = { adminUserId: number; ipAddress?: string | null; userAgent?: string | null };
export type AuditEvent = AuditContext & {
  action: string;
  resourceType: string;
  resourceId: number;
  summary: string;
  details?: Row;
};
export type ListInput = { status: "active" | "deleted" | "all"; cursorId: number | null; limit: number | null };
export type EventInput = { startAt: string; endAt: string };
export type EventResult = { kind: "updated"; before: Row } | { kind: "not_found" };
export type QuestionInput = { status: "open" | "resolved"; acceptedCommentId: number | null };
export type QuestionResult =
  | { kind: "updated"; before: Row }
  | { kind: "not_found" }
  | { kind: "comment_mismatch" };
