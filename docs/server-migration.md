# Go-only API runtime

## Current entry

- Client and admin talk to Go `:9090` only.
- Express (`server/`) has been removed from the repository.
- Local SQLite defaults to `data/dietdigidose.db` (JWT file: `data/jwt_secret.key`).

## Behavioral notes

- AI agent runs use a Go-native runtime (resume / retry / undo / media / pending approval). LangGraph is not ported.
- Plan maintenance can suggest or auto-apply recipe replacements when `plan_maintenance_settings.auto_apply` / `apply_mode` request it.
- Background tasks (`notifications`, interventions, media-cleanup, plan-maintenance) run via `server -worker` or the embedded worker in non-prod.
- PostgreSQL uses the Go-owned schema under `server/internal/db/schema`. There is no Express PG in-place converter.

## Commands

```bash
pnpm dev:server
pnpm test:go
pnpm test:go:postgres
pnpm lint:go
pnpm build:go
pnpm db:go:migrate
```

Set `DATABASE_PATH` / `APP_DATABASE_DSN` to override the default SQLite file.
