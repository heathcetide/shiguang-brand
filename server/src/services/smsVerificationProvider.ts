import { AliyunSmsProvider } from "../providers/auth/aliyunSms.js";
import type { SmsProvider, SmsSendResult, SmsServiceConfig, SmsVerifyResult } from "../providers/contracts.js";
import { getProviderProfile } from "../providers/profiles.js";

export type { SmsProvider, SmsSendResult, SmsServiceConfig, SmsVerifyResult } from "../providers/contracts.js";

export const SMS_PROVIDER = "aliyun-pnvs";

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

export function smsCredentialsStatus() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim() || "";
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim() || "";
  return {
    configured: Boolean(accessKeyId && accessKeySecret),
    accessKeyIdConfigured: Boolean(accessKeyId),
    secretConfigured: Boolean(accessKeySecret),
    maskedAccessKeyId: accessKeyId ? `${accessKeyId.slice(0, 4)}********${accessKeyId.slice(-4)}` : null,
  };
}

let provider: SmsProvider = new AliyunSmsProvider();

export function getSmsProvider() {
  if (getProviderProfile().providers.auth !== SMS_PROVIDER) {
    throw new Error(`SMS verification is unavailable for ${getProviderProfile().id} deployments`);
  }
  return provider;
}

export function setSmsProviderForTests(value: SmsProvider | null) {
  provider = value || new AliyunSmsProvider();
}

export function defaultSmsEnabled() {
  return getProviderProfile().providers.auth === SMS_PROVIDER && envBoolean("ALIYUN_SMS_ENABLED", false);
}
