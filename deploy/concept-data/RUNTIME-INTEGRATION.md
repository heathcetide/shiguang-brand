# 概念数据业务接入（2026-09-15）

最新更新：第二批营养补充已上线，31 个形态参考、20 道家常菜评估、8 道主要营养估算。当前镜像、发布目录、验证与回退见 [营养补充上线记录](NUTRITION-ENRICHMENT.md)。以下为基础目录首次接入的历史记录。

更新：数据实验室已按用户要求关闭，`/data-lab*` 返回 HTTP 410，其独立服务已停止。下文的验证记录为上线时记录；业务接口、App 与数据文件仍保留。

入口：[App 网页版](https://dietdigidose.top/app/)。此入口导出自 `client`，使用现有 `/api/v1`、账号、收藏、库存和厨具服务。

## 已启用

- 1,079 个食材概念入口；原料形态、语言和地区别名保存在关联元数据中。
- 385 个菜品入口、389 种做法。默认列表展示主要做法，详情保留其他做法的真实菜谱 ID。
- 261 项厨具，映射到 App 支持的分类；原始分类保留在来源记录。
- 食材名称可用于录入，菜谱可检索、阅读与收藏，厨具可加入个人目录。
- `source=concept_base, quality_status=reference` 表示可供使用的参考目录，不代表营养已核验。
- 食材与菜谱营养保持 NULL/unknown；候选营养不参与计算。未核验配方仍禁止自动扣库存/生成备餐。
- 没有做法的百科菜品仅保留在概念数据包；不会伪造步骤并发布到菜谱列表。

## 构建和导入

1. `python datasets/base-data/reclean/runtime_input.py artifacts/base-data/concept-base-1.0.0-rc.2`
2. 将生成的 `runtime-input.json` 与 `server/scripts/import-concept-runtime.mjs` 放在有 `pg` 依赖的服务运行目录。
3. 使用 `DATABASE_URL` 和 `CONCEPT_INPUT_SHA256`（必须与实际输入文件 SHA256 一致）运行：
   `node import-concept-runtime.mjs runtime-input.json` 默认事务回滚；增加 `--apply` 才提交。
4. 食材、厨具和菜谱复用已有基础包 ID；新增映射存放于 `base_data_runtime_ids` 的 `concept_*` 集合。不会创建演示账号或改写用户库存、收藏。
5. 网页构建使用 `EXPO_PUBLIC_BACKEND_BASE_URL=https://dietdigidose.top`、`EXPO_PUBLIC_WEB_BASE_PATH=/app`，执行 `corepack pnpm --dir client build`。网页导出不分配 APK 打包编号。

输入 SHA256：`2923b05b517736f57bca1786a31cba9bfcbc63fdf453a174b90bc65ab15d7a46`。

## 线上位置

- 服务镜像：`dietdigidose-server:concept-runtime-20260915-v2`（基于部署中的 `6ba7d9e`，仅替换后端构建输出）。
- 发布目录：`/opt/dietdigidose/releases/concept-runtime-20260915`。
- 主 Compose：`/opt/dietdigidose/deploy/docker-compose.staging.yml`；API、worker、intervention-delivery、intervention-scan 更新到相同镜像，迁移服务和数据库配置保持原值。
- 网页 Compose：发布目录中的 `app-compose.yml`，服务名 `app-web`，Docker 内网 9092，无新增主机端口。
- 主 Caddy 配置：`/opt/dietdigidose/releases/d9fb45e2eef27a2451af954adfaecf391a86c53d/deploy/Caddyfile`。
- 新增 `/app` 跳转 `/app/`，`handle_path /app/*` 反代 `app-web:9092`。
- 备份：`/opt/dietdigidose/backups/concept-runtime-20260915`，含数据库备份、旧 Compose 和代理前后配置。

## 验证

- client TypeScript/ESLint、server TypeScript 通过。
- 28 项业务模块测试、28 项推荐与计划维护测试、122 项 API 回归、3 项营养展示测试通过。
- Web export、后端构建成功。
- 完整备份成功恢复到独立验证库；导入演练和重入成功，第二次新增记录 0。
- 导入前后账号、个人库存、个人厨具和收藏内容哈希一致。
- 线上 HTTPS 健康、食材检索、菜谱列表/详情、App 静态入口、后台和数据实验室均返回 200。
- 验证库通过管理员认证的厨具目录返回 261 项且分类可供 App 使用。
- 独立验证库实际完成新增个人厨具、收藏概念菜谱、以空营养值记餐。
- 自动营养推荐和计划维护候选集排除参考配方，避免将未知营养用于自动配餐。
- 浏览器自动化读取页面连续超时；不能据此声称人工式页面交互检查已完成。

## 回退

优先隐藏此次参考目录，保留用户后来产生的引用。事务内将 `source='concept_base'` 的食材与厨具 `quality_status` 设为 `needs_review`，将对应菜谱 `quality_status` 设为 `needs_review`、`status` 设为 `pending`，即可从业务搜索撤下。

需要回退服务时，恢复备份中的旧 Compose 并重建 API、worker、intervention-delivery、intervention-scan；主代理配置须原位写回 `Caddyfile.before`，验证后重启 Caddy。不要直接用旧整库备份覆盖有新用户写入的数据库；整库恢复需另外安排维护窗口。

原始营养来源与 CN6 候选数据仍留在管理员数据实验室中，未通过公共 App 接口分发原始营养表。手机已有安装包会读取新的业务数据；本次新增的详情交互和缺项文案已发布到网页版，APK 尚未重新打包。
