# #187 完整缺项分类与人工审核清单

生成内容；用 review_worklist.py 从当前审核清单重建。分类是待办路由，不是审核结论。

覆盖 3874 条记录；同一记录可有多个缺项，分类次数不能相加当作记录数。

机器清单逐记录保留 kind/id/原记录摘要及每个缺项的责任角色、所需证据和待审核状态。所有语义批准仍需人工签署。

仓库内可做：锁定原文定位、字段解析修复、证据挂接、摘要/单位/引用一致性检查。
需人工：来源权利与许可、身份/形态、份量与混合/替代关系、营养适用性、厨具容量与配方语义。
需实际资源：厨房/跨日验证，以及正式包目标环境导入、幂等、保留用户修改和回滚。
未取得证据的记录保持不可自动执行；不通过分类删除、批准或移出正式验收范围。

## 全部记录级缺项

| 缺项 | 次数 | 类别 | 审核责任 | 必须补的证据 |
|---|---:|---|---|---|
| `capacity_and_substitution_review` | 261 | equipment | 厨具审核人 | 确认容量、适配和替代限制，不仅按名称匹配 |
| `declared_license_missing` | 331 | license | 来源/许可审核人 | 补原版本许可文本、权利主体与适用范围 |
| `dish_identity_and_method_relationship_review` | 1115 | recipe | 配方审核人 | 确认菜品与方法关系及重复/变体归属 |
| `equipment` | 290 | equipment | 配方审核人 | 从步骤补厨具依据，再确认实际设备可用性 |
| `equipment_capacity_and_task_duration_review` | 389 | equipment | 配方审核人及实测人 | 确认任务依赖、容量、并发、实际总耗时 |
| `identity_aliases_and_classification_review` | 1340 | identity | 数据审核人 | 确认身份、别名、分类及重复概念；不得仅凭同名合并 |
| `ingredient_form_identity_and_state_review` | 984 | identity | 数据审核人 | 确认食材形态、生熟、部位及加工状态 |
| `ingredient_form_scope_review` | 46 | nutrition | 营养审核人 | 核对营养样品和目标食材形态、部位、生熟及可食部范围 |
| `ingredient_identity_or_exact_quantity` | 272 | quantity | 配方/数据审核人 | 逐行确认身份、用量、单位与替代/共享关系；字段补证不整体清除缺项 |
| `ingredient_mapping_and_amount_review` | 389 | quantity | 配方/数据审核人 | 审核全部食材行，包括已解析值、补证字段、可选项与计量依据 |
| `kitchen_execution_review` | 389 | real_trial | 配方审核人及实测人 | 实际制作，记录份量、原料扣减、安全步骤与偏差 |
| `nutrition_reference_missing` | 1035 | nutrition | 营养审核人 | 补可追溯样品、单位和适用范围；未知不填零、不套近似食材 |
| `nutrition_scope_review` | 44 | nutrition | 营养审核人 | 核对既有营养参考的适用范围与绑定依据 |
| `professional_nutrition_review` | 46 | nutrition | 营养审核人 | 逐项核对原始观测值、单位、每100g基准及营养计算 |
| `recipe_method_missing` | 730 | recipe | 配方审核人 | 补有来源许可的完整方法；不得从菜名编造配方 |
| `redistribution_license_review` | 1775 | license | 许可审核人 | 确认再分发/修改/署名要求及正式包适用性；公开可见不等于许可通过 |
| `servings` | 262 | quantity | 配方审核人 | 确认整批产量/食用人数、条件及份量口径；无法确认保持未知 |
| `source_url_missing` | 70 | source | 来源维护人 | 查锁定源码、原始记录与版本；缺原出处时请来源方补证，不以搜索到同名页面替代 |
| `storage_transport_reheat_review` | 389 | real_trial | 配方审核人及实测人 | 提供储存、运输、复热依据和适用条件；保留跨日实测 |

## 剩余食材行问题

仅以下明细对应未解析测量和未解析身份；已解析但有条件、缺失量、营养与整道配方审核仍由上表覆盖。
同一行可同时有两类问题；分类依据原文保守分流，人工可修订类别，必须保留稳定行 ID。

| 问题 | 类别 | 菜谱 / 行 ID | 保留原文 | 审核问题 |
|---|---|---|---|---|
| measurement | compound | 姜炒鸡 / `METHOD:HTC-0a5faf76b239b0937c8e:line:3` | 啤酒 = 半瓶 250ml | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | conditional | 简易红烧肉 / `METHOD:HTC-0eb9f4426ab5d8da8be5:line:6` | 开水：没过食材的量，需要 600ml-900ml | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 咖啡椰奶冻 / `METHOD:HTC-0f2b773be2e0b8a360f6:line:2` | 35ml espresso 意式浓缩（个人不推荐用 fruity 的咖啡豆） | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| identity | identity_source_structure | 耙耙柑茶 / `METHOD:HTC-11368a20c31b46c45d76:line:3` | 1 : 1 蔗糖糖浆 10 克（可选） | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| identity | group_identity | 山西过油肉 / `METHOD:HTC-16663c525e6b39c6d069:line:12` | 其他调料 20g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| identity | group_identity | 微波炉蛋糕 / `METHOD:HTC-17cc9ae41d9fb45904b6:line:3` | 白（红）糖🍬 10g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | relation | 米粥 / `METHOD:HTC-196eab378a75e74f313a:line:0` | 水的体积是米饭的体积的 9-12 倍。 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| measurement | relation | 意式肉酱面 / `METHOD:HTC-1a5309d32c90a9a31826:line:2` | 洋葱大半个 （大约 150 克，通常是肉的两倍重） | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| identity | identity_source_structure | 麻辣香锅 / `METHOD:HTC-1a8b110f53c68d139898:line:1` | 青菜共需 455 克，其中油菜、油麦菜、菠菜的比例按自己喜好分配即可 | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| identity | identity_source_structure | 麻辣香锅 / `METHOD:HTC-1a8b110f53c68d139898:line:8` | 无骨肉共需 430 克，其中猪肉、牛肉、鸡肉、鱼丸、火腿肠的比例按自己喜好分配即可 | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| measurement | conditional | 无骨鸡爪 / `METHOD:HTC-2616a5a03457ab9faa08:line:5` | 小米辣 4 个少辣，6 个中辣，12 个大辣（推荐大辣） | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 贵州辣子鸡 / `METHOD:HTC-280e1f88f772ec3cb985:line:0` | 鸡三到四个人的量是四斤，人多可以依次累加 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | compound | 印度焖饭 / `METHOD:HTC-2a46b4b88f72e03b7ecb:line:20` | 藏红花 0.5g + 温牛奶 30ml（浸泡用） | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | identity_scope | 带把肘子 / `METHOD:HTC-2bde2d31169c74e90204:line:0` | 带脚、爪猪前肘: 一个（大约二斤五两 = 1250 克） | 确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材 |
| identity | identity_scope | 带把肘子 / `METHOD:HTC-2bde2d31169c74e90204:line:1` | 带脚、爪猪前肘: 一个（大约二斤五两 = 1250 克） | 确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材 |
| measurement | conditional | 葱烧海参 / `METHOD:HTC-2ce6f52e55265187fe30:line:1` | 大葱葱白 1 根大葱的葱白即可 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| identity | identity_scope | 南派红烧肉 / `METHOD:HTC-373d56f2f32aba5c1867:line:2` | 油：100-150ml，色拉油、猪油、花生油都可以 | 确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材 |
| measurement | conditional | 南派红烧肉 / `METHOD:HTC-373d56f2f32aba5c1867:line:12` | 凉水：没过食材的量即可，看锅大小准备 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 南派红烧肉 / `METHOD:HTC-373d56f2f32aba5c1867:line:13` | 开水：没过食材的量即可，看锅大小准备 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | approximate | 玉米排骨汤 / `METHOD:HTC-38f5fbfaae4052a8472d:line:3` | 大葱小半根 | 确认来源计量口径；约数和模糊量不得变为精确克重 |
| measurement | compound | 冬瓜酿肉 / `METHOD:HTC-40e28313bc713fccb612:line:8` | 葱姜末（姜 3-4 片约 30g, 取上面一根葱花中的葱白部分即可） | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | identity_source_structure | 冬瓜酿肉 / `METHOD:HTC-40e28313bc713fccb612:line:8` | 葱姜末（姜 3-4 片约 30g, 取上面一根葱花中的葱白部分即可） | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| measurement | compound | 酒酿醪糟 / `METHOD:HTC-4633664c062d365088ad:line:2` | 清水 720g + 600g（720 克用于蒸饭，后 500g 用于发酵） | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | equipment_role | 酒酿醪糟 / `METHOD:HTC-4633664c062d365088ad:line:3` | 干净密封玻璃或陶瓷容器 1 个 | 核对是否厨具及目录角色；不得当食材绑定营养或计入摄入 |
| measurement | compound | 西红柿鸡蛋挂面 / `METHOD:HTC-49e4e1e85bbfe8f85905:line:1` | 西红柿 1 个大概 200g 吧。 | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | approximate | 微波炉蒸蛋 / `METHOD:HTC-4b816847856fadc6a2e7:line:4` | 香油 几滴（出锅用） | 确认来源计量口径；约数和模糊量不得变为精确克重 |
| measurement | relation | 冷吃兔 / `METHOD:HTC-50cf74d8dc74aa7a8042:line:6` | 姜量 = 蒜量 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| measurement | relation | 冷吃兔 / `METHOD:HTC-50cf74d8dc74aa7a8042:line:8` | 干辣椒量 = 辣椒段的总体积等于兔肉的总体积 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| measurement | relation | 冷吃兔 / `METHOD:HTC-50cf74d8dc74aa7a8042:line:9` | 青花椒量 = 3 斤兔肉对应吃饭用的小碗，一整碗花椒 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| measurement | compound | 燕麦鸡蛋饼 / `METHOD:HTC-515e68668fde39090e65:line:2` | 牛奶一盒 约 250ml | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | identity_scope | 炒河粉 / `METHOD:HTC-581d80efc12c2ca81466:line:4` | 河粉料可按 20g/人添加，若自行准备炒料可 10g 盐+2g 味精+3g 孜然粉。 | 确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材 |
| measurement | relation | 炒河粉 / `METHOD:HTC-581d80efc12c2ca81466:line:5` | 淀粉可准备每 100g 肉+5g 淀粉比例准备。 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| measurement | compound | 台式卤肉饭 / `METHOD:HTC-5a753afd111fed656ea9:line:5` | 米酒 10 + 25 ml | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | conditional | 萝卜炖羊排 / `METHOD:HTC-5b50c173e66f4a3c66bd:line:8` | 水：没过食材的量，需要 1000ml | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | relation | 煮锅蒸米饭 / `METHOD:HTC-65d4c06a5b4800be6aaf:line:1` | 水：米的体积的 2 倍 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| measurement | source_structure | 香煎五花肉 / `METHOD:HTC-683225505a87b9d96053:line:3` | 酱油,盐,味精,料酒,姜蒜,油,豆瓣酱 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | conditional | 溏心蛋 / `METHOD:HTC-7a681fba9fd0dadc18ef:line:0` | 鸡蛋 1 颗或更多（只要您的电锅装得下，不管有几颗鸡蛋都可以） | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 陕北熬豆角 / `METHOD:HTC-7ddb62ef1001d348c035:line:11` | 香菜碎（可选）根据口味加 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | source_structure | 陈皮排骨汤 / `METHOD:HTC-814045db735286f009a7:line:0` | 排骨，用猪骨也替代也可，4-5 块 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | conditional | 陈皮排骨汤 / `METHOD:HTC-814045db735286f009a7:line:1` | 陈皮（一般选用 8-20 年制），一般 1 块陈皮是 3 瓣，取 1 瓣即可 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | source_structure | 陈皮排骨汤 / `METHOD:HTC-825601135784ca99a880:line:0` | 排骨，用猪骨也替代也可，4-5 块 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | conditional | 陈皮排骨汤 / `METHOD:HTC-825601135784ca99a880:line:1` | 陈皮（一般选用 8-20 年制），一般 1 块陈皮是 3 瓣，取 1 瓣即可 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | source_structure | 黄焖鸡 / `METHOD:HTC-832e8ac5e9aae36076bd:line:4` | 干辣椒 = 5，6 个 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | approximate | 西红柿土豆炖牛肉 / `METHOD:HTC-90f04c224709ac2c3094:line:13` | 西红柿拳头大小中等个头两三个 | 确认来源计量口径；约数和模糊量不得变为精确克重 |
| measurement | compound | 汤面 / `METHOD:HTC-920d017802b3b131e2ce:line:0` | 面类材料：单人一个方便面大小的量，可以在 70-230g 之间选择。 | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | group_identity | 汤面 / `METHOD:HTC-920d017802b3b131e2ce:line:0` | 面类材料：单人一个方便面大小的量，可以在 70-230g 之间选择。 | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | conditional | 汤面 / `METHOD:HTC-920d017802b3b131e2ce:line:1` | 冷水： 加入能浸没面的量，一般在 200 - 400 ml 之间选择 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | relation | 汤面 / `METHOD:HTC-920d017802b3b131e2ce:line:2` | 菜类：体积大约和面类相当 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| identity | group_identity | 汤面 / `METHOD:HTC-920d017802b3b131e2ce:line:2` | 菜类：体积大约和面类相当 | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | source_structure | 芥末黄油罗氏虾 / `METHOD:HTC-93eb7c2440893496b035:line:0` | 罗氏虾 1 斤多  广东市场价大概 40~45 一斤 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | compound | 新疆大盘鸡 / `METHOD:HTC-96dd22806c8012837a10:line:0` | 两个火枪腿的鸡肉（这大约是 1kg ） | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | identity_source_structure | 新疆大盘鸡 / `METHOD:HTC-96dd22806c8012837a10:line:0` | 两个火枪腿的鸡肉（这大约是 1kg ） | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| measurement | compound | 新疆大盘鸡 / `METHOD:HTC-96dd22806c8012837a10:line:1` | 土豆 2 个适中大小：750g | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | group_identity | 新疆大盘鸡 / `METHOD:HTC-96dd22806c8012837a10:line:3` | 菜椒甜椒各一个，各 50g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | source_structure | 新疆大盘鸡 / `METHOD:HTC-96dd22806c8012837a10:line:8` | 花椒,香叶,香果,干线椒,大蒜,大葱 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| identity | identity_scope | 吐司果酱 / `METHOD:HTC-a1ba8de42384bd276c5c:line:1` | 果酱足够涂满一面吐司的量 | 确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材 |
| measurement | conditional | 红烧鱼 / `METHOD:HTC-a5ad40355b767e44c78b:line:0` | 鱼 建议新手以一条中等大小的鲫鱼上手，提前划好花刀，方便成熟（不然鱼背上容易夹生） | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 红烧鱼 / `METHOD:HTC-a5ad40355b767e44c78b:line:1` | 姜丝，以正常老姜切 2-3 片，然后片丝即可 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 红烧鱼 / `METHOD:HTC-a5ad40355b767e44c78b:line:4` | 香菜按照个人口味 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 红烧鱼 / `METHOD:HTC-a5ad40355b767e44c78b:line:10` | 小米椒 1-2，不放也可以，过来人的经验，最多放 2 个，不然辣度过高要菊花残。 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | compound | 红烧鱼 / `METHOD:HTC-a5ad40355b767e44c78b:line:11` | 味精，看个人口味，不要放多，5g 即可。 | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | conditional | 红烧鱼 / `METHOD:HTC-a5ad40355b767e44c78b:line:12` | 蚝油，5g 即可，和味精一个道理 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | compound | 空气炸锅羊排 / `METHOD:HTC-ad951394e7a99fe2f3ce:line:0` | 羊排 1 片约 160g | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | source_structure | 简易版炒糖色 / `METHOD:HTC-b0ca418ed646e4ec9dbd:line:3` | 冰糖：炒出来的`糖色`色泽最为鲜艳，红亮，必须水油炒，不加水融化会很慢 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | source_structure | 简易版炒糖色 / `METHOD:HTC-b0ca418ed646e4ec9dbd:line:4` | 白砂糖：必须水油炒，不加水融化会很慢 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | compound | 桂林十八酿 / `METHOD:HTC-b14f5054692bfa3e90e5:line:19` | 混合馅（猪肉 + 虾滑，猪肉 + 螺肉等自由组合） | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | group_identity | 桂林十八酿 / `METHOD:HTC-b14f5054692bfa3e90e5:line:19` | 混合馅（猪肉 + 虾滑，猪肉 + 螺肉等自由组合） | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| identity | identity_scope | 水煮肉片 / `METHOD:HTC-b898ff51880d2d8ba706:line:18` | 凤尾 1 根 | 确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材 |
| identity | group_identity | 水煮肉片 / `METHOD:HTC-b898ff51880d2d8ba706:line:20` | 小米辣干辣椒 20g（根据受辣程度选择 0-40g） | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| identity | identity_source_structure | Mojito莫吉托 / `METHOD:HTC-b8b6c7d1722ec85dc29b:line:1` | 五珠薄荷叶 | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| identity | identity_scope | 火腿饭团 / `METHOD:HTC-bfc763083371290ee095:line:6` | 喜欢的沙拉酱(20g) | 确认原文身份、目录形态与品种/加工限制；缺唯一对应需补证，不套近似食材 |
| measurement | source_structure | 老式锅包肉 / `METHOD:HTC-c40321c423784be75802:line:13` | 方法一：土豆淀粉 170g | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| identity | identity_source_structure | 老式锅包肉 / `METHOD:HTC-c40321c423784be75802:line:13` | 方法一：土豆淀粉 170g | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| measurement | compound | 老式锅包肉 / `METHOD:HTC-c40321c423784be75802:line:14` | 方法二：土豆淀粉 210g 和 中筋面粉 70g | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| identity | group_identity | 老式锅包肉 / `METHOD:HTC-c40321c423784be75802:line:14` | 方法二：土豆淀粉 210g 和 中筋面粉 70g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | compound | 韩式拌饭 / `METHOD:HTC-c5e2191c72cc18cf2b8d:line:2` | 火锅牛肉卷 6 卷 60g | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | compound | 韩式拌饭 / `METHOD:HTC-c5e2191c72cc18cf2b8d:line:3` | 豆芽 1 把 80g | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | compound | 巴基斯坦牛肉咖喱 / `METHOD:HTC-c8feda2006c4d21508e3:line:3` | Masala 粉一包 50g | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | conditional | 香煎翘嘴鱼 / `METHOD:HTC-c9b72f0464b37584fba3:line:0` | 翘嘴鱼：2 斤最佳 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | conditional | 香煎翘嘴鱼 / `METHOD:HTC-c9b72f0464b37584fba3:line:4` | 香菜：个人口味 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| measurement | approximate | 香煎翘嘴鱼 / `METHOD:HTC-c9b72f0464b37584fba3:line:10` | 盐：约 50g 用于腌制鱼 | 确认来源计量口径；约数和模糊量不得变为精确克重 |
| identity | group_identity | 中式馅饼 / `METHOD:HTC-ceb4b4a04f909eb2286c:line:7` | 风味调料 3g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | conditional | 电饭煲蒸米饭 / `METHOD:HTC-cf3dabc066de2aa054f0:line:0` | 江南米，米和水放在电饭煲的容器内，食指触及米时，水量能刚好没过食指的第一个指节又第二个指节 1/4 处（即大约 2.6 厘米）。 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| identity | equipment_role | 电饭煲蒸米饭 / `METHOD:HTC-cf3dabc066de2aa054f0:line:0` | 江南米，米和水放在电饭煲的容器内，食指触及米时，水量能刚好没过食指的第一个指节又第二个指节 1/4 处（即大约 2.6 厘米）。 | 核对是否厨具及目录角色；不得当食材绑定营养或计入摄入 |
| measurement | conditional | 电饭煲蒸米饭 / `METHOD:HTC-cf3dabc066de2aa054f0:line:1` | 北方大米，米和水放在电饭煲的容器内，食指触及米，水量能刚好没过食指的第一个指节（即大约 2 厘米处）。 | 确认选项、适用条件及实际用量；保留未知与可选状态 |
| identity | equipment_role | 电饭煲蒸米饭 / `METHOD:HTC-cf3dabc066de2aa054f0:line:1` | 北方大米，米和水放在电饭煲的容器内，食指触及米，水量能刚好没过食指的第一个指节（即大约 2 厘米处）。 | 核对是否厨具及目录角色；不得当食材绑定营养或计入摄入 |
| identity | group_identity | 炸酱面 / `METHOD:HTC-d916492c172d5d9ae5be:line:2` | 菜码 总量 35g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | source_structure | 乡村啤酒鸭 / `METHOD:HTC-e2015e2e0cc1c5e72c4f:line:10` | 桂皮 4 厘米一小片 | 回查完整锁定原文和步骤；可先修解析，字段确认后仍需配方人工审核 |
| measurement | relation | 黑椒牛柳 / `METHOD:HTC-e38c861fa4b779d7353e:line:5` | 黑椒腌料 = 参照所购商品的说明按比例腌制 | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| identity | group_identity | 意式香肠北非蛋 / `METHOD:HTC-e9b179096587074a0892:line:0` | 肉类（香肠/午餐肉）：100g - 150g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| identity | group_identity | 水煮鱼 / `METHOD:HTC-eb849be42cbb064be284:line:1` | 蔬菜（比如土豆片/豆芽/花菜/生菜/……） 可有不同搭配，推荐合计重量 300g 至 500g | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | approximate | 烤蛋挞 / `METHOD:HTC-ebf90ccaf451ad5fea4a:line:0` | 蛋挞皮 品牌不限 整包蛋挞皮约为 30 只 | 确认来源计量口径；约数和模糊量不得变为精确克重 |
| identity | group_identity | 基础牛奶面包 / `METHOD:HTC-ec9f0780bddb3fb43e42:line:7` | 奶制品 混合后共 ¼ cup （奶粉需要和水混合。） | 确认混合组/替代关系及成员；不能把组总量分配给单项 |
| measurement | relation | 酸辣蕨根粉 / `METHOD:HTC-ecbf1bf555cf90edacd3:line:0` | 酱油 : 醋 : 油泼辣子 = 3 : 2 : 2 （酱料具体量根据蕨根粉多少决定，这个比例仅为保证口味的方向不出错） | 确认关系的基准、单位、批次和条件；不能直接转固定量 |
| identity | identity_source_structure | 金菲士 / `METHOD:HTC-efd96f40d1be05ac5ea6:line:3` | 1 : 1 蔗糖糖浆 30~40 克 | 回查完整原文修正误拆/错字，再核对目录形态；比例、部位和单位不推断 |
| measurement | compound | 椒盐排条 / `METHOD:HTC-f43c7cdf6c27f0660780:line:1` | 鸡蛋 1 个 50 g | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | compound | 河南蒸面条 / `METHOD:HTC-f64edf0ff4660fb1b139:line:15` | 油 + 锅 + 菜刀 + 铲子 | 核对并列量、总量与分项；确认等价或冲突，不能挑一个数或直接求和 |
| measurement | approximate | 商芝肉 / `METHOD:HTC-f82a5ad59d69212fac8f:line:10` | 摊鸡蛋皮:一张约 15 克 | 确认来源计量口径；约数和模糊量不得变为精确克重 |

## 审核结果模板

每条决定记录：记录 kind/id、line_id（如适用）、原记录 SHA、缺项、原文/来源版本、证据链接与摘要、审核人及角色、上海时间、通过/退回/补证、理由、适用范围、复核人。
“通过字段”不等于“批准配方执行”；执行资格须单独审核整道配方所有缺项。缺审核人、时间、证据或范围的决定仍为待审核。
