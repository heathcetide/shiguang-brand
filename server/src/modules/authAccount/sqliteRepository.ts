import type { EmailChallenge, EmailUser, EmailVerificationRepository } from "./emailVerification.js";
import { createHmac } from "node:crypto";
import type Database from "better-sqlite3";
import { JWT_SECRET } from "../../config/security.js";
import { consumeAccountProofSqlite, type AccountMutationProof } from "./reauthProof.js";
import { syncLegacyCaloriesSqlite } from "../health/calorieCompatibility.js";
import type { AuthAccountRepository } from "./repository.js";
import type {
  AccountDeletionResult, AdminAudit, AiDataDeletion, AiDataExport, LoginIdentifier, LoginUser, ProfileInput,
  ProfileResult, RegistrationInput, RegistrationResult, Row,
} from "./types.js";

function parseUrlList(value: unknown) {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

export class SqliteAuthAccountRepository implements AuthAccountRepository, EmailVerificationRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async emailUser(selector: { id: number } | { email: string }) {
    return (this.database.prepare(`SELECT id,email,email_verified_at,password_hash,session_version,is_disabled FROM users
      WHERE ${"id" in selector ? "id=?" : "email=?"}`).get("id" in selector ? selector.id : selector.email) as EmailUser | undefined) ?? null;
  }
  async createEmailChallenge(input: EmailChallenge) {
    this.database.prepare(`INSERT INTO email_auth_challenges(id,user_id,email,purpose,session_version,code_hash,expires_at)
      VALUES(?,?,?,?,?,?,?)`).run(input.id,input.userId,input.email,input.purpose,input.sessionVersion,input.codeHash,input.expiresAt);
  }
  async finishEmailDelivery(id: string, sent: boolean) {
    this.database.prepare("UPDATE email_auth_challenges SET status=? WHERE id=? AND status='pending'").run(sent ? "sent" : "failed",id);
  }
  async verifyEmailChallenge(input: Parameters<EmailVerificationRepository["verifyEmailChallenge"]>[0]) {
    return this.database.transaction(() => {
      const challenge = this.database.prepare(`UPDATE email_auth_challenges SET attempts=attempts+1
        WHERE id=? AND purpose=? AND status='sent' AND attempts<5 AND julianday(expires_at)>julianday('now')
        AND (? IS NULL OR user_id=?) RETURNING *`).get(input.id,input.purpose,input.userId ?? null,input.userId ?? null) as
        { user_id: number | null; email: string; session_version: number; code_hash: string } | undefined;
      if (!challenge || challenge.code_hash !== input.codeHash || challenge.user_id === null) return null;
      const user = this.database.prepare(`SELECT id FROM users WHERE id=? AND email=? AND session_version=? AND COALESCE(is_disabled,0)=0
        ${input.purpose === "email_recovery" ? "AND email_verified_at IS NOT NULL" : "AND password_hash IS NOT NULL"}`)
        .get(challenge.user_id,challenge.email,challenge.session_version);
      if (!user) return null;
      if (input.purpose === "email_verify") this.database.prepare("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?").run(challenge.user_id);
      this.database.prepare(`UPDATE email_auth_challenges SET status=?,recovery_hash=?,recovery_expires_at=? WHERE id=?`)
        .run(input.purpose === "email_verify" ? "consumed" : "verified",input.purpose === "email_recovery" ? input.recoveryHash : null,
          input.purpose === "email_recovery" ? input.recoveryExpiresAt : null,input.id);
      return challenge.user_id;
    })();
  }

  async createUser(input: RegistrationInput): Promise<RegistrationResult> {
    return this.database.transaction(() => {
      if (this.database.prepare("SELECT 1 FROM users WHERE email=? OR phone=?").get(input.email, input.phone)) return { status: "identifier_exists" as const };
      if (this.database.prepare("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)").get(input.username)) return { status: "username_exists" as const };
      try {
        const inserted = this.database.prepare(`INSERT INTO users (username,email,phone,password_hash,avatar_url,daily_calories_target) VALUES (?,?,?,?,NULL,NULL)`)
          .run(input.username, input.email, input.phone, input.passwordHash);
        const userId = Number(inserted.lastInsertRowid); this.ensureInitialState(userId);
        const created = this.database.prepare(`SELECT id,username,email,phone,avatar_url,bio,daily_calories_target,session_version,password_hash IS NOT NULL AS hasPassword FROM users WHERE id=?`).get(userId) as Row;
        const { session_version: storedSessionVersion, ...user } = created;
        const sessionVersion = Number(storedSessionVersion || 1);
        return { status: "created" as const, user, sessionVersion };
      } catch (error) {
        if (String(error).includes("users.username")) return { status: "username_exists" as const };
        if (String(error).includes("users.email") || String(error).includes("users.phone")) return { status: "identifier_exists" as const };
        throw error;
      }
    })();
  }

  async findLoginUser(identifier: LoginIdentifier | null, adminUsername: string | null) {
    const select = `SELECT id,username,email,phone,password_hash,avatar_url,bio,role,must_change_password,
      session_version,daily_calories_target,created_at,is_disabled,is_verified_expert,last_login_at,last_login_ip FROM users`;
    const row = adminUsername
      ? this.database.prepare(`${select} WHERE username=? AND role='admin'`).get(adminUsername)
      : this.database.prepare(`${select} WHERE email=? OR phone=?`).get(identifier?.email, identifier?.phone);
    return (row as LoginUser | undefined) || null;
  }

  async recordSuccessfulLogin(userId: number, at: string, ipAddress: string, credentials: { passwordHash: string; sessionVersion: number }) {
    return this.database.transaction(() => {
      const updated = this.database.prepare("UPDATE users SET last_login_at=?,last_login_ip=? WHERE id=? AND password_hash=? AND session_version=? AND COALESCE(is_disabled,0)=0 RETURNING session_version")
        .get(at, ipAddress, userId, credentials.passwordHash, credentials.sessionVersion) as Row | undefined;
      if (!updated) return null;
      this.ensureInitialState(userId);
      return Number(updated.session_version || 1);
    })();
  }

  async recordFunnelEvent(userId: number, eventName: "account_registered" | "login_succeeded") {
    try { this.database.prepare("INSERT INTO funnel_events (event_name,actor_hash) VALUES (?,?)")
      .run(eventName, this.actorHash(userId)); }
    catch (error) { console.warn("[Funnel Event Error]", error instanceof Error ? error.message : String(error)); }
  }

  async recordAdminAudit(audit: AdminAudit) {
    try { this.database.prepare(`INSERT INTO admin_audit_logs
      (admin_user_id,action,resource_type,resource_id,summary,ip_address,user_agent) VALUES (?,?,?,?,?,?,?)`)
      .run(audit.adminUserId,audit.action,audit.resourceType,String(audit.resourceId),audit.summary,audit.ipAddress || null,audit.userAgent || null); }
    catch (error) { console.warn("[Admin Audit Error]", error instanceof Error ? error.message : String(error)); }
  }

  async getMe(userId: number) { return (this.database.prepare(`SELECT id,username,email,phone,phone_verified_at,email_verified_at,avatar_url,bio,
    daily_calories_target,created_at,role,must_change_password,last_login_at,last_login_ip,password_hash IS NOT NULL AS hasPassword FROM users WHERE id=?`).get(userId) as Row | undefined) || null; }

  async getCredentials(userId: number) { return (this.database.prepare("SELECT username,role,password_hash FROM users WHERE id=?")
    .get(userId) as { username: string; role: string; password_hash: string | null } | undefined) || null; }

  async changePassword(userId: number, passwordHash: string, proof?: AccountMutationProof) { return this.database.transaction(() => {
    if (proof) consumeAccountProofSqlite(this.database,userId,"password_update",proof);
    return this.database.prepare(`UPDATE users SET password_hash=?,
      must_change_password=0,session_version=session_version+1 WHERE id=?`).run(passwordHash,userId).changes === 1;
  })(); }

  async updateProfile(userId: number, input: ProfileInput): Promise<ProfileResult> {
    return this.database.transaction(() => {
      if (input.username && this.database.prepare("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?) AND id<>?").get(input.username,userId)) {
        return { status: "username_exists" as const };
      }
      try { this.database.prepare(`UPDATE users SET username=COALESCE(?,username),avatar_url=COALESCE(?,avatar_url),
        bio=COALESCE(?,bio),daily_calories_target=COALESCE(?,daily_calories_target) WHERE id=?`)
        .run(input.username,input.avatar_url,input.bio,input.daily_calories_target,userId); }
      catch (error) { if (String(error).includes("users.username")) return { status: "username_exists" as const }; throw error; }
      if (typeof input.daily_calories_target === "number") syncLegacyCaloriesSqlite(this.database,userId,input.daily_calories_target);
      const user = this.database.prepare("SELECT id,username,email,phone,phone_verified_at,email_verified_at,avatar_url,bio,daily_calories_target,role,password_hash IS NOT NULL AS hasPassword FROM users WHERE id=?").get(userId) as Row;
      return { status: "updated" as const, user };
    })();
  }

  async exportAiData(userId: number): Promise<AiDataExport> {
    const all = (sql: string) => this.database.prepare(sql).all(userId) as Row[];
    const checkpointTable = Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkpoints'").get());
    return {
      messages: all(`SELECT session_id,role,content,source,status,response_time_ms,payload_json,created_at
        FROM ai_chat_messages WHERE user_id=? ORDER BY created_at ASC,id ASC`),
      scan_jobs: all("SELECT id,status,result_json,error_message,created_at,updated_at FROM inventory_scan_jobs WHERE user_id=? ORDER BY created_at ASC"),
      agent_runs: all("SELECT * FROM agent_runs WHERE user_id=? ORDER BY created_at ASC"),
      agent_events: all(`SELECT e.* FROM agent_run_events e JOIN agent_runs r ON r.id=e.run_id WHERE r.user_id=? ORDER BY e.created_at ASC,e.sequence ASC`),
      agent_actions: all(`SELECT a.* FROM agent_actions a JOIN agent_runs r ON r.id=a.run_id WHERE r.user_id=? ORDER BY a.created_at ASC`),
      agent_media_references: all("SELECT id,run_id,kind,mime_type,created_at FROM agent_run_media WHERE user_id=? ORDER BY created_at ASC"),
      agent_checkpoints: checkpointTable ? all(`SELECT c.thread_id,c.checkpoint_ns,c.checkpoint_id,c.parent_checkpoint_id,c.type,
        CAST(c.checkpoint AS TEXT) AS checkpoint_json,CAST(c.metadata AS TEXT) AS metadata_json FROM checkpoints c
        JOIN agent_runs r ON r.checkpoint_thread_id=c.thread_id WHERE r.user_id=? ORDER BY c.checkpoint_id ASC`) : [],
      // SQLiteSaver stores channel values inside checkpoint_json instead of a separate blob table.
      agent_checkpoint_blobs: [],
      agent_checkpoint_writes: checkpointTable ? all(`SELECT w.thread_id,w.checkpoint_ns,w.checkpoint_id,w.task_id,w.idx,w.channel,w.type,
        CAST(w.value AS TEXT) AS value_json FROM writes w JOIN agent_runs r ON r.checkpoint_thread_id=w.thread_id
        WHERE r.user_id=? ORDER BY w.checkpoint_id ASC,w.idx ASC`) : [],
    };
  }

  async deleteAiData(userId: number): Promise<AiDataDeletion> { return this.database.transaction(() => {
    const remove = (table: string) => this.database.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId).changes;
    const threads = this.database.prepare("SELECT checkpoint_thread_id FROM agent_runs WHERE user_id=?").all(userId) as Array<{ checkpoint_thread_id: string }>;
    const hasCheckpoints = Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkpoints'").get());
    if (hasCheckpoints) for (const thread of threads) {
      this.database.prepare("DELETE FROM writes WHERE thread_id=?").run(thread.checkpoint_thread_id);
      this.database.prepare("DELETE FROM checkpoints WHERE thread_id=?").run(thread.checkpoint_thread_id);
    }
    const deleted = { messages: remove("ai_chat_messages"), scan_jobs: remove("inventory_scan_jobs"), usage_logs: remove("ai_usage_logs"),
      write_confirmations: remove("ai_write_confirmations"), chat_session_deletions: remove("ai_chat_session_deletions"), agent_runs: remove("agent_runs") };
    return deleted;
  })(); }

  async accountMediaUrls(userId: number) {
    const posts = this.database.prepare("SELECT image_url,image_urls FROM community_posts WHERE user_id=?").all(userId) as Row[];
    const comments = this.database.prepare("SELECT image_url FROM community_comments WHERE user_id=?").all(userId) as Row[];
    return [...posts.flatMap((post) => [post.image_url, ...parseUrlList(post.image_urls)]), ...comments.map((comment) => comment.image_url)]
      .filter((url): url is string => typeof url === "string");
  }

  async deleteAccount(userId: number, actorHash: string, urls: string[], objects: unknown[], proof?: AccountMutationProof): Promise<AccountDeletionResult> {
    return this.database.transaction(() => {
      if (!this.database.prepare("SELECT 1 FROM users WHERE id=?").get(userId)) return { deleted: false, cleanupJobId: null };
      if (proof) consumeAccountProofSqlite(this.database,userId,"account_delete",proof);
      this.prepareHouseholds(userId);
      this.database.prepare("DELETE FROM funnel_events WHERE actor_hash=?").run(actorHash);
      let cleanupJobId: number | null = null;
      if (objects.length) cleanupJobId = Number(this.database.prepare(`INSERT INTO media_cleanup_jobs (owner_user_id,urls_json,objects_json)
        VALUES (?,?,?)`).run(userId,JSON.stringify(urls),JSON.stringify(objects)).lastInsertRowid);
      const deleted = this.database.prepare("DELETE FROM users WHERE id=?").run(userId).changes === 1;
      return { deleted, cleanupJobId };
    })();
  }

  private ensureInitialState(userId: number) { this.database.prepare("INSERT OR IGNORE INTO user_health_profiles (user_id) VALUES (?)").run(userId); }
  private actorHash(userId: number) {
    return createHmac("sha256", JWT_SECRET).update(`user:${userId}`).digest("hex");
  }

  private prepareHouseholds(userId: number) {
    const owned = this.database.prepare("SELECT id FROM households WHERE owner_id=? ORDER BY id").all(userId) as Array<{ id: number }>;
    for (const household of owned) {
      const successor = this.database.prepare(`SELECT user_id FROM household_members WHERE household_id=? AND user_id<>?
        ORDER BY joined_at ASC,id ASC LIMIT 1`).get(household.id,userId) as { user_id: number } | undefined;
      if (!successor) { this.database.prepare("DELETE FROM households WHERE id=?").run(household.id); continue; }
      this.database.prepare("UPDATE households SET owner_id=?,version=version+1 WHERE id=?").run(successor.user_id,household.id);
      this.database.prepare("UPDATE household_members SET role=CASE WHEN user_id=? THEN 'owner' ELSE 'member' END WHERE household_id=?")
        .run(successor.user_id,household.id);
    }
    const retained = this.database.prepare(`SELECT hm.household_id,h.owner_id AS replacement_user_id FROM household_members hm
      JOIN households h ON h.id=hm.household_id WHERE hm.user_id=?`).all(userId) as Array<{ household_id: number; replacement_user_id: number }>;
    for (const { household_id: householdId, replacement_user_id: replacement } of retained) {
      this.database.prepare("UPDATE household_inventory_items SET created_by_user_id=? WHERE household_id=? AND created_by_user_id=?").run(replacement,householdId,userId);
      this.database.prepare("UPDATE household_activity_logs SET operator_user_id=? WHERE household_id=? AND operator_user_id=?").run(replacement,householdId,userId);
      this.database.prepare("UPDATE household_shopping_items SET created_by_user_id=? WHERE household_id=? AND created_by_user_id=?").run(replacement,householdId,userId);
      this.database.prepare("UPDATE household_shopping_items SET updated_by_user_id=? WHERE household_id=? AND updated_by_user_id=?").run(replacement,householdId,userId);
      this.database.prepare("UPDATE household_shopping_intake_batches SET user_id=? WHERE household_id=? AND user_id=?").run(replacement,householdId,userId);
      this.database.prepare("UPDATE inventory_outcome_events SET idempotency_key='deleted-account:'||?||':'||id WHERE household_id=? AND created_by_user_id=?")
        .run(userId,householdId,userId);
      this.database.prepare("UPDATE inventory_outcome_events SET created_by_user_id=? WHERE household_id=? AND created_by_user_id=?").run(replacement,householdId,userId);
      this.database.prepare("UPDATE inventory_outcome_events SET updated_by_user_id=? WHERE household_id=? AND updated_by_user_id=?").run(replacement,householdId,userId);
      this.database.prepare("DELETE FROM household_members WHERE household_id=? AND user_id=?").run(householdId,userId);
    }
  }
}
