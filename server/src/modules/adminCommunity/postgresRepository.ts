import type { Pool, PoolClient } from "pg";
import type { AdminCommunityRepository } from "./repository.js";
import type { AuditContext, AuditEvent, EventInput, ListInput, QuestionInput, Row } from "./types.js";

export class PostgresAdminCommunityRepository implements AdminCommunityRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async listPosts(input: ListInput) {
    const deleted = input.status === "deleted" ? "p.deleted_at IS NOT NULL" : input.status === "all" ? "TRUE" : "p.deleted_at IS NULL";
    const values: number[] = [];
    const cursor = input.cursorId ? `AND p.id<$${values.push(input.cursorId)}` : "";
    const limit = input.limit ? `LIMIT $${values.push(input.limit)}` : "";
    return (await this.pool.query(`SELECT p.*,CASE WHEN COALESCE(u.is_verified_expert,FALSE) THEN 1 ELSE 0 END AS author_is_expert,
      (SELECT COUNT(*)::int FROM community_comments c WHERE c.post_id=p.id) AS comment_count,
      (SELECT COUNT(*)::int FROM community_event_participants ep WHERE ep.post_id=p.id) AS participant_count
      FROM community_posts p LEFT JOIN users u ON u.id=p.user_id WHERE ${deleted} ${cursor} ORDER BY p.id DESC ${limit}`, values)).rows as Row[];
  }

  async softDeletePost(id: number, context: AuditContext) { return this.tx(async (client) => {
    const post = (await client.query(`UPDATE community_posts SET deleted_at=CURRENT_TIMESTAMP,deleted_by=$1
      WHERE id=$2 AND deleted_at IS NULL RETURNING content`, [context.adminUserId,id])).rows[0] as Row | undefined;
    if (!post) return false;
    await this.audit(client,{ ...context,action:"community.delete",resourceType:"community",resourceId:id,summary:"将社区帖子移入回收站",
      details:{ contentPreview:String(post.content).slice(0,80) } }); return true;
  }); }

  async listComments(postId: number) { return (await this.pool.query(`SELECT c.id,c.post_id,COALESCE(u.username,c.username) AS username,c.avatar_url,c.content,
    c.likes_count,c.created_at,CASE WHEN COALESCE(u.is_verified_expert,FALSE) THEN 1 ELSE 0 END AS is_expert_answer,
    CASE WHEN p.accepted_comment_id=c.id THEN 1 ELSE 0 END AS is_accepted
    FROM community_comments c JOIN community_posts p ON p.id=c.post_id LEFT JOIN users u ON u.id=c.user_id WHERE c.post_id=$1
    ORDER BY is_accepted DESC,c.likes_count DESC,c.created_at DESC`,[postId])).rows as Row[]; }

  async deleteComment(id: number, context: AuditContext) { return this.tx(async (client) => {
    const comment = (await client.query("SELECT post_id,content FROM community_comments WHERE id=$1 FOR UPDATE",[id])).rows[0] as Row | undefined;
    if (!comment) return false; const postId=Number(comment.post_id);
    await client.query("UPDATE community_posts SET accepted_comment_id=NULL,question_status='open' WHERE id=$1 AND accepted_comment_id=$2",[postId,id]);
    await client.query("DELETE FROM community_comments WHERE id=$1",[id]);
    await client.query("UPDATE community_posts SET comment_count=GREATEST(COALESCE(comment_count,0)-1,0) WHERE id=$1",[postId]);
    await this.audit(client,{ ...context,action:"community.comment.delete",resourceType:"community_comment",resourceId:id,summary:"删除社区评论",
      details:{ contentPreview:String(comment.content).slice(0,80) } }); return true;
  }); }

  async updateEvent(id: number, input: EventInput, context: AuditContext) { return this.tx(async (client) => {
    const before=(await client.query(`SELECT category,event_start_at,event_end_at FROM community_posts
      WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[id])).rows[0] as Row|undefined;
    if(!before||before.category!=="活动")return {kind:"not_found" as const};
    await client.query("UPDATE community_posts SET event_start_at=$1,event_end_at=$2 WHERE id=$3",[input.startAt,input.endAt,id]);
    await this.audit(client,{...context,action:"community.event.update",resourceType:"community",resourceId:id,summary:"修改社区活动时间",
      details:{before:{start:before.event_start_at,end:before.event_end_at},after:{start:input.startAt,end:input.endAt}}});
    return {kind:"updated" as const,before};
  }); }

  async updateQuestion(id: number, input: QuestionInput, context: AuditContext) { return this.tx(async (client) => {
    const before=(await client.query(`SELECT category,accepted_comment_id,question_status FROM community_posts
      WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[id])).rows[0] as Row|undefined;
    if(!before||before.category!=="问答")return {kind:"not_found" as const};
    if(input.status==="resolved"&&!(await client.query("SELECT 1 FROM community_comments WHERE id=$1 AND post_id=$2",[input.acceptedCommentId,id])).rowCount) {
      return {kind:"comment_mismatch" as const};
    }
    await client.query("UPDATE community_posts SET question_status=$1,accepted_comment_id=$2 WHERE id=$3",[input.status,input.acceptedCommentId,id]);
    await this.audit(client,{...context,action:"community.question.update",resourceType:"community",resourceId:id,
      summary:input.status==="resolved"?"管理员采纳问答回复":"管理员将问题重新打开",details:{before,after:{question_status:input.status,accepted_comment_id:input.acceptedCommentId}}});
    return {kind:"updated" as const,before};
  }); }

  private audit(client:PoolClient,event:AuditEvent) { return client.query(`INSERT INTO admin_audit_logs
    (admin_user_id,action,resource_type,resource_id,summary,details_json,ip_address,user_agent) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
  [event.adminUserId,event.action,event.resourceType,String(event.resourceId),event.summary,event.details?JSON.stringify(event.details):null,event.ipAddress||null,event.userAgent||null]); }
  private async tx<T>(operation:(client:PoolClient)=>Promise<T>) { const client=await this.pool.connect(); try { await client.query("BEGIN"); const result=await operation(client);
    await client.query("COMMIT"); return result; } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
