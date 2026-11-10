# 参与开发

DietDigiDose 是基于 pnpm workspace 的 Expo、Express.js 与 React 管理端项目。提交改动前，请先创建或关联一个范围明确的 Issue。

## 本地开发

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

仓库固定使用 Node.js 22.23.2 与 pnpm 10.18.0。请让 nvm、fnm、mise 或 asdf 读取根目录的 `.nvmrc`/`.node-version`；不要使用其他 Node 主版本生成锁文件或候选构建。

前端依赖使用 `client` 目录中的 `npx expo install <package>` 安装；服务端依赖使用 `pnpm add <package>`。不要使用 npm 或 yarn 修改依赖锁文件。

## 分支与提交

- 从最新的 `main` 创建短生命周期分支。
- 自动化开发分支默认使用 `codex/` 前缀。
- 一个 PR 只处理一个明确问题，避免夹带无关格式化或重构。
- 在 PR 描述中使用 `Closes #123` 或 `Fixes #123` 关联 Issue。

## 质量检查

提交 PR 前至少运行：

```bash
pnpm -w validate:toolchain
pnpm -w quality:test-quarantine
pnpm -w docs:check
pnpm -w test:docs
pnpm -w lint:all
pnpm -w test:all
```

根据改动范围补充覆盖率、客户端、服务端或管理端构建，以及 Android 真机或 Web 手动验证。测试分层、覆盖率、产物预算和 flaky 隔离规则见 [docs/testing.md](docs/testing.md)；不得通过未登记的 skip 或只重跑失败 job 来获取绿色门禁。涉及数据库、认证、隐私、安全或发布流程时，必须在 PR 中说明风险和回滚方案。

## 文档维护

README 的工具链区块来自 `.nvmrc` 与 `package.json`，修改源配置后运行 `pnpm -w docs:generate`，不要直接手改生成区块。动态任务、构建与部署证据从 [docs/status.md](docs/status.md) 进入；有日期的周报保留为历史，不按周改写旧结论。

## Issue 与敏感信息

- 缺陷应包含版本、环境、复现步骤、期望结果和实际结果。
- 功能建议应包含用户问题、最小范围、非目标和成功指标。
- 不要在 Issue、PR、截图或日志中提交密钥、令牌、完整账号信息、健康资料或其他个人数据。

