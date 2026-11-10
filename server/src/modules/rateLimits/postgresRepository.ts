import type { Pool, PoolClient } from "pg";
import type { RateLimitsRepository } from "./repository.js";
import type { RateLimitAttempt, RateLimitBucket, RateLimitStatus } from "./types.js";

type Row = { request_count: number | string; window_started_at: number | string; blocked_until: number | string };

function bucket(row: Row): RateLimitBucket {
  return {
    requestCount: Number(row.request_count),
    windowStartedAt: Number(row.window_started_at),
    blockedUntil: Number(row.blocked_until),
  };
}

export class PostgresRateLimitsRepository implements RateLimitsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  consume(bucketKey: string, limit: number, windowMs: number, now: number): Promise<RateLimitStatus> {
    return this.tx(async (client) => {
      await this.lock(client, bucketKey);
      const current = await this.row(client, bucketKey);
      if (!current || now - current.windowStartedAt >= windowMs) {
        await this.upsert(client, bucketKey, 1, now, 0);
        return { blocked: false, retryAfterSeconds: 0 };
      }
      if (current.blockedUntil > now || current.requestCount >= limit) {
        const blockedUntil = current.blockedUntil > now ? current.blockedUntil : current.windowStartedAt + windowMs;
        await client.query(`UPDATE rate_limit_buckets SET blocked_until=$1,updated_at=NOW() WHERE bucket_key=$2`,
          [blockedUntil, bucketKey]);
        return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
      }
      await client.query(`UPDATE rate_limit_buckets SET request_count=request_count+1,updated_at=NOW() WHERE bucket_key=$1`, [bucketKey]);
      return { blocked: false, retryAfterSeconds: 0 };
    });
  }

  activeBuckets(bucketKeys: string[], windowMs: number, now: number) {
    return this.tx(async (client) => {
      const keys = [...new Set(bucketKeys)].sort();
      for (const key of keys) await this.lock(client, key);
      const buckets: RateLimitBucket[] = [];
      for (const key of bucketKeys) {
        const current = await this.active(client, key, windowMs, now);
        if (current) buckets.push(current);
      }
      return buckets;
    });
  }

  async recordAttempts(attempts: RateLimitAttempt[], windowMs: number, blockMs: number, now: number) {
    await this.tx(async (client) => {
      const keys = [...new Set(attempts.map((attempt) => attempt.bucketKey))].sort();
      for (const key of keys) await this.lock(client, key);
      for (const attempt of attempts) {
        const current = await this.active(client, attempt.bucketKey, windowMs, now) || {
          requestCount: 0, windowStartedAt: now, blockedUntil: 0,
        };
        const requestCount = current.requestCount + 1;
        const blockedUntil = requestCount >= attempt.limit ? now + blockMs : current.blockedUntil;
        await this.upsert(client, attempt.bucketKey, requestCount, current.windowStartedAt, blockedUntil);
      }
    });
  }

  async clear(bucketKey: string) {
    await this.pool.query("DELETE FROM rate_limit_buckets WHERE bucket_key=$1", [bucketKey]);
  }

  private lock(client: PoolClient, bucketKey: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`rate-limit:${bucketKey}`]);
  }

  private async row(client: PoolClient, bucketKey: string) {
    const value = (await client.query(`SELECT request_count,window_started_at,blocked_until
      FROM rate_limit_buckets WHERE bucket_key=$1`, [bucketKey])).rows[0] as Row | undefined;
    return value ? bucket(value) : null;
  }

  private async active(client: PoolClient, bucketKey: string, windowMs: number, now: number) {
    const current = await this.row(client, bucketKey);
    if (!current) return null;
    if (current.blockedUntil > now) return current;
    if (now - current.windowStartedAt < windowMs) return current;
    await client.query("DELETE FROM rate_limit_buckets WHERE bucket_key=$1", [bucketKey]);
    return null;
  }

  private upsert(client: PoolClient, bucketKey: string, requestCount: number, windowStartedAt: number, blockedUntil: number) {
    return client.query(`INSERT INTO rate_limit_buckets
      (bucket_key,request_count,window_started_at,blocked_until,updated_at) VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT(bucket_key) DO UPDATE SET request_count=EXCLUDED.request_count,
      window_started_at=EXCLUDED.window_started_at,blocked_until=EXCLUDED.blocked_until,updated_at=NOW()`,
    [bucketKey, requestCount, windowStartedAt, blockedUntil]);
  }

  private async tx<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
