# DietDigiDose 文档

## 目录结构

```
DietDigiDose/
├── cmd/server/          # 程序入口
├── internal/
│   ├── configs/         # 配置定义与加载
│   ├── handlers/        # 路由注册 + handler 实现
│   ├── middlewares/     # 项目特定中间件
│   └── models/          # 数据模型
├── configs/             # 配置文件（YAML / .env）
├── docker/              # Dockerfile + docker-compose
├── docs/                # 项目文档
├── scripts/             # 辅助脚本
└── Makefile
```

## 架构说明

本项目采用分层架构，但不过度拆分：

- **handlers**: 路由注册（`urls.go`）与 handler 实现分离，参考 LingEchoX 的 humax.Group 模式
- **models**: 直接使用 GORM 定义数据模型，handler 直接操作 db
- **configs**: 支持 YAML 和 .env 两种配置格式，环境变量可覆盖文件配置
- **middlewares**: 仅保留项目特定中间件（如限流配置），通用中间件用 ling-base/middleware 库

## 依赖的 ling-base 模块

| 模块 | 用途 |
|------|------|
| `bootstrap` | 应用生命周期管理（优雅启停） |
| `logger` | 结构化日志（zap + lumberjack 轮转） |
| `middleware` | 通用中间件（RequestID/Logger/CORS/Recovery） |
| `common/response` | 统一响应封装 |
| `common/jwtutil` | JWT 签发/验证 |
| `common/jwtutil/gin` | JWT Gin 中间件 |
| `apidocs` | API 文档（OpenAPI/Swagger UI） |
| `apidocs/humax` | Gin handler → Huma OpenAPI 桥接 |

## 本地开发

```bash
# 安装依赖
make tidy

# 运行
make run

# 测试
make test

# 构建
make build
```

## Docker 部署

```bash
# 构建镜像
make docker-build

# 启动服务（App + MySQL + Redis）
make docker-up

# 停止
make docker-down
```

## 配置说明

### YAML 模式

配置文件在 `configs/config.yaml`，生产环境用 `configs/config.prod.yaml`。

### .env 模式

配置文件在 `configs/.env`，生产环境用 `configs/.env.prod`。
参考 `configs/.env.example` 了解所有可用的环境变量。

环境变量优先级：环境变量 > 配置文件。
