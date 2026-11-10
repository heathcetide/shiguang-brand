import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ApiError, ApiFetch } from "./client";

export const API_CACHE_SCHEMA_VERSION = 3;
export const API_CACHE_STORAGE_PREFIX = `offline_cache_query_v${API_CACHE_SCHEMA_VERSION}:`;
const QUERY_CACHE_KEY = /^offline_cache_query_v\d+:/;
const MAX_PERSISTED_BYTES = 5 * 1024 * 1024;

type CacheScope = "public" | `user:${number}`;

export type ApiCachePolicy = {
  ttlMs: number;
  maxStaleMs: number;
  persistent: boolean;
};

type CacheEntry<T = unknown> = {
  schemaVersion: number;
  logicalKey: string;
  path: string;
  scope: CacheScope;
  data: T;
  etag: string | null;
  fetchedAt: number;
  expiresAt: number;
  maxStaleAt: number;
  lastAccessAt: number;
  byteSize: number;
};

type LoaderResult<T> = { data?: T; etag?: string | null; notModified?: boolean };

export type ApiCacheMetrics = {
  memoryHits: number;
  persistentHits: number;
  misses: number;
  staleFallbacks: number;
  revalidations: number;
  networkRequests: number;
  coalescedRequests: number;
  evictions: number;
  bytes: number;
  coldRenderMs: number[];
  hotRenderMs: number[];
};

const scopes = new WeakMap<ApiFetch, CacheScope>();
const memory = new Map<string, CacheEntry>();
const inFlight = new Map<string, { epoch: number; promise: Promise<unknown> }>();
const scopeEpochs = new Map<CacheScope, number>();
let maintenance: Promise<void> = Promise.resolve();
const metrics: ApiCacheMetrics = {
  memoryHits: 0, persistentHits: 0, misses: 0, staleFallbacks: 0, revalidations: 0,
  networkRequests: 0, coalescedRequests: 0, evictions: 0, bytes: 0,
  coldRenderMs: [], hotRenderMs: [],
};

export function registerApiFetchScope(apiFetch: ApiFetch, userId?: number | null) {
  const numericUserId = Number(userId);
  scopes.set(apiFetch, Number.isInteger(numericUserId) && numericUserId > 0 ? `user:${numericUserId}` : "public");
}

export function getApiFetchScope(apiFetch: ApiFetch): CacheScope {
  return scopes.get(apiFetch) || "public";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function logicalKey(scope: CacheScope, path: string) {
  return `${scope}|schema:${API_CACHE_SCHEMA_VERSION}|GET|${path}`;
}

function storageKey(key: string, scope: CacheScope) {
  const suffix = scope.startsWith("user:") ? `:user:${scope.slice(5)}` : "";
  return `${API_CACHE_STORAGE_PREFIX}${stableHash(key)}${suffix}`;
}

export function apiCachePolicy(path: string): ApiCachePolicy | null {
  // A cached empty feed hides newly published posts; background revalidation
  // cannot update a screen that has already consumed the returned array.
  if (/^\/api\/v1\/community\/posts(?:\?|$)/.test(path)) return null;
  if (/^\/api\/v1\/households\/\d+\/(?:dining-(?:preferences|members)|meals|inventory)(?:\/|\?|$)/.test(path)) return null;
  if (/^\/api\/v1\/(?:auth|ai|notifications)(?:\/|\?|$)/.test(path)) return null;
  if (path === "/api/v1/shopping-list" || path === "/api/v1/kitchenware" || path === "/api/v1/kitchenware/catalog") return { ttlMs: 2 * 60_000, maxStaleMs: 86_400_000, persistent: true };
  if (/^\/api\/v1\/recipes\/\d+(?:\?|$)/.test(path)) return { ttlMs: 30 * 60_000, maxStaleMs: 7 * 86_400_000, persistent: true };
  if (/^\/api\/v1\/recipes(?:\?|$)/.test(path)) return { ttlMs: 10 * 60_000, maxStaleMs: 86_400_000, persistent: true };
  if (/^\/api\/v1\/(?:recipes|community)(?:\/|\?|$)/.test(path)) return { ttlMs: 10 * 60_000, maxStaleMs: 24 * 60 * 60_000, persistent: false };
  if (/^\/api\/v1\/(?:inventory|diet-records|health-data)(?:\/|\?|$)/.test(path)) return { ttlMs: 60_000, maxStaleMs: 7 * 86_400_000, persistent: false };
  if (/^\/api\/v1\/(?:kitchenware|shopping-list|cooking-queue|meal-plans|households|insights)(?:\/|\?|$)/.test(path)) {
    return { ttlMs: 2 * 60_000, maxStaleMs: 24 * 60 * 60_000, persistent: false };
  }
  return null;
}

/** Disk storage is opt-in by both endpoint and audience, even for caller-supplied policies. */
function persistencePolicy(path: string, scope: CacheScope) {
  const policy = apiCachePolicy(path);
  if (!policy?.persistent) return null;
  if (path.startsWith("/api/v1/recipes")) return scope === "public" ? policy : null;
  if (path === "/api/v1/kitchenware/catalog") return policy;
  return scope === "public" ? null : policy;
}

function isUsable(entry: CacheEntry, now: number) {
  return entry.schemaVersion === API_CACHE_SCHEMA_VERSION
    && Number.isFinite(entry.fetchedAt) && entry.fetchedAt <= now
    && Number.isFinite(entry.maxStaleAt) && now < entry.maxStaleAt;
}

function validPersistentEntry(raw: string, key: string, now: number): CacheEntry | null {
  try {
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || typeof entry.path !== "string" || typeof entry.scope !== "string"
      || !/^(?:public|user:[1-9]\d*)$/.test(entry.scope)) return null;
    const policy = persistencePolicy(entry.path, entry.scope);
    if (!policy || !isUsable(entry, now) || entry.maxStaleAt > entry.fetchedAt + policy.maxStaleMs
      || !Number.isFinite(entry.expiresAt) || entry.expiresAt > entry.maxStaleAt
      || entry.logicalKey !== logicalKey(entry.scope, entry.path)
      || key !== storageKey(entry.logicalKey, entry.scope)) return null;
    return entry;
  } catch { return null; }
}

async function readPersistent<T>(key: string, scope: CacheScope) {
  const epoch = scopeEpochs.get(scope) || 0;
  scopeEpochs.set(scope, epoch);
  await maintenance;
  const diskKey = storageKey(key, scope);
  const raw = await AsyncStorage.getItem(diskKey);
  if ((scopeEpochs.get(scope) || 0) !== epoch || !raw) return null;
  const entry = validPersistentEntry(raw, diskKey, Date.now()) as CacheEntry<T> | null;
  if (!entry || entry.logicalKey !== key || entry.scope !== scope) {
    // Serialize removal with writers and avoid deleting a newer replacement.
    await enqueueMaintenance(async () => {
      if (await AsyncStorage.getItem(diskKey) === raw) await AsyncStorage.removeItem(diskKey);
    });
    return null;
  }
  entry.lastAccessAt = Date.now();
  memory.set(key, entry);
  return entry;
}

function enqueueMaintenance(task: () => Promise<void>) {
  const result = maintenance.then(task);
  maintenance = result.catch(() => undefined);
  return result;
}

/** Startup, foreground and active-app maintenance; no cache read is needed to expire disk rows. */
export function maintainApiCache() {
  return enqueueMaintenance(sweepPersistentEntries);
}

async function sweepPersistentEntries() {
  const now = Date.now();
  for (const [key, entry] of memory) if (!isUsable(entry, now)) memory.delete(key);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => QUERY_CACHE_KEY.test(key));
  const rows: Array<{ key: string; bytes: number; lastAccessAt: number; logicalKey: string }> = [];
  const removals: string[] = [];
  for (const [key, raw] of await AsyncStorage.multiGet(keys)) {
    const entry = raw && key.startsWith(API_CACHE_STORAGE_PREFIX) ? validPersistentEntry(raw, key, now) : null;
    if (!entry || !raw) { removals.push(key); continue; }
    rows.push({ key, bytes: (key.length + raw.length) * 2, lastAccessAt: entry.lastAccessAt || entry.fetchedAt, logicalKey: entry.logicalKey });
  }
  let total = rows.reduce((sum, row) => sum + row.bytes, 0);
  for (const row of rows.sort((a, b) => a.lastAccessAt - b.lastAccessAt)) {
    if (total <= MAX_PERSISTED_BYTES) break;
    total -= row.bytes;
    removals.push(row.key);
    memory.delete(row.logicalKey);
    metrics.evictions += 1;
  }
  if (removals.length) await AsyncStorage.multiRemove(removals);
  metrics.bytes = total;
}

function persistEntry(entry: CacheEntry) {
  const epoch = scopeEpochs.get(entry.scope) || 0;
  void enqueueMaintenance(async () => {
    if ((scopeEpochs.get(entry.scope) || 0) !== epoch || !persistencePolicy(entry.path, entry.scope)
      || !isUsable(entry, Date.now())) return;
    await AsyncStorage.setItem(storageKey(entry.logicalKey, entry.scope), JSON.stringify(entry));
    await sweepPersistentEntries();
  }).catch(() => undefined);
}

function store<T>(key: string, path: string, scope: CacheScope, policy: ApiCachePolicy, data: T, etag?: string | null, fetchedAt = Date.now()) {
  const entry: CacheEntry<T> = {
    schemaVersion: API_CACHE_SCHEMA_VERSION,
    logicalKey: key,
    path,
    scope,
    data,
    etag: etag || null,
    fetchedAt,
    expiresAt: fetchedAt + policy.ttlMs,
    maxStaleAt: fetchedAt + policy.maxStaleMs,
    lastAccessAt: fetchedAt,
    byteSize: JSON.stringify(data).length * 2,
  };
  memory.set(key, entry);
  if (policy.persistent && persistencePolicy(path, scope)) persistEntry(entry);
  return data;
}

async function refresh<T>(key: string, path: string, scope: CacheScope, policy: ApiCachePolicy, entry: CacheEntry<T> | null, loader: (etag?: string | null) => Promise<LoaderResult<T>>, startedEpoch: number) {
  const existing = inFlight.get(key);
  if (existing?.epoch === startedEpoch) {
    metrics.coalescedRequests += 1;
    return existing.promise as Promise<T>;
  }
  const request = (async () => {
    metrics.networkRequests += 1;
    try {
      const result = await loader(entry?.etag);
      const wasInvalidated = (scopeEpochs.get(scope) || 0) !== startedEpoch;
      if (result.notModified) {
        if (!entry || !isUsable(entry, Date.now())) throw new Error("Cached response expired during revalidation");
        if (!wasInvalidated) {
          // A 304 renews freshness, never the absolute lifetime of the retained body.
          const renewed = { ...entry, expiresAt: Math.min(Date.now() + policy.ttlMs, entry.maxStaleAt) };
          memory.set(key, renewed);
          if (policy.persistent && persistencePolicy(path, scope)) persistEntry(renewed);
        }
        return entry.data;
      }
      return wasInvalidated ? result.data as T : store(key, path, scope, policy, result.data as T, result.etag);
    } catch (error) {
      const status = (error as ApiError)?.status;
      if ((status === 401 || status === 403) && (scopeEpochs.get(scope) || 0) === startedEpoch) await clearApiCacheScope(scope);
      throw error;
    }
  })();
  if ((scopeEpochs.get(scope) || 0) === startedEpoch) inFlight.set(key, { epoch: startedEpoch, promise: request });
  void request.finally(() => {
    if (inFlight.get(key)?.promise === request) inFlight.delete(key);
  }).catch(() => undefined);
  return request;
}

export async function cachedApiGet<T>(apiFetch: ApiFetch, path: string, policy: ApiCachePolicy, loader: (etag?: string | null) => Promise<LoaderResult<T>>) {
  const scope = getApiFetchScope(apiFetch);
  const key = logicalKey(scope, path);
  const startedEpoch = scopeEpochs.get(scope) || 0;
  scopeEpochs.set(scope, startedEpoch);
  let now = Date.now();
  let entry = memory.get(key) as CacheEntry<T> | undefined;
  if (entry && isUsable(entry, now)) metrics.memoryHits += 1;
  if (!entry && policy.persistent && persistencePolicy(path, scope)) {
    entry = await readPersistent<T>(key, scope) || undefined;
    now = Date.now();
    if (entry && isUsable(entry, now)) metrics.persistentHits += 1;
  }
  if (entry && isUsable(entry, now)) {
    entry.lastAccessAt = now;
    if (now <= entry.expiresAt) return entry.data;
    metrics.staleFallbacks += 1;
    metrics.revalidations += 1;
    void refresh(key, path, scope, policy, entry, loader, startedEpoch).catch(() => undefined);
    return entry.data;
  }
  metrics.misses += 1;
  memory.delete(key);
  // Expired bodies/ETags must not be revived by a 304 response.
  return refresh(key, path, scope, policy, null, loader, startedEpoch);
}

function invalidationPrefixes(path: string) {
  if (path.startsWith("/api/v1/inventory/import-shopping-list")) return ["/api/v1/inventory", "/api/v1/shopping-list", "/api/v1/insights"];
  if (path.startsWith("/api/v1/insights/inventory-outcomes")) return ["/api/v1/inventory", "/api/v1/insights"];
  if (/^\/api\/v1\/households\/\d+\/meals(?:\/|\?|$)/.test(path)) return ["/api/v1/households", "/api/v1/meal-plans", "/api/v1/diet-records", "/api/v1/health-data", "/api/v1/insights"];
  if (path.startsWith("/api/v1/inventory")) return ["/api/v1/inventory", "/api/v1/insights"];
  if (/^\/api\/v1\/diet-records\/cooking-completions(?:\?|$)/.test(path)) {
    return ["/api/v1/diet-records", "/api/v1/health-data", "/api/v1/inventory", "/api/v1/cooking-queue", "/api/v1/meal-plans", "/api/v1/insights"];
  }
  if (path.startsWith("/api/v1/diet-records")) return ["/api/v1/diet-records", "/api/v1/health-data"];
  if (path.startsWith("/api/v1/health-data") || path.startsWith("/api/v1/auth/profile")) return ["/api/v1/health-data", "/api/v1/auth/me", "/api/v1/recommendations", "/api/v1/insights", "/api/v1/onboarding"];
  if (path.startsWith("/api/v1/recipes")) return ["/api/v1/recipes"];
  if (path.startsWith("/api/v1/community")) return ["/api/v1/community"];
  if (path.startsWith("/api/v1/shopping-list")) return ["/api/v1/shopping-list"];
  if (path.startsWith("/api/v1/cooking-queue")) return ["/api/v1/cooking-queue", "/api/v1/meal-plans"];
  if (path.startsWith("/api/v1/meal-plans")) {
    const prefixes = ["/api/v1/meal-plans", "/api/v1/households", "/api/v1/diet-records/prepared-meals"];
    if (/\/items\/[^/]+\/shopping(?:\?|$)/.test(path)) prefixes.push("/api/v1/shopping-list");
    if (/\/items\/[^/]+\/queue(?:\?|$)/.test(path)) prefixes.push("/api/v1/cooking-queue");
    if (/\/items\/[^/]+\/complete(?:\?|$)/.test(path)) {
      prefixes.push("/api/v1/diet-records", "/api/v1/health-data", "/api/v1/inventory", "/api/v1/insights", "/api/v1/cooking-queue");
    }
    return prefixes;
  }
  if (path.startsWith("/api/v1/kitchenware")) return ["/api/v1/kitchenware"];
  if (path.startsWith("/api/v1/households")) return ["/api/v1/households"];
  return [];
}

export async function invalidateApiCacheForMutation(apiFetch: ApiFetch, path: string) {
  const prefixes = invalidationPrefixes(path);
  if (!prefixes.length) return;
  const scope = getApiFetchScope(apiFetch);
  scopeEpochs.set(scope, (scopeEpochs.get(scope) || 0) + 1);
  const logicalKeys = [...memory.entries()].filter(([, entry]) => entry.scope === scope && prefixes.some((prefix) => entry.path.startsWith(prefix))).map(([key]) => key);
  logicalKeys.forEach((key) => memory.delete(key));
  await enqueueMaintenance(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => QUERY_CACHE_KEY.test(key));
    const rows = await AsyncStorage.multiGet(keys);
    const removals = rows.flatMap(([key, raw]) => {
      try {
        const entry = raw ? JSON.parse(raw) as CacheEntry : null;
        return entry?.scope === scope && prefixes.some((prefix) => entry.path.startsWith(prefix)) ? [key] : [];
      } catch {
        return [key];
      }
    });
    if (removals.length) await AsyncStorage.multiRemove(removals);
  });
}

export async function clearApiCacheScope(scopeOrUserId?: CacheScope | number | null) {
  const scope: CacheScope | null = typeof scopeOrUserId === "number" ? `user:${scopeOrUserId}` : scopeOrUserId || null;
  if (scope) scopeEpochs.set(scope, (scopeEpochs.get(scope) || 0) + 1);
  else for (const knownScope of new Set([...scopeEpochs.keys(), ...[...memory.values()].map((entry) => entry.scope)])) scopeEpochs.set(knownScope, (scopeEpochs.get(knownScope) || 0) + 1);
  for (const [key, entry] of memory) if (!scope || entry.scope === scope) memory.delete(key);
  await enqueueMaintenance(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => QUERY_CACHE_KEY.test(key));
    if (!scope) {
      if (keys.length) await AsyncStorage.multiRemove(keys);
      metrics.bytes = 0;
      return;
    }
    const scopedKeys = keys.filter((key) => scope === "public" ? !key.includes(":user:") : key.endsWith(`:user:${scope.slice(5)}`));
    if (scopedKeys.length) await AsyncStorage.multiRemove(scopedKeys);
  });
}

export function recordCacheRender(durationMs: number, hot: boolean) {
  const bucket = hot ? metrics.hotRenderMs : metrics.coldRenderMs;
  bucket.push(Math.max(0, durationMs));
  if (bucket.length > 100) bucket.shift();
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))];
}

export function getApiCacheDiagnostics() {
  const hits = metrics.memoryHits + metrics.persistentHits;
  return {
    ...metrics,
    entries: memory.size,
    hitRate: hits + metrics.misses ? hits / (hits + metrics.misses) : 0,
    render: {
      coldP50: percentile(metrics.coldRenderMs, 0.5), coldP95: percentile(metrics.coldRenderMs, 0.95),
      hotP50: percentile(metrics.hotRenderMs, 0.5), hotP95: percentile(metrics.hotRenderMs, 0.95),
    },
  };
}

export function resetApiCacheForTests() {
  memory.clear();
  inFlight.clear();
  scopeEpochs.clear();
  Object.assign(metrics, {
    memoryHits: 0, persistentHits: 0, misses: 0, staleFallbacks: 0, revalidations: 0,
    networkRequests: 0, coalescedRequests: 0, evictions: 0, bytes: 0, coldRenderMs: [], hotRenderMs: [],
  });
}
