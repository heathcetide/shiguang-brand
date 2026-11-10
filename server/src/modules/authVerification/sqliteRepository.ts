import type Database from "better-sqlite3";
import type { AuthVerificationRepository } from "./repository.js";
import type {
  ChallengeCreate, DeliveryReport, EventFilters, RegistrationResult, UsageCounter,
  VerificationChallenge, VerificationEventInput, VerificationSubject,
  ReauthUser, ReauthGrantInput, PhoneBindingUser, PhoneBindingInput, PhoneBindingResult,
  PhoneReplacementInput, PhoneReplacementResult,
} from "./types.js";

const totalsSql = `SELECT COALESCE(SUM(send_requests),0) AS sendRequests, COALESCE(SUM(send_api_calls),0) AS sendApiCalls,
  COALESCE(SUM(accepted),0) AS accepted, COALESCE(SUM(delivered),0) AS delivered,
  COALESCE(SUM(delivery_failed),0) AS deliveryFailed, COALESCE(SUM(verify_api_calls),0) AS verifyApiCalls,
  COALESCE(SUM(verify_passed),0) AS verifyPassed, COALESCE(SUM(verify_failed),0) AS verifyFailed,
  COALESCE(SUM(local_rate_limited),0) AS rateLimited, COALESCE(SUM(provider_errors),0) AS providerErrors,
  COALESCE(SUM(delivery_units),0) AS deliveryUnits FROM auth_verification_usage_daily
  WHERE channel='sms' AND provider=? AND usage_date>=?`;

export class SqliteAuthVerificationRepository implements AuthVerificationRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async phoneBindingUser(userId: number) {
    return this.database.prepare("SELECT id,email,phone,password_hash,phone_verified_at,session_version,is_disabled,role FROM users WHERE id=?").get(userId) as PhoneBindingUser | undefined ?? null;
  }

  async bindPhone(input: PhoneBindingInput): Promise<PhoneBindingResult> {
    // A thrown error must escape the transaction so no partial user/subject mutation survives.
    try {
      return this.database.transaction(() => {
        const valid = this.database.prepare(`SELECT c.subject_id,s.provider FROM users u
          JOIN auth_verification_challenges c ON c.reauth_user_id=u.id
          JOIN auth_verification_subjects s ON s.id=c.subject_id
          WHERE u.id=? AND u.phone IS NULL AND u.email IS NOT NULL AND u.password_hash IS NOT NULL
          AND u.role='user' AND COALESCE(u.is_disabled,0)=0 AND u.session_version=?
          AND c.id=? AND c.purpose='phone_bind' AND c.reauth_session_version=u.session_version
          AND c.status='verifying' AND c.consumed_at IS NULL AND julianday(c.expires_at)>julianday('now')
          AND s.subject_hmac=? AND s.channel='sms' AND s.user_id IS NULL`)
          .get(input.userId,input.sessionVersion,input.challengeId,input.subjectHmac) as { subject_id: number; provider: string } | undefined;
        if (!valid) return "invalid";
        if (this.database.prepare("SELECT 1 FROM users WHERE phone=?").get(input.phone)) return "phone_exists";
        this.database.prepare("UPDATE users SET phone=?,phone_verified_at=CURRENT_TIMESTAMP WHERE id=?").run(input.phone,input.userId);
        this.database.prepare("UPDATE auth_verification_subjects SET user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.userId,valid.subject_id);
        this.database.prepare("UPDATE auth_verification_challenges SET status='consumed',verified_at=CURRENT_TIMESTAMP,consumed_at=CURRENT_TIMESTAMP WHERE id=?").run(input.challengeId);
        this.insertEvent(valid.provider, { subjectId: valid.subject_id, challengeId: input.challengeId, eventType: "phone_bind", outcome: "succeeded" });
        return "bound";
      }).immediate();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.phone")) return "phone_exists";
      throw error;
    }
  }

  async replacePhone(input: PhoneReplacementInput): Promise<PhoneReplacementResult> {
    try {
      return this.database.transaction(() => {
        const valid = this.database.prepare(`SELECT c.subject_id,s.provider,s.user_id AS subject_user_id,u.phone AS old_phone FROM users u
          JOIN auth_verification_challenges c ON c.reauth_user_id=u.id
          JOIN auth_verification_subjects s ON s.id=c.subject_id
          WHERE u.id=? AND u.phone IS NOT NULL AND u.phone_verified_at IS NOT NULL
          AND u.role='user' AND COALESCE(u.is_disabled,0)=0 AND u.session_version=?
          AND c.id=? AND c.purpose='phone_replace' AND c.reauth_session_version=u.session_version
          AND c.status='verifying' AND c.consumed_at IS NULL AND julianday(c.expires_at)>julianday('now')
          AND s.subject_hmac=? AND s.channel='sms'`)
          .get(input.userId,input.sessionVersion,input.challengeId,input.subjectHmac) as { subject_id: number; provider: string; subject_user_id: number | null; old_phone: string } | undefined;
        if (!valid) return "invalid";
        if (valid.old_phone === input.phone) return "invalid";
        if (valid.subject_user_id !== null || this.database.prepare("SELECT 1 FROM users WHERE phone=?").get(input.phone)) return "phone_exists";
        this.database.prepare("UPDATE users SET phone=?,phone_verified_at=CURRENT_TIMESTAMP WHERE id=?").run(input.phone,input.userId);
        this.database.prepare("UPDATE auth_verification_subjects SET user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND channel='sms' AND id!=?").run(input.userId,valid.subject_id);
        this.database.prepare("UPDATE auth_verification_subjects SET user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.userId,valid.subject_id);
        this.database.prepare("UPDATE auth_verification_challenges SET status='consumed',verified_at=CURRENT_TIMESTAMP,consumed_at=CURRENT_TIMESTAMP WHERE id=?").run(input.challengeId);
        this.database.prepare("UPDATE account_reauth_grants SET consumed_at=CURRENT_TIMESTAMP WHERE user_id=? AND consumed_at IS NULL").run(input.userId);
        this.insertEvent(valid.provider, { subjectId: valid.subject_id, challengeId: input.challengeId, eventType: "phone_replace", outcome: "succeeded" });
        return "replaced";
      }).immediate();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.phone")) return "phone_exists";
      throw error;
    }
  }

  async settings(keys: string[]) {
    if (!keys.length) return {};
    const rows = this.database.prepare(`SELECT key,value FROM system_settings WHERE key IN (${keys.map(() => "?").join(",")})`)
      .all(...keys) as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async saveSettings(entries: Array<{ key: string; value: string }>) {
    const statement = this.database.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`);
    this.database.transaction(() => entries.forEach(({ key, value }) => statement.run(key, value)))();
  }

  async findOrCreateSubject(input: Omit<VerificationSubject, "id" | "user_id"> & { provider: string }) {
    this.database.prepare(`INSERT INTO auth_verification_subjects(channel,provider,subject_hmac,subject_ciphertext,subject_iv,subject_auth_tag)
      VALUES('sms',?,?,?,?,?) ON CONFLICT(channel,provider,subject_hmac) DO UPDATE SET
      last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .run(input.provider, input.subject_hmac, input.subject_ciphertext, input.subject_iv, input.subject_auth_tag);
    return this.database.prepare(`SELECT id,user_id,subject_hmac,subject_ciphertext,subject_iv,subject_auth_tag
      FROM auth_verification_subjects WHERE channel='sms' AND provider=? AND subject_hmac=?`)
      .get(input.provider, input.subject_hmac) as VerificationSubject;
  }

  async recordEvent(provider: string, input: VerificationEventInput) { this.insertEvent(provider, input); }

  async incrementUsage(usageDate: string, provider: string, counter: UsageCounter, amount: number) {
    this.increment(usageDate, provider, counter, amount);
  }

  async countSubjectSends(subjectId: number, since: string) {
    return Number((this.database.prepare(`SELECT COUNT(*) AS count FROM auth_verification_events
      WHERE subject_id=? AND event_type='send_api_called' AND created_at>=datetime(?)`).get(subjectId, since) as { count: number }).count);
  }
  async countIpSends(ip: string, since: string) {
    return Number((this.database.prepare(`SELECT COUNT(*) AS count FROM auth_verification_events
      WHERE source_ip=? AND event_type='send_api_called' AND created_at>=datetime(?)`).get(ip, since) as { count: number }).count);
  }
  async globalDailySends(usageDate: string, provider: string) {
    return Number((this.database.prepare(`SELECT COALESCE(send_api_calls,0) AS count FROM auth_verification_usage_daily
      WHERE usage_date=? AND channel='sms' AND provider=?`).get(usageDate, provider) as { count: number } | undefined)?.count || 0);
  }

  async createChallenge(input: ChallengeCreate) {
    this.database.prepare(`INSERT INTO auth_verification_challenges(id,subject_id,purpose,out_id,status,expires_at,source_ip,user_agent,reauth_user_id,reauth_session_version)
      VALUES(?,?,?,?,'pending',?,?,?,?,?)`).run(input.id, input.subjectId, input.purpose, input.outId,
      input.expiresAt, input.sourceIp, input.userAgent,input.reauthUserId ?? null,input.reauthSessionVersion ?? null);
  }
  async failChallenge(challengeId: string) { this.status(challengeId, "failed"); }
  async acceptChallenge(challengeId: string, subjectId: number, bizId: string | null, requestId: string | null) {
    this.database.transaction(() => {
      this.database.prepare(`UPDATE auth_verification_challenges SET status='superseded',updated_at=CURRENT_TIMESTAMP
        WHERE subject_id=? AND id!=? AND purpose=(SELECT purpose FROM auth_verification_challenges WHERE id=?) AND status IN('pending','accepted')`).run(subjectId, challengeId, challengeId);
      this.database.prepare(`UPDATE auth_verification_challenges SET status='accepted',biz_id=?,provider_request_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?`).run(bizId, requestId, challengeId);
    })();
  }
  async challenge(challengeId: string) { return this.challengeBy("c.id=?", challengeId); }
  async expireChallenge(challengeId: string) { this.status(challengeId, "expired"); }
  async beginVerification(challengeId: string) {
    return this.database.prepare(`UPDATE auth_verification_challenges SET attempt_count=attempt_count+1,status='verifying',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND attempt_count<5 AND status IN('pending','accepted')`).run(challengeId).changes === 1;
  }
  async restoreVerification(challengeId: string) {
    this.database.prepare(`UPDATE auth_verification_challenges SET attempt_count=MAX(0,attempt_count-1),status='accepted',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='verifying'`).run(challengeId);
  }
  async rejectVerification(challengeId: string) {
    this.database.prepare(`UPDATE auth_verification_challenges SET status=CASE WHEN attempt_count>=5 THEN 'failed' ELSE 'accepted' END,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='verifying'`).run(challengeId);
  }
  async userByPhone(phone: string) {
    return (this.database.prepare("SELECT id,is_disabled FROM users WHERE phone=?").get(phone) as { id: number; is_disabled: number } | undefined) || null;
  }
  async completeLogin(input: { userId: number; subjectId: number; challengeId: string; at: string; sourceIp: string }) {
    this.database.transaction(() => {
      this.database.prepare("UPDATE auth_verification_subjects SET user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.userId, input.subjectId);
      this.database.prepare(`UPDATE users SET phone_verified_at=COALESCE(phone_verified_at,?),last_login_at=?,last_login_ip=? WHERE id=?`)
        .run(input.at, input.at, input.sourceIp, input.userId);
      this.database.prepare(`UPDATE auth_verification_challenges SET status='consumed',verified_at=?,consumed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(input.at, input.at, input.challengeId);
    })();
  }
  async markRegistrationRequired(input: { challengeId: string; at: string; tokenHash: string; expiresAt: string }) {
    this.database.prepare(`UPDATE auth_verification_challenges SET status='verified',verified_at=?,registration_token_hash=?,
      registration_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(input.at, input.tokenHash, input.expiresAt, input.challengeId);
  }
  async registrationChallenge(tokenHash: string) {
    return this.challengeBy(`c.registration_token_hash=? AND c.status='verified' AND c.consumed_at IS NULL
      AND datetime(c.registration_expires_at)>datetime('now')`, tokenHash);
  }
  async register(input: { tokenHash: string; phone: string; username: string; passwordHash: string | null; at: string }): Promise<RegistrationResult> {
    return this.database.transaction(() => {
      const challenge = this.database.prepare(`SELECT c.id,c.subject_id FROM auth_verification_challenges c
        WHERE c.registration_token_hash=? AND c.status='verified' AND c.consumed_at IS NULL
        AND datetime(c.registration_expires_at)>datetime('now')`).get(input.tokenHash) as { id: string; subject_id: number } | undefined;
      if (!challenge) return { status: "invalid_token" } as const;
      if (this.database.prepare("SELECT 1 FROM users WHERE phone=?").get(input.phone)) return { status: "phone_exists" } as const;
      if (this.database.prepare("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)").get(input.username)) return { status: "username_exists" } as const;
      try {
        const result = this.database.prepare(`INSERT INTO users(username,email,phone,password_hash,avatar_url,phone_verified_at,daily_calories_target)
          VALUES(?,NULL,?,?,NULL,?,NULL)`).run(input.username, input.phone, input.passwordHash, input.at);
        const userId = Number(result.lastInsertRowid);
        this.database.prepare("INSERT OR IGNORE INTO user_health_profiles(user_id) VALUES(?)").run(userId);
        this.database.prepare("UPDATE auth_verification_subjects SET user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(userId, challenge.subject_id);
        this.database.prepare(`UPDATE auth_verification_challenges SET status='consumed',consumed_at=?,registration_token_hash=NULL,
          updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(input.at, challenge.id);
        return { status: "created", userId } as const;
      } catch (error) {
        const message = String(error);
        if (message.includes("users.phone")) return { status: "phone_exists" } as const;
        if (message.includes("users.username")) return { status: "username_exists" } as const;
        throw error;
      }
    })();
  }
  async userResponse(userId: number) {
    return (this.database.prepare(`SELECT id,username,email,phone,avatar_url,bio,role,daily_calories_target,created_at,
      phone_verified_at,last_login_at,last_login_ip,password_hash IS NOT NULL AS hasPassword FROM users WHERE id=?`).get(userId) as Record<string, unknown> | undefined) || null;
  }

  async reauthUser(userId: number) { return (this.database.prepare("SELECT id,phone,phone_verified_at,session_version,is_disabled,role FROM users WHERE id=?").get(userId) as ReauthUser | undefined) || null; }
  async issueReauthGrant(input: ReauthGrantInput) { return this.database.transaction(() => {
    const valid = this.database.prepare(`SELECT 1 FROM users u JOIN auth_verification_challenges c ON c.reauth_user_id=u.id
      WHERE u.id=? AND u.phone=? AND u.phone_verified_at IS NOT NULL AND u.session_version=? AND COALESCE(u.is_disabled,0)=0
      AND c.id=? AND c.purpose=? AND c.reauth_session_version=u.session_version AND c.status='verifying' AND datetime(c.expires_at)>datetime('now')`)
      .get(input.userId,input.phone,input.sessionVersion,input.challengeId,input.challengePurpose ?? input.purpose);
    if (!valid) return false;
    this.database.prepare(`INSERT INTO account_reauth_grants(token_hash,user_id,purpose,phone,session_version,expires_at) VALUES(?,?,?,?,?,?)`)
      .run(input.tokenHash,input.userId,input.purpose,input.phone,input.sessionVersion,input.expiresAt);
    this.database.prepare("UPDATE auth_verification_challenges SET status='consumed',consumed_at=CURRENT_TIMESTAMP,verified_at=CURRENT_TIMESTAMP WHERE id=?").run(input.challengeId);
    return true;
  })(); }

  async recentSendEvent() {
    return (this.database.prepare(`SELECT event_type AS eventType,outcome,provider_code AS providerCode,created_at AS createdAt
      FROM auth_verification_events WHERE channel='sms' AND event_type IN('send_accepted','send_rejected','send_failed')
      ORDER BY id DESC LIMIT 1`).get() as Record<string, unknown> | undefined) || null;
  }
  async usageOverview(provider: string, firstUsageDate: string) {
    const totals = this.database.prepare(totalsSql).get(provider, firstUsageDate) as Record<string, number>;
    const daily = this.database.prepare(`SELECT usage_date AS date,send_api_calls AS sendApiCalls,accepted,delivered,
      delivery_failed AS deliveryFailed,verify_passed AS verifyPassed,verify_failed AS verifyFailed,
      local_rate_limited AS rateLimited,provider_errors AS providerErrors,delivery_units AS deliveryUnits
      FROM auth_verification_usage_daily WHERE channel='sms' AND provider=? AND usage_date>=? ORDER BY usage_date ASC`)
      .all(provider, firstUsageDate) as Array<Record<string, unknown>>;
    return { totals, daily };
  }
  async usedSince(provider: string, baselineAt: string | null) {
    return Number((this.database.prepare(`SELECT COALESCE(SUM(delivery_units),0) AS count FROM auth_verification_usage_daily
      WHERE channel='sms' AND provider=? AND (? IS NULL OR usage_date>=date(?))`).get(provider, baselineAt, baselineAt) as { count: number }).count);
  }
  async attacks(since: string) {
    return this.database.prepare(`SELECT source_ip AS ip,COUNT(*) AS blocked FROM auth_verification_events
      WHERE event_type='send_rate_limited' AND created_at>=datetime(?) GROUP BY source_ip ORDER BY blocked DESC LIMIT 10`)
      .all(since) as Array<Record<string, unknown>>;
  }
  async events(filters: EventFilters, page: number, pageSize: number) {
    const { where, params } = this.eventWhere(filters);
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM auth_verification_events e
      JOIN auth_verification_subjects s ON s.id=e.subject_id LEFT JOIN users u ON u.id=s.user_id ${where}`)
      .get(...params) as { count: number }).count);
    const rows = this.database.prepare(`${this.eventSelect()} ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
    return { rows, total };
  }
  async eventSubject(eventId: number) {
    return (this.database.prepare(`SELECT e.id,s.id AS subjectId,s.user_id AS userId,s.subject_hmac AS subjectHmac,
      s.subject_ciphertext AS subjectCiphertext,s.subject_iv AS subjectIv,s.subject_auth_tag AS subjectAuthTag
      FROM auth_verification_events e JOIN auth_verification_subjects s ON s.id=e.subject_id WHERE e.id=?`)
      .get(eventId) as Record<string, unknown> | undefined) || null;
  }
  async updateTestChallenge(challengeId: string, status: string, bizId: string | null, requestId: string | null) {
    this.database.prepare(`UPDATE auth_verification_challenges SET status=?,biz_id=?,provider_request_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, bizId, requestId, challengeId);
  }
  async recordDeliveryReport(provider: string, report: DeliveryReport) {
    return this.database.transaction(() => {
      const challenge = this.database.prepare(`SELECT id,subject_id AS subjectId,biz_id AS bizId,out_id AS outId
        FROM auth_verification_challenges WHERE (?!='' AND biz_id=?) OR (?!='' AND out_id=?) ORDER BY created_at DESC LIMIT 1`)
        .get(report.bizId, report.bizId, report.outId, report.outId) as { id: string; subjectId: number; bizId: string | null; outId: string } | undefined;
      if (!challenge) return false;
      const outcome = report.success ? "delivered" : "failed";
      if (this.database.prepare(`SELECT 1 FROM auth_verification_events WHERE challenge_id=? AND event_type='delivery_report'
        AND outcome=? AND COALESCE(provider_code,'')=? LIMIT 1`).get(challenge.id, outcome, report.providerCode)) return false;
      this.insertEvent(provider, { subjectId: challenge.subjectId, challengeId: challenge.id, eventType: "delivery_report", outcome,
        providerCode: report.providerCode, providerMessage: report.providerMessage, bizId: challenge.bizId || report.bizId || null,
        outId: challenge.outId || report.outId || null, details: report.details });
      this.increment(report.usageDate, provider, report.success ? "delivered" : "delivery_failed", 1);
      if (report.success) this.increment(report.usageDate, provider, "delivery_units", report.units);
      return true;
    })();
  }

  private status(id: string, status: string) {
    this.database.prepare("UPDATE auth_verification_challenges SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, id);
  }
  private challengeBy(condition: string, parameter: string) {
    return (this.database.prepare(`SELECT c.*,s.user_id,s.subject_hmac,s.subject_ciphertext,s.subject_iv,s.subject_auth_tag
      FROM auth_verification_challenges c JOIN auth_verification_subjects s ON s.id=c.subject_id WHERE ${condition}`)
      .get(parameter) as VerificationChallenge | undefined) || null;
  }
  private insertEvent(provider: string, input: VerificationEventInput) {
    this.database.prepare(`INSERT INTO auth_verification_events(subject_id,challenge_id,channel,provider,event_type,outcome,
      provider_code,provider_message,provider_request_id,biz_id,out_id,source_ip,user_agent,details_json)
      VALUES(?,?,'sms',?,?,?,?,?,?,?,?,?,?,?)`).run(input.subjectId, input.challengeId || null, provider,
      input.eventType, input.outcome, input.providerCode || null, input.providerMessage || null, input.providerRequestId || null,
      input.bizId || null, input.outId || null, input.sourceIp || null, input.userAgent || null,
      input.details ? JSON.stringify(input.details) : null);
  }
  private increment(date: string, provider: string, counter: UsageCounter, amount: number) {
    this.database.prepare(`INSERT INTO auth_verification_usage_daily(usage_date,channel,provider,${counter}) VALUES(?,'sms',?,?)
      ON CONFLICT(usage_date,channel,provider) DO UPDATE SET ${counter}=${counter}+excluded.${counter},updated_at=CURRENT_TIMESTAMP`)
      .run(date, provider, amount);
  }
  private eventWhere(filters: EventFilters) {
    const conditions = ["e.channel='sms'"]; const params: Array<string | number> = [];
    if (filters.userId !== undefined) { conditions.push("u.id=?"); params.push(filters.userId); }
    if (filters.username) { conditions.push("u.username LIKE ?"); params.push(`%${filters.username}%`); }
    if (filters.subjectHmac) { conditions.push("s.subject_hmac=?"); params.push(filters.subjectHmac); }
    if (filters.ip) { conditions.push("e.source_ip=?"); params.push(filters.ip); }
    if (filters.outcome) { conditions.push("e.outcome=?"); params.push(filters.outcome); }
    if (filters.providerId) { conditions.push("(e.biz_id=? OR e.out_id=? OR e.provider_request_id=?)"); params.push(filters.providerId, filters.providerId, filters.providerId); }
    return { where: `WHERE ${conditions.join(" AND ")}`, params };
  }
  private eventSelect() { return `SELECT e.id,e.subject_id AS subjectId,e.challenge_id AS challengeId,e.event_type AS eventType,
    e.outcome,e.provider_code AS providerCode,e.provider_message AS providerMessage,e.provider_request_id AS providerRequestId,
    e.biz_id AS bizId,e.out_id AS outId,e.source_ip AS sourceIp,e.created_at AS createdAt,u.id AS userId,u.username,
    u.is_disabled AS userDisabled,s.subject_hmac AS subjectHmac,s.subject_ciphertext AS subjectCiphertext,
    s.subject_iv AS subjectIv,s.subject_auth_tag AS subjectAuthTag FROM auth_verification_events e
    JOIN auth_verification_subjects s ON s.id=e.subject_id LEFT JOIN users u ON u.id=s.user_id`; }
}
