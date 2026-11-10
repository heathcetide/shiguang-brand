# Shared API contracts

`@dietdigidose/contracts` is the single source of truth for API boundary schemas shared by the Express server and Expo client. Inventory is the first migrated vertical.

## Adding or changing an endpoint

1. Define strict request and response Zod schemas in the domain module and export inferred TypeScript types.
2. Use the request schema in the Express `validateBody` boundary and parse the response before sending it.
3. Pass the response schema to the Expo `requestJson` helper; parse outgoing mutation input with the shared request schema.
4. Add the operation and schemas to `src/openapi.ts`, then run `pnpm --dir packages/contracts openapi:generate`.
5. Run `pnpm -w contracts:check`. Pull requests compare the versioned artifact with the base branch and reject removed paths, operations, fields, response requirements, enum values, and changed types.

Intentional breaking changes require a new versioned endpoint or contract artifact and a documented migration window; do not weaken the compatibility gate.
