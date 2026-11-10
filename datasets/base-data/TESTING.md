# 数据测试输入与执行方式

## 日常 CI

从仓库根目录运行，与 GitHub 的 `verify` 检查一致：

```sh
python3 datasets/base-data/build.py --download --output-dir .cache/base-data-ci-build
curl --fail --location --retry 2 https://github.com/user-attachments/files/31905208/dietdigidose-base-data-0.1.0-rc.7.zip --output .cache/base-data-rc7.zip
python3 datasets/base-data/verify.py .cache/base-data-rc7.zip
DDD_BASE_DATA_RC7_ARCHIVE="$PWD/.cache/base-data-rc7.zip" python3 -m unittest discover -s datasets/base-data -p 'test_*.py' -v
```

构建器下载 `sources.lock.json` 中的三份公开来源，逐一核对 SHA256。
rc.7 附件另由 `archive.lock.json` 校验。缺文件、下载失败或哈希不符都会失败，
不会把无法取得的公开数据当作通过。初次下载 HowToCook（含图片）可能较慢。

日常套件包含源包重建及逐字节复现、清洗回归、解析与营养计算测试；
`test_system_release.py` 还直接校验 Git 中实际分发的冻结 ZIP、每个清单成员、
目录引用和全部 20 道菜的营养重算，保留未知值及禁止自动配餐的约束。
营养逻辑测试使用冻结包中的输入，不依赖开发者电脑上的输出目录。

`test_source_coverage.py` 逐值比对随包原始观测与补充的锁定来源证据，重算营养并校验覆盖报告；缺少原始观测会明确列为缺口，不因链接存在而记为已核验。`pnpm data:audit` 可独立输出该报告，无须数据库或网络。

`test_expand_nutrition.py` 使用已核验并固定摘要的 60 条 TFDA 原始行，离线逐字节重建 `concept-enrichment-2026-10-03.1.zip`；核对 46 个参考、44 个食材概念及原菜谱文件逐字不变。`pnpm data:audit:expanded` 核对基础包叠加补充包后的覆盖。新增补充包测试不依赖历史中间目录。

```sh
python3 -m unittest discover -s datasets/base-data -p test_expand_nutrition.py -v
python3 datasets/base-data/expand_nutrition.py /tmp/rebuilt-nutrition.zip
```

输出路径必须不存在，避免覆盖已分发版本。有完整锁定 TFDA ZIP 时可加 `--tfda /path/to/tfda.zip`，额外逐行核对原始归档位置；本次发布执行了此核对。来源快照变化时建立新版本，不更改旧快照摘要。

字符转换使用随仓库固定分发的 OpenCC 字符字典，Linux/macOS/Windows 结果一致；
不再调用 Windows NLS。来源及许可见 `reclean/opencc/README.md`。

## 当前包逐条审核清单（#187）

在已有审计命令上加 `--review-output`，生成独立、不可覆盖的 JSON：

```sh
mkdir -p artifacts/quality/w44-data-review
python3 datasets/base-data/source_coverage.py --review-output artifacts/quality/w44-data-review/review.json --output artifacts/quality/w44-data-review/summary.json
# 可选：包含已分发的参考营养补充包，输出到另一文件
python3 datasets/base-data/source_coverage.py --enrichment datasets/releases/concept-enrichment-2026-10-03.1.zip --review-output artifacts/quality/w44-data-review/expanded-review.json --output artifacts/quality/w44-data-review/expanded-summary.json
```

基础清单共 3,859 条：1,340 个食材/厨具概念、984 个食材形态、1,115 个菜式概念、389 个配方方法、31 个营养参考；补充包清单为 3,874 条（46 个营养参考）。这些类别有引用关系，不能相加当作食材或菜谱种数。保留原记录、稳定 ID、来源、关联 ID、规范化记录 SHA256、明确缺项、基础包/补充包和生成脚本摘要；来源证据摘要按排序紧凑 JSON 计算。

审核时优先处理 `recipe_method_missing`、`ingredient_identity_or_exact_quantity`、`servings`、`equipment`、`nutrition_reference_missing` 等具体缺项。结构齐全的行仍有许可、配方、设备容量/时长、保存复热及身份语义待核实项。`pending_evidence`、空审核人/时间、`automatic_execution_allowed=false` 不因字段完整或来源链接存在而升级。

原始清单用于追溯；在副本中记录审核人、结论及证据链接，不覆盖原产物。本工具不读取或导入审核结论，不写数据库，不改变运行时执行资格。需要发布正式 v1 时仍须完成来源许可/语义/实际烹饪审核和目标导入验收。清单包括完整源记录，分享时遵守各来源许可；生成清单不构成再分发授权。

### 仓库内已存在的配方与映射证据

逐条清单现在读取并验证冻结包中的 `recipe-weighing-contracts`、`equipment-role-updates`、`duplicate-review`、`matching-decisions`，按对应 ID 附加到 `supporting_evidence`：

- 20 份称量说明：原配方 SHA 与当前方法一致，营养计算输入与目录方法完全一致；保留全部投料油计入、未校正烹调损失等原始披露。
- 18 条厨具依据（覆盖 15 道方法）：核对厨具概念/名称及精确步骤序号、原文，不由设备提及推导容量或替代可行性。
- 11 组同名概念候选：验证所指概念存在，保留需先审核身份的记录，不自动合并。
- 5 条营养样品未绑定决定：核对食材形态及 TFDA 样品名、描述，保留未绑定状态与原因。其中传统豆腐的凝固剂、生抽与淡色酱油、芝麻香油与调和/未明焙炒油、虾种及保水剂条件仍未确认。

以上补证关联 51 条清单记录（类别间有复用），记录文档路径、原数组位置、记录 SHA256、原文和机械校验范围。它们是已有文档的可追溯连接，不是新的人工作业结论；许可、实做、营养等价、设备容量、保存复热缺口保持开放。参考营养补充包必须保持这四份基础证据原样，不能借补充包重写审核决定。

### 可由保留原文确认的份数更正

份数解析区分“以下为/以上原料”等行文指示与数量上下限，并识别“按照 1 人的份量”“每份：三人量”“一份正好够 2 人喝/饮用”“一份为一人餐”。约数（含中文数字）、区间、经“及/或”连接的上下限、个人饭量说明和冲突人数在共用解析器中均不取单值，重新清洗也不提升其资格。

当前冻结包中 17 条历史缺项可由原文确认：柱候牛腩 2、腊八粥 1、排骨山药玉米汤 2、菠菜炒鸡蛋 1、带把肘子 3、银耳莲子粥 1、牛油果拉西 1、西葫芦炒鸡蛋 2、肉蛋盖饭 1、烤茄子 2、红柚蛋糕 1、凉拌木耳 1、蒸箱鸡蛋羹 1、鸡蛋羹 1、黔式腊肠娃娃菜 1、甜辣烤全翅 1、商芝肉 2（单位均为原文食用人数）。

清单以 `confirmed_source_fields.servings` 保存旧值、新值、原文和匹配证据，同时保存解析器 SHA256；原 `record`、摘要和冻结 ZIP 保持不变，`runtime_applied=false`、`scale_automatically=false`。已有提取证据必须与新解析一致；原提取为空时，仅确认上述有明确批次/用量标记的语境。个人饭量声明、含不同人数版本和没有明确批次的表述仍待审核。

清单份数缺项为 262，冻结包汇总仍为 279，差异由 17 条显式更正解释。许可、食材映射、厨房验收和执行资格仍待审核；不能把人数确认当作整道菜已通过。

### 食材用量、单位与明确修饰词补证

清单的 `confirmed_source_fields.ingredient_lines` 按稳定 `line_id` 保存更正字段、原文、旧值、共享用量与可选标记；原记录、冻结包和营养计算不变。生成器同时记录用量解析器及规则文件摘要。

当前 7 条用量/单位更正来自明确数量后紧接的纯说明文本：香菜 5 条（切段）、蒜 5 颗（剁成蒜蓉）、洋葱 25–40 g（切成碎）、蒜苗 2 根（切段备用）、鸡蛋 8 个、牛奶 200 ml、白砂糖 80 g（后三条保留原文商品说明）。只识别有限的明确说明短语并完整保存；不截掉任意尾文，不把个/颗换成克，也不把范围取成单值。

2 条映射使用明确原文修饰词和目录唯一形态：`比拳头大一点的洋葱 → 洋葱`、`其中猪肉 → 猪肉`。保留尺寸及混合组说明，不推断营养等价；猪肉所在的 430 g 混合肉总量不分配给任何单项。目录形态不唯一、概念名不一致或原文不匹配时不确认。

更正前须验证用量文本或修饰词确实存在于保留原文，并要求用量与旧测量的 source_text 一致，避免截取较小数字子串；测量更正跳过共享总量。数量与重量混写（如“1 个 50 g”）、配方算式、可选条件、任意比例、缺少目录身份或身份多义仍待审核。这些字段确认不代表整道配方的用量/映射缺口全部关闭；原 `ingredient_identity_or_exact_quantity` 综合缺项保持原值，逐行更正单独计数。

厘米长度与比例名称补证：另确认大葱 10 cm、生姜 3 cm（保留“长，拍散备用”），长度维度不进入质量/体积标量。两条 `1 : 1 蔗糖糖浆` 原名称被冒号误拆为 `1`，现保留比例原文并修正名称及 10 g（可选）/30–40 g 用量；比例是质量比还是体积比、目录形态与营养等价均不确认，不自动绑定通用糖浆。旧名称、旧用量、旧测量及原文必须相互一致。累计确认 11 条测量、2 条名称、2 条映射。`4 厘米一小片`、冲突的酒酿用水及其他比例继续待审核。

重复食材名的计数补证：原文“两根中等大小的芹菜”“一根大葱”“7 瓣大蒜”确认分别为 2 根、1 根、7 瓣，完整保留尺寸与名称尾文，只接受对应单位及完整尾文；不接受附加条件或单位不符。冰几块（可选）、大冰块差不多就行映射到唯一“冰块”形态，保留原文可选/尺寸/数量未知，不推断块数或质量。累计 14 条测量、4 条映射、2 条名称更正，剩余未解析测量 72 条、身份缺项 33 条。

本轮遍历剩余 75 条未解析测量与 35 条身份缺项，并对上述五条核对锁定 HowToCook 源码。其他条目仍待审核：数量/重量并列不能直接挑选一个值，条件或关系用量不改为固定标量；替代食材、混合组、厨具误归类需独立审定；油菜、沙拉酱等缺少可确认的目录形态，不能仅凭可读名称创建绑定。未知数量与整道配方缺项不因身份确认而清除。

下限和来源单位补证：冰块“160 克以上”保留为 `lower_bound`，仅设置 minimum，value 仍为空；不把最低量当精确量。来源明确的“1 拇指块”保留为 source_unit，不估算体积或重量；“1 份-2 份（看鸡蛋大小）”保留范围与条件，不选定单值。约数、复合上下限、附加未知条件不确认为边界。清单现在也可记录明确上下限，原配方综合缺项与执行资格仍不变。

“花生油都可以”仅确认目录身份，保留“替代选项，非额外必选食材”限定与原文共享 100–150 ml 油量，不分配到花生油。累计 17 条测量、5 条映射和 2 条名称更正；剩余未解析测量 69 条、身份缺项 32 条。这里的测量更正包含原单位、范围和下限，不等于相同数量的可执行精确克重。

明确分配与可选用量补证：大葱“2 根，1 根切段、1 根备用”仅在正数分配之和与原文总量一致时确认 2 根，分项保留为附加证据，不再相加扣除。肥肉末“20g #不喜可不加”保留可选标记与完整说明，不接受附带其他条件的尾文。长形茄子描述仅确认目录茄子身份，完整保留“上小下大、不得使用浙茄和圆茄”的限制，具体品种和营养等价仍待审核；不由身份更正补写重量。累计 19 条测量、6 条映射、2 条名称更正，剩余未解析测量 67 条、身份缺项 31 条。

## 历史完整重建

历史评估和中间产物未全部公开分发，部分还包含未确认再分发授权的 CN6 来源。
不能通过重新下载动态来源、伪造样本或修改锁定哈希来代替它们。以下重建测试
默认明确显示 `skipped`，不代表历史产物已验证；CI 仍必测上面的公开源和当前冻结包。

在具备对应固定输入的工作目录中显式启用：

```sh
DDD_TEST_HISTORICAL_DATA=1 DDD_BASE_DATA_RC7_ARCHIVE="$PWD/.cache/base-data-rc7.zip" python3 -m unittest discover -s datasets/base-data -p 'test_*.py' -v
```

启用后缺少输入直接失败，原始断言和哈希检查仍全部执行。所需目录如下：

| 测试 | 固定输入（仓库根目录相对路径） |
| --- | --- |
| `test_round1.IntegrationTests` | `artifacts/base-data/0.2.0-rc.1/dietdigidose-base-data-0.2.0-rc.1.zip`，或 `DDD_BASE_DATA_ROUND1_BASELINE` |
| `test_round2` 完整重建 | `artifacts/base-data/0.2.0-rc.2/dietdigidose-base-data-0.2.0-rc.2.zip`；`.cache/base-data-sources/round2/` 中的 `sanotsu.zip`、`sanotsu.commit`、`tfda.zip` |
| `test_bindings_batch1` 完整重建 | `artifacts/base-data/round2-assessment-1/round2-assessment-1.zip`；上述 `tfda.zip` |
| `test_bindings_batch2` 完整重建 | 上述 rc.2、assessment、tfda；`artifacts/base-data/nutrition-bindings-batch1/nutrition-bindings-batch1.zip` |
| `test_concepts.ConceptPackageTests` | rc.2、两个 nutrition-bindings ZIP；`.cache/base-data-sources/concept-v1/` 下 `concepts.SNAPSHOTS` 固定的七份 Wikidata JSON |
| `test_add_cn6` | `artifacts/base-data/concept-base-1.0.0-rc.1/concept-base-1.0.0-rc.1.zip`、assessment、sanotsu |
| `test_enrich_core` 历史重建 | `artifacts/base-data/concept-base-1.0.0-rc.2/`、`concept-enrichment-2026-09-15.1/`、`enrichment-inputs/usda-sr-legacy-2018-04.zip` |
| `test_enrich_next` 历史重建 | 上述 concept-base、两轮 `concept-enrichment-2026-09-15.*` 完整目录、tfda |

历史归档的哈希不因构建器或字典更新而调整。使用新代码构建的新产物不冒充旧快照；
比较历史归档本身须使用其中附带的构建器。跨平台字符规则变化应作为新产物差异审阅。

## 完整审核工作清单

`review_worklist.py` 复用 `source_coverage.py --review-output` 的审核记录，将每个缺项映射到责任角色和所需证据，输出全量 JSON 和可提交的 Markdown 分类明细。未知缺项或汇总与记录不一致直接失败，不默认放行。全部分类均待人工审核，不改原包/批准状态。

先按上述方法生成带营养补充包的审核清单，然后执行（JSON 输出必须使用新路径，不覆盖旧证据）：

```sh
python3 datasets/base-data/review_worklist.py artifacts/quality/w44-data-review/allocation-review.json --output artifacts/quality/w44-data-review/complete-worklist.json --markdown docs/w44-data-review-worklist.md
```

上面的输入是当前本地补证产物；新环境使用 `source_coverage.py --enrichment datasets/releases/concept-enrichment-2026-10-03.1.zip --review-output <新文件>` 先重建，替换命令输入路径。JSON 的 inventory_sha256 是输入解析后按排序键序列化的内容摘要；不是输入文件字节摘要。记录级任务覆盖所有3,874条记录的19类缺项；行级明细单列67条未解析测量和31条身份任务，可能在同一食材行重叠。缺失量、已解析但待审核的条件/关系量仍属于记录级用量审核，不能从这98项之外推断不存在缺项。

仓库可继续做原文定位、解析和证据校验；人工须确认许可、身份、营养、份量、配方和设备语义；厨房实做及目标环境导入/回滚需要真实资源。分类结果不能代替这些批准或验收。
