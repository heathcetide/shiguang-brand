import { randomUUID } from "node:crypto";
import { decideInterventionFeedback, feedbackRequest, replayInterventionFeedback, type InterventionFeedbackDecision } from "../interventions/feedback.js";
import type { InterventionFeedback } from "@dietdigidose/contracts";
import { interventionDeliveryBlock, type InterventionDeliveryClaim, type InterventionDeliveryResult } from "../interventions/delivery.js";
import { interventionCandidateId } from "../interventions/opportunities.js";
import { reservationDecision, type InterventionReservation } from "../interventions/reservation.js";
import type { Pool, PoolClient } from "pg";
import { expiryContent, type ExpiryItem } from "./expiry.js";
import type { NotificationsRepository } from "./repository.js";
import type {
  AdminNotificationData, CampaignDelivery, ExpoTicket, NotificationAction, NotificationFilter,
  NotificationPreferences, PushMessage, PushReceiptResult,
} from "./types.js";

export class PostgresNotificationsRepository implements NotificationsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async activeInterventionSnooze(userId: number,now: number): Promise<number | null> {
    const row = (await this.pool.query("SELECT MAX(snoozed_until) AS until FROM proactive_interventions WHERE user_id=$1 AND kind='expiry_rescue' AND snoozed_until>$2",[userId,new Date(now).toISOString()])).rows[0];
    return row.until ? new Date(row.until).getTime() : null;
  }
  async feedbackIntervention(userId: number,id: string,input: InterventionFeedback,now: number): Promise<InterventionFeedbackDecision> {
    const request = feedbackRequest(id,input);
    return this.tx(async client => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId]);
      const existing = (await client.query("SELECT request_json,result_json FROM proactive_intervention_actions WHERE user_id=$1 AND idempotency_key=$2",[userId,input.idempotencyKey])).rows[0] ?? null;
      const replay = replayInterventionFeedback(existing,id,input);
      if (replay) return replay;
      const row = (await client.query("SELECT * FROM proactive_interventions WHERE user_id=$1 AND id=$2 FOR UPDATE",[userId,id])).rows[0] ?? null;
      const preferences = (await client.query("SELECT * FROM proactive_intervention_preferences WHERE user_id=$1",[userId])).rows[0] ?? null;
      const decision = decideInterventionFeedback(row,preferences,input,now);
      if (!decision.ok) return decision;
      const result = decision.result,at = new Date(now).toISOString();
      await client.query("UPDATE proactive_interventions SET status='acted',snoozed_until=$1,delivery_state=CASE WHEN delivery_state='pending' THEN 'cancelled' ELSE delivery_state END,updated_at=$2 WHERE user_id=$3 AND id=$4",[result.snoozedUntil,at,userId,id]);
      await client.query("UPDATE user_notification_inbox SET action_status='completed',is_read=TRUE,read_at=$1,snoozed_until=$2,updated_at=$1 WHERE user_id=$3 AND id=$4",[at,result.snoozedUntil,userId,row.notification_id]);
      if (result.notCookingDate) {
        await client.query("UPDATE proactive_intervention_preferences SET not_cooking_date=$1,version=version+1,updated_at=$2 WHERE user_id=$3",[result.notCookingDate,at,userId]);
        await client.query("UPDATE proactive_interventions SET delivery_state='cancelled',updated_at=$1 WHERE user_id=$2 AND kind='dinner_window' AND delivery_state='pending' AND candidate_json->>'localDate'=$3",[at,userId,result.notCookingDate]);
      }
      if (result.snoozedUntil) await client.query("UPDATE proactive_interventions SET delivery_state='cancelled',updated_at=$1 WHERE user_id=$2 AND kind='expiry_rescue' AND delivery_state='pending'",[at,userId]);
      await client.query("INSERT INTO proactive_intervention_actions(id,intervention_id,user_id,idempotency_key,action,request_json,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",[randomUUID(),id,userId,input.idempotencyKey,input.action,JSON.stringify(request),JSON.stringify(result),at]);
      return decision;
    });
  }

  async interventionCard(userId: number,id: string): Promise<Record<string,unknown> | null> {
    return (await this.pool.query("SELECT * FROM proactive_interventions WHERE user_id=$1 AND id=$2 AND notification_id IS NOT NULL",[userId,id])).rows[0] ?? null;
  }

  async interventionScanCursor(): Promise<number> {
    const row = (await this.pool.query("SELECT after_user_id FROM proactive_intervention_scan_cursor WHERE name='opportunities'")).rows[0];
    return Number(row?.after_user_id ?? 0);
  }
  async advanceInterventionScan(expected: number,next: number,owner: string): Promise<boolean> {
    if (![expected,next].every(value => Number.isSafeInteger(value) && value>=0) || !owner) throw new Error("Invalid scan checkpoint");
    return this.tx(async client => {
      if (!(await client.query("SELECT 1 FROM worker_task_leases WHERE task_name='intervention-scan' AND owner_id=$1 AND lease_expires_at>clock_timestamp() FOR UPDATE",[owner])).rows.length) return false;
      await client.query("INSERT INTO proactive_intervention_scan_cursor(name) VALUES('opportunities') ON CONFLICT(name) DO NOTHING");
      return (await client.query("UPDATE proactive_intervention_scan_cursor SET after_user_id=$1,updated_at=clock_timestamp() WHERE name='opportunities' AND after_user_id=$2 AND EXISTS (SELECT 1 FROM worker_task_leases WHERE task_name='intervention-scan' AND owner_id=$3 AND lease_expires_at>clock_timestamp())",[next,expected,owner])).rowCount===1;
    });
  }

  async interventionScanUsers(afterId: number,limit: number): Promise<number[]> {
    if (!Number.isSafeInteger(afterId) || afterId<0 || !Number.isInteger(limit) || limit<1 || limit>100) throw new Error("Invalid opportunity scan");
    return (await this.pool.query("SELECT user_id FROM proactive_intervention_preferences WHERE enabled=1 AND (expiry_rescue=1 OR dinner_window=1) AND user_id>$1 ORDER BY user_id LIMIT $2",[afterId,limit])).rows.map(row => Number(row.user_id));
  }
  async interventionQueue(userId: number): Promise<Record<string,unknown>[]> {
    return (await this.pool.query("SELECT status,planned_at,deleted_at FROM cooking_queue_items WHERE user_id=$1 AND deleted_at IS NULL AND status IN ('waiting','preparing','ready','cooking')",[userId])).rows;
  }

  async pendingInterventionUsers(now: number,limit: number): Promise<number[]> {
    if (!Number.isFinite(now) || !Number.isInteger(limit) || limit<1 || limit>500) throw new Error("Invalid delivery scan");
    const at = new Date(now).toISOString();
    return (await this.pool.query("SELECT user_id FROM proactive_interventions WHERE (delivery_state='pending' AND next_attempt_at<=$1) OR (delivery_state='sending' AND lease_until<=$1) GROUP BY user_id ORDER BY MIN(COALESCE(next_attempt_at,lease_until)),user_id LIMIT $2",[at,limit])).rows.map(row => Number(row.user_id));
  }

  async claimIntervention(userId: number,now: number,owner: string,featureEnabled: boolean): Promise<InterventionDeliveryClaim | null> {
    if (!owner.trim() || owner.length>200 || !Number.isFinite(now)) throw new Error("Invalid delivery claim");
    return this.tx(async client => {
      const at = new Date(now).toISOString();
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId]);
      await client.query("UPDATE proactive_interventions SET delivery_state='uncertain',lease_owner=NULL,lease_until=NULL,updated_at=$1 WHERE user_id=$2 AND delivery_state='sending' AND lease_until<=$1",[at,userId]);
      const row = (await client.query("SELECT * FROM proactive_interventions WHERE user_id=$1 AND delivery_state='pending' AND next_attempt_at<=$2 ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE",[userId,at])).rows[0];
      if (!row) return null;
      const prefs = (await client.query("SELECT * FROM proactive_intervention_preferences WHERE user_id=$1",[userId])).rows[0] ?? null;
      const block = interventionDeliveryBlock(row,prefs,now,featureEnabled);
      const devices = (await client.query("SELECT expo_push_token FROM push_devices WHERE user_id=$1 AND is_active=TRUE ORDER BY id",[userId])).rows;
      if (block || !devices.length) {
        await client.query("UPDATE proactive_interventions SET delivery_state='cancelled',decision_reason=$1,updated_at=$2,status=CASE WHEN expires_at<=$2 THEN 'expired' ELSE status END WHERE id=$3",[block ?? 'delivery_no_device',at,row.id]);
        return null;
      }
      await client.query("UPDATE proactive_interventions SET delivery_state='sending',lease_owner=$1,lease_until=$2,delivery_attempts=delivery_attempts+1,updated_at=$3 WHERE id=$4",[owner,new Date(now+120_000).toISOString(),at,row.id]);
      const candidate = row.candidate_json as {title:string;body:string};
      return { id: String(row.id),owner,userId,title: candidate.title,body: candidate.body,notificationId: Number(row.notification_id),priority: row.priority === 'high' ? 'high' : 'normal',tokens: devices.map(device => String(device.expo_push_token)) };
    });
  }
  async finishIntervention(id: string,owner: string,now: number,result: InterventionDeliveryResult) {
    if (!["accepted","failed","uncertain"].includes(result)) throw new Error("Invalid delivery result");
    const at = new Date(now).toISOString();
    return ((await this.pool.query("UPDATE proactive_interventions SET delivery_state=$1,status=CASE WHEN $1='accepted' AND status='inbox' THEN 'sent' ELSE status END,lease_owner=NULL,lease_until=NULL,updated_at=$2 WHERE id=$3 AND delivery_state='sending' AND lease_owner=$4 AND lease_until>$2",[result,at,id,owner])).rowCount ?? 0)===1;
  }
  async reserveIntervention(input: InterventionReservation) { return this.tx(async client => {
    const candidate = input.candidate;
    // Same account lock as preference changes: serializes quota reservations and opt-out.
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[candidate.userId]);
    const existing = (await client.query("SELECT * FROM proactive_interventions WHERE user_id=$1 AND source_key=$2",[candidate.userId,candidate.sourceKey])).rows[0];
    if (existing) return existing;
    const preferences = (await client.query("SELECT * FROM proactive_intervention_preferences WHERE user_id=$1",[candidate.userId])).rows[0] ?? null;
    const history = (await client.query("SELECT kind,snoozed_until,decided_at,push_reserved_at,channel FROM proactive_interventions WHERE user_id=$1 AND decided_at>=$2",[candidate.userId,new Date(input.now-7*86_400_000).toISOString()])).rows;
    const hasPushDevice = (await client.query("SELECT id FROM push_devices WHERE user_id=$1 AND is_active=TRUE LIMIT 1",[candidate.userId])).rows.length>0;
    const decision = reservationDecision(input,preferences,history,hasPushDevice);
    if (decision.reason === "snoozed") return { deferred: true,reason: decision.reason };
    const id = interventionCandidateId(candidate),now = new Date(input.now).toISOString();
    let notificationId: number | null = null;
    if (decision.channel !== "suppressed") notificationId = Number((await client.query(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key)
      VALUES($1,'proactive_intervention',$2,$3,'action_required',$4,'pending',$5) RETURNING id`,[candidate.userId,candidate.title,candidate.body,decision.priority ?? "normal",`intervention:${id}`])).rows[0].id);
    return (await client.query(`INSERT INTO proactive_interventions(id,user_id,source_key,kind,status,candidate_json,policy_input_json,policy_version,decision_reason,channel,priority,starts_at,expires_at,decided_at,push_reserved_at,delivery_state,notification_id,next_attempt_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,[id,candidate.userId,candidate.sourceKey,candidate.kind,decision.channel === "suppressed" ? "suppressed" : "inbox",JSON.stringify(candidate),JSON.stringify({ input,preferences,history,hasPushDevice }),decision.policyVersion,decision.reason,decision.channel,decision.priority,new Date(candidate.startsAt).toISOString(),new Date(candidate.expiresAt).toISOString(),now,decision.channel === "push" ? now : null,decision.channel === "push" ? "pending" : "none",notificationId,decision.channel === "push" ? now : null])).rows[0];
  }); }
  async interventionPreferences(userId: number) { return (await this.pool.query("SELECT * FROM proactive_intervention_preferences WHERE user_id=$1",[userId])).rows[0] ?? null; }
  async saveInterventionPreferences(userId: number,input: import("@dietdigidose/contracts").InterventionPreferencesUpdate) {
    return this.tx(async client => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId]);
      const current = (await client.query("SELECT version FROM proactive_intervention_preferences WHERE user_id=$1",[userId])).rows[0];
      if (Number(current?.version ?? 0) !== input.version) return null;
      const result = await client.query(`INSERT INTO proactive_intervention_preferences(user_id,enabled,expiry_rescue,dinner_window,time_zone,quiet_start,quiet_end,dinner_time,dinner_lead_minutes,daily_push_limit,cooldown_minutes,version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,expiry_rescue=excluded.expiry_rescue,dinner_window=excluded.dinner_window,time_zone=excluded.time_zone,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,dinner_time=excluded.dinner_time,dinner_lead_minutes=excluded.dinner_lead_minutes,daily_push_limit=excluded.daily_push_limit,cooldown_minutes=excluded.cooldown_minutes,version=excluded.version,updated_at=CURRENT_TIMESTAMP RETURNING *`,
        [userId,Number(input.enabled),Number(input.expiry_rescue),Number(input.dinner_window),input.time_zone,input.quiet_start,input.quiet_end,input.dinner_time,input.dinner_lead_minutes,input.daily_push_limit,input.cooldown_minutes,input.version+1]);
      await client.query(`UPDATE proactive_interventions SET delivery_state='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1 AND delivery_state='pending' AND ($2=0 OR (kind='expiry_rescue' AND $3=0) OR (kind='dinner_window' AND $4=0))`,[userId,Number(input.enabled),Number(input.expiry_rescue),Number(input.dinner_window)]);
      return result.rows[0];
    });
  }
  async preferences(userId: number) {
    const row = (await this.pool.query(`SELECT expiring_alert,meal_reminder,water_reminder,breakfast_time,lunch_time,dinner_time,
      water_start_time,water_end_time,water_interval_minutes,quiet_start_time,quiet_end_time,weekdays_enabled,weekends_enabled
      FROM user_notification_preferences WHERE user_id=$1`, [userId])).rows[0];
    return row ? this.preference(row) : null;
  }

  async savePreferences(userId: number, input: NotificationPreferences) {
    await this.pool.query(`INSERT INTO user_notification_preferences(user_id,expiring_alert,meal_reminder,water_reminder,
      breakfast_time,lunch_time,dinner_time,water_start_time,water_end_time,water_interval_minutes,quiet_start_time,quiet_end_time,
      weekdays_enabled,weekends_enabled,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET expiring_alert=EXCLUDED.expiring_alert,meal_reminder=EXCLUDED.meal_reminder,
      water_reminder=EXCLUDED.water_reminder,breakfast_time=EXCLUDED.breakfast_time,lunch_time=EXCLUDED.lunch_time,
      dinner_time=EXCLUDED.dinner_time,water_start_time=EXCLUDED.water_start_time,water_end_time=EXCLUDED.water_end_time,
      water_interval_minutes=EXCLUDED.water_interval_minutes,quiet_start_time=EXCLUDED.quiet_start_time,
      quiet_end_time=EXCLUDED.quiet_end_time,weekdays_enabled=EXCLUDED.weekdays_enabled,weekends_enabled=EXCLUDED.weekends_enabled,
      updated_at=CURRENT_TIMESTAMP`, [userId, input.expiring_alert, input.meal_reminder, input.water_reminder, input.breakfast_time,
      input.lunch_time, input.dinner_time, input.water_start_time, input.water_end_time, input.water_interval_minutes,
      input.quiet_start_time, input.quiet_end_time, input.weekdays_enabled, input.weekends_enabled]);
  }

  async saveDevice(userId: number, token: string, platform: string) {
    await this.pool.query(`INSERT INTO push_devices(user_id,expo_push_token,platform,is_active,updated_at)
      VALUES($1,$2,$3,TRUE,CURRENT_TIMESTAMP) ON CONFLICT(expo_push_token) DO UPDATE SET user_id=EXCLUDED.user_id,
      platform=EXCLUDED.platform,is_active=TRUE,updated_at=CURRENT_TIMESTAMP`, [userId, token, platform]);
  }

  async ensureRoutineNotification(input: { userId: number; kind: "meal" | "water"; key: string; dateKey: string; title: string; body: string }) {
    await this.tx(async (client) => {
      const groupKey = `routine:${input.kind}:${input.key}:${input.dateKey}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`notification:${input.userId}:${groupKey}`]);
      if ((await client.query("SELECT 1 FROM user_notification_inbox WHERE user_id=$1 AND group_key=$2 LIMIT 1", [input.userId, groupKey])).rowCount) return;
      const inserted = await client.query(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key)
        VALUES($1,$2,$3,$4,'routine','low','info',$5) RETURNING id`, [input.userId, `${input.kind}_reminder`, input.title, input.body, groupKey]);
      await this.event(client, input.userId, Number(inserted.rows[0].id), "created", { source: "routine_materializer", kind: input.kind });
    });
  }

  async unreadCount(userId: number) {
    return Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM user_notification_inbox WHERE user_id=$1 AND is_read=FALSE
      AND(snoozed_until IS NULL OR snoozed_until<=CURRENT_TIMESTAMP)`, [userId])).rows[0].count);
  }

  async history(userId: number, filter: NotificationFilter, cursor: number | null, limit: number) {
    const conditions = ["user_id=$1", "(snoozed_until IS NULL OR snoozed_until<=CURRENT_TIMESTAMP)"];
    const params: Array<number | string> = [userId];
    if (filter === "pending") conditions.push("category='action_required'", "action_status='pending'");
    else if (filter === "system") conditions.push("category='system'");
    if (cursor) { params.push(cursor); conditions.push(`id<$${params.length}`); }
    params.push(limit);
    const rows = (await this.pool.query(`SELECT (SELECT p.id FROM proactive_interventions p WHERE p.notification_id=user_notification_inbox.id AND p.user_id=user_notification_inbox.user_id ORDER BY p.id LIMIT 1) AS "interventionId",id,feedback_id AS "feedbackId",type,title,body,is_read AS "isRead",created_at AS "createdAt",
      inventory_item_id AS "inventoryItemId",category,priority,action_status AS "actionStatus",snoozed_until AS "snoozedUntil",
      (SELECT COUNT(*)::integer FROM notification_inventory_items n WHERE n.notification_id=user_notification_inbox.id) AS "itemCount"
      FROM user_notification_inbox WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT $${params.length}`, params)).rows;
    return rows.map((row) => ({ ...row, id: Number(row.id), inventoryItemId: row.inventoryItemId == null ? null : Number(row.inventoryItemId),
      isRead: Boolean(row.isRead), itemCount: Number(row.itemCount) }));
  }

  async readAll(userId: number) {
    return this.tx(async (client) => {
      const changes = (await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1 AND is_read=FALSE`, [userId])).rowCount ?? 0;
      await this.event(client, userId, null, "read_all", { count: changes });
      return changes;
    });
  }

  async read(userId: number, notificationId: number) {
    return this.tx(async (client) => {
      const changed = (await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,read_at=COALESCE(read_at,CURRENT_TIMESTAMP),
        updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId])).rowCount === 1;
      if (changed) await this.event(client, userId, notificationId, "read");
      return changed;
    });
  }

  async action(userId: number, notificationId: number, action: NotificationAction, metadata?: unknown) {
    return this.tx(async (client) => {
      const item = (await client.query(`SELECT action_status AS "actionStatus" FROM user_notification_inbox
        WHERE id=$1 AND user_id=$2 FOR UPDATE`, [notificationId, userId])).rows[0];
      if (!item) return false;
      if (action === "complete" && item.actionStatus === "completed") return true;
      if (action === "complete") {
        await client.query(`UPDATE user_notification_inbox SET action_status='completed',is_read=TRUE,
          read_at=COALESCE(read_at,CURRENT_TIMESTAMP),snoozed_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId]);
      } else if (action === "snooze_today") await client.query(`UPDATE user_notification_inbox SET
        snoozed_until=date_trunc('day',CURRENT_TIMESTAMP)+INTERVAL '1 day',is_read=TRUE,
        read_at=COALESCE(read_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId]);
      else await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,read_at=COALESCE(read_at,CURRENT_TIMESTAMP),
        updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId]);
      await this.event(client, userId, notificationId, `action_${action}`, metadata);
      return true;
    });
  }

  async localEvent(input: { userId: number; kind: string; title: string; body: string; event: string; sourceId?: string }) {
    return this.tx(async (client) => {
      const lockKey = `local:${input.userId}:${input.kind}:${input.title}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockKey]);
      let row = (await client.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND type=$2 AND title=$3
        AND created_at::date=CURRENT_DATE ORDER BY id DESC LIMIT 1 FOR UPDATE`, [input.userId, `${input.kind}_reminder`, input.title])).rows[0];
      if (!row) {
        const groupKey = `local:${input.kind}:${input.sourceId || new Date().toISOString().slice(0, 10)}`;
        row = (await client.query(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key,is_read,read_at)
          VALUES($1,$2,$3,$4,'routine','low','info',$5,$6,$7) RETURNING id`, [input.userId, `${input.kind}_reminder`, input.title,
          input.body, groupKey, input.event === "opened", input.event === "opened" ? new Date().toISOString() : null])).rows[0];
        await this.event(client, input.userId, Number(row.id), "created", { source: "local", kind: input.kind });
      } else if (input.event === "opened") await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,
        read_at=COALESCE(read_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [row.id]);
      await this.event(client, input.userId, Number(row.id), input.event === "opened" ? "opened" : "received", { source: "local", kind: input.kind });
      return Number(row.id);
    });
  }

  async adminData(since: string): Promise<AdminNotificationData> {
    const [active, enabled, campaigns, automatic, events] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::integer AS count FROM push_devices d JOIN users u ON u.id=d.user_id
        WHERE d.is_active=TRUE AND u.role!='admin' AND COALESCE(u.is_disabled,FALSE)=FALSE`),
      this.pool.query(`SELECT COUNT(*)::integer AS count FROM users u LEFT JOIN user_notification_preferences p ON p.user_id=u.id
        WHERE u.role!='admin' AND COALESCE(u.is_disabled,FALSE)=FALSE AND(COALESCE(p.expiring_alert,TRUE)=TRUE
        OR COALESCE(p.meal_reminder,TRUE)=TRUE OR COALESCE(p.water_reminder,TRUE)=TRUE)`),
      this.pool.query(`SELECT c.id,c.title,c.body,c.status,c.recipient_count AS "recipientCount",c.success_count AS "successCount",
        c.failure_count AS "failureCount",c.created_at AS "createdAt",c.sent_at AS "sentAt",u.username AS "adminName"
        FROM notification_campaigns c JOIN users u ON u.id=c.admin_user_id ORDER BY c.id DESC LIMIT 30`),
      this.pool.query(`SELECT delivery_date AS "deliveryDate",status,COUNT(*)::integer AS count FROM notification_deliveries
        WHERE notification_type='expiring_inventory' GROUP BY delivery_date,status ORDER BY delivery_date DESC LIMIT 30`),
      this.pool.query(`SELECT event_type AS "eventType",COUNT(*)::integer AS count FROM notification_events WHERE created_at>=$1 GROUP BY event_type`, [since]),
    ]);
    const [decisions,outcomes,actions,timely] = await Promise.all([
      this.pool.query(`SELECT COUNT(*) AS candidates,
        COUNT(*) FILTER(WHERE channel='suppressed') AS suppressed,
        COUNT(*) FILTER(WHERE channel='inbox_only') AS inbox_only,
        COUNT(*) FILTER(WHERE delivery_state='accepted') AS accepted,
        COUNT(*) FILTER(WHERE delivery_state='uncertain') AS uncertain,
        COUNT(*) FILTER(WHERE delivery_state='failed') AS failed,
        COUNT(*) FILTER(WHERE status='acted') AS acted,
        COUNT(*) FILTER(WHERE notification_id IS NOT NULL) AS visible,
        COUNT(*) FILTER(WHERE notification_id IS NOT NULL AND kind='expiry_rescue') AS expiry_visible,
        COUNT(*) FILTER(WHERE notification_id IS NOT NULL AND status<>'acted' AND expires_at<=CURRENT_TIMESTAMP) AS expired_unhandled FROM proactive_interventions WHERE decided_at>=$1`,[since]),
      this.pool.query("SELECT o.outcome_type AS kind,COUNT(*) AS n FROM proactive_intervention_outcomes o JOIN proactive_interventions i ON i.id=o.intervention_id AND i.user_id=o.user_id WHERE i.decided_at>=$1 GROUP BY o.outcome_type",[since]),
      this.pool.query("SELECT a.action AS kind,COUNT(*) AS n FROM proactive_intervention_actions a JOIN proactive_interventions i ON i.id=a.intervention_id AND i.user_id=a.user_id WHERE i.decided_at>=$1 GROUP BY a.action",[since]),
      this.pool.query("SELECT COUNT(DISTINCT i.id) AS timely_used FROM proactive_interventions i JOIN proactive_intervention_outcomes o ON o.intervention_id=i.id AND o.user_id=i.user_id WHERE i.kind='expiry_rescue' AND o.outcome_type='inventory_used' AND i.decided_at>=$1 AND o.occurred_at>=i.decided_at AND o.occurred_at<=i.expires_at",[since]),
    ]);
    return { interventionMetrics: { timely_used: Number(timely.rows[0].timely_used), ...Object.fromEntries(Object.entries(decisions.rows[0]).map(([key,value]) => [key,Number(value)])), ...Object.fromEntries(outcomes.rows.map(row => [row.kind,Number(row.n)])), ...Object.fromEntries(actions.rows.map(row => [`action_${row.kind}`,Number(row.n)])) },
      activeDevices: Number(active.rows[0].count), enabledUsers: Number(enabled.rows[0].count),
      campaigns: campaigns.rows.map((row) => ({ ...row, id: Number(row.id) })), automatic: automatic.rows,
      eventCounts: Object.fromEntries(events.rows.map((row) => [String(row.eventType), Number(row.count)])) };
  }

  async beginCampaign(adminUserId: number, title: string, body: string) {
    return this.tx(async (client) => {
      const recipientCount = Number((await client.query(`SELECT COUNT(*)::integer AS count FROM users
        WHERE role!='admin' AND COALESCE(is_disabled,FALSE)=FALSE`)).rows[0].count);
      const campaignId = Number((await client.query(`INSERT INTO notification_campaigns(admin_user_id,title,body,recipient_count)
        VALUES($1,$2,$3,$4) RETURNING id`, [adminUserId, title, body, recipientCount])).rows[0].id);
      await client.query(`WITH inserted AS(INSERT INTO user_notification_inbox(user_id,type,title,body,campaign_id,category,priority,action_status)
        SELECT id,'admin_campaign',$1,$2,$3,'system','normal','info' FROM users WHERE role!='admin' AND COALESCE(is_disabled,FALSE)=FALSE
        RETURNING id,user_id) INSERT INTO notification_events(user_id,notification_id,event_type,metadata_json)
        SELECT user_id,id,'created',jsonb_build_object('source','admin_campaign','campaignId',$3::bigint) FROM inserted`, [title, body, campaignId]);
      const devices = (await client.query(`SELECT d.id,d.user_id AS "userId",d.expo_push_token AS token FROM push_devices d JOIN users u ON u.id=d.user_id
        WHERE d.is_active=TRUE AND u.role!='admin' AND COALESCE(u.is_disabled,FALSE)=FALSE`)).rows
        .map((row) => ({ id: Number(row.id), userId: Number(row.userId), token: String(row.token) }));
      return { campaignId, recipientCount, devices };
    });
  }

  async finishCampaign(campaignId: number, deliveries: CampaignDelivery[], success: number, failure: number) {
    await this.tx(async (client) => {
      for (const item of deliveries) await client.query(`INSERT INTO notification_campaign_deliveries
        (campaign_id,user_id,push_device_id,status,error_code) VALUES($1,$2,$3,$4,$5)`,
      [campaignId, item.userId, item.deviceId, item.status, item.errorCode]);
      await client.query(`UPDATE notification_campaigns SET status=$1,success_count=$2,failure_count=$3,sent_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [failure ? "completed_with_failures" : "completed", success, failure, campaignId]);
    });
  }

  async failCampaign(campaignId: number, failureCount: number) {
    await this.pool.query("UPDATE notification_campaigns SET status='failed',failure_count=$1,sent_at=CURRENT_TIMESTAMP WHERE id=$2", [failureCount, campaignId]);
  }

  async recordPushTickets(entries: Array<{ message: PushMessage; ticket: ExpoTicket }>) {
    await this.tx(async (client) => {
      for (const { message, ticket } of entries) {
        if (ticket.details?.error === "DeviceNotRegistered") await this.deactivate(client, message.to);
        const owner = await this.owner(client, message);
        if (!owner) continue;
        if (ticket.id) await client.query(`INSERT INTO push_notification_receipts(expo_ticket_id,user_id,notification_id,expo_push_token,
          submit_status,receipt_status,error_code,error_message) VALUES($1,$2,$3,$4,$5,'pending',$6,$7)
          ON CONFLICT(expo_ticket_id) DO UPDATE SET user_id=EXCLUDED.user_id,notification_id=EXCLUDED.notification_id,
          expo_push_token=EXCLUDED.expo_push_token,submit_status=EXCLUDED.submit_status,receipt_status='pending',
          error_code=EXCLUDED.error_code,error_message=EXCLUDED.error_message,checked_at=NULL`,
        [ticket.id, owner.userId, owner.notificationId, message.to, ticket.status ?? "unknown", ticket.details?.error ?? null, ticket.message ?? null]);
        await this.event(client, owner.userId, owner.notificationId, ticket.status === "ok" ? "push_submitted" : "push_submit_failed",
          { error: ticket.details?.error ?? null }, ticket.id ?? null);
      }
    });
  }

  async pendingReceipts(before: string, limit: number) {
    const rows = (await this.pool.query(`SELECT expo_ticket_id AS "ticketId",user_id AS "userId",notification_id AS "notificationId",
      expo_push_token AS token FROM push_notification_receipts WHERE receipt_status='pending' AND created_at<=$1
      ORDER BY created_at ASC LIMIT $2`, [before, limit])).rows;
    return rows.map((row) => ({ ticketId: String(row.ticketId), userId: Number(row.userId),
      notificationId: row.notificationId == null ? null : Number(row.notificationId), token: String(row.token) }));
  }

  async applyReceipts(receipts: PushReceiptResult[]) {
    await this.tx(async (client) => {
      for (const item of receipts) {
        const status = item.receipt.status === "ok" ? "delivered" : "failed";
        await client.query(`UPDATE push_notification_receipts SET receipt_status=$1,error_code=$2,error_message=$3,checked_at=CURRENT_TIMESTAMP
          WHERE expo_ticket_id=$4`, [status, item.receipt.details?.error ?? null, item.receipt.message ?? null, item.ticketId]);
        await this.event(client, item.userId, item.notificationId, status === "delivered" ? "push_delivered" : "push_delivery_failed",
          { error: item.receipt.details?.error ?? null }, item.ticketId);
        if (item.receipt.details?.error === "DeviceNotRegistered") await this.deactivate(client, item.token);
      }
    });
  }

  async prepareExpiring(today: string, deadline: string) {
    return this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`expiring-notifications:${today}`]);
      const rows = (await client.query(`SELECT i.id,i.user_id AS "userId",i.food_name AS name,i.expiration_date AS expiration
        FROM inventory_items i LEFT JOIN user_notification_preferences p ON p.user_id=i.user_id JOIN users u ON u.id=i.user_id
        AND COALESCE(u.is_disabled,FALSE)=FALSE WHERE i.is_available=TRUE AND COALESCE(p.expiring_alert,TRUE)=TRUE
        AND i.expiration_date>=$1 AND i.expiration_date<=$2 ORDER BY i.user_id,i.expiration_date,i.id`, [today, deadline])).rows
        .map((row) => ({ id: Number(row.id), userId: Number(row.userId), name: String(row.name), expiration: String(row.expiration).slice(0, 10) }));
      const all = new Map<number, ExpiryItem[]>(); const reserved = new Set<number>();
      for (const row of rows) {
        all.set(row.userId, [...(all.get(row.userId) ?? []), { id: row.id, name: row.name, expiration: row.expiration }]);
        const inserted = await client.query(`INSERT INTO notification_deliveries(user_id,inventory_item_id,notification_type,delivery_date)
          VALUES($1,$2,'expiring_inventory',$3) ON CONFLICT(user_id,inventory_item_id,notification_type,delivery_date) DO NOTHING RETURNING id`,
        [row.userId, row.id, today]);
        if (inserted.rowCount) reserved.add(row.userId);
      }
      const result = [];
      for (const userId of reserved) {
        const items = all.get(userId)!; const content = expiryContent(today, items); const groupKey = `expiring:${today}`;
        const existing = (await client.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND group_key=$2
          ORDER BY id DESC LIMIT 1 FOR UPDATE`, [userId, groupKey])).rows[0];
        let notificationId: number;
        if (existing) {
          notificationId = Number(existing.id);
          await client.query(`UPDATE user_notification_inbox SET title=$1,body=$2,inventory_item_id=$3,priority=$4,action_status='pending',
            snoozed_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$5`, [content.title, content.body, content.first.id, content.priority, notificationId]);
        } else notificationId = Number((await client.query(`INSERT INTO user_notification_inbox
          (user_id,type,title,body,inventory_item_id,category,priority,action_status,group_key)
          VALUES($1,'expiring_inventory',$2,$3,$4,'action_required',$5,'pending',$6) RETURNING id`,
        [userId, content.title, content.body, content.first.id, content.priority, groupKey])).rows[0].id);
        for (const item of items) await client.query(`INSERT INTO notification_inventory_items(notification_id,inventory_item_id,user_id)
          VALUES($1,$2,$3) ON CONFLICT(notification_id,inventory_item_id) DO NOTHING`, [notificationId, item.id, userId]);
        await this.event(client, userId, notificationId, existing ? "merged" : "created", { itemCount: items.length, daysUntilExpiry: content.days });
        const tokens = (await client.query("SELECT expo_push_token AS token FROM push_devices WHERE user_id=$1 AND is_active=TRUE", [userId])).rows
          .map((row) => String(row.token));
        result.push({ userId, notificationId, inventoryItemId: content.first.id, title: content.title, body: content.body, tokens });
      }
      return result;
    });
  }

  async markExpiringDeliveries(today: string, statuses: Array<{ userId: number; status: "accepted" | "failed" | "inbox_only" }>) {
    await this.tx(async (client) => {
      for (const item of statuses) await client.query(`UPDATE notification_deliveries SET status=$1 WHERE user_id=$2
        AND notification_type='expiring_inventory' AND delivery_date=$3 AND status='queued'`, [item.status, item.userId, today]);
    });
  }

  private preference(row: Record<string, unknown>): NotificationPreferences {
    return { expiring_alert: Boolean(row.expiring_alert), meal_reminder: Boolean(row.meal_reminder), water_reminder: Boolean(row.water_reminder),
      breakfast_time: String(row.breakfast_time), lunch_time: String(row.lunch_time), dinner_time: String(row.dinner_time),
      water_start_time: String(row.water_start_time), water_end_time: String(row.water_end_time), water_interval_minutes: Number(row.water_interval_minutes),
      quiet_start_time: String(row.quiet_start_time), quiet_end_time: String(row.quiet_end_time), weekdays_enabled: Boolean(row.weekdays_enabled),
      weekends_enabled: Boolean(row.weekends_enabled) };
  }
  private event(executor: PoolClient, userId: number, notificationId: number | null, eventType: string, metadata?: unknown, ticketId?: string | null) {
    return executor.query(`INSERT INTO notification_events(user_id,notification_id,event_type,metadata_json,expo_ticket_id)
      VALUES($1,$2,$3,$4::jsonb,$5)`, [userId, notificationId, eventType, metadata === undefined ? null : JSON.stringify(metadata), ticketId ?? null]);
  }
  private deactivate(executor: PoolClient, token: string) {
    return executor.query("UPDATE push_devices SET is_active=FALSE,updated_at=CURRENT_TIMESTAMP WHERE expo_push_token=$1", [token]);
  }
  private async owner(executor: PoolClient, message: PushMessage) {
    const device = (await executor.query("SELECT user_id AS \"userId\" FROM push_devices WHERE expo_push_token=$1", [message.to])).rows[0];
    if (!device) return null;
    const userId = Number(device.userId); let notificationId: number | null = null;
    if (typeof message.data.inventoryItemId === "number") {
      const row = (await executor.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND inventory_item_id=$2 ORDER BY id DESC LIMIT 1`,
        [userId, message.data.inventoryItemId])).rows[0]; notificationId = row ? Number(row.id) : null;
    } else if (typeof message.data.campaignId === "number") {
      const row = (await executor.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND campaign_id=$2 ORDER BY id DESC LIMIT 1`,
        [userId, message.data.campaignId])).rows[0]; notificationId = row ? Number(row.id) : null;
    }
    return { userId, notificationId };
  }
  private async tx<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
