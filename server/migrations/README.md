# 数据库迁移

此目录存放 SQL 迁移文件，用于生产环境的手动迁移。

## 命名规则

```
<序号>_<描述>.up.sql     # 正向迁移
<序号>_<描述>.down.sql   # 回滚迁移
```

示例:
```
001_init.up.sql
001_init.down.sql
002_add_user_status.up.sql
002_add_user_status.down.sql
```

## 使用方式

```bash
# 执行迁移
./scripts/migrate.sh up

# 回滚迁移
./scripts/migrate.sh down

# 查看状态
./scripts/migrate.sh status
```

## 注意事项

- dev/test 环境由 GORM AutoMigrate 自动处理，无需手动迁移
- prod 环境请先备份数据再执行迁移
- 回滚操作会丢失数据，请谨慎执行
