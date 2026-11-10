import crypto from "node:crypto";

const KEY_CONTEXT = "dietdigidose-auth-verification-v1";

function sourceSecret() {
  const configured = process.env.AUTH_AUDIT_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_AUDIT_ENCRYPTION_KEY is required in production");
  }
  return process.env.JWT_SECRET?.trim() || "dietdigidose-local-auth-audit-key";
}

function secretKey(purpose: string) {
  const bytes = crypto.createHash("sha256").update(`${KEY_CONTEXT}:${purpose}:${sourceSecret()}`).digest("hex");
  return crypto.createSecretKey(bytes, "hex");
}

function dataViewFromHex(value: string) {
  const bytes = Uint8Array.from(value.match(/.{2}/g) || [], (part) => Number.parseInt(part, 16));
  return new DataView(bytes.buffer);
}

export type EncryptedSubject = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptVerificationSubject(value: string): EncryptedSubject {
  const iv = crypto.randomBytes(12).toString("hex");
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey("encrypt"), dataViewFromHex(iv));
  const ciphertext = cipher.update(value, "utf8", "hex") + cipher.final("hex");
  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptVerificationSubject(value: EncryptedSubject) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretKey("encrypt"),
    dataViewFromHex(value.iv),
  );
  decipher.setAuthTag(dataViewFromHex(value.authTag));
  return decipher.update(value.ciphertext, "hex", "utf8") + decipher.final("utf8");
}

export function verificationSubjectHmac(value: string) {
  return crypto.createHmac("sha256", secretKey("lookup")).update(value).digest("hex");
}

export function hashRegistrationToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function maskMainlandPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

// A stored-hash prefix keeps recovery proofs separate even if a caller changes the raw token.
export function hashPasswordRecoveryToken(value: string) {
  return `password-recovery:${hashRegistrationToken(value)}`;
}
