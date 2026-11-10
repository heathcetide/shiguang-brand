# China and Global provider profiles

The application has one business codebase. `DEPLOYMENT_PROFILE=china|global` selects server-side provider identifiers, while `EXPO_PUBLIC_DEPLOYMENT_PROFILE` exposes only the non-secret profile name to the Expo build. Business routes and services must depend on interfaces in `server/src/providers/contracts.ts`; cloud SDK imports are restricted to `server/src/providers/**` (or low-level storage infrastructure) by `pnpm -w architecture:check`.

## Current matrix

| Capability | China | Global | Failure/degradation |
| --- | --- | --- | --- |
| Media storage | local filesystem on the deployment volume | Supabase Storage | Retryable remote failure may degrade only when the caller explicitly supplies a local adapter; deletes fail closed so remote objects are not orphaned silently |
| Push notification | Expo Push | Expo Push | Inbox record remains authoritative; provider failure is recorded and retried by the worker |
| Authentication | Alibaba Cloud PNVS for phone proof, plus first-party password/JWT | first-party password/JWT | Verification rejection never falls back; unavailable providers use the shared retryable error vocabulary |
| Analytics | first-party server events | first-party server events | Product writes do not fail because analytics is unavailable |
| Map | disabled | disabled | Capability is not advertised |
| Payment | disabled | disabled | Capability is not advertised |

Maps and payments are deliberately disabled because no current core flow uses them. Enabling either requires a concrete adapter, privacy review, and profile smoke coverage; region checks must not be added to business modules.

## Runtime contract

`executeProviderOperation` normalizes failures to `unavailable`, `timeout`, `rate_limited`, `rejected`, or `invalid_response`. Only errors marked retryable can use an explicitly declared fallback. Rejected credentials, invalid input, and integrity failures never degrade. Every adapter receives an `AbortSignal`; the default deadline is 10 seconds and can be changed server-side with `PROVIDER_TIMEOUT_MS`.

Run the profile checks with:

```bash
pnpm -w provider:smoke
pnpm --dir server test:unit
```

The first command asks Expo to resolve a real public configuration for both profiles and checks that server credential names are absent. Unit tests run the same provider operation path for both selections and cover timeout, retryable fallback, and fail-closed rejection.

## Deployment and residency checklist

### China

- Keep primary user data and media on infrastructure whose physical region and subprocessors match the filed privacy notice.
- Complete ICP filing and any required public-security filing before using a mainland public domain; terminate TLS with a trusted certificate and document renewal ownership.
- Verify Android distribution-channel privacy disclosures and the applicable iOS storefront metadata.
- Confirm that every selected external endpoint is reachable from the deployment network without depending on an unapproved cross-border relay.

### Global

- Pin the database and Supabase project region; record international-transfer mechanisms and subprocessors in the privacy notice.
- Configure production domains, TLS renewal, CORS allowlists, universal/app links, and Apple/Google store disclosures for the served markets.
- Verify data deletion and export across the application database, object store, notification receipts, and external processors.

Secrets belong only in the server deployment or EAS secret store. Never create `EXPO_PUBLIC_*` variables for JWT secrets, service-role keys, API keys, access-key secrets, callback tokens, or audit-encryption keys.

## Adding a provider

1. Add the provider identifier to the appropriate selection in `contracts.ts`; do not add region branches to routes, screens, or services.
2. Implement the narrow capability interface under `server/src/providers/<capability>/<provider>.ts`. Keep vendor SDK imports inside that adapter.
3. Translate vendor errors into `ProviderOperationError`, mark retryability explicitly, honor the supplied `AbortSignal`, and redact credentials from errors and logs.
4. Add the identifier to exactly the profiles that are legally and operationally supported. Document region, data residency, domains, certificates, store disclosures, retention, and deletion behavior.
5. Add adapter contract tests and both profile smoke assertions. If the adapter supports fallback, test retryable timeout/unavailability and non-retryable rejection separately.
6. Inject secrets into the server deployment, run `pnpm -w lint:all`, `pnpm -w test:all`, `pnpm -w architecture:check`, and `pnpm -w provider:smoke`, then perform a staging probe from the target region.
