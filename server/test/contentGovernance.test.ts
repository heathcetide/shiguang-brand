import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  normalizeContentTerm,
  recipeContentFingerprint,
  recipeSimilarity,
  validateIngredientQuality,
  validateRecipePublication,
} from "../src/services/contentGovernance.js";
import { parseVoicePackCatalog } from "../src/modules/voicePacks/manifest.js";

describe("content governance contracts", () => {
  test("normalizes common Chinese variants and punctuation", () => {
    assert.equal(normalizeContentTerm(" 蕃茄（新鲜） "), "番茄");
    assert.equal(normalizeContentTerm("馬鈴薯"), "马铃薯");
  });

  test("rejects implausible or untraceable nutrition rows", () => {
    assert.deepEqual(validateIngredientQuality({
      calories100g: 1_200, protein100g: 80, carbs100g: 40, fat100g: -1,
      source: "", dataLicense: "", sourceVersion: "", edibleRatio: 1.2,
    }).sort(), [
      "implausible_macronutrient_total", "invalid_calories", "invalid_edible_ratio",
      "invalid_macronutrient", "missing_license", "missing_source", "missing_source_version",
    ].sort());
  });

  test("fingerprints deterministically and flags near-duplicate recipes", () => {
    const first = { title: "番茄炒蛋", ingredients: [{ name: "番茄" }, { name: "鸡蛋" }], steps: ["切番茄", "炒熟"] };
    const second = { title: "西红柿炒鸡蛋", ingredients: [{ name: "鸡蛋" }, { name: "番茄" }], steps: ["切番茄", "炒熟"] };
    assert.equal(recipeContentFingerprint(first), recipeContentFingerprint({ ...first }));
    const similarity = recipeSimilarity(first, second);
    assert.ok(similarity.score >= 0.5);
    assert.ok(similarity.reasons.includes("ingredients"));
  });

  test("requires traceable, structured recipe publication fields", () => {
    assert.deepEqual(validateRecipePublication({ title: "测试", source: "wikibooks_zh", ingredients: [], steps: [] }).sort(), [
      "missing_attribution", "missing_ingredients", "missing_kitchenware_mapping", "missing_license",
      "missing_serving_size", "missing_source_url", "missing_steps", "missing_time",
    ].sort());
  });

  test("voice catalog accepts only HTTPS, checksummed and licensed manifests", () => {
    const manifest = {
      voiceId: "licensed-zh", name: "授权中文音色", version: "1.0.0", language: "zh-CN",
      sampleRate: 22050, outputFormat: "pcm-f32", minimumAppVersion: "1.0.5", minimumMemoryMb: 512,
      license: { name: "Apache-2.0", url: "https://example.com/license", speakerAuthorization: "record-1", modelNotice: "extractable" },
      resources: [
        { path: "model.onnx", url: "https://example.com/model.onnx", sha256: "a".repeat(64), bytes: 10 },
        { path: "tokens.json", url: "https://example.com/tokens.json", sha256: "b".repeat(64), bytes: 10 },
      ],
      model: { path: "model.onnx", vocabularyPath: "tokens.json", inputNames: { tokens: "input", lengths: "input_lengths" } },
    };
    assert.equal(parseVoicePackCatalog(JSON.stringify([manifest])).length, 1);
    assert.equal(parseVoicePackCatalog(JSON.stringify([{ ...manifest, resources: [{ ...manifest.resources[0], url: "http://example.com/model.onnx" }] }])).length, 0);
  });
});
