# rc.7 来源锁与证据盘点

`archive.lock.json` 锁定 #187 的原始附件，`sources.lock.json` 原样取自该附件。
构建器仅使用 Python 3 标准库，不下载来源，不运行附件内代码，不修改数据库。

```sh
python3 datasets/base-data/audit.py /path/to/rc7.zip /path/to/new-audit.zip
python3 -m unittest discover -s datasets/base-data -p 'test_*.py'
```

输出包含 447 食材、241 厨具、341 菜谱的逐条证据盘点、缺项、稳定逻辑 ID、同名候选关系、来源锁及 manifest。每条记录绑定原始记录规范化 JSON 的 SHA-256。ZIP 文件顺序、时间、权限及 JSON 编码固定；相同源码和附件重复构建字节一致。目标文件必须不存在。

`review_method=archive_evidence_inventory_v1` 表示程序检查了附件字段和引用关系，**不表示已完成人工配方、许可或烹饪安全审核**。全部保留 `pending_evidence`，执行资格为 false。名称不同的食材映射列为待复核；疑似重复仅关联，不合并。原始营养保持 null，不把参考 USDA 候选及负数观测导入可信营养。

当前输出是审核工作底稿，尚不是数据包 v1 发布物。正式迁移、原位升级、管理员修改保护及缺项补录仍须完成；不得以生成该清单关闭 #187。存放、携带、复热和任务/设备时间没有经审核依据，不能据此承诺可行或满足 30 分钟。
