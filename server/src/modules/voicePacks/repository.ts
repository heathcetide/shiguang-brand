import type { VoicePackAudit, VoicePackDraft, VoicePackManifest, VoicePackRow, VoicePreference } from "./types.js";
export interface VoicePacksRepository {
  ensureEnvironmentCatalog(items: VoicePackManifest[]): Promise<void>;
  listVersions(status?: string, search?: string): Promise<VoicePackRow[]>;
  findVersion(id: number): Promise<VoicePackRow | null>;
  findPublished(voiceId: string, version?: string | null): Promise<VoicePackRow | null>;
  preference(userId: number): Promise<VoicePreference>;
  updatePreference(userId: number, expectedVersion: number, voiceId: string | null, version: string | null, preference: string): Promise<VoicePreference | null>;
  history(id: number): Promise<Array<Record<string, unknown>>>;
  createDraft(userId: number, draft: VoicePackDraft, audit: VoicePackAudit): Promise<{ kind: "created"; row: VoicePackRow } | { kind: "duplicate" }>;
  updateDraft(userId: number, id: number, revision: number, draft: VoicePackDraft, audit: VoicePackAudit): Promise<{ kind: "updated"; row: VoicePackRow } | { kind: "conflict" } | { kind: "duplicate" }>;
  transition(userId: number, id: number, revision: number, fromStatus: string, target: "published" | "disabled" | "revoked", reason: string, audit: VoicePackAudit): Promise<VoicePackRow | null>;
}
