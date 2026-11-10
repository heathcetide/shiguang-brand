# SQLite to PostgreSQL migration

PostgreSQL 16+ and the generated Drizzle schema are the target database authority. The checked-in baseline covers the final result of `initDatabase()` and the checked-in SQLite migrations. Use the candidate commit's [baseline manifest](../server/src/storage/database/postgres/baseline-manifest.json) for business tables, indexes, and foreign keys, and its [Drizzle migration journal](../server/drizzle/meta/_journal.json) and runtime schema checks for PostgreSQL extensions and the full target schema. Do not reuse a table count from an older rehearsal. `server/src/storage/database/schema.ts` is the application schema entry point; the obsolete parallel schema has been removed.

The API and worker now select one database explicitly with `DATABASE_DRIVER=sqlite|postgresql`. PostgreSQL startup requires `DATABASE_URL`, validates the migrated application and LangGraph schema, and never executes runtime DDL. API and worker use the same repository composition and close their pools during graceful shutdown. For an environment migrating from SQLite, keep its source database selected until both staging rehearsals below pass. This runbook does not assert which database any live environment currently uses; see the [evidence index](status.md).

## Runtime adapter progress

The default remains SQLite for local compatibility; staging composition selects PostgreSQL. Completed driver-neutral domains are:

- Inventory: SQLite and PostgreSQL repositories, including transactions, idempotency, optimistic concurrency, and concurrent PostgreSQL integration coverage.
- User feedback: SQLite and PostgreSQL repositories with structured JSON context and PostgreSQL integration coverage.
- Food library: barcode lookup, governed local search, search-gap aggregation, and custom-food submission across SQLite and PostgreSQL repositories.
- Worker runtime: atomic multi-instance leases, run outcomes, failure persistence, and admin history across SQLite and PostgreSQL repositories.
- Personal shopping list: CRUD, optimistic version checks, soft deletion, and idempotent transactional imports across SQLite and PostgreSQL repositories.
- Health data: daily log merge semantics, profile defaults, structured health constraints, and owner-scoped deletion across SQLite and PostgreSQL repositories.
- Cooking queue: atomic capacity and duplicate guards, recipe snapshots, optimistic status transitions, and transactional reorder across SQLite and PostgreSQL repositories.
- Diet records: CRUD plus atomic cooking completion, including inventory consumption and concurrent idempotent retries across SQLite and PostgreSQL repositories.
- Inventory insights: personal/household outcome traces, atomic inventory closure, optimistic corrections, and timezone-aware weekly reports across SQLite and PostgreSQL repositories.
- Meal plans: owner-scoped plan and meal updates plus transactional shopping, cooking-queue, and diet-record execution with concurrent idempotent retries across SQLite and PostgreSQL repositories.
- Voice packs: governed catalog publication, optimistic account preferences, immutable admin revisions, revocation cleanup, status history, and audit writes across SQLite and PostgreSQL repositories.
- Kitchenware: owner-scoped assets, governed capabilities, safe substitutions, and recipe compatibility across SQLite and PostgreSQL repositories.
- Recommendations: governed candidate reads, immutable cursor snapshots, and atomic idempotent behavior events across SQLite and PostgreSQL repositories.
- Recipes: governed public discovery, personal libraries, favorites, user submissions, and transactional kitchenware requirement mapping across SQLite and PostgreSQL repositories.
- Admin recipes: catalog CRUD, review and quality transitions, coverage reporting, duplicate detection, audit writes, and transactional kitchenware mapping across SQLite and PostgreSQL repositories.
- Admin kitchenware: governed catalog CRUD, cross-account asset moderation, JSONB compatibility formatting, soft deletion, and atomic audit writes across SQLite and PostgreSQL repositories.
- Admin food assets: governed ingredient CRUD, aliases, merges, coverage reporting, UGC review, JSONB compatibility formatting, and atomic audit writes across SQLite and PostgreSQL repositories.
- Admin console: dashboard metrics, privacy-safe funnels, audit logs, AI usage and conversation diagnostics, scan jobs, recent activity, and transactional trash restoration across SQLite and PostgreSQL repositories.
- Households: membership lifecycle, optimistic owner transfer, collaborative shopping, idempotent inventory intake, shared inventory, and activity history across SQLite and PostgreSQL repositories.
- Agent runs and checkpoints: run/media/event/action metadata uses SQLite and PostgreSQL repositories; LangGraph saver selection is injected at composition time, PostgreSQL checkpoint schema is Drizzle-owned, and checkpoint rows cascade with their owning run.

Each migrated domain keeps SQL inside its driver adapter; routes and services depend only on the repository port. The boundary ratchet must be updated only when a direct SQLite call is removed or moved into one of these adapters.

## Type and value mapping

| SQLite final type/value | PostgreSQL target | Export transformation |
| --- | --- | --- |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `integer GENERATED BY DEFAULT AS IDENTITY` | Preserve IDs, then advance the identity sequence |
| Other `INTEGER` | `integer` | Identity |
| Epoch-millisecond `INTEGER` | `bigint` | Require a JavaScript-safe integer; preserve as a number |
| Boolean-designated `INTEGER` (`0`/`1`) | `boolean` | Reject values outside `0`/`1`; convert to `false`/`true` |
| `REAL` | `double precision` | Identity |
| `DATETIME` | `timestamp with time zone` | Interpret SQLite timestamps as UTC and emit ISO-8601 |
| JSON-designated `TEXT` | `jsonb` | Parse and reject invalid JSON; canonicalize object keys |
| Other `TEXT` | `text` | Identity |
| `BLOB` | `bytea` | Base64 in the archive, binary parameter on import |

The exhaustive per-table/per-column mapping is generated at `server/src/storage/database/postgres/baseline-manifest.json`. Changes are made in `server/src/storage/db.ts`/SQLite migrations only during the transition, followed by `pnpm -w database:schema:generate` and a Drizzle migration. Once the runtime cutover is complete, SQLite schema generation is deleted and Drizzle migrations become the only schema-change entry point.

The PostgreSQL checkpointer is pinned to `@langchain/langgraph-checkpoint-postgres` 1.0.5. Its schema version `4` is seeded by Drizzle migration `0001`; application startup validates that version and must not call `PostgresSaver.setup()`, because runtime DDL would bypass the migration authority. Migration archive v2 includes the canonical SQLite business tables listed by that candidate's baseline manifest plus raw typed SQLiteSaver checkpoints and pending writes. Import decodes them through the pinned LangGraph serializer, rebuilds PostgreSQL channel blobs, preserves parents/task indexes, rejects orphan Agent threads, and validates semantic checkpoint content after repeated imports.

## Commands

```bash
# Rebuild/check the final-state mapping and Drizzle baseline
pnpm -w database:schema:generate
pnpm -w database:schema:check

# Export is read-only and fails if integrity/FK checks fail or writes occur
pnpm --dir server db:postgres:migrate -- export \
  --sqlite /absolute/path/dietdigidose.db \
  --out /absolute/path/rehearsal-01

# Apply checked-in Drizzle migrations
DATABASE_URL='postgresql://…' pnpm --dir server db:postgres:migrate -- apply-schema

# Import is transactional, advisory-locked, and safe to repeat
DATABASE_URL='postgresql://…' pnpm --dir server db:postgres:migrate -- import \
  --archive /absolute/path/rehearsal-01

# Compare every canonical row, every FK, row counts, and critical aggregates
DATABASE_URL='postgresql://…' pnpm --dir server db:postgres:migrate -- validate \
  --archive /absolute/path/rehearsal-01

# Combined rehearsal; imports twice and writes migration-report.json
DATABASE_URL='postgresql://…' pnpm --dir server db:postgres:migrate -- rehearse \
  --sqlite /absolute/path/dietdigidose.db \
  --out /absolute/path/rehearsal-01
```

Archives contain production records and must use encrypted, access-controlled storage. They are not application backups and must not be committed. Delete them under the deployment retention policy after the observation window. The exporter opens SQLite read-only, runs `integrity_check` and `foreign_key_check`, records the source checksum before/after, and detects concurrent writes through SQLite `data_version`.

## Staging rehearsal record template

Run twice against production-shaped, access-controlled staging data. Attach both generated reports to the applicable migration or release acceptance issue; [#97](https://github.com/AdlinZ/DietDigiDose/issues/97) is the original migration tracking reference. The blank table below is a template, not a current environment status.

| Rehearsal | Operator | Dataset/date | Export | Schema + import | Validation | Result |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | _assign before start_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| 2 | _different shift if possible_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

Required smoke tests after each rehearsal: authentication/session versioning, inventory create/update/consume/idempotency, diet record transaction, household permissions, notification worker leases, AI run/action transactions, admin audit reads, and concurrent writes from two clients. CI already runs the complete baseline against PostgreSQL, repeats and concurrently executes the importer, checks least-privilege grants, and verifies rollback.

## Production cutover runbook

Fill the named people, approved window, measured rehearsal durations, backup URI, and rollback deadline in the release ticket before go/no-go. The estimates below are initial caps and must be replaced with the slower staging rehearsal plus 50% margin.

| Step | Accountable role | Initial cap | Action / evidence |
| --- | --- | ---: | --- |
| Go/no-go | Incident commander | 5 min | Confirm two green rehearsals, on-call coverage, target health, archive encryption, and rollback authority |
| Backup | Database operator | 10 min | Run `db:backup`, copy DB/WAL safely, inspect checksum/integrity, record immutable backup URI |
| Write freeze | Application operator | 5 min | Enable maintenance/read-only response, stop API and worker writers, confirm no active worker lease |
| Final export | Database operator | 10 min | Run read-only export; record source before/after checksums and rows |
| Target migrate/import | Database operator | 15 min | Apply Drizzle migrations, import once, run full validation; retain the report |
| Configuration switch | Application operator | 5 min | Set the approved PostgreSQL URL/role and database driver; deploy API and worker together |
| Smoke and go-live | QA lead + incident commander | 15 min | Execute critical reads/writes/permissions/concurrency smoke; disable maintenance only after sign-off |
| Observation | On-call owner | 24–72 h | Watch connection saturation, locks, write errors, p95 latency, worker leases, and data validation samples |

Use a dedicated application role with `USAGE` on the application schema; `SELECT/INSERT/UPDATE/DELETE` on application tables; and `USAGE/SELECT/UPDATE` on identity sequences. It must not own the database, create schemas, manage roles, bypass row security, or run migrations. A separate deployment role owns migrations.

### Rollback

Rollback immediately if validation differs, authentication or a critical write fails, error rate exceeds the release threshold, blocking locks persist, or the maintenance cap is exceeded. Keep the SQLite backup and old release immutable throughout the observation window.

1. Re-enable maintenance and stop PostgreSQL API/worker writers.
2. Preserve PostgreSQL logs and a forensic snapshot; do not try to merge divergent writes during the incident.
3. Restore/verify the final SQLite backup with `db:restore` and `db:inspect`.
4. Restore the previous release and SQLite configuration, start API then worker, and run the critical smoke suite.
5. Reopen traffic only after the incident commander and QA lead sign off. Document any writes accepted after the switch for an explicit reconciliation decision.

The short maintenance-window plan intentionally avoids long-lived dual-write/CDC. If measured rehearsals cannot meet the approved window, stop and design that separately rather than weakening validation.
