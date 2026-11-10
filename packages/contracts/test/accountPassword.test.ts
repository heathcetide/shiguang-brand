import assert from "node:assert/strict";
import { test } from "node:test";
import { accountDeletionSchema, accountPasswordSchema, isPasswordWithinByteLimit, passwordRecoveryResetSchema } from "../src/account.ts";

test("new passwords respect bcrypt's UTF-8 byte boundary, not character count", () => {
  for (const password of ["Aa1" + "x".repeat(69), "Aa1" + "界".repeat(23), "Aa12" + "😀".repeat(17)]) {
    assert.equal(Buffer.byteLength(password, "utf8"), 72);
    assert.equal(accountPasswordSchema.safeParse(password).success, true);
    assert.equal(accountPasswordSchema.safeParse(password + "x").success, false);
  }
  for (const password of ["", "short", "abcdef", "123456"]) assert.equal(accountPasswordSchema.safeParse(password).success, false);
  for (const password of ["a", "界", "😀", "\ud800", "a".repeat(70) + "\udfff"]) {
    assert.equal(isPasswordWithinByteLimit(password), Buffer.byteLength(password, "utf8") <= 72);
  }
});

test("account mutations reject retired phone proofs and recovery channels", () => {
  assert.equal(accountDeletionSchema.safeParse({ password: "Existing123", confirmation: "DELETE" }).success, true);
  assert.equal(accountDeletionSchema.safeParse({ reauthToken: "x".repeat(43), confirmation: "DELETE" }).success, false);
  assert.equal(accountDeletionSchema.safeParse({ password: "Existing123", reauthToken: "x".repeat(43), confirmation: "DELETE" }).success, false);
  const reset = { recoveryToken: "1." + "x".repeat(43), newPassword: "Changed123" };
  assert.equal(passwordRecoveryResetSchema.safeParse(reset).success, true);
  assert.equal(passwordRecoveryResetSchema.safeParse({ ...reset, channel: "email" }).success, true);
  assert.equal(passwordRecoveryResetSchema.safeParse({ ...reset, channel: "sms" }).success, false);
});
