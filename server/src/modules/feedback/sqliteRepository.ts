import type Database from "better-sqlite3";
import type { FeedbackRepository } from "./repository.js";
import type { FeedbackCreateData, FeedbackListQuery, FeedbackReply, FeedbackMessage } from "./types.js";
import { feedbackTimestamp, feedbackItem, missingFeedback, nextFeedbackStatus, replayConflict, replyFingerprint } from "./domain.js";
export class SqliteFeedbackRepository implements FeedbackRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }
  async create(userId: number, input: FeedbackCreateData) {
    return this.database.transaction(() => {
      if (input.requestKey) {
        const existing = this.database.prepare("SELECT * FROM user_feedback WHERE user_id=? AND request_key=?").get(userId, input.requestKey) as Record<string, unknown> | undefined;
        if (existing) {
          if (existing.category !== input.category || existing.content !== input.content || JSON.stringify(feedbackItem(existing).context) !== JSON.stringify(input.context || null)) throw replayConflict();
          return Number(existing.id);
        }
      }
      return Number(this.database.prepare("INSERT INTO user_feedback(user_id,category,content,context_json,status,request_key,updated_at) VALUES(?,?,?,?,'received',?,CURRENT_TIMESTAMP)")
        .run(userId, input.category, input.content, input.context ? JSON.stringify(input.context) : null, input.requestKey || null).lastInsertRowid);
    })();
  }
  async list(userId: number | null, query: FeedbackListQuery) {
    const where = ["1=1"]; const values: (string | number)[] = [];
    if (userId !== null) { where.push("user_id=?"); values.push(userId); }
    if (query.before) { where.push("id<?"); values.push(query.before); }
    if (query.status) { where.push("status=?"); values.push(query.status); }
    if (query.category) { where.push("category=?"); values.push(query.category); }
    return (this.database.prepare(`SELECT * FROM user_feedback WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...values, query.limit) as Record<string, unknown>[]).map(feedbackItem);
  }
  async detail(userId: number | null, id: number) {
    const row = this.database.prepare("SELECT * FROM user_feedback WHERE id=? AND (? IS NULL OR user_id=?)").get(id, userId, userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const messages = this.database.prepare(`SELECT id,author_role AS authorRole,visibility,content,status,created_at AS createdAt FROM feedback_messages WHERE feedback_id=? ${userId === null ? "" : "AND visibility='public'"} ORDER BY id`).all(id) as FeedbackMessage[];
    return { ...feedbackItem(row), messages: messages.map(message => ({ ...message, createdAt: feedbackTimestamp(message.createdAt) })) };
  }
  async reply(actorId: number, admin: boolean, id: number, input: FeedbackReply) {
    this.database.transaction(() => {
      const row = this.database.prepare("SELECT * FROM user_feedback WHERE id=? AND (?=1 OR user_id=?)").get(id, Number(admin), actorId) as Record<string, unknown> | undefined;
      if (!row) throw missingFeedback();
      const fingerprint = replyFingerprint(input);
      const previous = this.database.prepare("SELECT fingerprint FROM feedback_messages WHERE feedback_id=? AND author_id=? AND request_key=?").get(id, actorId, input.requestKey) as { fingerprint: string } | undefined;
      if (previous) { if (previous.fingerprint !== fingerprint) throw replayConflict(); return; }
      const status = nextFeedbackStatus(feedbackItem(row), input, admin);
      const visibility = admin ? input.visibility || "public" : "public";
      this.database.prepare("INSERT INTO feedback_messages(feedback_id,author_id,author_role,visibility,content,status,request_key,fingerprint) VALUES(?,?,?,?,?,?,?,?)")
        .run(id, actorId, admin ? "admin" : "user", visibility, input.content, status, input.requestKey, fingerprint);
      this.database.prepare("UPDATE user_feedback SET status=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, id);
      if (admin) {
        this.database.prepare("INSERT INTO admin_audit_logs(admin_user_id,action,resource_type,resource_id,summary) VALUES(?,'feedback.reply','feedback',?,?)")
          .run(actorId, String(id), visibility === "internal" ? "添加反馈内部备注" : `回复反馈并设为 ${status}`);
        if (visibility === "public") this.database.prepare("INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key,feedback_id) VALUES(?,'feedback_reply',?,?,'system','normal','info',?,?)")
          .run(Number(row.user_id), status === "waiting_user" ? "反馈需要补充信息" : "你的反馈有新进展", "打开反馈详情查看处理结果。", `feedback:${id}:${input.requestKey}`, id);
      }
    })();
  }
}
