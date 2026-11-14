# 拾味日常管理端

本目录仅包含管理后台，使用 React、Vite、Tailwind CSS 和 Oxlint，不再承载产品宣传官网。它是 monorepo 中的一个 workspace，依赖统一在仓库根目录安装。

## 本地开发

先按[根 README](../README.md)配置工具链并在仓库根目录完成安装。以下命令均从仓库根目录执行：

```bash
bun run dev:server
# 另开终端
bun run dev:admin
```

开发入口默认是 http://localhost:5173：未登录时进入 `/login`，管理员会话验证通过后进入 `/admin` 工作台。原官网路径（如 `/journal`、`/changelog`、`/privacy`、`/terms`）统一转到管理入口；未知 `/admin/*` 路径显示后台 404。

Vite 将 `/api` 和 `/media` 代理到 http://localhost:9090，配置见 [vite.config.ts](vite.config.ts)。管理权限由前后端共同校验，不应通过修改前端绕过。

## 视觉系统

管理端采用奶油白、陶土橘与深可可色的暖色主题，登录页、首次改密页、工作台、业务卡片、表格与弹窗共享同一组设计 token：

- [src/index.css](src/index.css)：主题色、文字色、暖灰色阶、焦点与减少动态效果。
- [src/layout/admin.css](src/layout/admin.css)：侧栏、面包屑、工作台、卡片、表格、抽屉与移动端布局。
- [src/components/admin/AuthLayout.tsx](src/components/admin/AuthLayout.tsx) 与 [auth.css](src/components/admin/auth.css)：登录、改密的共用布局；装饰由已有本地 Logo 与 CSS 组成，不依赖外部图片或生图密钥。

统计数字保持服务端原值；未知数据不以 0 填充，等待用户的任务不归为运行失败。模型用量的输入/输出配色独立于界面主色，并提供键盘查看明细与数值表格。

## 本地图片生成（开发工具）

项目级 [aicost-image Skill](../.claude/skills/aicost-image/SKILL.md) 提供 `aicost.me / gpt-image-2` 的文生图和参考图编辑脚本，使用 Python 标准库，不是后台对外暴露的新接口。密钥需要配置为环境变量 `AICOST_API_KEY`，或存入 `.claude/skills/aicost-image/secrets.env`；该本地文件已从 Git 和 Docker 构建上下文排除，不得放入前端环境变量。

在仓库根目录离线预览请求：

```bash
python3 -I .claude/skills/aicost-image/scripts/generate.py \
  --prompt "暖色厨房静物，奶油白与陶土色，自然光，无文字" \
  --aspect 16:9 --size 2K \
  --out artifacts/imagegen/background.jpg --dry-run
```

`--check` 只检查本地密钥能否读取；`--dry-run` 不读取密钥、不访问网络。移除 `--dry-run` 才会发送提示词／参考图并调用付费服务。生成后先在 `artifacts/` 审阅和压缩，再将需要随管理端发布的资产放入 `admin/public/`。当前登录页仍使用本地 Logo 与 CSS，不依赖在线生图。

## 检查与构建

```bash
pnpm lint:admin
pnpm test:admin
pnpm build:admin
```

上述根目录命令以[根 package.json](../package.json) 为准，静态构建输出到 `admin/dist/`。页面组织、样式隔离、发布与回滚步骤见[管理后台维护与验收](../docs/admin-console.md)。部署证据见[状态导航](../docs/status.md)，本地构建成功不代表已发布。
