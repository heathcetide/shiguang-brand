# Go 主链路与迁移边界

## 当前入口

- **1A**：Go 提供简化 AI 运行时，不承诺 LangGraph checkpoint、supervisor 或 Express 的完整资源发布状态机对等。
- **2B**：客户端和管理端默认请求 Go `:9090`；Express `:9091` 是显式开启的遗留上游，默认关闭。
- staging 的 API、迁移和可选 worker 使用同一个 Go 镜像，不再默默部署为 Express。具体操作见[部署手册](../deploy/README.md)。

Go 已注册与迁移目标对应的 method/path，但**路由存在不等于完整业务行为已验收**。不能用 Express 的测试结果替代 Go 验证，也不能将下表之外的未测路由描述为全部通过。

## 本次持续验证的行为

| 范围 | 回归内容 |
| --- | --- |
| 数据库边界 | 参数绑定、插入 ID、元数据、事务回滚、取消、无行错误、SQL 架构约束 |
| 迁移 | 空库不灌入账号、重复迁移、校验和、旧 SQLite 增量补列、管理员初始化不覆盖旧账号 |
| Auth | 注册、重复标识、错误密码、登录、改密使旧 token 失效、停用账号、过期邮箱挑战、生产邮箱不可用 |
| Inventory | 账号隔离、按数量消费、幂等重试、旧版本冲突、多项扣减失败回滚、确认后批量入库 |
| Catalog | 收藏去重/权限、购物清单 UUID CRUD 和版本控制 |
| Lifestyle | 健康档案和 onboarding upsert、烹饪队列归属 |
| Social | 创建/加入/退出家庭、重复加入、签到去重 |
| Admin | 未登录/非管理员拦截、重置密码撤销会话、统计与 AI 用量数字及字段别名 |
| AI | 本机 fake provider 真 HTTP 调用、run/message 持久化、归属校验；不调用真实模型 |
| Site / Ops / Voice packs | 公开配置不泄密、更新清单筛选及不可用响应、音色目录指纹失效 |
| 跨域闭环 | 注册→入库→制作扣库存→部分进食→丢弃→幂等重试→账号清理；未知热量保持 null |
| 部署边界 | HTTPS/可信代理/CORS 测试、主程序构建、CI 镜像构建/启动检查 |

以上数据库业务测试使用临时 SQLite 和 PostgreSQL 随机 schema。CI 的独立 `go-runtime` job 强制 PostgreSQL 子测试不能跳过，执行 `test -race`，并上传覆盖率。当前测试仍不是全路由覆盖；覆盖率用于暴露缺口，不包装成完整迁移证明。

## 存储和配置

默认本地库是 `server/data/dietdigidose.db`；用户、管理员及业务数据都在 SQLite 内，不是内存数据。已有账号不因迁移而重置。

| 配置 | 用途 |
| --- | --- |
| `DATABASE_DRIVER=sqlite` + `DATABASE_PATH` | 显式选定 SQLite 文件 |
| `DATABASE_DRIVER=postgresql` + `DATABASE_URL` | Go-owned PostgreSQL 库；接受 postgres 别名 |
| `APP_DATABASE_DRIVER` / `APP_DATABASE_DSN` | 优先级高于共享变量和 YAML |
| `APP_DATABASE_AUTO_MIGRATE` | 开发默认开启；生产默认关闭，只校验版本/校验和/必要列 |
| `DATABASE_MIGRATION_URL` | 仅 `server -migrate` 使用的迁移身份 |
| `JWT_SECRET` | 生产必须显式设置至少 32 字符；开发可复用 server/data/jwt_secret.key |

业务 SQL 通过 `internal/dbx`，不直接使用原始 `sql.DB/Tx`；插入 ID 用 `RETURNING`，upsert 用 `ON CONFLICT`，元数据查询按方言实现。schema 从 `internal/db/schema/*.sql` 内嵌并记录版本/校验和；不在请求或路由注册中执行 DDL。

### PostgreSQL 的兼容范围

新的 Go schema 使用 TEXT JSON/时间、整数标记和 PostgreSQL identity 序列，以兼容现有 Go 数据表示。**这不是 Express PostgreSQL schema 的原位升级工具。** Express 使用原生 boolean/jsonb/时间类型及不同的状态机；已识别的旧 schema 会被拒绝，不能依赖换连接串自动迁移。

默认 Compose 使用新的 `staging_go_postgres` 卷，不挂载旧 Express `staging_postgres` 卷。已有业务迁移须另做备份副本、字段/状态映射、序列校准、媒体引用核验和回滚演练；本次未提供该数据转换工具，也未切换任何真实环境。

## 管理员初始化

仅显式迁移命令收到 `ADMIN_INITIAL_PASSWORD` 或 `ADMIN_INITIAL_PASSWORD_FILE` 时才创建用户名 `admin`，密码 12–72 字节，首次登录需改密，不覆盖任何已有同名账号。没有默认管理员密码。初始凭据只注入一次性迁移容器，不长期放在 API 环境。

## Worker 和未对等能力

- 路由注册不再自行创建无生命周期的 goroutine。本地默认可嵌入站内干预扫描，`APP_EMBEDDED_WORKER_ENABLED=0` 关闭，退出时取消并等待。
- 部署 API 内嵌扫描关闭。`interventions` profile 启动独立 `server -worker`，显式启用站内候选扫描，默认间隔 60 秒、启动即扫描一次。
- **不包含** Express 的 Expo 推送投递、普通通知调度、媒体清理或计划维护 job；不得直接将 Express worker 连接到 Go schema。
- Go 生产邮件验证/恢复尚无 SMTP 实现，明确返回 503，不写开发明文 outbox。
- Go 社区媒体仍使用本地目录；Supabase 环境变量不会自动开启对象存储。
- AI resources、core-loop 周投影等保持简化实现；不宣称与 Express 完整状态机对等。没有真实外部凭据的能力须单独验收。

## 命令

```bash
pnpm dev:server-go
pnpm test:go
pnpm test:go:postgres    # PostgreSQL 16 工具可用，或显式 GO_TEST_POSTGRES_URL
pnpm lint:go
pnpm build:go
pnpm db:go:migrate     # 会修改明确选定的数据库，请先备份
```

默认不反代 Express。确有遗留未迁移路径时可显式设置 `APP_UPSTREAM_EXPRESS=http://127.0.0.1:9091` 并单独启动 `pnpm dev:server`；已由 Go 注册的路径不会因为开启上游就改为 Express 处理。`scaffold.enabled` 保持 false，防止模板认证/用户表与业务接口冲突。
