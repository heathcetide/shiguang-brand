import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { ACCOUNT_PASSWORD_REQUIREMENTS, accountPasswordSchema, ACCOUNT_SECURITY_CAPABILITY, reauthSendSchema, reauthVerifySchema, passwordRecoverySendSchema, passwordRecoveryVerifySchema, phoneBindingSendSchema, phoneBindingVerifySchema, phoneReplacementSendSchema, phoneReplacementVerifySchema, type ReauthPurpose } from "@dietdigidose/contracts";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import type { ReauthUser } from "../modules/authVerification/types.js";
import bcrypt from "bcryptjs";
import { sendError } from "../utils/http.js";
import { ensureUserInitialState, recordFunnelEvent, signUserToken } from "../modules/accessControl/index.js";
import { authVerificationService } from "../modules/authVerification/runtime.js";
import {
  countIpSends,
  countSubjectSends,
  currentGlobalDailySends,
  decryptSubjectPhone,
  findOrCreateSmsSubject,
  getClientIp,
  getSmsServiceConfig,
  incrementDailyUsage,
  maskedSubjectPhone,
  normalizeMainlandPhone,
  recordVerificationEvent,
  type VerificationSubjectRow,
} from "../services/authVerification.js";
import { hashPasswordRecoveryToken, hashRegistrationToken } from "../services/authVerificationCrypto.js";
import { getSmsProvider, smsCredentialsStatus } from "../services/smsVerificationProvider.js";

import { getRateLimitClientIp, sharedRateLimit } from "../middleware/sharedRateLimit.js";

const router = Router();
export const passwordRecoveryRouter = Router();
type SmsPurpose = "login" | ReauthPurpose | "password_recovery" | "phone_bind" | "phone_replace";
export const phoneBindingRouter = Router();
const recoveryRateLimit = (namespace: string, limit: number, key: (req: Request) => string = getRateLimitClientIp) =>
  sharedRateLimit({ namespace: `password-recovery-${namespace}`, limit, windowMs: 15 * 60_000, key,
    message: "恢复请求过于频繁，请稍后重试", code: "PASSWORD_RECOVERY_RATE_LIMITED" });
export const reauthRouter = Router();

type ChallengeRow = {
  id: string;
  subject_id: number;
  purpose: string;
  out_id: string;
  biz_id: string | null;
  status: string;
  attempt_count: number;
  expires_at: string;
  registration_expires_at: string | null;
  user_id: number | null;
  subject_hmac: string;
  subject_ciphertext: string;
  subject_iv: string;
  subject_auth_tag: string;
  reauth_user_id?: number | null;
  reauth_session_version?: number | null;
};

function challengeSubject(row: ChallengeRow): VerificationSubjectRow {
  return {
    id: row.subject_id,
    user_id: row.user_id,
    subject_hmac: row.subject_hmac,
    subject_ciphertext: row.subject_ciphertext,
    subject_iv: row.subject_iv,
    subject_auth_tag: row.subject_auth_tag,
  };
}

async function sendSms(req: Request, res: Response, purpose: SmsPurpose = "login", boundUser?: ReauthUser) {
  const phone = normalizeMainlandPhone(boundUser?.phone ?? req.body?.phone);
  if (!phone) return sendError(res, 400, "请输入有效的中国大陆手机号", "INVALID_PHONE");

  const config = await getSmsServiceConfig();
  if (!config.enabled) return sendError(res, 503, "短信认证服务暂未启用", "SMS_SERVICE_DISABLED");
  if (!smsCredentialsStatus().configured) {
    return sendError(res, 503, "短信认证服务尚未完成密钥配置", "SMS_SERVICE_NOT_CONFIGURED");
  }

  const sourceIp = getClientIp(req);
  const userAgent = req.get("user-agent") || null;
  const subject = await findOrCreateSmsSubject(phone);
  await incrementDailyUsage("send_requests");
  await recordVerificationEvent({
    subjectId: subject.id,
    eventType: "send_requested",
    outcome: "received",
    sourceIp,
    userAgent,
  });

  const [subjectHour, subjectDay, ipHour, ipDay, globalDay] = await Promise.all([
    countSubjectSends(subject.id, "-1 hour"), countSubjectSends(subject.id, "-1 day"),
    countIpSends(sourceIp, "-1 hour"), countIpSends(sourceIp, "-1 day"), currentGlobalDailySends(),
  ]);
  const limited = subjectHour >= config.phoneHourlyLimit || subjectDay >= config.phoneDailyLimit
    || ipHour >= config.ipHourlyLimit || ipDay >= config.ipDailyLimit || globalDay >= config.globalDailyLimit;
  if (limited) {
    await incrementDailyUsage("local_rate_limited");
    await recordVerificationEvent({
      subjectId: subject.id,
      eventType: "send_rate_limited",
      outcome: "blocked",
      sourceIp,
      userAgent,
    });
    res.setHeader("Retry-After", "3600");
    return sendError(res, 429, "验证码请求过于频繁，请稍后再试", "SMS_RATE_LIMITED");
  }

  const challengeId = crypto.randomUUID();
  const outId = `sms_${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  await authVerificationService().createChallenge({ id: challengeId, subjectId: subject.id, purpose,
    outId, expiresAt, sourceIp, userAgent, reauthUserId: boundUser?.id, reauthSessionVersion: boundUser?.session_version });
  await incrementDailyUsage("send_api_calls");
  await recordVerificationEvent({
    subjectId: subject.id,
    challengeId,
    eventType: "send_api_called",
    outcome: "pending",
    sourceIp,
    userAgent,
    outId,
  });

  try {
    const result = await getSmsProvider().send(phone, outId, config);
    if (!result.success) {
      await authVerificationService().failChallenge(challengeId);
      await incrementDailyUsage("provider_errors");
      await recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "send_rejected",
        outcome: "provider_error",
        providerCode: result.code,
        providerMessage: purpose === "password_recovery" || purpose === "phone_bind" || purpose === "phone_replace" ? undefined : result.message,
        providerRequestId: result.requestId,
        bizId: result.bizId,
        outId,
        sourceIp,
        userAgent,
      });
      return sendError(res, 502, "短信发送失败，请稍后重试", "SMS_PROVIDER_REJECTED");
    }

    await authVerificationService().acceptChallenge(challengeId, subject.id, result.bizId, result.requestId);
    await incrementDailyUsage("accepted");
    await recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "send_accepted",
        outcome: "accepted",
        providerCode: result.code,
        providerMessage: purpose === "password_recovery" || purpose === "phone_bind" || purpose === "phone_replace" ? undefined : result.message,
        providerRequestId: result.requestId,
        bizId: result.bizId,
        outId,
        sourceIp,
        userAgent,
      });
    return res.status(201).json({
      challengeId,
      phoneMasked: maskedSubjectPhone(subject),
      expiresIn: 300,
      resendAfter: 60,
    });
  } catch (error) {
    await authVerificationService().failChallenge(challengeId);
    await incrementDailyUsage("provider_errors");
    await recordVerificationEvent({
      subjectId: subject.id,
      challengeId,
      eventType: "send_failed",
      outcome: "provider_error",
      providerCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      outId,
      sourceIp,
      userAgent,
    });
    console.error("[SMS Provider Error]", error instanceof Error ? error.name : "UnknownError");
    return sendError(res, 502, "短信发送失败，请稍后重试", "SMS_PROVIDER_UNAVAILABLE");
  }
}
router.post("/send", (req,res,next) => { void sendSms(req,res).catch(next); });

async function verifySms(req: Request, res: Response, purpose: SmsPurpose = "login", boundUser?: ReauthUser) {
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!challengeId || !/^\d{6}$/.test(code)) {
    return sendError(res, 400, "请输入 6 位数字验证码", "INVALID_VERIFICATION_INPUT");
  }

  const challenge = await authVerificationService().challenge(challengeId) as ChallengeRow | null;
  if (!challenge) return sendError(res, 404, "验证码请求不存在", "SMS_CHALLENGE_NOT_FOUND");
  if (challenge.purpose !== purpose) return sendError(res, 403, "验证码用途不匹配，请重新获取", "SMS_CHALLENGE_PURPOSE_MISMATCH");
  if (purpose !== "login" && purpose !== "password_recovery" && (!boundUser || challenge.reauth_user_id !== boundUser.id || challenge.reauth_session_version !== boundUser.session_version
    || decryptSubjectPhone(challengeSubject(challenge)) !== boundUser.phone)) return sendError(res,403,"身份验证已失效，请重新获取","REAUTH_REQUIRED");

  const sourceIp = getClientIp(req);
  const userAgent = req.get("user-agent") || null;
  if (challenge.attempt_count >= 5) {
    return sendError(res, 429, "验证码尝试次数过多，请重新获取", "SMS_VERIFY_LIMITED");
  }
  if (!["accepted", "pending"].includes(challenge.status)) {
    return sendError(res, 409, "该验证码已失效，请重新获取", "SMS_CHALLENGE_NOT_ACTIVE");
  }
  if (Date.parse(challenge.expires_at) <= Date.now()) {
    await authVerificationService().expireChallenge(challengeId);
    await recordVerificationEvent({ subjectId: challenge.subject_id, challengeId, eventType: "verify_rejected", outcome: "expired", sourceIp, userAgent, outId: challenge.out_id });
    return sendError(res, 410, "验证码已过期，请重新获取", "SMS_CODE_EXPIRED");
  }
  if (!await authVerificationService().beginVerification(challengeId)) {
    return sendError(res, 429, "验证码尝试次数过多，请重新获取", "SMS_VERIFY_LIMITED");
  }

  const subject = challengeSubject(challenge);
  const phone = decryptSubjectPhone(subject);
  await incrementDailyUsage("verify_api_calls");
  await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_api_called", outcome: "pending", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });

  try {
    const result = await getSmsProvider().verify(phone, challenge.out_id, code);
    if (!result.success) {
      await authVerificationService().restoreVerification(challengeId);
      await incrementDailyUsage("provider_errors");
      await recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "verify_failed",
        outcome: "provider_error",
        providerCode: result.code,
        providerMessage: purpose === "password_recovery" || purpose === "phone_bind" || purpose === "phone_replace" ? undefined : result.message,
        sourceIp,
        userAgent,
        outId: challenge.out_id,
        bizId: challenge.biz_id,
      });
      return sendError(res, 502, "验证码核验服务暂时不可用", "SMS_VERIFY_UNAVAILABLE");
    }
    if (!result.passed) {
      await authVerificationService().rejectVerification(challengeId);
      await incrementDailyUsage("verify_failed");
      await recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "verify_failed",
        outcome: "mismatch",
        providerCode: result.code,
        providerMessage: purpose === "password_recovery" || purpose === "phone_bind" || purpose === "phone_replace" ? undefined : result.message,
        sourceIp,
        userAgent,
        outId: challenge.out_id,
        bizId: challenge.biz_id,
      });
      return sendError(res, purpose === "login" ? 401 : 400, "验证码错误或已失效", "SMS_CODE_INVALID");
    }

    await incrementDailyUsage("verify_passed");
    if (purpose === "phone_bind") {
      if (!boundUser) return sendError(res,403,"绑定验证已失效","PHONE_BINDING_INVALID");
      const result = await authVerificationService().bindPhone({ userId: boundUser.id,
        sessionVersion: boundUser.session_version, challengeId, phone });
      if (result !== "bound") {
        await authVerificationService().failChallenge(challengeId);
        return sendError(res, result === "phone_exists" ? 409 : 403,
          "绑定已失效或手机号已被占用，请重新验证", result === "phone_exists" ? "PHONE_EXISTS" : "PHONE_BINDING_INVALID");
      }
      return res.json({ success: true, phoneMasked: maskedSubjectPhone(subject) });
    }
    if (purpose === "phone_replace") {
      if (!boundUser) return sendError(res,403,"换绑验证已失效","PHONE_REPLACEMENT_INVALID");
      const result = await authVerificationService().replacePhone({ userId: boundUser.id,
        sessionVersion: boundUser.session_version, challengeId, phone });
      if (result !== "replaced") {
        await authVerificationService().failChallenge(challengeId);
        return sendError(res, result === "phone_exists" ? 409 : 403,
          "换绑已失效或手机号已被占用，请重新验证", result === "phone_exists" ? "PHONE_EXISTS" : "PHONE_REPLACEMENT_INVALID");
      }
      return res.json({ success: true, phoneMasked: maskedSubjectPhone(subject) });
    }
    if (purpose === "password_recovery") {
      if (!boundUser || !boundUser.phone_verified_at || boundUser.is_disabled || challenge.reauth_user_id !== boundUser.id
        || challenge.reauth_session_version !== boundUser.session_version || phone !== boundUser.phone) {
        await authVerificationService().failChallenge(challengeId);
        return sendError(res, 400, "无法完成恢复，请重新验证或联系邀请你的管理员", "PASSWORD_RECOVERY_INVALID");
      }
      const recoveryToken = `${boundUser.id}.${crypto.randomBytes(32).toString("base64url")}`;
      const issued = await authVerificationService().issueReauthGrant({ challengeId, challengePurpose: "password_recovery",
        userId: boundUser.id, purpose: "password_update", phone, sessionVersion: boundUser.session_version,
        tokenHash: hashPasswordRecoveryToken(recoveryToken), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
      if (!issued) return sendError(res, 400, "恢复凭据已失效，请重新验证手机号", "PASSWORD_RECOVERY_INVALID");
      await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "password_recovery", outcome: "verified", sourceIp, userAgent });
      return res.json({ recoveryToken, expiresIn: 300 });
    }
    if (purpose !== "login" && boundUser) {
      const reauthToken = crypto.randomBytes(32).toString("base64url");
      const issued = await authVerificationService().issueReauthGrant({ challengeId,userId:boundUser.id,purpose,phone,
        sessionVersion:boundUser.session_version,tokenHash:hashRegistrationToken(reauthToken),expiresAt:new Date(Date.now()+5*60_000).toISOString() });
      if (!issued) return sendError(res,403,"身份验证已失效，请重新获取","REAUTH_REQUIRED");
      await recordVerificationEvent({ subjectId:subject.id,challengeId,eventType:"reauth",outcome:"succeeded",sourceIp,userAgent,details:{purpose} });
      return res.json({reauthToken,expiresIn:300});
    }
    const user = await authVerificationService().userByPhone(phone);
    const nowIso = new Date().toISOString();
    if (user) {
      const userResponse = await authVerificationService().userResponse(user.id);
      if (userResponse?.hasPassword === false && req.get("X-Account-Security") !== ACCOUNT_SECURITY_CAPABILITY) {
        await authVerificationService().rejectVerification(challengeId);
        return sendError(res,426,"请更新应用后登录此账号","CLIENT_UPDATE_REQUIRED");
      }
      await authVerificationService().completeLogin({ userId: user.id, subjectId: subject.id, challengeId, at: nowIso, sourceIp });
      await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_passed", outcome: "passed", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
      await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "login", outcome: user.is_disabled ? "account_disabled" : "succeeded", sourceIp, userAgent });
      if (user.is_disabled === 1 || user.is_disabled === true) return sendError(res, 403, "账号已被停用", "ACCOUNT_DISABLED");
      await ensureUserInitialState(user.id);
      await recordFunnelEvent(user.id, "login_succeeded");
      return res.json({
        status: "authenticated",
        token: await signUserToken(user.id),
        user: await authVerificationService().userResponse(user.id),
        isNewUser: false,
      });
    }

    const registrationToken = crypto.randomBytes(32).toString("base64url");
    const registrationExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await authVerificationService().markRegistrationRequired({ challengeId, at: nowIso,
      tokenHash: hashRegistrationToken(registrationToken), expiresAt: registrationExpiresAt });
    // Roll back only automatic creation; existing passwordless accounts retain SMS login and account management.
    if (process.env.SMS_PASSWORDLESS_REGISTRATION_ENABLED !== "0"
      && req.body?.passwordlessRegistration === true && req.get("X-Account-Security") === ACCOUNT_SECURITY_CAPABILITY) {
      for (let attempt=0;attempt<5;attempt++) {
        const registered = await authVerificationService().register({ tokenHash:hashRegistrationToken(registrationToken),phone,
          username:`食光用户${crypto.randomBytes(5).toString("hex")}`,passwordHash:null,at:nowIso });
        if (registered.status === "username_exists") continue;
        if (registered.status !== "created") return sendError(res,409,"手机号状态已更新，请重新登录","REGISTRATION_RETRY_REQUIRED");
        await recordVerificationEvent({subjectId:subject.id,challengeId,eventType:"registration",outcome:"succeeded",sourceIp,userAgent});
        await recordFunnelEvent(registered.userId,"account_registered");
        return res.status(201).json({status:"authenticated",token:await signUserToken(registered.userId),
          user:await authVerificationService().userResponse(registered.userId),isNewUser:true});
      }
      return sendError(res,503,"账号创建繁忙，请稍后重试","REGISTER_RETRY_REQUIRED");
    }
    await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_passed", outcome: "registration_required", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
    return res.json({
      status: "registration_required",
      registrationToken,
      phoneMasked: maskedSubjectPhone(subject),
      expiresIn: 600,
    });
  } catch (error) {
    await authVerificationService().restoreVerification(challengeId);
    await incrementDailyUsage("provider_errors");
    await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_failed", outcome: "provider_error", providerCode: error instanceof Error ? error.name : "UNKNOWN_ERROR", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
    console.error("[SMS Verify Provider Error]", error instanceof Error ? error.name : "UnknownError");
    return sendError(res, 502, "验证码核验服务暂时不可用", "SMS_VERIFY_UNAVAILABLE");
  }
}
router.post("/verify", (req,res,next) => { void verifySms(req,res).catch(next); });

passwordRecoveryRouter.post("/send", recoveryRateLimit("send-ip", 10),
  recoveryRateLimit("send-phone", 3, (req) => normalizeMainlandPhone(req.body?.phone) || "invalid"), async (req,res,next) => {
  try {
    if (req.body?.email || (typeof req.body?.phone === "string" && req.body.phone.includes("@"))) {
      return sendError(res, 400, "当前暂不支持邮箱自助找回，请使用已绑定的手机号或联系管理员人工恢复", "EMAIL_RECOVERY_UNSUPPORTED");
    }
    const parsed = passwordRecoverySendSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请输入已绑定的中国大陆手机号","INVALID_PHONE");
    const existing = await authVerificationService().userByPhone(parsed.data.phone);
    const user = existing ? await authVerificationService().reauthUser(existing.id) : null;
    // Send a real SMS for every valid number: neither provider failures nor accepted sends reveal membership.
    // Only an already verified binding at send time can later issue a recovery proof.
    return await sendSms(req,res,"password_recovery",user?.phone_verified_at && !user.is_disabled ? user : undefined);
  } catch (error) { return next(error); }
});
passwordRecoveryRouter.post("/verify", recoveryRateLimit("verify-ip", 30), async (req,res,next) => {
  try {
    const parsed = passwordRecoveryVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请输入有效的验证码","INVALID_VERIFICATION_INPUT");
    const challenge = await authVerificationService().challenge(parsed.data.challengeId);
    const user = challenge?.reauth_user_id ? await authVerificationService().reauthUser(challenge.reauth_user_id) : null;
    return await verifySms(req,res,"password_recovery",user ?? undefined);
  } catch (error) { return next(error); }
});

phoneBindingRouter.use(authMiddleware);
phoneBindingRouter.use(sharedRateLimit({ namespace: "phone-binding-ip", key: getRateLimitClientIp, limit: 60, windowMs: 15 * 60_000,
  message: "绑定请求过于频繁，请稍后重试", code: "PHONE_BINDING_RATE_LIMITED" }));
phoneBindingRouter.post("/send", sharedRateLimit({ namespace: "phone-binding-password", limit: 5, windowMs: 15 * 60_000,
  key: (req) => String((req as AuthRequest).userId), message: "绑定请求过于频繁，请稍后重试", code: "PHONE_BINDING_RATE_LIMITED" }), async (req: AuthRequest,res,next) => {
  try {
    const parsed = phoneBindingSendSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请输入当前密码和有效的中国大陆手机号","INVALID_PHONE_BINDING_INPUT");
    const user = await authVerificationService().phoneBindingUser(req.userId!);
    if (!user || user.phone !== null || !user.email || !user.password_hash || user.role !== "user" || user.is_disabled)
      return sendError(res,403,"此账号不支持首次绑定手机号","PHONE_BINDING_INELIGIBLE");
    if (!await bcrypt.compare(parsed.data.currentPassword,user.password_hash))
      return sendError(res,403,"当前密码不正确","INVALID_PASSWORD");
    if (await authVerificationService().userByPhone(parsed.data.phone))
      return sendError(res,409,"该手机号已被使用","PHONE_EXISTS");
    return await sendSms(req,res,"phone_bind",{ ...user, phone: parsed.data.phone });
  } catch (error) { return next(error); }
});
phoneBindingRouter.post("/verify", async (req: AuthRequest,res,next) => {
  try {
    const parsed = phoneBindingVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请输入有效的验证码","INVALID_VERIFICATION_INPUT");
    const user = await authVerificationService().phoneBindingUser(req.userId!);
    if (!user || user.phone !== null || !user.email || !user.password_hash || user.role !== "user" || user.is_disabled)
      return sendError(res,403,"此账号不支持首次绑定手机号","PHONE_BINDING_INELIGIBLE");
    const challenge = await authVerificationService().challenge(parsed.data.challengeId);
    if (!challenge || challenge.purpose !== "phone_bind" || challenge.reauth_user_id !== user.id || challenge.reauth_session_version !== user.session_version)
      return sendError(res,403,"绑定验证已失效，请重新获取","PHONE_BINDING_INVALID");
    return await verifySms(req,res,"phone_bind",{ ...user, phone: decryptSubjectPhone(challengeSubject(challenge)) });
  } catch (error) { return next(error); }
});
phoneBindingRouter.post("/replace/send", sharedRateLimit({ namespace: "phone-replace-password", limit: 5, windowMs: 15 * 60_000,
  key: (req) => String((req as AuthRequest).userId), message: "换绑请求过于频繁，请稍后重试", code: "PHONE_REPLACEMENT_RATE_LIMITED" }), async (req: AuthRequest,res,next) => {
  try {
    const parsed = phoneReplacementSendSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请输入当前密码和有效的中国大陆新手机号","INVALID_PHONE_REPLACEMENT_INPUT");
    const user = await authVerificationService().phoneBindingUser(req.userId!);
    if (!user || user.phone === null || !user.phone_verified_at || !user.password_hash || user.role !== "user" || user.is_disabled)
      return sendError(res,403,"此账号不支持更换绑定手机号","PHONE_REPLACEMENT_INELIGIBLE");
    if (!await bcrypt.compare(parsed.data.currentPassword,user.password_hash))
      return sendError(res,403,"当前密码不正确","INVALID_PASSWORD");
    if (parsed.data.newPhone === user.phone)
      return sendError(res,400,"新手机号不能与当前绑定的手机号相同","PHONE_UNCHANGED");
    if (await authVerificationService().userByPhone(parsed.data.newPhone))
      return sendError(res,409,"该手机号已被使用","PHONE_EXISTS");
    return await sendSms(req,res,"phone_replace",{ ...user, phone: parsed.data.newPhone });
  } catch (error) { return next(error); }
});
phoneBindingRouter.post("/replace/verify", async (req: AuthRequest,res,next) => {
  try {
    const parsed = phoneReplacementVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请输入有效的验证码","INVALID_VERIFICATION_INPUT");
    const user = await authVerificationService().phoneBindingUser(req.userId!);
    if (!user || user.phone === null || !user.phone_verified_at || !user.password_hash || user.role !== "user" || user.is_disabled)
      return sendError(res,403,"此账号不支持更换绑定手机号","PHONE_REPLACEMENT_INELIGIBLE");
    const challenge = await authVerificationService().challenge(parsed.data.challengeId);
    if (!challenge || challenge.purpose !== "phone_replace" || challenge.reauth_user_id !== user.id || challenge.reauth_session_version !== user.session_version)
      return sendError(res,403,"换绑验证已失效，请重新获取","PHONE_REPLACEMENT_INVALID");
    return await verifySms(req,res,"phone_replace",{ ...user, phone: decryptSubjectPhone(challengeSubject(challenge)) });
  } catch (error) { return next(error); }
});

reauthRouter.use(authMiddleware);
reauthRouter.post("/send",async (req: AuthRequest,res,next) => {
  try {
    const parsed = reauthSendSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请选择有效的验证用途","INVALID_REAUTH_PURPOSE");
    const user = await authVerificationService().reauthUser(req.userId!);
    if (!user?.phone || !user.phone_verified_at || user.is_disabled) return sendError(res,403,"此账号没有可用的已验证手机号","VERIFIED_PHONE_REQUIRED");
    if (parsed.data.purpose === "account_delete" && user.role === "admin") return sendError(res,403,"管理员账号不能通过客户端注销","ADMIN_ACCOUNT_DELETE_FORBIDDEN");
    return await sendSms(req,res,parsed.data.purpose,user);
  } catch(error) { return next(error); }
});
reauthRouter.post("/verify",async (req: AuthRequest,res,next) => {
  try {
    const parsed = reauthVerifySchema.safeParse(req.body);
    if (!parsed.success) return sendError(res,400,"请输入有效的验证码","INVALID_VERIFICATION_INPUT");
    const user = await authVerificationService().reauthUser(req.userId!);
    if (!user?.phone || !user.phone_verified_at || user.is_disabled) return sendError(res,403,"此账号没有可用的已验证手机号","VERIFIED_PHONE_REQUIRED");
    return await verifySms(req,res,parsed.data.purpose,user);
  } catch(error) { return next(error); }
});

router.post("/register", async (req, res) => {
  const registrationToken = typeof req.body?.registrationToken === "string" ? req.body.registrationToken : "";
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (registrationToken.length < 32) return sendError(res, 400, "注册凭证无效", "INVALID_REGISTRATION_TOKEN");
  if (username.length < 2 || username.length > 30) return sendError(res, 400, "用户名长度应为 2 至 30 位", "INVALID_USERNAME");
  if (!accountPasswordSchema.safeParse(password).success) {
    return sendError(res, 400, ACCOUNT_PASSWORD_REQUIREMENTS, "INVALID_PASSWORD");
  }

  const tokenHash = hashRegistrationToken(registrationToken);
  const sourceIp = getClientIp(req);
  const userAgent = req.get("user-agent") || null;
  try {
    const challenge = await authVerificationService().registrationChallenge(tokenHash);
    if (!challenge) throw new Error("REGISTRATION_TOKEN_INVALID");
    const phone = decryptSubjectPhone(challengeSubject(challenge));
    const result = await authVerificationService().register({ tokenHash, phone, username,
      passwordHash: bcrypt.hashSync(password, bcrypt.genSaltSync(12)), at: new Date().toISOString() });
    if (result.status === "invalid_token") throw new Error("REGISTRATION_TOKEN_INVALID");
    if (result.status === "phone_exists") throw new Error("PHONE_EXISTS");
    if (result.status === "username_exists") throw new Error("USERNAME_EXISTS");
    const newUserId = result.userId;
    await recordVerificationEvent({ subjectId: challenge.subject_id, challengeId: challenge.id, eventType: "registration", outcome: "succeeded", sourceIp, userAgent });
    await recordFunnelEvent(newUserId, "account_registered");
    return res.status(201).json({
      token: await signUserToken(newUserId),
      user: await authVerificationService().userResponse(newUserId),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "USERNAME_EXISTS") return sendError(res, 409, "该用户名已被使用", "USERNAME_EXISTS");
    if (code === "PHONE_EXISTS") return sendError(res, 409, "该手机号已注册，请直接登录", "PHONE_EXISTS");
    if (code === "REGISTRATION_TOKEN_INVALID") return sendError(res, 401, "注册凭证已失效，请重新验证手机号", "REGISTRATION_TOKEN_INVALID");
    if (String(error).includes("UNIQUE constraint failed: users.phone")) return sendError(res, 409, "该手机号已注册，请直接登录", "PHONE_EXISTS");
    console.error("[SMS Registration Error]", error instanceof Error ? error.name : "UnknownError");
    return sendError(res, 500, "注册失败", "REGISTER_FAILED");
  }
});

export default router;
