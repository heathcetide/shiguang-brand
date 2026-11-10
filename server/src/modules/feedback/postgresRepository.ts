import type { Pool, PoolClient } from "pg";
import type { FeedbackRepository } from "./repository.js";
import type { FeedbackCreateData, FeedbackListQuery, FeedbackReply, FeedbackMessage } from "./types.js";
import { feedbackTimestamp, feedbackItem, missingFeedback, nextFeedbackStatus, replayConflict, replyFingerprint } from "./domain.js";
export class PostgresFeedbackRepository implements FeedbackRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async create(userId: number, input: FeedbackCreateData) {
    return this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`feedback-create:${userId}`]);
      if (input.requestKey) {
        const existing = (await client.query("SELECT * FROM user_feedback WHERE user_id=$1 AND request_key=$2", [userId, input.requestKey])).rows[0];
        if (existing) {
          const context = input.context || null;
          // jsonb key order is not significant.
          const same = (await client.query("SELECT context_json IS NOT DISTINCT FROM $1::jsonb AS equal FROM user_feedback WHERE id=$2", [JSON.stringify(context), existing.id])).rows[0]?.equal;
          if (existing.category !== input.category || existing.content !== input.content || !same && !(existing.context_json === null && context === null)) throw replayConflict();
          return Number(existing.id);
        }
      }
      return Number((await client.query("INSERT INTO user_feedback(user_id,category,content,context_json,status,request_key,updated_at) VALUES($1,$2,$3,$4::jsonb,'received',$5,CURRENT_TIMESTAMP) RETURNING id", [userId, input.category, input.content, input.context ? JSON.stringify(input.context) : null, input.requestKey || null])).rows[0]!.id);
    });
  }
  async list(userId: number | null, query: FeedbackListQuery) {
    const where = ["1=1"]; const values: (string | number)[] = [];
    const add = (field: string, operator: string, value: string | number) => { values.push(value); where.push(`${field}${operator}$${values.length}`); };
    if (userId !== null) add("user_id", "=", userId);
    if (query.before) add("id", "<", query.before);
    if (query.status) add("status", "=", query.status);
    if (query.category) add("category", "=", query.category);
    values.push(query.limit);
    return (await this.pool.query(`SELECT * FROM user_feedback WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT $${values.length}`, values)).rows.map(feedbackItem);
  }
  async detail(userId: number | null, id: number) {
    const row = (await this.pool.query("SELECT * FROM user_feedback WHERE id=$1 AND ($2::integer IS NULL OR user_id=$2)", [id, userId])).rows[0];
    if (!row) return null;
    const messages = (await this.pool.query(`SELECT id,author_role AS "authorRole",visibility,content,status,created_at AS "createdAt" FROM feedback_messages WHERE feedback_id=$1 ${userId === null ? "" : "AND visibility='public'"} ORDER BY id`, [id])).rows as FeedbackMessage[];
    return { ...feedbackItem(row), messages: messages.map(message => ({ ...message, id: Number(message.id), createdAt: feedbackTimestamp(message.createdAt) })) };
  }
  async reply(actorId: number, admin: boolean, id: number, input: FeedbackReply) {
    await this.tx(async (client) => {
      const row = (await client.query("SELECT * FROM user_feedback WHERE id=$1 AND ($2::boolean OR user_id=$3) FOR UPDATE", [id, admin, actorId])).rows[0];
      if (!row) throw missingFeedback();
      const fingerprint = replyFingerprint(input);
      const previous = (await client.query("SELECT fingerprint FROM feedback_messages WHERE feedback_id=$1 AND author_id=$2 AND request_key=$3", [id, actorId, input.requestKey])).rows[0];
      if (previous) { if (previous.fingerprint !== fingerprint) throw replayConflict(); return; }
      const status = nextFeedbackStatus(feedbackItem(row), input, admin);
      const visibility = admin ? input.visibility || "public" : "public";
      await client.query("INSERT INTO feedback_messages(feedback_id,author_id,author_role,visibility,content,status,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id, actorId, admin ? "admin" : "user", visibility, input.content, status, input.requestKey, fingerprint]);
      await client.query("UPDATE user_feedback SET status=$1,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [status, id]);
      if (admin) {
        await client.query("INSERT INTO admin_audit_logs(admin_user_id,action,resource_type,resource_id,summary) VALUES($1,'feedback.reply','feedback',$2,$3)", [actorId, String(id), visibility === "internal" ? "添加反馈内部备注" : `回复反馈并设为 ${status}`]);
        if (visibility === "public") await client.query("INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key,feedback_id) VALUES($1,'feedback_reply',$2,$3,'system','normal','info',$4,$5)", [row.user_id, status === "waiting_user" ? "反馈需要补充信息" : "你的反馈有新进展", "打开反馈详情查看处理结果。", `feedback:${id}:${input.requestKey}`, id]);
      }
    });
  }
}
