<p align="center">
  <img src="assets/logo.png" width="120" alt="DietDigiDose">
</p>

# DietDigiDose (`server-go`)

HTTP REST API 服务，基于 ling-base bootstrap 框架。本目录是 monorepo 中的 **Go 绞杀者网关**：默认监听 `:9090`，已迁移的 Express 兼容接口在本地处理，其余 `/api/v1/*`、`/media/*`、`/share/*` 反代到 Express 上游（默认 `http://127.0.0.1:9091`）。

> **生成模式: full** — ling-base 源码已复制到 `pkg/` 目录，代码由本项目维护，无外部 ling-base 依赖。

本地与客户端联调请用仓库根目录的 `pnpm dev`（同时拉起 client、server-go、Express）。模板 demo 路由（`/api/v1/users` 等）默认关闭（`scaffold.enabled: false`）。

![Go](https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)

## 功能特性

- HTTP REST API 路由 (Gin)
- 中间件链 (ling-base/middleware: RequestID / 日志 / 恢复 / CORS / 限流 / 熔断)
- 配置文件管理 (YAML，多环境，支持环境变量覆盖)
- 数据库支持 (MySQL / PostgreSQL / SQLite，GORM)
- 优雅关闭 (Graceful Shutdown)
- 健康检查分级 (/health, /live, /ready)
- 版本信息接口 (/api/v1/version)
- 结构化日志 (zap + lumberjack 轮转)
- 统一响应封装 (ling-base/common/response)
- 数据校验 (ling-base/common/validate，结构体标签驱动)
- 对象存储 (ling-base/stores，默认 local 后端，可切换 S3/OSS/COS/MinIO 等)
- 文件上传/下载 API (/api/v1/files)
- 缓存 (ling-base/common/cache，默认 memory 后端，可切换 Redis)
- 分布式锁 (ling-base/common/lock，默认 memory 后端，可切换 Redis/Etcd)
- 重试策略 (ling-base/common/retry，指数退避 + 抖动)
- Docker 容器化部署 (多阶段构建 + HEALTHCHECK)
- Docker Compose 一键编排 (App + MySQL + Redis)
- Bootstrap 启动框架 (Banner / 生命周期 / 事件)
- JWT 鉴权 (ling-base/common/jwtutil + jwtutil/gin)
- 国际化 i18n (ling-base/i18n，Accept-Language 自动检测 + 翻译文件)
- API 文档 UI (ling-base/apidocs，Scalar 主题)
- OpenAPI 3.1 spec 自动生成 (/openapi.json, /openapi.yaml)

## 内置基础设施

本项目内置以下 ling-base 模块,封装在 `pkg/` 下,以包级单例方式提供,开箱即用:

| 模块 | pkg 包 | 默认后端 | 切换方式 |
|------|--------|----------|----------|
| 对象存储 (stores) | `pkg/storage` | local（本地文件系统） | `go get stores/s3` + 修改 `storage.driver` + 在 `pkg/storage.Init()` 加 case |
| 缓存 (cache) | `pkg/cache` | memory（进程内） | `go get cache/redis` + 修改 `cache.driver` + 在 `pkg/cache.Init()` 加 case |
| 分布式锁 (lock) | `pkg/lock` | memory（进程内） | `go get lock/redis` + 修改 `lock.driver` + 在 `pkg/lock.Init()` 加 case |
| 重试 (retry) | `pkg/retry` | 指数退避 + 抖动 | 修改 `retry.*` 配置项 |
| 限流 (limiter) | middleware | 令牌桶 | 修改 `rateLimit.*` 配置项 |
| 熔断 (circuitbreaker) | middleware | 滑动窗口 + 半开探测 | 修改 `circuitBreaker.*` 配置项 |
| 降级 (fallback) | `pkg/fallback` | 返回降级响应/缓存数据 | 修改 `fallback.*` 配置项 |
| 数据校验 (validate) | — | 结构体标签驱动 | 在 DTO struct 上添加 `validate:"..."` 标签 |
| 统一响应 (response) | — | JSON 封装 + 错误码 | 自动启用 |

### 在代码中使用

```go
import (
    pkgstorage "github.com/heathcetide/DietDigiDose/pkg/storage"
    pkgcache    "github.com/heathcetide/DietDigiDose/pkg/cache"
    pkglock     "github.com/heathcetide/DietDigiDose/pkg/lock"
    pkgretry    "github.com/heathcetide/DietDigiDose/pkg/retry"
)

// 对象存储
pkgstorage.Write("avatars/photo.jpg", reader)
reader, size, _ := pkgstorage.Read("avatars/photo.jpg")
pkgstorage.Delete("avatars/photo.jpg")
url := pkgstorage.PublicURL("avatars/photo.jpg")

// 缓存
pkgcache.Set(ctx, "user:123", data, 10*time.Minute)
val, _ := pkgcache.Get(ctx, "user:123")

// 分布式锁
mu, _ := pkglock.New("order:123")
defer mu.Unlock(ctx)

// 重试
pkgretry.Do(ctx, func(ctx context.Context) error {
    return callRemoteAPI(ctx)
})
```

### 文件上传示例

```bash
# 上传文件
curl -X POST http://localhost:8080/api/v1/files/upload \
  -F "file=@photo.jpg" \
  -F "dir=avatars"

# 响应:
# {"code":0,"data":{"key":"avatars/20260107_120000_photo.jpg","name":"photo.jpg","size":102400,"publicUrl":"/uploads/avatars/20260107_120000_photo.jpg"}}

# 下载文件
curl -OJ http://localhost:8080/api/v1/files/avatars/20260107_120000_photo.jpg

# 删除文件
curl -X DELETE http://localhost:8080/api/v1/files/avatars/20260107_120000_photo.jpg
```

### User 模块 API

```bash
# 用户注册 — 用户名 + 邮箱（公开端点）
curl -X POST http://localhost:8080/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"secret123"}'

# 用户注册 — 仅邮箱（username 自动从邮箱前缀生成）
curl -X POST http://localhost:8080/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","password":"secret123"}'

# 用户登录 — 用户名（需启用 JWT）
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}'

# 用户登录 — 邮箱
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret123"}'

# 查询用户列表（支持搜索/过滤）
curl "http://localhost:8080/api/v1/users?page=1&size=20&keyword=alice&role=user&status=1"

# 获取单个用户
curl http://localhost:8080/api/v1/users/1

# 创建用户（管理员端点，可设置角色）
curl -X POST http://localhost:8080/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","email":"bob@example.com","password":"secret123","role":"admin"}'

# 更新用户
curl -X PUT http://localhost:8080/api/v1/users/1 \
  -H "Content-Type: application/json" \
  -d '{"avatar":"/uploads/avatars/1.jpg","status":1}'

# 修改密码
curl -X PUT http://localhost:8080/api/v1/users/1/password \
  -H "Content-Type: application/json" \
  -d '{"oldPassword":"secret123","newPassword":"newsecret456"}'

# 删除用户（软删除）
curl -X DELETE http://localhost:8080/api/v1/users/1
```

User 模块特性:
- 模型嵌入 `common.BaseModel`（snowflake ID + 时间戳 + 软删除 + 审计字段）
- 密码使用 `common/password` 加密（Argon2id 默认，兼容 bcrypt）
- 用户名 + 邮箱唯一索引
- 角色字段（admin/user）
- 状态字段（1=active, 0=disabled）
- 软删除（deleted_at）
- 最后登录时间记录
- 注册端点 `/api/v1/register`（公开，支持用户名+邮箱或仅邮箱注册）
- 登录端点 `/api/v1/auth/login`（公开，支持用户名或邮箱登录 + 真实密码校验）
- 改密端点 `/api/v1/users/:id/password`（需验证旧密码）
- 用户列表支持关键词搜索 + 角色/状态过滤
- 表名常量定义在 `internal/constants/tables.go`

## 快速开始

```bash
# 克隆项目
git clone <repo-url>
cd DietDigiDose

# 安装依赖
go mod tidy

# 运行（开发模式）
make run

# 测试
make test

# 竞态检测
make test-race

# 测试覆盖率
make test-cover

# 验证服务
curl http://localhost:8080/health
curl http://localhost:8080/live
curl http://localhost:8080/ready
curl http://localhost:8080/api/v1/users
curl http://localhost:8080/api/v1/version

# API 文档
open http://localhost:8080/docs
```

## 目录结构

```
DietDigiDose/
├── cmd/
│   └── server/
│       └── main.go              # 程序入口 + 应用启动逻辑
├── internal/
│   ├── configs/
│   │   ├── config.go            # 配置定义与加载（YAML + 环境变量覆盖）
│   │   └── config_test.go
│   ├── handlers/
│   │   ├── urls.go              # 路由注册（humax.Group / Gin）
│   │   ├── handler.go           # HTTP 处理器实现（系统端点 + 用户 CRUD）
│   │   ├── storage.go           # 文件上传/下载/删除 handler（调用 pkg/storage 单例）
│   │   ├── auth.go              # JWT 鉴权 handler（可选，用 ling-base/common/jwtutil）
│   │   └── handler_test.go
│   ├── middlewares/
│   │   └── middleware.go        # 项目特定中间件（限流配置等）
│   ├── models/
│   │   └── user.go              # 数据模型
│   └── types/
│       └── types.go             # 通用 DTO（请求/响应结构体、分页参数）
├── pkg/                         # 可被外部引用的通用封装（包级单例）
│   ├── storage/storage.go       # 对象存储封装（ling-base/stores，默认 local）
│   ├── cache/cache.go           # 缓存封装（ling-base/common/cache，默认 memory）
│   ├── lock/lock.go             # 分布式锁封装（ling-base/common/lock，默认 memory）
│   ├── retry/retry.go           # 重试策略封装（ling-base/common/retry）
│   └── fallback/fallback.go     # 降级封装（熔断/限流时返回降级响应）
├── configs/
│   ├── .env.example             # 环境变量参考（始终生成）
│   ├── config.yaml              # 开发环境配置
│   └── config.prod.yaml         # 生产环境配置
├── docker/
│   ├── Dockerfile               # 多阶段构建 + HEALTHCHECK
│   └── docker-compose.yml       # App + MySQL + Redis
├── docs/
│   └── README.md                # 项目文档（架构说明 + 依赖模块）
├── migrations/
│   ├── 001_init.up.sql          # 初始迁移（正向）
│   ├── 001_init.down.sql        # 初始迁移（回滚）
│   └── README.md                # 迁移说明
├── scripts/
│   └── migrate.sh               # 数据库迁移辅助脚本
├── uploads/                     # 本地文件存储根目录（stores/local 后端，自动创建）
├── skills/                      # AI 开发技能（TDD/代码审查/调试/领域建模等）
│   ├── tdd/                     # 测试驱动开发
│   ├── code-review/             # 代码审查
│   ├── code-simplifier/         # 代码简化
│   ├── codebase-design/         # 代码库设计
│   ├── diagnosing-bugs/         # Bug 诊断
│   ├── domain-modeling/         # 领域建模
│   ├── prototype/               # 原型设计
│   ├── design-md/               # 设计参考
│   ├── context7/                # Context7 文档查询
│   └── find-skills/             # 技能发现
├── i18n/
│   └── translations/            # 翻译文件（messages.en.json / messages.zh-CN.json）
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI (test + lint + build)
├── .air.toml                    # Air 热重载配置
├── .dockerignore                # Docker 构建忽略文件
├── .editorconfig                # 编辑器一致性配置
├── .golangci.yml                # golangci-lint 配置
├── CHANGELOG.md                 # 版本变更记录
├── CONTRIBUTING.md              # 贡献指南
├── SECURITY.md                  # 安全策略
├── LICENSE                      # MIT 许可证
├── Makefile                     # 构建命令
├── .gitignore
├── go.mod
└── README.md
```

## 配置

### 配置文件

YAML 配置文件位于 `configs/` 目录。开发环境用 `config.yaml`，生产环境用 `config.prod.yaml`。

### 环境变量覆盖

所有配置均可通过环境变量覆盖（优先级高于配置文件）。格式：`APP_<SECTION>_<FIELD>`。

| 环境变量 | 说明 | 示例 |
|----------|------|------|
| `APP_APP_NAME` | 应用名称 | `myapp` |
| `APP_APP_ENVIRONMENT` | 运行环境 | `prod` |
| `APP_SERVER_PORT` | 服务端口 | `8080` |
| `APP_DATABASE_DRIVER` | 数据库驱动 | `mysql` |
| `APP_DATABASE_DSN` | 数据库连接串 | `user:pass@tcp(host:3306)/db` |
| `APP_REDIS_ADDR` | Redis 地址 | `redis:6379` |
| `APP_JWT_SECRET` | JWT 密钥 | `your-secret-key` |
| `APP_JWT_ENABLED` | 启用 JWT | `true` |
| `APP_DOCS_ENABLED` | 启用 API 文档 | `false` |
| `APP_RATELIMIT_ENABLED` | 启用限流 | `true` |
| `APP_RATELIMIT_RPS` | 限流 RPS | `100` |

## 部署

### Docker

```bash
# 构建镜像（注入版本信息）
docker build -f docker/Dockerfile \
    --build-arg VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo "dev") \
    --build-arg BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
    --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
    -t DietDigiDose .

# 运行容器（非 root 用户运行）
docker run -p 8080:8080 --rm DietDigiDose
```

### Docker Compose

```bash
# 完整启动（app + mysql + redis）
make docker-up
# 或: docker compose -f docker/docker-compose.yml --profile full up -d

# 只启动开发依赖（mysql + redis，本地 go run 调试时用）
make dev-deps
# 或: docker compose -f docker/docker-compose.yml --profile dev up -d

# 停止
make docker-down
```

Compose 使用 profiles 分离环境：
- `--profile dev`: 只启动 mysql + redis（本地开发调试）
- `--profile full`: 启动 app + mysql + redis（完整环境）
- `--profile prod`: 同 full，但使用生产配置

### Kubernetes 提示

本项目已提供 K8s 探针端点：

| 探针 | 端点 | 用途 |
|------|------|------|
| livenessProbe | `/live` | 进程是否存活 |
| readinessProbe | `/ready` | 是否准备好接收流量 |
| startupProbe | `/health` | 启动是否完成 |

K8s Deployment 示例片段：
```yaml
livenessProbe:
  httpGet:
    path: /live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
```

### 安全注意事项

- Docker 容器以非 root 用户 (`appuser`) 运行
- 生产环境必须修改 `APP_JWT_SECRET`（至少 16 字符）
- 生产环境必须配置 `APP_DATABASE_DSN`（启动时校验）
- 定期运行 `make vuln` 检查依赖漏洞
- 不要将 `configs/.env` 或含密钥的文件提交到 git

## Make 命令

| 命令 | 说明 |
|------|------|
| `make build` | 编译项目（注入版本信息） |
| `make run` | 本地运行 |
| `make dev` | 热重载运行（air） |
| `make debug` | Delve 调试 |
| `make test` | 运行测试 |
| `make test-race` | 竞态检测 |
| `make test-cover` | 测试覆盖率 |
| `make coverage-badge` | 生成覆盖率徽章 |
| `make benchmark` | 基准测试 |
| `make vet` | 静态检查 |
| `make lint` | golangci-lint |
| `make fmt` | 格式化代码 |
| `make fmt-check` | 检查格式化 |
| `make tidy` | 整理依赖 |
| `make vuln` | 漏洞扫描（govulncheck） |
| `make clean` | 清理产物 |
| `make docker-build` | 构建 Docker 镜像 |
| `make docker-up` | 启动完整 Docker Compose |
| `make docker-down` | 停止 Docker Compose |
| `make dev-deps` | 只启动开发依赖（mysql + redis） |
| `make seed` | 插入示例数据 |
| `make migrate` | 执行数据库迁移 |
| `make migrate-down` | 回滚数据库迁移 |
| `make migrate-status` | 查看迁移状态 |
| `make release v=v1.0.0` | 打 tag 并推送 |
| `make release-patch` | 自动 patch 版本 |
| `make release-minor` | 自动 minor 版本 |
| `make release-major` | 自动 major 版本 |
| `make help` | 显示帮助 |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 综合健康检查 |
| GET | `/live` | 存活探针 (K8s liveness) |
| GET | `/ready` | 就绪探针 (K8s readiness) |
| GET | `/api/v1/version` | 版本信息 |
| GET | `/api/v1/users` | 用户列表（分页） |
| GET | `/api/v1/users/:id` | 查询用户 |
| POST | `/api/v1/users` | 创建用户 |
| PUT | `/api/v1/users/:id` | 更新用户 |
| DELETE | `/api/v1/users/:id` | 删除用户 |
| POST | `/api/v1/auth/login` | 登录（签发 JWT） |
| POST | `/api/v1/auth/refresh` | 刷新 token |
| GET | `/docs` | API 文档 UI |
| GET | `/openapi.json` | OpenAPI 3.1 JSON |
| GET | `/openapi.yaml` | OpenAPI 3.1 YAML |

## License

Copyright (c) 2026 heathcetide. MIT License.
