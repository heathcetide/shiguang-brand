# 26w43 执行计划与进度记录（已归档）

> **归档状态：** 26w43 周期（2026-10-19 至 2026-10-25）已结束，GitHub 里程碑已关闭。本周经 Android 物理真机验证完成并正式关闭 [#17](https://github.com/AdlinZ/DietDigiDose/issues/17)，客户端应用更新检测（#219）与 AI 审批业务表单（#229）已验证并建立 PR #273。剩余 19 项未完成 Issue 已结转至 [W44 里程碑](milestone-26w44-progress.md)。

更新：2026-10-25（上海时区）。本周周期为 **2026-10-19 至 2026-10-25，ISO 第 43 周**。

[W43 里程碑](https://github.com/AdlinZ/DietDigiDose/milestone/13) 承接 W42 的 **20 项未完成 Issue，含 3 项 P0（#105/#106/#107）**。原优先级、标签及验收标准保留；Backlog 21 项不自动纳入。W42 按周归档，不代表验收完成，已有实现与部署证据保留在 [W42 历史记录](milestone-26w42-progress.md)。

## W43 已落地进展回顾

- **社区评论软键盘定位遮挡修复真机验证关闭（#17）**：2026-10-25 使用 `26w43d` / build `264304` 预览包（Run 39796338989）在 Android 物理真机上完成实机测试。系统软键盘弹出后评论框与操作按钮均稳定位于键盘上方可见区域，各输入法切换及长文本交互正常，已在 GitHub 正式关闭 [#17](https://github.com/AdlinZ/DietDigiDose/issues/17)。
- **应用内更新客户端模块与 UI 交互真实验证（#219）**：真机进入“关于食光烙记”页面成功读取原生包版本身份（`1.0.6 (26w43d · build 264304 · preview)`），点击“检查应用更新”正确弹出更新检查对话框并优雅处理未配置清单的服务端返回，无崩溃闪退；留待服务端配置新包清单后验证覆盖升级。
- **服务端通用异常诊断隐私收口已入主线**：PR [#251](https://github.com/AdlinZ/DietDigiDose/pull/251) 已完成代码审阅并合入 main `c41fc752`，全量 CI（Linux verify, Windows compatibility, stability，614 项测试）全部通过。服务端通用异常和 webhook 隐私均得到收口保障。
- **官网部署与发布验证完成**：PR [#250](https://github.com/AdlinZ/DietDigiDose/pull/250) 记录已合入，线上静态资源、公网路由与健康检查通过。
- **客户端与发布门禁待收口草稿**：PR [#252](https://github.com/AdlinZ/DietDigiDose/pull/252)（敏感存储与缓存生命周期最小化）与 PR [#253](https://github.com/AdlinZ/DietDigiDose/pull/253)（签名 APK 发布安全门禁）CI 验证均已通过，留待后续真机与正式发布阶段进一步验收。

## W43 推进顺序与核心目标

1. **三项 P0 发布卡点演练**：
   - [#105](https://github.com/AdlinZ/DietDigiDose/issues/105) 部署独立 HTTPS staging 并验证持久化配置；
   - [#106](https://github.com/AdlinZ/DietDigiDose/issues/106) 完成空库、升级库与备份恢复演练；
   - [#107](https://github.com/AdlinZ/DietDigiDose/issues/107) 生成同提交双端候选包并完成核心闭环真机验收。
2. **应用内更新与账号恢复实机闭环**：
   - [#219](https://github.com/AdlinZ/DietDigiDose/issues/219) 配置 `APK_DOWNLOAD_ORIGINS` 白名单，重新打出具备更新源的候选包，在 Android 真机上验证同签名覆盖升级与数据保留；
   - [#221](https://github.com/AdlinZ/DietDigiDose/issues/221) 验证真实短信验证码找回密码与旧会话失效。
3. **内容、库存与烹饪体验收口**：
   - [#218](https://github.com/AdlinZ/DietDigiDose/issues/218) 云端食谱审核发布，验证移动端多食谱可见性；
   - [#220](https://github.com/AdlinZ/DietDigiDose/issues/220) 烹饪计时前后台与锁屏恢复真实验收；
   - [#189](https://github.com/AdlinZ/DietDigiDose/issues/189) ~ [#194](https://github.com/AdlinZ/DietDigiDose/issues/194) 库存结构化扣减、多餐制作与食用状态贯通。

## 结转清单（共 20 项，已关闭 1 项，剩余 19 项）

- [x] ~~[#17](https://github.com/AdlinZ/DietDigiDose/issues/17) 发表评论时键盘弹出但看不到评论输入框~~（2026-10-25 Android 真机安装 `26w43d` / build `264304` 实测通过，评论弹窗视口定位正常，已正式关闭）
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
