import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { clearLoginFailures, loginRateLimit, recordLoginFailure } from "../../middleware/loginRateLimit.js";
import { getRateLimitClientIp, sharedRateLimit } from "../../middleware/sharedRateLimit.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import { changePasswordSchema, loginSchema, profileSchema, registerSchema } from "../../validation/schemas.js";
import { ACCOUNT_SECURITY_CAPABILITY, accountDeletionSchema, passwordRecoveryResetSchema, setAccountPasswordSchema,
  emailVerificationSendSchema, emailVerificationCodeSchema, emailRecoverySendSchema } from "@dietdigidose/contracts";
import type { EmailVerificationService } from "./emailVerification.js";
import { AuthAccountError } from "./errors.js";
import type { AuthAccountService } from "./service.js";

const windowMs = Math.max(1_000, Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000);
const registrationIpRateLimit = sharedRateLimit({ namespace: "registration-ip", limit: Math.max(1, Number(process.env.REGISTER_RATE_LIMIT) || 12),
  windowMs, key: getRateLimitClientIp, message: "注册请求过于频繁，请稍后重试", code: "REGISTER_RATE_LIMITED" });
const registrationGlobalRateLimit = sharedRateLimit({ namespace: "registration-global", limit: Math.max(1, Number(process.env.REGISTER_GLOBAL_RATE_LIMIT) || 500),
  windowMs, key: () => "all", message: "注册服务当前请求过多，请稍后重试", code: "REGISTER_RATE_LIMITED" });

function known(error: unknown, res: Response) {
  if (!(error instanceof AuthAccountError)) return false;
  if (error.code) sendError(res, error.status, error.message, error.code);
  else res.status(error.status).json({ error: error.message });
  return true;
}

function handle(error: unknown, res: Response, next: NextFunction) {
  if (!known(error,res)) next(error);
}

export function createAuthAccountRouter(service: AuthAccountService, email?: EmailVerificationService) {
  const router = Router();
  const emailLimit = (namespace: string, limit: number, key: (req: AuthRequest) => string, windowMs = 15 * 60_000) => sharedRateLimit({
    namespace: `email-${namespace}`, limit, windowMs, key, message: "邮箱验证请求过于频繁，请稍后重试", code: "EMAIL_RATE_LIMITED",
  });
  if (email) {
    const sendLimits = [emailLimit("send-ip", 20, getRateLimitClientIp), emailLimit("send-global", 500, () => "all")];
    router.post("/email-verification/send", authMiddleware, ...sendLimits,
      emailLimit("verify-send-user", 1, req => String(req.userId), 60_000), validateBody(emailVerificationSendSchema), async (req: AuthRequest,res,next) => {
        try { return res.json(await email.sendVerification(req.userId!,req.body.currentPassword)); }
        catch (error) { return handle(error,res,next); }
      });
    router.post("/email-verification/verify", authMiddleware, emailLimit("verify-ip", 30, getRateLimitClientIp),
      validateBody(emailVerificationCodeSchema), async (req: AuthRequest,res,next) => {
        try { return res.json(await email.verify(req.body.challengeId,req.body.code,"email_verify",req.userId!)); }
        catch (error) { return handle(error,res,next); }
      });
    router.post("/email-recovery/send", ...sendLimits, validateBody(emailRecoverySendSchema),
      emailLimit("recovery-address-cooldown", 1, req => req.body.email, 60_000),
      emailLimit("recovery-address", 5, req => req.body.email), async (req,res,next) => {
        try { return res.json(await email.sendRecovery(req.body.email)); }
        catch (error) { return handle(error,res,next); }
      });
    router.post("/email-recovery/verify", emailLimit("verify-ip", 30, getRateLimitClientIp),
      validateBody(emailVerificationCodeSchema), async (req,res,next) => {
        try { return res.json(await email.verify(req.body.challengeId,req.body.code,"email_recovery")); }
        catch (error) { return handle(error,res,next); }
      });
  }
  router.post("/register", registrationIpRateLimit, registrationGlobalRateLimit, validateBody(registerSchema), async (req, res) => {
    try { return res.status(201).json(await service.register(req.body.identifier, req.body.username, req.body.password)); }
    catch (error) { if (known(error, res)) return; console.error("Register error:", error); return sendError(res, 500, "注册失败", "REGISTER_FAILED"); }
  });
  router.post("/login", loginRateLimit, validateBody(loginSchema), async (req, res) => {
    try {
      const result = await service.login(req.body.identifier, req.body.password, getRateLimitClientIp(req), req.get("user-agent"));
      await clearLoginFailures(result.rawIdentifier); return res.json({ token: result.token, user: result.user });
    } catch (error) {
      if (error instanceof AuthAccountError && error.recordLoginFailure) await recordLoginFailure(req);
      if (known(error, res)) return;
      console.error("Login error:", error); return sendError(res, 500, "登录失败", "LOGIN_FAILED");
    }
  });
  router.get("/me", authMiddleware, (req: AuthRequest, res, next) => {
    void service.me(req.userId!).then((value) => {
      if (value.hasPassword === false && req.get("X-Account-Security") !== ACCOUNT_SECURITY_CAPABILITY) return sendError(res,426,"请更新应用后管理此账号","CLIENT_UPDATE_REQUIRED");
      return res.json(value);
    }).catch((error) => handle(error,res,next));
  });
  router.post("/password-recovery/reset", sharedRateLimit({ namespace: "password-recovery-reset", limit: 30, windowMs: 15 * 60_000,
    key: getRateLimitClientIp, message: "恢复请求过于频繁，请稍后重试", code: "PASSWORD_RECOVERY_RATE_LIMITED" }), validateBody(passwordRecoveryResetSchema), async (req,res,next) => {
    try { return res.json(await service.recoverPassword(req.body.recoveryToken, req.body.newPassword, req.body.channel)); }
    catch (error) { return handle(error,res,next); }
  });
  router.post("/password",authMiddleware,validateBody(setAccountPasswordSchema),async (req: AuthRequest,res) => {
    try { return res.json(await service.setPassword(req.userId!,req.body.newPassword,req.body.reauthToken)); }
    catch (error) { if (known(error,res)) return; console.error("Set password error:",error); return sendError(res,500,"设置密码失败","PASSWORD_SET_FAILED"); }
  });
  router.post("/change-password", authMiddleware, validateBody(changePasswordSchema), async (req: AuthRequest, res) => {
    try { return res.json(await service.changePassword(req.userId!, req.body.currentPassword, req.body.newPassword, req.ip, req.get("user-agent"))); }
    catch (error) { if (known(error, res)) return; console.error("Change password error:", error); return res.status(500).json({ error: "修改密码失败" }); }
  });
  router.put("/profile", authMiddleware, validateBody(profileSchema), async (req: AuthRequest, res) => {
    try { return res.json(await service.updateProfile(req.userId!, req.body)); }
    catch (error) { if (known(error, res)) return; console.error("Profile update error:", error); return sendError(res, 500, "更新资料失败", "PROFILE_UPDATE_FAILED"); }
  });
  router.get("/ai-data", authMiddleware, (req: AuthRequest, res, next) => {
    void service.exportAiData(req.userId!).then((value) => res.json(value)).catch(next);
  });
  router.delete("/ai-data", authMiddleware, (req: AuthRequest, res, next) => {
    void service.deleteAiData(req.userId!).then((value) => res.json(value)).catch(next);
  });
  router.delete("/account", authMiddleware, validateBody(accountDeletionSchema), async (req: AuthRequest, res) => {
    try { return res.json(await service.deleteAccount(req.userId!, req.body)); }
    catch (error) { if (known(error, res)) return; console.error("Delete account error:", error); return sendError(res, 500, "账号删除失败", "ACCOUNT_DELETE_FAILED"); }
  });
  return router;
}
