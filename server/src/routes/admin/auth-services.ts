import crypto from "node:crypto";
import { Router } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { authVerificationService } from "../../modules/authVerification/runtime.js";
import { sendError } from "../../utils/http.js";
import {
  decryptSubjectPhone,
  findOrCreateSmsSubject,
  getClientIp,
  getSmsServiceConfig,
  incrementDailyUsage,
  normalizeMainlandPhone,
  recordVerificationEvent,
  type VerificationSubjectRow,
} from "../../services/authVerification.js";
import { maskMainlandPhone, verificationSubjectHmac } from "../../services/authVerificationCrypto.js";
import { getSmsProvider, SMS_PROVIDER, smsCredentialsStatus } from "../../services/smsVerificationProvider.js";
import { dateKeyAfterDays } from "../../utils/date.js";
import { auditAdminAction } from "./shared.js";

const SETTINGS: Record<string, string> = {
  enabled: "auth.sms.enabled",
  signName: "auth.sms.sign_name",
  templateCode: "auth.sms.template_code",
  packageTotal: "auth.sms.package_total",
  packageBaselineRemaining: "auth.sms.package_baseline_remaining",
  packageBaselineAt: "auth.sms.package_baseline_at",
  phoneHourlyLimit: "auth.sms.limit.phone_hour",
  phoneDailyLimit: "auth.sms.limit.phone_day",
  ipHourlyLimit: "auth.sms.limit.ip_hour",
  ipDailyLimit: "auth.sms.limit.ip_day",
  globalDailyLimit: "auth.sms.limit.global_day",
};

function eventSubject(row: Record<string, unknown>): VerificationSubjectRow {
  return {
    id: Number(row.subjectId),
    user_id: row.userId == null ? null : Number(row.userId),
    subject_hmac: String(row.subjectHmac),
    subject_ciphertext: String(row.subjectCiphertext),
    subject_iv: String(row.subjectIv),
    subject_auth_tag: String(row.subjectAuthTag),
  };
}

export function createAdminAuthServicesRouter() {
  const router = Router();

  router.get("/auth-services/sms/config", async (_req, res) => {
    const [config, recent] = await Promise.all([getSmsServiceConfig(), authVerificationService().recentSendEvent()]);
    const credentials = smsCredentialsStatus();
    return res.json({
      ...config,
      provider: SMS_PROVIDER,
      endpoint: process.env.ALIYUN_DYPNS_ENDPOINT?.trim() || "dypnsapi.aliyuncs.com",
      credentials,
      callbackConfigured: Boolean(process.env.ALIYUN_SMS_CALLBACK_TOKEN?.trim()),
      auditEncryptionConfigured: Boolean(process.env.AUTH_AUDIT_ENCRYPTION_KEY?.trim()),
      fixedParameters: { countryCode: "86", codeLength: 6, validTime: 300, interval: 60, duplicatePolicy: 1, returnVerifyCode: false },
      recent,
    });
  });

  router.put("/auth-services/sms/config", async (req: AuthRequest, res) => {
    const body = req.body || {};
    const allowed = ["enabled", "signName", "templateCode", "packageTotal", "phoneHourlyLimit", "phoneDailyLimit", "ipHourlyLimit", "ipDailyLimit", "globalDailyLimit"];
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) return sendError(res, 400, `不支持的配置项：${key}`, "INVALID_SMS_CONFIG");
    }
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return sendError(res, 400, "服务开关格式无效", "INVALID_SMS_CONFIG");
    if (body.enabled === true && !smsCredentialsStatus().configured) {
      return sendError(res, 409, "请先在部署环境配置阿里云 AccessKey", "SMS_CREDENTIALS_REQUIRED");
    }
    if (body.enabled === true && !process.env.AUTH_AUDIT_ENCRYPTION_KEY?.trim()) {
      return sendError(res, 409, "请先在部署环境配置认证审计加密密钥", "SMS_AUDIT_KEY_REQUIRED");
    }
    for (const key of ["signName", "templateCode"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > 100)) {
        return sendError(res, 400, `${key} 格式无效`, "INVALID_SMS_CONFIG");
      }
    }
    for (const key of ["packageTotal", "phoneHourlyLimit", "phoneDailyLimit", "ipHourlyLimit", "ipDailyLimit", "globalDailyLimit"]) {
      if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < (key === "packageTotal" ? 0 : 1) || body[key] > 1_000_000)) {
        return sendError(res, 400, `${key} 格式无效`, "INVALID_SMS_CONFIG");
      }
    }
    await authVerificationService().saveSettings(allowed.filter((key) => body[key] !== undefined).map((key) => ({
      key: SETTINGS[key]!, value: key === "enabled" ? (body[key] ? "1" : "0") : String(body[key]).trim(),
    })));
    await auditAdminAction(req, {
      action: "auth.sms.config.update",
      resourceType: "auth_service",
      resourceId: "sms",
      summary: "更新短信认证服务配置",
      details: { fields: Object.keys(body) },
    });
    return res.json({ success: true, config: await getSmsServiceConfig() });
  });

  router.post("/auth-services/sms/test-send", async (req: AuthRequest, res) => {
    const phone = normalizeMainlandPhone(req.body?.phone);
    if (!phone) return sendError(res, 400, "请输入有效的中国大陆手机号", "INVALID_PHONE");
    const config = await getSmsServiceConfig();
    if (!config.enabled) return sendError(res, 409, "请先启用短信认证服务", "SMS_SERVICE_DISABLED");
    if (!smsCredentialsStatus().configured) return sendError(res, 503, "阿里云密钥未在部署环境中配置", "SMS_SERVICE_NOT_CONFIGURED");
    const subject = await findOrCreateSmsSubject(phone);
    const challengeId = crypto.randomUUID();
    const outId = `test_${crypto.randomUUID().replace(/-/g, "")}`;
    const sourceIp = getClientIp(req);
    await authVerificationService().createChallenge({ id: challengeId, subjectId: subject.id, purpose: "admin_test", outId,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), sourceIp, userAgent: req.get("user-agent") || null });
    await incrementDailyUsage("send_requests");
    await incrementDailyUsage("send_api_calls");
    await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "send_api_called", outcome: "admin_test", sourceIp, userAgent: req.get("user-agent"), outId });
    try {
      const result = await getSmsProvider().send(phone, outId, config);
      await authVerificationService().updateTestChallenge(challengeId, result.success ? "accepted" : "failed", result.bizId, result.requestId);
      await incrementDailyUsage(result.success ? "accepted" : "provider_errors");
      await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: result.success ? "send_accepted" : "send_rejected", outcome: result.success ? "accepted" : "provider_error", providerCode: result.code, providerMessage: result.message, providerRequestId: result.requestId, bizId: result.bizId, outId, sourceIp, userAgent: req.get("user-agent") });
      await auditAdminAction(req, { action: "auth.sms.test_send", resourceType: "auth_service", resourceId: challengeId, summary: `测试发送短信至 ${maskMainlandPhone(phone)}`, details: { success: result.success, providerCode: result.code } });
      if (!result.success) {
        const providerMessage = result.message.replace(/\b1[3-9]\d{9}\b/g, "[phone]").slice(0, 300);
        return sendError(
          res,
          502,
          `测试短信发送失败：${result.code}${providerMessage ? ` · ${providerMessage}` : ""}`,
          "SMS_PROVIDER_REJECTED",
        );
      }
      return res.json({ success: true, challengeId, phoneMasked: maskMainlandPhone(phone), bizId: result.bizId, requestId: result.requestId });
    } catch (error) {
      const providerErrorName = error instanceof Error ? error.name : "UNKNOWN_ERROR";
      const providerErrorMessage = error instanceof Error
        ? error.message.replace(/\b1[3-9]\d{9}\b/g, "[phone]").slice(0, 500)
        : "Unknown SMS provider error";
      console.error("[SMS test send error]", {
        name: providerErrorName,
        message: providerErrorMessage,
        stack: error instanceof Error
          ? error.stack?.replace(/\b1[3-9]\d{9}\b/g, "[phone]").split("\n").slice(0, 8).join("\n")
          : undefined,
      });
      await authVerificationService().failChallenge(challengeId);
      await incrementDailyUsage("provider_errors");
      await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "send_failed", outcome: "provider_error", providerCode: providerErrorName, providerMessage: providerErrorMessage, outId, sourceIp, userAgent: req.get("user-agent") });
      return sendError(res, 502, `测试短信发送失败：${providerErrorMessage}`, "SMS_PROVIDER_UNAVAILABLE");
    }
  });

  router.get("/auth-services/sms/overview", async (req, res) => {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    const firstUsageDate = dateKeyAfterDays(-(days - 1));
    const config = await getSmsServiceConfig();
    const [{ totals, daily }, usedSinceBaseline, attacks] = await Promise.all([
      authVerificationService().usageOverview(firstUsageDate),
      authVerificationService().usedSince(config.packageBaselineAt),
      authVerificationService().attacks(new Date(Date.now() - days * 24 * 60 * 60_000).toISOString()),
    ]);
    return res.json({
      days,
      totals,
      daily,
      attacks,
      package: {
        total: config.packageTotal,
        baselineRemaining: config.packageBaselineRemaining,
        baselineAt: config.packageBaselineAt,
        usedSinceBaseline,
        estimatedRemaining: Math.max(0, config.packageBaselineRemaining - usedSinceBaseline),
      },
    });
  });

  router.get("/auth-services/sms/events", async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(10, Math.min(100, Number(req.query.pageSize) || 20));
    const stringFilter = (name: string) => typeof req.query[name] === "string" ? String(req.query[name]).trim() : "";
    const userId = stringFilter("userId");
    const username = stringFilter("username");
    const phone = stringFilter("phone");
    const ip = stringFilter("ip");
    const outcome = stringFilter("outcome");
    const providerId = stringFilter("providerId");
    const filters: { userId?: number; username?: string; subjectHmac?: string; ip?: string; outcome?: string; providerId?: string } = {};
    if (userId) filters.userId = Number(userId) || -1;
    if (username) filters.username = username;
    if (phone) {
      const normalized = normalizeMainlandPhone(phone);
      if (!normalized) return sendError(res, 400, "完整手机号格式无效", "INVALID_PHONE_FILTER");
      filters.subjectHmac = verificationSubjectHmac(normalized);
    }
    if (ip) filters.ip = ip;
    if (outcome) filters.outcome = outcome;
    if (providerId) filters.providerId = providerId;
    const { rows, total } = await authVerificationService().events(filters, page, pageSize);
    const items = rows.map((row) => {
      const phoneMasked = maskMainlandPhone(decryptSubjectPhone(eventSubject(row)));
      const { subjectHmac: _h, subjectCiphertext: _c, subjectIv: _i, subjectAuthTag: _t, ...safe } = row;
      return { ...safe, phoneMasked, userStatus: row.userId == null ? "unregistered"
        : row.userDisabled === 1 || row.userDisabled === true ? "disabled" : "active" };
    });
    return res.json({ items, total, page, pageSize });
  });

  router.post("/auth-services/sms/events/:id/reveal-phone", async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "事件 ID 无效", "INVALID_EVENT_ID");
    const row = await authVerificationService().eventSubject(id);
    if (!row) return sendError(res, 404, "认证事件不存在", "AUTH_EVENT_NOT_FOUND");
    const phone = decryptSubjectPhone(eventSubject(row));
    await auditAdminAction(req, {
      action: "auth.sms.phone.reveal",
      resourceType: "auth_verification_event",
      resourceId: id,
      summary: `查看认证事件 ${id} 的完整手机号`,
      details: { subjectId: row.subjectId, userId: row.userId || null },
    });
    return res.json({ eventId: id, phone });
  });

  router.post("/auth-services/sms/package/reconcile", async (req: AuthRequest, res) => {
    const remaining = Number(req.body?.remaining);
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > 10_000_000) {
      return sendError(res, 400, "套餐剩余量格式无效", "INVALID_PACKAGE_REMAINING");
    }
    const nowIso = new Date().toISOString();
    await authVerificationService().saveSettings([
      { key: SETTINGS.packageBaselineRemaining, value: String(remaining) },
      { key: SETTINGS.packageBaselineAt, value: nowIso },
    ]);
    await auditAdminAction(req, { action: "auth.sms.package.reconcile", resourceType: "auth_service", resourceId: "sms", summary: `校准短信套餐剩余量为 ${remaining}`, details: { remaining } });
    return res.json({ success: true, remaining, reconciledAt: nowIso });
  });

  return router;
}
