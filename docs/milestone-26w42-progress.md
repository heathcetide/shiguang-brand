# 26w42 执行计划与进度记录

> **2026-10-18 结转：** 20 项未完成 Issue 已移至 [W43](https://github.com/AdlinZ/DietDigiDose/milestone/13)（10 月 19–25 日），W42 按周归档关闭。本周成果包括：官网部署完成上线（main `d4cdfbb2`）、PR #250 部署记录合入、PR #251 服务端通用异常与 webhook 隐私收口已合并入 main (`c41fc752`)。未完成的 20 项 Issue（含 3 项 P0）及相关实实验收结转至 [W43 进度](milestone-26w43-progress.md)。

> **2026-10-12 官网部署完成：** main `d4cdfbb2` 的首页、手记、更新日志及素材已上线；静态资源哈希、公网路由和 API 健康检查通过，旧版备份与回退脚本已保留。见[部署记录](web-deployment-2026-10-12.md)。下方 10 月 11 日尚未部署的表述为历史状态。

> **2026-10-11 服务端后续更新：** 已部署 `fbd9b1a4`（基于 41a 对应 main，附签名输出兼容修复）。130 张表的备份恢复、两项迁移、隔离及线上 HTTPS 烟测通过；API 与三个 worker 已更新。短信服务仍关闭，APK 下载来源和清单未配置，真实验收不自动完成。详见[服务端更新记录](server-update-2026-10-11.md)。

> **2026-10-11 构建完成：** #248 已合并至 main `f4ba92c3`，候选与 main 的 CI 全部通过；[Android preview `26w41a / 264101`](https://github.com/AdlinZ/DietDigiDose/actions/runs/38143602557) 已构建并通过包名、版本和持久签名校验。[下载工件](https://github.com/AdlinZ/DietDigiDose/actions/runs/38143602557/artifacts/11704995236)。打包完成时尚未部署服务端，后续部署见上方记录；真机验收未完成，官网改动随本分支同步、尚未部署。以下旧 SHA 和未提交说明属于历次核对记录。

更新：2026-10-12（上海时区）。本周为 **2026-10-12 至 2026-10-18，ISO 第 42 周**。

[W42 里程碑](https://github.com/AdlinZ/DietDigiDose/milestone/12) 承接 W41 的 **20 项未完成 Issue，含 3 项 P0（#105/#106/#107）**。原优先级、标签及验收标准保留；Backlog 21 项不自动纳入。W41 按周归档，不代表验收完成，已有实现与 10 月 7 日测试证据保留在 [W41 历史记录](milestone-26w41-progress.md)。

## 10 月 11 日 Android 打包结果

- #248 已合并，源码为 `f4ba92c393489f1ec111c389d6a865791d134fed`；候选 [CI 38142836324](https://github.com/AdlinZ/DietDigiDose/actions/runs/38142836324) 与 [main CI](https://github.com/AdlinZ/DietDigiDose/actions/runs/38143565538) 全部通过，补齐本地网络中断未取得的生产审计结果。
- [构建 38143602557](https://github.com/AdlinZ/DietDigiDose/actions/runs/38143602557) 成功生成 `1.0.6 / 26w41a / 264101`，持久 preview 签名、包名 `com.dietdigidose.app.preview`、版本校验通过。原生编译耗时 25 分 38 秒，未消耗额外快照。
- [APK 工件](https://github.com/AdlinZ/DietDigiDose/actions/runs/38143602557/artifacts/11704995236) 保留至 2026-10-25。构建日志与验证登记保存于忽略目录 `artifacts/releases/26w41a/`；完整 APK 通过上方 GitHub 工件下载。
- 打包阶段没有部署服务端，后续部署见上方记录；尚未进行真机安装。#219 的包内下载来源白名单仍为空，确定来源后需重新打包；#221 的真实短信恢复及 #107 的双端同候选验收继续保留开放。W42 仍有 20 项 Issue、3 项 P0。

## 10 月 11 日打包前检查（历史）

**当前不能直接用现有签名工作流打出包含全部本地新功能的安装包。** 本轮只做就绪检查及排期结转，未触发构建、未分配快照。

- 远端 main 仍为 `a22c6cb5`；草稿 PR #248 仍为 `258d0dba`，未合并。本地账号恢复、APK 更新和此前修复尚未提交，另有近期官网/后台改动，需要按范围核对后纳入候选。
- `.github/workflows/android-apk.yml` 要求手动构建使用 main，标签构建也检查源码属于 main。直接运行现有 main 会漏掉本地新功能；不能把旧提交 CI 当作当前候选通过。
- Android preview 的持久签名 secrets 和证书指纹已配置，仓库后端地址为 `https://dietdigidose.top`。地址存在不证明独立 staging 或新服务端已部署。
- `APK_DOWNLOAD_ORIGINS` 尚未配置，#219 的包内下载来源白名单仍需确定。这不妨碍普通预览包编译，但会使新更新入口无法完成 APK 下载；#221 同样需要对应服务端与真实短信配置。
- 10 月 7 日 client 451/server 600/admin 32 项通过，且更新模块 `compileReleaseKotlin` 通过；这些是当时工作区证据，不是今天完整应用打包结果。
- 今天版本元数据、三端静态检查及 11 项依赖安全/兼容测试通过。生产依赖审计两次请求 npm 官方 registry 均遇到 TLS 连接重置（`ECONNRESET`），无法取得今天的审计结果，不能标为通过；没有据此新增例外或降低门禁。日志位于忽略目录 `artifacts/quality/w42-rollover-20261011/preflight.log` 和 `audit-network-retry.log`。

实际打包时由工作流统一预留编号。10 月 11 日仍按 W41，10 月 12 日后按 W42；不得因为 Issue 提前结转就手工提前递增版本。最近成功 APK 仍为 `26w38a / 263801`（源码 `818cdefe`）。

## 推进顺序

1. 同步官网改动及服务端修复、发布记录，完成对应 CI。补齐短信和 APK 下载来源配置；原有 41a 的原生来源白名单需通过后续新包更新。
2. 完成 #105/#106 独立环境、持久化和完整恢复演练；对齐客户端与服务端候选，按既有签名流程打包。
3. #221 验证真实短信找回及旧会话失效；#219 验证稳定下载、同签名覆盖升级及数据保留。更新模块原生编译成功不能替代整包和真机验收。
4. 并行完成来源/许可/制作复热审核、基础数据包、媒体 bucket；用同一候选完成库存、多餐、计时、评论、语音等真实闭环。
5. 双端设备和同候选证据齐备后判断 #107；满足各 Issue 原标准再关闭。

详细操作继续使用 [账号恢复与应用更新](w41-account-recovery-and-app-updates.md)、[真机清单](device-beta-checklist.md) 和 W41 中已整理的 P0 检查点。

## 结转清单

- [#17](https://github.com/AdlinZ/DietDigiDose/issues/17) 发表评论时键盘弹出但看不到评论输入框
- [#62](https://github.com/AdlinZ/DietDigiDose/issues/62) feat(cooking): 支持可打断的实时双向语音烹饪助手
- [#105](https://github.com/AdlinZ/DietDigiDose/issues/105) [P0][release] 部署独立 HTTPS staging 并验证持久化配置
- [#106](https://github.com/AdlinZ/DietDigiDose/issues/106) [P0][data] 完成空库、升级库与备份恢复演练
- [#107](https://github.com/AdlinZ/DietDigiDose/issues/107) [P0][release] 生成同提交双端候选包并完成核心闭环真机验收
- [#108](https://github.com/AdlinZ/DietDigiDose/issues/108) [P1][storage] 配置 staging 媒体 bucket 并迁移历史内联图片
- [#171](https://github.com/AdlinZ/DietDigiDose/issues/171) [P1][Release] HTTPS preview 持久签名与覆盖升级验收
- [#183](https://github.com/AdlinZ/DietDigiDose/issues/183) [P1][voice] 修复静音切换并发与断网时麦克风继续录音
- [#185](https://github.com/AdlinZ/DietDigiDose/issues/185) [P2][release] 修复示例环境变量覆盖 preview 隔离包名
- [#187](https://github.com/AdlinZ/DietDigiDose/issues/187) [P1][data] 整理并发布版本化基础数据包 v1
- [#189](https://github.com/AdlinZ/DietDigiDose/issues/189) [P1][fix] Agent 库存操作复用结构化数量与部分消耗规则
- [#190](https://github.com/AdlinZ/DietDigiDose/issues/190) [P1][feat] 分离制作完成、待吃餐与实际食用
- [#191](https://github.com/AdlinZ/DietDigiDose/issues/191) [P1][feat] 明确识别项自动入库，模糊项确认，支持撤销
- [#192](https://github.com/AdlinZ/DietDigiDose/issues/192) [P1][feat] 扩展常用备餐偏好并支持一次性语音覆盖
- [#193](https://github.com/AdlinZ/DietDigiDose/issues/193) [P1][feat] 按待吃餐、库存份量和总耗时生成一套多餐方案
- [#194](https://github.com/AdlinZ/DietDigiDose/issues/194) [P1][feat] 将方案局部替换、制作分配和食用更新贯通到真实记录
- [#218](https://github.com/AdlinZ/DietDigiDose/issues/218) [P1][data] 云端食谱未完成审核通过，实际仅一个食谱可见
- [#219](https://github.com/AdlinZ/DietDigiDose/issues/219) feat: 实现应用内版本检查与 Android APK 更新，配套发布流程
- [#220](https://github.com/AdlinZ/DietDigiDose/issues/220) [P1][fix] 修复烹饪计时意外重置并支持后台恢复与到时提醒
- [#221](https://github.com/AdlinZ/DietDigiDose/issues/221) [P1][feat] 补齐用户端修改密码与忘记密码流程
