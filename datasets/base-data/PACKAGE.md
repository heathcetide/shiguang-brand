# DietDigiDose 基础数据候选包 0.1.0-rc.7

这是来源固定、可复现的参考数据候选包。`runtime_import_allowed: false`。
当前没有通过审核的营养映射和完整菜谱，不能作为生产环境默认数据直接导入。
本版新增 50 种食材和 20 道具体菜谱的整理草稿，尚未经厨房试做。

## 清洗后的业务文件

rc.6 在 clean/ 中输出 ingredients.json、recipes.json、kitchenware.json 三份文件，
另有 initial-data.json 账户及社区初始化数据。详见 clean/README.md。
所有环境默认包含示例账户和帖子，保留 is_demo 标记，密码仅用环境变量名称引用。
文件可用于目录选择和资料展示，但尚未适配现有数据库，不表示已创建账号或帖子。

## 来源菜谱扩展

rc.5 新增固定 Git 提交的 HowToCook 来源菜谱。阅读 `SOURCE-RECIPES.md`，机器记录为
`review/howtocook_recipes.jsonl`，全部文档的收录决策在 `review/howtocook_import_decisions.jsonl`。
仓库声明许可原文保留在 `provenance/howtocook/LICENSE`（Unlicense），附件哈希和提交号在来源锁。
每篇记录 source_path、source_revision、source_url 和原始 Markdown 的 source_sha256。
只整理文本，不包含图片文件、仓库代码，或简介中的健康宣传与估算热量。
外部参考内容仍只保留源文档内链接，不将其当作已授权正文或自动抓取。

所需材料/工具、计算、操作及附加内容保留为原始文本区块；相对链接需在固定来源页面访问。
steps 按顶层列表拆分，缩进子步骤及后续段落保留在原步骤；完整 operation_text 始终保留。
ingredients 是计算区（缺失时用原料区）的原文条目，不保证每行均是单一食材或完整用量。
quantity/unit/ingredient_id/servings/nutrition 均为 null，不将“适量”转换成默认数值，
也不把勺、个、毫升直接换算成克。candidate_ingredient_ids 只是名称边界匹配候选，
没有确认映射；kitchenware_ids 为空表示尚未整理，不表示做菜无需工具。
结构筛选要求原料区、计算区、至少两条原料行及两个操作列表项；不等于烹饪可执行性验收。
review_status 固定为 source_text_pending_mapping_and_cooking_review，禁止直接运行时导入。
来源菜谱与项目 20 道草稿按来源 ID 分开，数量相加不等于去重菜式数。

## 扩展食材目录

rc.4 不再把目录限制在 50 条：`reference/ingredient_catalog.jsonl` 汇集本地 50 条
食材和上游经烹饪范围筛选的 food/ingredient 概念。`INGREDIENT-CATALOG.md` 为阅读总表。
每条使用来源 ID，不按同名自动合并；source_root_types 保留原始分类线索，
selection_reason 保存规则依据。所有 nutrition 为 null，nutrition_status 为 unmapped。
source_license 仅记录上游声明，不能推及项目编辑的分类成果。英文 USDA 食品继续单独保留。

分类规则使用已检查的精确标签清单，以及 source ingredient 中明确以奶酪等名称结尾的类别规则。
新附件必须更新来源锁并重审规则；没有命中不代表不能作食材，而是进入待确认区。
`review/ingredient_pending.jsonl` 保留无法可靠定类的记录；
`review/ingredient_scope_decisions.jsonl` 覆盖全部 2,347 个来源概念的 included/pending/excluded 决策。
成品菜、饮品、菜系、技法不直接纳入；已发现的实验室缓冲液等误分类明确排除。
复合调味品、干面等可以作为烹饪原料，范围与“所有必须为生鲜”不同。
通过范围筛选不等于已确认可食性、品种、生熟状态或别名含义。
50 条项目食材继续维持原 ID，20 道菜谱引用不变。

## 首批食材与菜谱草稿

阅读 `STARTER-CATALOG.md`；机器文件为 `review/starter_ingredients.jsonl` 和
`review/starter_recipes.jsonl`。这部分由项目本次 AI 辅助编写，来源标识为
project_authored，未复制网页菜谱或沿用 SQLite 种子营养数值，不继承食品附件 CC0 声明。
正式发布许可说明仍需随项目整理成果补全。

食材 ID 使用 DDD-I- 固定英文标识，菜谱使用 DDD-R- 标识。
食材明确可食部、处理状态、别名；同名外部概念只记候选，营养值为 null，不能当零。
菜谱 servings 是分装份数，estimated_total_minutes 是时间估计；食材 quantity 是正数，
unit 为 g，牛奶为 ml。所有重量均为烹饪前可食部净重，鸡蛋去壳后称量。
水的 retained 和 process_discarded 分别记录入菜与弃去的工艺用水，单位 ml；
普通清洗用水不计入食材。50 种食材含调味品但不含水，部分作为后续菜谱储备。
步骤按 order 顺序执行，kitchenware_ids 对应本包现有厨具概念，不通过待审核别名匹配。
declared_allergens 是已知配料提示，并非无遗漏过敏原认证，需核对实际产品包装。
状态 draft_not_kitchen_tested 明确禁止把这些草稿计为已实做验收菜谱。

## 数据契约（schema_version = 1）

- `reference/*.jsonl`：食品概念、别名、分类和 USDA 原始营养参考记录。
- `review/*.jsonl`：待审核的菜品—食材关系和 Wikidata—USDA 候选映射。
- `provenance/food/`：随原始附件提供的说明、授权声明、来源与校验报告，原样保留。
- `sources.lock.json`：来源 Issue、附件 URL、源版本和 SHA256。
- `manifest.json`：本包每个其他文件的字节数与 SHA256。
- `report.json`：实际记录数、同名概念、外部引用和发布阻塞项。

食品 JSONL 每行一个对象，UTF-8，字段与原始 CSV 对应。**所有值保持源 CSV 字符串类型**：
空字符串表示缺失，不能当成零；数值由消费方按 schema 显式解析。
稳定标识分别使用 `WD-Q…`、`fdc_id`；不同 ID 的同名概念不合并。
USDA 营养记录只通过 `fdc_id` 连接自己的食品记录，不连接候选中文概念。
营养单位保持原样；每 100 g 等计量基准需在正式运行时契约中明确核验，不能由空字段推断。
10 条源记录的差减法碳水为负数，参考表保留原值，同时列入
`review/negative_nutrient_observations.jsonl`。不能直接用于运行时营养计算，也不能静默归零。

`reference` 表示来源参考层，不代表人工审核通过。概念的
`source_label_unreviewed`、关系的 `source_statement_unreviewed`、映射的
`needs_human_review` 均保留。菜品—食材关系允许空的本地食材 ID，保留外部 QID；
这类关系仍在审核区，不能伪造本地食材节点。它们不包含完整用量和烹饪步骤。

厨具精简投影包含 `reference/kitchenware_concepts.jsonl` 的 241 个具体概念，
字段为 concept_id、name_zh、category_zh、source_release、source_url，均为字符串。
`review/kitchenware_aliases.jsonl` 包含 271 条别名，字段为 alias_id、concept_id、
alias、language、source_method、review_status，均为字符串。
别名状态统一为 needs_semantic_review；分类仅作为来源标签，不输出原始目录树。
仅保留名称和必要追溯字段，不带入商品数据、统计或上游定义。
来源和发布边界见 `provenance/kitchenware/NOTICE.md`；不为厨具部分统一声明 CC0。
食品附件自述数据为 CC0，相关声明见 `provenance/food/`。本包不为原数据重新授权，
也不包含图片、网页正文、用户数据、演示账户或附件中的可执行构建脚本。

## 完整性与版本

同一版本的来源锁和内容应不可变。更改数据、字段或规则时增加版本；
只有审核完默认目录、营养关联、厨具许可及完整菜谱，才发布正式版。
包外 `.sha256` 用于与受信任发布渠道的摘要对比；包内 manifest 用于逐文件完整性检查，
二者都不是数字签名。原附件的 `validation_report.json` 是上游报告，
本次实际审计结果以根目录 `report.json` 为准。

部署导入器是后续交付：应锁定版本、校验哈希、支持 dry-run 和幂等升级，
兼容 SQLite/PostgreSQL，且不得覆盖用户修改或导入审核区数据。
