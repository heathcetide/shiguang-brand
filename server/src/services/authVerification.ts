import type { Request } from "express";
import { authVerificationService } from "../modules/authVerification/runtime.js";
import type { UsageCounter, VerificationEventInput, VerificationSubject } from "../modules/authVerification/types.js";

export type VerificationSubjectRow = VerificationSubject;

export function getSmsServiceConfig() { return authVerificationService().config(); }

export function normalizeMainlandPhone(value: unknown) {
  const raw = String(value || "").replace(/[\s-]/g, "").replace(/^\+?86/, "");
  return /^1[3-9]\d{9}$/.test(raw) ? raw : null;
}

export function getClientIp(req: Request) {
  return String(req.ip || req.socket.remoteAddress || "").trim().slice(0, 100);
}

export function findOrCreateSmsSubject(phone: string) { return authVerificationService().findOrCreateSubject(phone); }
export function decryptSubjectPhone(subject: VerificationSubjectRow) { return authVerificationService().decryptPhone(subject); }
export function maskedSubjectPhone(subject: VerificationSubjectRow) { return authVerificationService().maskedPhone(subject); }
export function recordVerificationEvent(input: VerificationEventInput) { return authVerificationService().recordEvent(input); }
export function incrementDailyUsage(counter: UsageCounter, amount = 1) { return authVerificationService().incrementUsage(counter, amount); }

function since(modifier: string) {
  const match = /^-(\d+) (hour|day)s?$/.exec(modifier);
  if (!match) throw new Error("INVALID_VERIFICATION_TIME_WINDOW");
  const milliseconds = Number(match[1]) * (match[2] === "hour" ? 60 * 60_000 : 24 * 60 * 60_000);
  return new Date(Date.now() - milliseconds).toISOString();
}

export function countSubjectSends(subjectId: number, sinceModifier: string) {
  return authVerificationService().countSubjectSends(subjectId, since(sinceModifier));
}
export function countIpSends(ip: string, sinceModifier: string) {
  return authVerificationService().countIpSends(ip, since(sinceModifier));
}
export function currentGlobalDailySends() { return authVerificationService().globalDailySends(); }
