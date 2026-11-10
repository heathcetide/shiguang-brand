import type { RateLimitAttempt, RateLimitBucket, RateLimitStatus } from "./types.js";

export interface RateLimitsRepository {
  consume(bucketKey: string, limit: number, windowMs: number, now: number): Promise<RateLimitStatus>;
  activeBuckets(bucketKeys: string[], windowMs: number, now: number): Promise<RateLimitBucket[]>;
  recordAttempts(attempts: RateLimitAttempt[], windowMs: number, blockMs: number, now: number): Promise<void>;
  clear(bucketKey: string): Promise<void>;
}
