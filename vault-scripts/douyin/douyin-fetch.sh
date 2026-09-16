#!/usr/bin/env bash
# 抖音视频文案提取 —— 一条命令拿到「视频 + 音频 + 文案」
#
# 用法:
#   ./douyin-fetch.sh <抖音URL> [工作目录]
#   ./douyin-fetch.sh "https://www.douyin.com/video/7312805110416035122"
#
# 产出（工作目录里）:
#   meta.json   标题 / 文案 / 作者 / 直链
#   video.mp4   原视频
#   audio.mp3   音轨（16k 单声道，喂给转写用）
#   small.mp4   压缩版（≤12MB，喂给 Gemini 做逐字稿用）
#   transcript-prompt.txt  给 AI 的转写提示词
#
# 依赖: node + playwright-core（已装）、ffmpeg（已装）、cookies（一次性导出）
# 转写由 agent 用 fetch_content 对 small.mp4 完成，脚本本身不做 ASR。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COOKIES="${DY_COOKIES:-$HOME/.config/douyin-cookies.txt}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

URL="${1:-}"
[ -z "$URL" ] && { echo "用法: $0 <抖音URL> [工作目录]"; exit 2; }

VID=$(echo "$URL" | grep -oE 'video/[0-9]+' | grep -oE '[0-9]+' || true)
[ -z "$VID" ] && VID="unknown"

WORK="${2:-/tmp/douyin/$VID}"
mkdir -p "$WORK"

# ---- 前置检查 ----
[ -f "$COOKIES" ] || { echo "❌ 找不到 cookies: $COOKIES"; echo "   Chrome 装「Get cookies.txt LOCALLY」导出 douyin.com 的 cookies 放这里"; exit 1; }
command -v ffmpeg >/dev/null || { echo "❌ 没装 ffmpeg"; exit 1; }
[ -d /home/ismoyu/.pi/agent/npm/node_modules/playwright-core ] || { echo "❌ 找不到 playwright-core"; exit 1; }

echo "══ 1/4  提取元信息（无头浏览器 + cookies）══"
node "$HERE/extract.mjs" "$URL" "$WORK/meta.json"

echo
echo "══ 2/4  下载视频 ══"
VURL=$(python3 -c "import json;print(json.load(open('$WORK/meta.json'))['videoUrl'])")
curl -sL -b "$COOKIES" -A "$UA" -H "Referer: https://www.douyin.com/" \
  -o "$WORK/video.mp4" "$VURL" \
  -w "  HTTP %{http_code}  %{size_download} 字节  %{time_total}s\n"

DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$WORK/video.mp4")
echo "  时长: ${DUR%.*} 秒"

echo
echo "══ 3/4  抽音轨 ══"
ffmpeg -v error -y -i "$WORK/video.mp4" -vn -ac 1 -ar 16000 -c:a libmp3lame -q:a 4 "$WORK/audio.mp3"
echo "  audio.mp3: $(du -h "$WORK/audio.mp3" | cut -f1)"

echo
echo "══ 4/4  压一个 Gemini 能吃的小视频 ══"
ffmpeg -v error -y -i "$WORK/video.mp4" \
  -vf "scale='min(640,iw)':-2,fps=1" -c:v libx264 -crf 32 -preset veryfast \
  -c:a aac -b:a 48k -movflags +faststart "$WORK/small.mp4"
echo "  small.mp4: $(du -h "$WORK/small.mp4" | cut -f1)"

cat > "$WORK/transcript-prompt.txt" <<'PROMPT'
这是一段抖音口播视频。请：
1. 逐字转写中文口播内容（不要总结，要原文），保留口语节奏，去掉无意义的语气词重复
2. 标出说话人讲了哪几个要点
输出格式：
【逐字稿】
（原文）

【要点】
- ...
PROMPT

echo
echo "════════ 完成 ════════"
python3 - "$WORK" <<'PY'
import json, sys, os
w = sys.argv[1]
m = json.load(open(f"{w}/meta.json"))
print(f"标题: {m['title']}")
print(f"作者: {m.get('author') or '(未取到)'}")
print(f"文案: {m.get('desc') or '(无)'}")
print(f"目录: {w}")
for f in ('video.mp4','audio.mp3','small.mp4','meta.json'):
    p = os.path.join(w,f)
    if os.path.exists(p): print(f"  {f:<20} {os.path.getsize(p)/1048576:.1f} MB")
PY
echo
echo "下一步（由 agent 执行转写）:"
echo "  fetch_content file://$WORK/small.mp4 --prompt \"\$(cat $WORK/transcript-prompt.txt)\""
