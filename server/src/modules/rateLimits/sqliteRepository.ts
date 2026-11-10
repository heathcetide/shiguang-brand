import type Database from "better-sqlite3";
import type { RateLimitsRepository } from "./repository.js";
import type { RateLimitAttempt, RateLimitBucket, RateLimitStatus } from "./types.js";

type Row = { request_count: number; window_started_at: number; blocked_until: number };

function bucket(row: Row): RateLimitBucket {
  return {
    requestCount: Number(row.request_count),
    windowStartedAt: Number(row.window_started_at),
    blockedUntil: Number(row.blocked_until),
  };
}

export class SqliteRateLimitsRepository implements RateLimitsRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }

  async consume(bucketKey: string, limit: number, windowMs: number, now: number): Promise<RateLimitStatus> {
    return this.database.transaction(() => {
      const row = this.row(bucketKey);
      if (!row || now - row.windowStartedAt >= windowMs) {
        this.upsert(bucketKey, 1, now, 0);
        return { blocked: false, retryAfterSeconds: 0 };
      }
      if (row.blockedUntil > now || row.requestCount >= limit) {
        const blockedUntil = row.blockedUntil > now ? row.blockedUntil : row.windowStartedAt + windowMs;
        this.database.prepare(`UPDATE rate_limit_buckets SET blocked_until=?,updated_at=CURRENT_TIMESTAMP WHERE bucket_key=?`)
          .run(blockedUntil, bucketKey);
        return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
      }
      this.database.prepare(`UPDATE rate_limit_buckets SET request_count=request_count+1,updated_at=CURRENT_TIMESTAMP WHERE bucket_key=?`)
        .run(bucketKey);
      return { blocked: false, retryAfterSeconds: 0 };
    })();
  }

  async activeBuckets(bucketKeys: string[], windowMs: number, now: number) {
    return this.database.transaction(() => bucketKeys.flatMap((bucketKey) => {
      const current = this.active(bucketKey, windowMs, now);
      return current ? [current] : [];
    }))();
  }

  async recordAttempts(attempts: RateLimitAttempt[], windowMs: number, blockMs: number, now: number) {
    this.database.transaction(() => {
      for (const attempt of attempts) {
        const current = this.active(attempt.bucketKey, windowMs, now) || {
          requestCount: 0, windowStartedAt: now, blockedUntil: 0,
        };
        const requestCount = current.requestCount + 1;
        const blockedUntil = requestCount >= attempt.limit ? now + blockMs : current.blockedUntil;
        this.upsert(attempt.bucketKey, requestCount, current.windowStartedAt, blockedUntil);
      }
    })();
  }

  async clear(bucketKey: string) {
    this.database.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key=?").run(bucketKey);
  }

  private row(bucketKey: string) {
    const value = this.database.prepare(`SELECT request_count,window_started_at,blocked_until
      FROM rate_limit_buckets WHERE bucket_key=?`).get(bucketKey) as Row | undefined;
    return value ? bucket(value) : null;
  }

  private active(bucketKey: string, windowMs: number, now: number) {
    const current = this.row(bucketKey);
    if (!current) return null;
    if (current.blockedUntil > now) return current;
    if (now - current.windowStartedAt < windowMs) return current;
    this.database.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key=?").run(bucketKey);
    return null;
  }

  private upsert(bucketKey: string, requestCount: number, windowStartedAt: number, blockedUntil: number) {
    this.database.prepare(`INSERT INTO rate_limit_buckets
      (bucket_key,request_count,window_started_at,blocked_until,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(bucket_key) DO UPDATE SET request_count=excluded.request_count,
      window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP`)
      .run(bucketKey, requestCount, windowStartedAt, blockedUntil);
  }
}
