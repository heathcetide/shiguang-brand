import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const RELEASE_CERT_SHA256 = "7473251630e89fbad819b5193c07b857b3ac5b64244551c1bbad55460fbe9cd2";
const digest = value => {
  const normalized = String(value || "").replaceAll(":","").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("A valid pinned certificate SHA-256 digest is required");
  return normalized;
};
export function verifyPreviewCertificate(pem,{ expectedDigest,releaseDigest = RELEASE_CERT_SHA256,now = Date.now() }) {
  const certificate = new X509Certificate(pem);
  const actual = digest(certificate.fingerprint256);
  if (actual!==digest(expectedDigest)) throw new Error("Preview certificate does not match its pinned digest");
  if (actual===digest(releaseDigest)) throw new Error("Preview and release certificates must differ");
  const from = Date.parse(certificate.validFrom); const until = Date.parse(certificate.validTo);
  if (!Number.isFinite(now) || !Number.isFinite(from) || !Number.isFinite(until) || now<from || now>=until) throw new Error("Preview certificate is not currently valid");
  if (until-now<365*24*60*60*1000) throw new Error("Preview certificate must remain valid for at least 365 days; plan a controlled renewal");
  return { sha256: actual,validFrom: new Date(from).toISOString(),validTo: new Date(until).toISOString(),minimumRemainingDays: 365 };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error("Usage: node scripts/verify-preview-certificate.mjs <exported-public-certificate.pem>");
    console.log(JSON.stringify(verifyPreviewCertificate(fs.readFileSync(process.argv[2]),{ expectedDigest: process.env.EXPECTED_PREVIEW_CERT_SHA256 }),null,2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1;
  }
}
