#!/usr/bin/env node
/**
 * 用 CDP 给商店截屏。
 *
 * 为什么要有这个：Chrome Web Store 要求 1280×800 的截图，手动截很难保证
 * 尺寸精确、状态一致、可重复。这里用 headless=new + DevTools Protocol 自动化：
 * 加载扩展 → 打开 mock 时间线 → 触发播放 → 截图。
 *
 *   npm run shoot
 *
 * 用的是 Node 内置的 WebSocket（Node 22+），不引入 puppeteer —— 只为截几张图
 * 不值得给项目加一个几百 MB 的依赖树。
 *
 * 前置：mock 服务在 5174 跑着（`npm run mock`）。扩展用的是 **screenshot 模式**
 * 的构建产物（`.output/chrome-mv3-screenshot`），它额外匹配 localhost；
 * 正式包不受影响。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'store', 'screenshots');
const PROFILE = join(ROOT, '.shot-profile');
const EXTENSION = join(ROOT, '.output', 'chrome-mv3-screenshot');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const MOCK = 'http://localhost:5174/mock-timeline.html';

const WIDTH = 1280;
const HEIGHT = 800;

const keep = process.argv.includes('--keep');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP 小客户端

class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();

  static async attach(wsUrl) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener('open', resolve, { once: true });
      cdp.#ws.addEventListener('error', reject, { once: true });
    });
    cdp.#ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const waiter = cdp.#pending.get(msg.id);
      if (!waiter) return;
      cdp.#pending.delete(msg.id);
      msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? '页面里抛错了');
    }
    return result.result.value;
  }

  close() {
    this.#ws.close();
  }
}

/** 轮询直到表达式为真 —— 比固定 sleep 稳得多 */
async function waitFor(cdp, expression, { timeout = 15000, label = expression } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cdp.eval(expression)) return true;
    await sleep(200);
  }
  console.warn(`  ⚠️  等待超时：${label}`);
  return false;
}

const listTargets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();

async function shoot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ✓ ${name}.png`);
}

// ---------------------------------------------------------------- 主流程

async function main() {
  if (!existsSync(EXTENSION)) {
    console.error(`找不到截图构建产物：${EXTENSION}\n先跑 \`npm run shoot\`（它会自动构建），或 \`npx wxt build -m screenshot\`。`);
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(join(PROFILE, 'crash'), { recursive: true });

  console.log('启动 headless Chrome（加载扩展）…');
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      // 这三条是必需的：不加的话 Chrome 会试着往工作区外写崩溃转储，
      // 被沙箱挡住之后整个进程直接崩掉，报的错完全看不出原因
      '--disable-crash-reporter',
      '--disable-breakpad',
      `--crash-dumps-dir=${join(PROFILE, 'crash')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      // 固定英文：按钮的 title/aria-label 走 i18n，用英文才好可靠地选中
      '--lang=en-US',
      `--user-data-dir=${PROFILE}`,
      `--load-extension=${EXTENSION}`,
      `--remote-debugging-port=${PORT}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  );

  for (let i = 0; i < 40; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      break;
    } catch {
      await sleep(250);
    }
  }

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page');
  const cdp = await Cdp.attach(page.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  try {
    console.log('打开 mock 时间线…');
    await cdp.send('Page.navigate', { url: MOCK });
    await waitFor(cdp, 'document.readyState === "complete"', { label: '页面加载' });

    const injected = await waitFor(cdp, '!!document.querySelector("readx-overlay")', {
      label: '扩展注入',
      timeout: 8000,
    });
    console.log(`  扩展已注入：${injected}`);

    await sleep(1200);
    await shoot(cdp, '01-timeline');

    // 点播放：按钮的 aria-label 来自 i18n，英文下一定含 "Play"
    const clicked = await cdp.eval(`
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        if (!root) return false;
        const btn = [...root.querySelectorAll('button')]
          .find((b) => /play|pause/i.test(b.getAttribute('aria-label') || b.title || ''));
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    console.log(`  已触发播放：${clicked}`);
    await sleep(2600);
    await shoot(cdp, '02-reading');

    // 引导卡：只在首次使用时出现，重开一个干净的 profile 才能稳定复现
    await cdp.eval(`
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        const btn = [...(root?.querySelectorAll('button') ?? [])]
          .find((b) => /got it|dismiss/i.test(b.textContent || ''));
        return !!btn;
      })()
    `);

    // 设置页：扩展 id 从 service worker 的 target URL 里取
    const worker = targets.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
    const extId = worker?.url.split('/')[2];
    if (extId) {
      console.log('打开设置页…');
      await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options.html` });
      await waitFor(cdp, 'document.readyState === "complete"', { label: '设置页加载' });
      await sleep(1200);
      await shoot(cdp, '03-settings');
    } else {
      console.warn('  ⚠️  拿不到扩展 id，跳过设置页截图');
    }
  } finally {
    cdp.close();
    if (!keep) {
      try {
        process.kill(-chrome.pid);
      } catch {
        /* 已经退了 */
      }
    }
  }

  console.log(`\n截图在 store/screenshots/（${WIDTH}×${HEIGHT}）`);
}

main().catch((error) => {
  console.error('截图失败：', error.message);
  process.exit(1);
});
