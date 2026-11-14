# Go API

客户端和管理端的默认 API，监听 `:9090`。本地 `pnpm dev` 和 staging 使用同一套 Go 业务实现；Express 上游默认关闭。路由相同不代表与 Express 的所有状态机和后台任务等价，具体边界见[迁移说明](../docs/server-migration.md)。

## 本地运行

在仓库根目录：

```bash
pnpm dev:server
pnpm test:go
pnpm lint:go
pnpm build:go
```

Go 版本以 [go.mod](go.mod) 为准（当前 1.25.1）。默认 SQLite 文件是 `data/dietdigidose.db`，会保留已有账号和数据。迁移不创建演示账号，也不设置默认管理员密码。

开发环境未设置 `CORS_ORIGINS` 时，默认允许 `http://localhost` 和 `http://127.0.0.1` 的 `8080`、`8081`、`5173`、`19006` 端口。显式设置 `CORS_ORIGINS` 会完全覆盖默认列表；生产环境不自动放行任何本地地址。若登录的 `OPTIONS` 请求返回 `403 / ORIGIN_NOT_ALLOWED`，检查白名单是否包含浏览器地址栏的完整 Origin（协议、主机和端口），修改后重启 Go API。

## 数据库与迁移

- SQLite：`DATABASE_DRIVER=sqlite`、`DATABASE_PATH=/absolute/path/app.db`。
- PostgreSQL：`DATABASE_DRIVER=postgresql`（也接受 `postgres`）、`DATABASE_URL`。
- MySQL：`DATABASE_DRIVER=mysql`（或 `APP_DATABASE_DRIVER=mysql`）、`APP_DATABASE_DSN` / `MYSQL_DSN` / `DATABASE_URL`。DSN 形如 `user:pass@tcp(host:port)/dbname?charset=utf8mb4&parseTime=True&loc=Local`；密码里的 `#` 保持字面量，不要写成 `%23`。
- `APP_DATABASE_DRIVER` / `APP_DATABASE_DSN` 的优先级高于上述共享变量及 YAML。不要把含密码的 DSN 提交进 Git。
- SQL 统一经过 `internal/dbx`；参数绑定、`RETURNING id`（MySQL 走 `LastInsertId`）、事务及元数据查询在边界内处理。业务 upsert 使用 `ON CONFLICT`，在 MySQL 上自动改写为 `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`。
- Go-owned schema 位于 `internal/db/schema/*.sql`，迁移记录与校验和位于 `go_schema_migrations`。已发布迁移不能修改；后续变更应新增版本。

```bash
# 只迁移，然后退出；只对自己明确选定的数据库执行。
pnpm db:go:migrate

# 从本地 SQLite 新建 MySQL 库并拷贝数据（密钥只走环境变量）
MYSQL_ADMIN_DSN='user:pass@tcp(host:port)/' \
MYSQL_DSN='user:pass@tcp(host:port)/dietdigidose?charset=utf8mb4&parseTime=True&loc=Local' \
SQLITE_PATH=../data/dietdigidose.db \
MYSQL_RESET=1 \
  go run ./cmd/migrate-sqlite-mysql
```

开发环境默认自动迁移；生产默认只校验，不执行 DDL。生产先用迁移账号执行 `server -migrate`，API 使用仅有 DML 权限的独立账号和 `APP_DATABASE_AUTO_MIGRATE=0`。`DATABASE_MIGRATION_URL` 只由 `-migrate` 使用。

**旧 Express PostgreSQL schema 不能直接混用。** 其 boolean/JSON/时间及状态机表示与 Go 不同，迁移会拒绝已识别的旧 schema。请使用新库，在备份副本中完成单独审查的数据迁移；本次改动不提供自动旧库转换。SQLite 旧文件只做增量建表/补列，不重建或清空已有表。

### 管理员初始化

只有 `-migrate` 显式收到 `ADMIN_INITIAL_PASSWORD` 或 `ADMIN_INITIAL_PASSWORD_FILE` 才尝试创建用户名 `admin`，要求密码 12–72 字节，并标记首次登录必须改密。文件方式优先；仅去除末尾换行。不覆盖任何已有同名账号。不要在 API 的长期环境、命令历史或 Git 中保存初始密码；完成后移除。已有管理员无需重新初始化。

生产必须显式设置至少 32 字符的 `JWT_SECRET`；不会回退到开发密钥文件。开发环境可以继续读取 `data/jwt_secret.key`。

## 测试边界

```bash
# SQLite；未显式配置测试 PostgreSQL 时，对应子测试显示 SKIP。
pnpm test:go

# macOS/Linux：已安装 PostgreSQL 16 工具时自动建私有临时集群，结束后清理。
pnpm test:go:postgres

# 也可注入专用测试服务；每个用例建随机 schema，结束后只删除该 schema。
GO_TEST_POSTGRES_URL=postgresql://... GO_REQUIRE_POSTGRES=1 pnpm test:go

# 启动真实 Go 进程，执行 20 项 HTTP 烟测并清理临时账号/数据库。
pnpm test:go:smoke
# PostgreSQL 16 工具可用时，还验证 DML-only 角色及独立 worker。
node scripts/smoke-go-runtime.mjs --postgres
```

`server -check-schema` 可只读校验版本、校验和及必要列；不启动 HTTP 服务。

CI 执行主程序及全部内部包的 `vet`、`test -race`、SQLite/PostgreSQL 矩阵和部署镜像构建/启动检查。覆盖率作为产物上传，不宣称已覆盖全部路由。

检查范围是 `./cmd/... ./internal/...`，包含主程序编译所需的 `pkg/` 依赖。`pkg/` 中未被运行时引用的可选模板尚缺依赖，不纳入当前业务门禁；不要把 `go test ./...` 的失败误报为通过，也不要为此无差别添加所有模板 SDK。

## 部署与 worker

唯一部署拓扑在 [deploy/docker-compose.staging.yml](../deploy/docker-compose.staging.yml)，见[部署手册](../deploy/README.md)。镜像从仓库根目录构建：

```bash
docker build -f server/docker/Dockerfile -t dietdigidose-go .
```

API、`-migrate`、`-worker` 共用同一可执行文件。镜像使用非 root 用户，端口与探针均为 9090。旧 `docker/docker-compose.yml` 仅包含统一拓扑，需要 Compose v2.20.3+。

- 本地可用嵌入式站内干预扫描，`APP_EMBEDDED_WORKER_ENABLED=0` 关闭；退出时取消并等待 worker。
- 部署默认无嵌入 worker；显式启用 `interventions` profile 后，独立 `server -worker` 运行站内扫描。
- Go worker（`go run ./cmd/server -worker`）已覆盖：Expo receipt/临期推送、干预扫描与投递、本地/Supabase 媒体清理、计划维护入队与诊断式处理。配置 `SMTP_*` 后生产邮件可投递；完整餐谱 recalculate 与 LangGraph agent 仍未移植。
- Go 邮箱验证/恢复尚无生产投递实现，生产明确返回 503，不写开发明文 outbox；设置 SMTP 变量不会启用它。
- 当前社区媒体 API 使用本地目录，不因设置 Supabase 变量自动切换后端。

`REQUIRE_HTTPS`、`CORS_ORIGINS`、`TRUSTED_PROXY_CIDRS` 控制 TLS、来源和代理信任。仅信任指定代理传来的 `X-Forwarded-Proto`；无凭据的健康探针允许容器内 HTTP。API 不向公网直接发布端口，由 Caddy 提供 HTTPS。

`scaffold.enabled` 保持 `false`。模板 GORM 用户表、旧 `migrations/` 与 `scripts/migrate.sh` 不是上述 Go 业务迁移入口。
