# 食材营养与菜谱来源核对

最近离线核对：2026-10-07（26w41）。范围是 `system-data-2026-09-15.2.zip`、当前补充包 `concept-enrichment-2026-10-03.1.zip`、恢复的来源证据和当前代码，不代表线上数据库已经更新。

通用覆盖补充累计新增 15 个 TFDA 样品参考，新增覆盖 13 个已有食材概念。累计 **46 个营养参考、44 个有参考的食材概念**；原 20 道菜的估算保持不变，仍为 8 道具有完整四项每份估算。2026-10-03 的补充包更新仅修复导入器，没有再次增加营养样品。补充包只追加参考，不改通用食材营养列或菜谱。

## 实际覆盖

| 项目 | 数量与含义 |
| --- | --- |
| 食材概念 | 1,079 个；基础包 31 个有参考，叠加补充包后为 44 个，剩余 1,035 个 |
| 营养参考 | 基础包 31 个，补充后 46 个：22 个 USDA SR Legacy、1 个 USDA Foundation、23 个 TFDA 样品 |
| 可逐值核对的原始观测 | 补充后 46 / 46；包含恢复的 5 个旧样品证据和新增 15 个样品的 60 条核心原始观测，未知值仍保留 |
| 有做法的菜品 | 385 个菜品、389 种做法；另外 730 个菜品概念没有做法，不计入菜谱覆盖 |
| 菜谱营养 | 20 种做法有估算与缺项记录，其中 8 种具有四项主要营养的每份估算 |
| 做法来源 | 369 种保留来源 URL 和声明许可；20 种项目草稿的这两项仍未补齐 |
| 做法缺项 | 279 种缺份数、290 种缺厨具、272 种缺明确食材或精确用量；这些集合有重叠 |

计数可由以下命令重新核对。报告还会逐项比对来源样品的营养 ID、单位、原始值和菜谱计算；有链接不算拥有原始观测。报告不把资料展示、营养估算或机器核对当成实做、来源适配或专业审核通过。

```sh
pnpm data:audit
pnpm data:audit:expanded
python3 -m unittest discover -s datasets/base-data -p test_source_coverage.py -v
python3 -m unittest discover -s datasets/base-data -p test_expand_nutrition.py -v
```

基础包报告：[source-coverage.json](../datasets/base-data/source-coverage.json)；叠加补充包报告：[source-coverage-expanded.json](../datasets/base-data/source-coverage-expanded.json)。测试同时检查报告与实际分发数据是否一致。

## 新增通用参考

新增菠菜、黄洋葱、紫洋葱、去皮混色苹果平均值、带皮富士苹果、北蕉平均值、2022 年冬瓜样品、白萝卜平均值、干绿豆、干红豆、干黑木耳、生莲藕，以及泛型酱油、豆腐、芝麻油下的限定样品。苹果与洋葱分别保留两种参考，不能合并成一个“通用平均值”。

选样理由和适用范围见 [tfda-expansion-selections.json](../datasets/base-data/evidence/tfda-expansion-selections.json)，原始核心行见 [tfda-expansion-rows.json](../datasets/base-data/evidence/tfda-expansion-rows.json)。保留样品编号、原始位置、原始文本、单位、完整来源归档与成员 SHA256；生成器还固定提取文件摘要，本次构建额外与完整 TFDA 原档逐行比对。配方输入、计算、称量合同和厨具证据与旧包逐字相同。

新导入器合并样品 ID，保留管理员追加参考；同 ID 内容冲突、同版本不同摘要、独立降级和未知现存版本会回滚。同版同摘要重复导入无更新。本次包的导入模式跳过所有菜谱和厨具写入，实际 PostgreSQL 测试覆盖了人工编辑保留、回滚与重跑。仅当前完整安装入口可在逐项一致性核验后保留较新引用、补装缺少的旧配方和社区，避免安装顺序锁死。未运行线上导入。

下载、摘要与导入方式见 [数据包说明](../datasets/releases/README.md)。离线可从随仓库的冻结输入逐字节重建新补充包，无须补齐旧历史中间目录。

## 来源的使用范围

- **USDA FoodData Central**：保留具体 FDC ID、资料类型、来源 URL 和计量基准。Foundation 样品、SR Legacy 历史资料和品牌包装标签是不同的数据类型，不能混称为本地食材实测。[官方资料类型](https://fdc.nal.usda.gov/data-documentation/)、[API 与 CC0 说明](https://fdc.nal.usda.gov/api-guide/)。
- **TFDA 食品营养成分资料集**：按整合编号、样品描述、分析项、单位和每 100 克含量核对，不按名称相似直接赋给所有同名食材。官方目录声明政府资料开放授权条款第 1 版。[官方目录](https://data.gov.tw/dataset/8543)。
- **HowToCook**：冻结提交的做法参考保留原文来源与 Unlicense 声明。原文步骤、份数、食材映射、厨具要求和营养完整性分别核验，不能因有开源许可就自动批准执行。
- **项目草稿**：标明项目编辑内容，不能冒充第三方实测配方。20 道草稿的来源标识和发布许可缺项应在正式审核时补齐。
- **Open Food Facts**：现有旧导入入口面向品牌包装食品，不是通用生鲜食材的营养依据。本轮未扩大其导入范围。

## 本轮已修复

- USDA 查询不再把未提供的营养写成零，真实零值和小数保留；返回来源编号、链接、类型和发布日期，仍属于待复核外部结果。
- 后台食材编辑与 SQLite/PostgreSQL 保存贯通未知值和真实零值；缺项不会因保存变成可信完整记录。同源更新时未提交的来源版本、许可、形态、可食比例与别名保留原值；切换来源时清空未提供的新版本、许可及旧来源时间。名称变更只同步既有规范名称关联。完整性状态只描述四项主要营养，不等于来源验证；本次未批量重写历史零值或修改线上数据。
- 搜索页可查看 USDA 来源，展开已有形态营养参考及适用范围。选择来源或展开参考不会触发记餐，也不会自动把样品营养绑定给整个食材概念。
- 同版本概念导入重复执行时保留补充营养、管理员编辑、别名和厨具关系；逻辑身份或版本冲突会失败并回滚。
- 从锁定的原始归档恢复了 USDA Foundation 鸡胸肉 `2646170` 的原始记录，并核对四项营养。新增证据位于 [evidence/usda-foundation-2646170.json](../datasets/base-data/evidence/usda-foundation-2646170.json)，包含外层归档 URL、SHA256、内层归档路径及 SHA256；原始记录未改写，旧冻结 ZIP 未修改。
- 从 TFDA 官方重新取回与既有锁完全相同的快照（SHA256 `c1ef5502ceceead6d5ce3b7ee21fe544702b1e508be73b196fce2cf0e61985cb`），恢复鸡蛋 `K01001`、番茄 `E74001`、胡萝卜 `E0200101`、马铃薯 `B0700201` 的 16 条核心营养原始行。位置、样品 ID、名称、分析项、单位和值逐项一致，见 [evidence/tfda-core-samples.json](../datasets/base-data/evidence/tfda-core-samples.json)。

旧冻结 ZIP 自带的脚本不会因仓库代码更新而改变。单独重跑概念导入时使用当前仓库的 `server/scripts/import-concept-runtime.mjs`；需要再次分发修复后的完整安装数据包时应产生新版本，不能覆盖原包及其哈希。

## 2026-10-03 复查修复

- **品牌饮品单位**：USDA 品牌数据可能按每 100ml 提供，不能用作每 100g。适配器仅在克基准明确时填入每 100g 字段；毫升或未知基准保留来源并阻止自动预填。[USDA 品牌资料说明](https://fdc.nal.usda.gov/GBFPD_Documentation/)。
- **后台部分更新**：只改名称或来源版本不再清空省略的营养与分类；显式 `null` 仍可清空。双库在事务内按合并后的四项数值校验并计算完整性。
- **概念食材计算边界**：即使后台保存了通用营养数字，概念搜索响应也只提供独立样品参考，不暴露通用营养值。客户端同时检查禁用计算标志，旧响应也不能自动预填。
- **未知摄入汇总**：全未知显示“未知”，部分已知显示“已知小计”；热量有缺项时不再计算剩余摄入额度或显示目标已达成。
- **小数热量保存**：生产 PostgreSQL 原整数列拒绝 `0.04`。新增 [0029 迁移](../server/drizzle/0029_diet_calories_precision.sql) 改为双精度，保留已有整数、真实零和 `null`。部署必须通过现有生产迁移流程应用该迁移；仅更新代码不能修复旧数据库列。
- **安装顺序与入口**：先装参考、后补完整基础包不再被旧营养阶段阻塞；新增完整包目录 CLI 参数，可以直接用当前仓库脚本导入解压的历史数据。独立旧包降级和冲突仍拒绝，旧 ZIP 与原摘要保留。

以上数据库验证均在隔离临时 PostgreSQL 中完成，不代表线上已迁移或部署。

## 尚待补齐与优先级

1. **生抽酱油**：影响 5 道配方。用户未指定品牌，本轮将淡色酱油作为泛型酱油下的独立样品，不绑定生抽原方。已找到[李锦记英国官方品牌标签](https://shopuk.lkk.com/products/lee-kum-kee-premium-light-soy-sauce)，但仅适用于该地区配方，脂肪还以 `<0.5 g/100g` 上界声明，不能改为精确零。本轮未将该品牌页纳入分发包。
2. **北豆腐、芝麻香油、米醋**：各影响 3 道配方。分别缺凝固剂/含水量匹配、焙炒及纯油/调和油匹配、来源未报告的蛋白质与脂肪。不能通过补零或忽略调味料使估算“完整”。
3. **牛奶和虾仁**：各影响 1 道配方。牛奶需明确密度或建立按克称量的新配方版本；虾仁需明确种类和是否保水处理。

受影响菜谱存在重叠，补齐一种食材不保证这些菜谱立即全部完整。当前参考配方的自动执行/自动配餐资格保持原来的审核边界；扩大数量前先补来源、样品适配与用量证据。

## 2026-10-05 收尾复核

后台食材表单仅提交修改过的字段及接口必填名称，支持 `0.04` 等小数，避免把未编辑的旧营养值覆盖回数据库。两数据库在事务内合并与校验；更换来源时将原 `trusted` 记录降为 `needs_review`，保留同源编辑的审核状态。省略别名时保留原别名，规范名称撞名后再次改名也能正确同步。SQLite 复用既有仓储读取，直接访问计数由 36 降至 33，仍限定在原有 76 个文件内。

客户端汇总仅在展示时消除浮点尾数，保留小数和真实零，不修改计算原值。照片识别返回零时正常填入，返回缺项时清空旧预设营养；来源链接仅允许 HTTP/HTTPS，打开失败可重试。参考样品和非克基准数据仍不自动填入记餐。

验证使用 Node 22.23.2 / pnpm 10.18.0：

- 客户端 89 套 / 432 项、服务端 591 项、后台 10 套 / 32 项通过；服务端全量中两个需要 PostgreSQL 环境变量的用例另在临时库通过。新增食材写入的 PostgreSQL 回归已接入 Linux CI。
- 客户端与服务端覆盖率门禁、三端静态检查和构建、原包体预算、共享契约、模块边界、schema parity 及 Drizzle 历史检查通过。
- 临时 PostgreSQL 17.11 的完整迁移、备份恢复、HTTP 集成，以及 10 项基础数据导入和双库营养写入回归通过；目标 PostgreSQL 16 与 Windows 以当前提交远端 CI 为准。
- 新增数据 Python 测试 11 项、两份来源审计与最新补充包逐字节重建通过，冻结包和原始摘要未改。全 Python 检查因本机缺锁定 rc.7 附件而有一项旧测试初始化失败，附件下载三次超时；没有替换原附件、修改来源锁或将该次检查宣称通过。

初次收尾的依赖审计被 `braces@3.0.3` 的 [CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 阻止。随后补入项目维护的深度限制修复、真实消费链回归及精确临时审计例外，详见 [依赖安全修复记录](testing.md#braces-临时安全修复2026-10-05)。官方尚无修复版本；例外必须与强制安全回归共同保留，不能单独忽略告警。

本轮是代码与冻结数据包收尾，未部署、未执行线上导入、未分配安装包编号；0029 迁移仍须随正式部署应用。真实菜谱审核、设备验收及 #187/#218 的原关闭条件保持不变。

## 2026-10-07：W41 内容审核准备结果

本节是 [W41 执行清单](milestone-26w41-progress.md) 中 #187/#218/#193 的离线准备交付。已复查冻结包、恢复的证据和审核字段，形成以下待审核队列；**尚未批准任何真实菜谱，也未选定最终发布范围**。

### 锁定输入与复核结论

- 基础包 SHA256：`5bc9345bf6e232e34a0c6cbd4091d55f1a7f1ecce3f2e930f847431c19db3f30`；补充包 SHA256：`2ac8fc7032be26155e4365bdf4113d425c7b3def37c31d70e721ec7c609daa80`，均与[分发说明](../datasets/releases/README.md)一致。
- 两份审计成功，来源覆盖测试 **6 项**、补充包测试 **5 项**通过，含补充包在临时目录逐字节重建、原菜谱不变和缺失营养不能补零的检查。基础包 31/31、叠加补充包 46/46 个样品的核心原始观测可核对；配方仍为 8 份四项估算齐全、12 份缺项。
- 冻结目录 **389/389** 种做法的 `kitchen_tested` 和 `automatic_execution_allowed` 均为 `false`；补充后 **46/46** 个样品的 `professional_review_performed`、`automatic_runtime_binding` 均为 `false`，`requires_scope_confirmation` 均为 `true`。这比“字段齐全”更接近当前真实审核状态。
- 20 份营养计算恰好对应全部 20 份缺来源 URL/声明许可的项目草稿；另外 369 种做法保留 HowToCook 提交 `2b19c9e9ee926fd925a68207a57582a338813f9c` 的逐条 URL 和 `Unlicense` 声明，但本包没有这些做法的营养评估。来源声明不代表已完成发布授权核对。

### 先审核哪一批

先准备下列 8 份已有完整四项每份估算的草稿，避免让新增营养样品成为首批审核的前置条件。**8 份仍全部缺来源/发布许可记录和真实制作审核**；估算使用的样品适配、可食部称量假设也须逐条确认。

下表 ID 均在冻结包 `data/nutrition/recipe-inputs.json`、`recipe-nutrition.json` 中；完整 ID 为 `METHOD:DDD-R-` 加表中后缀。

| 候选做法 | ID 后缀 | 当前营养结果 |
| --- | --- | --- |
| 胡萝卜炒蛋 | `carrot-egg` | 四项每份估算齐全 |
| 芹菜炒胡萝卜 | `celery-carrot` | 四项每份估算齐全 |
| 蒜蓉西兰花 | `garlic-broccoli` | 四项每份估算齐全 |
| 南瓜小米粥 | `pumpkin-millet` | 四项每份估算齐全 |
| 红薯焖饭 | `sweetpotato-rice` | 四项每份估算齐全 |
| 番茄炒蛋 | `tomato-egg` | 四项每份估算齐全 |
| 番茄鸡蛋汤面 | `tomato-noodles` | 四项每份估算齐全 |
| 西葫芦炒蛋 | `zucchini-egg` | 四项每份估算齐全 |

其余 12 份先按营养缺口整理证据，下表同时保留重叠项。它们与前 8 份共有的来源、许可和制作审核要求不因补齐营养而消失。

| 待补做法 | ID 后缀 | 尚缺营养依据 |
| --- | --- | --- |
| 蒜香花椰菜 | `garlic-cauliflower` | 生抽酱油 |
| 青椒鸡丁 | `pepper-chicken` | 生抽酱油 |
| 香菇炒白菜 | `shiitake-cabbage` | 生抽酱油 |
| 香菇蒸鸡胸肉 | `steamed-chicken` | 生抽酱油 |
| 白菜炖豆腐 | `cabbage-tofu` | 北豆腐 |
| 番茄豆腐汤 | `tomato-tofu` | 北豆腐 |
| 醋溜土豆丝 | `potato-strips` | 米醋 |
| 紫菜蛋花汤 | `seaweed-egg` | 芝麻香油 |
| 玉米牛奶燕麦粥 | `corn-oat-milk` | 巴氏杀菌纯牛奶 |
| 蒜香拌黄瓜 | `cucumber-salad` | 芝麻香油、米醋 |
| 虾仁豆腐煮 | `shrimp-tofu` | 去壳虾仁、北豆腐 |
| 蒜汁蒸茄子 | `steamed-eggplant` | 生抽酱油、芝麻香油、米醋 |

### 营养证据的补齐顺序

“仅此一项”表示该配方当前只有这一类营养缺口，**不是已能执行、发布或必然可被新样品覆盖的数量**。影响数来自冻结报告，不能相加当作不同配方总数。

| 顺序 | 缺口 | 影响 / 仅此一项 | 先核查的现有记录 | 还需什么；禁止自动推断什么 |
| --- | --- | --- | --- | --- |
| 1 | 生抽酱油 | 5 / 4 | `matching-decisions.json` 的 `TFDA:P0700401` | 确认原方加工、配料和样品适配；泛型淡色酱油参考不自动绑定生抽，也不代选品牌或把标签上界写成零 |
| 2 | 北豆腐 | 3 / 2 | `matching-decisions.json`、`nutrition-profiles.json` 的 `TFDA:R4700902` | 凝固剂、含水状态及原方称量依据；名称相近不能批准等价 |
| 3 | 米醋 | 3 / 1 | `nutrition-profiles.json` 的 `TFDA:P0600101`，原始观测在 `tfda-selected-records.json` | 蛋白质和脂肪原值为空；须取得适配且有明确数值的依据，不能补零或删掉调味料 |
| 3 | 芝麻香油 | 3 / 1 | `matching-decisions.json` 的 `TFDA:P0900201`、`TFDA:M1500101`；新增黑芝麻油 `TFDA:M1500201` 的限定范围 | 明确纯油/调和油及焙炒加工；新增黑芝麻油参考也未证明与原方等价 |
| 4 | 巴氏杀菌纯牛奶 | 1 / 1 | `nutrition-profiles.json` 的 `TFDA:L01021`、`corn-oat-milk` 的用量 | 适用密度证据，或另立按克称量的配方版本；不能把毫升直接当同数克 |
| 4 | 去壳虾仁 | 1 / 0 | `matching-decisions.json` 的 `TFDA:J2200501`、`shrimp-tofu` 的食材行 | 明确虾种及保水处理；该菜同时缺北豆腐依据，不能仅凭虾仁参考宣布完整 |

表中 JSON 均在补充包 `concept-enrichment-2026-10-03.1/` 下。原始样品新增依据另见 [TFDA 选样范围](../datasets/base-data/evidence/tfda-expansion-selections.json)及[原始核心行](../datasets/base-data/evidence/tfda-expansion-rows.json)；每条审批须回到样品编号、原始位置、单位和值。此轮没有新增外部下载、选择品牌或对许可作法律判断。

### 每条候选的审核交付物

- **#187 来源与许可**：记录做法 ID/内容摘要、作者或出处、许可声明与适用内容、核查证据位置、审核人及日期。项目草稿须补本项目编辑与发布依据，不能借用 HowToCook 的许可声明；第三方做法须回到其锁定提交中的对应文件。先审本次候选，369 种外部做法仍保持参考用途；份数 279 项、厨具 290 项、食材身份/精确用量 272 项的缺口另行处理，集合有重叠。
- **#193 制作与复热**：按[当前审核契约](../packages/contracts/src/recipeExecution.ts)准备单批份数上限、实际厨具及容量依据、准备/烹饪/收尾任务与用时、人工占用及依赖；需要存放、携带、冷食、复热或替代的候选还须相应依据和适用条件。冻结包的步骤时间只是原文摘录，没有上述经审核执行档案，不能相加后冒充总制作时长，也不能填入通用保存时限代替具体审核。
- **#218 发布清单**：审核完成后再确定纳入/排除的精确记录、版本、摘要及待审项；若内容或安装脚本需要重新分发，创建新不可变版本，保留本次两个冻结 ZIP。独立环境导入、云端发布与 Android 可见性仍须另行验收，本节不关闭该任务。

### 复现命令与执行限制

在仓库根目录执行；两个审计命令只输出 stdout，测试重建使用临时目录，不覆盖冻结报告或 ZIP：

```sh
shasum -a 256 datasets/releases/system-data-2026-09-15.2.zip datasets/releases/concept-enrichment-2026-10-03.1.zip
pnpm data:audit
pnpm data:audit:expanded
python3 -m unittest discover -s datasets/base-data -p test_source_coverage.py -v
python3 -m unittest discover -s datasets/base-data -p test_expand_nutrition.py -v
```

以下只读命令可重新列出上述 20 份候选及审核边界，输出文件内的真实 ID，不另造审批数据：

```sh
python3 - <<'PY'
import sys
from collections import Counter
sys.path.insert(0, 'datasets/base-data')
from source_coverage import ARCHIVE, read_package, with_supplement
data = with_supplement(read_package(ARCHIVE), 'datasets/releases/concept-enrichment-2026-10-03.1.zip')
for recipe in data['recipe-nutrition']:
    gaps = '、'.join(gap['name'] for gap in recipe['gaps'])
    print(recipe['method_id'], recipe['title'], gaps or '四项每份估算齐全（待审核）')
for key in ('kitchen_tested', 'automatic_execution_allowed'):
    print(key, dict(Counter(method.get(key) for method in data['catalogue']['methods'])))
for key in ('professional_review_performed', 'automatic_runtime_binding', 'requires_scope_confirmation'):
    print(key, dict(Counter(profile.get(key) for profile in data['nutrition-profiles'])))
PY
```

以上命令已于 2026-10-07 通过。本次未运行依赖历史附件的全量 Python 重建；未访问线上服务器、导入数据库或发布数据，冻结报告与分发包没有改动。来源数值核对不证明本地食材等价、专业审核、真实制作可行或线上状态。
