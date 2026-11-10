# DeepSeek web tools — isolated server adapter

> This document records its original implementation slice. For the subsequent local UI/tool integration, typed HTTP conflicts and safe legacy editing, see [integrated admin verification](ai-resources-admin-ui.md).

## Scope and protocol

This extends #261 phase-one resources on baseline `15b0102390ea65970ef54629638042219ae1930f`. No admin UI, Agent registration, execution HTTP endpoint, deployment, credentials or paid calls are included. Search is independently testable; real account availability remains **unverified**. Fetch is **disabled**, not implemented as an unsafe remote fetch.

Official protocol checked 2026-10-22:
- https://api-docs.deepseek.com/zh-cn/guides/search/
- https://api-docs.deepseek.com/zh-cn/api/search/
- https://api-docs.deepseek.com/zh-cn/api/fetch/

Search uses POST `https://api.deepseek.com/v1/tools/search`, JSON and Bearer auth. Fetch's documented endpoint is `/v1/tools/fetch`; it accepts `url` and returns only `title/content`. Neither endpoint is a chat model or a capability assumed available on an OpenAI-compatible relay.

## Configuration integration contract

Existing authenticated `GET/PUT /api/v1/admin/ai-config/resources` and migration endpoint remain the configuration boundary. No new route is necessary. Existing CAS/revision persistence and credential redaction apply to SQLite and PostgreSQL alike.

New resource shape (credential omitted means keep, not clear):

```json
{
  "id": "deepseek-web",
  "name": "DeepSeek web tools",
  "kind": "tool",
  "protocol": "deepseek-tools",
  "baseUrl": "https://api.deepseek.com",
  "tools": ["search", "fetch"],
  "credential": { "action": "keep" }
}
```

Reuse the existing `keep/replace/clear` operations and server-side resource-ID credential lookup. No fallback to chat/environment keys. A tool resource has no `models`; relay URLs are rejected. Keep model resources unchanged. GET returns `hasApiKey`, fixed `maskedKey`, and `verification: unverified`, never the key.

Schema version remains 1 with additive optional `defaults.search/fetch` targets `{resourceId}` and optional `services.search/fetch` bindings `{resourceId}`, `{inherit:true}`, or `{disabled:true}`. Omission disables the service; explicit inheritance with no default also disables it. Model fields on tool bindings fail validation. Defaults are validated even if overridden. Existing documents require no migration. Full-document PUT callers must preserve these new resources and fields; older editors that reconstruct only the old schema must not save a document containing tool resources.

GET adds search/fetch to `catalog` and `effective`. Tool catalog entries have `kind: tool`, capability equal to service ID, public-query/public-url input, untrusted-web-results output and `automaticExecution:false`. Search effective state is disabled, unconfigured (empty key), or unverified. Fetch is always disabled; a configured Fetch binding includes `reason: redirect-safety-unavailable`. UI must not label configured/unverified as available or published. Saving still applies on the next config read; there is no draft/publish lifecycle.

`AIRuntimeService.toolConfig(service)` is **server-only**, returns the credential-bearing resolved snapshot with revision. Never serialize that return value to clients. `resourceConfiguration()` is the redacted display boundary. A caller resolves once at request start, then passes that snapshot to `DeepSeekTools.search`.

## Execution and trust boundary

`search(config, input, {approvedPublicQuery, budget, signal, timeoutMs})` accepts only query (1–128 Unicode code points, nonblank), count (integer 1–50, default 10), and need_content (boolean, default false). Unknown fields are rejected. Original question, localization/user IP, messages, user records and health context cannot be appended to the wire request. The exact public query must be reviewed at a trusted policy/approval boundary; `approvedPublicQuery` is an internal assertion, **not** an authorization mechanism or proof that text is non-sensitive. Do not derive it from model output. No current Agent path calls this adapter. Before future integration, enforce existing tool approval plus explicit public-query review and share one budget across the whole run; do not create a fresh budget per retry/tool call.

Result envelope: `results`, `revision`, `retrievedAt`, `trust`. Each result retains `url/title/source/publishedAt/snippet/summary/content/siteIcon/score/authority/provider/trust`. Provider URL and date strings remain unchanged; no invented publication time or source. All external text, including instructions and markup, stays `untrusted-external-content`. Consumers must render as text/sanitized markup and never promote it to system instructions or automatically execute/fetch links.

Timeout defaults to 10s and is capped at 30s, covering retries and body read. Cancellation aborts the fetch/body and delay. Max response body is 2 MiB; response schema and result count are validated. Each attempt consumes shared `WebCallBudget` (default 3, constructor max 10); each invocation attempts at most 3. Only 408/429/5xx retry, with bounded backoff and Retry-After; cooldowns over 2s return an error instead of retrying early. Network errors are not retried. The conservative limit is 5 attempts/sec **per process**, shared across adapter instances. A distributed account limiter is required before multi-worker integration; this is not a claim of account-wide enforcement.

Errors are fixed `WebToolError.code` values with optional numeric upstream status: invalid_request, disabled, unconfigured, approval_required, budget_exhausted, rate_limited, unauthorized, payment_required, upstream_rejected, upstream_unavailable, invalid_response, cancelled, timeout, unsafe_url. Upstream error text, query and credentials never enter these errors. HTTP 401/402/other 4xx (except 408/429) do not retry. API redirects use `redirect:error`, preventing Bearer credential forwarding.

## Why Fetch remains disabled

The official Fetch response does not expose final URL or redirect hops, nor document request controls to forbid redirects or require public resolved addresses. Local DNS/HEAD preflight cannot constrain the provider's later DNS resolution or redirects (TOCTOU/rebinding). Consequently no Fetch request, target request or DNS lookup occurs, including for public URLs. Early validation rejects credentials/non-HTTP URLs, IP literals (including encoded/IPv6), local hostnames, custom ports and query/fragment URLs. Every other URL still fails closed with `disabled`; private DNS answers, public-to-private redirects and rebinding cannot bypass that gate. Search response URLs are inert source data, not permission to fetch. Future enablement requires an enforceable provider safety contract or a separate approved pinned-address fetcher; do not replace this gate with a cosmetic preflight.

## Reproducible checks

From `server/`, using existing dependencies (no new dependency):

```sh
node --import tsx --test test/deepseekTools.test.ts test/aiRuntimeModule.test.ts test/aiProviderCredentials.test.ts
node --import tsx --test test/aiResourcesHttp.test.ts test/agentArchitecture.test.ts test/agentOperationsModule.test.ts test/agentProposalClock.test.ts
node_modules/.bin/tsc --noEmit
```

Synthetic fixtures only. Tests cover official constraints, exact wire fields, hostile content/provenance, empty/malformed/oversized results, 408/429/5xx bounded retries, other statuses, cooldown, shared budgets, local limiter, pre/in-flight cancellation, body stalls, timeout, approval/state gates, private/redirect-like URLs with zero Fetch calls, credential operations, incompatible bindings, authenticated HTTP configuration/redaction and existing Agent safety regressions. No claim of live DeepSeek, provider Fetch SSRF behavior, distributed rate limits, new live PostgreSQL acceptance or production readiness.

Local verification (Node v25.2.1): 24 adapter/runtime/credential tests passed; 22 existing Agent architecture/operations/proposal-clock checks passed; 1 admin HTTP scenario passed; server TypeScript and `git diff --check` passed. The initial sandboxed HTTP run stalled and was cancelled; a bounded rerun with loopback permission passed in 1.5s. Existing dependency directories were reused by an ignored symlink, with no install or lockfile change.
