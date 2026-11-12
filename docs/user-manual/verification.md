# 操作手册实操核验记录

本文件是 [操作手册](README.md) 的配套证据索引，供文档维护、研发复验与验收人员使用。它不是全量测试报告或生产验收结论。

## 1. 核验基线

| 项目 | 记录 |
| --- | --- |
| 日期 | 2026-11-11 |
| 代码基线 | `refactor/ui-optimize`；基础提交 `b6598cc`，叠加当日工作区已有改动及后台两页防崩溃修复 |
| 客户端 | 实际 Expo Web，浏览器视口 430 × 932 |
| 后台 | 实际 Vite/React 管理端，浏览器视口 1440 × 1000 |
| 浏览器 | 本机 Google Chrome；使用独立浏览器配置目录，不借用日常浏览器会话 |
| 后端 | 从当日工作区构建的 Go API，独立 SQLite 数据库；非现有应用数据库 |
| 网络隔离 | 专用浏览器的本地 API 请求转到隔离 Go API；不修改响应正文，不用 mock 响应制造成功结果；阻止外部 HTTP/HTTPS 请求 |
| 数据 | 虚构账号“手册体验员”、保留示例邮箱、演示食材和文字；没有使用真实健康资料 |
| 凭据 | 未收入文档、截图或仓库；文档不提供可登录密码、访问令牌及数据库文件 |

客户端与后台页面复用了已运行的本地前端服务。隔离 API、专用浏览器及固定请求转发是本次临时核验设施，不是部署要求；手册中的操作步骤不依赖其临时端口。

**重现提示**：基线包含未提交的工作区改动，因此只检出基础提交不能保证得到完全相同的页面。后续若形成发布版本，应以发布标识、构建号和对应验收报告替换此基线。

## 2. 实际操作与核验结果

| 编号 | 操作 | 核验依据 | 结论 |
| --- | --- | --- | --- |
| V-01 | 新用户注册及同账号登录 | 注册后能登录并进入个人/库存页面 | 已验证；邮件验证与恢复未验证 |
| V-02 | 管理员首次登录改密 | 使用初始凭据登录、完成改密、用新密码重新登录工作台 | 已验证；截图 31 后续重拍只展示表单，没有第二次改密 |
| V-03 | 手动新增番茄 500g | 表单提交后在库存列表看见番茄及数量 | 已验证 |
| V-04 | 修改番茄分类 | 编辑页把分类改为“蔬菜”并保存 | 已验证；没有依赖名称自动分类 |
| V-05 | 文字批量入库鸡蛋和牛奶 | 核对两项后确认保存，列表共三项食材 | 已验证；没有验证口述或识别服务 |
| V-06 | 新增采购项 | 导入请求返回 HTTP 400，没有新增成功证据 | 当前受限 |
| V-07 | 打开食谱详情并加入队列 | 详情可显示标题，食材和步骤等缺失；队列未出现可核对条目 | 当前受限；没有完成烹饪与库存扣减 |
| V-08 | 手动记录午餐 | 提交后列表出现“番茄鸡蛋（手册演示）” | 部分可用：时间为“—”，空热量显示 0，汇总存在不一致 |
| V-09 | 健康资料 | 子页显示“资料暂时不可用，请重试” | 当前受限；没有保存成功证据 |
| V-10 | 修改公开简介 | 保存后重新进入编辑页，简介仍保留 | 已验证；未验证用户名修改及头像上传 |
| V-11 | 切换深色外观 | 选择深色、刷新后界面仍为深色；随后恢复跟随系统 | 已验证浏览器刷新持久化；不等同于原生进程冷启动核验 |
| V-12 | 提交功能建议 | 提交后自动进入反馈 #1 详情，显示“已收到”及原文 | 已验证；补充、人工回复和后台处理未验证 |
| V-13 | 发布社区文字动态 | 提交后进入详情，标题正文正确，并显示“发布成功，动态已保存” | 已验证；未验证首页分发、图片、评论、关注或审核 |
| V-14 | 用户管理修复后实操 | 实际 Go 返回 `users`，页面显示两行；搜索后剩一行；用户名可打开详情 | 已验证读取、搜索与基本详情；没有变更账号权益 |
| V-15 | 通知中心修复后实操 | 实际 Go 返回不含统计的响应；页面显示“不可用”，刷新正常，发送禁用 | 已验证安全降级；不代表通知投递已实现 |
| V-16 | 保存 AI 系统提示词草稿 | 实际点击保存后，重新加载配置页面，提示词仍保留 | 已验证草稿写入与回读；没有发布、连接测试或真实 AI 调用 |
| V-17 | 工作台 | 多个区块可显示，但待审食谱等区块读取失败 | 部分可用；不能作为整后台健康结论 |

### 单独准备的食谱数据

由于后台食谱列表不能正常完成操作，核验人员仅在隔离数据库中准备了一条“番茄炒蛋（手册演示）”数据，用于检查客户端详情展示。数据含番茄、鸡蛋、用时及步骤，但页面没有正确完整展示。

这不是通过后台完成的创建/审核流程，也不证明后台内容管理可用。手册将对应截图标为受限示例，未将其编入成功烹饪教程。

### 离线隔离造成的边界

外部资源和服务请求被主动阻断，包括依赖外部 CDN 的条码识别资源。因此，本次没有验证相机/条码流程；不能仅凭隔离环境中的资源加载失败断言所有线上部署都会失败。

## 3. 后台两页修复的验证记录

修复前，真实接口都返回 HTTP 200，但用户列表响应为 `users` 而非前端预期的 `items`；通知概览缺少 `metrics` 等字段。前端分别在读取 `length`、`created` 时整页崩溃。

修复后：

- 用户列表在进入页面状态前校验响应，兼容两类列表信封；异常数据进入可重试错误态，而非把列表赋为 `undefined`。
- 通知页面校验响应，缺失指标不补成零，不把个人站内信记录当作群发活动，缺失完整概览时禁用发送。
- 单元/组件测试覆盖正常与空列表、无效响应、重试、搜索详情、游标去重、局部通知数据、真实零值、完整响应、发送确认与成功回读等。
- 后台全量测试 **26 个文件、204 项通过**；执行时使用 `NODE_OPTIONS=--no-experimental-webstorage`，避免当前 Node 的实验性全局存储干扰 jsdom。未带该选项的首次全量测试有 4 项既有主题测试因 `localStorage` 不可用而失败。
- TypeScript、后台 Lint、生产构建及 `git diff --check` 通过。
- 修复后已通过真实浏览器核对用户列表/搜索/详情与通知刷新/禁发状态；不是只用测试替代运行。

代码及测试见：

- [用户管理页面](../../admin/src/pages/Users.tsx)
- [通知中心页面](../../admin/src/pages/Notifications.tsx)
- [响应校验与兼容](../../admin/src/utils/adminResponses.ts)
- [组件回归测试](../../admin/src/pages/adminResponseCompatibility.test.tsx)

## 4. 截图索引

文件名前缀是采集标识，不等于手册中的图号；图号以正文图注为准。所有文件均为实际浏览器截图。正文采用的图片已打开检查；部分早期截图仅保留作补充证据，不作为正常操作成果。

| 文件 | 内容与用途 |
| --- | --- |
| [01-client-login.png](images/01-client-login.png) | 登录入口；密码为空，按钮禁用；已重拍为移动视口 |
| [02-client-register.png](images/02-client-register.png) | 填写后的注册表单；密码掩码；后续重拍未重复注册 |
| [03-client-onboarding.png](images/03-client-onboarding.png) | 新手引导契约错误；受限证据 |
| [04-inventory-empty.png](images/04-inventory-empty.png) | 初始空库存；补充证据 |
| [05-inventory-methods.png](images/05-inventory-methods.png) | 入库方式选择 |
| [06-inventory-form.png](images/06-inventory-form.png) | 首次番茄表单，当时分类仍为“其他”；不作为最终分类范例 |
| [07-inventory-saved.png](images/07-inventory-saved.png) | 首笔食材保存后的列表；补充证据 |
| [08-inventory-edit.png](images/08-inventory-edit.png) | 分类调整为“蔬菜”的编辑表单 |
| [09-inventory-text-review.png](images/09-inventory-text-review.png) | 鸡蛋、牛奶批量保存前逐项核对 |
| [10-inventory-list.png](images/10-inventory-list.png) | 三项食材保存后的库存 |
| [11-shopping-list.png](images/11-shopping-list.png) | 采购空列表，不能证明添加成功 |
| [13-recipe-detail.png](images/13-recipe-detail.png) | 食谱字段缺失；受限示例 |
| [14-cooking-queue.png](images/14-cooking-queue.png) | 队列仍为空，不能证明入队成功 |
| [17-diet-record.png](images/17-diet-record.png) | 记录前饮食空状态；补充证据 |
| [18-diet-form.png](images/18-diet-form.png) | 手动午餐填写，时间 12:30，营养未知 |
| [19-diet-saved.png](images/19-diet-saved.png) | 记录名称已保存，时间与空热量存在显示限制 |
| [20-health-profile.png](images/20-health-profile.png) | 资料与偏好分组入口，不是保存成功页面 |
| [21-health-restrictions.png](images/21-health-restrictions.png) | 健康资料暂不可用；受限证据 |
| [22-profile.png](images/22-profile.png) | 个人入口；不用于证明汇总准确 |
| [23-profile-edit.png](images/23-profile-edit.png) | 简介保存后重新进入的编辑页 |
| [24-community.png](images/24-community.png) | 社区列表浏览状态；不证明首页分发完整可用 |
| [25-settings.png](images/25-settings.png) | 设置入口，跟随系统外观 |
| [26-settings-dark.png](images/26-settings-dark.png) | 刷新后保留的深色模式 |
| [27-feedback.png](images/27-feedback.png) | 反馈类型与表单 |
| [28-feedback-result.png](images/28-feedback-result.png) | 反馈登记成功并显示编号及“已收到” |
| [29-community-compose.png](images/29-community-compose.png) | 社区动态发布前填写 |
| [29a-community-result.png](images/29a-community-result.png) | 动态发布成功后的详情 |
| [30-admin-login.png](images/30-admin-login.png) | 管理端完整登录页，字段为空 |
| [31-admin-password.png](images/31-admin-password.png) | 首次登录安全设置表单；完成过实际改密后重拍空表单 |
| [32-admin-dashboard.png](images/32-admin-dashboard.png) | 工作台真实局部错误提示 |
| [33-admin-users.png](images/33-admin-users.png) | 已替换为修复后列表，不再是崩溃页面 |
| [34-admin-notifications.png](images/34-admin-notifications.png) | 已替换为修复后安全降级页面；不是群发成功证据 |
| [35-admin-ai-config.png](images/35-admin-ai-config.png) | 旧配置与策略顶部，密钥为空 |
| [36-admin-ai-draft.png](images/36-admin-ai-draft.png) | 草稿保存后重新加载的系统提示词 |

## 5. 复验与文档维护规则

1. 使用新的隔离数据环境，不修改现有用户数据库，不对生产用户发通知。
2. 保留真实错误，不用拦截改写响应或只补零的方式制造“正常”截图。
3. 成功须核对实际结果；写入有歧义时先查结果，避免重复提交。
4. 重拍图 33、34 后需同步正文说明，不能保留旧版“整页崩溃”的操作图注。
5. 只有完成真实设备和外部服务验收后，才把对应“未验证”项升级为“已验证”。
6. 临时数据库、凭据、浏览器配置和原始运行日志不纳入文档分发包。分享手册时保留 Markdown 与相对路径的 `images/` 目录结构。
