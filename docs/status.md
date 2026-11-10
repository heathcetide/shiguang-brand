# 项目状态与证据导航 / Status and evidence index

这是固定导航入口，不是实时状态报告，也不自动宣称某项功能已上线或验收通过。查看记录时请核对日期、源码提交、构建渠道与验收环境；旧周报中的“当前”仅指记录当时。

This is a stable index, not a live status report. Check each record's date, source commit, build channel, and environment. Implementation, build success, deployment, and device acceptance are separate claims.

## 从哪里查看 / Sources

- 任务与排期：[Issues](https://github.com/AdlinZ/DietDigiDose/issues)、[开放里程碑](https://github.com/AdlinZ/DietDigiDose/milestones)。排期不代表验收通过。
- 自动化检查：[main CI](https://github.com/AdlinZ/DietDigiDose/actions/workflows/ci.yml?query=branch%3Amain)。请查看目标提交的结果，而非其他提交的绿灯。
- Android 构建：[Android APK 工作流](https://github.com/AdlinZ/DietDigiDose/actions/workflows/android-apk.yml)。成功运行中的产物及 build-identity.json 标识实际源码、渠道与版本；产物可能过期，运行记录不是永久下载地址。
- 发布与真机门槛：[真机验收清单](device-beta-checklist.md)、[部署与恢复手册](operations.md)、[APK 安全门禁](apk-security-gate.md)。代码合并或 CI 通过不能替代这些证据。
- 历史计划和证据：[docs 目录](.)。按日期查看 milestone-*、server-update-*、web-deployment-* 等记录；历史记录不应随周数变化而改写。
- 产品方向：[产品路线图](product-roadmap.md)。[Beta 收口清单](../TODO.md)含历史工程记录，阅读时以其日期及关联 Issue 的最新验收证据为准。

## 版本来源 / Version sources

[release.json](../release.json) 是仓库版本基线，不是“最新成功 APK”。构建流程会分配新的快照编号，失败构建也占用编号；因此最新 apk-build/* 标签不能证明构建成功。实际安装包请核对成功运行的产物身份和校验报告。

The checked-in release.json is repository metadata, not the latest successful APK. Reserved build tags can belong to failed builds. Use the successful run's artifact identity and verification reports for a particular package.

## 如何维护 / Maintenance

- README 的产品介绍、使用方式和安全边界由人工维护；不要复制当周日期、Issue 数量或部署结论。
- 修改 .nvmrc 或 package.json 的 packageManager 后，运行 `pnpm docs:generate`，提交中英 README 的生成区块差异。区块之外不会被覆盖。
- 运行 `pnpm docs:check` 与 `pnpm test:docs`。检查范围为两个根 README、本导航页，以及脚本 entryDocuments 中列出的维护入口（TODO、贡献指南、admin README、测试/运维/迁移/签名/真机清单/路线图）：生成区块、本地链接目标是否存在、README 命令表中的脚本是否存在。它不验证外站可用性、Markdown 标题锚点、翻译质量或线上状态。
- 有新的部署或真机验收证据时，在对应任务和有日期的记录中更新，不从合并、打包或周数变化推断完成。

Regenerate the bounded README blocks with `pnpm docs:generate`; check them with `pnpm docs:check` and `pnpm test:docs`. Narrative and translations remain human-maintained. Checks cover the entry documents listed in scripts/readme-docs.mjs, not external uptime, heading anchors, translation quality, or live deployment state.
