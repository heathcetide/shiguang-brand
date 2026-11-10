import { createHash } from "node:crypto";
import type { RateLimitsRepository } from "./repository.js";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_ACCOUNT_LIMIT = 5;
const LOGIN_IP_LIMIT = 20;

export function hashRateLimitKey(namespace: string, value: string) {
  return `${namespace}:${createHash("sha256").update(value).digest("hex")}`;
}

function accountKey(identifier: unknown) {
  return hashRateLimitKey("login-account", String(identifier || "").trim().toLowerCase());
}

function ipKey(ipAddress: string) {
  return hashRateLimitKey("login-ip", ipAddress);
}

export class RateLimitsService {
  private readonly repository: RateLimitsRepository;

  constructor(repository: RateLimitsRepository) { this.repository = repository; }

  consume(namespace: string, value: string, limit: number, windowMs: number, now = Date.now()) {
    return this.repository.consume(hashRateLimitKey(namespace, value), limit, windowMs, now);
  }

  async loginStatus(identifier: unknown, ipAddress: string, now = Date.now()) {
    const buckets = await this.repository.activeBuckets(
      [accountKey(identifier), ipKey(ipAddress)], LOGIN_WINDOW_MS, now,
    );
    const blocked = buckets.find((bucket) => bucket.blockedUntil > now);
    return blocked
      ? { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((blocked.blockedUntil - now) / 1000)) }
      : { blocked: false, retryAfterSeconds: 0 };
  }

  recordLoginFailure(identifier: unknown, ipAddress: string, now = Date.now()) {
    return this.repository.recordAttempts([
      { bucketKey: accountKey(identifier), limit: LOGIN_ACCOUNT_LIMIT },
      { bucketKey: ipKey(ipAddress), limit: LOGIN_IP_LIMIT },
    ], LOGIN_WINDOW_MS, LOGIN_BLOCK_MS, now);
  }

  clearLoginFailures(identifier: unknown) {
    return this.repository.clear(accountKey(identifier));
  }
}
