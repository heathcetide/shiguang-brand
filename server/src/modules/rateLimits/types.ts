export type RateLimitBucket = {
  requestCount: number;
  windowStartedAt: number;
  blockedUntil: number;
};

export type RateLimitStatus = {
  blocked: boolean;
  retryAfterSeconds: number;
};

export type RateLimitAttempt = {
  bucketKey: string;
  limit: number;
};
