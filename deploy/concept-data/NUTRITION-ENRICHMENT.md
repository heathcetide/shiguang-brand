# 营养补充上线记录 · 2026-09-15

已完成第二批补充，并发布到 [App 网页版](https://dietdigidose.top/app/)。

## 数据和可见行为

- 数据版本：`concept-enrichment-2026-09-15.2`，叠加在 `concept-base-1.0.0-rc.2` 上；旧包保持不变。
- 31 个具体形态营养样品参考（第一批 27 个，本批新增干紫菜、干面条、米醋、全脂鲜乳 4 个）。食材概念本身的通用营养仍为 NULL，参考值不能自动用于任意部位或状态。
- 20 道家常菜关联称量条件和来源；8 道具备四项主要营养的整份/每份估算，12 道显示明确缺项。热量整数列存每份四舍五入值，完整小数保留在营养参考元数据中。
- 新增 18 条有步骤证据的必需厨具关系。未确认替代能力时不声明可替代。
- 来源为 USDA 和 TFDA 冻结快照。保留 5 条不绑定决定及样品描述。米醋缺蛋白质/脂肪，牛奶原方为毫升，未填零或作无依据换算。CN6 原始数据没有进入公开接口。
- 参考配方继续保持 `quality_status=reference`，不进入自动营养配餐，`automatic_inventory_write_allowed=false`。
- 网页菜谱详情显示整份营养、每份估算、缺项，以及可展开的称量条件和来源。例：[番茄炒蛋](https://dietdigidose.top/app/recipe-detail?id=684)、[番茄鸡蛋汤面](https://dietdigidose.top/app/recipe-detail?id=702)、[醋溜土豆丝](https://dietdigidose.top/app/recipe-detail?id=686)。
- 数据实验室仍关闭：`/data-lab/` 返回 410。APK 未重新打包；已安装客户端可读取新的数值，新增详情展示以本次网页版为准。

## 构建、导入和验证

构建脚本：`datasets/base-data/reclean/enrich_next.py`。输入依次为 rc2 基础包目录、第一批补充目录、`.cache/base-data-sources/round2/tfda.zip`、新的输出目录。

导入脚本：`server/scripts/import-nutrition-enrichment.mjs`。设置 `DATABASE_URL` 与 `ENRICHMENT_MANIFEST_SHA256`，传入解压目录；默认事务回滚，`--apply` 提交。会检查来源清单、数值计算、形态、原始菜谱原料/步骤一致性及已有业务 ID。重复执行同版本不新增菜谱或厨具关系。

第二批 manifest SHA256：`4a5d7e0b88c6abcb3c65e8df02a54cd10c09a18d9c6f66117bbc9f96970f736d`。

验证结果：

- client TypeScript/ESLint、server TypeScript、Web 导出、server 构建通过。
- 36 项针对性测试、122 项 API 回归通过。
- 第二批重复构建 ZIP 字节一致；缺失营养、错误形态、单位、计算与来源清单篡改检查通过。
- 数据库备份恢复到独立验证库；演练、实际导入、重复导入成功。重复执行新增菜谱 0、新增厨具关系 0。
- 验证库与正式环境均逐一核对 20 道菜的列表/详情营养数据；正式导入前后账号、个人库存、收藏、个人厨具内容摘要一致。
- 线上健康接口、App 入口和详情路径均 200，数据实验室 410。
- 线上菜谱详情 JS SHA256 与本地一致：`52970b7e0d005a810502d279b855e0182328204d14ce6a7b6cf875a547f081da`。
- 浏览器自动读取页面超时，未声称完成视觉与点击交互验证。

## 发布位置和回退

- 镜像：`dietdigidose-server:nutrition-enrichment-20260915`，API 和三个 worker 同步。
- 发布目录：`/opt/dietdigidose/releases/nutrition-enrichment-20260915`。
- 主 Compose：`/opt/dietdigidose/deploy/docker-compose.staging.yml`。
- Web Compose：发布目录内 `app-compose.yml`。新目录同时保留旧静态资产，避免已打开页面请求旧散列文件失败。
- 备份：`/opt/dietdigidose/backups/nutrition-enrichment-20260915/database.before.dump` 和 `compose.before.yml`。
- 正式导入和逐菜接口核对报告：发布目录内 `production-import.json`、`production-api.json`。

服务回退可恢复备份 Compose（旧镜像 `concept-runtime-20260915-v2`），Web 使用旧发布目录的 `app-compose.yml`。旧版本界面不会完整说明本次样品假设，因此回退服务时还应撤销这 20 道菜的营养发布或暂时隐藏对应参考菜谱。需要撤销数据时从备份恢复到另一个临时库，逐项取回本次涉及的基础数据字段，并保留用户最新记录；不要将整库备份直接覆盖正式库。
