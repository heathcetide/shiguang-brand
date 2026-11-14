# AI resources and business bindings — #261 phase one

> This document records its original implementation slice. For the subsequent local UI/tool integration, typed HTTP conflicts and safe legacy editing, see [integrated admin verification](ai-resources-admin-ui.md).

This is the resource/contract/resolution and compatibility phase only. It does not complete #261: the two-page admin UI, verification/model discovery, draft/test/publish workflow, request-wide version pinning, and production acceptance remain follow-up work. Saving here takes effect on subsequent configuration reads, matching the existing settings API; it is not a publish operation. No remote model calls are made during migration or saving.

## Backend boundary

The existing authenticated admin router exposes:

- `GET /api/v1/admin/ai-config/resources`: schema/revision, redacted resources, stable service catalog, effective configuration and binding source. Before migration it returns a virtual legacy document without writing.
- `POST /api/v1/admin/ai-config/resources/migrate`: atomic, idempotent creation of the legacy-reference document. It never replaces an existing resource document.
- `PUT /api/v1/admin/ai-config/resources`: full document replacement with the current `revision`. Stale updates fail. Send only `schemaVersion`, `revision`, `resources`, `defaults`, and `services`; GET-only metadata and effective results are not writable.

`resources.ts` defines the runtime-validated input/storage contracts. Resource IDs are unique. The implemented protocol is `openai-compatible`, supporting chat, vision and ASR models through the existing adapters. Catalog declarations do not prove remote availability; new connections are explicitly `unverified`. Unknown protocols, unknown services, missing resources and incompatible model/capability bindings fail validation. Search/tools and TTS are not offered as new service bindings because this phase does not add adapters.

Defaults are keyed by `chat`, `vision`, `asr`, with targets such as `{ "resourceId": "first", "model": "chat-model" }`. Every service has either a target or `{ "inherit": true }`. Chat/vision/ASR inherit their capability default. Supervisor/nutrition/recipe/operations inherit the effective chat service and retain any legacy role model override. For a newly declared connection, inherited role overrides must appear in its chat-capable model catalog; otherwise bind the role explicitly or intentionally clear the old override.

A connection contains `id`, `name`, `kind: "connection"`, `protocol: "openai-compatible"`, `baseUrl`, and `models: [{ id, capabilities }]`. Endpoints cannot include URL credentials, query strings or fragments. A credential input is one of:

- Omitted or `{ "action": "keep" }`: preserve the current secret for this resource ID. New connections start without a secret. An empty UI field must map to keep/omission.
- `{ "action": "replace", "value": "…" }`: replace with a nonempty secret; blank replacement is rejected.
- `{ "action": "clear" }`: explicitly remove it. New connection clearing does not fall back to environment/global secrets.

GET never returns `apiKey`; it returns `hasApiKey` and a fixed mask. Secrets stay in the existing server-side settings store and must receive the same database/access/backup protection as legacy AI keys. No plaintext credentials belong in client configuration, logs or audit details. There is no new encryption/key-management claim in this phase.

## Compatibility and storage

A schema-v1 document lives in `system_settings.AI_RESOURCE_CONFIG_V1`. Both database adapters use atomic conditional writes in transactions, including conflict-safe insertion for migration. There is no new SQL table/schema migration. Legacy `legacy-chat`, `legacy-vision`, and `legacy-asr` resources reference the old resolver instead of copying resolved credentials or environment defaults; subsequent old UI edits and environment changes therefore retain their original field-level precedence. All four old role models remain active when inherited. Global top-level fields stay backward compatible, including the existing TTS fallback; ASR/local-voice selection and runtime budgets/policy are unchanged.

Migration preserves all original keys and is safe to retry. Failed writes roll back; no process-local config cache needs invalidation. Reopening storage resolves the same document. To revert bindings, submit a current-revision document with the legacy defaults and inherited services; this leaves the old values available without deleting other settings. Concurrent saves use compare-and-swap against the previous raw document and reject stale revisions.

Validation covered: two connections, independent/ inherited bindings, model incompatibility, credential operations/redaction, legacy/env/role precedence, budget preservation, stale updates, real SQLite file reopen and trigger-induced rollback, and PostgreSQL adapter transaction statements with a mock client. Independent review additionally verified a dedicated local PostgreSQL 17 cluster: concurrent migration/save CAS, trigger-induced rollback, and persistence after an actual cluster restart. Real provider/device calls remain unverified.


## Independent review follow-up

Three separately reviewed fixes close concrete failures reproduced before the patches:

- Reminder cleanup retains failed cancellation IDs and recovers native routine reminders by owner; retrying disable/logout no longer loses track of reminders after a partial schedule failure.
- Diet proposals freeze omitted/relative dates from their business-clock snapshot before approval. Approval after midnight retains that date while refreshing current safety information.
- Explicitly empty credentials never fall through to a different service. Undefined vision options retain the resolved vision connection. The legacy top-level model/key/URL remain a complete legacy tuple for the old connection-test API.

The phase-one resource API is usable as the baseline for the next UI task. Its v1 resource IDs, capability defaults, service bindings, revision and credential actions are stable for this phase. GET includes read-only metadata: construct PUT explicitly from writable fields rather than round-tripping the whole GET payload. Saving applies immediately; it must not be labelled draft or publish. Search/tool adapters need an intentional contract extension in their separate task. No search capability is currently claimed.

Reproducible checks (Node 22.23.2, from `server/` unless otherwise stated):

```sh
TZ=UTC node --import tsx --test test/contextClock.test.ts test/agentProposalClock.test.ts test/aiRuntimeModule.test.ts test/aiProviderCredentials.test.ts
node --import tsx --test test/aiResourcesHttp.test.ts
node --import tsx --test test/agentArchitecture.test.ts test/agentOperationsModule.test.ts test/agentConversation.test.ts
node_modules/.bin/tsc --noEmit
# From client/: notifications, account handoff, and type/lint checks
node_modules/.bin/jest utils/notifications.test.ts contexts/AuthContext.test.tsx --runInBand
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint utils/notifications.ts utils/notifications.test.ts
```

The HTTP check uses a temporary SQLite database and loopback server. It verifies unauthenticated/ordinary/initial-password admin denial, authorized migration/save/read, stale revision rejection, credential-free responses/errors/audit summaries, and revoked-session denial. It does not make provider calls.

The opt-in `test/aiResourcesPostgres.integration.ts` deliberately refuses ordinary `DATABASE_URL`. Initialize a **fresh** dedicated `/tmp/ddd-review-pg.*` cluster with the installed PostgreSQL tools, start it with `listen_addresses=''`, its own Unix socket directory and port 55439, and create `ddd_ai_resources_review` in that cluster. Then run:

```sh
AI_RESOURCE_TEST_PG_SOCKET=/tmp/ddd-review-pg.REPLACE node --import tsx test/aiResourcesPostgres.integration.ts
# Restart only that temporary cluster, then:
AI_RESOURCE_TEST_PG_SOCKET=/tmp/ddd-review-pg.REPLACE node --import tsx test/aiResourcesPostgres.integration.ts --verify-restart
```

Stop the temporary cluster afterwards. The review used no existing development or production database. Remaining acceptance: Android/iOS physical-device scheduling and OS restrictions, real model/provider availability, and the later draft/publish/request-version lifecycle. #261 remains open.


Review verification results: the focused clock/configuration/credential command passed 17 tests; notifications plus account handoff passed 31 tests; architecture/operations/proposal-clock checks passed 22 and the loopback Agent conversation suite passed 14. The dedicated admin HTTP scenario passed. Both client and server TypeScript checks and the affected notification ESLint checks passed. PostgreSQL checks passed against the production-compatible `TIMESTAMPTZ` settings table; the dedicated cluster was stopped after verification. These counts describe separate commands and overlap where stated; they are not a claim of a complete repository test run.

Changed implementation files in the review fixes: `client/utils/notifications.ts`, `server/src/services/aiService.ts`, `server/src/modules/aiRuntime/service.ts`, `server/src/services/agent/policy.ts`, and `server/src/services/agent/runtime.ts`. Added/updated regression evidence is in `client/utils/notifications.test.ts`, `server/test/aiProviderCredentials.test.ts`, `server/test/agentProposalClock.test.ts`, `server/test/aiRuntimeModule.test.ts`, `server/test/aiResourcesHttp.test.ts`, and `server/test/aiResourcesPostgres.integration.ts`. The previous direct-route test's TypeScript errors were also corrected; runtime success alone was insufficient validation.
