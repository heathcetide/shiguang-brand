# #261 — integrated resource and service administration

This local integration starts at `15b0102390ea65970ef54629638042219ae1930f` and applies UI `6d20a554fe5f9dc870ccf7aee19bbf6cc4273e11` and Search adapter `65f86fe0e87a42a95794f390bc2732b04858819c` in a separate worktree. The original branches remain unchanged. It supersedes the earlier UI-only document's temporary tool-field editing blockade and generic-400 limitation. It does not complete #261 or imply deployment.

## Pages and write contract

- `/admin/ai-providers` manages model connections and DeepSeek tool resources. Model capabilities are declarations, not remote verification. Tool resources use the fixed official endpoint, a tool list, and no model field. New tool resources declare Search; imported Fetch declarations are preserved but cannot enable Fetch execution.
- `/admin/ai-services` edits capability defaults and seven existing model services, plus Search default/disabled/inherit/explicit binding. It displays last-read effective configuration/source, separately from unsaved edits. Fetch is explicitly unavailable and its existing fields are preserved unchanged. Search is an isolated adapter: no Agent automatic invocation or execution route exists.
- `/admin/ai-config` remains the old settings/persona/budget editor. `/admin/voice-packs` remains available. Runtime budgets, role inheritance, TTS fallback, local voice policy, approvals and business execution are not replaced.

Saving replaces the document and applies to subsequent configuration reads immediately. There is no draft/test/publish or request-version lifecycle. The writable mapper includes only schemaVersion/revision/resources/defaults/services; it retains optional Search/Fetch fields and tool resources without sending GET-only metadata, masks, effective results or raw keys. Unknown future fields still fail closed. A pure mapping module is shared with the real HTTP contract test; HTTP calls live separately in `aiResourcesApi.ts`.

Connections and tools share credential keep/replace/clear semantics. Empty replacement is invalid, keep never echoes a saved key, clear requires confirmation and does not fall back to global credentials. Pending saves have a synchronous duplicate guard and lock editing/navigation. Cancellation before dispatch discards local edits. Late read/save completions cannot modify a new page. Uncertain failures require deliberate reread instead of automatic retry. Native unload warns but does not claim to roll back an already dispatched request.

## Backend integration fixes

`PUT /api/v1/admin/ai-config/resources` now distinguishes typed outcomes:

| HTTP | code | meaning |
| --- | --- | --- |
| 409 | AI_RESOURCE_CONFLICT | revision mismatch or atomic CAS rejection |
| 400 | AI_RESOURCE_INVALID | schema, reference, capability, inherited role model or runtime policy rejection |
| 500 | AI_RESOURCE_SAVE_FAILED | storage/audit/readback failure; reread to establish outcome |

Messages are fixed and contain no payload, provider reply, secret or storage exception. The server remains authoritative after the UI preflight revision read.

The existing authenticated `GET /admin/ai-config` adds `editable`, a strict whitelist of non-secret stored URL/model/role/persona fields. Empty values stay empty, preserving inheritance. It also adds boolean `credentialState` for independently stored legacy credentials. It never spreads the settings map or resource document; masks are fixed, not secret prefixes/suffixes. Existing effective display fields remain compatible.

The old editor populates from `editable` and sends only changed fields. Blank key inputs are omitted; folding the independent-provider section only changes presentation. Changing a budget no longer erases independent keys or copies an effective resource model into legacy storage. Explicit empty model/role fields restore legacy fallback; empty persona restores its built-in default. Save failure locks retry until reread, and a missing raw-editable interface fails closed.

## Verification and independent review

The installed host is Node **25.2.1**. Homebrew and the checked nvm/fnm/mise/asdf/volta/pnpm locations did not contain Node **22.23.2**. This report makes no Node 22 verification claim. Existing dependency directories were reused through ignored symlinks; no dependency or lockfile changes were made. Run binaries through `node .../node_modules/<package>/...` with these symlinks, because generated `.bin` wrappers resolve relative paths against the new worktree.

From the integration root:

```sh
NODE_OPTIONS=--no-experimental-webstorage node admin/node_modules/vitest/vitest.mjs run --root admin
node admin/node_modules/typescript/bin/tsc -b admin
node server/node_modules/typescript/bin/tsc --noEmit -p server
node admin/node_modules/oxlint/bin/oxlint admin/src admin/scripts
node admin/node_modules/vite/bin/vite.js build admin
node --import ./server/node_modules/tsx/dist/loader.mjs --test server/test/aiResourcesHttp.test.ts
node --import ./server/node_modules/tsx/dist/loader.mjs --test server/test/deepseekTools.test.ts server/test/aiRuntimeModule.test.ts server/test/aiProviderCredentials.test.ts server/test/agentArchitecture.test.ts server/test/agentOperationsModule.test.ts server/test/agentProposalClock.test.ts
```

Results:

- Admin: **124 tests / 19 files passed**; includes 26 resource UI/mapping cases and 4 old-editor cases. Covers cancellation, duplicate submissions, late responses, tool field preservation, capability selection, all credential actions, clear confirmation, unsupported future data, 409 handling and uncertain outcomes.
- Real HTTP: **3 scenarios passed** using the real application/authentication, random loopback port and fresh temporary SQLite. The tests import the actual UI projection/difference functions, then send their output over HTTP. They verify untouched tools/defaults/bindings, keep/replace/clear in storage, two simultaneous same-revision PUTs yielding 200/409, invalid model/tool bindings yielding 400, trigger-induced storage failure yielding 500 with rollback, and old-budget-only changes preserving all legacy fields/keys. Authorization and response/error/audit redaction are included. These are not full-browser save tests; component interactions are tested separately with mocked transport.
- Focused adapter/runtime/credential/Agent safety regression: **46 tests passed**. Search transport is synthetic; Fetch makes no calls. Existing SQLite persistence/rollback and PostgreSQL transaction mocks are included; no live PostgreSQL run was performed in this integration.
- Both TypeScript checks, admin oxlint (no warnings), production Vite build and `git diff --check` passed.
- Independent read-only code reviewer found no blocking issues, independently passed **30 focused UI tests** and **3 real HTTP scenarios**. Review-found tool-clear confirmation, blank legacy key overwrite and uncertain-write replay risks were fixed. Independent runs overlap the counts above, not additional test coverage.

A sandboxed initial HTTP run stalled and was cancelled. The completed runs had loopback permission and cleaned their dedicated databases. No paid API, real credential, existing database or online configuration was used. A generated local test JWT key was removed rather than committed.

## Visual evidence and remaining boundaries

`cd admin && node scripts/preview-ai-resources.mjs` starts a loopback-only read-only demo at `127.0.0.1:5186`. It intercepts all `/api/` requests, rejects writes and uses a fake token with synthetic configuration. The tool endpoint is display-only; nothing calls it. Never deploy this harness.

Screenshots are outside Git at `/Users/adlin/Documents/Codex/2026-10-23/task/evidence-261-integrated/`:

- `providers-top.png`, `providers-detail.png` — model and tool provider forms.
- `services-top.png`, `services-detail.png` — Search inheritance/status and Fetch unavailable.
- `services-mobile-top.png`, `services-mobile-detail.png` — 390×844 layout.

Desktop viewport: 1440×1200. All inspected views loaded with no horizontal overflow or browser exceptions. Only demo data is shown. Test/build logs are in the same evidence directory.

This limited change is ready for the next PR/review step, subject to project CI (especially pinned Node 22). No PR has been created, no remote merge/push or deployment performed. Real provider/DeepSeek account availability, live PostgreSQL integration, device regressions, draft/publish and request-version pinning remain unverified or unimplemented. Fetch remains disabled; Agent automatic external search is intentionally absent. #261 remains incomplete.
