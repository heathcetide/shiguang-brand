# 食光烙记官网与管理端

本目录包含产品官网与管理后台，使用 React、Vite、Tailwind CSS 和 Oxlint。它是 pnpm workspace 的一部分，不是独立 Vite 模板。

## 本地开发

先按[根 README](../README.md)配置工具链并在仓库根目录完成安装。以下命令均从仓库根目录执行：

```bash
pnpm dev:server
# 另开终端
pnpm dev:admin
```

开发入口默认是 http://localhost:5173；Vite 将 `/api` 代理到 http://localhost:9090，配置见 [vite.config.ts](vite.config.ts)。管理权限由前后端共同校验，不应通过修改前端绕过。

## 检查与构建

```bash
pnpm lint:admin
pnpm test:admin
pnpm build:admin
```

上述根目录命令以[根 package.json](../package.json) 为准，静态构建输出到 `admin/dist/`。页面组织、样式隔离、发布与回滚步骤见[管理后台维护与验收](../docs/admin-console.md)。部署证据见[状态导航](../docs/status.md)，本地构建成功不代表已发布。
