import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { AdminCommunityError } from "./errors.js";
import type { AdminCommunityRepository } from "./repository.js";
import type { AuditContext, Row } from "./types.js";

export class AdminCommunityService {
  private readonly repository: AdminCommunityRepository;
  constructor(repository: AdminCommunityRepository) { this.repository = repository; }

  async posts(query: Row) {
    const cursorMode = query.pageSize !== undefined || query.cursor !== undefined;
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const cursorId = cursor ? Number(cursor.id) : null;
    if (query.cursor && (!cursor || cursor.v !== 1 || !Number.isInteger(cursorId) || cursorId! <= 0)) {
      throw new AdminCommunityError(400, "分页游标无效", "INVALID_CURSOR");
    }
    const status = query.status === "deleted" ? "deleted" : query.status === "all" ? "all" : "active";
    const rows = await this.repository.listPosts({ status, cursorId, limit: cursorMode ? pageSize + 1 : null });
    if (!cursorMode) return rows;
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    return { items, nextCursor: hasMore ? encodeCursor({ v: 1, id: items.at(-1)!.id }) : null };
  }

  async deletePost(id: number, context: AuditContext) {
    if (!await this.repository.softDeletePost(id, context)) throw new AdminCommunityError(404, "未找到该帖子");
    return { success: true, message: "帖子已移入回收站" };
  }

  comments(postId: number) { return this.repository.listComments(postId); }

  async deleteComment(id: number, context: AuditContext) {
    if (!await this.repository.deleteComment(id, context)) throw new AdminCommunityError(404, "评论不存在");
    return { success: true };
  }

  async updateEvent(id: number, body: Row, context: AuditContext) {
    const startAt = String(body.event_start_at || "").trim();
    const endAt = String(body.event_end_at || "").trim();
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    if (!startAt || !endAt || !Number.isFinite(start) || !Number.isFinite(end)) throw new AdminCommunityError(400, "请输入有效的活动开始和结束时间");
    if (end < start) throw new AdminCommunityError(400, "活动结束时间不能早于开始时间");
    const result = await this.repository.updateEvent(id, { startAt, endAt }, context);
    if (result.kind === "not_found") throw new AdminCommunityError(404, "活动不存在");
    return { success: true, event_start_at: startAt, event_end_at: endAt };
  }

  async updateQuestion(id: number, body: Row, context: AuditContext) {
    const status = body.question_status === "resolved" ? "resolved" : "open";
    const acceptedCommentId = body.accepted_comment_id == null ? null : Number(body.accepted_comment_id);
    if (status === "resolved" && !acceptedCommentId) throw new AdminCommunityError(400, "解决问题前请选择采纳回答");
    const result = await this.repository.updateQuestion(id, { status, acceptedCommentId: status === "resolved" ? acceptedCommentId : null }, context);
    if (result.kind === "not_found") throw new AdminCommunityError(404, "问题不存在");
    if (result.kind === "comment_mismatch") throw new AdminCommunityError(400, "采纳回答不属于当前问题");
    return { success: true, question_status: status, accepted_comment_id: status === "resolved" ? acceptedCommentId : null };
  }
}
