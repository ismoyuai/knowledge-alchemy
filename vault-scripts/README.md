---
type: system-doc
status: active
tags:
  - system
  - 目录说明
---

# vault-scripts ·【脚本层】

自动化工具集（rss_tool.py、search.py 等）

| | |
|---|---|
| **什么进来** | 自动化脚本 |
| **什么出去** | 被流程调用 |
| **验证方式** | 每个工具都有自己的 README |

## 现有工具

| 工具 | 作用 | 说明 |
|---|---|---|
| `douyin/` | 抖音视频 → 口播逐字稿 | 无头浏览器 + cookies 拿直链，ffmpeg 抽音轨，Gemini 转写。见 `douyin/README.md` |

> 规则全文见根目录 `AGENTS.md`。本文件只说明这个目录自己的职责。
