import type { Pool, PoolClient } from "pg";
import type { AuthVerificationRepository } from "./repository.js";
import type {
  ChallengeCreate, DeliveryReport, EventFilters, RegistrationResult, UsageCounter,
  VerificationChallenge, VerificationEventInput, VerificationSubject,
  ReauthUser, ReauthGrantInput, PhoneBindingUser, PhoneBindingInput, PhoneBindingResult,
  PhoneReplacementInput, PhoneReplacementResult,
} from "./types.js";

export class PostgresAuthVerificationRepository implements AuthVerificationRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async phoneBindingUser(userId: number) {
    return (await this.pool.query("SELECT id,email,phone,password_hash,phone_verified_at,session_version,is_disabled,role FROM users WHERE id=$1", [userId])).rows[0] as PhoneBindingUser | undefined ?? null;
  }

  async bindPhone(input: PhoneBindingInput): Promise<PhoneBindingResult> {
    try {
      return await this.tx(async (client) => {
        // Same user-first lock order as password changes/deletion; phone lock also coordinates registration.
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [input.userId]);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`auth:phone:${input.phone}`]);
        // Acquire challenge/subject locks before evaluating time-sensitive predicates.
        await client.query(`SELECT c.id FROM auth_verification_challenges c
          JOIN auth_verification_subjects s ON s.id=c.subject_id WHERE c.id=$1 FOR UPDATE OF c,s`, [input.challengeId]);
        const valid = await client.query(`SELECT c.subject_id,s.provider FROM users u
          JOIN auth_verification_challenges c ON c.reauth_user_id=u.id
          JOIN auth_verification_subjects s ON s.id=c.subject_id
          WHERE u.id=$1 AND u.phone IS NULL AND u.email IS NOT NULL AND u.password_hash IS NOT NULL
          AND u.role='user' AND NOT COALESCE(u.is_disabled,FALSE) AND u.session_version=$2
          AND c.id=$3 AND c.purpose='phone_bind' AND c.reauth_session_version=u.session_version
          AND c.status='verifying' AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp()
          AND s.subject_hmac=$4 AND s.channel='sms' AND s.user_id IS NULL FOR UPDATE OF c,s`,
          [input.userId,input.sessionVersion,input.challengeId,input.subjectHmac]);
        if (!valid.rowCount) return "invalid";
        if ((await client.query("SELECT 1 FROM users WHERE phone=$1", [input.phone])).rowCount) return "phone_exists";
        await client.query("UPDATE users SET phone=$1,phone_verified_at=clock_timestamp() WHERE id=$2", [input.phone,input.userId]);
        await client.query("UPDATE auth_verification_subjects SET user_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [input.userId,valid.rows[0].subject_id]);
        await client.query("UPDATE auth_verification_challenges SET status='consumed',verified_at=CURRENT_TIMESTAMP,consumed_at=CURRENT_TIMESTAMP WHERE id=$1", [input.challengeId]);
        await this.insertEvent(client, valid.rows[0].provider, { subjectId: Number(valid.rows[0].subject_id), challengeId: input.challengeId, eventType: "phone_bind", outcome: "succeeded" });
        return "bound";
      });
    } catch (error) {
      // tx rolls back before translating a uniqueness race to a public conflict.
      if ((error as {code?: string; constraint?: string}).code === "23505" && (error as {constraint?: string}).constraint?.includes("phone")) return "phone_exists";
      throw error;
    }
  }

  async replacePhone(input: PhoneReplacementInput): Promise<PhoneReplacementResult> {
    try {
      return await this.tx(async (client) => {
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [input.userId]);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`auth:phone:${input.phone}`]);
        await client.query(`SELECT c.id FROM auth_verification_challenges c
          JOIN auth_verification_subjects s ON s.id=c.subject_id WHERE c.id=$1 FOR UPDATE OF c,s`, [input.challengeId]);
        const valid = await client.query(`SELECT c.subject_id,s.provider,s.user_id AS subject_user_id,u.phone AS old_phone FROM users u
          JOIN auth_verification_challenges c ON c.reauth_user_id=u.id
          JOIN auth_verification_subjects s ON s.id=c.subject_id
          WHERE u.id=$1 AND u.phone IS NOT NULL AND u.phone_verified_at IS NOT NULL
          AND u.role='user' AND NOT COALESCE(u.is_disabled,FALSE) AND u.session_version=$2
          AND c.id=$3 AND c.purpose='phone_replace' AND c.reauth_session_version=u.session_version
          AND c.status='verifying' AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp()
          AND s.subject_hmac=$4 AND s.channel='sms' FOR UPDATE OF c,s`,
          [input.userId,input.sessionVersion,input.challengeId,input.subjectHmac]);
        if (!valid.rowCount) return "invalid";
        if (valid.rows[0].old_phone === input.phone) return "invalid";
        if (valid.rows[0].subject_user_id !== null || (await client.query("SELECT 1 FROM users WHERE phone=$1", [input.phone])).rowCount) return "phone_exists";
        await client.query("UPDATE users SET phone=$1,phone_verified_at=clock_timestamp() WHERE id=$2", [input.phone,input.userId]);
        await client.query("UPDATE auth_verification_subjects SET user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND channel='sms' AND id!=$2", [input.userId,Number(valid.rows[0].subject_id)]);
        await client.query("UPDATE auth_verification_subjects SET user_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [input.userId,valid.rows[0].subject_id]);
        await client.query("UPDATE auth_verification_challenges SET status='consumed',verified_at=CURRENT_TIMESTAMP,consumed_at=CURRENT_TIMESTAMP WHERE id=$1", [input.challengeId]);
        await client.query("UPDATE account_reauth_grants SET consumed_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND consumed_at IS NULL", [input.userId]);
        await this.insertEvent(client, valid.rows[0].provider, { subjectId: Number(valid.rows[0].subject_id), challengeId: input.challengeId, eventType: "phone_replace", outcome: "succeeded" });
        return "replaced";
      });
    } catch (error) {
      if ((error as {code?: string; constraint?: string}).code === "23505" && (error as {constraint?: string}).constraint?.includes("phone")) return "phone_exists";
      throw error;
    }
  }

  async settings(keys: string[]) {
    if (!keys.length) return {};
    const rows = (await this.pool.query("SELECT key,value FROM system_settings WHERE key=ANY($1::text[])", [keys])).rows;
    return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
  }
  async saveSettings(entries: Array<{ key: string; value: string }>) {
    await this.tx(async (client) => {
      for (const entry of entries) await client.query(`INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2,CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP`, [entry.key, entry.value]);
    });
  }
  async findOrCreateSubject(input: Omit<VerificationSubject, "id" | "user_id"> & { provider: string }) {
    const result = await this.pool.query(`INSERT INTO auth_verification_subjects(channel,provider,subject_hmac,subject_ciphertext,subject_iv,subject_auth_tag)
      VALUES('sms',$1,$2,$3,$4,$5) ON CONFLICT(channel,provider,subject_hmac) DO UPDATE SET
      last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      RETURNING id,user_id,subject_hmac,subject_ciphertext,subject_iv,subject_auth_tag`,
    [input.provider, input.subject_hmac, input.subject_ciphertext, input.subject_iv, input.subject_auth_tag]);
    return this.subject(result.rows[0]);
  }
  async recordEvent(provider: string, input: VerificationEventInput) { await this.insertEvent(this.pool, provider, input); }
  async incrementUsage(usageDate: string, provider: string, counter: UsageCounter, amount: number) {
    await this.increment(this.pool, usageDate, provider, counter, amount);
  }
  async countSubjectSends(subjectId: number, since: string) {
    return Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM auth_verification_events
      WHERE subject_id=$1 AND event_type='send_api_called' AND created_at>=$2`, [subjectId, since])).rows[0].count);
  }
  async countIpSends(ip: string, since: string) {
    return Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM auth_verification_events
      WHERE source_ip=$1 AND event_type='send_api_called' AND created_at>=$2`, [ip, since])).rows[0].count);
  }
  async globalDailySends(usageDate: string, provider: string) {
    return Number((await this.pool.query(`SELECT COALESCE(send_api_calls,0)::integer AS count FROM auth_verification_usage_daily
      WHERE usage_date=$1 AND channel='sms' AND provider=$2`, [usageDate, provider])).rows[0]?.count || 0);
  }
  async createChallenge(input: ChallengeCreate) {
    await this.pool.query(`INSERT INTO auth_verification_challenges(id,subject_id,purpose,out_id,status,expires_at,source_ip,user_agent,reauth_user_id,reauth_session_version)
      VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9)`, [input.id, input.subjectId, input.purpose, input.outId,
      input.expiresAt, input.sourceIp, input.userAgent,input.reauthUserId ?? null,input.reauthSessionVersion ?? null]);
  }
  async failChallenge(challengeId: string) { await this.status(challengeId, "failed"); }
  async acceptChallenge(challengeId: string, subjectId: number, bizId: string | null, requestId: string | null) {
    await this.tx(async (client) => {
      await client.query(`UPDATE auth_verification_challenges SET status='superseded',updated_at=CURRENT_TIMESTAMP
        WHERE subject_id=$1 AND id<>$2 AND purpose=(SELECT purpose FROM auth_verification_challenges WHERE id=$2) AND status IN('pending','accepted')`, [subjectId, challengeId]);
      await client.query(`UPDATE auth_verification_challenges SET status='accepted',biz_id=$1,provider_request_id=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=$3`, [bizId, requestId, challengeId]);
    });
  }
  async challenge(challengeId: string) { return this.challengeBy("c.id=$1", challengeId); }
  async expireChallenge(challengeId: string) { await this.status(challengeId, "expired"); }
  async beginVerification(challengeId: string) {
    return (await this.pool.query(`UPDATE auth_verification_challenges SET attempt_count=attempt_count+1,status='verifying',updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND attempt_count<5 AND status IN('pending','accepted')`, [challengeId])).rowCount === 1;
  }
  async restoreVerification(challengeId: string) {
    await this.pool.query(`UPDATE auth_verification_challenges SET attempt_count=GREATEST(0,attempt_count-1),status='accepted',updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status='verifying'`, [challengeId]);
  }
  async rejectVerification(challengeId: string) {
    await this.pool.query(`UPDATE auth_verification_challenges SET status=CASE WHEN attempt_count>=5 THEN 'failed' ELSE 'accepted' END,
      updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='verifying'`, [challengeId]);
  }
  async userByPhone(phone: string) {
    const row = (await this.pool.query("SELECT id,is_disabled FROM users WHERE phone=$1", [phone])).rows[0];
    return row ? { id: Number(row.id), is_disabled: Boolean(row.is_disabled) } : null;
  }
  async completeLogin(input: { userId: number; subjectId: number; challengeId: string; at: string; sourceIp: string }) {
    await this.tx(async (client) => {
      await client.query("UPDATE auth_verification_subjects SET user_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [input.userId, input.subjectId]);
      await client.query(`UPDATE users SET phone_verified_at=COALESCE(phone_verified_at,$1),last_login_at=$1,last_login_ip=$2 WHERE id=$3`,
        [input.at, input.sourceIp, input.userId]);
      await client.query(`UPDATE auth_verification_challenges SET status='consumed',verified_at=$1,consumed_at=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
        [input.at, input.challengeId]);
    });
  }
  async markRegistrationRequired(input: { challengeId: string; at: string; tokenHash: string; expiresAt: string }) {
    await this.pool.query(`UPDATE auth_verification_challenges SET status='verified',verified_at=$1,registration_token_hash=$2,
      registration_expires_at=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4`, [input.at, input.tokenHash, input.expiresAt, input.challengeId]);
  }
  async registrationChallenge(tokenHash: string) {
    return this.challengeBy(`c.registration_token_hash=$1 AND c.status='verified' AND c.consumed_at IS NULL
      AND c.registration_expires_at>CURRENT_TIMESTAMP`, tokenHash);
  }
  async register(input: { tokenHash: string; phone: string; username: string; passwordHash: string | null; at: string }): Promise<RegistrationResult> {
    return this.tx(async (client) => {
      const challenge = (await client.query(`SELECT c.id,c.subject_id FROM auth_verification_challenges c
        WHERE c.registration_token_hash=$1 AND c.status='verified' AND c.consumed_at IS NULL
        AND c.registration_expires_at>CURRENT_TIMESTAMP FOR UPDATE`, [input.tokenHash])).rows[0];
      if (!challenge) return { status: "invalid_token" } as const;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`auth:phone:${input.phone}`]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`auth:username:${input.username.toLowerCase()}`]);
      if ((await client.query("SELECT 1 FROM users WHERE phone=$1", [input.phone])).rowCount) return { status: "phone_exists" } as const;
      if ((await client.query("SELECT 1 FROM users WHERE LOWER(username)=LOWER($1)", [input.username])).rowCount) return { status: "username_exists" } as const;
      const inserted = await client.query(`INSERT INTO users(username,email,phone,password_hash,avatar_url,phone_verified_at,daily_calories_target)
        VALUES($1,NULL,$2,$3,NULL,$4,NULL) ON CONFLICT DO NOTHING RETURNING id`,
      [input.username, input.phone, input.passwordHash, input.at]);
      if (!inserted.rowCount) {
        if ((await client.query("SELECT 1 FROM users WHERE phone=$1", [input.phone])).rowCount) return { status: "phone_exists" } as const;
        return { status: "username_exists" } as const;
      }
      const userId = Number(inserted.rows[0].id);
      await client.query("INSERT INTO user_health_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING", [userId]);
      await client.query("UPDATE auth_verification_subjects SET user_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [userId, challenge.subject_id]);
      await client.query(`UPDATE auth_verification_challenges SET status='consumed',consumed_at=$1,registration_token_hash=NULL,
        updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [input.at, challenge.id]);
      return { status: "created", userId } as const;
    });
  }
  async userResponse(userId: number) {
    return (await this.pool.query(`SELECT id,username,email,phone,avatar_url,bio,role,daily_calories_target,created_at,
      phone_verified_at,last_login_at,last_login_ip,password_hash IS NOT NULL AS "hasPassword" FROM users WHERE id=$1`, [userId])).rows[0] || null;
  }

  async reauthUser(userId: number) { return ((await this.pool.query("SELECT id,phone,phone_verified_at,session_version,is_disabled,role FROM users WHERE id=$1",[userId])).rows[0] as ReauthUser | undefined) || null; }
  async issueReauthGrant(input: ReauthGrantInput) { return this.tx(async (client) => {
    const valid = await client.query(`SELECT u.id FROM users u JOIN auth_verification_challenges c ON c.reauth_user_id=u.id
      WHERE u.id=$1 AND u.phone=$2 AND u.phone_verified_at IS NOT NULL AND u.session_version=$3 AND NOT COALESCE(u.is_disabled,FALSE)
      AND c.id=$4 AND c.purpose=$5 AND c.reauth_session_version=u.session_version AND c.status='verifying' AND c.expires_at>CURRENT_TIMESTAMP FOR UPDATE OF u,c`,
      [input.userId,input.phone,input.sessionVersion,input.challengeId,input.challengePurpose ?? input.purpose]);
    if (!valid.rowCount) return false;
    await client.query(`INSERT INTO account_reauth_grants(token_hash,user_id,purpose,phone,session_version,expires_at) VALUES($1,$2,$3,$4,$5,$6)`,
      [input.tokenHash,input.userId,input.purpose,input.phone,input.sessionVersion,input.expiresAt]);
    await client.query("UPDATE auth_verification_challenges SET status='consumed',consumed_at=CURRENT_TIMESTAMP,verified_at=CURRENT_TIMESTAMP WHERE id=$1",[input.challengeId]);
    return true;
  }); }
  async recentSendEvent() {
    return (await this.pool.query(`SELECT event_type AS "eventType",outcome,provider_code AS "providerCode",created_at AS "createdAt"
      FROM auth_verification_events WHERE channel='sms' AND event_type IN('send_accepted','send_rejected','send_failed')
      ORDER BY id DESC LIMIT 1`)).rows[0] || null;
  }
  async usageOverview(provider: string, firstUsageDate: string) {
    const [totals, daily] = await Promise.all([
      this.pool.query(`SELECT COALESCE(SUM(send_requests),0)::integer AS "sendRequests",
        COALESCE(SUM(send_api_calls),0)::integer AS "sendApiCalls",COALESCE(SUM(accepted),0)::integer AS accepted,
        COALESCE(SUM(delivered),0)::integer AS delivered,COALESCE(SUM(delivery_failed),0)::integer AS "deliveryFailed",
        COALESCE(SUM(verify_api_calls),0)::integer AS "verifyApiCalls",COALESCE(SUM(verify_passed),0)::integer AS "verifyPassed",
        COALESCE(SUM(verify_failed),0)::integer AS "verifyFailed",COALESCE(SUM(local_rate_limited),0)::integer AS "rateLimited",
        COALESCE(SUM(provider_errors),0)::integer AS "providerErrors",COALESCE(SUM(delivery_units),0)::integer AS "deliveryUnits"
        FROM auth_verification_usage_daily WHERE channel='sms' AND provider=$1 AND usage_date>=$2`, [provider, firstUsageDate]),
      this.pool.query(`SELECT usage_date AS date,send_api_calls AS "sendApiCalls",accepted,delivered,
        delivery_failed AS "deliveryFailed",verify_passed AS "verifyPassed",verify_failed AS "verifyFailed",
        local_rate_limited AS "rateLimited",provider_errors AS "providerErrors",delivery_units AS "deliveryUnits"
        FROM auth_verification_usage_daily WHERE channel='sms' AND provider=$1 AND usage_date>=$2 ORDER BY usage_date ASC`,
      [provider, firstUsageDate]),
    ]);
    return { totals: totals.rows[0] as Record<string, number>, daily: daily.rows as Array<Record<string, unknown>> };
  }
  async usedSince(provider: string, baselineAt: string | null) {
    return Number((await this.pool.query(`SELECT COALESCE(SUM(delivery_units),0)::integer AS count FROM auth_verification_usage_daily
      WHERE channel='sms' AND provider=$1 AND ($2::timestamptz IS NULL OR usage_date>=($2::timestamptz)::date::text)`,
    [provider, baselineAt])).rows[0].count);
  }
  async attacks(since: string) {
    return (await this.pool.query(`SELECT source_ip AS ip,COUNT(*)::integer AS blocked FROM auth_verification_events
      WHERE event_type='send_rate_limited' AND created_at>=$1 GROUP BY source_ip ORDER BY blocked DESC LIMIT 10`, [since])).rows;
  }
  async events(filters: EventFilters, page: number, pageSize: number) {
    const { where, params } = this.eventWhere(filters);
    const total = Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM auth_verification_events e
      JOIN auth_verification_subjects s ON s.id=e.subject_id LEFT JOIN users u ON u.id=s.user_id ${where}`, params)).rows[0].count);
    const rows = (await this.pool.query(`${this.eventSelect()} ${where} ORDER BY e.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize])).rows;
    return { rows, total };
  }
  async eventSubject(eventId: number) {
    return (await this.pool.query(`SELECT e.id,s.id AS "subjectId",s.user_id AS "userId",s.subject_hmac AS "subjectHmac",
      s.subject_ciphertext AS "subjectCiphertext",s.subject_iv AS "subjectIv",s.subject_auth_tag AS "subjectAuthTag"
      FROM auth_verification_events e JOIN auth_verification_subjects s ON s.id=e.subject_id WHERE e.id=$1`, [eventId])).rows[0] || null;
  }
  async updateTestChallenge(challengeId: string, status: string, bizId: string | null, requestId: string | null) {
    await this.pool.query(`UPDATE auth_verification_challenges SET status=$1,biz_id=$2,provider_request_id=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [status, bizId, requestId, challengeId]);
  }
  async recordDeliveryReport(provider: string, report: DeliveryReport) {
    return this.tx(async (client) => {
      const challenge = (await client.query(`SELECT id,subject_id AS "subjectId",biz_id AS "bizId",out_id AS "outId"
        FROM auth_verification_challenges WHERE ($1<>'' AND biz_id=$1) OR ($2<>'' AND out_id=$2)
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [report.bizId, report.outId])).rows[0];
      if (!challenge) return false;
      const outcome = report.success ? "delivered" : "failed";
      if ((await client.query(`SELECT 1 FROM auth_verification_events WHERE challenge_id=$1 AND event_type='delivery_report'
        AND outcome=$2 AND COALESCE(provider_code,'')=$3 LIMIT 1`, [challenge.id, outcome, report.providerCode])).rowCount) return false;
      await this.insertEvent(client, provider, { subjectId: Number(challenge.subjectId), challengeId: String(challenge.id),
        eventType: "delivery_report", outcome, providerCode: report.providerCode, providerMessage: report.providerMessage,
        bizId: String(challenge.bizId || report.bizId || "") || null, outId: String(challenge.outId || report.outId || "") || null,
        details: report.details });
      await this.increment(client, report.usageDate, provider, report.success ? "delivered" : "delivery_failed", 1);
      if (report.success) await this.increment(client, report.usageDate, provider, "delivery_units", report.units);
      return true;
    });
  }

  private async status(id: string, status: string) {
    await this.pool.query("UPDATE auth_verification_challenges SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [status, id]);
  }
  private async challengeBy(condition: string, parameter: string) {
    const row = (await this.pool.query(`SELECT c.*,s.user_id,s.subject_hmac,s.subject_ciphertext,s.subject_iv,s.subject_auth_tag
      FROM auth_verification_challenges c JOIN auth_verification_subjects s ON s.id=c.subject_id WHERE ${condition}`, [parameter])).rows[0];
    return row ? this.challengeRow(row) : null;
  }
  private subject(row: Record<string, unknown>): VerificationSubject {
    return { id: Number(row.id), user_id: row.user_id == null ? null : Number(row.user_id), subject_hmac: String(row.subject_hmac),
      subject_ciphertext: String(row.subject_ciphertext), subject_iv: String(row.subject_iv), subject_auth_tag: String(row.subject_auth_tag) };
  }
  private challengeRow(row: Record<string, unknown>): VerificationChallenge {
    return { ...row, id: String(row.id), subject_id: Number(row.subject_id), user_id: row.user_id == null ? null : Number(row.user_id),
      purpose: String(row.purpose), out_id: String(row.out_id), biz_id: row.biz_id == null ? null : String(row.biz_id),
      status: String(row.status), attempt_count: Number(row.attempt_count), expires_at: this.iso(row.expires_at)!,
      registration_expires_at: this.iso(row.registration_expires_at), subject_hmac: String(row.subject_hmac),
      subject_ciphertext: String(row.subject_ciphertext), subject_iv: String(row.subject_iv), subject_auth_tag: String(row.subject_auth_tag) };
  }
  private iso(value: unknown) { return value == null ? null : value instanceof Date ? value.toISOString() : String(value); }
  private insertEvent(executor: Pick<Pool, "query"> | PoolClient, provider: string, input: VerificationEventInput) {
    return executor.query(`INSERT INTO auth_verification_events(subject_id,challenge_id,channel,provider,event_type,outcome,
      provider_code,provider_message,provider_request_id,biz_id,out_id,source_ip,user_agent,details_json)
      VALUES($1,$2,'sms',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`, [input.subjectId, input.challengeId || null,
      provider, input.eventType, input.outcome, input.providerCode || null, input.providerMessage || null,
      input.providerRequestId || null, input.bizId || null, input.outId || null, input.sourceIp || null, input.userAgent || null,
      input.details ? JSON.stringify(input.details) : null]);
  }
  private increment(executor: Pick<Pool, "query"> | PoolClient, date: string, provider: string, counter: UsageCounter, amount: number) {
    return executor.query(`INSERT INTO auth_verification_usage_daily(usage_date,channel,provider,${counter}) VALUES($1,'sms',$2,$3)
      ON CONFLICT(usage_date,channel,provider) DO UPDATE SET ${counter}=auth_verification_usage_daily.${counter}+EXCLUDED.${counter},
      updated_at=CURRENT_TIMESTAMP`, [date, provider, amount]);
  }
  private eventWhere(filters: EventFilters) {
    const conditions = ["e.channel='sms'"]; const params: Array<string | number> = [];
    const add = (condition: string, value: string | number) => { params.push(value); conditions.push(condition.replace("?", `$${params.length}`)); };
    if (filters.userId !== undefined) add("u.id=?", filters.userId);
    if (filters.username) add("u.username ILIKE ?", `%${filters.username}%`);
    if (filters.subjectHmac) add("s.subject_hmac=?", filters.subjectHmac);
    if (filters.ip) add("e.source_ip=?", filters.ip);
    if (filters.outcome) add("e.outcome=?", filters.outcome);
    if (filters.providerId) { params.push(filters.providerId, filters.providerId, filters.providerId);
      conditions.push(`(e.biz_id=$${params.length - 2} OR e.out_id=$${params.length - 1} OR e.provider_request_id=$${params.length})`); }
    return { where: `WHERE ${conditions.join(" AND ")}`, params };
  }
  private eventSelect() { return `SELECT e.id,e.subject_id AS "subjectId",e.challenge_id AS "challengeId",e.event_type AS "eventType",
    e.outcome,e.provider_code AS "providerCode",e.provider_message AS "providerMessage",e.provider_request_id AS "providerRequestId",
    e.biz_id AS "bizId",e.out_id AS "outId",e.source_ip AS "sourceIp",e.created_at AS "createdAt",u.id AS "userId",u.username,
    u.is_disabled AS "userDisabled",s.subject_hmac AS "subjectHmac",s.subject_ciphertext AS "subjectCiphertext",
    s.subject_iv AS "subjectIv",s.subject_auth_tag AS "subjectAuthTag" FROM auth_verification_events e
    JOIN auth_verification_subjects s ON s.id=e.subject_id LEFT JOIN users u ON u.id=s.user_id`; }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const value = await operation(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
