# rc.7 PostgreSQL 业务导入

`server/scripts/import-base-data-runtime.mjs` 将已校验的 `base_data.files` 中的 rc.7 数据映射到实际业务表，默认事务预演并回滚；传入 `--apply` 才提交。需要部署环境的 `DATABASE_URL` 和 `DDD_DEMO_PASSWORD_1/2/3`。这些密码不得提交到仓库。

运行前必须先执行正式数据库迁移（SQLite 81 / PostgreSQL 0023）。导入器不再自行执行 DDL；迁移将旧 `base_data.runtime_ids` 映射原样接管到 `public.base_data_runtime_ids`，保留业务主键、管理员修改、未知营养及 `is_demo`。原附件归档仍使用独立 `base_data` schema。新导入厨具保留 `needs_review`；目录概念不等于已审核的容量或替代关系。


```sh
node scripts/import-base-data-runtime.mjs
node scripts/import-base-data-runtime.mjs --apply
```

执行前使用 `pg_dump -Fc` 备份并用 `pg_restore --list` 检查备份。先部署 AI 营养查询的空值修正，再正式导入。脚本会核验固定包哈希、39 个文件的内容哈希和核心数量，使用事务与 advisory lock；1,151 条持久化逻辑 ID 映射用于跳过已有导入，不覆盖用户修改。未知同名账号或厨具冲突会中止并回滚；现有管理员只关联，不改密码和权限。

## 业务状态

- `ingredients_library`：447 条，热量允许 NULL，`nutrition_status=unknown`、`quality_status=needs_review`，管理端可审核。普通食物搜索仍只展示已审核食材。
- `recipes`：341 条，`pending/needs_review`，管理端可审核，保留原始步骤、用量和来源。全部 `automatic_inventory_write_allowed=false`；数据库触发器拒绝这些菜谱关联的烹饪完成写入，使同一事务内的库存扣减一起回滚。
- `kitchenware_catalog`：241 条目录条目，仅精确别名；不创建能力或替代关系。
- `users`：保留已有管理员，新增 3 个普通示例账号，bcrypt 成本 12，首次登录要求改密。登录标识为 `ddd_demo_1@demo.dietdigidose.invalid` 等保留域名测试邮箱，不发送邮件。
- `community_posts`：100 条；评论、库存、收藏各 6 条。均保留 `is_demo`，不制造点赞和浏览量。
- `public.base_data_runtime_ids`：稳定逻辑 ID 与业务主键的映射；原始完整包继续保存在 `base_data`。

本脚本自行执行 PostgreSQL 的增量 DDL，不修改已有迁移版本号。后续标准迁移须保留新增字段、NULL 营养以及菜谱扣减限制。`is_demo` 已持久化；所有历史管理端统计尚未全面适配该标记，不应将原始账户/帖子总量当作真实用户指标。

## 厨具关联修复

部署导入脚本时须同时复制同目录的 `base-data-kitchenware.mjs`。新导入会在同一事务中写入 `recipe_kitchenware_requirements`，JSON 同时保留目录 ID 和厨具名称。重新运行时，只补齐仍保留旧导入 JSON 格式、没有业务厨具关联且来源版本匹配的菜谱；管理员已修改的 JSON 或关联不覆盖。日志中的 `repairedRecipeKitchenware` 是旧记录修复数量，不计入新增 ID 映射。默认预演回滚，审核预演结果后用 `--apply` 提交。

回归验证使用独立测试 PostgreSQL：设置 `TEST_BASE_DATA_DATABASE_URL` 后，在仓库根目录运行 `pnpm --filter server test:base-data-import`。测试使用临时表并回滚，覆盖重复运行、管理员修改保护及写入失败回滚。

## 云端操作记录

服务器为 `118.145.165.226`，staging 数据库为 `dietdigidose`。本次业务导入前备份位于服务器 `/opt/dietdigidose/backups/business-rc7/before-import.dump`，SHA256 为 `a1e26c6e640a45185bfef9f080a85d230c4f24619a5d20cc608307d809a0694d`。脚本、日志和受限密码文件位于服务器 `/opt/dietdigidose/releases/base-data-rc7/`。

2026-09-07 已完成正式导入，重复执行新增映射为 0。在线验证：示例登录成功且有改密标记，厨具接口返回 241 条，社区首页返回 30 条分页数据，API 健康；数据库候选菜谱扣减保护与部署后的营养 NULL/真实零值区分均通过。API 与 worker 均已更新，旧镜像保留 `:before-business-rc7` 标签。

不要用备份直接覆盖有新写入的在线库。恢复时先停写并备份当前库，在独立数据库恢复及核对后再切换。
