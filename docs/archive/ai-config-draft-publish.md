# AI configuration draft / test / publish (Issue #261, phase 2)

Base: main `e16d059218c83800f0a3690d5d23f2d95a096a8c`, fetched 2026-10-25.

## Behavior and storage

- Resource/service edits and the legacy policy/credential editor save one shared, versioned draft. Runtime readers continue to use the published setting keys.
- `AI_CONFIGURATION_DRAFT_V1` lives in the existing protected server-side `system_settings` storage. No new schema, provider dependency, or alternative configuration database. The envelope contains the draft, its original published baseline and its test result. Publishing/discarding removes draft credential copies from this envelope.
- Existing SQLite immediate transactions and PostgreSQL advisory-lock transactions compare the entire published baseline and draft envelope, then atomically write published settings and clear the draft. Failure rolls back both. Startup needs no eager migration; existing resource revisions, legacy fallback rules, models, credentials, prompts and TTS behavior remain readable.
- Resource metadata migration is idempotent and guarded against concurrent draft creation. Older server releases ignore the new setting and can still read the last published legacy/resource keys. Rollback does not publish pending edits. An old writer changing published values makes a pending draft conflict; explicitly discard/recreate that draft rather than silently rebase it.
- Admin writes require the existing admin authentication/authorization boundary. Legacy PUT now requires `draftRevision`; the old unversioned connection-test endpoint returns 410. Updated admin readers fail closed against a server without draft metadata. This is an intentional admin API transition, not a client AI API change.

## Testing and publication

`POST /admin/ai-config/resources/test` accepts `{revision}` for static configuration validation, or `{revision, service}` for a provider connection probe of that exact saved draft binding. The latter uses the full resolved endpoint/model/credential, sends a small text request, and may incur provider charges when an administrator explicitly invokes it. Only synthetic/mock provider calls were made during development.

Results carry revision, scope, service (for a probe), success and optional latency. No provider reply, error body or credential is stored or returned. Text probes do **not** verify actual vision, transcription, structured output, tool execution or production readiness. Static validation is separately named and never described as provider verification. The current implementation keeps the latest result for the draft, not a matrix of production capability certifications.

Saving again invalidates the result. Concurrent editing, discard, publication or another test result prevents a late probe result from certifying that state. Closing/cancelling aborts the provider request; abort is checked before persisting results. Publish requires a successful current-version test, validates capabilities/policies again, displays resolved affected services and changed legacy setting names, and uses CAS against the original published baseline. Static validation can satisfy the publication gate; production capability acceptance remains an independent operational step.

The resource/service pages preserve the existing design system, distinguish draft from published values, require impact confirmation, guard duplicate clicks and stale/closed responses, and require reread after uncertain writes. Cancelling local edits differs from discarding the shared saved draft.

## Request snapshots

HTTP AI requests capture settings and environment fallbacks before route execution. Model bindings, policies, prompt and credentials resolve from that snapshot throughout the async execution. Accepted queued Agent requests retain their own in-memory snapshot; later accepted requests see the new published version. No credentials are added to Agent checkpoints or event logs.

Snapshots are process-local. Cancelling or finishing an execution releases its captured configuration. New requests carry a server-owned marker requiring their accepted snapshot. Automatic recovery or cross-process takeover without that snapshot fails with AI_CONFIGURATION_SNAPSHOT_LOST before any model call, rather than silently continuing the old request under new credentials. Explicit user resume/retry begins a new execution segment using current published configuration. Legacy runs created before this marker retain their existing recovery behavior. No historical credentials are persisted in checkpoints. Agent Search remains unconnected and Fetch remains disabled.

## Verification (local, Node 22.23.2)

- Server unit selection excluding five listener-dependent files: 489 passed, 2 existing PostgreSQL-dependent skips. Excluded: appUpdates, errorLogging, agentConversation, communityBookmarks, feedbackFlow.
- Final targeted lifecycle/provider/runtime/Agent architecture regression: 42 passed. Includes isolated SQLite rollback/reopen, credential keep/replace/clear, publish conflict, exact-version mock probes, cancellation, edit-after-test, request acceptance before publish and later requests.
- Admin: 136 passed across 20 files; TypeScript and oxlint passed without warnings. Service probe, cancel, publish confirmation, duplicate click and late response paths use mocked API calls.
- Server TypeScript passed. Server and admin production builds passed.
- Contracts: typecheck, 17 tests, generated OpenAPI checks and both compatibility checks passed.
- Module boundaries, frozen SQLite boundary, PostgreSQL generated baseline (120 tables/192 foreign keys), Drizzle schema checks and `git diff --check` passed.
- Independent read-only code review found and prompted fixes for inconsistent legacy GET version reads, initial revision regression, inherited queued snapshots, misleading test labels, and false tool impact changes; final review found no remaining explicit blocker.

## Local verification limitations (before PR CI)

A test runner was initially invoked from repository root and collected listener-dependent tests. Local `listen(127.0.0.1)` failed with sandbox `EPERM`; the process was stopped. No different port, tunnel, alternate listener or permission escalation was used to bypass this restriction. HTTP integration, full Agent conversation/e2e, browser visual validation and the HTTP-dependent full migration rehearsal are therefore not verified. Their tests were updated where necessary, but are not claimed passing.

The real PostgreSQL lifecycle/restart integration script was updated but not executed; only repository transaction contract and schema/migration unit checks ran. No real provider/media capability, paid API, production deployment, APK, push, PR, merge or Issue-state change was performed. Existing local dependency caches were copied/relinked into the isolated checkout; no software was installed and lockfiles were not changed. A clean lockfile-based CI run is still needed in an environment that permits the omitted integrations.


## PR CI coverage

PR #271 extends the existing `ai-resource-integration` job without reducing its checks. It runs the real HTTP/Agent suites against a local mock provider, including two calls in one request across a publication and an explicit retry after fail-closed automatic recovery. The isolated PostgreSQL cluster checks draft isolation, stale probe rejection, publish CAS, credential snapshots, atomic failure rollback and actual cluster restart. All fixtures use synthetic accounts/keys and no paid provider. Test gates have bounded waits and release on failure. The PR check results are the source of truth for remote execution; the local limitations above are retained as historical evidence.
