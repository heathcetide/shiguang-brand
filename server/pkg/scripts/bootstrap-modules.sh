#!/usr/bin/env bash
# Bootstrap multi-module layout for on-demand dependencies.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GO_VERSION="$(go env GOVERSION | sed 's/^go//')"
# Prefer go.mod's version if present
if grep -q '^go ' go.mod 2>/dev/null; then
  GO_LINE=$(grep '^go ' go.mod | head -1)
else
  GO_LINE="go ${GO_VERSION}"
fi

write_mod() {
  local dir="$1"
  local module="$2"
  shift 2
  mkdir -p "$dir"
  {
    echo "module ${module}"
    echo
    echo "${GO_LINE}"
    if [[ $# -gt 0 ]]; then
      echo
      echo "require ("
      for req in "$@"; do
        echo "	${req}"
      done
      echo ")"
    fi
  } > "${dir}/go.mod"
}

# Root: documentation / workspace anchor only
cat > go.mod <<EOF
module github.com/LingByte/ling-base

${GO_LINE}
EOF

# --- cache core (stdlib only) ---
write_mod cache github.com/LingByte/ling-base/cache

# --- cache drivers ---
write_mod cache/bigcache github.com/LingByte/ling-base/cache/bigcache \
  "github.com/LingByte/ling-base/cache v0.0.0" \
  "github.com/allegro/bigcache/v3 v3.1.0"
cat >> cache/bigcache/go.mod <<'EOF'

replace github.com/LingByte/ling-base/cache => ../
EOF

write_mod cache/redis github.com/LingByte/ling-base/cache/redis \
  "github.com/LingByte/ling-base/cache v0.0.0" \
  "github.com/redis/go-redis/v9 v9.21.0"
cat >> cache/redis/go.mod <<'EOF'

replace github.com/LingByte/ling-base/cache => ../
EOF

write_mod cache/memcache github.com/LingByte/ling-base/cache/memcache \
  "github.com/LingByte/ling-base/cache v0.0.0" \
  "github.com/bradfitz/gomemcache v0.0.0-20260422231931-4d751bb6e37c"
cat >> cache/memcache/go.mod <<'EOF'

replace github.com/LingByte/ling-base/cache => ../
EOF

write_mod cache/freecache github.com/LingByte/ling-base/cache/freecache \
  "github.com/LingByte/ling-base/cache v0.0.0" \
  "github.com/coocood/freecache v1.2.7"
cat >> cache/freecache/go.mod <<'EOF'

replace github.com/LingByte/ling-base/cache => ../
EOF

write_mod cache/ristretto github.com/LingByte/ling-base/cache/ristretto \
  "github.com/LingByte/ling-base/cache v0.0.0" \
  "github.com/dgraph-io/ristretto/v2 v2.4.2"
cat >> cache/ristretto/go.mod <<'EOF'

replace github.com/LingByte/ling-base/cache => ../
EOF

# --- lock core ---
write_mod lock github.com/LingByte/ling-base/lock

# --- lock drivers ---
write_mod lock/redis github.com/LingByte/ling-base/lock/redis \
  "github.com/LingByte/ling-base/lock v0.0.0" \
  "github.com/redis/go-redis/v9 v9.21.0"
cat >> lock/redis/go.mod <<'EOF'

replace github.com/LingByte/ling-base/lock => ../
EOF

write_mod lock/redlock github.com/LingByte/ling-base/lock/redlock \
  "github.com/LingByte/ling-base/lock v0.0.0" \
  "github.com/LingByte/ling-base/lock/redis v0.0.0"
cat >> lock/redlock/go.mod <<'EOF'

replace github.com/LingByte/ling-base/lock => ../

replace github.com/LingByte/ling-base/lock/redis => ../redis
EOF

write_mod lock/etcd github.com/LingByte/ling-base/lock/etcd \
  "github.com/LingByte/ling-base/lock v0.0.0" \
  "go.etcd.io/etcd/client/v3 v3.7.0"
cat >> lock/etcd/go.mod <<'EOF'

replace github.com/LingByte/ling-base/lock => ../
EOF

write_mod lock/zookeeper github.com/LingByte/ling-base/lock/zookeeper \
  "github.com/LingByte/ling-base/lock v0.0.0" \
  "github.com/go-zookeeper/zk v1.0.4"
cat >> lock/zookeeper/go.mod <<'EOF'

replace github.com/LingByte/ling-base/lock => ../
EOF

write_mod lock/consul github.com/LingByte/ling-base/lock/consul \
  "github.com/LingByte/ling-base/lock v0.0.0" \
  "github.com/hashicorp/consul/api v1.34.4"
cat >> lock/consul/go.mod <<'EOF'

replace github.com/LingByte/ling-base/lock => ../
EOF

write_mod lock/mysql github.com/LingByte/ling-base/lock/mysql \
  "github.com/LingByte/ling-base/lock v0.0.0"
cat >> lock/mysql/go.mod <<'EOF'

replace github.com/LingByte/ling-base/lock => ../
EOF

write_mod lock/postgres github.com/LingByte/ling-base/lock/postgres \
  "github.com/LingByte/ling-base/lock v0.0.0"
cat >> lock/postgres/go.mod <<'EOF'

replace github.com/LingByte/ling-base/lock => ../
EOF

# Workspace for local multi-module development
cat > go.work <<'EOF'
go 1.26.2

use (
	.
	./cache
	./cache/bigcache
	./cache/freecache
	./cache/memcache
	./cache/redis
	./cache/ristretto
	./lock
	./lock/consul
	./lock/etcd
	./lock/mysql
	./lock/postgres
	./lock/redis
	./lock/redlock
	./lock/zookeeper
)
EOF

# Drop monolithic sum; each module will regenerate
rm -f go.sum

echo "Multi-module layout written. Running go work sync / tidy..."
go work sync

MODULES=(
  cache
  cache/bigcache
  cache/freecache
  cache/memcache
  cache/redis
  cache/ristretto
  lock
  lock/redis
  lock/redlock
  lock/etcd
  lock/zookeeper
  lock/consul
  lock/mysql
  lock/postgres
)

for m in "${MODULES[@]}"; do
  echo "==> tidy $m"
  (cd "$m" && go mod tidy)
done

echo "Done."
