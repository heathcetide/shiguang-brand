# 食光烙记（DietDigiDose）

<p align="center">
  <img src="client/assets/logo.svg" alt="食光烙记 Logo" width="160" />
</p>

<p align="center">
  <strong>从家中现有食材出发，把“有什么”变成“下一顿吃什么”。</strong>
</p>

<p align="center">
  简体中文 · <a href="README.en.md">English</a>
</p>

食光烙记是一款面向个人与小家庭的开源饮食管理应用。它以家庭食材库存和临期提醒为起点，将菜谱匹配、采购、烹饪扣减与饮食记录串成一条可验证的日常闭环，并提供健康档案、社区内容和带安全边界的 AI 辅助能力。

> [!IMPORTANT]
> 移动客户端目前仍处于可信 Beta 收口阶段，尚未公开发布。营养估算与 AI 输出仅供日常参考，不能替代医疗诊断或治疗建议；内测期间也不应承载真实敏感健康数据。

## 核心体验

```text
录入家庭食材
  → 识别临期或可用食材
  → 匹配真正能做的菜谱
  → 完成烹饪并扣减库存
  → 确认实际食用并形成饮食记录
```

围绕这条主线，仓库当前包含：

- 家庭食材库存、保质期、厨房用具与采购清单管理
- 基于库存、临期食材、过敏原和厨具条件的菜谱匹配
- 烹饪队列、步骤模式、幂等库存扣减与饮食记录
- 营养摄入、健康档案、提醒与趋势洞察
- 菜谱搜索、收藏、投稿、关注与社区内容
- AI 营养问答、食材/餐食识别、票据扫描和语音交互
- 用户、菜谱、社区、Agent 运行、AI 配置与安全审计管理后台

## 项目状态

进度与证据统一从[状态导航](docs/status.md)查看，包括任务、构建、部署记录与真机验收。这些状态分别确认：代码合并或构建成功不代表已经部署或通过真机验收。

[主分支 CI](https://github.com/AdlinZ/DietDigiDose/actions/workflows/ci.yml?query=branch%3Amain) · [Android APK 构建](https://github.com/AdlinZ/DietDigiDose/actions/workflows/android-apk.yml) · [开放里程碑](https://github.com/AdlinZ/DietDigiDose/milestones)

## 在线服务

| 入口 | 地址 |
| --- | --- |
| 产品官网 | [dietdigidose.top](https://dietdigidose.top/) |
| 管理端 | [dietdigidose.top/login](https://dietdigidose.top/login) |
| API 健康检查 | [dietdigidose.top/api/v1/health](https://dietdigidose.top/api/v1/health) |

官网页脚的 ICP 备案文案和链接由管理端“站点设置”统一配置，不写死在前端代码中。

## 技术架构

本项目是基于 pnpm workspace 的 monorepo：

| 模块 | 主要技术 | 用途 |
| --- | --- | --- |
| `client` | Expo 54、React Native、Expo Router、Uniwind | iOS、Android 与 Web 客户端 |
| `server-go` | Go、Gin | API 网关与已迁移路由（本地默认 :9090） |
| `server` | Express、TypeScript、SQLite/PostgreSQL、Drizzle、LangGraph | 可选遗留上游 / 迁移对照（本地默认 :9091，默认不反代） |
| `admin` | React、Vite、Tailwind CSS | 运营审核与系统管理后台 |
| `deploy` | Docker Compose、Caddy | HTTPS 部署、持久化与恢复演练 |

本地开发默认使用 SQLite，部署支持 PostgreSQL；Supabase 用于可选的社区媒体对象存储。具体环境的验收证据见[状态导航](docs/status.md)。

## 仓库结构

```text
Dietdigidose/
├── client/          # Expo 客户端：路由、页面、组件与资源
├── server-go/       # Go API 网关与已迁移路由
├── server/          # Express API、数据库迁移、AI Agent 与导入脚本
├── admin/           # React 管理后台
├── deploy/          # staging 部署、代理与烟测配置
├── docs/            # 产品路线图、验收清单与运维文档
├── eslint-plugins/  # 项目自定义 ESLint 规则
└── scripts/         # 工作区与发布校验脚本
```

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

使用 nvm、fnm、mise 或 asdf 时，请先让版本管理器读取仓库中的 Node 版本文件。普通 CI、Android 构建和本地推荐环境必须使用同一 Node 版本；升级时应在一个 PR 中同步更新版本文件、根包 `engines` 与全部工作流。

客户端至少需要指向本地 API：

```dotenv
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9090
```

服务端开发模式可以使用默认 SQLite 并自动生成本地 JWT 密钥。生产与 staging 必须设置强 `JWT_SECRET`、`ADMIN_INITIAL_PASSWORD`、明确的 `CORS_ORIGINS`，并用 `DATABASE_DRIVER=postgresql`、`DATABASE_URL` 连接持久化 PostgreSQL。完整字段与说明见 [`server/.env.example`](server/.env.example)。

### 启动

启动 Expo Web 与 Go API（:9090；默认已承接业务路由）：

```bash
pnpm dev
```

需要遗留 Express 对照或显式反代时：

```bash
APP_UPSTREAM_EXPRESS=http://127.0.0.1:9091 pnpm dev:server-go
pnpm dev:server
# 或一次性：APP_UPSTREAM_EXPRESS=http://127.0.0.1:9091 pnpm dev:app:with-express
```

另开终端启动管理后台：

```bash
pnpm dev:admin
```

如需在同一终端查看客户端、Go 与管理端日志，可运行 `pnpm dev:all`。

| 服务 | 默认地址 |
| --- | --- |
| Expo Web | `http://localhost:8080` |
| API（Go） | `http://localhost:9090` |
| Express 上游（可选） | `http://localhost:9091` |
| 健康检查 | `http://localhost:9090/api/v1/health` |
| 管理后台 | `http://localhost:5173` |

迁移进度见 [docs/server-go-migration.md](docs/server-go-migration.md)。

本地 SQLite 数据库会自动创建在 `server/data/dietdigidose.db`，该目录已被 Git 忽略。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动客户端与 Go API |
| `pnpm dev:server-go` | 仅启动 Go API |
| `pnpm dev:server` | 可选 Express 上游（:9091） |
| `pnpm dev:app:with-express` | 客户端 + Go + Express |
| `pnpm dev:admin` | 启动管理后台 |
| `pnpm dev:all` | 同时启动客户端、Go 与管理后台 |
| `pnpm lint:all` | 校验 client、server 与 admin |
| `pnpm test:all` | 运行三端自动化测试 |
| `pnpm test:coverage` | 运行 client/server 覆盖率门禁 |
| `pnpm test:stability` | 连续两轮运行全量测试并生成稳定性报告 |
| `pnpm build:client` | 导出 Expo Web 构建 |
| `pnpm build:server` | 构建 Express 服务端 |
| `pnpm build:admin` | 构建管理后台 |
| `pnpm validate:toolchain` | 校验 Node/pnpm 与 CI 声明一致 |
| `pnpm validate:release` | 校验版本、快照和双端构建号 |
| `pnpm audit:prod` | 审计生产依赖 |
| `pnpm docs:generate` | 更新 README 自动生成的工具链区块 |
| `pnpm docs:check` | 检查生成区块、本地链接目标与命令是否有效 |

测试分层、覆盖率、产物预算和 flaky/quarantine 处理规则见 [分层测试与质量门禁](docs/testing.md)。

## 发布与安全边界

`client/eas.json` 提供 iOS/Android 的 preview 与 production 配置，所有可分发构建都必须连接 HTTPS API。只有本机 simulator 调试可显式使用 localhost HTTP，不得使用真实敏感数据。

依赖审计通过不代表“零漏洞”。当前审计例外与依赖补丁以 [`pnpm-workspace.yaml`](pnpm-workspace.yaml) 为准；原因、回归检查和复查要求见[分层测试与质量门禁](docs/testing.md)。每次依赖升级和候选验收都必须重新检查。

部署前请阅读：

- [开发与 Beta 收口清单](TODO.md)
- [产品路线图](docs/product-roadmap.md)
- [部署与恢复手册](docs/operations.md)
- [安全政策](SECURITY.md)

## 数据与第三方内容

项目支持从 HowToCook、Open Food Facts、Wikibooks、USDA 与台湾 FDA 等来源导入数据。导入数据应保留来源 URL、版本与许可证信息；不得提交包含用户信息的本地数据库、备份或真实密钥。

第三方源码、字体与食谱资源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可证副本位于 [`LICENSES/`](LICENSES/)。

## 项目沿革

“食光烙记”的产品构想形成于 2025 年高校软件创新竞赛期间，曾获[第十八届全国大学生软件创新大赛·软件设计创新赛](https://www.swcontest.com.cn/information?activeTab=notice&detailId=d6d9f4a293ba48f59cec8824ca901332)西南赛区一等奖、全国赛三等奖。

2026 年，项目以全新代码库重新启动。[早期参赛版本](https://github.com/heathcetide/shiguang-brand) 作为历史资料保留；当前实现仅延续项目名称、问题背景与产品愿景，技术架构、数据模型和工程实现均按当前需求重新设计。

## 参与项目

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开披露仍可利用的漏洞。

## 许可证

项目自有代码采用 [MIT License](LICENSE)。第三方组件与内容继续受各自许可证约束。
