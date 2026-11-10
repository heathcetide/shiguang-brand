# 分层测试与质量门禁

仓库支持并在 CI 固定使用 Node.js 22.23.2 与 pnpm 10.18.0。Linux 是完整发布门禁环境，Windows 使用同一工具链执行冻结安装、三端 lint/test/build、产物预算和生产依赖审计；macOS 可用于本地 Expo/iOS 开发，但不能替代 CI。

## 测试层次

| 层次 | 命令 | 边界 |
| --- | --- | --- |
| 单元 | `pnpm -w test:unit` | 客户端纯逻辑与组件、服务端无网络模块、管理端模型与工具 |
| API contract | `pnpm -w test:contract` | HTTP 状态、错误 envelope、认证/授权、请求与响应字段 |
| 核心 E2E | `pnpm -w test:e2e` | 注册、库存、饮食记录、家庭与账号删除等跨模块流程 |
| migration/recovery | `pnpm -w test:migrations` | 空库、上一 migration、在线备份、独立恢复和安全副本回滚 |
| 全量回归 | `pnpm -w test:all` | client、server、admin 的全部自动化测试 |

SQLite 测试数据库必须位于各测试创建的系统临时目录；PostgreSQL 集成测试使用独立测试服务及专用数据库。不得读取开发、staging 或 production 数据库。每个 job 必须使用隔离数据库或 schema，并在结束时清理，不能让并行任务共享可写 schema。现有 CI 的 PostgreSQL 服务和测试环境变量见 [CI workflow](../.github/workflows/ci.yml)。

## 文档入口检查

运行 `pnpm -w docs:generate` 更新中英 README 的工具链区块；`pnpm -w docs:check` 检查生成漂移、选定文档的本地链接目标和 README 命令表；`pnpm -w test:docs` 验证这些检查。CI 独立执行文档检查与测试，不依赖应用依赖安装，也不代表线上验收。维护范围见[状态导航](status.md)。

## 覆盖率

`pnpm -w test:coverage` 是合并门禁。当前下限保留合理增长空间，但任何提交都不能让已覆盖的关键范围低于：

- client：statements 40%、branches 40%、functions 35%、lines 42%；采集 `utils`、`services`、已抽离 screen model/hook、`Screen` 与主题上下文。
- server：lines 70%、branches 60%、functions 70%；采集全部 `server/src/**/*.ts`。

下限不是质量目标，也不能通过缩小采集范围绕过。提高阈值或增加关键目录不需要等待大版本；降低阈值必须在 PR 中附原因、恢复 issue、负责人和到期日期。

## 产物预算

三端构建后运行 `pnpm -w quality:build-budgets`。预算保存在 `quality/build-budgets.json`，同时限制目录总大小、JavaScript 总大小和最大单个 JavaScript 文件。超过预算直接阻止合并；确有产品需求时，PR 必须记录增量来源、弱网/启动影响和后续拆分计划，不能只放大数字。

2026-10-12 官网新增手记和更新日志两条懒加载路由，构建后对应 JS 分别为 11,470 与 5,569 字节；admin 全部 JS 为 817,874 字节。因此将 admin JS 总预算从 800,000 调整至 820,000 字节（+2.5%），总产物 1,800,000 和最大单文件 330,000 字节限制不变。新页面仅访问对应路由时加载，弱网下会增加该页面的下载等待；未进行弱网耗时实测，不据此声称启动性能改善。两张 Gemini 示意图改用 WebP，避免原始 PNG 使总产物超限。后续手记增长时按文章拆分数据加载，继续保留路由懒加载，不将全部正文并入首页入口。

## Flaky 与跳过测试

CI 的 `stability` job 从同一提交连续运行两轮全量测试，并上传 `test-stability-<SHA>` JSON 报告，任意一轮失败都会阻止合并。处理规则：

1. 先保存失败 job、系统、随机输入和日志，创建或关联 issue；禁止仅重跑到绿色后合并。
2. 修复后至少在失败平台连续通过两轮，并保留正常测试入口。
3. `test.only`、`describe.only` 等 focused test 一律失败。
4. `test.skip`、`test.todo` 等只能临时隔离；`quality/test-quarantine.json` 必须登记文件、issue URL、负责人、原因和不超过 14 天的 `expiresOn`。过期、重复、无实际 skip 或未登记的 skip 都会失败。
5. 隔离项仍由对应 issue 跟踪；到期前必须修复或由维护者重新评估，不能无限续期。

本地可运行 `pnpm -w test:stability` 生成 `artifacts/quality/test-stability.json`；该目录被 Git 忽略，不得提交包含环境敏感信息的测试日志。

## 依赖告警

`pnpm -w audit:prod` 对任何新增生产依赖告警失败。`pnpm-workspace.yaml` 只允许精确、已记录且有上游跟踪 issue 的临时 CVE 例外；上游发布修复后必须升级并删除例外，不能用通配规则掩盖告警。

若安全版本改变模块格式而旧版上游消费者尚未兼容，可用 `patchedDependencies` 仅恢复模块互操作层；不得回退安全实现，并必须同时验证真实消费路径、客户端构建与生产依赖审计。

以下有日期的小节是历史修复与复核要求，不代表刚刚查询过上游或重新运行过审计。当前配置以 [pnpm-workspace.yaml](../pnpm-workspace.yaml) 为准；到期复核必须补充实际证据，不能仅更新日期。

### W41 新增告警修复（2026-10-07）

10 月 7 日重新运行审计发现 5 项新增告警，旧提交的 CI 结果不能覆盖新披露的依赖问题。本轮通过现有 overrides 更新以下依赖及锁文件，没有新增补丁或审计例外：

| 依赖 / 告警 | 本轮处理 |
| --- | --- |
| `proxy-addr` / [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) | 升级至 `2.0.8`，修复 IPv4 映射 IPv6 子网的代理信任判断 |
| `shell-quote` / [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) | 升级至 `1.11.0`，修复注释 token 后换行的引用处理 |
| `source-map-js` / [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | 升级至 `1.2.2`，修复索引 source map 偏移导致的资源耗尽 |
| `compression` / [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95) | 升级至 `1.8.2`，修复响应提前关闭后的压缩流泄漏 |
| `sprintf-js` / [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | 仅将 `@istanbuljs/load-nyc-config@1.1.0>js-yaml` 升至 `4.3.2`，移除生产依赖中的 `argparse@1 → sprintf-js` 调用链 |

NYC 消费者使用 `load()`，可兼容 YAML v4；开发工具 `depcheck` 仍使用 `safeLoad()`，因此保留它的 v3 依赖，不能全局跨主版本覆盖。`scripts/nyc-config-compatibility.test.mjs` 的 3 项测试覆盖真实 React Native/NYC 的 YAML 继承与错误处理、Babel 子进程插桩及排除规则、depcheck 的旧 API；已接入 `test:dependency-security`，因此完整测试和生产审计都会先运行。v4 不再接受旧的 JavaScript 专有 YAML tag，测试明确记录这一行为差异。dev 链仍含 `sprintf-js`，不能描述为从整个锁文件移除。

更新后冻结安装、11 项依赖安全/兼容测试和 `audit:prod` 通过；审计仍报告 **4 high（4 ignored）**，均为既有精确例外，不能称作零漏洞。回滚必须同时处理 overrides、锁文件和兼容测试；回到旧依赖会重新触发这 5 项生产审计告警，不应作为可发布候选。

### node-forge 临时安全回补（2026-10-02，已于 10 月 31 日退出）

2026-10-31 升级至上游 `node-forge@1.4.1`，移除旧本地补丁及 `CVE-2026-85393` 例外，保留原有 RSA/证书/CSR 回归。以下记录用于追溯旧版补丁。

- `CVE-2026-85393` / [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)：RSA PKCS#1 v1.5 验签未拒绝嵌套 `DigestAlgorithm` 中的额外元素。2026-10-02 核对时 npm 最新版 `1.4.0` 仍受影响。
- 实际依赖来自 Expo CLI 和 `@expo/code-signing-certificates`；后者在证书、CSR 和 manifest 签名验证中调用该解析器，不能仅按开发工具豁免。
- `patches/node-forge@1.4.0.patch` 回补[上游 PR #1152](https://github.com/digitalbazaar/forge/pull/1152) 提交 `ceba34402e329f0365134f23fe19898756527d65` 的 `lib/rsa.js` 修复，增加嵌套元素数量校验。上游跟踪：[issue #1149](https://github.com/digitalbazaar/forge/issues/1149)。这是项目本地回补；记录当日上游尚未发布修复版本。
- 版本审计无法识别 pnpm 补丁，因此仅对该 CVE 设置临时精确例外。`audit:prod` 必须先运行 `test:dependency-security`：沿两个真实消费者解析依赖，验证有/无 NULL 参数时拒绝额外元素，并验证正常证书、CSR、manifest 签名和 Node 原生验签兼容。原版有 4 项回归失败，应用补丁后全部通过；移除补丁会阻止审计命令继续。完整测试也包含此检查。
- 维护责任：仓库依赖维护者。上游发布修复后，升级 `node-forge` override，同时移除补丁、`patchedDependencies` 条目与该 CVE 例外，保留回归测试并重新运行完整 CI。其他新漏洞仍直接阻止合并。

### braces 临时安全修复（2026-10-05）

- `CVE-2026-93687` / [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)：长度限制内的深层嵌套模式仍可导致递归栈耗尽。核对当日 npm 最新版仍为受影响的 `3.0.3`，官方尚无修复版本；[上游 PR #75](https://github.com/micromatch/braces/pull/75) 尚未合并。
- `patches/braces@3.0.3.patch` 是本项目维护的修复，基于官方 `3.0.3`，不是已发布的上游补丁。它在解析、编译、展开、字符串化、嵌套数组遍历及父节点遍历中设置固定深度界限，超限抛出可识别的 `RangeError`。路径预算为 64，文本最多允许 63 层实际括号嵌套；普通转义及浅层匹配保持原行为。此补丁解决深层递归与循环遍历，不改变原有 `rangeLimit`，也不声称覆盖所有资源耗尽风险。
- `scripts/braces-security.test.mjs` 沿 Expo/Metro、Jest、开发代理和依赖检查工具的 8 条真实消费链解析 `micromatch` / `braces`，对每个实际副本验证深层字符串、未闭合括号、直接 AST、循环节点/父节点、嵌套数组及正常匹配；危险输入在有超时的独立子进程执行。原版 2 组安全回归失败、1 组兼容回归通过；修补后全部通过。固定界限不能由 `maxDepth: Infinity/NaN` 绕过。
- 额外兼容检查使用官方 `3.0.3` 标签提交 `74b2db2938fad48a2ea54a9c8bf27a37a62c350d` 的全部 12 个测试文件、764 项测试，原版和修补版均通过。临时 runner 使用 Node 内置断言并禁止 shell 调用，没有给项目增加测试依赖；这些外部 fixtures 不替代仓库内的持续安全回归。
- 审计只识别版本号，因此沿用现有机制，仅为该 CVE 添加精确临时例外；`audit:prod` 和 `test:all` 都先执行安全回归，补丁缺失或任何实际消费副本未修复都会失败。没有放宽其他告警或使用通配忽略。
- 维护责任：仓库依赖维护者。最迟于 2026-10-19 复核上游状态（原定期限保留；本节尚未补充该期限后的复核结论，需另核对证据，不等于已证明存在新增漏洞）；上游发布修复后升级到兼容安全版本，删除补丁、`patchedDependencies` 条目及该 CVE 例外，保留回归测试并重新运行完整 CI。

### W44 发布门禁依赖升级（2026-10-31）

CI 生产审计阻断后，更新 `follow-redirects` 1.16.2、`node-forge` 1.4.1；现代 minimatch 9/10 消费者提升至 11.0.1，glob 13 消费者提升至 14.0.2；React Native 及 codegen 的两个同步 glob 消费者定向提升至 14.0.2，test-exclude 升级至 8.0.0。依据上游 [redirect 修复](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)、[minimatch 修复](https://github.com/advisories/GHSA-g3hv-75wg-m249)及 [glob 取消修复](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)。

React Native dev-middleware 的 `chromium-edge-launcher` 单独升级至 2.0.1，以移除旧 rimraf/glob/minimatch 3 的生产依赖链；未全局强制替换仍需要旧 API 的开发依赖。固定 Node 22.23.2 支持从 CommonJS 加载该 ESM 启动器；实际消费者加载回归由 Linux/Windows CI 验证，不启动浏览器。新增 `release-dependency-compatibility.test.mjs` 编入 `test:dependency-security`，覆盖真实消费者加载、原生 TypeScript spec 和 podspec 扫描、文件匹配/展开上限、取消后停止目录读取以及跨 realm 敏感头重定向清除；原有 NYC 测试验证 Babel instrumentation 排除规则，客户端 828 项覆盖率测试通过。没有新增审计例外；旧 braces/image-size 精确例外仍按原记录管理。
