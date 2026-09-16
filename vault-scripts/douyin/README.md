---
type: tool-doc
status: active
created: 2026-09-16
tags:
  - system
  - 工具说明
  - 抖音
---

# 抖音文案提取 · 使用说明

用无头浏览器 + cookies 把抖音视频的**口播文案**抽出来，落成文字。

## 为什么不用 yt-dlp

yt-dlp 的抖音提取器**本身是坏的**。源码 `yt_tiktok.py:1503` 里作者留了 TODO：

```python
detail = traverse_obj(self._download_json(
    'https://www.douyin.com/aweme/v1/web/aweme/detail/', ...
if not detail:
    # TODO: Run verification challenge code to generate signature cookies
    raise ExtractorError('Fresh cookies (not necessarily logged in) are needed', ...)
```

它调抖音 API，但**不算 `a_bogus` 签名**。抖音的 Argus 安全插件直接挡：

```
HTTP 403  Blocked by ArgusSecurityPlugin Uifid Not Found
```

`a_bogus` 由页面 JS 生成，纯 HTTP 请求做不出来。**无头浏览器让它原生跑一遍 JS，我们从旁截获结果** —— 这是条路能走通的唯一原因。

## 一次性准备：导出 cookies

1. Chrome 装扩展 **Get cookies.txt LOCALLY**（开源、无需注册）
2. 打开并登录 `douyin.com`
3. 导出 cookies，存成 **`~/.config/douyin-cookies.txt`**

> ⚠️ 这个文件里有 `sessionid` = **账号级凭证**。脚本会 `chmod 600`，别提交进 git，别贴到公开地方。
> cookies 会过期，**过一阵子提取失败就重新导一次**。

## 用法

```bash
cd "/mnt/d/墨宇Logic的知识炼金炉/vault-scripts/douyin"
./douyin-fetch.sh "https://www.douyin.com/video/7312805110416035122"
./douyin-fetch.sh "<URL>" /自定义/工作目录     # 第二个参数可指定输出位置
```

产出（默认落在 `/tmp/douyin/<视频ID>/`）：

| 文件 | 说明 |
|---|---|
| `meta.json` | 标题 / 文案 / 作者 / 视频直链 |
| `video.mp4` | 原视频 |
| `audio.mp3` | 音轨，16k 单声道 |
| `small.mp4` | 压缩版（640px / 1fps），**喂给 AI 转写用的就是这个** |
| `transcript-prompt.txt` | 转写提示词 |

## 转写：由 agent 完成，脚本不做 ASR

脚本只负责拿到素材。转写交给 pi 的 `fetch_content`（走 Gemini 免费层）：

```
fetch_content url="file:///tmp/douyin/<ID>/small.mp4"
             prompt="$(cat /tmp/douyin/<ID>/transcript-prompt.txt)"
```

**实测效果**（12.8 分钟视频，`small.mp4` 只有 7MB）：输出逐字稿 + 要点，质量可直接用。

## 依赖

| 组件 | 状态 | 装法 |
|---|---|---|
| `node` | ✅ 已装 | — |
| `playwright-core` | ✅ 已装 | `~/.pi/agent/npm/node_modules/` |
| chromium | ✅ 已装 | `~/.cache/ms-playwright/chromium-1228` |
| `ffmpeg` | ✅ 已装 | — |
| `python3` | ✅ 已装 | 仅用于读 JSON |
| cookies | ⚠️ 需一次性导出 | 见上 |

> chromium 路径**自动探测最新版本**，版本号变了不用改脚本。
> 不用 pip、不用装 Python 包 —— 这台机器上 pip 是缺的。

## 覆盖变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `DY_COOKIES` | `~/.config/douyin-cookies.txt` | cookies 路径 |
| `DY_CHROMIUM` | 自动探测 | 指定 chromium 可执行文件 |

## 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `没取到视频直链` | cookies 过期 | 重新导出 cookies |
| 视频页打开是空白/验证码 | 触发风控 | 等几分钟再试，或换个网络 |
| `找不到 chromium` | 浏览器没装 | `npx playwright install chromium` |
| 转写太长被截断 | 视频过长 | 用 `audio.mp3` 分段喂，或改 `small.mp4` 的压缩参数 |
