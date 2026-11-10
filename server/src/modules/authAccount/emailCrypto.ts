import crypto from "node:crypto";

// Keep this domain stable so in-flight email challenges remain verifiable.
const KEY_CONTEXT = "dietdigidose-auth-verification-v1";
function sourceSecret() {
  const configured = process.env.AUTH_AUDIT_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_AUDIT_ENCRYPTION_KEY is required in production");
  return process.env.JWT_SECRET?.trim() || "dietdigidose-local-auth-audit-key";
}
export function verificationSubjectHmac(value: string) {
  const key = crypto.createHash("sha256").update(`${KEY_CONTEXT}:lookup:${sourceSecret()}`).digest("hex");
  return crypto.createHmac("sha256", crypto.createSecretKey(key, "hex")).update(value).digest("hex");
}
export function hashPasswordRecoveryToken(value: string) {
  return `password-recovery:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
