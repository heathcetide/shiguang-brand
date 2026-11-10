# 官网部署记录（2026-10-12）

上海时间 2026-10-12 21:26，已将 main `d4cdfbb230a7a61ae09c6b226b1fc6a361cad34f` 的官网与管理端静态产物发布到 https://dietdigidose.top 。源提交的 CI 全部通过，本地重新运行 admin TypeScript/Vite 构建成功。

## 发布与验证

- 更新首页、新增 `/journal` 与 `/changelog`，发布带 Gemini 来源标注的 WebP 示意图。
- 实际挂载目录：`/opt/dietdigidose/releases/delivery-29274f43/admin-dist`；该路径为历史命名，不代表当前静态资源的源码版本。候选、105 文件清单、部署脚本与回执保存在 `/opt/dietdigidose/releases/web-d4cdfbb2/`。
- 发布前完整备份并解包逐文件校验；先更新资源、最后原子替换 `index.html`，保留旧散列资源。
- 105 个部署文件哈希一致；公网 6 个路由返回 200 且入口哈希匹配，93 个 JS/CSS/WebP 资源逐一下载并匹配哈希。浏览器确认首页、手记列表、更新日志正常显示。
- 新入口 SHA256：`7552039912db6f92e3bf0096f5fefc77cf76c3e668c0360296a7a3da0614d165`。
- `/api/v1/health` 返回 200、status ok。`/app/` 入口 SHA256 保持 `eeca7a7f721390c09406c7369b3385893aecd93a8f33d95fbfa26f4d275d324e`。
- 本次只发布静态文件，没有重启容器、修改数据库、更新 App 网页或构建 APK。短信、应用内下载和双端真机验收仍按 W42 待办跟进。

## 回退

备份目录 `/opt/dietdigidose/backups/web-d4cdfbb2` 权限 0700，包含完整旧资源、归档及 `rollback.py`。归档 SHA256：`b354796771494d5a707f6b4f1b2e145a6a48f9da6b8fcddec68c627522ab4119`。

需要回退时在服务器运行 `python3 /opt/dietdigidose/backups/web-d4cdfbb2/rollback.py`，恢复旧文件并最后原子替换入口；新增散列资源保留，不影响已打开的新版页面加载。回退后重新检查官网、管理入口及 API 健康。旧入口 SHA256：`8c18f591d7c302e582d1ebc37ffbc3038937aaa92d68719a5817f70ccbb6ed51`。
