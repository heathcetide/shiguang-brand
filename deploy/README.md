# Staging 部署与演练

默认后端是 **Go**，与本地 `pnpm dev` 一致。Caddy 提供管理端静态页面与 HTTPS，API、一次性迁移和可选站内扫描 worker 共用 `server/docker/Dockerfile`。`deploy/Dockerfile.server` 仅供遗留 Express 独立使用，不在默认 Compose 拓扑中。

## 切换前先确认数据边界

- **不要直接把 Go 指向旧 Express PostgreSQL 库。** 两者 schema 和状态机不是同一种表示；已识别的旧 schema 会被 Go 迁移拒绝，不能用 Drizzle migration 代替 Go migration。
- Compose 使用新的 `staging_go_postgres` 卷，**不会挂载、迁移或删除原 `staging_postgres` 卷**。这不是已有业务数据的自动搬迁；如有旧环境，必须先备份，在隔离副本中单独审查迁移、校验账号/业务/媒体引用，安排受控切换和回滚。
- 不要执行 `docker compose down -v` 来处理迁移错误，也不要通过删除旧卷来绕过 schema 检查。
- 本地 SQLite 仍默认位于 `data/dietdigidose.db`；本次没有要求开发者改用 PostgreSQL，也没有默认重置账号。

## 配置与首次部署

1. 使用 Go 1.25.1 对应的干净候选 checkout，准备 Docker Compose v2、域名 DNS、TCP 80/443 和 UDP 443。
2. 复制 `deploy/.env.example` 为 `deploy/.env`，复制 `deploy/server.env.example` 为 `deploy/server.env`。这些文件不能提交。填写真实 CORS origin、JWT 密钥、数据库 URL 和完整候选 SHA。
3. `DATABASE_MIGRATION_URL` 使用 schema 所有者；API 的 `DATABASE_URL` 使用单独的运行时账号。示例 PostgreSQL 容器的初始化所有者并不是最小权限应用账号；部署者必须创建并授权应用账号：数据库 CONNECT、schema USAGE、现有业务表的 SELECT/INSERT/UPDATE/DELETE、identity sequence 的 USAGE/SELECT，以及后续迁移对应的默认授权。不要授予运行时角色 CREATE/ALTER、角色管理或 superuser。示例不会自动创建此账号，也不证明最小权限验收已通过。
4. 从仓库根目录预检并启动数据库、执行迁移。`.env` 中的 `CANDIDATE_GIT_SHA` 必须是实际 checkout 的完整 SHA，不能用另一个提交冒充：

   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml config --quiet
   docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml up -d postgres
   docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml run --rm migrate
   ```

   迁移只建表/补列并记录校验和，不插入演示数据。新建的库没有账号或公共菜谱。按需通过安全环境注入一次性 `ADMIN_INITIAL_PASSWORD` 或只挂载到迁移容器的 `ADMIN_INITIAL_PASSWORD_FILE`，再次运行 `-migrate` 创建初始 `admin`。密码须 12–72 字节；已有同名账号不被覆盖；初始密码不要放入长期 API 环境。首次登录需改密。
5. 完成运行时角色授权后，启动应用：

   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml up -d --build
   docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml ps
   docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml logs migrate api
   ```

   `migrate` 成功后 API 才启动。API 的 `APP_DATABASE_AUTO_MIGRATE=0` 只读校验 schema，不在请求中创建表。API 不直接暴露宿主机端口，由 Caddy 访问 9090。

不要分享含密钥的完整 `compose config` 输出。`config --quiet` 仅证明配置可解析，不证明镜像构建、角色权限、持久化或 TLS 验收通过。

### HTTPS 与来源

`REQUIRE_HTTPS=1`、`CORS_ORIGINS` 和 `TRUSTED_PROXY_CIDRS` 必须匹配实际部署。Compose 的代理默认范围是 Docker 常见私网 `172.16.0.0/12`，应收窄到实际反向代理网络；使用其他 Docker 子网时显式覆盖。API 仅信任该范围内的 `X-Forwarded-Proto`。仅无凭据的健康探针可以在容器内通过 HTTP 读取 `/api/v1/health`。

## Worker 与其他能力边界

默认不开启后台扫描。显式运行：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml --profile interventions up -d worker
docker compose --env-file deploy/.env -f deploy/docker-compose.staging.yml logs worker
```

这个 profile 显式启用 `PROACTIVE_INTERVENTIONS_ENABLED=1`，每 60 秒扫描，启动先扫一次；关闭时停止该 worker。API 内嵌 worker 在部署中固定关闭，避免重复运行。

Go worker 目前只生成**站内干预候选/收件箱记录**，不实现 Express 的 Expo push 投递、媒体清理、普通通知调度或计划维护 job。这些 Express worker 不应直接挂到 Go schema 上；需要这些能力时，应将遗留 Express 环境及其数据库独立保留，待各任务完成适配和验收后再切换。本次统一的是默认运行时，不是宣称后台任务已全部对等迁移。

Go 社区媒体保存到 `MEDIA_LOCAL_ROOT` 持久卷，不会因 Supabase 变量切换到对象存储。Go 邮件恢复/验证尚无生产 SMTP 投递实现，生产返回 503，不写开发明文 outbox；不要把设置 SMTP 变量当作已启用邮件。

## 核心闭环烟测

先通过管理端准备至少一条可见的合成测试菜谱，不要用迁移自动灌入演示数据，然后从同一候选 checkout 执行：

```bash
EXPECTED_SERVER_GIT_SHA="$(git rev-parse HEAD)" STAGING_BASE_URL=https://staging-api.example.com node deploy/staging-smoke.mjs
```

部署标识缺失或不匹配时，在创建账号前失败。烟测使用临时账号录入三种合成食材，验证库存部分扣减、制作与进食分离、幂等重试、丢弃余量、旧请求不恢复余量，以及未知营养不伪造为 0。最后删除临时账号；失败报告的 `cleanup` 表明清理是否成功。不要把烟测当作真实用户业务数据或完整发布验收。

`ALLOW_HTTP=1` 只允许本机回环演练，不能用于候选 staging。`node deploy/staging-smoke.mjs` 无论成功失败均将 JSON 报告写入 stdout；失败时退出码为 1，stderr 保留诊断。启动配置无效时可只有 stderr 而没有 JSON。

## 备份、隔离恢复与回滚

Go PostgreSQL schema 使用标准 PostgreSQL 表、序列和 `go_schema_migrations`。在专门的运维环境使用 PostgreSQL 16 `pg_dump` custom archive 备份，用 `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` 恢复到**预先创建的空独立数据库**。镜像不包含备份客户端；凭据使用受限 `PGPASSFILE` 或 secret manager，不放命令历史、Git 或报告中。

数据库、媒体卷分别备份。恢复后使用匹配版本的 Go 二进制验证迁移校验和、表计数、身份序列、登录、库存、管理统计、用户隔离与媒体引用；记录完整 RTO/RPO 后再安排切换。保留原配置/库/卷，失败回到原运行时，不能在原库上使用 `--clean` 或覆盖恢复。

`server/` 中原有备份、Drizzle、内联图片迁移和 Express worker 工具属于遗留 Express 运维路径，不能在 Go 镜像中执行 `node dist/...`，也不能假定它们已验证 Go schema。旧版数据迁移背景见 [PostgreSQL 迁移说明](../docs/postgresql-migration.md)，其 Express 迁移流程不是 Go 数据转换工具。
