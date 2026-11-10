import type Database from "better-sqlite3";
import { voicePackResourceFingerprint } from "./manifest.js";
import type { VoicePacksRepository } from "./repository.js";
import type { VoicePackAudit, VoicePackDraft, VoicePackManifest, VoicePackRow } from "./types.js";

function duplicate(error: unknown) { return error instanceof Error && /UNIQUE constraint failed/.test(error.message); }
export class SqliteVoicePacksRepository implements VoicePacksRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }
  async ensureEnvironmentCatalog(items: VoicePackManifest[]) {
    if (!items.length || Number((this.database.prepare("SELECT COUNT(*) AS count FROM voice_pack_versions").get() as { count: number }).count) > 0) return;
    this.database.transaction(() => {
      const insert = this.database.prepare(`INSERT OR IGNORE INTO voice_pack_versions
        (voice_id, name, version, language, manifest_json, resource_fingerprint, status, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
      const history = this.database.prepare(`INSERT INTO voice_pack_status_history
        (voice_pack_version_id, from_status, to_status, reason, revision) VALUES (?, NULL, ?, ?, 1)`);
      for (const manifest of items) {
        const result = insert.run(manifest.voiceId, manifest.name, manifest.version, manifest.language,
          JSON.stringify({ ...manifest, revoked: undefined }), voicePackResourceFingerprint(manifest), manifest.revoked ? "revoked" : "published");
        if (result.changes) history.run(result.lastInsertRowid, manifest.revoked ? "revoked" : "published", "由 VOICE_PACK_CATALOG_JSON 一次性导入");
      }
    })();
  }
  async listVersions(status = "", search = "") {
    const conditions: string[] = []; const params: string[] = [];
    if (status) { conditions.push("status = ?"); params.push(status); }
    if (search) { conditions.push("(voice_id LIKE ? OR name LIKE ? OR version LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    return this.database.prepare(`SELECT * FROM voice_pack_versions ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, id DESC LIMIT 200`).all(...params) as VoicePackRow[];
  }
  async findVersion(id: number) { return (this.database.prepare("SELECT * FROM voice_pack_versions WHERE id = ?").get(id) as VoicePackRow | undefined) || null; }
  async findPublished(voiceId: string, version?: string | null) {
    return (this.database.prepare(`SELECT * FROM voice_pack_versions WHERE voice_id = ? AND status = 'published'
      ${version ? "AND version = ?" : ""} ORDER BY id DESC LIMIT 1`).get(...(version ? [voiceId, version] : [voiceId])) as VoicePackRow | undefined) || null;
  }
  async preference(userId: number) {
    return this.preferenceRow(userId);
  }
  private preferenceRow(userId: number) {
    const row = this.database.prepare(`SELECT selected_voice_id, selected_version, preference, version, updated_at
      FROM user_voice_preferences WHERE user_id = ?`).get(userId) as Record<string, unknown> | undefined;
    return row ? { selectedVoiceId: row.selected_voice_id as string | null, selectedVersion: row.selected_version as string | null,
      preference: String(row.preference), version: Number(row.version), updatedAt: row.updated_at }
      : { selectedVoiceId: null, selectedVersion: null, preference: "automatic", version: 0, updatedAt: null };
  }
  async updatePreference(userId: number, expectedVersion: number, voiceId: string | null, version: string | null, preference: string) {
    return this.database.transaction(() => {
      if (voiceId && version && !this.database.prepare(`SELECT id FROM voice_pack_versions
        WHERE voice_id = ? AND version = ? AND status = 'published'`).get(voiceId, version)) return null;
      const result = expectedVersion === 0
        ? this.database.prepare(`INSERT INTO user_voice_preferences (user_id, selected_voice_id, selected_version, preference)
            VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`).run(userId, voiceId, version, preference)
        : this.database.prepare(`UPDATE user_voice_preferences SET selected_voice_id = ?, selected_version = ?, preference = ?,
            version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND version = ?`)
          .run(voiceId, version, preference, userId, expectedVersion);
      return result.changes === 1 ? this.preferenceRow(userId) : null;
    })();
  }
  async history(id: number) {
    return this.database.prepare(`SELECT id, actor_user_id AS actorUserId, from_status AS fromStatus,
      to_status AS toStatus, reason, revision, created_at AS createdAt FROM voice_pack_status_history
      WHERE voice_pack_version_id = ? ORDER BY id DESC`).all(id) as Array<Record<string, unknown>>;
  }
  async createDraft(userId: number, draft: VoicePackDraft, audit: VoicePackAudit) {
    try {
      return this.database.transaction(() => {
        const result = this.database.prepare(`INSERT INTO voice_pack_versions
          (voice_id, name, version, language, style_tags_json, manifest_json, resource_fingerprint, provider_voice, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(draft.manifest.voiceId, draft.manifest.name, draft.manifest.version,
          draft.manifest.language, JSON.stringify(draft.styleTags), JSON.stringify(draft.manifest), draft.fingerprint, draft.providerVoice, userId);
        const id = Number(result.lastInsertRowid);
        this.database.prepare(`INSERT INTO voice_pack_status_history
          (voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision)
          VALUES (?, ?, NULL, 'draft', '创建草稿', 1)`).run(id, userId);
        this.audit({ ...audit, resourceId: id });
        return { kind: "created" as const, row: this.row(id)! };
      })();
    } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }
  async updateDraft(_userId: number, id: number, revision: number, draft: VoicePackDraft, audit: VoicePackAudit) {
    try {
      return this.database.transaction(() => {
        const result = this.database.prepare(`UPDATE voice_pack_versions SET voice_id = ?, name = ?, version = ?, language = ?,
          style_tags_json = ?, manifest_json = ?, resource_fingerprint = ?, provider_voice = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ? AND status = 'draft'`).run(draft.manifest.voiceId, draft.manifest.name, draft.manifest.version,
          draft.manifest.language, JSON.stringify(draft.styleTags), JSON.stringify(draft.manifest), draft.fingerprint, draft.providerVoice, id, revision);
        if (!result.changes) return { kind: "conflict" as const };
        this.audit(audit); return { kind: "updated" as const, row: this.row(id)! };
      })();
    } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }
  async transition(userId: number, id: number, revision: number, fromStatus: string, target: "published" | "disabled" | "revoked", reason: string, audit: VoicePackAudit) {
    return this.database.transaction(() => {
      const result = this.database.prepare(`UPDATE voice_pack_versions SET status = ?, revision = revision + 1, reviewed_by = ?,
        published_at = CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END,
        revoked_at = CASE WHEN ? = 'revoked' THEN CURRENT_TIMESTAMP ELSE NULL END,
        revoke_reason = CASE WHEN ? = 'revoked' THEN ? ELSE NULL END, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ? AND status = ?`).run(target, userId, target, target, target, reason || null, id, revision, fromStatus);
      if (!result.changes) return null;
      this.database.prepare(`INSERT INTO voice_pack_status_history
        (voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, userId, fromStatus, target, reason || (target === "published" ? "发布审核通过" : null), revision + 1);
      if (target === "revoked") this.database.prepare(`UPDATE user_voice_preferences SET selected_voice_id = NULL, selected_version = NULL,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE selected_voice_id = ? AND selected_version = ?`)
        .run(this.row(id)!.voice_id, this.row(id)!.version);
      this.audit(audit); return this.row(id)!;
    })();
  }
  private row(id: number) { return this.database.prepare("SELECT * FROM voice_pack_versions WHERE id = ?").get(id) as VoicePackRow | undefined; }
  private audit(value: VoicePackAudit) {
    this.database.prepare(`INSERT INTO admin_audit_logs
      (admin_user_id, action, resource_type, resource_id, summary, details_json, ip_address, user_agent)
      VALUES (?, ?, 'voice_pack_version', ?, ?, ?, ?, ?)`).run(value.adminUserId, value.action, String(value.resourceId), value.summary,
      value.details ? JSON.stringify(value.details) : null, value.ipAddress || null, value.userAgent || null);
  }
}
