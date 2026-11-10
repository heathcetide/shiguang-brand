import nodemailer from "nodemailer";
import { recoveryEmailSchema } from "@dietdigidose/contracts";
import { AuthAccountError } from "../modules/authAccount/errors.js";
import type { EmailPurpose, VerificationMailer } from "../modules/authAccount/emailVerification.js";

function configuration() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !recoveryEmailSchema.safeParse(from).success) {
    throw new AuthAccountError(503, "邮箱验证服务尚未配置，请使用手机或人工恢复", "EMAIL_UNAVAILABLE");
  }
  return { host, port, user, pass, from: from! };
}

export const verificationMailer: VerificationMailer = {
  assertConfigured() { configuration(); },
  async send(email: string, code: string, purpose: EmailPurpose) {
    const { host, port, user, pass, from } = configuration();
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: true,
      auth: { user, pass }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
    const action = purpose === "email_verify" ? "验证注册邮箱" : "找回密码";
    const result = await transport.sendMail({ from: { name: "食光烙记", address: from }, to: { address: email, name: "" },
      subject: `食光烙记${action}验证码`,
      text: `你的${action}验证码是 ${code}，5 分钟内有效。不要向他人提供此验证码。收到验证码不代表账号具备恢复条件；非本人操作请忽略。` });
    if (!result.accepted.length || result.rejected.length) throw new Error("EMAIL_REJECTED");
  },
};
