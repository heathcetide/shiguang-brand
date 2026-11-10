# 账号认证与恢复

本说明适用于当前源码；历史部署、里程碑记录和旧客户端不代表当前能力。

## 支持的流程

- **注册：** 邮箱、公开昵称和密码。注册邮箱不会自动视为已验证。
- **登录：** 邮箱和密码；已有手机号账号仍可使用原手机号和密码登录，不发送验证码。
- **修改密码：** 登录后验证当前密码。成功后撤销旧会话，重新登录。
- **邮箱验证：** 登录且通过当前密码复核后，验证账号已有邮箱；不提供任意邮箱首绑/换绑入口。
- **忘记密码：** 只支持已验证邮箱，验证码和短时恢复凭据一次性使用；重设成功后旧密码及旧会话失效。
- **注销普通账号：** 必须输入当前密码并确认删除。客户端不允许注销管理员账号。

短信登录/注册、手机号绑定/换绑、短信复核/找回、无密码首次设密、管理端短信配置、供应商回调和短信 notification provider 已移除。没有保留可启用这些功能的开关或 SDK。

历史无密码账号不会被自动赋予密码，也不会只凭登录 Token 开放设密或删除。已有已验证邮箱时走邮箱恢复；否则联系安装包或邀请提供者，转交管理员人工核验。人工核验不是一个绕过认证的公共 API。应在正式切换前安排这些账号的恢复渠道；本次源码变更不修改其账号行。

## 当前恢复接口

| 接口 | 身份要求 |
| --- | --- |
| `POST /api/v1/auth/email-verification/send` | 登录 Token + 当前密码 |
| `POST /api/v1/auth/email-verification/verify` | 登录 Token + challengeId/code |
| `POST /api/v1/auth/email-recovery/send` | 邮箱；回执不用于判断账号是否可恢复 |
| `POST /api/v1/auth/email-recovery/verify` | challengeId/code；仅已验证邮箱、启用账号可获恢复凭据 |
| `POST /api/v1/auth/password-recovery/reset` | recoveryToken + newPassword；channel 可省略或为 `email`，其他值拒绝 |
| `DELETE /api/v1/auth/account` | 登录 Token + password + confirmation=`DELETE` |

恢复事务核对账号、邮箱归属、验证状态、启用状态和会话版本，消费凭据与更新密码原子提交。旧手机验证码、复核凭据及旧首次设密接口不能用于当前认证。

## 邮件投递限制

- **Go 主运行时：** 开发/测试环境可用隔离数据库的本地 outbox；生产邮件投递尚未接通，相关发送明确返回 503，不能把本地 outbox 当作真实发送成功。
- **Express 可选上游：** 保留 SMTP 邮件投递实现，配置见 [server/.env.example](../server/.env.example)。缺少配置时明确不可用。Go 默认不反代 Express，配置 Express 的 SMTP 不会自动启用 Go 的生产邮件。
- `AUTH_AUDIT_ENCRYPTION_KEY` 仍用于 Express 邮箱挑战的 HMAC，不能当作已删除短信配置一起移除或随意轮换。
- 测试中的 outbox/注入发送器不是供应商真实送达证据。分发给用户前，应先验收所选运行时的邮箱投递，或提供可执行的人工恢复途径。

## 数据迁移与切换

| 运行时 | 前向迁移 |
| --- | --- |
| Go / SQLite、PostgreSQL | `003_retire_phone_verification.sql` |
| Express / SQLite | v91 `retire_phone_verification` |
| Express / PostgreSQL | Drizzle `0032_retire_phone_verification.sql` |

迁移只删除退休的验证码、复核、发送记录表及 `auth.sms.*` 配置；保留 users、原密码哈希、角色、历史联系字段、邮箱挑战与业务数据。不改写已发布的迁移或 Drizzle snapshot，历史 SQL 中的旧名称用于升级链，不是可运行的短信能力。退役负向测试和仅供演练的空历史 schema fixture 也会引用这些名称。

切换前先做可恢复备份，识别无密码且无已验证邮箱的历史账号，安排人工核验。按实际运行时执行迁移、校验 schema 后再启动新二进制/客户端；不要让仍依赖退休表的旧进程继续服务。本次开发验证不对现有本地库执行迁移，也不重启现有 :9090 服务。旧运行实例需另行切换后才会生效。
