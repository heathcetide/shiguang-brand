import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { verifyPreviewCertificate } from "./verify-preview-certificate.mjs";
const pem = fs.readFileSync(new URL("./fixtures/preview-test-certificate.pem",import.meta.url));
const certificate = new X509Certificate(pem);
const day = 86_400_000;
const options = { expectedDigest: certificate.fingerprint256,now: Date.parse(certificate.validFrom)+day };
test("accepts the pinned long-lived preview certificate and reports public evidence",() => {
  const result = verifyPreviewCertificate(pem,options);
  assert.equal(result.sha256,certificate.fingerprint256.replaceAll(":","").toLowerCase());
  assert.equal(result.validTo,new Date(certificate.validTo).toISOString());
});
test("rejects wrong or missing pins and accidental release key reuse",() => {
  assert.throws(() => verifyPreviewCertificate(pem,{ ...options,expectedDigest: '0'.repeat(64) }),/pinned digest/);
  assert.throws(() => verifyPreviewCertificate(pem,{ ...options,expectedDigest: '' }),/required/);
  assert.throws(() => verifyPreviewCertificate(pem,{ ...options,releaseDigest: certificate.fingerprint256 }),/must differ/);
});
test("rejects future, expired and soon-expiring signing certificates",() => {
  assert.throws(() => verifyPreviewCertificate(pem,{ ...options,now: Date.parse(certificate.validFrom)-1 }),/currently valid/);
  assert.throws(() => verifyPreviewCertificate(pem,{ ...options,now: Date.parse(certificate.validTo) }),/currently valid/);
  assert.throws(() => verifyPreviewCertificate(pem,{ ...options,now: Date.parse(certificate.validTo)-364*day }),/365 days/);
});
