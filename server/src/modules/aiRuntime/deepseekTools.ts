import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { isIP } from "node:net";
import type { resolveToolService } from "./resources.js";

// No ori_question/localization: do not forward original health questions or user IPs.
export const searchRequestSchema = z.object({
  query: z.string().refine(s => s.trim().length > 0 && [...s].length <= 128),
  count: z.number().int().min(1).max(50).default(10), need_content: z.boolean().default(false),
}).strict();
const webUrl = z.string().max(8192).refine(value => {
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
});
export const fetchRequestSchema = z.object({ url: webUrl }).strict();
export const fetchResponseSchema = z.object({ title: z.string(), content: z.string() });
const searchResponseSchema = z.object({ results: z.array(z.object({
  title: z.string(), url: webUrl, snippet: z.string(), summary: z.string(), content: z.string(),
  site_name: z.string().nullable(), site_icon: webUrl.nullable(), date: z.iso.datetime({ offset: true }).nullable(),
  rerank_score: z.number().min(0).max(3), authority: z.number().int().min(-1).max(4),
})).max(50) });
export type ToolErrorCode = "invalid_request" | "disabled" | "unconfigured" | "approval_required" | "budget_exhausted" | "rate_limited" | "unauthorized" | "payment_required" | "upstream_rejected" | "upstream_unavailable" | "invalid_response" | "cancelled" | "timeout" | "unsafe_url";
export class WebToolError extends Error {
  readonly code: ToolErrorCode;
  readonly status?: number;
  constructor(code: ToolErrorCode, status?: number) {
    super(`Web tool: ${code}`); this.name = "WebToolError"; this.code = code; this.status = status;
  }
}
export class WebCallBudget {
  private remaining: number;
  constructor(attempts = 3) {
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new WebToolError("invalid_request");
    this.remaining = attempts;
  }
  consume() { if (this.remaining <= 0) throw new WebToolError("budget_exhausted"); this.remaining--; }
}
export type WebResult = {
  url: string; title: string; source: string | null; publishedAt: string | null;
  snippet: string; summary: string; content: string; siteIcon: string | null;
  score: number; authority: number; provider: "deepseek"; trust: "untrusted-external-content";
};
type Config = ReturnType<typeof resolveToolService>;
// ponytail: process-wide conservative limit; multiple workers require a shared account limiter before enabling callers.
let windowStart = 0, windowCalls = 0;
function reserveAttempt() {
  const now = Date.now();
  if (now - windowStart >= 1000) { windowStart = now; windowCalls = 0; }
  if (windowCalls >= 5) throw new WebToolError("rate_limited");
  windowCalls++;
}
async function readJson(response: Response, signal: AbortSignal) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new WebToolError("invalid_response");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new WebToolError("invalid_response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { throw new WebToolError("invalid_response"); }
  finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); }
}
/** Internal adapter only: no Agent registration or HTTP execution route. */
export class DeepSeekTools {
  private readonly transport: typeof fetch;
  private readonly reserve: () => void;
  constructor(dependencies: { transport?: typeof fetch; reserve?: () => void } = {}) {
    this.transport = dependencies.transport ?? fetch; this.reserve = dependencies.reserve ?? reserveAttempt;
  }
  async search(config: Config, input: unknown, options: {
    // From a trusted policy/approval boundary reviewing this exact public query, never model output.
    approvedPublicQuery: string; budget: WebCallBudget; signal?: AbortSignal; timeoutMs?: number;
  }): Promise<{ results: WebResult[]; revision: number; retrievedAt: string; trust: "untrusted-external-content" }> {
    const parsed = searchRequestSchema.safeParse(input);
    if (!parsed.success) throw new WebToolError("invalid_request");
    if (options.approvedPublicQuery !== parsed.data.query) throw new WebToolError("approval_required");
    if (config.service !== "search" || config.status === "disabled") throw new WebToolError("disabled");
    if (!("apiKey" in config) || !config.apiKey) throw new WebToolError("unconfigured");
    if (config.baseUrl !== "https://api.deepseek.com") throw new WebToolError("disabled");
    const timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new WebToolError("invalid_request");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs), signal = controller.signal;
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new WebToolError(timedOut ? "timeout" : "cancelled"));
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      if (signal.aborted) throw new WebToolError("cancelled");
      return await Promise.race([aborted, (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          signal.throwIfAborted(); this.reserve(); options.budget.consume();
          const response = await this.transport("https://api.deepseek.com/v1/tools/search", {
            method: "POST", redirect: "error", signal,
            headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
          });
          signal.throwIfAborted();
          if (response.status !== 200) {
            await response.body?.cancel();
            const retryable = response.status === 408 || response.status === 429 || response.status >= 500 && response.status <= 599;
            if (retryable && attempt < 2) {
              const retryAfter = response.headers.get("retry-after"), seconds = retryAfter === null ? NaN : Number(retryAfter);
              const wait = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
              if (wait > 2000) throw new WebToolError(response.status === 429 ? "rate_limited" : "upstream_unavailable", response.status);
              await delay(Math.max(100 * 2 ** attempt, Number.isFinite(wait) ? wait : 0), undefined, { signal });
              continue;
            }
            throw new WebToolError(response.status === 401 ? "unauthorized" : response.status === 402 ? "payment_required" : response.status === 429 ? "rate_limited" : retryable ? "upstream_unavailable" : "upstream_rejected", response.status);
          }
          const data = searchResponseSchema.safeParse(await readJson(response, signal));
          if (!data.success || data.data.results.length > parsed.data.count) throw new WebToolError("invalid_response");
          return { revision: config.revision, retrievedAt: new Date().toISOString(), trust: "untrusted-external-content" as const,
            results: data.data.results.map(r => ({ url: r.url, title: r.title, source: r.site_name, publishedAt: r.date,
              snippet: r.snippet, summary: r.summary, content: r.content, siteIcon: r.site_icon, score: r.rerank_score,
              authority: r.authority, provider: "deepseek" as const, trust: "untrusted-external-content" as const })) };
        }
        throw new WebToolError("upstream_unavailable");
      })()]);
    } catch (error) {
      if (signal.aborted) throw new WebToolError(timedOut ? "timeout" : "cancelled");
      if (error instanceof WebToolError) throw error;
      // Do not propagate upstream bodies, transport errors, keys or queries.
      throw new WebToolError("upstream_unavailable");
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort); signal.removeEventListener("abort", rejectAbort);
    }
  }
  async fetch(_config: Config, input: unknown): Promise<never> {
    const parsed = fetchRequestSchema.safeParse(input);
    if (!parsed.success) throw new WebToolError("invalid_request");
    const url = new URL(parsed.data.url);
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".") || /\.(localhost|local|internal|test|invalid)$/.test(url.hostname) || url.search || url.hash || url.port) throw new WebToolError("unsafe_url");
    // Remote fetch hides redirects/DNS resolution; a local preflight cannot close rebinding/TOCTOU.
    // No target request or DNS lookup is made, even for apparently public hosts.
    throw new WebToolError("disabled");
  }
}
