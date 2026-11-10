import { randomBytes, randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { recoveryEmailSchema } from "@dietdigidose/contracts";
import { hashPasswordRecoveryToken, verificationSubjectHmac } from "../../services/authVerificationCrypto.js";
import { AuthAccountError } from "./errors.js";

export type EmailPurpose = "email_verify" | "email_recovery";
export type EmailUser = { id: number; email: string | null; email_verified_at: string | null; password_hash: string | null;
  session_version: number; is_disabled: boolean | number };
export type EmailChallenge = { id: string; userId: number | null; email: string; purpose: EmailPurpose;
  sessionVersion: number | null; codeHash: string; expiresAt: string };
export interface EmailVerificationRepository {
  emailUser(selector: { id: number } | { email: string }): Promise<EmailUser | null>;
  createEmailChallenge(input: EmailChallenge): Promise<void>;
  finishEmailDelivery(id: string, sent: boolean): Promise<void>;
  verifyEmailChallenge(input: { id: string; purpose: EmailPurpose; userId?: number; codeHash: string;
    recoveryHash: string; recoveryExpiresAt: string }): Promise<number | null>;
}
export interface VerificationMailer {
  assertConfigured(): void;
  send(email: string, code: string, purpose: EmailPurpose): Promise<void>;
}

export class EmailVerificationService {
  private readonly repository: EmailVerificationRepository;
  private readonly mailer: VerificationMailer;
  constructor(repository: EmailVerificationRepository, mailer: VerificationMailer) { this.repository = repository; this.mailer = mailer; }

  async sendVerification(userId: number, password: string) {
    const user = await this.repository.emailUser({ id: userId });
    if (!user || user.is_disabled || !user.password_hash || !await bcrypt.compare(password, user.password_hash)) {
      throw new AuthAccountError(403, "请使用当前密码验证身份；无密码账号请先设置密码", "EMAIL_REAUTH_REQUIRED");
    }
    if (!user.email || !recoveryEmailSchema.safeParse(user.email).success) {
      throw new AuthAccountError(400, "账号没有可验证的注册邮箱，请使用绑定手机", "EMAIL_REQUIRED");
    }
    return this.send(user.email, "email_verify", user);
  }

  async sendRecovery(email: string) {
    const user = await this.repository.emailUser({ email });
    // All valid addresses get the same delivery flow; receiving a code does not prove account eligibility.
    return this.send(email, "email_recovery", user && user.email_verified_at && !user.is_disabled ? user : null);
  }

  private async send(email: string, purpose: EmailPurpose, user: EmailUser | null) {
    this.mailer.assertConfigured();
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.repository.createEmailChallenge({ id, email, purpose, userId: user?.id ?? null,
      sessionVersion: user?.session_version ?? null, codeHash: this.codeHash(id, purpose, code),
      expiresAt: new Date(Date.now() + 300_000).toISOString() });
    try {
      await this.mailer.send(email, code, purpose);
      await this.repository.finishEmailDelivery(id, true);
    } catch {
      await this.repository.finishEmailDelivery(id, false);
      throw new AuthAccountError(503, "邮件发送失败，请稍后重试或使用其他恢复方式", "EMAIL_DELIVERY_FAILED");
    }
    return { challengeId: id, resendAfter: 60, expiresIn: 300 };
  }

  async verify(id: string, code: string, purpose: EmailPurpose, userId?: number) {
    const secret = randomBytes(32).toString("base64url");
    // Email recovery has its own hash domain; the repository binds it to the account and challenge.
    const recoveryHash = hashPasswordRecoveryToken(`email:${secret}`);
    const verifiedUser = await this.repository.verifyEmailChallenge({ id, purpose, userId,
      codeHash: this.codeHash(id, purpose, code), recoveryHash,
      recoveryExpiresAt: new Date(Date.now() + 300_000).toISOString() });
    if (verifiedUser === null) throw new AuthAccountError(400, "验证码错误或已失效，或账号不具备恢复条件", "EMAIL_CODE_INVALID");
    return purpose === "email_verify" ? { success: true as const } : { recoveryToken: `${verifiedUser}.${secret}`, expiresIn: 300 };
  }

  private codeHash(id: string, purpose: EmailPurpose, code: string) {
    return verificationSubjectHmac(`email-code:${id}:${purpose}:${code}`);
  }
}
