import assert from "node:assert/strict";
import { test } from "node:test";
import { nextQuantityEvidence, quantityEvidenceStatus } from "../src/modules/inventory/evidence.js";

test("quantity evidence preserves uncertainty across exact changes and rejects stale lineage", () => {
  const source = { inventory_version: 3, field_evidence: { quantity: { status: "estimated", source: "recognition" } } };
  const next = nextQuantityEvidence(source, 3, 4, "preserve", true);
  assert.equal(quantityEvidenceStatus(next, 4), "estimated");
  assert.equal(next.field_evidence.quantity?.derived_from_version, 3);
  assert.equal(quantityEvidenceStatus(nextQuantityEvidence(source, 4, 5, "preserve", true), 5), "unknown");
  assert.equal(quantityEvidenceStatus(nextQuantityEvidence(source, 3, 4, "manual", true), 4), "known");
  assert.equal(quantityEvidenceStatus(nextQuantityEvidence(source, 3, 4, "manual", false), 4), "unknown");
  assert.equal(quantityEvidenceStatus(nextQuantityEvidence(source, 3, 4, "unverified", true), 4), "unknown");
  assert.equal(quantityEvidenceStatus(nextQuantityEvidence("malformed", 3, 4, "preserve", true), 4), "unknown");
  assert.deepEqual(nextQuantityEvidence(undefined, 3, 4, "preserve", true).field_evidence, {});
  assert.equal(source.inventory_version, 3);
});
