---
name: aicost-image
description: Generate and edit images using aicost.me gpt-image-2. Use for project backgrounds, illustrations, text-to-image, and reference-image edits when the user requests image generation. Includes a local Python CLI and offline configuration checks.
---

# aicost-image · gpt-image-2

从用户提供的 Cursor `aicost-image` Skill 迁入本项目，沿用文生图、参考图编辑、尺寸映射与异步轮询。调用工具是本地 Python CLI，不是对浏览器公开的业务接口。

## 服务与密钥

- Base URL：`https://www.aicost.me/v1`。
- 默认模型：`gpt-image-2`；只有用户指定其他模型时才切换。
- 认证优先读取环境变量 `AICOST_API_KEY`，否则读取本目录 `secrets.env` 中的同名变量。
- `secrets.env` 仅保存在本地，权限应为 `600`；已从 Git 和 Docker 构建上下文排除。其他机器参照 `secrets.env.example` 配置。
- 不展示、提交或记录密钥；不把它放入 `VITE_*`、`EXPO_PUBLIC_*` 或前端代码。
- 仅复制工具或检查配置时，不发起付费请求。实际生成／编辑会把提示词、参考图发送给 aicost，必须是用户已授权的内容与用途。

## 从仓库根目录调用

仅使用 Python 标准库，无需安装第三方 Python 包。路径通过脚本位置解析，不要求切换工作目录。

```bash
# 离线检查密钥能否加载：只输出 configured，不输出值、不访问网络。
python3 -I .claude/skills/aicost-image/scripts/generate.py --check

# 预览请求和输出路径：不访问网络，也不要求配置真实密钥。
python3 -I .claude/skills/aicost-image/scripts/generate.py \
  --prompt "温暖奶油色调的厨房静物，陶土餐具与自然光，无文字" \
  --aspect 16:9 --size 2K \
  --out artifacts/imagegen/background.jpg --dry-run

# 实际文生图：会调用付费接口；先在 artifacts 下审阅，再拷贝合适资产到 admin/public。
python3 -I .claude/skills/aicost-image/scripts/generate.py \
  --prompt "温暖奶油色调的厨房静物，陶土餐具与自然光，无文字" \
  --aspect 16:9 --size 2K \
  --out artifacts/imagegen/background.jpg

# 参考图编辑：可重复提供 --image。
python3 -I .claude/skills/aicost-image/scripts/generate.py \
  --prompt "保留主体与构图，改成柔和的暖色自然光" \
  --image /absolute/path/reference.png \
  --out artifacts/imagegen/edited.jpg
```

脚本结束后输出保存路径。不要把大段 base64 数据粘贴到聊天中。生成的图片是资产，不是可执行代码；需要检查画面和文件大小后再接入页面。

## 默认参数

| 参数 | 默认值 | 可选值 |
| --- | --- | --- |
| `--model` | `gpt-image-2` | 用户明确指定的模型 |
| `--aspect` | `16:9` | `1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3` |
| `--size` | `2K` | `1K`、`2K`、`4K` |
| `--format` | `jpeg` | `jpeg`、`png`、`gif` |
| `n` | `1` | 每次一张 |
| `quality` / `moderation` | `auto` | 沿用原脚本 |

GIF 仅在用户要求时使用；原工具会将默认模型切换为 `gpt-image-2.6-sunburst`。

### 尺寸映射

| | 1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 3:2 | 2:3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1K | 1024x1024 | 1536x864 | 864x1536 | 1360x1024 | 1024x1360 | 1536x1024 | 1024x1536 |
| 2K | 2048x2048 | 3072x1728 | 1728x3072 | 2720x2048 | 2048x2720 | 3072x2048 | 2048x3072 |
| 4K | 2880x2880 | 3840x2160 | 2160x3840 | 3328x2496 | 2496x3328 | 3520x2336 | 2336x3520 |

## 请求与响应

- 文生图：`POST /images/generations`，JSON 字段为 `model`、`prompt`、`n`、`size`、`quality`、`output_format`、`moderation`。
- 编辑：`POST /images/edits`，multipart 同名字段加 `image[]` 文件。服务端明确拒绝 `image[]` 字段时，才重试 `image`；不对鉴权、限流或服务器错误重复提交。
- `data[0].b64_json`：解码保存。
- `data[0].url`：使用 HTTPS 下载，不向图片下载地址附带 API 密钥。
- `task_id`：每 3 秒轮询 `/images/generations/{task_id}`，最多 10 分钟。
- 带认证的请求拒绝跨站或降级到 HTTP 的重定向，避免密钥被带往其他主机。

## 离线回归

```bash
python3 -I -m unittest discover -s .claude/skills/aicost-image/tests -v
```

回归只使用模拟 HTTP 响应与临时测试密钥，不发出真实请求、不消耗生图额度。`--check` 通过只代表本地配置可读取，不代表服务端密钥有效、账户有额度或真实生图成功。
