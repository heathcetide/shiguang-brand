import type { AuditContext, EventInput, EventResult, ListInput, QuestionInput, QuestionResult, Row } from "./types.js";

export interface AdminCommunityRepository {
  listPosts(input: ListInput): Promise<Row[]>;
  softDeletePost(id: number, context: AuditContext): Promise<boolean>;
  listComments(postId: number): Promise<Row[]>;
  deleteComment(id: number, context: AuditContext): Promise<boolean>;
  updateEvent(id: number, input: EventInput, context: AuditContext): Promise<EventResult>;
  updateQuestion(id: number, input: QuestionInput, context: AuditContext): Promise<QuestionResult>;
}
