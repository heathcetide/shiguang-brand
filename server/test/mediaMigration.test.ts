import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectPostUrls, deterministicMediaKey, isInlineImage, runMediaMigration } from "../scripts/migrate-community-media.js";

describe("community media migration", () => {
  it("normalizes SQLite JSON text and PostgreSQL JSONB arrays", () => {
    const base = { id: 1, user_id: 2, image_url: "fallback" };
    assert.deepEqual(collectPostUrls({ ...base, image_urls: '["one","two"]' }), ["one", "two"]);
    assert.deepEqual(collectPostUrls({ ...base, image_urls: ["one", "two"] }), ["one", "two"]);
    assert.deepEqual(collectPostUrls({ ...base, image_urls: null }), ["fallback"]);
  });

  it("uses stable content keys so interrupted reruns overwrite instead of duplicating objects", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(deterministicMediaKey(image), deterministicMediaKey(image));
    assert.match(deterministicMediaKey(image), /^[a-f0-9]{64}$/);
    assert.equal(isInlineImage(image), true);
    assert.equal(isInlineImage("https://example.com/image.png"), false);
  });

  it("inventories inline images without mutating either database adapter", async () => {
    let writes = 0;
    const result = await runMediaMigration({
      async posts() { return [{ id: 1, user_id: 2, image_url: null, image_urls: ["data:image/png;base64,a", "https://example.com/a"] }]; },
      async comments() { return [{ id: 3, user_id: 2, image_url: "data:image/png;base64,b" }]; },
      async updatePost() { writes += 1; },
      async updateComment() { writes += 1; },
      async close() {},
    }, false);
    assert.deepEqual(result, { apply: false, posts: 1, comments: 1, inlineImages: 2 });
    assert.equal(writes, 0);
  });
});
