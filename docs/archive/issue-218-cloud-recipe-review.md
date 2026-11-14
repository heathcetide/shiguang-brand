# #218 云端食谱审核与发布核对

核对日期：2026-09-14（上海时区）。Issue：https://github.com/AdlinZ/DietDigiDose/issues/218。
环境候选：`https://dietdigidose.top`，来自仓库 `STAGING_BACKEND_BASE_URL`；尚待用户确认与 Android 当前连接环境相同。

## 已复现的公开接口结果

以下均为匿名、只读 HTTPS 请求，没有修改云端数据。仅保留公开食谱及汇总信息，不保存身份凭据。

| 请求 | 实际结果 |
| --- | --- |
| `GET /api/v1/recipes?pageSize=100` | HTTP 200；total=1；nextCursor=null；仅 id=1「番茄炒蛋」 |
| `GET /api/v1/recipes/library-summary` | HTTP 200；official=1、community=0、publicTotal=1 |
| `GET /api/v1/recipes?search=番茄` | HTTP 200；仅 id=1「番茄炒蛋」 |
| `GET /api/v1/recipes?search=白菜` | HTTP 200；空列表 |
| `GET /api/v1/recipes/1` | HTTP 200；status=approved、quality_status=trusted、automatic_inventory_write_allowed=true |
| `GET /api/v1/admin/recipes?pageSize=1` | HTTP 401；AUTH_REQUIRED |

可见数量、搜索和详情一致，独立确认了公开库只有一个可见食谱。公开 API 无法证明云端隐藏记录的总量、状态分布或未通过原因；不能将用户提供的审核原因误写为数据库核查结论。

本地 SQLite/PostgreSQL 食谱仓库均要求 `deleted_at IS NULL`、`status='approved'` 且 `COALESCE(quality_status,'trusted') <> 'needs_review'`。自动执行资格另行控制。暂未取得证据表明本次需要修改客户端加载或放宽可见性规则。

## 已有内容底稿

`datasets/base-data/review/recipes.json` 的 341 条记录全部为 `pending_evidence`，均禁止自动执行。这是本地 rc.7 附件盘点，**不代表云端实际记录**。

- 321 条缺少份数、321 条缺少厨具映射。
- 20 条缺少许可证据、20 条缺少来源 URL。
- 341 条营养未知；烹饪执行、设备要求、任务时间及存放/携带/复热依据均尚未验证。
- 6 条需复核重复关系；另有逐食材映射与结构化用量缺项，详见原始底稿。

这些盘点标记不能替代语义审核；展示资格与执行资格须分别判断。本次未选定上线清单，未将底稿批量设为审核通过。

## 继续处理所需信息与验收

1. 确认目标环境，提供已授权的后台登录会话或 SSH 入口。当前无可用管理会话，管理 API 要求鉴权。
2. 读取目标库，按删除状态、审核状态、质量状态、来源及执行资格汇总；逐条记录拟上线食谱的缺项和原因。
3. 确认上线清单，对符合条件记录通过现有管理流程补全、审核并保留审计；未通过项保留原因。
4. 核对新增公开记录的列表、搜索、详情和总数，同时核验关联食材的引用与可见性；若发现独立食材故障，另行跟踪。
5. 用同环境 Android 真机刷新，记录实际 APK 快照及结果。本机未检测到可用 adb 命令，尚无真机验收证据。

状态：已完成公开现象复现与本地底稿核对，尚未完成云端审核发布及真机验收；#218 不应关闭。本次没有修改应用代码或云端记录。

## 登录后台后的核查与代码修复（2026-09-14）

用户在 Edge 登录后，通过 Computer Use 读取到食谱后台：全部来源/全部状态下总数 342、平台 342、社区投稿 0、待审核 341、待复核 341。待审核筛选返回 341 条。首屏 50 条导入记录均显示 base_data 来源，且质量提示为「质量问题记录无法解析」。打开「鸡蛋花」编辑界面时食材和步骤显示空输入；没有提交保存或质量审核。

代码证据：PostgreSQL 管理仓库直接返回 jsonb 数组；管理页面却对 quality_issues_json、steps_json、ingredients_json 再次执行 JSON.parse。SQLite 的 JSON 文本路径正常，PostgreSQL 数组路径抛错，质量原因因此不可读，编辑字段因此回落为空。导入脚本写入的质量问题代码是 nutrition_unknown / cooking_not_reviewed。另发现非用户来源状态被 UI 固定显示为「已发布」，与待审核记录的真实状态不符。

本地修复：同时接受 JSON 文本与原生数组；补齐两种导入问题的中文说明；编辑加载复用相同解析；所有来源按实际 status 显示状态；汇总标题改为「待审核食谱」。未改变审核过滤或将任何记录设为可信。

验证：管理端 6 套/21 项测试通过（新增 5 项覆盖双格式、编辑数组保留、异常值和状态）；TypeScript + Vite 生产构建、oxlint、git diff --check 通过。修复尚未部署，修复后的页面尚未完成浏览器验收；云端逐条内容补全、审核发布和 Android 真机验收仍待完成。后台会话现已可读，不再将缺少登录作为唯一阻塞原因。
