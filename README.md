# 拾味日常（Shiwei Daily）

<p align="center">
  <img src="client/assets/logo.png" alt="拾味日常" width="200" />
</p>

<p align="center">
  <strong>从家中现有食材出发，把「有什么」变成「下一顿吃什么」。</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Expo-54-black.svg" alt="Expo 54" />
  <img src="https://img.shields.io/badge/Go-Gin-00ADD8.svg" alt="Go Gin" />
  <img src="https://img.shields.io/badge/Node.js-22.23.2-brightgreen.svg" alt="Node.js" />
  <img src="https://img.shields.io/badge/SQLite%20%2F%20PostgreSQL-supported-blue.svg" alt="Database" />
</p>

<p align="center">
  <a href="README.en.md">English</a> · 简体中文
</p>

拾味日常是面向个人与小家庭的开源饮食管理应用。以家庭食材库存和临期提醒为起点，把菜谱匹配、采购、烹饪扣减与饮食记录串成可验证的日常闭环，并提供健康档案、社区内容与带安全边界的 AI 辅助。

> [!IMPORTANT]
> 移动客户端仍处于可信 Beta 收口阶段，尚未公开发布。营养估算与 AI 输出仅供日常参考，不能替代医疗诊断或治疗建议；内测期间也不应承载真实敏感健康数据。

## 目录

- [核心体验](#核心体验)
- [功能概览](#功能概览)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [在线服务与 API](#在线服务与-api)
- [项目进度](#项目进度)
- [发布与安全](#发布与安全)
- [数据与第三方](#数据与第三方)
- [项目沿革](#项目沿革)
- [贡献与许可证](#贡献与许可证)

## 核心体验

```text
录入家庭食材
  → 识别临期或可用食材
  → 匹配真正能做的菜谱
  → 完成烹饪并扣减库存
  → 确认实际食用并形成饮食记录
```

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 账户 | 邮箱注册、密码登录、JWT 鉴权、邮箱验证与找回、管理端权限（见[认证说明](docs/authentication.md)） |
| 库存 | 食材录入与保质期、FEFO 扣减、幂等 intake/consume、采购清单、厨具条件 |
| 烹饪 | 库存/临期/过敏原/厨具匹配、烹饪队列、餐计划与计划维护、饮食记录 |
| 智能辅助 | AI 问答与视觉识别、票据扫描、语音与音色包、临期救援/晚餐窗口干预 |
| 社区与运营 | 菜谱搜索收藏投稿、关注流；Admin：用户/菜谱/社区/AI/音色包审计 |

## 技术架构

本仓库为 monorepo。客户端与 Admin 默认请求 **Go API（`:9090`）**；Express（`:9091`）为可选遗留上游，**默认不反代**。

| 目录 | 技术 | 说明 |
| --- | --- | --- |
| `client/` | Expo 54、React Native、Expo Router、Uniwind | iOS / Android / Web |
| `server-go/` | Go、Gin | 默认 API 与已迁移业务路由 |
| `server/` | Express、TypeScript、SQLite / PostgreSQL | 可选上游与迁移对照 |
| `admin/` | React、Vite、Tailwind | 运营与系统管理 |
| `packages/` | OpenAPI / contracts | 前后端共享契约 |
| `deploy/` | Docker Compose、Caddy | Staging 部署与烟测 |

```text
shiwei-daily/
├── client/       # Expo 客户端
├── server-go/    # Go API（:9090）
├── server/       # Express（可选 :9091）
├── admin/        # 管理后台
├── packages/     # 共享契约
├── deploy/       # 部署配置
├── docs/         # 产品 / 测试 / 运维文档
└── scripts/      # 工作区与发布脚本
```

迁移说明：[docs/server-go-migration.md](docs/server-go-migration.md)  
状态与证据：[docs/status.md](docs/status.md)

## 快速开始

<!-- BEGIN GENERATED:toolchain -->
### 环境要求

- Node.js 22.23.2 (来源: [.nvmrc](.nvmrc))
- pnpm 10.18.0 (来源: [package.json](package.json))

### 安装与配置

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
cp client/.env.example client/.env
cp server/.env.example server/.env
```
<!-- END GENERATED:toolchain -->

使用 Bun 时，在**仓库根目录**运行 `bun install` 安装全部 workspace 依赖，不要在 `client/` 或 `admin/` 下单独安装。也支持 `npm install` / `yarn install`；CI 与推荐锁文件仍以 [`pnpm-lock.yaml`](pnpm-lock.yaml) 为准。

下面的启动方式需要本机已安装 Bun 和 Go 1.25.1 或更高版本（见 [`server-go/go.mod`](server-go/go.mod)）；Node.js 版本要求见上文。

在 `client/.env` 中配置：

```dotenv
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9090
```

### 启动

在**仓库根目录**打开三个独立终端，分别运行以下命令，并保持终端运行：

```bash
# 终端 1：用户端 App（Expo Web）
bun run dev:client
```

```bash
# 终端 2：管理后台
bun run dev:admin
```

```bash
# 终端 3：Go 后端 API
bun run dev:server-go
```

客户端与管理后台的业务功能需要 Go 后端启动后才能正常使用。

| 服务 | 地址 |
| --- | --- |
| Expo Web | http://localhost:8080 |
| Go API | http://localhost:9090 |
| 健康检查 | http://localhost:9090/api/v1/health |
| 管理后台 | http://localhost:5173 |
| 管理端登录 | http://localhost:5173/login |
| Express 上游（可选） | http://localhost:9091 |

管理端不再提供宣传官网。访问根地址会进入管理入口：未登录跳转到 `/login`，管理员会话验证通过后进入 `/admin` 工作台；原官网路径也会转到管理入口。

遗留 Express 对照：

```bash
APP_UPSTREAM_EXPRESS=http://127.0.0.1:9091 pnpm dev:app:with-express
```

本地 SQLite 默认路径：`server/data/dietdigidose.db`（已 Git 忽略）。  
Staging / Docker 见 [`deploy/`](deploy/) 与 [运维手册](docs/operations.md)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `bun run dev:client` | 用户端 App（Expo Web，:8080） |
| `bun run dev:admin` | 管理后台（:5173） |
| `bun run dev:server-go` | Go 后端 API（:9090） |
| `pnpm lint:all` | client / server / admin 静态检查 |
| `bun run test:brand` | 检查品牌文案、Logo 一致性与原生图标配置 |
| `pnpm test:all` | 自动化测试 |
| `pnpm validate:toolchain` | 校验 Node / pnpm 与 CI 声明 |
| `pnpm docs:check` | 检查 README 生成区块与文档链接 |

这些脚本均可通过 `bun run <脚本名>`、`npm run <脚本名>` 或 `pnpm <脚本名>` 调用。

## 在线服务与 API

| 入口 | 地址 |
| --- | --- |
| 管理端 | https://dietdigidose.top/login |
| API 健康检查 | https://dietdigidose.top/api/v1/health |

主要路径：

- `GET /api/v1/health`
- `/api/v1/*` — 客户端与 Admin 主业务（Go）
- `/api/v1/admin/*` — 管理端
- 契约定义：[`packages/contracts`](packages/contracts)

## 项目进度

**已完成**

- [x] Monorepo：Expo / Admin / Express 基线
- [x] Go 绞杀者迁移（路由面 + 关键业务深度）
- [x] 库存 FEFO、烹饪扣减、餐计划与推荐 `checksPending`
- [x] AI OpenAI-compatible 运行时（1A，非 LangGraph 对等）
- [x] 主动干预 worker、音色包与 Admin console 契约

**进行中 / 待办**

- [ ] 公开移动端正式发布与真机 Beta 收口（[TODO.md](TODO.md)、[真机清单](docs/device-beta-checklist.md)）
- [ ] 生产 PostgreSQL、密钥与 CORS hardening（[operations.md](docs/operations.md)）
- [ ] 邮件 / 推送等云侧联调（Go 生产邮件投递尚未接通，见[认证说明](docs/authentication.md)）
- [ ] Core-loop 全量投影与 AI resources 草稿状态机完全对齐 Express
- [ ] 持续补齐契约测试与覆盖率门禁（[testing.md](docs/testing.md)）

证据入口：

[主分支 CI](https://github.com/AdlinZ/shiwei-daily/actions/workflows/ci.yml?query=branch%3Amain) ·
[Android APK](https://github.com/AdlinZ/shiwei-daily/actions/workflows/android-apk.yml) ·
[里程碑](https://github.com/AdlinZ/shiwei-daily/milestones) ·
[状态导航](docs/status.md)

## 发布与安全

可分发构建必须连接 HTTPS API。仅本机 simulator 调试可使用 localhost HTTP，且不得使用真实敏感数据。

部署前请阅读：

- [Beta 收口清单](TODO.md)
- [产品路线图](docs/product-roadmap.md)
- [部署与恢复手册](docs/operations.md)
- [安全政策](SECURITY.md)

## 数据与第三方

支持从 HowToCook、Open Food Facts、Wikibooks、USDA、台湾 FDA 等来源导入。导入须保留来源 URL、版本与许可证；不得提交含用户信息的本地库、备份或真实密钥。

详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [`LICENSES/`](LICENSES/)。

## 项目沿革

项目原名「食光烙记」，现统一更名为「拾味日常」（Shiwei Daily），并采用陶土色饭碗与鼠尾草绿蒸汽、书签组成的新 Logo。项目构想形成于 2025 年高校软件创新竞赛期间，曾获[第十八届全国大学生软件创新大赛·软件设计创新赛](https://www.swcontest.com.cn/information?activeTab=notice&detailId=d6d9f4a293ba48f59cec8824ca901332)西南赛区一等奖、全国赛三等奖。

2026 年以全新代码库重启。[早期参赛版本](https://github.com/heathcetide/shiguang-brand) 作为历史资料保留；当前实现延续问题背景与产品愿景，名称与视觉标识已全面更新。

为兼容已有安装、分享链接和持久化数据，现有域名、GitHub 仓库地址、Expo 项目/slug、移动端包 ID、URI scheme、内部模块命名空间、JWT issuer、数据库与部署标识保持不变。这些是技术兼容标识，不是当前产品展示名称；改名不涉及线上迁移、重新签名或部署。

## 贡献与许可证

1. Fork 本仓库  
2. 创建功能分支  
3. 按 [CONTRIBUTING.md](CONTRIBUTING.md) 提交  
4. 创建 Pull Request  

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开披露仍可利用的漏洞。

项目自有代码采用 [MIT License](LICENSE)。第三方组件与内容继续受各自许可证约束。
