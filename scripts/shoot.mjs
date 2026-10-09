#!/usr/bin/env node
/**
 * 用 CDP 自动截商店要的图。
 *
 *   npm run shoot                  # 中英两套
 *   node scripts/shoot.mjs en      # 只出英文那套
 *
 * Chrome Web Store 的 listing 可以**按语言分别上传截图**，所以这里出两套：
 *   store/screenshots/en/   ← 给英文 listing
 *   store/screenshots/zh/   ← 给中文 listing
 *
 * 为什么需要自动化：商店要求 1280×800，手动截很难保证尺寸精确、状态一致、
 * 可重复。这里用 headless=new + DevTools Protocol 跑完整流程。
 *
 * 两个踩过的坑，都写在对应代码处：
 *   1. `--load-extension` 在 Chrome 137+ 被**静默忽略**，必须用 CDP 的
 *      `Extensions.loadUnpacked`
 *   2. macOS 上 Chrome 忽略 `--lang`，扩展语言跟系统走。要出英文图只能
 *      **把 zh_CN 语言包从构建里删掉**，逼它回落到 default locale
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = join(ROOT, 'store', 'screenshots');
const BUILD = join(ROOT, '.output', 'chrome-mv3-screenshot');
const PROFILE = join(ROOT, '.shot-profile');
const STAGING = join(ROOT, '.shot-extension');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const MOCK = 'http://localhost:5174/mock-timeline.html';

const WIDTH = 1280;
const HEIGHT = 800;

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

  /** 注意：这里**剥掉了外层信封**，直接 resolve 的是 `result` 本身 */
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

// ---------------------------------------------------------------- 单次拍摄

async function capture({ locale, stripLocales, extIdRef }) {
  const outDir = join(SHOTS, locale);
  mkdirSync(outDir, { recursive: true });

  // 准备这次要加载的扩展副本
  rmSync(STAGING, { recursive: true, force: true });
  cpSync(BUILD, STAGING, { recursive: true });
  for (const extra of stripLocales) {
    rmSync(join(STAGING, '_locales', extra), { recursive: true, force: true });
  }

  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(join(PROFILE, 'crash'), { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      // 不加这三条的话 Chrome 会往工作区外写崩溃转储，被沙箱挡住后
      // 整个进程直接崩，报的错完全看不出原因
      '--disable-crash-reporter',
      '--disable-breakpad',
      `--crash-dumps-dir=${join(PROFILE, 'crash')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${PROFILE}`,
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

  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await Cdp.attach(version.webSocketDebuggerUrl);
  const loaded = await browser.send('Extensions.loadUnpacked', { path: STAGING });
  browser.close();
  const extId = loaded?.id;
  if (!extId) throw new Error('装载扩展失败（没拿到 id）');
  extIdRef.value = extId;

  const targets = await listTargets();
  const cdp = await Cdp.attach(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const shoot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`  ✓ ${locale}/${name}.png`);
  };

  try {
    await cdp.send('Page.navigate', { url: MOCK });
    await waitFor(cdp, 'document.readyState === "complete"', { label: '页面加载' });

    const injected = await waitFor(cdp, '!!document.querySelector("readx-overlay")', {
      label: '扩展注入',
      timeout: 8000,
    });
    if (!injected) console.warn('  ⚠️  扩展没注入，截图里不会有控制条');

    await sleep(1500);
    // 隐藏 mock 页面自己的说明横幅 —— 它是给开发者看的调试提示，
    // 出现在商店截图里会显得像个测试页面
    await cdp.eval(`
      (() => {
        const b = document.querySelector('.banner');
        if (b) b.style.display = 'none';
        return !!b;
      })()
    `);
    await sleep(400);

    // 引导卡（首次使用的提示）—— 本身也是一张有价值的说明图
    await shoot('01-intro');

    // 关掉引导卡，点播放，截"正在朗读"那张
    await cdp.eval(`
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        const btn = [...(root?.querySelectorAll('button') ?? [])]
          .find((b) => /got it|知道了|明白了/i.test(b.textContent || ''));
        btn?.click();
        return !!btn;
      })()
    `);
    await sleep(600);

    const played = await cdp.eval(`
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        if (!root) return false;
        const btn = [...root.querySelectorAll('button')]
          .find((b) => /play|pause|播放|暂停/i.test(b.getAttribute('aria-label') || b.title || ''));
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    console.log(`  已触发播放：${played}`);
    await sleep(3000);
    await shoot('02-reading');

    // 设置页
    await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options.html` });
    await waitFor(cdp, 'document.readyState === "complete"', { label: '设置页加载' });
    await sleep(1800);
    await shoot('03-settings');
  } finally {
    cdp.close();
    try {
      process.kill(-chrome.pid);
    } catch {
      /* 已经退了 */
    }
    await sleep(500);
  }
}

// ---------------------------------------------------------------- 主流程

async function main() {
  if (!existsSync(BUILD)) {
    console.error(`找不到截图构建产物：${BUILD}\n先跑 \`npx wxt build -m screenshot\`。`);
    process.exit(1);
  }

  const only = process.argv[2];
  const extIdRef = { value: '' };

  // 英文：删掉 zh_CN，强制回落到 default locale。
  // 中文：语言包不动 —— 这台机器的系统语言是 zh-CN，Chrome 自然选中文。
  const runs = [
    { locale: 'zh', stripLocales: [] },
    { locale: 'en', stripLocales: ['zh_CN'] },
  ].filter((r) => !only || r.locale === only);

  for (const run of runs) {
    console.log(`\n[${run.locale}] 启动 headless Chrome…`);
    await capture({ ...run, extIdRef });
  }

  rmSync(STAGING, { recursive: true, force: true });

  console.log(`\n截图在 store/screenshots/（${WIDTH}×${HEIGHT}）`);
  console.log('  上传时：英文 listing 用 en/，中文 listing 用 zh/');
}

main().catch((error) => {
  console.error('截图失败：', error.message);
  process.exit(1);
});
