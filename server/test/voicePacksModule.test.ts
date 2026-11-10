import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VoicePacksError } from "../src/modules/voicePacks/errors.js";
import { internalTestVoicePacksEnabled, parseVoicePackCatalog } from "../src/modules/voicePacks/manifest.js";
import type { VoicePacksRepository } from "../src/modules/voicePacks/repository.js";
import { VoicePacksService } from "../src/modules/voicePacks/service.js";

const manifest = { voiceId: "unit-voice", name: "测试音色", version: "1.0.0", language: "zh-CN", sampleRate: 22050,
  outputFormat: "pcm-f32" as const, minimumAppVersion: "1.0.0", minimumMemoryMb: 512,
  license: { name: "Apache-2.0", url: "https://example.com/license", speakerAuthorization: "record", modelNotice: "extractable" },
  resources: [{ path: "model.onnx", url: "https://example.com/model", sha256: "a".repeat(64), bytes: 100 }],
  model: { path: "model.onnx", vocabularyPath: "model.onnx", inputNames: { tokens: "tokens", lengths: "lengths" } } };
function fake(overrides: Partial<VoicePacksRepository> = {}): VoicePacksRepository {
  return { ensureEnvironmentCatalog: async () => {}, listVersions: async () => [], findVersion: async () => null,
    findPublished: async () => null, preference: async () => ({ selectedVoiceId: null, selectedVersion: null, preference: "automatic", version: 0, updatedAt: null }),
    updatePreference: async () => null, history: async () => [], createDraft: async () => ({ kind: "duplicate" }),
    updateDraft: async () => ({ kind: "conflict" }), transition: async () => null, ...overrides };
}
describe("voice packs module", () => {
  test("validates licensed HTTPS manifests independently of the database driver", () => {
    assert.equal(parseVoicePackCatalog(JSON.stringify([manifest])).length, 1);
    assert.equal(parseVoicePackCatalog(JSON.stringify([{ ...manifest, minimumMemoryMb: 64 }])).length, 0);
    assert.equal(parseVoicePackCatalog(JSON.stringify([{ ...manifest,
      resources: [{ ...manifest.resources[0], bytes: 201 * 1024 * 1024 }] }])).length, 0);
    assert.equal(parseVoicePackCatalog(JSON.stringify([{ ...manifest, model: { ...manifest.model,
      textProcessor: { type: "token-map-v1", mappingPath: "missing.json" } } }])).length, 0);
  });
  test("enables internal test voices only for an explicitly opted-in non-production deployment", () => {
    assert.equal(internalTestVoicePacksEnabled({ NODE_ENV: "production", DEPLOYMENT_ENV: "production",
      VOICE_PACK_ALLOW_INTERNAL_TEST: "1" } as NodeJS.ProcessEnv), false);
    assert.equal(internalTestVoicePacksEnabled({ NODE_ENV: "production", DEPLOYMENT_ENV: "staging",
      VOICE_PACK_ALLOW_INTERNAL_TEST: "1" } as NodeJS.ProcessEnv), true);
    assert.equal(internalTestVoicePacksEnabled({ NODE_ENV: "development", DEPLOYMENT_ENV: "development" } as NodeJS.ProcessEnv), false);
  });
  test("maps atomic preference conflicts to the public error contract", async () => {
    const service = new VoicePacksService(fake());
    await assert.rejects(() => service.updatePreference(7, { preference: "automatic", version: 0 }),
      (error: unknown) => error instanceof VoicePacksError && error.code === "VOICE_PREFERENCE_VERSION_CONFLICT");
  });
  test("filters unpublished and incompatible catalog rows after JSONB parsing", async () => {
    const row = { id: 1, voice_id: manifest.voiceId, name: manifest.name, version: manifest.version, language: manifest.language,
      status: "published" as const, revision: 1, manifest_json: manifest, updated_at: "2026-09-01" };
    const service = new VoicePacksService(fake({ listVersions: async () => [row] }));
    assert.equal((await service.catalog("1.0.0")).items.length, 1);
    assert.equal((await service.catalog("0.9.0")).items.length, 0);
  });
  test("keeps internal test rows out of a production catalog and synthesis selection", async () => {
    const previousDeployment = process.env.DEPLOYMENT_ENV;
    const previousAllow = process.env.VOICE_PACK_ALLOW_INTERNAL_TEST;
    process.env.DEPLOYMENT_ENV = "production";
    process.env.VOICE_PACK_ALLOW_INTERNAL_TEST = "1";
    try {
      const internalManifest = { ...manifest, distribution: "internal-test" as const };
      const row = { id: 2, voice_id: manifest.voiceId, name: manifest.name, version: manifest.version,
        language: manifest.language, status: "published" as const, revision: 1,
        manifest_json: internalManifest, updated_at: "2026-09-01" };
      const service = new VoicePacksService(fake({ listVersions: async () => [row], findPublished: async () => row }));
      assert.equal((await service.catalog("1.0.0")).items.length, 0);
      assert.equal(await service.findPublished(manifest.voiceId, manifest.version), null);
    } finally {
      if (previousDeployment === undefined) delete process.env.DEPLOYMENT_ENV; else process.env.DEPLOYMENT_ENV = previousDeployment;
      if (previousAllow === undefined) delete process.env.VOICE_PACK_ALLOW_INTERNAL_TEST; else process.env.VOICE_PACK_ALLOW_INTERNAL_TEST = previousAllow;
    }
  });
  test("rejects publishing an internal test voice in production", async () => {
    const previousDeployment = process.env.DEPLOYMENT_ENV;
    const previousAllow = process.env.VOICE_PACK_ALLOW_INTERNAL_TEST;
    process.env.DEPLOYMENT_ENV = "production";
    process.env.VOICE_PACK_ALLOW_INTERNAL_TEST = "1";
    try {
      const row = { id: 3, voice_id: manifest.voiceId, name: manifest.name, version: manifest.version,
        language: manifest.language, status: "draft" as const, revision: 1,
        manifest_json: { ...manifest, distribution: "internal-test" as const }, updated_at: "2026-09-01" };
      const service = new VoicePacksService(fake({ findVersion: async () => row }));
      await assert.rejects(() => service.transition(7, row.id, "published", { revision: 1 }, {
        ipAddress: null, userAgent: null,
      }), (error: unknown) => error instanceof VoicePacksError && error.code === "VOICE_PACK_INTERNAL_TEST_FORBIDDEN");
    } finally {
      if (previousDeployment === undefined) delete process.env.DEPLOYMENT_ENV; else process.env.DEPLOYMENT_ENV = previousDeployment;
      if (previousAllow === undefined) delete process.env.VOICE_PACK_ALLOW_INTERNAL_TEST; else process.env.VOICE_PACK_ALLOW_INTERNAL_TEST = previousAllow;
    }
  });
});
