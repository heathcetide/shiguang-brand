# 第一轮补齐 · 0.2.0-rc.2

以固定 SHA-256 的 0.2.0-rc.1 包为输入，对 712 条未匹配用料逐条记录处理结果，同时修正数量、状态与明确厨具要求。不新增外部数据来源，不连接数据库。

```powershell
python datasets/base-data/reclean/round1.py --baseline artifacts/base-data/0.2.0-rc.1/dietdigidose-base-data-0.2.0-rc.1.zip --output artifacts/base-data/0.2.0-rc.2
python datasets/base-data/reclean/round1.py --verify artifacts/base-data/0.2.0-rc.2/dietdigidose-base-data-0.2.0-rc.2.zip
python -m unittest discover -s datasets/base-data -p test_round1.py
```

产物为 UTF-8 JSON/JSONL、清洗报告、逐条追踪清单、固定来源原文和构建器。旧 ID、原营养观测及初始化记录全部保留；新食材和厨具必须有旧包中的原文证据。`ingredient_options` 表示用户尚需选择的材料，不能同时采购或扣减；`shared_amount_evidence` 表示多种材料共用的总量，不能重复分配。状态、原文限定及参考重量不得在导入时丢弃。

`kitchenware_requirements` 仅从明确的原料/工具表生成；role 区分 required、optional、alternative_requires_choice。不把原文替代建议当作已验证的等价关系。

来源授权声明延续旧包；本轮不是厨房实测或全量营养核验。`runtime_import_allowed=false`。后续系统接入需要适配当前契约和质量字段。

解压后可用 `build/reclean/round1.py` 重建。包内测试使用 `DDD_BASE_DATA_ROUND1_BASELINE` 指定 rc.1 ZIP 绝对路径，再执行 `python -m unittest discover -s build -p test_round1.py`。
