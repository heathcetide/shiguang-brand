import { randomUUID } from "node:crypto";
import { decideInterventionFeedback, feedbackRequest, replayInterventionFeedback, type InterventionFeedbackDecision } from "../interventions/feedback.js";
import type { InterventionFeedback } from "@dietdigidose/contracts";
import { interventionDeliveryBlock, type InterventionDeliveryClaim, type InterventionDeliveryResult } from "../interventions/delivery.js";
import { interventionCandidateId } from "../interventions/opportunities.js";
import { reservationDecision, type InterventionReservation } from "../interventions/reservation.js";
import type Database from "better-sqlite3";
import { expiryContent, type ExpiryItem } from "./expiry.js";
import type { NotificationsRepository } from "./repository.js";
import type {
  AdminNotificationData, CampaignDelivery, ExpoTicket, NotificationAction, NotificationFilter,
  NotificationPreferences, PushMessage, PushReceiptResult,
} from "./types.js";

type PreferenceRow = Omit<NotificationPreferences, "expiring_alert" | "meal_reminder" | "water_reminder" | "weekdays_enabled" | "weekends_enabled"> & {
  expiring_alert: number; meal_reminder: number; water_reminder: number; weekdays_enabled: number; weekends_enabled: number;
};

export class SqliteNotificationsRepository implements NotificationsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async activeInterventionSnooze(userId: number,now: number): Promise<number | null> {
    const row = this.database.prepare("SELECT MAX(snoozed_until) AS until FROM proactive_interventions WHERE user_id=? AND kind='expiry_rescue' AND snoozed_until>?").get(userId,new Date(now).toISOString()) as {until:string|null};
    return row.until ? Date.parse(row.until) : null;
  }
  async feedbackIntervention(userId: number,id: string,input: InterventionFeedback,now: number): Promise<InterventionFeedbackDecision> {
    const request = feedbackRequest(id,input);
    return this.database.transaction(() => {
      const existing = this.database.prepare("SELECT request_json,result_json FROM proactive_intervention_actions WHERE user_id=? AND idempotency_key=?").get(userId,input.idempotencyKey) as Record<string,unknown> | undefined;
      const replay = replayInterventionFeedback(existing ?? null,id,input);
      if (replay) return replay;
      const row = this.database.prepare("SELECT * FROM proactive_interventions WHERE user_id=? AND id=?").get(userId,id) as Record<string,unknown> | undefined;
      const preferences = this.database.prepare("SELECT * FROM proactive_intervention_preferences WHERE user_id=?").get(userId) as Record<string,unknown> | undefined;
      const decision = decideInterventionFeedback(row ?? null,preferences ?? null,input,now);
      if (!decision.ok) return decision;
      const result = decision.result,at = new Date(now).toISOString();
      this.database.prepare("UPDATE proactive_interventions SET status='acted',snoozed_until=?,delivery_state=CASE WHEN delivery_state='pending' THEN 'cancelled' ELSE delivery_state END,updated_at=? WHERE user_id=? AND id=?").run(result.snoozedUntil,at,userId,id);
      this.database.prepare("UPDATE user_notification_inbox SET action_status='completed',is_read=1,read_at=?,snoozed_until=?,updated_at=? WHERE user_id=? AND id=?").run(at,result.snoozedUntil,at,userId,row!.notification_id);
      if (result.notCookingDate) {
        this.database.prepare("UPDATE proactive_intervention_preferences SET not_cooking_date=?,version=version+1,updated_at=? WHERE user_id=?").run(result.notCookingDate,at,userId);
        this.database.prepare("UPDATE proactive_interventions SET delivery_state='cancelled',updated_at=? WHERE user_id=? AND kind='dinner_window' AND delivery_state='pending' AND json_extract(candidate_json,'$.localDate')=?").run(at,userId,result.notCookingDate);
      }
      if (result.snoozedUntil) this.database.prepare("UPDATE proactive_interventions SET delivery_state='cancelled',updated_at=? WHERE user_id=? AND kind='expiry_rescue' AND delivery_state='pending'").run(at,userId);
      this.database.prepare("INSERT INTO proactive_intervention_actions(id,intervention_id,user_id,idempotency_key,action,request_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(),id,userId,input.idempotencyKey,input.action,JSON.stringify(request),JSON.stringify(result),at);
      return decision;
    })();
  }

  async interventionCard(userId: number,id: string): Promise<Record<string,unknown> | null> {
    return (this.database.prepare("SELECT * FROM proactive_interventions WHERE user_id=? AND id=? AND notification_id IS NOT NULL").get(userId,id) as Record<string,unknown> | undefined) ?? null;
  }

  async interventionScanCursor(): Promise<number> {
    const row = this.database.prepare("SELECT after_user_id FROM proactive_intervention_scan_cursor WHERE name='opportunities'").get() as { after_user_id: number } | undefined;
    return row?.after_user_id ?? 0;
  }
  async advanceInterventionScan(expected: number,next: number,owner: string): Promise<boolean> {
    if (![expected,next].every(value => Number.isSafeInteger(value) && value>=0) || !owner) throw new Error("Invalid scan checkpoint");
    return this.database.transaction(() => {
      if (!this.database.prepare("SELECT 1 FROM worker_task_leases WHERE task_name='intervention-scan' AND owner_id=? AND lease_expires_at>CURRENT_TIMESTAMP").get(owner)) return false;
      this.database.prepare("INSERT INTO proactive_intervention_scan_cursor(name) VALUES('opportunities') ON CONFLICT(name) DO NOTHING").run();
      return this.database.prepare("UPDATE proactive_intervention_scan_cursor SET after_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE name='opportunities' AND after_user_id=?").run(next,expected).changes===1;
    })();
  }

  async interventionScanUsers(afterId: number,limit: number): Promise<number[]> {
    if (!Number.isSafeInteger(afterId) || afterId<0 || !Number.isInteger(limit) || limit<1 || limit>100) throw new Error("Invalid opportunity scan");
    return (this.database.prepare("SELECT user_id FROM proactive_intervention_preferences WHERE enabled=1 AND (expiry_rescue=1 OR dinner_window=1) AND user_id>? ORDER BY user_id LIMIT ?").all(afterId,limit) as Array<{user_id:number}>).map(row => row.user_id);
  }
  async interventionQueue(userId: number): Promise<Record<string,unknown>[]> {
    return this.database.prepare("SELECT status,planned_at,deleted_at FROM cooking_queue_items WHERE user_id=? AND deleted_at IS NULL AND status IN ('waiting','preparing','ready','cooking')").all(userId) as Array<Record<string,unknown>>;
  }

  async pendingInterventionUsers(now: number,limit: number): Promise<number[]> {
    if (!Number.isFinite(now) || !Number.isInteger(limit) || limit<1 || limit>500) throw new Error("Invalid delivery scan");
    const at = new Date(now).toISOString();
    return (this.database.prepare("SELECT user_id FROM proactive_interventions WHERE (delivery_state='pending' AND next_attempt_at<=?) OR (delivery_state='sending' AND lease_until<=?) GROUP BY user_id ORDER BY MIN(COALESCE(next_attempt_at,lease_until)),user_id LIMIT ?").all(at,at,limit) as Array<{user_id:number}>).map(row => row.user_id);
  }

  async claimIntervention(userId: number,now: number,owner: string,featureEnabled: boolean): Promise<InterventionDeliveryClaim | null> {
    if (!owner.trim() || owner.length>200 || !Number.isFinite(now)) throw new Error("Invalid delivery claim");
    return this.database.transaction(() => {
      const at = new Date(now).toISOString();
      this.database.prepare("UPDATE proactive_interventions SET delivery_state='uncertain',lease_owner=NULL,lease_until=NULL,updated_at=? WHERE user_id=? AND delivery_state='sending' AND lease_until<=?").run(at,userId,at);
      const row = this.database.prepare("SELECT * FROM proactive_interventions WHERE user_id=? AND delivery_state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 1").get(userId,at) as Record<string,unknown> | undefined;
      if (!row) return null;
      const prefs = this.database.prepare("SELECT * FROM proactive_intervention_preferences WHERE user_id=?").get(userId) as Record<string,unknown> | undefined;
      const block = interventionDeliveryBlock(row,prefs ?? null,now,featureEnabled);
      const devices = this.database.prepare("SELECT expo_push_token FROM push_devices WHERE user_id=? AND is_active=1 ORDER BY id").all(userId) as Array<{expo_push_token:string}>;
      if (block || !devices.length) {
        this.database.prepare("UPDATE proactive_interventions SET delivery_state='cancelled',decision_reason=?,updated_at=?,status=CASE WHEN expires_at<=? THEN 'expired' ELSE status END WHERE id=?").run(block ?? 'delivery_no_device',at,at,String(row.id));
        return null;
      }
      this.database.prepare("UPDATE proactive_interventions SET delivery_state='sending',lease_owner=?,lease_until=?,delivery_attempts=delivery_attempts+1,updated_at=? WHERE id=?").run(owner,new Date(now+120_000).toISOString(),at,String(row.id));
      const candidate = JSON.parse(String(row.candidate_json)) as {title:string;body:string};
      return { id: String(row.id),owner,userId,title: candidate.title,body: candidate.body,notificationId: Number(row.notification_id),priority: row.priority === 'high' ? 'high' as const : 'normal' as const,tokens: devices.map(device => device.expo_push_token) };
    })();
  }
  async finishIntervention(id: string,owner: string,now: number,result: InterventionDeliveryResult) {
    if (!["accepted","failed","uncertain"].includes(result)) throw new Error("Invalid delivery result");
    const at = new Date(now).toISOString();
    return this.database.prepare("UPDATE proactive_interventions SET delivery_state=?,status=CASE WHEN ?='accepted' AND status='inbox' THEN 'sent' ELSE status END,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND delivery_state='sending' AND lease_owner=? AND lease_until>?").run(result,result,at,id,owner,at).changes===1;
  }
  async reserveIntervention(input: InterventionReservation) { return this.database.transaction(() => {
    const candidate = input.candidate;
    const existing = this.database.prepare("SELECT * FROM proactive_interventions WHERE user_id=? AND source_key=?").get(candidate.userId,candidate.sourceKey) as Record<string,unknown> | undefined;
    if (existing) return existing;
    const preferences = this.database.prepare("SELECT * FROM proactive_intervention_preferences WHERE user_id=?").get(candidate.userId) as Record<string,unknown> | undefined;
    const history = this.database.prepare("SELECT kind,snoozed_until,decided_at,push_reserved_at,channel FROM proactive_interventions WHERE user_id=? AND decided_at>=?").all(candidate.userId,new Date(input.now-7*86_400_000).toISOString()) as Record<string,unknown>[];
    const device = this.database.prepare("SELECT id FROM push_devices WHERE user_id=? AND is_active=1 LIMIT 1").get(candidate.userId);
    const decision = reservationDecision(input,preferences ?? null,history,Boolean(device));
    if (decision.reason === "snoozed") return { deferred: true,reason: decision.reason };
    const id = interventionCandidateId(candidate), now = new Date(input.now).toISOString();
    let notificationId: number | null = null;
    if (decision.channel !== "suppressed") notificationId = Number(this.database.prepare(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key)
      VALUES(?,'proactive_intervention',?,?,'action_required',?,'pending',?)`).run(candidate.userId,candidate.title,candidate.body,decision.priority ?? "normal",`intervention:${id}`).lastInsertRowid);
    this.database.prepare(`INSERT INTO proactive_interventions(id,user_id,source_key,kind,status,candidate_json,policy_input_json,policy_version,decision_reason,channel,priority,starts_at,expires_at,decided_at,push_reserved_at,delivery_state,notification_id,next_attempt_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,candidate.userId,candidate.sourceKey,candidate.kind,decision.channel === "suppressed" ? "suppressed" : "inbox",JSON.stringify(candidate),JSON.stringify({ input,preferences: preferences ?? null,history,hasPushDevice: Boolean(device) }),decision.policyVersion,decision.reason,decision.channel,decision.priority,new Date(candidate.startsAt).toISOString(),new Date(candidate.expiresAt).toISOString(),now,decision.channel === "push" ? now : null,decision.channel === "push" ? "pending" : "none",notificationId,decision.channel === "push" ? now : null);
    return this.database.prepare("SELECT * FROM proactive_interventions WHERE id=?").get(id) as Record<string,unknown>;
  })(); }
  async interventionPreferences(userId: number) { return (this.database.prepare("SELECT * FROM proactive_intervention_preferences WHERE user_id=?").get(userId) as Record<string,unknown> | undefined) ?? null; }
  async saveInterventionPreferences(userId: number,input: import("@dietdigidose/contracts").InterventionPreferencesUpdate) {
    return this.database.transaction(() => {
      const current = this.database.prepare("SELECT version FROM proactive_intervention_preferences WHERE user_id=?").get(userId) as {version:number} | undefined;
      if ((current?.version ?? 0) !== input.version) return null;
      this.database.prepare(`INSERT INTO proactive_intervention_preferences(user_id,enabled,expiry_rescue,dinner_window,time_zone,quiet_start,quiet_end,dinner_time,dinner_lead_minutes,daily_push_limit,cooldown_minutes,version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,expiry_rescue=excluded.expiry_rescue,dinner_window=excluded.dinner_window,time_zone=excluded.time_zone,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,dinner_time=excluded.dinner_time,dinner_lead_minutes=excluded.dinner_lead_minutes,daily_push_limit=excluded.daily_push_limit,cooldown_minutes=excluded.cooldown_minutes,version=excluded.version,updated_at=CURRENT_TIMESTAMP`)
        .run(userId,Number(input.enabled),Number(input.expiry_rescue),Number(input.dinner_window),input.time_zone,input.quiet_start,input.quiet_end,input.dinner_time,input.dinner_lead_minutes,input.daily_push_limit,input.cooldown_minutes,input.version+1);
      this.database.prepare(`UPDATE proactive_interventions SET delivery_state='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE user_id=? AND delivery_state='pending' AND (?=0 OR (kind='expiry_rescue' AND ?=0) OR (kind='dinner_window' AND ?=0))`)
        .run(userId,Number(input.enabled),Number(input.expiry_rescue),Number(input.dinner_window));
      return this.database.prepare("SELECT * FROM proactive_intervention_preferences WHERE user_id=?").get(userId) as Record<string,unknown>;
    })();
  }
  async preferences(userId: number) {
    const row = this.database.prepare(`SELECT expiring_alert,meal_reminder,water_reminder,breakfast_time,lunch_time,dinner_time, water_start_time,water_end_time,water_interval_minutes,quiet_start_time,quiet_end_time,weekdays_enabled,weekends_enabled FROM user_notification_preferences WHERE user_id=?`).get(userId) as PreferenceRow | undefined;
    return row ? this.preference(row) : null;
  }

  async savePreferences(userId: number, input: NotificationPreferences) {
    this.database.prepare(`INSERT INTO user_notification_preferences(user_id,expiring_alert,meal_reminder,water_reminder, breakfast_time,lunch_time,dinner_time,water_start_time,water_end_time,water_interval_minutes,quiet_start_time,quiet_end_time, weekdays_enabled,weekends_enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET expiring_alert=excluded.expiring_alert,meal_reminder=excluded.meal_reminder, water_reminder=excluded.water_reminder,breakfast_time=excluded.breakfast_time,lunch_time=excluded.lunch_time, dinner_time=excluded.dinner_time,water_start_time=excluded.water_start_time,water_end_time=excluded.water_end_time, water_interval_minutes=excluded.water_interval_minutes,quiet_start_time=excluded.quiet_start_time, quiet_end_time=excluded.quiet_end_time,weekdays_enabled=excluded.weekdays_enabled,weekends_enabled=excluded.weekends_enabled, updated_at=CURRENT_TIMESTAMP`).run(userId, Number(input.expiring_alert), Number(input.meal_reminder), Number(input.water_reminder),
      input.breakfast_time, input.lunch_time, input.dinner_time, input.water_start_time, input.water_end_time,
      input.water_interval_minutes, input.quiet_start_time, input.quiet_end_time, Number(input.weekdays_enabled), Number(input.weekends_enabled));
  }

  async saveDevice(userId: number, token: string, platform: string) {
    this.database.prepare(`INSERT INTO push_devices(user_id,expo_push_token,platform,is_active,updated_at) VALUES(?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(expo_push_token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform,is_active=1,updated_at=CURRENT_TIMESTAMP`).run(userId, token, platform);
  }

  async ensureRoutineNotification(input: { userId: number; kind: "meal" | "water"; key: string; dateKey: string; title: string; body: string }) {
    this.database.transaction(() => {
      const groupKey = `routine:${input.kind}:${input.key}:${input.dateKey}`;
      if (this.database.prepare("SELECT 1 FROM user_notification_inbox WHERE user_id=? AND group_key=? LIMIT 1").get(input.userId, groupKey)) return;
      const result = this.database.prepare(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key) VALUES(?,?,?,?,'routine','low','info',?)`).run(input.userId, `${input.kind}_reminder`, input.title, input.body, groupKey);
      this.event(input.userId, Number(result.lastInsertRowid), "created", { source: "routine_materializer", kind: input.kind });
    })();
  }

  async unreadCount(userId: number) {
    return Number((this.database.prepare(`SELECT COUNT(*) AS count FROM user_notification_inbox WHERE user_id=? AND is_read=0 AND(snoozed_until IS NULL OR julianday(snoozed_until)<=julianday('now'))`).get(userId) as { count: number }).count);
  }

  async history(userId: number, filter: NotificationFilter, cursor: number | null, limit: number) {
    const conditions = ["user_id=?", "(snoozed_until IS NULL OR julianday(snoozed_until)<=julianday('now'))"];
    const params: Array<number | string> = [userId];
    if (filter === "pending") conditions.push("category='action_required'", "action_status='pending'");
    else if (filter === "system") conditions.push("category='system'");
    if (cursor) { conditions.push("id<?"); params.push(cursor); }
    params.push(limit);
    const rows = this.database.prepare(`SELECT (SELECT p.id FROM proactive_interventions p WHERE p.notification_id=user_notification_inbox.id AND p.user_id=user_notification_inbox.user_id ORDER BY p.id LIMIT 1) AS interventionId,id,feedback_id AS feedbackId,type,title,body,is_read AS isRead,strftime('%Y-%m-%dT%H:%M:%fZ',created_at) AS createdAt, inventory_item_id AS inventoryItemId,category,priority,action_status AS actionStatus,snoozed_until AS snoozedUntil, (SELECT COUNT(*) FROM notification_inventory_items n WHERE n.notification_id=user_notification_inbox.id) AS itemCount FROM user_notification_inbox WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row, isRead: row.isRead !== 0 }));
  }

  async readAll(userId: number) {
    return this.database.transaction(() => {
      const changes = this.database.prepare(`UPDATE user_notification_inbox SET is_read=1,read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND is_read=0`).run(userId).changes;
      this.event(userId, null, "read_all", { count: changes });
      return changes;
    })();
  }

  async read(userId: number, notificationId: number) {
    return this.database.transaction(() => {
      const changed = this.database.prepare(`UPDATE user_notification_inbox SET is_read=1,read_at=COALESCE(read_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`).run(notificationId, userId).changes > 0;
      if (changed) this.event(userId, notificationId, "read");
      return changed;
    })();
  }

  async action(userId: number, notificationId: number, action: NotificationAction, metadata?: unknown) {
    return this.database.transaction(() => {
      const item = this.database.prepare("SELECT action_status AS actionStatus FROM user_notification_inbox WHERE id=? AND user_id=?")
        .get(notificationId, userId) as { actionStatus: string } | undefined;
      if (!item) return false;
      if (action === "complete" && item.actionStatus === "completed") return true;
      if (action === "complete") {
        this.database.prepare(`UPDATE user_notification_inbox SET action_status='completed',is_read=1, read_at=COALESCE(read_at,CURRENT_TIMESTAMP),snoozed_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`)
          .run(notificationId, userId);
      } else if (action === "snooze_today") {
        this.database.prepare(`UPDATE user_notification_inbox SET snoozed_until=datetime(date('now','+1 day')),is_read=1, read_at=COALESCE(read_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`).run(notificationId, userId);
      } else this.database.prepare(`UPDATE user_notification_inbox SET is_read=1,read_at=COALESCE(read_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`).run(notificationId, userId);
      this.event(userId, notificationId, `action_${action}`, metadata);
      return true;
    })();
  }

  async localEvent(input: { userId: number; kind: string; title: string; body: string; event: string; sourceId?: string }) {
    return this.database.transaction(() => {
      const groupKey = `local:${input.kind}:${input.sourceId || new Date().toISOString().slice(0, 10)}`;
      let row = this.database.prepare(`SELECT id FROM user_notification_inbox WHERE user_id=? AND type=? AND title=? AND date(created_at)=date('now') ORDER BY id DESC LIMIT 1`).get(input.userId, `${input.kind}_reminder`, input.title) as { id: number } | undefined;
      if (!row) {
        const result = this.database.prepare(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key,is_read,read_at) VALUES(?,?,?,?,'routine','low','info',?,?,?)`).run(input.userId, `${input.kind}_reminder`, input.title, input.body,
          groupKey, Number(input.event === "opened"), input.event === "opened" ? new Date().toISOString() : null);
        row = { id: Number(result.lastInsertRowid) };
        this.event(input.userId, row.id, "created", { source: "local", kind: input.kind });
      } else if (input.event === "opened") this.database.prepare(`UPDATE user_notification_inbox SET is_read=1, read_at=COALESCE(read_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(row.id);
      this.event(input.userId, row.id, input.event === "opened" ? "opened" : "received", { source: "local", kind: input.kind });
      return row.id;
    })();
  }

  async adminData(since: string): Promise<AdminNotificationData> {
    const activeDevices = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM push_devices d JOIN users u ON u.id=d.user_id WHERE d.is_active=1 AND u.role!='admin' AND COALESCE(u.is_disabled,0)=0`).get() as { count: number }).count);
    const enabledUsers = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM users u LEFT JOIN user_notification_preferences p ON p.user_id=u.id WHERE u.role!='admin' AND COALESCE(u.is_disabled,0)=0 AND(COALESCE(p.expiring_alert,1)=1 OR COALESCE(p.meal_reminder,1)=1 OR COALESCE(p.water_reminder,1)=1)`)
      .get() as { count: number }).count);
    const campaigns = this.database.prepare(`SELECT c.id,c.title,c.body,c.status,c.recipient_count AS recipientCount,c.success_count AS successCount, c.failure_count AS failureCount,c.created_at AS createdAt,c.sent_at AS sentAt,u.username AS adminName FROM notification_campaigns c JOIN users u ON u.id=c.admin_user_id ORDER BY c.id DESC LIMIT 30`).all() as Array<Record<string, unknown>>;
    const automatic = this.database.prepare(`SELECT delivery_date AS deliveryDate,status,COUNT(*) AS count FROM notification_deliveries WHERE notification_type='expiring_inventory' GROUP BY delivery_date,status ORDER BY delivery_date DESC LIMIT 30`).all() as Array<Record<string, unknown>>;
    const eventRows = this.database.prepare(`SELECT event_type AS eventType,COUNT(*) AS count FROM notification_events WHERE created_at>=? GROUP BY event_type`).all(since) as Array<{ eventType: string; count: number }>;
    const decisions = this.database.prepare(`SELECT COUNT(*) AS candidates,
      COALESCE(SUM(CASE WHEN channel='suppressed' THEN 1 ELSE 0 END),0) AS suppressed,
      COALESCE(SUM(CASE WHEN channel='inbox_only' THEN 1 ELSE 0 END),0) AS inbox_only,
      COALESCE(SUM(CASE WHEN delivery_state='accepted' THEN 1 ELSE 0 END),0) AS accepted,
      COALESCE(SUM(CASE WHEN delivery_state='uncertain' THEN 1 ELSE 0 END),0) AS uncertain,
      COALESCE(SUM(CASE WHEN delivery_state='failed' THEN 1 ELSE 0 END),0) AS failed,
      COALESCE(SUM(CASE WHEN status='acted' THEN 1 ELSE 0 END),0) AS acted,
      COALESCE(SUM(CASE WHEN notification_id IS NOT NULL THEN 1 ELSE 0 END),0) AS visible,
      COALESCE(SUM(CASE WHEN notification_id IS NOT NULL AND kind='expiry_rescue' THEN 1 ELSE 0 END),0) AS expiry_visible,
      COALESCE(SUM(CASE WHEN notification_id IS NOT NULL AND status<>'acted' AND datetime(expires_at)<=CURRENT_TIMESTAMP THEN 1 ELSE 0 END),0) AS expired_unhandled
      FROM proactive_interventions WHERE datetime(decided_at)>=datetime(?)`).get(since) as Record<string,number>;
    const outcomes = this.database.prepare("SELECT o.outcome_type AS kind,COUNT(*) AS n FROM proactive_intervention_outcomes o JOIN proactive_interventions i ON i.id=o.intervention_id AND i.user_id=o.user_id WHERE datetime(i.decided_at)>=datetime(?) GROUP BY o.outcome_type").all(since) as Array<{kind:string;n:number}>;
    const timely = this.database.prepare("SELECT COUNT(DISTINCT i.id) AS timely_used FROM proactive_interventions i JOIN proactive_intervention_outcomes o ON o.intervention_id=i.id AND o.user_id=i.user_id WHERE i.kind='expiry_rescue' AND o.outcome_type='inventory_used' AND datetime(i.decided_at)>=datetime(?) AND datetime(o.occurred_at)>=datetime(i.decided_at) AND datetime(o.occurred_at)<=datetime(i.expires_at)").get(since) as { timely_used: number };
    const actions = this.database.prepare("SELECT a.action AS kind,COUNT(*) AS n FROM proactive_intervention_actions a JOIN proactive_interventions i ON i.id=a.intervention_id AND i.user_id=a.user_id WHERE datetime(i.decided_at)>=datetime(?) GROUP BY a.action").all(since) as Array<{kind:string;n:number}>;
    return { activeDevices, enabledUsers, campaigns, automatic,
      interventionMetrics: { ...decisions, ...timely, ...Object.fromEntries(outcomes.map(row => [row.kind,Number(row.n)])), ...Object.fromEntries(actions.map(row => [`action_${row.kind}`,Number(row.n)])) },
      eventCounts: Object.fromEntries(eventRows.map((row) => [row.eventType, Number(row.count)])) };
  }

  async beginCampaign(adminUserId: number, title: string, body: string) {
    return this.database.transaction(() => {
      const devices = (this.database.prepare(`SELECT d.id,d.user_id AS userId,d.expo_push_token AS token FROM push_devices d JOIN users u ON u.id=d.user_id WHERE d.is_active=1 AND u.role!='admin' AND COALESCE(u.is_disabled,0)=0`).all() as Array<{ id: number; userId: number; token: string }>);
      const recipients = this.database.prepare("SELECT id FROM users WHERE role!='admin' AND COALESCE(is_disabled,0)=0").all() as Array<{ id: number }>;
      const campaignId = Number(this.database.prepare(`INSERT INTO notification_campaigns(admin_user_id,title,body,recipient_count) VALUES(?,?,?,?)`)
        .run(adminUserId, title, body, recipients.length).lastInsertRowid);
      const addInbox = this.database.prepare(`INSERT INTO user_notification_inbox(user_id,type,title,body,campaign_id,category,priority,action_status) VALUES(?,'admin_campaign',?,?,?,'system','normal','info')`);
      for (const user of recipients) {
        const notificationId = Number(addInbox.run(user.id, title, body, campaignId).lastInsertRowid);
        this.event(user.id, notificationId, "created", { source: "admin_campaign", campaignId });
      }
      return { campaignId, recipientCount: recipients.length, devices };
    })();
  }

  async finishCampaign(campaignId: number, deliveries: CampaignDelivery[], success: number, failure: number) {
    this.database.transaction(() => {
      const record = this.database.prepare(`INSERT INTO notification_campaign_deliveries(campaign_id,user_id,push_device_id,status,error_code) VALUES(?,?,?,?,?)`);
      for (const item of deliveries) record.run(campaignId, item.userId, item.deviceId, item.status, item.errorCode);
      this.database.prepare(`UPDATE notification_campaigns SET status=?,success_count=?,failure_count=?,sent_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(failure ? "completed_with_failures" : "completed", success, failure, campaignId);
    })();
  }

  async failCampaign(campaignId: number, failureCount: number) {
    this.database.prepare("UPDATE notification_campaigns SET status='failed',failure_count=?,sent_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(failureCount, campaignId);
  }

  async recordPushTickets(entries: Array<{ message: PushMessage; ticket: ExpoTicket }>) {
    this.database.transaction(() => {
      for (const { message, ticket } of entries) {
        if (ticket.details?.error === "DeviceNotRegistered") this.deactivate(message.to);
        const owner = this.owner(message);
        if (!owner) continue;
        if (ticket.id) this.database.prepare(`INSERT OR REPLACE INTO push_notification_receipts(expo_ticket_id,user_id,notification_id, expo_push_token,submit_status,receipt_status,error_code,error_message) VALUES(?,?,?,?,?,'pending',?,?)`)
          .run(ticket.id, owner.userId, owner.notificationId, message.to, ticket.status ?? "unknown", ticket.details?.error ?? null, ticket.message ?? null);
        this.event(owner.userId, owner.notificationId, ticket.status === "ok" ? "push_submitted" : "push_submit_failed",
          { error: ticket.details?.error ?? null }, ticket.id ?? null);
      }
    })();
  }

  async pendingReceipts(before: string, limit: number) {
    return this.database.prepare(`SELECT expo_ticket_id AS ticketId,user_id AS userId,notification_id AS notificationId,expo_push_token AS token FROM push_notification_receipts WHERE receipt_status='pending' AND created_at<=? ORDER BY created_at ASC LIMIT ?`)
      .all(before, limit) as Array<{ ticketId: string; userId: number; notificationId: number | null; token: string }>;
  }

  async applyReceipts(receipts: PushReceiptResult[]) {
    this.database.transaction(() => {
      for (const item of receipts) {
        const status = item.receipt.status === "ok" ? "delivered" : "failed";
        this.database.prepare(`UPDATE push_notification_receipts SET receipt_status=?,error_code=?,error_message=?,checked_at=CURRENT_TIMESTAMP WHERE expo_ticket_id=?`).run(status, item.receipt.details?.error ?? null, item.receipt.message ?? null, item.ticketId);
        this.event(item.userId, item.notificationId, status === "delivered" ? "push_delivered" : "push_delivery_failed",
          { error: item.receipt.details?.error ?? null }, item.ticketId);
        if (item.receipt.details?.error === "DeviceNotRegistered") this.deactivate(item.token);
      }
    })();
  }

  async prepareExpiring(today: string, deadline: string) {
    return this.database.transaction(() => {
      const rows = this.database.prepare(`SELECT i.id,i.user_id AS userId,i.food_name AS name,i.expiration_date AS expiration FROM inventory_items i LEFT JOIN user_notification_preferences p ON p.user_id=i.user_id JOIN users u ON u.id=i.user_id AND COALESCE(u.is_disabled,0)=0 WHERE i.is_available=1 AND COALESCE(p.expiring_alert,1)=1 AND i.expiration_date>=? AND i.expiration_date<=? ORDER BY i.user_id,i.expiration_date,i.id`).all(today, deadline) as
        Array<ExpiryItem & { userId: number }>;
      const all = new Map<number, ExpiryItem[]>(); const reserved = new Set<number>();
      const reserve = this.database.prepare(`INSERT OR IGNORE INTO notification_deliveries(user_id,inventory_item_id,notification_type,delivery_date) VALUES(?,?,'expiring_inventory',?)`);
      for (const row of rows) {
        all.set(row.userId, [...(all.get(row.userId) ?? []), { id: row.id, name: row.name, expiration: row.expiration }]);
        if (reserve.run(row.userId, row.id, today).changes) reserved.add(row.userId);
      }
      const result = [];
      for (const userId of reserved) {
        const items = all.get(userId)!; const content = expiryContent(today, items); const groupKey = `expiring:${today}`;
        const existing = this.database.prepare(`SELECT id FROM user_notification_inbox WHERE user_id=? AND group_key=? ORDER BY id DESC LIMIT 1`)
          .get(userId, groupKey) as { id: number } | undefined;
        const notificationId = existing?.id ?? Number(this.database.prepare(`INSERT INTO user_notification_inbox (user_id,type,title,body,inventory_item_id,category,priority,action_status,group_key) VALUES(?,'expiring_inventory',?,?,?,'action_required',?,'pending',?)`)
          .run(userId, content.title, content.body, content.first.id, content.priority, groupKey).lastInsertRowid);
        if (existing) this.database.prepare(`UPDATE user_notification_inbox SET title=?,body=?,inventory_item_id=?,priority=?,action_status='pending', snoozed_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(content.title, content.body, content.first.id, content.priority, notificationId);
        const link = this.database.prepare(`INSERT OR IGNORE INTO notification_inventory_items(notification_id,inventory_item_id,user_id) VALUES(?,?,?)`);
        for (const item of items) link.run(notificationId, item.id, userId);
        this.event(userId, notificationId, existing ? "merged" : "created", { itemCount: items.length, daysUntilExpiry: content.days });
        const tokens = (this.database.prepare("SELECT expo_push_token AS token FROM push_devices WHERE user_id=? AND is_active=1").all(userId) as Array<{ token: string }>).map((row) => row.token);
        result.push({ userId, notificationId, inventoryItemId: content.first.id, title: content.title, body: content.body, tokens });
      }
      return result;
    })();
  }

  async markExpiringDeliveries(today: string, statuses: Array<{ userId: number; status: "accepted" | "failed" | "inbox_only" }>) {
    this.database.transaction(() => {
      const statement = this.database.prepare(`UPDATE notification_deliveries SET status=? WHERE user_id=? AND notification_type='expiring_inventory' AND delivery_date=? AND status='queued'`);
      for (const item of statuses) statement.run(item.status, item.userId, today);
    })();
  }

  private preference(row: PreferenceRow): NotificationPreferences {
    return { ...row, expiring_alert: row.expiring_alert !== 0, meal_reminder: row.meal_reminder !== 0,
      water_reminder: row.water_reminder !== 0, weekdays_enabled: row.weekdays_enabled !== 0, weekends_enabled: row.weekends_enabled !== 0 };
  }
  private event(userId: number, notificationId: number | null, eventType: string, metadata?: unknown, ticketId?: string | null) {
    this.database.prepare(`INSERT INTO notification_events(user_id,notification_id,event_type,metadata_json,expo_ticket_id) VALUES(?,?,?,?,?)`)
      .run(userId, notificationId, eventType, metadata === undefined ? null : JSON.stringify(metadata), ticketId ?? null);
  }
  private deactivate(token: string) {
    this.database.prepare("UPDATE push_devices SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE expo_push_token=?").run(token);
  }
  private owner(message: PushMessage) {
    const device = this.database.prepare("SELECT user_id AS userId FROM push_devices WHERE expo_push_token=?").get(message.to) as { userId: number } | undefined;
    if (!device) return null;
    let notificationId: number | null = null;
    if (typeof message.data.inventoryItemId === "number") notificationId = (this.database.prepare(`SELECT id FROM user_notification_inbox WHERE user_id=? AND inventory_item_id=? ORDER BY id DESC LIMIT 1`).get(device.userId, message.data.inventoryItemId) as { id: number } | undefined)?.id ?? null;
    else if (typeof message.data.campaignId === "number") notificationId = (this.database.prepare(`SELECT id FROM user_notification_inbox WHERE user_id=? AND campaign_id=? ORDER BY id DESC LIMIT 1`).get(device.userId, message.data.campaignId) as { id: number } | undefined)?.id ?? null;
    return { userId: device.userId, notificationId };
  }
}
