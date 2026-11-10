# Staging 部署与演练

该目录提供独立 HTTPS staging 的可复现部署基线：Caddy 自动签发 TLS 并提供产品官网与管理端静态页面、PostgreSQL 16 持久卷、一次性 Drizzle migration、独立 API/worker，以及使用临时账号并报告清理结果的核心闭环验证。

## 部署

1. 将 staging 域名的 DNS 指向 Linux 主机，开放 TCP 80/443 与 UDP 443。
2. 在本目录复制 `.env.example` 为 `.env`，复制 `server.env.example` 为 `server.env`，填写真实密钥、官网“打开 App”链接和允许的前端域名；这两个文件均被 Git 忽略。
   `DATABASE_MIGRATION_URL` 与应用 `DATABASE_URL` 应使用不同账号；应用账号不应拥有 schema/role 管理权限。若 staging 使用 `DEPLOYMENT_PROFILE=global`，同时在独立 Supabase 项目中创建 public `community-media` bucket，填写 URL、anon key 与仅服务端可见的 service-role key；社区新图片只保存对象 URL。正式迁移前先核验 bucket 的上传、读取与删除策略。
3. 在干净的候选 checkout 中用 `git rev-parse HEAD` 取得完整 SHA，填写 `deploy/.env` 的 `CANDIDATE_GIT_SHA`。服务端构建校验 SHA 格式并固化到版本接口；该值必须对应实际源码，不能用手填标识代替源码一致性检查。先执行不启动服务的配置预检，再部署：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy config --quiet
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy up -d --build
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy ps
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy logs migrate
   ```

4. 执行核心闭环烟测：

   ```bash
   EXPECTED_SERVER_GIT_SHA="$(git rev-parse HEAD)" STAGING_BASE_URL=https://staging-api.example.com node deploy/staging-smoke.mjs
   ```

   从同一候选 checkout 执行烟测；部署标识缺失或不匹配时在注册/写入前失败。预检只检查配置可解析与必填值，不证明数据库最小权限、隔离、TLS 或真实持久化通过；不要去掉 `--quiet` 后分享可能包含密钥的完整 Compose 输出。

   烟测使用临时账号录入三种合成测试食材，并验证结构化部分扣减、制作与实际食用分离、食用/制作幂等、丢弃余量及旧请求不恢复余量。未知营养必须保持未知，不使用公共菜谱的热量来猜测合成测试餐。最后删除临时账号；失败输出的 `cleanup` 表明清理是否完成，清理失败需运维跟进。`ALLOW_HTTP=1` 只允许本机回环地址演练，不能用于候选 staging。

   如果服务器使用 Nginx 而非 Caddy，可从 `deploy/nginx.staging.conf.example` 创建站点配置。必须将 `/api/`、`/media/` 和 `/share/` 都反向代理到 API；其中 `/share/` 是动态分享承接页，不能交给管理端 SPA 的 `try_files`。

5. 先盘点、再迁移旧版内联社区图片；脚本使用与 API 相同的 `DATABASE_DRIVER`/`DATABASE_URL`，对象名由内容摘要确定，失败后可安全重跑。`--apply` 前先备份数据库并验证 bucket：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec api node dist/migrate-community-media.js
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec api node dist/migrate-community-media.js --apply
   ```

6. `worker` 与 API 为独立进程。查看最近任务批次或手动触发单项任务：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy logs worker
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec worker node dist/worker.js --once --task=media-cleanup
   ```

主动干预由 `intervention-scan` 和 `intervention-delivery` 两个独立进程处理，各自使用任务租约和运行记录，每次完成后间隔一分钟，单次任务超时50秒。传统 `worker` 继续每小时运行原有通知、媒体清理和计划维护。扫描失败或长时间读取不会占用投递进程；管理接口 `/api/v1/admin/worker-runs?task=intervention-scan`（或 `intervention-delivery`）可分别查询。

`PROACTIVE_INTERVENTIONS_ENABLED` 默认0；客户端类型化操作与归因验收完成前保持关闭。关闭后扫描立即停止产生候选，投递任务取消已预留的 pending 候选，保留站内记录及历史决策；已向 Expo 提交的请求无法撤回。修改 `server.env` 后需要重建两个干预服务容器使环境变量生效。不要只停止扫描进程作为关闭投递的方式。

本地或其他部署可使用 `pnpm --dir server worker -- --task=intervention-scan` 和 `--task=intervention-delivery` 分别启动。显式的 `WORKER_INTERVAL_MS` 会覆盖代码默认间隔，启用前应检查旧环境是否仍配置为一小时。扫描每批最多处理25个账号，每个账号结束后持久保存游标，下一轮接续并在末尾回绕。异常终止时可重扫尚未保存的位置，候选来源键去重；失败账号完成本次尝试后仍推进游标。单账号异步快照读取超过10秒时记失败、保存位置并结束本批，下一轮先处理后续账号；迟到结果丢弃。该截止不取消数据库中已开始的语句，也不能打断同步计算；数据库查询资源限制及大账号量吞吐仍需单独验证，不能仅依据一分钟间隔宣称扫描时效已达标。

## 备份与隔离恢复

使用版本化工具将 PostgreSQL custom archive 在线备份到宿主机权限受限目录。执行机器需要与源服务器主版本兼容的 `pg_dump`、`pg_restore`（staging 为 PostgreSQL 16）；API runtime 镜像没有内置这些客户端工具。不要把备份写入 Git 工作区或公开对象存储。

通过部署机的安全环境变量设置 `DATABASE_BACKUP_URL`，不要将含密码的 URL 写在命令行参数或验收记录中。`BACKUP_OWNER` 填实际负责人，`CANDIDATE_GIT_SHA` 填被备份部署的完整提交 SHA：

```bash
mkdir -p /secure-backups/dietdigidose
pnpm --dir server db:postgres:backup /secure-backups/dietdigidose/candidate-001
pnpm --dir server db:postgres:inspect /secure-backups/dietdigidose/candidate-001
```

目录必须不存在。工具将 archive 与 manifest 保存为受限权限文件；manifest 记录 SHA-256、字节数、负责人、候选 SHA、PostgreSQL 版本、迁移版本、快照时间、完成时间、耗时和各业务/迁移表行数。`pg_dump` 和计数使用同一导出快照，避免在线写入使校验计数漂移。中断后没有完整 manifest 的目录不能作为已完成备份；保留原数据库重新备份。

恢复演练必须预先建立空的独立 PostgreSQL 数据库，并用安全环境变量 `DATABASE_RESTORE_URL` 指向它。不要预先应用 migrations：archive 已包含模式和数据；不要把目标指向正在使用的 staging 或 production。

```bash
pnpm --dir server db:postgres:restore /secure-backups/dietdigidose/candidate-001
```

工具先校验 archive，再拒绝含已有关系对象的目标，使用 `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` 恢复；不提供 `--clean` 或覆盖现有数据的开关。完成后比对快照表数；校验不一致时保留隔离目标供调查，不将其接为服务。原数据库和备份不被改动。

随后启动指向恢复库的隔离 API，验证 health 中 `databaseDriver=postgresql`、登录、库存读取、管理统计、媒体引用、核心汇总和用户隔离。`durationMs` 是归档恢复与表数校验耗时，不包含应用启动和业务验收；实际 RTO 需记录从故障到服务恢复的完整时长。RPO 依据故障时间与 manifest 的 `snapshotAt` 计算，并记录期间可接受的数据损失。恢复失败继续使用原库；成功后才单独安排服务切换，切换前保留原配置和数据库安全副本。媒体对象需独立备份，数据库 archive 只保存引用。

旧版 SQLite 文件的最终迁移与回滚步骤仍见 [`docs/postgresql-migration.md`](../docs/postgresql-migration.md)；`database-backup.js` 只用于该旧版迁移窗口，不是 PostgreSQL 日常备份工具。

### Smoke report output

`node deploy/staging-smoke.mjs` writes one JSON report to stdout after the smoke run, on either success or failure. Save/parse stdout rather than stderr. Failed smoke checks still exit with code 1; stderr retains the failure and cleanup diagnostics plus any Node/runtime warnings. Invalid startup configuration exits nonzero with diagnostics on stderr and no JSON report. Earlier versions wrote failed-run JSON to stderr; consumers must now read stdout for both outcomes.
