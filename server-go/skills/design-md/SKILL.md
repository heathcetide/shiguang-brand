---
name: design-md
description: "74 个知名网站设计系统（DESIGN.md）模板，一键复用品牌级 UI 风格。当用户想构建匹配某品牌设计系统的 UI、需要设计 token/配色/字体、或说'做成 [品牌] 的样子'时使用。加载对应的 reference 文件作为设计规范。"
description_zh: "74 个知名网站设计系统模板，一键复用品牌级 UI 风格"
description_en: "74 ready-to-use DESIGN.md files from top websites for instant brand-quality UI"
version: 2.0.0
homepage: https://github.com/VoltAgent/awesome-design-md
allowed-tools: read, grep, glob, write, edit
triggers:
  - user
  - model
---

# Design.md — 品牌级设计系统库

74 个从真实网站提取的 **DESIGN.md** 设计系统规范。每个文件都是一份完整的设计系统文档（配色 / 字体 / 间距 / 组件 / 阴影 / 响应式 / Do & Don't / Agent 提示词），AI 读取后可生成与该品牌视觉一致的高质量 UI。

## 什么是 DESIGN.md

[DESIGN.md](https://stitch.withgoogle.com/docs/design-md/overview/) 是 Google Stitch 提出的概念 —— 一份纯文本设计系统文档，AI agent 读取后生成视觉一致的 UI。就是一个 markdown 文件，无需 Figma 导出、无需 JSON schema、无需特殊工具。丢到项目根目录，任何 AI coding agent 都能立刻理解 UI 应该长什么样。

| 文件 | 谁读它 | 定义什么 |
|------|--------|----------|
| `AGENTS.md` | 编码 agent | 项目怎么构建 |
| `DESIGN.md` | 设计 agent | 项目应该长什么样 |

## 如何使用

### 工作流

1. **用户提到某品牌** → 在下方表格找到对应的 reference 文件
2. **读取 reference**：`read ~/.config/devin/skills/design-md/references/{site-name}.md`
3. **复制 DESIGN.md 内容**到用户项目根目录作为 `DESIGN.md`
4. **按设计 token 生成 UI**：使用文件里的 colors / typography / spacing / components

### 何时主动推荐

当用户要求构建 UI **但没有指定品牌或风格偏好**时（如"帮我做一个落地页"、"写一个 dashboard"、"做一个 SaaS 官网"），**主动推荐** 3–5 个设计系统：

| 项目类型 | 推荐风格 | 理由 |
|---|---|---|
| SaaS 官网 / Landing | stripe, vercel, linear.app | 经典高转化 SaaS，简洁专业 |
| 开发者工具 / 技术产品 | vercel, cursor, raycast, supabase, warp | 暗色系、代码友好、极客气质 |
| AI 产品 / Chat UI | claude, mistral.ai, elevenlabs, voltagent | AI 原生设计语言 |
| Fintech / 金融 | stripe, revolut, coinbase, wise | 信任感、机构感 |
| 中后台 / Dashboard | linear.app, sentry, posthog, supabase | 数据密集型暗色 dashboard |
| 编辑 / 内容 / 阅读 | notion, sanity, theverge, wired | 排版优先、阅读舒适 |
| 电商 / 市场 | airbnb, shopify, nike, apple | 摄影/商品图驱动 |
| 汽车 / 工业 / 高端 | tesla, spacex, ferrari, bugatti, bmw | 极简、全幅图像、未来感 |
| 消费品牌 | starbucks, nike, spotify, nintendo-2001 | 品牌色鲜明、情绪化 |

## 全部 74 个设计系统

### AI & LLM 平台
| 站点 | Reference | 风格 |
|------|-----------|------|
| Claude | `references/claude.md` | 暖色羊皮纸画布、Anthropic Serif、terracotta 强调色 |
| Cohere | `references/cohere.md` | 鲜艳渐变、数据密集 dashboard |
| ElevenLabs | `references/elevenlabs.md` | 暗色电影感 UI、音频波形美学 |
| Minimax | `references/minimax.md` | 大胆暗色界面、霓虹强调 |
| Mistral AI | `references/mistral.ai.md` | 法式极简、紫色调 |
| Ollama | `references/ollama.md` | 终端优先、单色极简 |
| OpenCode AI | `references/opencode.ai.md` | 开发者向暗色主题 |
| Replicate | `references/replicate.md` | 干净白画布、代码优先 |
| Runway | `references/runwayml.md` | 电影暗色 hero、纸白阅读带、黑色 pill CTA |
| Together AI | `references/together.ai.md` | 技术 blueprint 风格 |
| VoltAgent | `references/voltagent.md` | 纯黑画布、emerald 强调、终端原生 |
| xAI | `references/x.ai.md` | 极简单色、未来极简 |

### 开发者工具 & IDE
| 站点 | Reference | 风格 |
|------|-----------|------|
| Cursor | `references/cursor.md` | 暗色界面、渐变强调 |
| Expo | `references/expo.md` | 暗色、紧字距、代码向 |
| Lovable | `references/lovable.md` | 活泼渐变、友好开发风 |
| Raycast | `references/raycast.md` | 暗色 chrome、鲜艳渐变 |
| Superhuman | `references/superhuman.md` | 高级暗色 UI、键盘优先、紫色光晕 |
| Vercel | `references/vercel.md` | 黑白精准、Geist 字体 |
| Warp | `references/warp.md` | 暗色 IDE、block 命令 UI |

### 后端 / 数据库 / DevOps
| 站点 | Reference | 风格 |
|------|-----------|------|
| ClickHouse | `references/clickhouse.md` | 黄色强调、技术文档风 |
| Composio | `references/composio.md` | 暗色 + 彩色集成图标 |
| HashiCorp | `references/hashicorp.md` | 企业级黑白 |
| MongoDB | `references/mongodb.md` | 绿叶品牌、开发者文档 |
| PostHog | `references/posthog.md` | hedgehog 品牌、开发者暗色 UI |
| Sanity | `references/sanity.md` | 暗色编辑风、112px 标题、coral-red CTA |
| Sentry | `references/sentry.md` | 暗色 dashboard、粉紫强调 |
| Supabase | `references/supabase.md` | 暗色 emerald、代码优先 |

### 生产力 & SaaS
| 站点 | Reference | 风格 |
|------|-----------|------|
| Cal.com | `references/cal.md` | 干净中性、开发者极简 |
| Intercom | `references/intercom.md` | 友好蓝色、对话式 UI |
| Linear | `references/linear.app.md` | 极简精准、紫色强调、近黑画布 |
| Mintlify | `references/mintlify.md` | 干净、绿色强调、阅读优化 |
| Notion | `references/notion.md` | 暖色极简、serif 标题、柔和表面 |
| Resend | `references/resend.md` | 极简暗色、等宽强调 |
| Zapier | `references/zapier.md` | 暖橙、友好插画 |

### 设计 & 创意工具
| 站点 | Reference | 风格 |
|------|-----------|------|
| Airtable | `references/airtable.md` | 彩色友好、结构化数据 |
| Clay | `references/clay.md` | 有机形状、柔和渐变 |
| Figma | `references/figma.md` | 多彩、活泼而专业 |
| Framer | `references/framer.md` | 黑蓝大胆、动效优先 |
| Miro | `references/miro.md` | 亮黄强调、无限画布 |
| Webflow | `references/webflow.md` | 蓝色强调、精致营销风 |

### Fintech & Crypto
| 站点 | Reference | 风格 |
|------|-----------|------|
| Binance | `references/binance.md` | Binance 黄 + 单色、交易厅紧迫感 |
| Coinbase | `references/coinbase.md` | 干净蓝、信任感、机构感 |
| Kraken | `references/kraken.md` | 紫色暗色 UI、数据密集 |
| Mastercard | `references/mastercard.md` | 暖奶油画布、orb 品牌 |
| Revolut | `references/revolut.md` | 暗色渐变卡片、fintech 精准 |
| Wise | `references/wise.md` | 亮绿强调、友好清晰 |

### 企业 & 消费品牌
| 站点 | Reference | 风格 |
|------|-----------|------|
| Airbnb | `references/airbnb.md` | 暖珊瑚、摄影驱动、圆角 UI |
| Apple | `references/apple.md` | 高级留白、SF Pro、电影感图像 |
| BMW | `references/bmw.md` | 暗色高端、德式工程精准 |
| BMW M | `references/bmw-m.md` | BMW M 子品牌、性能取向 |
| Bugatti | `references/bugatti.md` | 极致高端、深色、全幅图像 |
| Dell (1996) | `references/dell-1996.md` | 复古 90s 企业风 |
| Ferrari | `references/ferrari.md` | 法拉利红、赛车情绪 |
| HP | `references/hp.md` | 企业蓝、技术干净 |
| IBM | `references/ibm.md` | Carbon 设计系统、结构化蓝 |
| Lamborghini | `references/lamborghini.md` | 暗色高端、锋利线条 |
| Meta | `references/meta.md` | 蓝色品牌、社交平台 |
| NVIDIA | `references/nvidia.md` | 绿黑能量、技术力量 |
| Nike | `references/nike.md` | 大胆排版、运动情绪 |
| Nintendo (2001) | `references/nintendo-2001.md` | 复古游戏、鲜艳活泼 |
| PlayStation | `references/playstation.md` | 暗色高端、游戏品牌 |
| Renault | `references/renault.md` | 法式汽车、黄色品牌 |
| Shopify | `references/shopify.md` | 绿色品牌、电商友好 |
| Slack | `references/slack.md` | 多彩、工作通讯、圆角 |
| SpaceX | `references/spacex.md` | 黑白极简、全幅图像、未来感 |
| Starbucks | `references/starbucks.md` | 绿色品牌、暖色舒适 |
| Tesla | `references/tesla.md` | 极简黑白、全幅图像、高端科技 |
| The Verge | `references/theverge.md` | 编辑风、科技媒体、紫红强调 |
| Vodafone | `references/vodafone.md` | 红色品牌、电信 |
| Wired | `references/wired.md` | 科技杂志、编辑风、强烈排版 |

## 每个 DESIGN.md 包含什么

每个文件遵循 [Google Stitch DESIGN.md 格式](https://stitch.withgoogle.com/docs/design-md/format/)，9 个部分：

1. **Visual Theme & Atmosphere** — 氛围、密度、设计哲学
2. **Color Palette & Roles** — 语义名 + hex + 功能角色
3. **Typography Rules** — 字体族、完整层级表
4. **Component Stylings** — 按钮 / 卡片 / 输入 / 导航 + 状态
5. **Layout Principles** — 间距 scale、网格、留白哲学
6. **Depth & Elevation** — 阴影系统、表面层级
7. **Do's and Don'ts** — 设计护栏、反模式
8. **Responsive Behavior** — 断点、触控目标、折叠策略
9. **Agent Prompt Guide** — 快速配色参考、即用提示词

## 使用示例

### 1. 用户指定品牌 → 直接匹配

```
用户: "做一个看起来像 Stripe 的落地页"
→ 读取 references/stripe.md
→ 复制内容到用户项目作为 DESIGN.md
→ 用设计 token 生成 UI 代码
```

### 2. 用户想浏览 → 过滤推荐

```
用户: "给我看暗色系设计系统"
→ 推荐: vercel, cursor, elevenlabs, resend, warp, supabase, voltagent, x.ai
→ 让用户选，然后加载对应 reference
```

### 3. 用户没指定风格 → 智能推荐

按上方"何时主动推荐"表格，根据项目类型推荐 3–5 个设计系统，让用户选。

## 注意事项

- reference 文件路径：`~/.config/devin/skills/design-md/references/{site-name}.md`
- 站点名中的 `.` 保留（如 `linear.app.md`、`mistral.ai.md`、`x.ai.md`、`opencode.ai.md`、`together.ai.md`）
- `bmw` 与 `bmw-m` 是两个不同设计系统
- `dell-1996` 与 `nintendo-2001` 是复古风格
- 加载后请**完整遵循**文件里的 Do & Don't，不要混用不同品牌的设计 token
