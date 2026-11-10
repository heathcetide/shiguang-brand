# Client cache privacy and offline behavior

The API response cache is memory-only unless both the endpoint and audience are explicitly allowed by `client/services/api/cache.ts`. New endpoints do not inherit disk persistence.

## Persisted-data allowlist

- Public, unauthenticated recipe list responses: 24 hours; public recipe details: 7 days. Authenticated recipe results, personal submissions, favorites and library summaries are memory-only.
- Exact authenticated shopping-list and kitchenware list endpoints, and the kitchenware catalog: 24 hours. This does not change separately stored shopping edits, drafts or pending sync work.
- Personal inventory: a separate account-scoped snapshot, limited to item ID, food name/category, quantity and structured units/package sizes, expiration date, storage location, availability and concurrency version. No photo, batch code, evidence, owner information, free-form note or newly added API field is retained. Absolute lifetime: 7 days from the successful network snapshot.
- The offline auth restore record contains only account ID, username, password-presence and phone-verification state. The latter two preserve SMS-only password setup and account-deletion flows; no phone number is retained. Profile bio, photo, contact fields, calorie targets and future profile fields are memory-only. The existing token-storage mechanism is unchanged. This minimal session identity is kept until logout/account removal, rather than treated as an expiring response cache.

Health/profile/diet responses, prepared meals, insights, meal plans, household data and cooking queues are not persisted by the generic API response cache. User-authored drafts and pending submissions have their existing lifecycle, and are deliberately outside cache expiry/migration.

## Expiry and migration

Schema v3 discards the old generic query-cache namespace across accounts, not arbitrary AsyncStorage keys. Old full inventory snapshots and the unscoped recipe snapshot are discarded because their age or audience cannot be trusted. Existing auth profile records are rewritten to the minimal identity before restoring an offline session.

Maintenance runs at startup, on native foreground/web visibility, and every minute while the app is active. Expired records are also rejected on read. Access and HTTP 304 responses do not extend the retained body's original absolute deadline; a new HTTP 200 response may create a new snapshot. An expired body is never sent for conditional revalidation. The app cannot delete bytes while the operating system has suspended or terminated it: overdue records are removed on its next execution, and deletion does not promise forensic erasure from device backups.

API maintenance/writes and inventory maintenance/writes are serialized. Mutations, cache clearing, logout and account changes invalidate relevant pending writes, including reads or network responses that finish after invalidation. Account switching clears the previous account's API memory as well as disk snapshots. The existing logout/account-deletion cleanup of user-owned pending work is unchanged.

## Intentional offline UX changes

After restarting offline, health metrics, diet history, full profile fields and other memory-only responses are unavailable until a successful online fetch. Profile editing and the calorie-target editor perform a fresh server read; the app can still restore login/navigation from minimal identity and refreshes the full profile at startup and on foreground (also web reconnect) when online. Inventory remains available offline within its retention window, without photos or batch codes. A 401/403 never falls back to a saved inventory snapshot. An old installation needs one online inventory refresh after migration. Authenticated recipe pages no longer use the old device-wide fallback snapshot; public recipe caches retain their bounded offline behavior.

This is data minimization and bounded retention, not an encrypted local vault. Explicitly retained inventory and shopping data still reveal food choices to someone with access to app storage. Pending user-authored work may also contain sensitive data and is not silently deleted by this change.

## Verification

Tests exercise production API requests, inventory hooks and auth provider, plus fake-clock retention, startup/foreground/active maintenance, legacy migration, HTTP 304, logical-key hash collisions, offline errors, account isolation, same-account re-login, and delayed reads/writes during logout/cache clearing. Run `pnpm -w lint:all`, `pnpm -w test:all` and the focused client suites before merging.
