import type { EmailChallenge, EmailUser, EmailVerificationRepository } from "./emailVerification.js";
import { createHmac } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { JWT_SECRET } from "../../config/security.js";
import { consumeAccountProofPostgres, type AccountMutationProof } from "./reauthProof.js";
import { syncLegacyCaloriesPostgres } from "../health/calorieCompatibility.js";
import type { AuthAccountRepository } from "./repository.js";
import type {
  AccountDeletionResult, AdminAudit, AiDataDeletion, AiDataExport, LoginIdentifier, LoginUser, ProfileInput,
  ProfileResult, RegistrationInput, RegistrationResult, Row,
} from "./types.js";

function parseUrlList(value: unknown) {
  if (!value) return [];
  try { const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}
function rows(result: { rows: QueryResultRow[] }) { return result.rows as Row[]; }
function stringifyJson(data: Row[], keys: string[]) { return data.map((row) => { const copy = { ...row };
  for (const key of keys) if (copy[key] != null && typeof copy[key] !== "string") copy[key] = JSON.stringify(copy[key]); return copy; }); }

export class PostgresAuthAccountRepository implements AuthAccountRepository, EmailVerificationRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async emailUser(selector: { id: number } | { email: string }) {
    return ((await this.pool.query(`SELECT id,email,email_verified_at,password_hash,session_version,is_disabled FROM users
      WHERE ${"id" in selector ? "id=$1" : "email=$1"}`, ["id" in selector ? selector.id : selector.email])).rows[0] as EmailUser | undefined) ?? null;
  }
  async createEmailChallenge(input: EmailChallenge) {
    await this.pool.query(`INSERT INTO email_auth_challenges(id,user_id,email,purpose,session_version,code_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.id,input.userId,input.email,input.purpose,input.sessionVersion,input.codeHash,input.expiresAt]);
  }
  async finishEmailDelivery(id: string, sent: boolean) {
    await this.pool.query("UPDATE email_auth_challenges SET status=$1 WHERE id=$2 AND status='pending'",[sent ? "sent" : "failed",id]);
  }
  async verifyEmailChallenge(input: Parameters<EmailVerificationRepository["verifyEmailChallenge"]>[0]) {
    return this.tx(async client => {
      // Match password-reset lock order: account first, then challenge.
      const candidate = (await client.query("SELECT user_id FROM email_auth_challenges WHERE id=$1",[input.id])).rows[0];
      if (candidate?.user_id) await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[candidate.user_id]);
      const challenge = (await client.query(`UPDATE email_auth_challenges SET attempts=attempts+1
        WHERE id=$1 AND purpose=$2 AND status='sent' AND attempts<5 AND expires_at>CURRENT_TIMESTAMP
        AND ($3::integer IS NULL OR user_id=$3) RETURNING *`,[input.id,input.purpose,input.userId ?? null])).rows[0];
      if (!challenge || challenge.code_hash !== input.codeHash || challenge.user_id === null) return null;
      const user = await client.query(`SELECT id FROM users WHERE id=$1 AND email=$2 AND session_version=$3 AND NOT COALESCE(is_disabled,FALSE)
        ${input.purpose === "email_recovery" ? "AND email_verified_at IS NOT NULL" : "AND password_hash IS NOT NULL"}`,
        [challenge.user_id,challenge.email,challenge.session_version]);
      if (!user.rowCount) return null;
      if (input.purpose === "email_verify") await client.query("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=$1",[challenge.user_id]);
      await client.query("UPDATE email_auth_challenges SET status=$1,recovery_hash=$2,recovery_expires_at=$3 WHERE id=$4",
        [input.purpose === "email_verify" ? "consumed" : "verified",input.purpose === "email_recovery" ? input.recoveryHash : null,
          input.purpose === "email_recovery" ? input.recoveryExpiresAt : null,input.id]);
      return Number(challenge.user_id);
    });
  }

  async createUser(input: RegistrationInput): Promise<RegistrationResult> {
    return this.tx(async (client) => {
      await this.lock(client, `auth:identifier:${input.email || input.phone}`); await this.lock(client, `auth:username:${input.username.toLowerCase()}`);
      if ((await client.query("SELECT 1 FROM users WHERE email=$1 OR phone=$2",[input.email,input.phone])).rowCount) return { status: "identifier_exists" };
      if ((await client.query("SELECT 1 FROM users WHERE LOWER(username)=LOWER($1)",[input.username])).rowCount) return { status: "username_exists" };
      try {
        const inserted = (await client.query(`INSERT INTO users (username,email,phone,password_hash,avatar_url,daily_calories_target) VALUES ($1,$2,$3,$4,NULL,NULL)
          RETURNING id,username,email,phone,avatar_url,bio,daily_calories_target,session_version,password_hash IS NOT NULL AS "hasPassword"`,
        [input.username,input.email,input.phone,input.passwordHash])).rows[0] as Row;
        await this.ensureInitialState(client,Number(inserted.id));
        const { session_version: sessionVersion, ...user } = inserted;
        return { status: "created", user, sessionVersion: Number(sessionVersion || 1) };
      } catch (error) {
        const constraint = pgConstraint(error);
        if (constraint.includes("username")) return { status: "username_exists" };
        if (constraint.includes("email") || constraint.includes("phone")) return { status: "identifier_exists" };
        throw error;
      }
    });
  }

  async findLoginUser(identifier: LoginIdentifier | null, adminUsername: string | null) {
    const select = `SELECT id,username,email,phone,password_hash,avatar_url,bio,role,must_change_password,session_version,
      daily_calories_target,created_at,is_disabled,is_verified_expert,last_login_at,last_login_ip FROM users`;
    const result = adminUsername ? await this.pool.query(`${select} WHERE username=$1 AND role='admin'`,[adminUsername])
      : await this.pool.query(`${select} WHERE email=$1 OR phone=$2`,[identifier?.email,identifier?.phone]);
    return (result.rows[0] as LoginUser | undefined) || null;
  }

  async recordSuccessfulLogin(userId: number, at: string, ipAddress: string, credentials: { passwordHash: string; sessionVersion: number }) { return this.tx(async (client) => {
    const result = await client.query("UPDATE users SET last_login_at=$1,last_login_ip=$2 WHERE id=$3 AND password_hash=$4 AND session_version=$5 AND NOT COALESCE(is_disabled,FALSE) RETURNING session_version",[at,ipAddress,userId,credentials.passwordHash,credentials.sessionVersion]);
    if (!result.rowCount) return null;
    await this.ensureInitialState(client,userId);
    return Number(result.rows[0].session_version || 1);
  }); }

  async recordFunnelEvent(userId: number, eventName: "account_registered" | "login_succeeded") {
    try { const hash = createHmac("sha256",JWT_SECRET).update(`user:${userId}`).digest("hex");
      await this.pool.query("INSERT INTO funnel_events (event_name,actor_hash) VALUES ($1,$2)",[eventName,hash]); }
    catch (error) { console.warn("[Funnel Event Error]",error instanceof Error ? error.message : String(error)); }
  }

  async recordAdminAudit(audit: AdminAudit) {
    try { await this.pool.query(`INSERT INTO admin_audit_logs (admin_user_id,action,resource_type,resource_id,summary,ip_address,user_agent)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,[audit.adminUserId,audit.action,audit.resourceType,String(audit.resourceId),audit.summary,audit.ipAddress || null,audit.userAgent || null]); }
    catch (error) { console.warn("[Admin Audit Error]",error instanceof Error ? error.message : String(error)); }
  }

  async getMe(userId: number) { return ((await this.pool.query(`SELECT id,username,email,phone,phone_verified_at,email_verified_at,avatar_url,bio,
    daily_calories_target,created_at,role,must_change_password,last_login_at,last_login_ip,password_hash IS NOT NULL AS "hasPassword" FROM users WHERE id=$1`,[userId])).rows[0] as Row | undefined) || null; }
  async getCredentials(userId: number) {
    const result = await this.pool.query("SELECT username,role,password_hash FROM users WHERE id=$1",[userId]);
    return (result.rows[0] as { username: string; role: string; password_hash: string | null } | undefined) || null;
  }
  async changePassword(userId: number,passwordHash: string,proof?: AccountMutationProof) { return this.tx(async (client) => {
    if (proof) await consumeAccountProofPostgres(client,userId,"password_update",proof);
    return (await client.query(`UPDATE users SET password_hash=$1,
      must_change_password=FALSE,session_version=session_version+1 WHERE id=$2`,[passwordHash,userId])).rowCount === 1;
  }); }

  async updateProfile(userId: number,input: ProfileInput): Promise<ProfileResult> { return this.tx(async (client) => {
    if (input.username) { await this.lock(client,`auth:username:${input.username.toLowerCase()}`);
      if ((await client.query("SELECT 1 FROM users WHERE LOWER(username)=LOWER($1) AND id<>$2",[input.username,userId])).rowCount) return { status: "username_exists" }; }
    try { const result = await client.query(`UPDATE users SET username=COALESCE($1,username),avatar_url=COALESCE($2,avatar_url),
      bio=COALESCE($3,bio),daily_calories_target=COALESCE($4,daily_calories_target) WHERE id=$5
      RETURNING id,username,email,phone,phone_verified_at,email_verified_at,avatar_url,bio,daily_calories_target,role,password_hash IS NOT NULL AS "hasPassword"`,
    [input.username,input.avatar_url,input.bio,input.daily_calories_target,userId]);
      if (typeof input.daily_calories_target === "number") {
        await syncLegacyCaloriesPostgres(client,userId,input.daily_calories_target);
        result.rows[0].daily_calories_target=(await client.query("SELECT daily_calories_target FROM users WHERE id=$1",[userId])).rows[0].daily_calories_target;
      }
      return { status: "updated",user: result.rows[0] as Row }; }
    catch (error) { if (pgConstraint(error).includes("username")) return { status: "username_exists" }; throw error; }
  }); }

  async exportAiData(userId: number): Promise<AiDataExport> {
    const [messagesResult,scanResult,runsResult,eventsResult,actionsResult,mediaResult,
      checkpointsResult,checkpointBlobsResult,checkpointWritesResult] = await Promise.all([
      this.pool.query(`SELECT session_id,role,content,source,status,response_time_ms,payload_json,created_at
        FROM ai_chat_messages WHERE user_id=$1 ORDER BY created_at ASC,id ASC`,[userId]),
      this.pool.query("SELECT id,status,result_json,error_message,created_at,updated_at FROM inventory_scan_jobs WHERE user_id=$1 ORDER BY created_at ASC",[userId]),
      this.pool.query("SELECT * FROM agent_runs WHERE user_id=$1 ORDER BY created_at ASC",[userId]),
      this.pool.query(`SELECT e.* FROM agent_run_events e JOIN agent_runs r ON r.id=e.run_id WHERE r.user_id=$1 ORDER BY e.created_at ASC,e.sequence ASC`,[userId]),
      this.pool.query(`SELECT a.* FROM agent_actions a JOIN agent_runs r ON r.id=a.run_id WHERE r.user_id=$1 ORDER BY a.created_at ASC`,[userId]),
      this.pool.query("SELECT id,run_id,kind,mime_type,created_at FROM agent_run_media WHERE user_id=$1 ORDER BY created_at ASC",[userId]),
      this.pool.query(`SELECT c.thread_id,c.checkpoint_ns,c.checkpoint_id,c.parent_checkpoint_id,c.type,
        c.checkpoint AS checkpoint_json,c.metadata AS metadata_json FROM checkpoints c
        JOIN agent_runs r ON r.checkpoint_thread_id=c.thread_id WHERE r.user_id=$1
        ORDER BY c.thread_id,c.checkpoint_ns,c.checkpoint_id`,[userId]),
      this.pool.query(`SELECT b.thread_id,b.checkpoint_ns,b.channel,b.version,b.type,
        ENCODE(b.blob,'base64') AS blob_base64 FROM checkpoint_blobs b
        JOIN agent_runs r ON r.checkpoint_thread_id=b.thread_id WHERE r.user_id=$1
        ORDER BY b.thread_id,b.checkpoint_ns,b.channel,b.version`,[userId]),
      this.pool.query(`SELECT w.thread_id,w.checkpoint_ns,w.checkpoint_id,w.task_id,w.idx,w.channel,w.type,
        ENCODE(w.blob,'base64') AS value_base64 FROM checkpoint_writes w
        JOIN agent_runs r ON r.checkpoint_thread_id=w.thread_id WHERE r.user_id=$1
        ORDER BY w.thread_id,w.checkpoint_ns,w.checkpoint_id,w.task_id,w.idx`,[userId]),
    ]);
    return { messages:stringifyJson(rows(messagesResult),["payload_json"]),scan_jobs:stringifyJson(rows(scanResult),["result_json"]),
      agent_runs:stringifyJson(rows(runsResult),["input_json","result_json","pending_approval_json","pending_input_json"]),
      agent_events:stringifyJson(rows(eventsResult),["payload_json"]),agent_actions:stringifyJson(rows(actionsResult),["payload_json","before_json","result_json"]),
      agent_media_references:rows(mediaResult),
      agent_checkpoints:stringifyJson(rows(checkpointsResult),["checkpoint_json","metadata_json"]),
      agent_checkpoint_blobs:rows(checkpointBlobsResult),agent_checkpoint_writes:rows(checkpointWritesResult) };
  }

  async deleteAiData(userId: number): Promise<AiDataDeletion> { return this.tx(async (client) => {
    const remove = async (table: string) => (await client.query(`DELETE FROM ${table} WHERE user_id=$1`,[userId])).rowCount || 0;
    return { messages:await remove("ai_chat_messages"),scan_jobs:await remove("inventory_scan_jobs"),usage_logs:await remove("ai_usage_logs"),
      write_confirmations:await remove("ai_write_confirmations"),chat_session_deletions:await remove("ai_chat_session_deletions"),agent_runs:await remove("agent_runs") };
  }); }

  async accountMediaUrls(userId: number) {
    const [posts,comments] = await Promise.all([this.pool.query("SELECT image_url,image_urls FROM community_posts WHERE user_id=$1",[userId]),
      this.pool.query("SELECT image_url FROM community_comments WHERE user_id=$1",[userId])]);
    return [...posts.rows.flatMap((post) => [post.image_url,...parseUrlList(post.image_urls)]),...comments.rows.map((comment) => comment.image_url)]
      .filter((url): url is string => typeof url === "string");
  }

  async deleteAccount(userId: number,actorHash: string,urls: string[],objects: unknown[],proof?: AccountMutationProof): Promise<AccountDeletionResult> { return this.tx(async (client) => {
    if (!(await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId])).rowCount) return { deleted:false,cleanupJobId:null };
    if (proof) await consumeAccountProofPostgres(client,userId,"account_delete",proof);
    await this.prepareHouseholds(client,userId);
    await client.query("DELETE FROM funnel_events WHERE actor_hash=$1",[actorHash]); let cleanupJobId: number | null = null;
    if (objects.length) cleanupJobId = Number((await client.query(`INSERT INTO media_cleanup_jobs (owner_user_id,urls_json,objects_json)
      VALUES ($1,$2::jsonb,$3::jsonb) RETURNING id`,[userId,JSON.stringify(urls),JSON.stringify(objects)])).rows[0].id);
    const deleted = (await client.query("DELETE FROM users WHERE id=$1",[userId])).rowCount === 1; return { deleted,cleanupJobId };
  }); }

  private ensureInitialState(client: PoolClient,userId: number) { return client.query("INSERT INTO user_health_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",[userId]); }
  private lock(client: PoolClient,key: string) { return client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]); }
  private async prepareHouseholds(client: PoolClient,userId: number) {
    const owned = (await client.query("SELECT id FROM households WHERE owner_id=$1 ORDER BY id FOR UPDATE",[userId])).rows as Array<{ id: number }>;
    for (const household of owned) {
      const successor = (await client.query(`SELECT user_id FROM household_members WHERE household_id=$1 AND user_id<>$2
        ORDER BY joined_at ASC,id ASC LIMIT 1 FOR UPDATE`,[household.id,userId])).rows[0] as { user_id: number } | undefined;
      if (!successor) { await client.query("DELETE FROM households WHERE id=$1",[household.id]); continue; }
      await client.query("UPDATE households SET owner_id=$1,version=version+1 WHERE id=$2",[successor.user_id,household.id]);
      await client.query("UPDATE household_members SET role=CASE WHEN user_id=$1 THEN 'owner' ELSE 'member' END WHERE household_id=$2",[successor.user_id,household.id]);
    }
    const retained = (await client.query(`SELECT hm.household_id,h.owner_id AS replacement_user_id FROM household_members hm
      JOIN households h ON h.id=hm.household_id WHERE hm.user_id=$1 ORDER BY hm.household_id FOR UPDATE OF hm,h`,[userId])).rows as Array<{ household_id:number; replacement_user_id:number }>;
    for (const { household_id:householdId,replacement_user_id:replacement } of retained) {
      await client.query("UPDATE household_inventory_items SET created_by_user_id=$1 WHERE household_id=$2 AND created_by_user_id=$3",[replacement,householdId,userId]);
      await client.query("UPDATE household_activity_logs SET operator_user_id=$1 WHERE household_id=$2 AND operator_user_id=$3",[replacement,householdId,userId]);
      await client.query("UPDATE household_shopping_items SET created_by_user_id=$1 WHERE household_id=$2 AND created_by_user_id=$3",[replacement,householdId,userId]);
      await client.query("UPDATE household_shopping_items SET updated_by_user_id=$1 WHERE household_id=$2 AND updated_by_user_id=$3",[replacement,householdId,userId]);
      await client.query("UPDATE household_shopping_intake_batches SET user_id=$1 WHERE household_id=$2 AND user_id=$3",[replacement,householdId,userId]);
      await client.query("UPDATE inventory_outcome_events SET idempotency_key='deleted-account:'||$1::text||':'||id WHERE household_id=$2 AND created_by_user_id=$1",[userId,householdId]);
      await client.query("UPDATE inventory_outcome_events SET created_by_user_id=$1 WHERE household_id=$2 AND created_by_user_id=$3",[replacement,householdId,userId]);
      await client.query("UPDATE inventory_outcome_events SET updated_by_user_id=$1 WHERE household_id=$2 AND updated_by_user_id=$3",[replacement,householdId,userId]);
      await client.query("DELETE FROM household_members WHERE household_id=$1 AND user_id=$2",[householdId,userId]);
    }
  }
  private async tx<T>(operation:(client:PoolClient)=>Promise<T>) { const client=await this.pool.connect(); try { await client.query("BEGIN");
    const value=await operation(client); await client.query("COMMIT"); return value; } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}

function pgConstraint(error: unknown) { return typeof error === "object" && error !== null && "constraint" in error ? String(error.constraint || "") : ""; }
