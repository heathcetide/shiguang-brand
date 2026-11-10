import { z } from "zod";

export const ACCOUNT_PASSWORD_MAX_UTF8_BYTES = 72;
export const ACCOUNT_PASSWORD_REQUIREMENTS = "密码至少6位，包含字母和数字，且 UTF-8 编码不超过72字节";
// Deliberately independent of Buffer/TextEncoder so the same rule works in React Native.
// Lone surrogates, like a UTF-8 encoder's replacement character, occupy three bytes.
export function isPasswordWithinByteLimit(password: string): boolean {
  let bytes = 0;
  for (const character of password) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > ACCOUNT_PASSWORD_MAX_UTF8_BYTES) return false;
  }
  return true;
}
// This schema is for NEW credentials only. Existing password proofs retain their legacy limits.
export const accountPasswordSchema = z.string().min(6, ACCOUNT_PASSWORD_REQUIREMENTS).max(128, ACCOUNT_PASSWORD_REQUIREMENTS)
  .regex(/[A-Za-z]/, ACCOUNT_PASSWORD_REQUIREMENTS).regex(/\d/, ACCOUNT_PASSWORD_REQUIREMENTS)
  .refine(isPasswordWithinByteLimit, ACCOUNT_PASSWORD_REQUIREMENTS);
export const accountDeletionSchema = z.object({
  password: z.string().min(1).max(128), confirmation: z.literal("DELETE"),
}).strict();
export type AccountDeletionProof = { password: string };

export const passwordRecoveryTokenSchema = z.string().regex(/^[1-9]\d{0,15}\.[A-Za-z0-9_-]{43}$/)
  .refine((token) => Number.isSafeInteger(Number(token.split(".")[0])));
export const passwordRecoveryResetSchema = z.object({ recoveryToken: passwordRecoveryTokenSchema, newPassword: accountPasswordSchema,
  channel: z.literal("email").optional(),
}).strict();

export const recoveryEmailSchema = z.string().trim().toLowerCase().max(254).email();
export const emailVerificationSendSchema = z.object({ currentPassword: z.string().min(1).max(128) }).strict();
export const emailRecoverySendSchema = z.object({ email: recoveryEmailSchema }).strict();
export const emailVerificationCodeSchema = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict();
