# 基础数据包重新清洗（0.2.0-rc.1）

从固定 rc.7 数据包和 HowToCook 源 ZIP 重新构建。只用 Python 3.10+ 标准库；不连接数据库，不执行附件里的代码，不修改原包，不覆盖已有输出目录。

```powershell
python datasets/base-data/reclean/package.py --rc7 .cache/base-data-releases/dietdigidose-base-data-0.1.0-rc.7.zip --howtocook .cache/base-data-sources/howtocook-2b19c9e9ee926fd925a68207a57582a338813f9c.zip --output artifacts/base-data/0.2.0-rc.1
python datasets/base-data/reclean/package.py --verify artifacts/base-data/0.2.0-rc.1/dietdigidose-base-data-0.2.0-rc.1.zip
python -m unittest discover -s datasets/base-data -p test_reclean.py
```

## 文件契约

1. `clean/ingredients.json`、`kitchenware.json`：原 ID 保留；新增食材必须命中规则白名单且有固定来源菜谱证据。不同种类、生熟状态与宽泛名称不强行合并。精确同名优先已有项目食材 ID，全部候选同时保留。
2. `clean/recipes.json`：原料、原文数量、measurement、步骤分组、份数证据、厨具提及、表格配方 variants、readiness。数量状态区分 exact/range/formula/to_taste/missing/unparsed/invalid。简单“数量 × 份数”另存 coefficient，保留人数与份数差异。步骤中的明确用量保留在 step_ingredient_evidence，缺料进入问题清单，不自动合计分阶段用量。兼容 quantity/unit 只保存明确公制数量，不能据此直接扣库。
3. `clean/food-concepts.json`、`nutrition-foods.json`、`nutrition-observations.json`：完整食品概念与独立营养观测。负数/缺失保持原值并隔离可用值；不采信旧候选映射。上游源行未注明营养测量基准，不能直接用于每百克计算。
4. `review/`、`quality/REPORT.md`：逐条缺项、冲突、恢复文档和前后指标。厨具提及可能含替代或否定语义，仅作证据。`upstream/rc7/` 完整保存原包文件。
5. `manifest.json`、`sources.lock.json`、`archive.lock.json`：来源与所有文件哈希。ZIP 顺序、时间、权限、编码固定；重复构建字节一致。包内 `build/` 提供同版构建器，解压后传入锁定的原始 ZIP 可重新构建。

## 使用状态

这是清洗后的数据资产候选版，适合审阅、目录接入开发和导入器适配。数据清洗不等于逐篇配方审核或厨房实测；`runtime_import_allowed=false`，所有自动规划执行和库存写入资格保持关闭。原 rc.7 导入器固定哈希，不能直接用于 schema_version=2。

一份配方可能供应多人，也可能含“用量 × 份数”公式；servings 只记录明确的食用人数，不擅自代入公式。无营养数据不妨碍目录整理，未知营养不得填零。`initial-data.json` 完整沿用原种子及 is_demo 标记；没有创建账户。

许可按来源保留，不将整个包声明为 CC0。食品源、HowToCook 和厨具说明分别见来源锁及 provenance/upstream；项目草稿保留原来的未知许可。未包含厨具原始商品内容或远程图片。

包内包含测试源文件。解压后设置 `DDD_BASE_DATA_RC7_ARCHIVE` 和 `DDD_BASE_DATA_HTC_ARCHIVE` 为两份原始 ZIP 的绝对路径，再执行 `python -m unittest discover -s build -p test_reclean.py`。源 ZIP 地址和校验值见来源锁。
