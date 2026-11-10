import { test } from "node:test";
import assert from "node:assert/strict";
import { communityBookmarkResponseSchema, createCommunityOpenApiDocument } from "../src/community.ts";
test("bookmark responses require explicit boolean confirmed state", () => {
  assert.deepEqual(communityBookmarkResponseSchema.parse({ bookmarked: true }), { bookmarked: true });
  for (const invalid of [{}, { bookmarked: 1 }, { bookmarked: "false" }]) assert.equal(communityBookmarkResponseSchema.safeParse(invalid).success, false);
});
test("bookmark contract is account-authenticated and exposes idempotent desired-state methods", () => {
  const document = createCommunityOpenApiDocument();
  assert.deepEqual(document.security, [{ bearerAuth: [] }]);
  const path = document.paths["/api/v1/community/posts/{id}/bookmark"];
  assert.equal(path.put.operationId, "saveCommunityPost");
  assert.equal(path.delete.operationId, "unsaveCommunityPost");
  assert.ok(path.put.responses["404"]);
  assert.ok(path.delete.responses["401"]);
});
