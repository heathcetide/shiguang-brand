import type Database from "better-sqlite3";
import type { AdminCommunityRepository } from "./repository.js";
import type { AuditContext, AuditEvent, EventInput, ListInput, QuestionInput, Row } from "./types.js";

export class SqliteAdminCommunityRepository implements AdminCommunityRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async listPosts(input: ListInput) {
    const deleted = input.status === "deleted" ? "p.deleted_at IS NOT NULL" : input.status === "all" ? "1=1" : "p.deleted_at IS NULL";
    const values: number[] = [];
    if (input.cursorId) values.push(input.cursorId);
    if (input.limit) values.push(input.limit);
    return this.database.prepare(`SELECT p.*,COALESCE(u.is_verified_expert,0) AS author_is_expert,
      (SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id) AS comment_count,
      (SELECT COUNT(*) FROM community_event_participants ep WHERE ep.post_id=p.id) AS participant_count
      FROM community_posts p LEFT JOIN users u ON u.id=p.user_id WHERE ${deleted} ${input.cursorId ? "AND p.id<?" : ""}
      ORDER BY p.id DESC ${input.limit ? "LIMIT ?" : ""}`).all(...values) as Row[];
  }

  async softDeletePost(id: number, context: AuditContext) { return this.database.transaction(() => {
    const post = this.database.prepare("SELECT content FROM community_posts WHERE id=? AND deleted_at IS NULL").get(id) as { content: string } | undefined;
    if (!post) return false;
    const changed = this.database.prepare("UPDATE community_posts SET deleted_at=CURRENT_TIMESTAMP,deleted_by=? WHERE id=? AND deleted_at IS NULL").run(context.adminUserId, id).changes;
    if (!changed) return false;
    this.audit({ ...context, action:"community.delete", resourceType:"community", resourceId:id, summary:"将社区帖子移入回收站",
      details:{ contentPreview:post.content.slice(0,80) } });
    return true;
  })(); }

  async listComments(postId: number) { return this.database.prepare(`SELECT c.id,c.post_id,COALESCE(u.username,c.username) AS username,c.avatar_url,c.content,
    c.likes_count,c.created_at,COALESCE(u.is_verified_expert,0) AS is_expert_answer,CASE WHEN p.accepted_comment_id=c.id THEN 1 ELSE 0 END AS is_accepted
    FROM community_comments c JOIN community_posts p ON p.id=c.post_id LEFT JOIN users u ON u.id=c.user_id WHERE c.post_id=?
    ORDER BY is_accepted DESC,c.likes_count DESC,c.created_at DESC`).all(postId) as Row[]; }

  async deleteComment(id: number, context: AuditContext) { return this.database.transaction(() => {
    const comment = this.database.prepare("SELECT post_id,content FROM community_comments WHERE id=?").get(id) as { post_id:number;content:string } | undefined;
    if (!comment) return false;
    this.database.prepare("UPDATE community_posts SET accepted_comment_id=NULL,question_status='open' WHERE id=? AND accepted_comment_id=?").run(comment.post_id,id);
    this.database.prepare("DELETE FROM community_comments WHERE id=?").run(id);
    this.database.prepare("UPDATE community_posts SET comment_count=MAX(COALESCE(comment_count,0)-1,0) WHERE id=?").run(comment.post_id);
    this.audit({ ...context, action:"community.comment.delete", resourceType:"community_comment", resourceId:id, summary:"删除社区评论",
      details:{ contentPreview:comment.content.slice(0,80) } });
    return true;
  })(); }

  async updateEvent(id: number, input: EventInput, context: AuditContext) { return this.database.transaction(() => {
    const before = this.database.prepare("SELECT category,event_start_at,event_end_at FROM community_posts WHERE id=? AND deleted_at IS NULL").get(id) as Row | undefined;
    if (!before || before.category !== "活动") return { kind:"not_found" as const };
    this.database.prepare("UPDATE community_posts SET event_start_at=?,event_end_at=? WHERE id=?").run(input.startAt,input.endAt,id);
    this.audit({ ...context, action:"community.event.update", resourceType:"community", resourceId:id, summary:"修改社区活动时间",
      details:{ before:{ start:before.event_start_at,end:before.event_end_at },after:{ start:input.startAt,end:input.endAt } } });
    return { kind:"updated" as const,before };
  })(); }

  async updateQuestion(id: number, input: QuestionInput, context: AuditContext) { return this.database.transaction(() => {
    const before = this.database.prepare("SELECT category,accepted_comment_id,question_status FROM community_posts WHERE id=? AND deleted_at IS NULL").get(id) as Row | undefined;
    if (!before || before.category !== "问答") return { kind:"not_found" as const };
    if (input.status === "resolved" && !this.database.prepare("SELECT 1 FROM community_comments WHERE id=? AND post_id=?").get(input.acceptedCommentId,id)) {
      return { kind:"comment_mismatch" as const };
    }
    this.database.prepare("UPDATE community_posts SET question_status=?,accepted_comment_id=? WHERE id=?").run(input.status,input.acceptedCommentId,id);
    this.audit({ ...context, action:"community.question.update", resourceType:"community", resourceId:id,
      summary:input.status==="resolved"?"管理员采纳问答回复":"管理员将问题重新打开",details:{ before,after:{ question_status:input.status,accepted_comment_id:input.acceptedCommentId } } });
    return { kind:"updated" as const,before };
  })(); }

  private audit(event: AuditEvent) { this.database.prepare(`INSERT INTO admin_audit_logs
    (admin_user_id,action,resource_type,resource_id,summary,details_json,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?)`)
    .run(event.adminUserId,event.action,event.resourceType,String(event.resourceId),event.summary,event.details?JSON.stringify(event.details):null,event.ipAddress||null,event.userAgent||null); }
}
