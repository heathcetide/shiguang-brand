#!/usr/bin/env bash
# Run Go's SQLite + PostgreSQL matrix without touching an application database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${GO_TEST_POSTGRES_URL:-}" ]]; then
  export GO_REQUIRE_POSTGRES=1
  exec go -C "$ROOT/server-go" test "$@" ./cmd/... ./internal/...
fi
if [[ -n "${PG_BIN:-}" ]]; then
  export PATH="$PG_BIN:$PATH"
elif [[ -d /opt/homebrew/opt/postgresql@16/bin ]]; then
  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
fi
for tool in initdb pg_ctl; do
  command -v "$tool" >/dev/null || { printf 'Install PostgreSQL 16 tools or set GO_TEST_POSTGRES_URL. Missing: %s\n' "$tool" >&2; exit 1; }
done
# Only this newly created directory is removed. No TCP listener or app DB is used.
WORK="$(mktemp -d /tmp/ddd-go-pg.XXXXXX)"
cleanup() {
  pg_ctl -D "$WORK/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT INT TERM
initdb -D "$WORK/data" -U go_test -A trust --no-locale -E UTF8 >"$WORK/init.log" 2>&1
pg_ctl -D "$WORK/data" -l "$WORK/postgres.log" -o "-k $WORK -p 55441 -c listen_addresses=''" -w start >/dev/null
export GO_TEST_POSTGRES_URL="postgresql://go_test@/postgres?host=$WORK&port=55441"
export GO_REQUIRE_POSTGRES=1
go -C "$ROOT/server-go" test "$@" ./cmd/... ./internal/...
