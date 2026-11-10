# 26w37 P0 候选验收记录

## 候选身份检查（2026-10-31 补充）

当前进度见 [W44 记录](milestone-26w44-progress.md)。下方 9 月环境状态为历史快照。

从干净的候选 checkout 构建 staging 时，设置 `CANDIDATE_GIT_SHA` 为该 checkout 的完整提交 SHA；`deploy/docker-compose.staging.yml` 会将它作为 `SERVER_GIT_SHA` 构建参数传入全部服务端镜像。直接构建可用 `SERVER_GIT_SHA=<完整SHA> pnpm --dir server build`，直接 Docker 构建可用 `--build-arg SERVER_GIT_SHA=<完整SHA>`。必须核对构建输入属于该提交，环境变量只是身份声明，不是内容证明；不要用旧 SHA 标记未提交修改。

部署后使用同一 SHA 执行：

```bash
STAGING_BASE_URL=https://dietdigidose.top \
EXPECTED_SERVER_GIT_SHA=<完整候选SHA> pnpm staging:smoke
```

烟测报告保存服务版本、构建时间、提交标识及开始时间。旧服务没有 `serverGitSha` 或返回其他 SHA 时，在注册测试账号之前失败；不要通过省略 `EXPECTED_SERVER_GIT_SHA` 把一般连通性测试当作同候选验收。构建标识固化在产物中，运行时再设置变量不会改变它。没有提供构建 SHA 时接口返回 null，不猜测当前工作区或服务所属提交。

## 当前状态（2026-09-13）

本次目标为 #105、#106 实际 staging 验收，以及 #107 Android 验收；iOS 条件未齐备，#107 必须保持 open。

- 已有 staging URL：`https://dietdigidose.top`。本机 Node HTTPS 请求返回 ECONNRESET，curl TLS 握手失败；尚未确认服务端根因。
- 尚未取得 SSH 主机、部署目录、维护窗口及 Android 设备信息，未进行主机部署、重启、真实历史库恢复或设备验收。
- 本地全量测试、静态检查、契约检查、三端构建通过；独立 PostgreSQL 17 全量 migration/repository/backup/restore/API 演练通过。PG16 由 CI 验证，本地结果不替代 staging 证据。
- 修复会话过期响应、关联缓存失效、请求代次、取消队列释放餐次及单份制作营养数据。取消实现的 PostgreSQL text ID 回归纳入 CI。
- 不预分配安装包编号；candidate APK 须在 staging 部署版本核实后构建。

## 实际执行顺序

1. 合并并记录完整候选 SHA、CI URL、镜像摘要。通过受控 SSH 盘点现有部署与 PG 版本、角色、卷、媒体、DNS/TLS、CORS、外露端口。不得输出密钥。
2. 对现有 staging 做安全备份并核验归档；在隔离副本完成脱敏后才进行旧版本升级演练。不得用合成新库冒充旧库升级。
3. 部署候选 SHA，用合成账号验证注册、登录、三种库存与 worker；验证默认密码轮换、关闭种子、最小权限和外部 HTTPS。
4. 维护窗口内依次重启 API/worker、重建容器、重启主机，比较账号、库存、迁移版本并复跑烟测。保留旧镜像和恢复前备份。
5. 用 `DATABASE_BACKUP_URL`、`BACKUP_OWNER`、`CANDIDATE_GIT_SHA` 调用 `pnpm --dir server db:postgres:backup <新目录>`；用 inspect 检查 SHA/大小/清单。环境变量通过主机密钥管理注入，不进入报告。
6. 用 `DATABASE_RESTORE_URL` 调用 `pnpm --dir server db:postgres:restore <目录>`，目标必须为空独立库。启动隔离 API 验证业务数据与账号隔离，记录快照边界、实测 RPO/RTO。损坏归档、非空目标、事务失败测试只针对隔离目标。
7. 每日备份调度、加密异地保存及至少30天保留在实际备份存储配置；通过下载一次异地备份并恢复证明可用。未配置异地目标时不得标记通过。
8. 同候选 SHA 构建 Android candidate，依仓库规则由工作流预留编号；真机检查全新/升级安装、签名、三食材闭环、重复提交、权限、断网重启、字体放大和 TalkBack。iOS 保留阻断。

## 统一证据报告

输入与原始证据放在权限受限的报告目录，不提交备份或凭据。`deploy/p0-report.mjs` 汇总执行人已审核的证据，计算文件 SHA，不自动执行演练或证明证据内容真实。完整检查 ID 见该脚本的 `requiredChecks`。

输入示例（仅一项，其他项目会自动显示 incomplete）：

```json
{
  "candidateSha": "完整40位提交SHA",
  "owner": "AdlinZ",
  "stagingUrl": "https://dietdigidose.top",
  "checks": [{
    "id": "https-external",
    "candidateSha": "与顶层相同SHA",
    "status": "passed",
    "executor": "实际执行人",
    "executedAt": "2026-09-13T06:00:00.000Z",
    "environment": "staging",
    "evidence": ["https-external.json"]
  }]
}
```

```bash
node deploy/p0-report.mjs /secure-reports/input.json /secure-reports/report.json
```

报告不会覆盖已有文件。只有同 SHA、明确执行人/时间、对应 staging/device 环境且每项都有证据，才显示 readyForReview；该字段仅表示可人工复核，不自动关闭 issue。当地/CI 测试不能替代实际环境；Android 单独通过不会解锁 #107。

恢复数据验收证据至少包含：双账号越权拒绝、库存结构化数量、待吃餐剩余份量、实际摄入汇总、管理汇总与媒体引用；不能仅以行数相同判定通过。#105/#106/#107 分别逐项附证据后关闭，禁止批量关闭。
