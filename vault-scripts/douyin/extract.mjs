// 抖音视频信息提取器 —— 用无头浏览器拿视频直链与文案
//
// 为什么需要浏览器：抖音的 aweme API 需要 a_bogus 签名（Argus 安全插件），
// 这个签名由页面 JS 生成，纯 HTTP 请求做不出来。yt-dlp 就是卡在这里
// （源码里作者留了 TODO: Run verification challenge code to generate signature cookies）。
// 浏览器让它原生跑一遍 JS，我们从旁截获结果。
//
// 用法: node extract.mjs <抖音URL> [输出json路径]

import { createRequire } from 'module';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const require = createRequire('/home/ismoyu/.pi/agent/npm/node_modules/');
const { chromium } = require('playwright-core');

// ---- 配置 ----
const COOKIES = process.env.DY_COOKIES || join(homedir(), '.config/douyin-cookies.txt');
const AUTH_JSON = process.env.DY_AUTH || '/tmp/douyin-auth.json';

/** 自动找最新的 chromium（版本号会变，不能写死） */
function findChromium() {
  if (process.env.DY_CHROMIUM) return process.env.DY_CHROMIUM;
  const base = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(base)) throw new Error(`找不到 ms-playwright 目录: ${base}`);
  const dirs = readdirSync(base)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const p = join(base, d, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
    const p2 = join(base, d, 'chrome-linux/chrome');
    if (existsSync(p2)) return p2;
  }
  throw new Error('没找到 chromium 可执行文件，先跑: npx playwright install chromium');
}

/** Netscape cookies.txt → Playwright cookie 数组 */
function loadCookies() {
  const txt = readFileSync(COOKIES, 'utf8');
  const out = [];
  for (const line of txt.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const p = line.split('\t');
    if (p.length !== 7) continue;
    out.push({
      name: p[5], value: p[6], domain: p[0], path: p[2],
      secure: p[3].toUpperCase() === 'TRUE', httpOnly: false,
      expires: p[4] && p[4] !== '0' ? Number(p[4]) : -1,
    });
  }
  return out;
}

// ---- 主流程 ----
const url = process.argv[2];
const outPath = process.argv[3] || '/tmp/douyin-meta.json';
if (!url) {
  console.error('用法: node extract.mjs <抖音URL> [输出json]');
  process.exit(2);
}

const cookies = loadCookies();
if (!cookies.length) throw new Error(`cookies 文件里没有有效条目: ${COOKIES}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: findChromium(),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const ctx = await browser.newContext({
  locale: 'zh-CN',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(cookies);

const cdnUrls = [];
const page = await ctx.newPage();
page.on('response', r => {
  const u = r.url();
  if (/douyinvod|mime_type=video_mp4/.test(u) && !cdnUrls.includes(u)) cdnUrls.push(u);
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const v = document.querySelector('video');
  const pick = sels => {
    for (const s of sels) {
      const e = document.querySelector(s);
      if (e?.innerText?.trim()) return e.innerText.trim();
    }
    return '';
  };
  return {
    title: document.title,
    videoSrc: v?.src || v?.currentSrc || '',
    desc: pick(['[data-e2e="video-desc"]', '.video-info-detail', 'h1']),
    author: pick(['[data-e2e="video-author-name"]', '.account-name']),
  };
});

await browser.close();

const meta = {
  sourceUrl: url,
  id: (url.match(/video\/(\d+)/) || [])[1] || '',
  title: info.title.replace(/\s*-\s*抖音$/, ''),
  desc: info.desc,
  author: info.author,
  videoUrl: info.videoSrc || cdnUrls[0] || '',
  cdnCount: cdnUrls.length,
  fetchedAt: new Date().toISOString(),
};

if (!meta.videoUrl) {
  console.error('❌ 没取到视频直链。可能原因：cookies 过期 / 视频已删除 / 页面结构变了');
  writeFileSync(outPath, JSON.stringify({ ...meta, error: 'no video url' }, null, 2));
  process.exit(3);
}

writeFileSync(outPath, JSON.stringify(meta, null, 2));
console.log(`标题: ${meta.title}`);
console.log(`作者: ${meta.author || '(未取到)'}`);
console.log(`文案: ${meta.desc || '(无)'}`);
console.log(`直链: 已获取 (${meta.cdnCount} 条候选)`);
console.log(`元数据: ${outPath}`);
