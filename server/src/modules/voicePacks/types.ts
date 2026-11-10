export type VoicePackResource = { path: string; url: string; sha256: string; bytes: number };
export type VoicePackManifest = {
  voiceId: string; name: string; version: string; language: string;
  distribution?: "public" | "internal-test";
  gender?: "male" | "female" | "neutral" | "unspecified"; deviceRequirements?: string[];
  sampleRate: number; outputFormat: "pcm-f32"; minimumAppVersion: string; minimumMemoryMb: number;
  license: { name: string; url: string; speakerAuthorization: string; modelNotice: string };
  resources: VoicePackResource[];
  model: { path: string; vocabularyPath: string;
    textProcessor?: { type: "character-v1" } | { type: "token-map-v1"; mappingPath: string };
    inputNames: { tokens: string; lengths: string; scales?: string; speakerId?: string }; outputName?: string; speakerId?: number };
  previewUrl?: string; revoked?: boolean;
};
export type VoicePackRow = Record<string, unknown> & {
  id: number; voice_id: string; name: string; version: string; language: string;
  status: "draft" | "published" | "disabled" | "revoked"; revision: number;
};
export type VoicePackDraft = {
  manifest: VoicePackManifest; styleTags: string[]; providerVoice: string | null; fingerprint: string;
};
export type VoicePreference = { selectedVoiceId: string | null; selectedVersion: string | null; preference: string; version: number; updatedAt: unknown };
export type VoicePackAudit = {
  adminUserId: number; action: string; resourceId: number; summary: string;
  details?: Record<string, unknown>; ipAddress?: string | null; userAgent?: string | null;
};
