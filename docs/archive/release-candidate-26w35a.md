# 1.0.5 · 26w35a 候选验收记录

记录日期：2026-08-26  
产品版本：`1.0.5`  
候选快照：`26w35a`  
iOS `buildNumber`：`263501`  
Android `versionCode`：`263501`

## 仓库内自动化门槛

- [x] `pnpm -w validate:release`：版本、快照及双端构建号一致。
- [x] `pnpm -w lint:all`：客户端、服务端和管理端通过。
- [x] `pnpm -w test:all`：客户端 87、服务端 77、管理端 6 项测试通过。
- [x] `pnpm -w build:client`：Expo Web 导出通过。
- [x] `pnpm -w build:server`：服务端生产构建通过。
- [x] `pnpm -w build:admin`：管理端生产构建通过。
- [x] `pnpm -w audit:prod`：完成；仍有 2 项已精确忽略的 high 告警（`CVE-2025-71329`、`CVE-2025-71330`），路径均为 Expo/Metro 构建链中的 `image-size`。上游当前无修复版本，处理边界见 README，不能表述为零漏洞。

## 数据门槛

- [x] 空 SQLite 数据库完成初始化并应用到 migration 41。
- [x] 模拟已有数据库重新应用 migration 39、40、41，迁移与信息流索引恢复成功。
- [x] 在系统临时隔离目录执行备份、修改、恢复；恢复后标记数据与备份一致，原数据库安全副本亦成功生成。

## 仍需外部环境完成

- [ ] 使用真实 staging 域名验证 HTTPS、证书链和核心闭环烟测。
- [ ] 从同一已提交 Git SHA 生成 iOS 与 Android 候选包并记录签名、校验和及后端环境。
- [ ] iOS、Android 分别执行全新安装、升级安装、冷启动和完整核心闭环。
- [ ] 真机验证主题系统模式、评论输入法、通知开关与退出登录后的提醒撤销。
- [ ] Android 真机验证首页轮播手势、发帖成功跳转、麦克风授权与拒绝路径、详情页窄屏文本布局，以及食谱连续分页的视口稳定性。
- [ ] 验收提交后创建 `26w35a` tag 和 GitHub prerelease。

上述外部门槛完成前，`1.0.5` 仍不是可发布状态。
