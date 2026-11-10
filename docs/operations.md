# Staging 与生产运维手册

> 本手册维护部署目标和操作步骤，具体环境状态与有日期的执行证据见[状态导航](status.md)。staging/production 运行时目标是 PostgreSQL 16 + Drizzle；SQLite 仅保留本地兼容和最终迁移/回滚窗口。完成发布阻断项之前，本手册是部署目标和演练步骤，不代表仓库已经具备公开生产能力。

## 部署要求

- API 与 worker 独立运行并共享 PostgreSQL；worker lease 和业务幂等允许安全重启，扩容仍须先测量连接池和锁竞争。
- 显式设置 `DATABASE_DRIVER=postgresql` 与服务端 `DATABASE_URL`，PostgreSQL 数据目录必须使用持久卷。数据库、备份和上传媒体都视为用户数据。
- staging 与 production 使用不同数据库、JWT、管理员密码、AI 密钥、域名和备份目录，禁止复制真实生产健康数据到 staging。
- 演示用户、社区内容和高互动数据仅在 `ENABLE_DEMO_SEED=1` 时生成；staging 与 production 必须保持为 `0`。
- migration 账号与应用账号分离；应用账号不得拥有 schema/role 管理权限，API 启动只校验 schema，不执行 DDL。

## 环境与网络

以 `server/.env.example` 为字段清单，并至少确认：

- `NODE_ENV=production`
- `DATABASE_DRIVER=postgresql`，`DATABASE_URL` 从服务端密钥存储注入；连接池上限与数据库容量一致
- `JWT_SECRET` 为随机且不少于 32 个字符的独立密钥
- `ADMIN_INITIAL_PASSWORD` 不少于 12 位，只用于首次创建管理员；首次登录后立即修改
- `CORS_ORIGINS` 只列出 App Web 端和管理后台的 HTTPS Origin，不使用通配符
- TLS 在可信反向代理终止时设置 `TRUST_PROXY=1`、`REQUIRE_HTTPS=1`，并由代理覆盖写入 `X-Forwarded-Proto`
- `ERROR_MONITOR_WEBHOOK_URL` 指向受控监控接收端
- `SUPABASE_MEDIA_BUCKET` 指向 staging 独立的 public 社区媒体 bucket，service-role key 只进入服务端密钥存储；未配置时图片发布应明确失败

外部内测客户端必须使用 HTTPS staging。发布候选包不得包含 HTTP 后端地址、`EXPO_PUBLIC_ALLOW_INSECURE_HTTP=1`、iOS 任意网络加载或 Android cleartext 放行。先从外部网络调用 `/api/v1/health`，再验证客户端连接；不要只在服务器本机测试。

## 敏感数据与 AI

- AI 密钥只保存在服务端环境变量或受控管理设置中，绝不放入 `EXPO_PUBLIC_` 变量。
- 当前 AI 流程会处理健康档案、过敏/用药上下文并保存完整用户与助手消息。外部内测前必须让隐私政策、首次告知、供应商说明、保留期限、管理员权限和删除流程与实际行为一致。
- 日志和核心漏斗不记录登录凭据、Token、完整 AI 文本或不必要的健康字段。使用匿名用户标识和 requestId 定位问题。
- 管理员读取用户对话属于高敏感操作，应最小授权、记录审计，并能够响应导出和删除请求。

## 全新数据库与迁移验收

每个候选版本都要同时验证“空 PostgreSQL 初始化”和“旧库迁移/升级”，不能只在开发者现有数据库上启动成功：

1. 用 migration 账号对空目标执行 `node dist/apply-postgres-schema.js`，按该提交的 [baseline manifest](../server/src/storage/database/postgres/baseline-manifest.json)、[Drizzle migrations](../server/drizzle/) 与运行时 schema 校验核对业务表和 PostgreSQL 扩展表；不要沿用旧文档的固定表数。
2. 用无 DDL 权限的应用账号启动 API/worker，验证 health 中 `databaseDriver=postgresql`、注册、登录、库存和饮食记录。
3. 提交一条自定义食物，使用管理员完成审核，再打开管理统计。
4. 对脱敏上一候选 SQLite 快照执行 `docs/postgresql-migration.md` 的只读 export、schema、重复 import 和全量 validate。
5. 对迁移后的目标重复核心读取、写入、并发幂等与管理统计，并验证 checkpoint 恢复。
6. 保留 migration 日志、提交 SHA、Drizzle journal、该候选实际表清单和执行结果；任何差异都阻断候选发布。

CI 会在干净 PostgreSQL 16 上完成全量 schema/import/validate、所有仓储行为、API runtime health、最小权限和回滚检查；候选发布仍需按上述步骤在实际 staging 完成。

## PostgreSQL 备份

服务运行期间使用 PostgreSQL custom archive，并始终显式写入权限受限、独立于应用容器的目标：

```bash
docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec -T postgres \
  pg_dump --username=dietdigidose --dbname=dietdigidose --format=custom --no-owner --no-acl \
  > /secure-backups/dietdigidose/staging.dump
sha256sum /secure-backups/dietdigidose/staging.dump
```

备份应加密、限制访问、每天执行并异地保留至少 30 天。备份文件含用户及健康数据，不得进入 Git、构建产物或公开对象存储。

每次备份记录时间、版本、文件大小、校验值和保存位置。只有实际恢复并通过验证的备份才算可用。

同时记录源 PostgreSQL 版本、Drizzle migration、实际表数量与表清单、关键表行数和 archive 清单：

```bash
pg_restore --list /secure-backups/dietdigidose/staging.dump > /secure-backups/dietdigidose/staging.list
docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec -T postgres \
  psql --username=dietdigidose --dbname=dietdigidose --tuples-only --command \
  "SHOW server_version; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'; SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM inventory_items;"
```

## PostgreSQL 恢复与回滚

1. 停止所有 server 实例，确认没有进程继续写入数据库。
2. 校验备份来源、大小、权限、校验值和可用磁盘空间。
3. 在独立 PostgreSQL 实例/volume 创建空目标；备份包含 schema 和数据，恢复前不要应用 migrations。恢复演练不得连接当前服务数据库。优先使用 `DATABASE_RESTORE_URL` 与 `pnpm --dir server db:postgres:restore <备份目录>`，该工具拒绝非空目标并核验清单与 SHA。

```bash
pg_restore --dbname="$ISOLATED_RESTORE_URL" --single-transaction --exit-on-error --no-owner --no-acl \
  /secure-backups/dietdigidose/staging.dump
```

4. 用应用账号启动与该数据版本兼容的隔离 API/worker；应用启动不会自动迁移 schema。
5. 调用 `/api/v1/health`，再依次验证登录、库存读取、写入、管理统计和媒体访问。
6. 记录恢复耗时和数据时间点。若验证失败，保持现网写入冻结，恢复目标快照或上一份已验证备份，并回滚应用版本。

至少在首次外部内测前、每次 schema 变更后和公开发布前完成一次隔离恢复演练。

旧版 SQLite 最终切换前，仓库演练入口仍用于验证 SQLite 在线备份、上一候选 migration、恢复安全副本与 export 来源完整性；PostgreSQL 上线后的日常备份必须使用上面的 `pg_dump`/`pg_restore` 演练。

先将 `PREVIOUS_MIGRATION_VERSION` 设为上一候选记录中的实际 SQLite migration 版本；脚本默认值是历史测试基线，不能代替候选升级起点。

```bash
pnpm --dir server db:rehearse -- \
  --owner=release-owner \
  --previous-version="$PREVIOUS_MIGRATION_VERSION" \
  --output=/secure-reports/database-rehearsal.json
```

报告不得使用真实用户数据，也不得提交数据库、媒体或密钥。候选验收只接受从待发布提交运行的报告；CI 演练用于阻止代码回归，不能代替实际 staging 的持久卷、权限、备份存储与负责人验收。

## 后台 worker

通知投递与媒体清理不随 API 进程启动。部署必须独立运行 `node dist/worker.js`；staging Compose 已包含共享同一 PostgreSQL 的 `worker` 服务。API 与 worker 可以独立重启，worker 故障不会改变 API 健康状态。

worker 默认启动后立即执行一次，之后每小时执行；可用 `WORKER_INTERVAL_MS`、`WORKER_TASK_TIMEOUT_MS`、`WORKER_LEASE_MS` 和 `MEDIA_CLEANUP_BATCH_SIZE` 调整。PostgreSQL 原子 lease 防止多 worker 同时领取同一类任务，通知的投递预留和媒体清理 job claim 继续提供业务幂等保护。

计划维护分为 `plan-maintenance-dispatch`（生成到期每日事件、合并已提交事件，30秒去抖）和 `plan-maintenance-process`（领取任务、局部重算、事务应用与保存诊断），均包含在默认任务集合。可单独运行低延迟维护进程：

```bash
WORKER_TASKS=plan-maintenance-dispatch,plan-maintenance-process WORKER_INTERVAL_MS=30000 node dist/worker.js
```

`PLAN_MAINTENANCE_EVENT_BATCH_SIZE` 默认200，`PLAN_MAINTENANCE_JOB_BATCH_SIZE` 默认10；每个业务任务最多尝试3次，输入冲突重新计算，过期租约可恢复。`plan_maintenance_jobs.result_json` 保存变更与诊断（输入指纹、规则版本、数量检查、模型调用数和费用）。每日检查仅在账户明确启用并设置时间/时区后入队，停机漏跑的旧日期合并为当天检查，同一当地日期不重复生成。关闭后未处理的每日事件只记录跳过。用户可在餐次计划页的“每日计划检查”设置时间与时区；可从设置页打开最近20次检查结果；需要决策的建议/核对事项和最终失败会进入消息中心，相同事项去重，小调整只记日志；设备推送仍待接入。默认综合worker仍每小时轮询，低延迟部署需采用上面的独立配置。

手动重跑全部任务或单项任务：

```bash
pnpm --dir server worker:run
pnpm --dir server worker:run -- --task=notifications
pnpm --dir server worker:run -- --task=media-cleanup
```

每批执行会写入 `worker_task_runs`，包含开始/结束时间、耗时、处理量、成功量、失败量和脱敏错误；管理员可用 `GET /api/v1/admin/worker-runs` 按 `task`、`status` 分页查看批次和当前 lease，`worker.task.*` 单行 JSON 日志可交给日志平台查询。失败会发送到 `ERROR_MONITOR_WEBHOOK_URL`，未完成媒体清理保持 `pending`，下一批自动重试。若 worker 异常退出，等待 `WORKER_LEASE_MS` 到期后再手动重跑；不要直接删除 `worker_task_leases`，除非已确认旧进程停止且记录了处置原因。

## 候选发布检查

记录提交 SHA、client/server/admin 版本、数据库版本、构建号、后端域名和备份编号，然后执行：

```bash
node --version  # 必须为 v22.23.2
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm -w validate:toolchain
pnpm install --frozen-lockfile
pnpm -w lint:all
pnpm -w test:all
pnpm -w build:client
pnpm -w build:server
pnpm -w build:admin
pnpm -w audit:prod
```

随后完成：

- 空库初始化、旧库升级和备份恢复三类演练；
- iOS/Android 同一提交候选包的全新安装、升级安装和核心闭环；
- HTTPS、CORS、401、限流、权限拒绝、弱网、AI 超时和服务端重启恢复；
- 普通用户越权、公开身份泄露、AI 数据告知与账号删除检查；
- 管理员初始密码修改、错误监控通知和 requestId 检索；
- 明确回滚负责人、触发条件、上一稳定包与上一份已验证备份。

完整步骤见 [真机验收与小范围内测清单](device-beta-checklist.md)。P0 未清零、核心 P1 未回归、备份不可恢复或客户端仍允许明文传输时，停止发布。

## 监控与事件处置

服务端日志为单行 JSON，使用服务端生成的 UUID `requestId` 串联响应头、错误响应、请求日志与错误事件；客户端传入的 `X-Request-Id` 不被复用。排查时请使用响应头 `X-Request-Id`。

通用 HTTP 异常事件 `api.unhandled_error` 只含时间、级别、事件名、服务端 requestId、固定方法名、代码声明的 router 挂载模板、Express 声明的路由模板、`INTERNAL_ERROR`、白名单诊断码与 `reportingLocations`。`router` 是应用注册路由时显式传入的挂载模板（例如 `/api/v1/inventory`），不从请求推导，保证不同子系统的 `/` 可区分；未标记的顶层路由使用 `[root]`。`route` 为当前 router 内的模板（例如 `/records/:id`），不拼接可能带实参的挂载路径；尚未匹配路由或非字符串模板时为 `[unmatched]`。`http.request` 同样使用 `route` 替代原来的原始 `path` 字段，日志查询需相应更新。

不读取或发送未知异常的 message、stack、cause、嵌套对象，也不包含请求 URL、查询、正文或认证头。未知诊断码为 `UNHANDLED_EXCEPTION`，不是依靠字符串正则脱敏。`reportingLocations` 是运行时新采集的**报告边界**代码位置，仅含项目相对文件、行列号，不是原始抛错堆栈；这是为避免伪造堆栈文本夹带隐私而保留的明确诊断限制。

配置 `ERROR_MONITOR_WEBHOOK_URL` 后，控制台与监控端复用同一条序列化事件，以 3 秒超时投递且不跟随重定向。网络错误、超时、非成功状态只记录关联 requestId 与固定 `ERROR_MONITOR_DELIVERY_FAILED`，不读取或记录远端正文、状态文本、URL 或错误对象。未配置时仅写控制台。

此边界针对通用 HTTP 异常与请求关联信息，不代表业务专用日志、worker 或 AI 持久化诊断已完成全面审计。AI 调用可记录模型、Token 用量、耗时、估算费用和失败原因，但不得记录 API 密钥或完整敏感上下文。既有 AI 管理端诊断见 #21；AI 单价通过 `AI_INPUT_COST_PER_MILLION_USD` 和 `AI_OUTPUT_COST_PER_MILLION_USD` 配置。

注册、登录、库存录入和完成烹饪会写入仅含 HMAC 匿名标识与事件名的漏斗事件，不附带登录标识、IP、食材、健康数据或 AI 文本。管理员可通过 `GET /api/v1/admin/funnel?days=30` 查看 1～90 天的聚合事件数与匿名用户数。

登录失败、邮箱注册、社区分享码、匿名外部食品查询与高成本 AI 请求的限流桶保存在主数据库中，不依赖单进程内存；共享同一数据库的服务实例会看到同一配额。默认 AI 与食品查询上限分别通过 `AI_RATE_LIMIT`、`FOOD_SEARCH_RATE_LIMIT` 配置，窗口均为 15 分钟。邮箱注册使用 `REGISTER_RATE_LIMIT`、`REGISTER_GLOBAL_RATE_LIMIT` 和 `REGISTER_RATE_LIMIT_WINDOW_MS`，社区分享使用 `COMMUNITY_SHARE_RATE_LIMIT` 与 `COMMUNITY_SHARE_RATE_LIMIT_WINDOW_MS`；生产环境启用 `TRUST_PROXY=1` 时，反向代理必须覆盖而不是透传客户端伪造的转发头。

发生疑似越权、公开登录标识、健康数据泄露、批量重复写入或数据库损坏时：停止新候选分发和相关写入，保存日志与时间线，轮换受影响密钥，评估受影响用户与数据范围，从已验证备份恢复，并在恢复服务前完成根因和回归检查。
