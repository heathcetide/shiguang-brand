import { getProviderProfile } from "../../providers/profiles.js";
import {
  decryptVerificationSubject,
  encryptVerificationSubject,
  maskMainlandPhone,
  verificationSubjectHmac,
} from "../../services/authVerificationCrypto.js";
import { defaultSmsEnabled, SMS_PROVIDER, type SmsServiceConfig } from "../../services/smsVerificationProvider.js";
import { currentDateKey } from "../../utils/date.js";
import type { AuthVerificationRepository } from "./repository.js";
import type { DeliveryReport, EventFilters, UsageCounter, VerificationEventInput, VerificationSubject } from "./types.js";

export const SMS_SETTINGS = {
  enabled: "auth.sms.enabled", signName: "auth.sms.sign_name", templateCode: "auth.sms.template_code",
  packageTotal: "auth.sms.package_total", packageBaselineRemaining: "auth.sms.package_baseline_remaining",
  packageBaselineAt: "auth.sms.package_baseline_at", phoneHourlyLimit: "auth.sms.limit.phone_hour",
  phoneDailyLimit: "auth.sms.limit.phone_day", ipHourlyLimit: "auth.sms.limit.ip_hour",
  ipDailyLimit: "auth.sms.limit.ip_day", globalDailyLimit: "auth.sms.limit.global_day",
} as const;

const settingKeys = Object.values(SMS_SETTINGS);
function numberSetting(settings: Record<string, string>, key: string, fallback: number, min = 0, max = 1_000_000) {
  const value = Number(settings[key] ?? fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export class AuthVerificationService {
  private readonly repository: AuthVerificationRepository;
  constructor(repository: AuthVerificationRepository) { this.repository = repository; }

  async config(): Promise<SmsServiceConfig> {
    const settings = await this.repository.settings(settingKeys);
    return {
      enabled: getProviderProfile().providers.auth === SMS_PROVIDER
        && (settings[SMS_SETTINGS.enabled] ?? (defaultSmsEnabled() ? "1" : "0")) === "1",
      signName: settings[SMS_SETTINGS.signName] || process.env.ALIYUN_SMS_SIGN_NAME?.trim() || "恒创联众",
      templateCode: settings[SMS_SETTINGS.templateCode] || process.env.ALIYUN_SMS_TEMPLATE_CODE?.trim() || "100001",
      packageTotal: numberSetting(settings, SMS_SETTINGS.packageTotal, 1000, 0),
      packageBaselineRemaining: numberSetting(settings, SMS_SETTINGS.packageBaselineRemaining, 1000, 0),
      packageBaselineAt: settings[SMS_SETTINGS.packageBaselineAt] || null,
      phoneHourlyLimit: numberSetting(settings, SMS_SETTINGS.phoneHourlyLimit, 5, 1, 1000),
      phoneDailyLimit: numberSetting(settings, SMS_SETTINGS.phoneDailyLimit, 10, 1, 1000),
      ipHourlyLimit: numberSetting(settings, SMS_SETTINGS.ipHourlyLimit, 20, 1, 10000),
      ipDailyLimit: numberSetting(settings, SMS_SETTINGS.ipDailyLimit, 50, 1, 10000),
      globalDailyLimit: numberSetting(settings, SMS_SETTINGS.globalDailyLimit, 100, 1, 1_000_000),
    };
  }

  phoneBindingUser: AuthVerificationRepository["phoneBindingUser"] = (id) => this.repository.phoneBindingUser(id);
  bindPhone(input: Omit<import("./types.js").PhoneBindingInput, "subjectHmac">) {
    return this.repository.bindPhone({ ...input, subjectHmac: verificationSubjectHmac(input.phone) });
  }
  replacePhone(input: Omit<import("./types.js").PhoneReplacementInput, "subjectHmac">) {
    return this.repository.replacePhone({ ...input, subjectHmac: verificationSubjectHmac(input.phone) });
  }

  saveSettings(entries: Array<{ key: string; value: string }>) { return this.repository.saveSettings(entries); }

  async findOrCreateSubject(phone: string) {
    const encrypted = encryptVerificationSubject(phone);
    return this.repository.findOrCreateSubject({ provider: SMS_PROVIDER, subject_hmac: verificationSubjectHmac(phone),
      subject_ciphertext: encrypted.ciphertext, subject_iv: encrypted.iv, subject_auth_tag: encrypted.authTag });
  }

  decryptPhone(subject: VerificationSubject) {
    return decryptVerificationSubject({ ciphertext: subject.subject_ciphertext, iv: subject.subject_iv, authTag: subject.subject_auth_tag });
  }
  maskedPhone(subject: VerificationSubject) { return maskMainlandPhone(this.decryptPhone(subject)); }

  recordEvent(input: VerificationEventInput) {
    return this.repository.recordEvent(SMS_PROVIDER, { ...input,
      providerMessage: input.providerMessage?.replace(/\b1[3-9]\d{9}\b/g, "[phone]").slice(0, 500) || null,
      userAgent: input.userAgent?.slice(0, 500) || null });
  }
  incrementUsage(counter: UsageCounter, amount = 1) {
    return this.repository.incrementUsage(currentDateKey(), SMS_PROVIDER, counter, amount);
  }
  countSubjectSends(subjectId: number, since: string) { return this.repository.countSubjectSends(subjectId, since); }
  countIpSends(ip: string, since: string) { return this.repository.countIpSends(ip, since); }
  globalDailySends() { return this.repository.globalDailySends(currentDateKey(), SMS_PROVIDER); }
  createChallenge: AuthVerificationRepository["createChallenge"] = (input) => this.repository.createChallenge(input);
  failChallenge = (id: string) => this.repository.failChallenge(id);
  acceptChallenge = (id: string, subjectId: number, bizId: string | null, requestId: string | null) =>
    this.repository.acceptChallenge(id, subjectId, bizId, requestId);
  challenge = (id: string) => this.repository.challenge(id);
  expireChallenge = (id: string) => this.repository.expireChallenge(id);
  beginVerification = (id: string) => this.repository.beginVerification(id);
  restoreVerification = (id: string) => this.repository.restoreVerification(id);
  rejectVerification = (id: string) => this.repository.rejectVerification(id);
  userByPhone = (phone: string) => this.repository.userByPhone(phone);
  completeLogin: AuthVerificationRepository["completeLogin"] = (input) => this.repository.completeLogin(input);
  markRegistrationRequired: AuthVerificationRepository["markRegistrationRequired"] = (input) => this.repository.markRegistrationRequired(input);
  registrationChallenge = (tokenHash: string) => this.repository.registrationChallenge(tokenHash);
  register: AuthVerificationRepository["register"] = (input) => this.repository.register(input);
  reauthUser: AuthVerificationRepository["reauthUser"] = (userId) => this.repository.reauthUser(userId);
  issueReauthGrant: AuthVerificationRepository["issueReauthGrant"] = (input) => this.repository.issueReauthGrant(input);
  userResponse = async (id: number): Promise<Record<string,unknown> | null> => { const user = await this.repository.userResponse(id); return user ? {...user,hasPassword:Boolean(user.hasPassword)} : null; };
  recentSendEvent = () => this.repository.recentSendEvent();
  usageOverview = (firstDate: string) => this.repository.usageOverview(SMS_PROVIDER, firstDate);
  usedSince = (baselineAt: string | null) => this.repository.usedSince(SMS_PROVIDER, baselineAt);
  attacks = (since: string) => this.repository.attacks(since);
  events = (filters: EventFilters, page: number, pageSize: number) => this.repository.events(filters, page, pageSize);
  eventSubject = (id: number) => this.repository.eventSubject(id);
  updateTestChallenge = (id: string, status: string, bizId: string | null, requestId: string | null) =>
    this.repository.updateTestChallenge(id, status, bizId, requestId);
  recordDeliveryReport = (report: DeliveryReport) => this.repository.recordDeliveryReport(SMS_PROVIDER, {
    ...report, providerMessage: report.providerMessage.replace(/\b1[3-9]\d{9}\b/g, "[phone]").slice(0, 500),
  });
}
