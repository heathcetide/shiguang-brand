# 26w41 执行计划与进度记录

> **2026-10-11 结转：** 20 项未完成 Issue 已移至 [W42](https://github.com/AdlinZ/DietDigiDose/milestone/12)（10 月 12–18 日），W41 按周归档。以下保留结转前的实施、验证和计划记录；结转时尚未触发打包；随后 #248 已合并、候选与 main CI 通过，并成功生成 `26w41a / 264101`，结果见 W42 最新记录。实际验收未完成，新计划见 [W42 进度](milestone-26w42-progress.md)。

更新：2026-10-07（上海时区）。周期为 **2026-10-05 至 2026-10-11，ISO 第 41 周**。

本周目标是整理统一候选版本，补齐可信 Beta 的发布验收证据。[W41 里程碑](https://github.com/AdlinZ/DietDigiDose/milestone/11) 结转前有 **20 项未完成 Issue，其中 3 项 P0**：W40 结转 18 项，10 月 7 日按本次排期加入 #221 自助找回密码和 #219 应用内更新。排期不等于承诺全部在本周关闭，原优先级、标签与关闭标准保持不变。

W40 已关闭的 #201/#203/#204/#222 留在[原里程碑](https://github.com/AdlinZ/DietDigiDose/milestone/10)，实施与验证过程保留在 [W40 历史记录](milestone-26w40-progress.md)。[Backlog](https://github.com/AdlinZ/DietDigiDose/milestone/7) 剩余 21 项继续待排期，不自动加入本周。

**10 月 7 日新增任务进展：** #221 手机自助恢复及 #219 完整 APK 更新的本地代码均已实现，两项保持开放。恢复包含一次性凭据、过期/并发/吊销与旧密码登录竞态保护，SQLite/PostgreSQL 回归通过，暂不支持邮箱恢复；更新包含清单接口、发布/撤下工具、前端与 Expo Android 原生模块，OTA 留待二期。部署、真实短信、正式下载源与真机升级待验，Android 更新模块原生编译已通过。实现与执行入口见[专题记录](w41-account-recovery-and-app-updates.md)，本轮整合检查单独记录在下文。

## 本周先做什么

1. **收口新增任务验证并整理候选代码。** #221 自助恢复和 #219 完整 APK 更新已在本地实现，最后一轮检查及 Android 更新模块原生编译已通过；核对已有未提交改动及草稿 [#248](https://github.com/AdlinZ/DietDigiDose/pull/248)，按范围整理提交并确定统一候选。CI 只证明对应提交，本次排期不代表已经合并。
2. **准备三项 P0 的执行资料。** 对 #105/#106/#107 列出同候选的环境配置、迁移、备份、回滚、验收记录及执行人；明确 RPO/RTO 目标。若候选包含 #248，部署时必须应用 PostgreSQL `0029` 迁移。先明确独立演练环境和双端设备的可用情况，再安排实际执行时间。
3. **并行准备真实内容审核。** 明确 #187/#218/#193 的本次发布清单、逐条来源、许可、营养、制作时长、设备容量及存放复热依据；缺失项保持待核对。数据导入成功、参考内容可阅读或字段非空都不等于已获得执行资格。
4. **条件具备后执行下表验收。** 先完成独立环境及恢复，再生成同提交、同 staging 的双端候选；用同一轮真实使用串起库存、多餐制作、次日食用、计时及语音，逐项保存证据。

最近资源记录仍为缺少 Android/iOS 双端真机和独立演练环境。代码审阅、审核资料和验收清单可以立即推进；设备、环境、bucket 或真实内容依据不足的项目继续记录待满足条件，不以本地模拟、Web 或 CI 代替实际验收。

## 完整范围与交付要求

| 分组 | Issue | 本周需要补齐的交付或证据 | 执行条件 |
| --- | --- | --- | --- |
| 环境与恢复 | [#105](https://github.com/AdlinZ/DietDigiDose/issues/105)、[#106](https://github.com/AdlinZ/DietDigiDose/issues/106)、[#108](https://github.com/AdlinZ/DietDigiDose/issues/108) | 环境/密钥/媒体隔离、CORS、密码轮换、重启持久化；同候选空库与脱敏升级、完整故障恢复计时、RPO/RTO 与交接；独立 bucket 的权限、历史迁移、删除、恢复及回滚 | 独立 staging、bucket、负责人及回滚容量；现有公网服务和历史备份不替代验收 |
| 双端候选与升级 | [#107](https://github.com/AdlinZ/DietDigiDose/issues/107)、[#171](https://github.com/AdlinZ/DietDigiDose/issues/171)、[#185](https://github.com/AdlinZ/DietDigiDose/issues/185) | 同提交、同 staging 的 Android/iOS 候选；全新及固定签名覆盖安装、preview/正式并存、连续升级保留数据、核心闭环和辅助功能 | 统一候选、已准备好的 staging、双端真机和签名条件；Android 结果不能替代 iOS |
| 内容与制作规则 | [#187](https://github.com/AdlinZ/DietDigiDose/issues/187)、[#218](https://github.com/AdlinZ/DietDigiDose/issues/218)、[#193](https://github.com/AdlinZ/DietDigiDose/issues/193) | 食材/营养/厨具逐条授权审核、可执行菜谱及不可变基础数据 v1；实际云端发布与 Android 可见性；真实设备容量、时间预算、存放复热及受审核替代 | 真实来源及许可证据、审核人、实际食物与设备；审核资料先并行整理 |
| 识别与库存 | [#189](https://github.com/AdlinZ/DietDigiDose/issues/189)、[#191](https://github.com/AdlinZ/DietDigiDose/issues/191) | 真实照片、重叠/重复、字段依据、确认草稿、撤销与权限拒绝；弱网/重启入库恢复；部分使用、用完、丢弃、纠错、未知及并发的跨入口一致性 | 同一候选、真实照片/提供商及实际库存场景 |
| 多餐制作与提醒 | [#190](https://github.com/AdlinZ/DietDigiDose/issues/190)、[#194](https://github.com/AdlinZ/DietDigiDose/issues/194)、[#220](https://github.com/AdlinZ/DietDigiDose/issues/220) | 多餐共做、局部替换、真实制作和产出分配、次日食用；双端计时、锁屏/重启恢复、通知更新与取消 | 已审核内容、真实食材/设备及双端候选；跨日流程提前安排 |
| 评论与语音 | [#17](https://github.com/AdlinZ/DietDigiDose/issues/17)、[#62](https://github.com/AdlinZ/DietDigiDose/issues/62)、[#183](https://github.com/AdlinZ/DietDigiDose/issues/183)、[#192](https://github.com/AdlinZ/DietDigiDose/issues/192) | Android 评论全交互；五轮持续音频、回声/打断、扬声器/耳机、断网降级；静音并发、权限/锁屏/离开页面；口述偏好本次覆盖、长期设置及原要求的 Web 路径 | 真机、真实语音提供商、麦克风与耳机；不能用回调或 SDK mock 证明通过 |
| 账号恢复 | [#221](https://github.com/AdlinZ/DietDigiDose/issues/221) | 手机恢复入口、身份验证、一次性凭据、重设及旧会话吊销已实现并通过 SQLite/PostgreSQL 回归；补齐部署与真实恢复证据，邮箱恢复不支持 | 真实短信配置、可验证的绑定身份和隔离测试账号；真实恢复流程待验收 |
| 应用更新 | [#219](https://github.com/AdlinZ/DietDigiDose/issues/219) | 一期清单、发布/撤下工具、前端及原生模块已实现；更新模块原生编译已通过，补齐部署、完整 APK 下载与安装证据；OTA 二期待排 | 正式下载源、签名 APK、可靠版本元数据和 Android 真机；覆盖升级、数据保留与安装取消待验收 |

## 本周起点

| 层次 | 已有证据 | 边界 |
| --- | --- | --- |
| 主分支 | `a22c6cb5`，#246/#247 已于 10 月 2 日合并；[CI 37003624773](https://github.com/AdlinZ/DietDigiDose/actions/runs/37003624773) 三项全部通过 | 已具备多餐共做、制作复热审核、故障恢复和未知营养展示等实现；尚无该候选部署及双端真机通过证据 |
| 待合并 | 草稿 #248 / `258d0dba` 的营养来源、导入与安全修复；[CI 37284683370](https://github.com/AdlinZ/DietDigiDose/actions/runs/37284683370) 三项通过 | 未合并、未部署、未执行线上导入、未生成安装包；不覆盖当前工作区未提交代码 |
| Android | `26w38a / 263801`，源提交 `818cdefe`；[构建与签名记录](https://github.com/AdlinZ/DietDigiDose/actions/runs/35517119184) | 10 月 2 日两次 Android 工作流均 skipped，未生成对应新包 |
| 公网服务 | 10 月 2 日最后一次身份核对为 `w39-818cdefe`；10 月 6 日 HTTPS health 为 ok / postgresql / china / local-filesystem | health 未返回提交与构建时间，不能证明主分支已部署，也不能证明独立 staging/bucket 或完整恢复通过 |

已有实现及逐轮回归细节见 [W40 实施记录](milestone-26w40-progress.md)；营养来源及安全补丁维护见 [数据来源](data-sources.md) 和 [测试与质量门禁](testing.md)。草稿 #248 当前保留 4 项精确临时审计例外，不应描述为零漏洞。

## 2026-10-07：本轮已推进的工作

- **代码审阅完成。** 分别检查 #248 的不可变提交 `258d0dba` 和本地已有的客户端/后台/服务端清理与回归改动，未发现可复现的新增阻断缺陷。#248 的独立检出验证了营养未知值、来源更新、导入幂等与回滚等路径；工作区检查包含异步请求隔离、路由与持久化兼容。两批改动仍须按范围整理提交，最终候选 SHA 尚未固定。
- **修复今天发现的 5 项依赖审计阻断。** 更新 `proxy-addr`、`shell-quote`、`source-map-js`、`compression`，仅对 NYC 消费者升级 YAML 解析器以移除生产链中的 `sprintf-js`；新增 3 项真实调用链兼容测试并接入现有强制门禁。修改为本地未提交内容，详情见[依赖修复记录](testing.md#w41-新增告警修复2026-10-07)。没有新增审计例外，最终输出为 `4 high (4 ignored)`。
- **形成内容审核队列。** 已核对两个冻结 ZIP 的摘要并完成两份来源审计、11 项数据测试；20 份草稿中先安排 8 份营养四项齐全的候选，其余 12 份按 6 类缺口整理证据。完整清单、适配限制及制作审核字段见[内容审核准备](data-sources.md#2026-10-07w41-内容审核准备结果)。所有候选仍待来源、许可与真实制作审核，没有批准执行或发布。

本轮使用仓库指定的 Node **22.23.2** / pnpm **10.18.0**。依赖更新后重新完成的本地检查如下；结果只覆盖本轮工作区，不替代新提交的 Linux/Windows CI 或真实环境验收。

| 检查 | 实际结果 |
| --- | --- |
| 冻结安装、工具链及版本元数据 | 通过；未分配新打包编号 |
| 全量测试 | client **88 suites / 434 项通过**；server **591 项通过、2 项条件跳过**；admin **12 files / 32 项通过**；依赖安全/兼容 **11 项通过**，发布、烟测及上游检查测试通过 |
| 覆盖率门禁 | 通过；client 行 **68.85%**、分支 **65.76%**；server 行 **88.21%**、分支 **83.02%** |
| 三端静态检查、契约、架构、provider、数据库 schema/boundary、隔离测试检查 | 全部通过 |
| Web 导出、服务端和后台构建、产物预算 | 全部通过；Web 导出不是 Android/iOS 安装包 |
| 生产依赖审计 | 通过，保留既有 **4 项精确例外**；不能沿用 10 月 5 日 CI 作为今天审计的证据 |

另在依赖更新前，使用本机**独立临时 PostgreSQL 17** 完成迁移/备份/恢复/HTTP 回归、队列与后台营养两组测试（6 项）、基础数据导入（10 项），补验了普通全量测试中两处需要 PostgreSQL 的条件分支。临时实例已停止，使用的都是合成测试数据；它不证明 PostgreSQL 16 的最终候选 CI、脱敏旧 staging 升级或 #106 的完整恢复演练通过。

本地日志及工作区文件摘要保存在忽略目录 `artifacts/quality/w41-20261007/`，含 `test-all-final.log`、`coverage-final.log`、`checks-final.log`、`build-final.log`、`audit-final.log`、`postgres.log` 与 `worktree-scope.json`。代码、依赖和文档修改目前仍在工作区；未提交、推送、合并、部署、线上导入或生成新包。

### 10 月 7 日追加：#221/#219 本地实现与整合验证

- **#221 代码已实现。** 登录页新增已验证绑定手机号的恢复流程；恢复凭据与登录/已登录复核分用途，事务内核对绑定、启用状态和会话版本，一次性消费并吊销旧会话；密码登录补齐凭据快照检查，防止旧密码的并发请求取得重设后的会话。SQLite 和独立临时 PostgreSQL 17 回归通过。邮箱恢复不支持，真实短信与部署后恢复流程仍待验收。
- **#219 代码已实现。** 包含按原生身份/渠道/版本匹配的清单接口、签名与公开工件校验的发布/撤下工具、前端入口，以及执行下载、哈希/包身份/签名校验与安装的本地 Expo Android 模块。正式下载源、部署和真实安装升级仍待验收；OTA 二期待排。配置与操作见[专题记录](w41-account-recovery-and-app-updates.md)。
- **最终全量回归通过。** 恢复 token 调整后复跑为 client **92 suites / 451 项通过**、server **600 项通过、2 项条件跳过**、admin **12 files / 32 项通过**，与上表先前的 434/591 项记录属于不同检查轮次。新增实现阶段覆盖率门禁及 Web/服务端/后台构建通过；最后调整后又通过三端相关静态检查、契约、数据库 boundary、provider、生产审计、服务端构建及产物预算。审计仍为既有 **4 high（4 ignored）**。
- **数据库验证已收口。** 最初新增查询触发 boundary 检查后，改为恢复 token 携带只用于定位的用户 ID，完整 token 仍按独立用途哈希并在原事务内核验；删除额外查询，未扩大 SQLite baseline，最终冻结 **76** 个文件。最新定向服务端 **15 项**通过，独立临时 PostgreSQL 17 的账户安全断言再次通过且实例已停止；常规全量测试的两处 PostgreSQL 条件分支另有独立验证记录。
- **Android 更新模块原生编译通过。** 经用户授权在临时目录接受许可并安装 SDK 36、build-tools 36.0.0 与 NDK 27.1.12297006，使用 JDK 17.0.17、Gradle 8.14.3、Kotlin 2.1.20 执行 `:apk-updates:compileReleaseKotlin`，结果为 `BUILD SUCCESSFUL`（5 分 16 秒，45 个任务）。实际编译发现 Expo 模块缺少必需的库版本配置，补齐后通过；应用 `release.json` 未变。没有执行 assemble、生成 APK 或分配编号，完整打包与真机安装仍待验。

本轮证据在忽略目录 `artifacts/quality/w41-account-updates-20261007/`：`test-all-final.log`、`checks-final.log`、`budgets-final.log`、`password-targeted-final.log` 及实现阶段 `coverage.log` / `build.log`。`password-postgres.log` 是 token 格式调整前的完整集成验证；最终格式的 PostgreSQL 断言结果保存在执行工具记录，来源及临时实例停止情况另记于 `password-postgres-final-evidence.json`，不将旧日志冒充最后一轮。

同目录的 `apk-updates-native-compile.log` 与 `apk-updates-native-compile-evidence.json` 保存实际原生编译日志、工具链、临时目录和源码摘要；编译副本与仓库相关 8 个文件哈希一致，首次配置失败日志另行保留。SDK/NDK 及 Android 生成物在临时目录，既有用户 SDK 配置未变；保留正常依赖下载缓存。上述结果仍只覆盖本地代码，未提交、推送、部署或打包。

## 三项 P0：执行资料已整理，实际验收待输入齐备

2026-10-07 已按现有[报告工具](../deploy/p0-report.mjs)、[部署与备份步骤](../deploy/README.md)、[运维手册](operations.md)和[双端真机清单](device-beta-checklist.md)整理以下入口。这里没有填入新候选 SHA、执行人或通过结果；旧候选和本地/CI 证据不能替代这一轮验收。

### 开始前尚需填齐的输入

| 范围 | 当前记录未齐备的输入 | 保存位置与边界 |
| --- | --- | --- |
| 三项共用 | 最终完整 40 位候选 SHA、对应 CI/镜像摘要、发布负责人和各项执行人；独立 staging HTTPS URL、部署版本证据、执行窗口 | 受限报告目录及各原 Issue；health 成功不足以确认部署 SHA |
| #105 | 受控主机访问、DNS/TLS 与允许的 CORS Origin；独立数据库/持久卷、媒体位置、JWT/管理员/AI 密钥；应用与迁移账号分权、密码轮换及可恢复旧版本 | 按 `deploy/.env.example`、`deploy/server.env.example` 配置；密钥由环境注入，报告只记隔离与权限核验结果 |
| #106 | 该候选空库目标、真实上一候选的脱敏 staging 快照及版本、另一个空恢复库；兼容 PostgreSQL 版本的工具、备份目录/异地目标/保留策略；明确 RPO/RTO 目标与交接人 | 备份放仓库外受限目录；不能用新建合成库代替旧库升级，媒体对象须另有恢复依据 |
| #107 | 同提交且连接同一 staging 的 Android/iOS 包及摘要、签名/安装权限、覆盖升级基线；双端型号/系统/执行人；隔离测试账号及已审核的核心闭环内容 | [真机记录表](device-beta-checklist.md#1-测试记录)；每个端分别留存安装、业务与异常恢复证据 |

内容审核准备见[20 份候选及缺口队列](data-sources.md#2026-10-07w41-内容审核准备结果)。现有烟测会创建并删除临时账号，且要求服务中有已批准菜谱；不能为了跑通烟测，把参考菜谱直接标为已批准。

### 报告要求的 20 个检查点

以下 ID 与工具 `requiredChecks` 一致，**全部待实际执行记录**。#105、#106 以及 `same-candidate` 要求 `environment=staging`；其余六项要求 `environment=device`。

| Issue | 检查 ID | 最少应保存的真实证据 |
| --- | --- | --- |
| #105 | `https-external` | 外部网络访问 HTTPS、TLS 及 health 结果，绑定部署版本 |
| #105 | `cors` | 允许及拒绝 Origin 的实际响应、代理配置核对 |
| #105 | `isolation` | 数据库、角色、密钥、媒体、域名与备份隔离；演示种子关闭 |
| #105 | `admin-password-rotated` | 初始密码已轮换、旧密码不可用的结果，不留密码 |
| #105 | `restart-persistence` | API/worker、容器及主机重启前后的账号、库存和迁移版本对照 |
| #105 | `rollback-runbook` | 可用旧镜像/配置/备份、回滚步骤、责任人与触发条件 |
| #106 | `empty-database` | 同候选在空 PostgreSQL 的迁移日志、权限及核心读写验证 |
| #106 | `previous-staging-upgrade` | 脱敏上一候选的真实版本/快照、升级日志与业务对照；适用时含 `0029` |
| #106 | `backup-integrity` | 同候选备份 manifest、归档大小/摘要/时间点与 inspect 结果 |
| #106 | `restore-business-data` | 空隔离库恢复后登录、库存、待吃余量、实际摄入、管理统计、媒体及双账号隔离 |
| #106 | `restore-failure-protection` | 隔离目标上的损坏归档、非空目标、事务失败拒绝及原库未变证据 |
| #106 | `rpo-rto` | 预定目标、快照/模拟故障/业务恢复时间线、实测差值及交接结论 |
| #106 | `offsite-retention` | 每日调度、加密异地保留至少 30 天的配置，以及下载并恢复一份异地备份 |
| #107 | `same-candidate` | 两端包的完整源码 SHA、构建号/摘要、同 staging URL 与服务部署 SHA |
| #107 | `android-install-upgrade` | Android 全新/固定签名覆盖安装、冷启动及登录/数据保留 |
| #107 | `android-core-loop` | 注册/档案→三种库存→菜谱→制作扣减→待吃→实际食用与汇总，含重试幂等 |
| #107 | `android-recovery-accessibility` | 权限拒绝、弱网/401/重启、字体放大、键盘/安全区与 TalkBack |
| #107 | `ios-install-upgrade` | iOS 全新/覆盖安装、冷启动及登录/数据保留 |
| #107 | `ios-core-loop` | 与 Android 同一业务口径的独立 iOS 闭环证据 |
| #107 | `ios-recovery-accessibility` | iOS 权限拒绝、弱网/401/重启、字体放大、键盘/安全区与 VoiceOver |

### 执行顺序与已有命令

1. 先确定最终候选、执行人、环境和 RPO/RTO 目标；盘点及备份现有 staging。使用独立目标完成空库初始化、脱敏旧库升级，核对迁移及应用角色，再完成 #105 网络、密码与重启持久化检查。部署操作按[现有步骤](../deploy/README.md#部署)执行，保留可回滚版本。
2. 在该 staging 录入隔离测试数据，运行烟测并保存清理结果；备份后从空隔离库恢复，并启动同候选 API/worker 验证业务。故障注入只在隔离目标进行。记录从模拟故障至业务恢复的完整 RTO，不能用归档工具的 `durationMs` 代替；RPO 对照实际快照时间点。最后验证异地副本与交接。
3. 环境与恢复通过后生成同提交双端候选，按仓库规则在实际新打包前分配编号；分别执行上表 Android/iOS 三项。设备、构建元数据、服务版本和证据必须能互相对应。
4. 将实际结果填入报告输入，生成汇总并逐项人工复核；不齐项继续显示 `incomplete`，三项 Issue 按各自原关闭标准判断。

下列是后续执行入口，本次整理未执行线上命令。先安全注入 `STAGING_BASE_URL`、`DATABASE_BACKUP_URL`、`DATABASE_RESTORE_URL`、`BACKUP_OWNER`、`CANDIDATE_GIT_SHA`；恢复 URL 必须指向**未预先迁移的空隔离库**。`P0_BACKUP_DIR` 为仓库外尚不存在的备份目录，`P0_INPUT`/`P0_OUTPUT` 为受限证据目录中的输入与新输出路径。

```sh
node deploy/staging-smoke.mjs
pnpm --dir server db:postgres:backup "${P0_BACKUP_DIR:?设置新的备份目录}"
pnpm --dir server db:postgres:inspect "${P0_BACKUP_DIR:?设置备份目录}"
pnpm --dir server db:postgres:restore "${P0_BACKUP_DIR:?设置已核验的备份目录}"
node deploy/p0-report.mjs "${P0_INPUT:?设置实际结果输入路径}" "${P0_OUTPUT:?设置新的报告输出路径}"
```

`input.json` 顶层填真实 `candidateSha`、`owner`、无凭据的 HTTPS `stagingUrl` 和 `checks` 数组。每项填表中 `id`、同一个 `candidateSha`、实际 `executor`/`executedAt`、`environment`、`status`（`passed`/`failed`/`blocked`）和 `evidence` 文件列表；未执行的检查可以暂缺，确认阻断后才记录实际阻断情况。证据路径须相对输入目录，不允许绝对路径或 `..`；通过项必须有证据。不要放入密钥、数据库归档或真实健康数据。

工具计算证据文件 SHA256、拒绝候选不一致并禁止覆盖旧报告；它不核实证据内容或自动执行演练。`readyForReview=true` 只表示该 Issue 所需检查的结果、环境和附件齐备，仍须人工验收；命令退出成功也不等于三项 P0 通过。

## 进度登记与周末判断

- [x] 10 月 6 日创建 W41 里程碑，将 W40 的 18 项未完成 Issue 结转；4 项已关闭记录留在 W40，当时 Backlog 23 项保留原排期。
- [x] 10 月 7 日将 #221/#219 从 Backlog 加入 W41；当前 W41 共 20 项、Backlog 剩余 21 项，P0 仍为 3 项。
- [x] 完成 #221 手机自助恢复和 #219 完整 APK 更新的本地代码实现及阶段性整合回归，#221 SQLite/PostgreSQL 安全回归通过；两项 Issue 保持开放。
- [x] 最后一轮全量检查与 Android 更新模块原生编译通过，记录实际失败修复及通过证据；未生成 APK。
- [ ] 完成两项部署配置，再分别补齐真实短信、恢复流程、正式下载源和真机安装升级验收。
- [x] 建立本周独立进度文档，更新 README、TODO、路线图与真机清单入口。
- [x] 整理 #105/#106/#107 的缺失输入、20 个检查点、证据字段与现有工具执行顺序；实际 staging/双端验收仍待执行。
- [x] 核对已有未提交代码并完成 #248 审阅，修复 5 项新增依赖告警，完成本轮工作区适用检查。
- [x] 整理真实内容审核队列及营养缺口，复查冻结包摘要、来源审计和 11 项数据测试。
- [ ] 按范围整理提交并固定统一候选 SHA，运行该提交的完整 CI；本地结果不替代候选提交与平台门禁。
- [ ] 明确独立环境、bucket、双端设备、内容审核及执行人，按上表补齐证据。
- [ ] 逐项在原 Issue 保存提交、候选、环境、执行人、实际结果及剩余问题，满足原标准后关闭。
- [ ] 周末根据实际证据决定是否进入受控外部 Beta；条件不足的任务保留开放并说明原因。

结转只调整排期，不表示业务验收通过。三项 P0（#105/#106/#107）仍未关闭；P0 清零且核心 P1 验收或得到明确处置后，才决定外部 Beta。此次排期未部署、未生成安装包、未分配打包编号；`release.json` 保持原值，实际新打包前再按仓库规则同步标签并分配编号。
