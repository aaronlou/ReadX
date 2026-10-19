#!/usr/bin/env node
/**
 * 用**真的**本地 TTS 服务做一次端到端验证。
 *
 *   node scripts/verify-local-tts.mjs                       # 默认 http://localhost:8880/v1
 *   node scripts/verify-local-tts.mjs --url http://localhost:5000/v1
 *   node scripts/verify-local-tts.mjs --lang en             # 英文界面
 *
 * 和 `npm run smoke` 的区别：
 *   smoke 用的是 `scripts/mock-tts.mjs`（假服务），能验接口形状和链路，
 *   但验不了**真的模型**——音色 ID 存不存在、音频能不能解码、会不会出声。
 *   这个脚本要你去 `docker run` 一个真服务，然后用真音频跑一遍。
 *
 * 判断"真的出声了"的方式不是看状态文字（那只是状态机说的），而是看
 * **句子计数器有没有自动推进**——它只在前一段音频播完（`ended` 事件）
 * 之后才会变。音频没解码成功 / 没出声，就会永远卡在第 1 句。
 *
 * ⚠️ 音频元素是 `new Audio()` 创建的**游离元素**，从不插进 DOM，
 * 所以 `document.querySelectorAll('audio')` 是查不到的，别用那种方式判断。
 */
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachToPage, ensureMockServer, launchWithExtension, sleep, waitFor } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const BUILD = join(ROOT, '.output', 'chrome-mv3-screenshot');
const STAGING = join(ROOT, '.verify-ext');
const PROFILE = join(ROOT, '.verify-profile');
const PORT = 9345;
const MOCK = 'http://localhost:5174/mock-timeline.html';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const BASE_URL = arg('url', 'http://localhost:8880/v1');
const LOCALE = arg('lang', 'zh');

/** 控制条上的文案（只取叶子节点，避开注入的 <style>） */
const OVERLAY_TEXT = `
  (() => {
    const root = document.querySelector('readx-overlay')?.shadowRoot;
    if (!root) return null;
    return [...root.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && !/^(STYLE|SCRIPT)$/.test(el.tagName))
      .map((el) => el.textContent ?? '')
      .join(' ')
      .replace(/\\s+/g, ' ')
      .trim();
  })()
`;

const clickIn = (pattern) => `
  (() => {
    const root = document.querySelector('readx-overlay')?.shadowRoot;
    const button = [...(root?.querySelectorAll('button') ?? [])].find((b) =>
      ${pattern}.test(b.getAttribute('aria-label') || b.title || b.textContent || ''));
    if (!button) return 'notfound';
    button.click();
    return 'clicked';
  })()
`;

function sentenceIndex(text) {
  const match = (text ?? '').match(/第\s*(\d+)\s*\/\s*\d+\s*句|Post\s*(\d+)\s*of\s*\d+/);
  return match ? Number(match[1] ?? match[2]) : null;
}

async function main() {
  if (!existsSync(BUILD)) {
    console.error(`找不到截图构建产物。先跑 npm run build:screenshot 或 npm run shoot。`);
    process.exit(1);
  }

  // 服务在不在，先说清楚
  const base = BASE_URL.replace(/\/+$/, '');
  let voices = [];
  try {
    const response = await fetch(`${base}/audio/voices`);
    if (response.ok) {
      const data = await response.json();
      voices = (data.voices ?? []).map((v) => v.id ?? v);
    }
  } catch {
    console.error(`连不上 ${base} —— 服务启动了吗？`);
    console.error('  Kokoro-FastAPI: docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest');
    process.exit(1);
  }
  console.log(`  服务: ${base}（${voices.length} 个音色）`);

  rmSync(STAGING, { recursive: true, force: true });
  cpSync(BUILD, STAGING, { recursive: true });
  if (LOCALE === 'en') rmSync(join(STAGING, '_locales', 'zh_CN'), { recursive: true, force: true });

  const mock = await ensureMockServer(ROOT);
  const { extId, close } = await launchWithExtension({
    port: PORT,
    profile: PROFILE,
    extensionPath: STAGING,
    width: 1280,
    height: 800,
  });
  const cdp = await attachToPage(PORT, { width: 1280, height: 800 });

  let failed = false;
  const check = (condition, label) => {
    console.log(`  ${condition ? '✓' : '✗'} ${label}`);
    if (!condition) failed = true;
  };

  try {
    // 指向真服务
    await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options.html` });
    await waitFor(cdp, 'document.readyState === "complete"');
    await sleep(900);
    await cdp.eval(`(async () => {
      const current = (await chrome.storage.sync.get('settings')).settings ?? {};
      await chrome.storage.sync.set({
        settings: { ...current, ttsEngine: 'cloud', cloudProvider: 'local' },
      });
      await chrome.storage.local.set({
        cloudCredentials: { local: { baseUrl: ${JSON.stringify(BASE_URL)} } },
      });
      return true;
    })()`);
    check(true, `已把朗读引擎指向 ${base}`);

    await cdp.send('Page.navigate', { url: MOCK });
    await waitFor(cdp, 'document.readyState === "complete"');
    await waitFor(cdp, '!!document.querySelector("readx-overlay")', { timeout: 8000 });
    await sleep(1200);
    await cdp.eval(clickIn('/got it|知道了|明白了/i'));
    await sleep(400);

    check((await cdp.eval(clickIn('/play|播放|暂停|pause/i'))) === 'clicked', '点了播放');

    // CPU 推理要时间，给足
    let speaking = false;
    for (let i = 0; i < 20; i += 1) {
      await sleep(1500);
      const text = await cdp.eval(OVERLAY_TEXT);
      if (/speaking|reading|朗读中/i.test(text ?? '')) {
        speaking = true;
        break;
      }
    }
    check(speaking, '进入朗读状态');

    // 硬证据：句子计数器自动推进 = 音频真的播完了
    const started = sentenceIndex(await cdp.eval(OVERLAY_TEXT));
    let advanced = false;
    if (started !== null) {
      for (let i = 0; i < 20; i += 1) {
        await sleep(1500);
        const next = sentenceIndex(await cdp.eval(OVERLAY_TEXT));
        if (next !== null && next > started) {
          advanced = true;
          break;
        }
      }
    }
    check(advanced, `音频真的播完了（句子从第 ${started ?? '?'} 句自动推进）`);

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const shot = join(ROOT, '.output', 'verify-local-tts.png');
    writeFileSync(shot, Buffer.from(data, 'base64'));
    console.log(`\n  截图: ${shot}`);
  } finally {
    cdp.close();
    await close();
    rmSync(PROFILE, { recursive: true, force: true });
    rmSync(STAGING, { recursive: true, force: true });
    if (mock) {
      try {
        process.kill(-mock.pid);
      } catch {
        /* 已经退了 */
      }
    }
  }

  console.log(failed ? '\n  ✗ 有检查没通过' : '\n  ✓ 本地语音服务可用');
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('验证失败：', error.message);
  process.exit(1);
});
