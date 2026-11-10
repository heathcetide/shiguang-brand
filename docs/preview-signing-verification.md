# Preview 签名验证

## 2026-09-12 构建证据（历史）

2026-09-12 读取 GitHub Actions 成功运行日志，当时 HTTPS preview 已替代旧 preview-http：

| 运行 | 提交 | 日志中的profile及包名 | APK签名SHA-256 |
| --- | --- | --- | --- |
| [34490933958](https://github.com/AdlinZ/DietDigiDose/actions/runs/34490933958) | `865987cc2206bbdbcb4b725a64e128d4123cd1d4` | `preview` / `com.dietdigidose.app.preview` | `0c7b482180d86c3022a5295bdcfc02065b599ff4d5d96186149c52f07596590c` |
| [34143161394](https://github.com/AdlinZ/DietDigiDose/actions/runs/34143161394) | `ead90af3e462f4d15ccbd5938425b982d682521e` | `preview` / `com.dietdigidose.app.preview` | `0c7b482180d86c3022a5295bdcfc02065b599ff4d5d96186149c52f07596590c` |

两次`apksigner verify --verbose --print-certs`输出一致，且不同于工作流锁定的release摘要`7473251630e89fbad819b5193c07b857b3ac5b64244551c1bbad55460fbe9cd2`。这些是历史构建日志证据，不是当前开发分支的候选包验证，也不是设备覆盖安装证明。

当时核对的 `android-preview` Environment 中已存在preview keystore、密码、alias四项Secret和摘要变量。验收只读取配置名称，不导出私钥或密码。

## 构建门槛

工作流恢复持久preview密钥后，用`keytool -exportcert`导出公开证书，密码通过`-storepass:env`传入，不出现在命令参数中。`client/scripts/verify-preview-certificate.mjs`验证：

- 证书SHA-256与固定preview摘要一致。
- preview证书与release固定摘要不同。
- 当前时间处于有效期内，且剩余有效期至少365天。

脚本仅输出公开摘要、起止日期和有效期门槛。构建后继续由apksigner验证实际APK签名，apkanalyzer核对包名及构建号。有效期失败时不得通过自动生成新密钥绕过检查；需另行制定保持覆盖升级兼容性的处理方案。

`pnpm test:release`包含公开测试证书的规则回归。测试证书不是实际preview证书，仓库不含对应私钥，其有效期不代表真实签名有效期。

## 后续每个候选仍需提供的验收证据

以下是验收要求，不代表最新候选已完成或未完成；实际结果见[状态导航](status.md)。

- 在实际preview证书上运行新增有效期检查并保留构建输出。
- 真机上不卸载、不清数据安装下一版，核对账户和本地数据保持。
- iOS/Android同提交candidate产物与完整真机核心闭环。

2026-09-12 本机检查时 `adb`不在PATH，`xcrun devicectl`不可用；尚未获取可执行真机验收的设备入口。没有为本次校验触发构建、分配快照编号或改变签名Secret。
