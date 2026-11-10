> 2026-09-15：按用户要求下线数据实验室，`/data-lab*` 返回 HTTP 410，独立服务已停止并移除。数据文件和已接入的业务数据保留；App 网页版继续运行。下文保留历史部署说明。
>
> 业务接入说明见 [RUNTIME-INTEGRATION.md](RUNTIME-INTEGRATION.md)。

# 概念数据测试入口

原地址（已关闭）：https://dietdigidose.top/data-lab/

使用现有管理后台登录状态（adminToken），每次数据请求都经现有 `/api/v1/auth/me` 验证管理员身份。未登录401、非管理员403。静态页面不包含数据。源JSON和压缩包没有公开下载路由。

## 当前部署

- 日期：2026-09-15
- 数据版本：concept-base-1.0.0-rc.2
- 主机：118.145.165.226
- 发布目录：`/opt/dietdigidose/concept-data/releases/concept-base-1.0.0-rc.2`
- Compose项目：`dietdigidose-concept-data`
- 服务：`dietdigidose-concept-data-concept-data-1`
- 使用已有镜像：`dietdigidose-server:6ba7d9e`，独立Node进程、非root、只读挂载、不开放宿主机端口。
- 原反向代理备份：`/opt/dietdigidose/backups/concept-data-20260915T062549Z`

新入口只读浏览概念、食材形态、菜谱做法、厨具需求、TFDA条件关联和CN6候选原值。没有向现有业务数据库导入数据，也没有启用候选营养自动计算；现有App业务目录仍使用原有数据。

## 代理与升级

现有Caddy域名内，在普通API处理之前增加：

```caddyfile
handle /data-lab* {
    reverse_proxy concept-data:9091
}
```

当前Caddy配置挂载自历史主站发布目录；以后升级主站时要保留此路由，并保留独立Compose服务。新服务不需要主站JWT密钥或数据库凭据，直接复用身份验证API。

更新数据时创建新发布目录，核验ZIP和manifest，在独立目录执行Compose更新；不要覆盖运行中的数据文件。数据服务启动时验证完整manifest，错误立即失败。

## 验证

本地：`node --test deploy/concept-data/server.test.mjs`，8项通过。

服务器已验证：数据服务healthy；管理员经公网HTTPS读取版本和1677条CN6食品统计成功；匿名读取数据返回401；现有 `/api/v1/health` 与 `/admin` 返回200。
服务器权限验证只使用短时内存令牌，没有存储或输出令牌，没有修改用户或会话数据。

## 回退

从备份目录的 `config-path.txt` 确认原Caddyfile路径，将 `Caddyfile.before` 内容写回该文件，验证Caddy配置后重启Caddy。当前bind mount需要原文件原位写回，不能靠重命名替换inode。
然后运行该发布目录的Compose `down` 停止独立数据服务。无需回滚数据库，因为没有业务数据库变更。
