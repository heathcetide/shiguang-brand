import { API_BASE } from "@/utils/config";
import {
  apiCachePolicy,
  cachedApiGet,
  invalidateApiCacheForMutation,
  registerApiFetchScope,
} from "./cache";

export type ApiFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type RuntimeSchema<T> = { parse: (value: unknown) => T };

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  requestId?: string;

  constructor(message: string, status: number, body?: Record<string, unknown> | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : undefined;
    this.details = body?.details;
    this.requestId = typeof body?.requestId === "string" ? body.requestId : undefined;
  }
}

// Only fetch transport failures are classified here, never HTTP/provider errors.
export class ApiTransportError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = "ApiTransportError";
  }
}

export const apiUrl = (path: string) => {
  if (/^https?:\/\//.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE.replace(/\/$/, "")}${normalizedPath}`;
};

const inFlightMutations = new Map<string, Promise<unknown>>();
const fetchIdentities = new WeakMap<ApiFetch, number>();
let nextFetchIdentity = 1;

function getFetchIdentity(apiFetch: ApiFetch) {
  const existing = fetchIdentities.get(apiFetch);
  if (existing) return existing;
  const identity = nextFetchIdentity;
  nextFetchIdentity += 1;
  fetchIdentities.set(apiFetch, identity);
  return identity;
}

export function requestJson<T>(
  apiFetch: ApiFetch,
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
  responseSchema?: RuntimeSchema<T>,
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const cachePolicy = method === "GET" && options.cache !== "no-store" && options.cache !== "reload" ? apiCachePolicy(path) : null;
  if (cachePolicy) {
    return cachedApiGet<T>(apiFetch, path, cachePolicy, async (etag) => {
      const result = await executeJsonRequestWithMetadata<unknown>(apiFetch, path, options, etag);
      return result.notModified
        ? { notModified: true, etag: result.etag }
        : { data: parseResponse(path, result.data, responseSchema), etag: result.etag };
    })
      .then((data) => parseResponse(path, data, responseSchema));
  }
  const mutationKey = method === "GET" || method === "HEAD"
    ? null
    : `${getFetchIdentity(apiFetch)}:${method}:${path}:${typeof options.body === "string" ? options.body : ""}`;
  const existing = mutationKey ? inFlightMutations.get(mutationKey) : undefined;
  if (existing) return existing as Promise<T>;

  const request = executeJsonRequest<unknown>(apiFetch, path, options).then(async (rawData) => {
    const data = parseResponse(path, rawData, responseSchema);
    if (method !== "GET" && method !== "HEAD") await invalidateApiCacheForMutation(apiFetch, path);
    return data;
  });
  if (mutationKey) {
    inFlightMutations.set(mutationKey, request);
    void request.finally(() => {
      if (inFlightMutations.get(mutationKey) === request) inFlightMutations.delete(mutationKey);
    }).catch(() => undefined);
  }
  return request;
}

function parseResponse<T>(path: string, data: unknown, responseSchema?: RuntimeSchema<T>): T {
  if (!responseSchema) return data as T;
  try {
    return responseSchema.parse(data);
  } catch (error) {
    throw new ApiError("服务器响应不符合 API 契约", 0, {
      code: "INVALID_API_RESPONSE",
      details: { path, cause: error },
    });
  }
}

async function executeJsonRequest<T>(
  apiFetch: ApiFetch,
  path: string,
  options: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const result = await executeJsonRequestWithMetadata<T>(apiFetch, path, options);
  return result.data as T;
}

async function executeJsonRequestWithMetadata<T>(
  apiFetch: ApiFetch,
  path: string,
  options: RequestInit & { timeoutMs?: number },
  etag?: string | null,
): Promise<{ data?: T; etag?: string | null; notModified?: boolean }> {
  const { timeoutMs = 15_000, ...requestOptions } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const callerSignal = requestOptions.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (etag && !headers.has("If-None-Match")) headers.set("If-None-Match", etag);

  try {
    let response: Response;
    try {
      response = await apiFetch(apiUrl(path), {
        ...requestOptions,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (!callerSignal?.aborted && (timedOut || error instanceof TypeError)) {
        throw new ApiTransportError(timedOut ? "网络请求超时" : "网络连接不可用", error);
      }
      throw error;
    }
    if (response.status === 304) return { notModified: true, etag };
    const body = await response.json().catch((error: unknown) => {
      if (callerSignal?.aborted) throw error;
      // A successful header response does not mean its body reached the client.
      // Keep known HTTP failures as ApiError, and malformed JSON as schema failure.
      if (response.ok && (timedOut || error instanceof TypeError)) {
        throw new ApiTransportError(timedOut ? "网络请求超时" : "网络连接不可用", error);
      }
      return null;
    }) as T | Record<string, unknown> | null;
    if (!response.ok) {
      const errorBody = body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null;
      throw new ApiError(
        typeof errorBody?.error === "string" ? errorBody.error : `请求失败（${response.status}）`,
        response.status,
        errorBody,
      );
    }
    return { data: body as T, etag: response.headers?.get?.("etag") || null };
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export const publicFetch: ApiFetch = (input, init) => fetch(input, init);
registerApiFetchScope(publicFetch);
