import { createHash } from "node:crypto";
import { VoicePacksError } from "./errors.js";
import { appVersionAtLeast, internalTestVoicePacksEnabled, parseVoicePackCatalog, parseVoicePackRow, validateVoicePackManifest, voicePackResourceFingerprint } from "./manifest.js";
import type { VoicePacksRepository } from "./repository.js";
import type { VoicePackAudit, VoicePackDraft, VoicePackRow } from "./types.js";

function jsonArray(value: unknown) { return Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) as unknown[] : []; }
export function publicAdminVoicePack(row: VoicePackRow) {
  return { id: row.id, voiceId: row.voice_id, name: row.name, version: row.version, language: row.language,
    styleTags: jsonArray(row.style_tags_json), manifest: parseVoicePackRow(row), providerVoice: row.provider_voice,
    status: row.status, revision: Number(row.revision), createdBy: row.created_by, reviewedBy: row.reviewed_by,
    publishedAt: row.published_at, revokedAt: row.revoked_at, revokeReason: row.revoke_reason,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
export function parseVoicePackDraft(body: Record<string, unknown>): VoicePackDraft | null {
  const manifest = validateVoicePackManifest(body.manifest); if (!manifest) return null;
  const styleTags = Array.isArray(body.styleTags) ? [...new Set(body.styleTags.map(String).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12) : [];
  const providerVoice = body.providerVoice == null ? null : String(body.providerVoice).trim();
  if (providerVoice && !/^[a-z0-9._-]{1,80}$/i.test(providerVoice)) return null;
  return { manifest, styleTags, providerVoice, fingerprint: voicePackResourceFingerprint(manifest) };
}
export class VoicePacksService {
  private readonly repository: VoicePacksRepository;
  constructor(repository: VoicePacksRepository) { this.repository = repository; }
  private async ensureCatalog() {
    const allowInternal = internalTestVoicePacksEnabled();
    await this.repository.ensureEnvironmentCatalog(parseVoicePackCatalog()
      .filter((manifest) => manifest.distribution !== "internal-test" || allowInternal));
  }
  async catalog(clientVersion: string) {
    await this.ensureCatalog(); const rows = (await this.repository.listVersions())
      .sort((left, right) => left.voice_id.localeCompare(right.voice_id) || Number(right.id) - Number(left.id));
    const allowInternal = internalTestVoicePacksEnabled();
    const items = rows.filter((row) => row.status === "published").map(parseVoicePackRow)
      .filter((manifest) => manifest.distribution !== "internal-test" || allowInternal)
      .filter((manifest) => appVersionAtLeast(clientVersion, manifest.minimumAppVersion));
    const revoked = rows.filter((row) => row.status === "revoked").map((row) => ({ voiceId: row.voice_id, version: row.version }));
    const source = rows.map((row) => `${row.id}:${row.revision}:${row.status}:${row.updated_at}`).join("|");
    return { items, revoked, catalogVersion: createHash("sha256").update(source).digest("hex").slice(0, 20), authority: "database" as const };
  }
  async findPublished(voiceId: string, version?: string | null) {
    await this.ensureCatalog();
    const row = await this.repository.findPublished(voiceId, version);
    if (!row) return null;
    const manifest = parseVoicePackRow(row);
    return manifest.distribution === "internal-test" && !internalTestVoicePacksEnabled() ? null : row;
  }
  preference(userId: number) { return this.repository.preference(userId); }
  async updatePreference(userId: number, body: Record<string, unknown>) {
    const preference = body.preference; const voiceId = body.selectedVoiceId == null ? null : String(body.selectedVoiceId);
    const version = body.selectedVersion == null ? null : String(body.selectedVersion); const expected = Number(body.version ?? 0);
    if (!["automatic", "system-only"].includes(String(preference))) throw new VoicePacksError(400, "语音偏好无效", "INVALID_VOICE_PREFERENCE");
    if ((voiceId || version) && (!voiceId || !version || !(await this.findPublished(voiceId, version)))) {
      throw new VoicePacksError(400, "所选音色未发布或已撤销", "VOICE_PACK_NOT_AVAILABLE");
    }
    const updated = await this.repository.updatePreference(userId, expected, voiceId, version, String(preference));
    if (!updated) throw new VoicePacksError(409, expected ? "语音偏好已在其他设备更新" : "语音偏好版本无效", "VOICE_PREFERENCE_VERSION_CONFLICT");
    return updated;
  }
  async adminList(status = "", search = "") { return { items: (await this.repository.listVersions(status, search)).map(publicAdminVoicePack), authority: "database" }; }
  async history(id: number) { if (!(await this.repository.findVersion(id))) throw new VoicePacksError(404, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND"); return { items: await this.repository.history(id) }; }
  async create(userId: number, body: Record<string, unknown>, context: Omit<VoicePackAudit, "adminUserId" | "action" | "resourceId" | "summary">) {
    const draft = parseVoicePackDraft(body); if (!draft) throw new VoicePacksError(400, "音色包清单、HTTPS 资源、摘要或授权字段无效", "VOICE_PACK_VALIDATION_FAILED");
    const result = await this.repository.createDraft(userId, draft, { ...context, adminUserId: userId, action: "voice_pack.create", resourceId: 0,
      summary: `创建音色包草稿 ${draft.manifest.voiceId}@${draft.manifest.version}` });
    if (result.kind === "duplicate") throw new VoicePacksError(409, "音色版本或资源已经存在", "VOICE_PACK_DUPLICATE");
    return publicAdminVoicePack(result.row);
  }
  async update(userId: number, id: number, body: Record<string, unknown>, context: Omit<VoicePackAudit, "adminUserId" | "action" | "resourceId" | "summary">) {
    const row = await this.repository.findVersion(id); if (!row) throw new VoicePacksError(404, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND");
    if (row.status !== "draft") throw new VoicePacksError(409, "已进入发布流程的资源不可原地覆盖，请创建新版本", "VOICE_PACK_IMMUTABLE");
    const revision = Number(body.revision); if (revision !== Number(row.revision)) throw new VoicePacksError(409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
    const draft = parseVoicePackDraft(body); if (!draft) throw new VoicePacksError(400, "音色包清单、HTTPS 资源、摘要或授权字段无效", "VOICE_PACK_VALIDATION_FAILED");
    const result = await this.repository.updateDraft(userId, id, revision, draft, { ...context, adminUserId: userId, action: "voice_pack.update", resourceId: id,
      summary: `更新音色包草稿 ${draft.manifest.voiceId}@${draft.manifest.version}`, details: { revision: revision + 1 } });
    if (result.kind === "duplicate") throw new VoicePacksError(409, "音色版本或资源已经存在", "VOICE_PACK_DUPLICATE");
    if (result.kind === "conflict") throw new VoicePacksError(409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
    return publicAdminVoicePack(result.row);
  }
  async transition(userId: number, id: number, target: "published" | "disabled" | "revoked", body: Record<string, unknown>, context: Omit<VoicePackAudit, "adminUserId" | "action" | "resourceId" | "summary">) {
    const row = await this.repository.findVersion(id); if (!row) throw new VoicePacksError(404, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND");
    const revision = Number(body.revision); const reason = String(body.reason || "").trim();
    if (revision !== Number(row.revision)) throw new VoicePacksError(409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
    if (target !== "published" && reason.length < 4) throw new VoicePacksError(400, "请填写状态变更原因", "VOICE_PACK_REASON_REQUIRED");
    if (target === "published" && !["draft", "disabled"].includes(row.status)) throw new VoicePacksError(409, "当前状态不能发布", "VOICE_PACK_INVALID_TRANSITION");
    if (target === "disabled" && row.status !== "published") throw new VoicePacksError(409, "仅已发布音色可以下架", "VOICE_PACK_INVALID_TRANSITION");
    if (target === "revoked" && row.status === "revoked") throw new VoicePacksError(409, "音色已经撤销", "VOICE_PACK_INVALID_TRANSITION");
    const manifest = validateVoicePackManifest(parseVoicePackRow(row));
    if (!manifest) throw new VoicePacksError(400, "音色包未通过发布校验", "VOICE_PACK_VALIDATION_FAILED");
    if (target === "published" && manifest.distribution === "internal-test" && !internalTestVoicePacksEnabled()) {
      throw new VoicePacksError(409, "当前环境禁止发布内部测试音色", "VOICE_PACK_INTERNAL_TEST_FORBIDDEN");
    }
    const next = await this.repository.transition(userId, id, revision, row.status, target, reason, { ...context, adminUserId: userId,
      action: `voice_pack.${target}`, resourceId: id, summary: `音色包 ${row.voice_id}@${row.version} 状态变更为 ${target}`,
      details: { before: row.status, after: target, reason: reason || null, revision: revision + 1 } });
    if (!next) throw new VoicePacksError(409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
    return publicAdminVoicePack(next);
  }
}
