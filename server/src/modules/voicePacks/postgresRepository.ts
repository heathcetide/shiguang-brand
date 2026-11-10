import type { Pool, PoolClient } from "pg";
import { voicePackResourceFingerprint } from "./manifest.js";
import type { VoicePacksRepository } from "./repository.js";
import type { VoicePackAudit, VoicePackDraft, VoicePackManifest, VoicePackRow } from "./types.js";
function duplicate(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }
export class PostgresVoicePacksRepository implements VoicePacksRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async ensureEnvironmentCatalog(items: VoicePackManifest[]) {
    if (!items.length) return;
    await this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('voice-pack-environment-catalog'))");
      if (Number((await client.query("SELECT COUNT(*)::integer AS count FROM voice_pack_versions")).rows[0]!.count) > 0) return;
      for (const manifest of items) {
        const status = manifest.revoked ? "revoked" : "published";
        const inserted = await client.query(`INSERT INTO voice_pack_versions
          (voice_id, name, version, language, manifest_json, resource_fingerprint, status, published_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING RETURNING id`,
        [manifest.voiceId, manifest.name, manifest.version, manifest.language, JSON.stringify({ ...manifest, revoked: undefined }), voicePackResourceFingerprint(manifest), status]);
        if (inserted.rows[0]) await client.query(`INSERT INTO voice_pack_status_history
          (voice_pack_version_id, from_status, to_status, reason, revision) VALUES ($1, NULL, $2, $3, 1)`,
        [inserted.rows[0].id, status, "由 VOICE_PACK_CATALOG_JSON 一次性导入"]);
      }
    });
  }
  async listVersions(status = "", search = "") {
    const conditions: string[] = []; const params: unknown[] = [];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(voice_id LIKE $${params.length} OR name LIKE $${params.length} OR version LIKE $${params.length})`); }
    return (await this.pool.query(`SELECT * FROM voice_pack_versions ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, id DESC LIMIT 200`, params)).rows as VoicePackRow[];
  }
  async findVersion(id: number) { return ((await this.pool.query("SELECT * FROM voice_pack_versions WHERE id = $1", [id])).rows[0] as VoicePackRow | undefined) || null; }
  async findPublished(voiceId: string, version?: string | null) {
    const result = version ? await this.pool.query(`SELECT * FROM voice_pack_versions WHERE voice_id = $1 AND version = $2 AND status = 'published' ORDER BY id DESC LIMIT 1`, [voiceId, version])
      : await this.pool.query(`SELECT * FROM voice_pack_versions WHERE voice_id = $1 AND status = 'published' ORDER BY id DESC LIMIT 1`, [voiceId]);
    return (result.rows[0] as VoicePackRow | undefined) || null;
  }
  async preference(userId: number) {
    const row = (await this.pool.query(`SELECT selected_voice_id, selected_version, preference, version, updated_at FROM user_voice_preferences WHERE user_id = $1`, [userId])).rows[0];
    return row ? { selectedVoiceId: row.selected_voice_id, selectedVersion: row.selected_version, preference: row.preference, version: Number(row.version), updatedAt: row.updated_at }
      : { selectedVoiceId: null, selectedVersion: null, preference: "automatic", version: 0, updatedAt: null };
  }
  async updatePreference(userId: number, expected: number, voiceId: string | null, version: string | null, preference: string) {
    return this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('voice-pack-publication'))");
      if (voiceId && version && !(await client.query(`SELECT id FROM voice_pack_versions
        WHERE voice_id = $1 AND version = $2 AND status = 'published'`, [voiceId, version])).rows[0]) return null;
      const result = expected === 0 ? await client.query(`INSERT INTO user_voice_preferences (user_id, selected_voice_id, selected_version, preference)
        VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING`, [userId, voiceId, version, preference])
        : await client.query(`UPDATE user_voice_preferences SET selected_voice_id = $1, selected_version = $2, preference = $3,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4 AND version = $5`, [voiceId, version, preference, userId, expected]);
      if (result.rowCount !== 1) return null;
      const row = (await client.query(`SELECT selected_voice_id, selected_version, preference, version, updated_at
        FROM user_voice_preferences WHERE user_id = $1`, [userId])).rows[0];
      return { selectedVoiceId: row.selected_voice_id, selectedVersion: row.selected_version, preference: row.preference,
        version: Number(row.version), updatedAt: row.updated_at };
    });
  }
  async history(id: number) { return (await this.pool.query(`SELECT id, actor_user_id AS "actorUserId", from_status AS "fromStatus",
    to_status AS "toStatus", reason, revision, created_at AS "createdAt" FROM voice_pack_status_history
    WHERE voice_pack_version_id = $1 ORDER BY id DESC`, [id])).rows as Array<Record<string, unknown>>; }
  async createDraft(userId: number, draft: VoicePackDraft, audit: VoicePackAudit) {
    try { return await this.tx(async (client) => {
      const inserted = await client.query(`INSERT INTO voice_pack_versions
        (voice_id, name, version, language, style_tags_json, manifest_json, resource_fingerprint, provider_voice, created_by)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9) RETURNING *`, [draft.manifest.voiceId, draft.manifest.name,
        draft.manifest.version, draft.manifest.language, JSON.stringify(draft.styleTags), JSON.stringify(draft.manifest), draft.fingerprint, draft.providerVoice, userId]);
      const row = inserted.rows[0] as VoicePackRow; await client.query(`INSERT INTO voice_pack_status_history
        (voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision) VALUES ($1, $2, NULL, 'draft', '创建草稿', 1)`, [row.id, userId]);
      await this.audit(client, { ...audit, resourceId: row.id }); return { kind: "created" as const, row };
    }); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }
  async updateDraft(_userId: number, id: number, revision: number, draft: VoicePackDraft, audit: VoicePackAudit) {
    try { return await this.tx(async (client) => {
      const result = await client.query(`UPDATE voice_pack_versions SET voice_id = $1, name = $2, version = $3, language = $4,
        style_tags_json = $5::jsonb, manifest_json = $6::jsonb, resource_fingerprint = $7, provider_voice = $8,
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $9 AND revision = $10 AND status = 'draft' RETURNING *`,
      [draft.manifest.voiceId, draft.manifest.name, draft.manifest.version, draft.manifest.language, JSON.stringify(draft.styleTags),
        JSON.stringify(draft.manifest), draft.fingerprint, draft.providerVoice, id, revision]);
      if (!result.rows[0]) return { kind: "conflict" as const }; await this.audit(client, audit);
      return { kind: "updated" as const, row: result.rows[0] as VoicePackRow };
    }); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }
  async transition(userId: number, id: number, revision: number, fromStatus: string, target: "published" | "disabled" | "revoked", reason: string, audit: VoicePackAudit) {
    return this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('voice-pack-publication'))");
      const result = await client.query(`UPDATE voice_pack_versions SET status = $1, revision = revision + 1, reviewed_by = $2,
        published_at = CASE WHEN $1 = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END,
        revoked_at = CASE WHEN $1 = 'revoked' THEN CURRENT_TIMESTAMP ELSE NULL END,
        revoke_reason = CASE WHEN $1 = 'revoked' THEN $3 ELSE NULL END, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND revision = $5 AND status = $6 RETURNING *`, [target, userId, reason || null, id, revision, fromStatus]);
      const row = result.rows[0] as VoicePackRow | undefined; if (!row) return null;
      await client.query(`INSERT INTO voice_pack_status_history
        (voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, fromStatus, target, reason || (target === "published" ? "发布审核通过" : null), revision + 1]);
      if (target === "revoked") await client.query(`UPDATE user_voice_preferences SET selected_voice_id = NULL, selected_version = NULL,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE selected_voice_id = $1 AND selected_version = $2`, [row.voice_id, row.version]);
      await this.audit(client, audit); return row;
    });
  }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect(); try { await client.query("BEGIN"); const value = await operation(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  private audit(client: PoolClient, value: VoicePackAudit) { return client.query(`INSERT INTO admin_audit_logs
    (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
    VALUES ($1, $2, 'voice_pack_version', $3, $4, $5::jsonb, $6, $7)`, [value.adminUserId, value.action, String(value.resourceId), value.summary,
    value.details ? JSON.stringify(value.details) : null, value.ipAddress || null, value.userAgent || null]); }
}
