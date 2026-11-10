# server-go 绞杀者迁移进度（1A / 2B）

## 决策

- **1A**：AI 在 Go 内以简化运行时提供同等路由面，不做 LangGraph checkpoint 对等。
- **2B**：客户端与 admin 主路径由 Go 承接；Express 上游默认关闭。

## 路由覆盖

对照 Express `server/src` 的约 **313** 条路由，Go `appapi` + system compat 已注册同等 method+path。未匹配路径默认 **404**（不再反代 Express）。

## 业务深度

| 能力 | 深度 |
| --- | --- |
| 库存 FEFO / consume / 幂等 intake | 完整 |
| 烹饪完成扣库存、meal-plan activate 物化 items、queue↔plan 联动 | 完整 |
| 推荐库存打分、weekly/cooking plan、requirements 分配、`checksPending`（含厨具缺口） | 完整 |
| 家庭 dining allocation / join 440 / 带 recipe 备餐 | 完整 |
| Admin 重置密码 bcrypt+session、列表读真实表、console 契约（stats/trends/audit/chat/trash/ai-usage/core-loops 响应形状） | 完整 |
| 音色包 `voice_pack_versions` 目录 / 偏好 / TTS synthesize；admin CRUD+history | 完整（无 TTS key → `TTS_NOT_CONFIGURED`） |
| 干预反馈落库、计划维护 recalc + pendingReplacements | 完整 |
| 主动干预后台 worker（expiry_rescue / dinner_window 扫描投递） | 完整（`PROACTIVE_INTERVENTIONS_ENABLED` / `INTERVENTION_SCAN_INTERVAL_SEC`） |
| `/api/v1/ai/*` | **1A**：OpenAI-compatible 真调用（chat SSE / vision / ASR / realtime turn）；无 key 时稳定 fallback；非 LangGraph supervisor |
| Admin AI config / resources | 可读写草稿与连接探测；lifecycle 为简化版（非 Express 全量 draft 状态机） |
| Core loops 周投影 | 有表/设置时可启用；缺证据表时 `not_collected`（非 Express 全量投影引擎） |
| SMS | 默认 dev outbox；配置 `ALIYUN_SMS_*` 可真发（本阶段可暂缓） |

## 已迁移域

| 域 | 路径前缀 | 状态 |
| --- | --- | --- |
| System | `/api/v1/health` `/version` `/ai-data-policy` | 完成 |
| Auth | `/api/v1/auth/*` | 完成 |
| Site / App updates | `/site-settings` `/app-updates` | 完成 |
| Inventory | `/inventory/*` | 完成 |
| Diet / Health / Onboarding | `/diet-records` `/health-data` `/onboarding` | 完成 |
| Cooking / Meal plans | `/cooking-queue` `/meal-plans` | 完成 |
| Insights / Plan maintenance | `/insights` `/plan-maintenance` | 完成 |
| Recipes / Foods / Kitchenware / Shopping / Recommendations | 对应前缀 | 完成 |
| Community / Households / Notifications / Feedback / Media / Share | 对应前缀 | 完成 |
| AI | `/api/v1/ai/*` | 完成（1A OpenAI-compatible + fallback） |
| Admin | `/api/v1/admin/*` | 完成 |
| Webhooks | `/webhooks/sms` `/webhooks/aliyun/sms-delivery/:token` | 完成接收桩 |

## 运行

- 默认入口：Go `:9090`（`pnpm dev` / `pnpm dev:server-go`）
- 共享库：`server/data/dietdigidose.db`
- JWT：`JWT_SECRET` 或 `server/data/jwt_secret.key`
- **默认不反代 Express**。临时回退：

```bash
APP_UPSTREAM_EXPRESS=http://127.0.0.1:9091 pnpm dev:server-go
pnpm dev:server   # :9091
```

### AI（真模型）

```bash
export AI_API_KEY=...          # 或 OPENAI_API_KEY；也可写 system_settings
export AI_BASE_URL=...         # 默认 https://api.openai.com/v1
# 可选：AI_CHAT_MODEL / AI_VISION_MODEL / AI_ASR_MODEL / AI_RESOURCE_CONFIG_V1
```

无 key 时 chat/vision/ASR 仍返回 200 + `fallback` / `failureReason=AI_NOT_CONFIGURED`。

### 主动干预 worker

- 默认在 `APP_ENVIRONMENT=dev|development|local`（或空）启用；显式 `PROACTIVE_INTERVENTIONS_ENABLED=1|0` 覆盖。
- `INTERVENTION_SCAN_INTERVAL_SEC` 默认 `60`；启动时立即扫一轮。
- 卡片：`GET /api/v1/notifications/interventions/:id`。

## 说明

- `scaffold.enabled=true` 时会与 `POST /api/v1/auth/login` 冲突，保持默认 `false`。
