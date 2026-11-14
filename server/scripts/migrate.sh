#!/usr/bin/env bash
# DietDigiDose 数据库迁移脚本
# 用法:
#   ./scripts/migrate.sh up      # 执行迁移
#   ./scripts/migrate.sh down    # 回滚迁移
#   ./scripts/migrate.sh status  # 查看迁移状态
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

CMD="${1:-up}"

case "$CMD" in
  up)
    echo "→ 执行数据库迁移..."
    # dev/test 环境自动迁移（AutoMigrate），prod 环境手动执行 SQL
    # 如需手动迁移，在此处添加 SQL 文件执行逻辑：
    # for f in migrations/*.sql; do
    #   echo "  应用 $f"
    #   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$f"
    # done
    echo "✓ 迁移完成（dev/test 环境由 AutoMigrate 自动处理）"
    ;;
  down)
    echo "→ 回滚迁移..."
    echo "⚠  回滚操作需要手动执行，请谨慎操作"
    ;;
  status)
    echo "→ 迁移状态..."
    echo "  dev/test: AutoMigrate 自动处理"
    echo "  prod:     需手动检查数据库 schema"
    ;;
  *)
    echo "用法: $0 {up|down|status}"
    exit 1
    ;;
esac
