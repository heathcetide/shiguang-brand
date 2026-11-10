# W41：自助找回密码与 Android 应用更新

> 2026-10-11：#221/#219 随其余未完成事项结转至 [W42](milestone-26w42-progress.md)；以下保留 W41 实现记录，两项仍待部署和真实验收。

2026-10-07：[#221](https://github.com/AdlinZ/DietDigiDose/issues/221)、[#219](https://github.com/AdlinZ/DietDigiDose/issues/219) 已加入 [W41](milestone-26w41-progress.md)。本记录区分仓库实现、部署配置和实际验收，Issue 保持开放。

## #221 自助找回密码

登录页的“忘记密码”进入 `/forgot-password`：输入已绑定手机号 → 验证短信 → 设置新密码 → 返回登录。恢复凭据仅在页面内存中保留，重设后所有旧登录会话失效。暂不支持邮箱恢复；历史邮箱没有可信的所有权验证，不能直接用其注册记录授权重设。无可用绑定手机时，页面明确引导联系安装包或邀请的提供者进行人工核验。

匿名接口位于 `/api/v1/auth/password-recovery/send`、`verify`、`reset`。复用现有阿里云号码认证、短信挑战、限流和身份复核存储；短信必须由实际提供商接受后才能返回成功。合法手机号的发送回执不区分账号存在、未验证或停用；只有发送时已经验证绑定的启用账号能取得恢复凭据。

验证码与登录/已登录复核分用途；恢复 token 使用独立哈希域，5 分钟有效。事务内重新检查账号、绑定手机号、启用状态和会话版本，一次性消费凭据、更新密码并递增会话版本。复用现有表，不新增 migration。密码登录也按已验证的密码哈希与会话版本条件更新，阻止重设前开始的旧密码请求取得新会话。

仍需在隔离环境启用现有 SMS 配置，使用明确授权的测试号码验证送达、过期/错误验证码、重设、新旧密码及旧会话、限流和提供商失败。测试中的假提供商不是短信送达证据。邮箱恢复、绑定/换绑及供应商正式开通按其原范围继续跟踪。

## #219 Android 完整 APK 更新

一期复用现有 HTTPS API 和周版本机制，新增启动后的非阻塞检查及“关于食光烙记”页手动入口。自动检查与“稍后再说”间隔 24 小时；失败会显示无法检查，不能误报最新版。iOS、Web、Expo Go 和未包含原生模块的旧包不提供 APK 安装；旧 APK 必须先手动升级到包含此模块的新包。

更新清单按 **原生 applicationId + channel + versionCode** 匹配。渠道为 `preview`、`candidate`、`production`，candidate 与 production 即使包名相同也不得混发。原生模块从已安装 APK 读取身份、渠道和下载来源，OTA 的 JS 配置不能替代安装版本。

下载使用 Android 流式文件写入和 SHA-256，核对大小、哈希、真实包名、版本、渠道和签名；支持取消、重试和空间不足提示。只接受包内白名单中的 HTTPS origin，不跟随重定向。安装前重新查询推荐版本，再校验本地文件，撤下/替代的版本不得启动安装。来源权限由 Android 设置页授予，返回后再次点击安装，由系统最终确认；取消系统安装不会被描述为已升级。

### 配置

1. 准备受控、稳定、无需登录且不重定向的 HTTPS APK 地址；不要用会过期的 Actions artifact URL。
2. **实际构建前**设置 `EXPO_PUBLIC_APK_DOWNLOAD_ORIGINS`，例如 `https://downloads.example.com`；多个 origin 用逗号分隔，不含路径、查询或凭据。GitHub Android 工作流从环境变量 `APK_DOWNLOAD_ORIGINS` 注入。插件将来源、渠道与 snapshot 写入 AndroidManifest。
3. 在 API 环境设置 `APP_UPDATE_MANIFEST_PATH`（容器内清单文件路径）与 `APP_UPDATE_ALLOWED_ORIGINS`（同一组 HTTPS origin）。清单目录使用受限、只读的目录挂载，运行时不能由客户端写入；应挂载目录，避免单文件 bind mount 无法看到原子替换的新 inode。
4. 未配置、文件损坏或来源不符时，`GET /api/v1/app-updates` 返回 503；有效清单中没有该渠道的更高版本时返回 `{ "update": null }`。显式空 `releases` 数组表示暂无推荐版本。

可在现有 staging Compose 的部署覆盖文件中，为 `api` 添加如下挂载（路径由部署者实际选定，勿把密钥或备份放入此目录）：

```yaml
services:
  api:
    environment:
      APP_UPDATE_MANIFEST_PATH: /app-updates/manifest.json
    volumes:
      - /srv/dietdigidose/app-updates:/app-updates:ro
```

### 发布与撤下

Android 工作流通过现有签名、包名和版本检查后，在 APK artifact 同时保留该次 `release.json` 和 `build-identity.json`。后续发布必须使用**对应构建产物内**的元数据，不能拿当前检出目录的旧 `release.json` 代替。一次实际新打包只分配一次编号；生成清单和检查更新不分配编号。

先上传签名 APK，再运行现有工具链中的 `apkanalyzer`、`apksigner` 及以下发布命令。`UPDATE_CERT_SHA256` 必须来自受信任渠道配置，不能临时从待发布 APK 自行取一个指纹当作信任依据；APK 签名、原生渠道/snapshot/版本、公开下载的大小和 SHA-256 全部一致后才生成清单。

```sh
pnpm --dir server release:android:manifest \
  --apk "${UPDATE_APK:?指定签名 APK}" \
  --url "${UPDATE_APK_URL:?指定公开 HTTPS APK 地址}" \
  --application-id "${UPDATE_APPLICATION_ID:?指定该渠道包名}" \
  --channel "${UPDATE_CHANNEL:?指定 preview/candidate/production}" \
  --release-file "${UPDATE_RELEASE_METADATA:?指定该构建的 release.json}" \
  --notes-file "${UPDATE_NOTES:?指定 UTF-8 更新说明}" \
  --certificate-sha256 "${UPDATE_CERT_SHA256:?指定渠道证书指纹}" \
  --previous "${UPDATE_CURRENT_MANIFEST:?指定当前完整清单}" \
  --output "${UPDATE_NEXT_MANIFEST:?指定尚不存在的新文件}"
```

各文件变量使用绝对路径，因为 `pnpm --dir server` 会切换命令工作目录。首次发布没有当前清单时省略 `--previous`；已有清单时必须提供，以保留其他渠道。工具支持 `APKANALYZER` / `APKSIGNER` 环境变量或同名小写 CLI 参数指定可执行文件位置。它拒绝旧版本覆盖和同构建编号重新发布，写出新文件而不修改原文件。退出成功后再由发布者核对清单，以原子 rename 激活为 API 指定路径；文件权限须允许 API 读取，保留原清单作为发布证据。

撤下渠道推荐使用：

```sh
pnpm --dir server release:android:manifest --revoke \
  --application-id "${UPDATE_APPLICATION_ID:?指定包名}" \
  --channel "${UPDATE_CHANNEL:?指定渠道}" \
  --previous "${UPDATE_CURRENT_MANIFEST:?指定当前完整清单}" \
  --output "${UPDATE_NEXT_MANIFEST:?指定尚不存在的新文件}"
```

核对并原子激活新清单后，该渠道不再推荐已撤下版本，其他渠道保留。已有安装不自动降级；二期 Expo 热更新没有在这轮实施。

## 验证边界

仓库内自动化覆盖恢复凭据隔离/过期/并发/吊销及登录竞态，更新身份/渠道/版本筛选、无效清单、下载校验、取消、撤下、权限返回和构建配置。服务端清单上限与生成工具共用 1 MiB 限制。

经用户授权，已在临时 SDK 36 / build-tools 36.0.0 / NDK 27.1.12297006 环境使用 JDK 17 执行 `:apk-updates:compileReleaseKotlin` 并通过。实际编译发现并修复 Expo 模块缺少库版本信息的问题；该库版本不影响应用 `release.json`。没有执行 assemble、生成 APK、发布或分配编号。

仍需完整候选包与真机验证：首次/手动检查、断网、取消/重试、来源授权、签名不符、同签名覆盖升级、登录与本地数据保留，以及实际分发网络的可达性。模块编译成功不等于完整应用打包或安装验收通过。最终工作区检查及证据路径见 [W41 进度](milestone-26w41-progress.md)。
