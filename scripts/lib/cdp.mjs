/**
 * 截图脚本和冒烟测试共用的 CDP 工具。
 *
 * 抽出来是因为两边都要处理同一批坑（`--load-extension` 被忽略、
 * Chrome 崩溃转储、等 CDP 起来），各写一份必然漂移。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP 客户端

export class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #handlers = new Map();

  static async attach(wsUrl) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener('open', resolve, { once: true });
      cdp.#ws.addEventListener('error', reject, { once: true });
    });
    cdp.#ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method) {
        for (const handler of cdp.#handlers.get(msg.method) ?? []) handler(msg.params);
        return;
      }
      const waiter = cdp.#pending.get(msg.id);
      if (!waiter) return;
      cdp.#pending.delete(msg.id);
      msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
    });
    return cdp;
  }

  /** 订阅 CDP 事件（比如 Runtime.consoleAPICalled） */
  on(method, handler) {
    if (!this.#handlers.has(method)) this.#handlers.set(method, new Set());
    this.#handlers.get(method).add(handler);
  }

  /** 注意：这里**剥掉了外层信封**，直接 resolve 的是 `result` 本身 */
  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面里跑一段表达式，返回它的值；页面抛错会在这里抛出来 */
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

/** 轮询直到表达式为真。返回 true/false 而不是抛错，让调用方决定怎么报 */
export async function waitFor(cdp, expression, { timeout = 15000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await cdp.eval(expression)) return true;
    } catch {
      /* 页面还没就绪，继续等 */
    }
    await sleep(interval);
  }
  return false;
}

// ---------------------------------------------------------------- 启动与装载

/**
 * 起一个 headless Chrome 并把扩展装进去。
 *
 * ⚠️ 两个非显然的点：
 *
 * 1. **不能用 `--load-extension`。** Chrome 137+ 把它静默忽略了 —— 不报错、
 *    不警告，只是扩展根本没加载，然后你会花很久去查"为什么内容脚本没注入"。
 *    改用 CDP 的 `Extensions.loadUnpacked`（需要 --enable-unsafe-extension-debugging）。
 *
 * 2. **必须禁掉崩溃上报。** 否则 Chrome 会试着往工作区外写崩溃转储，
 *    被沙箱挡住之后整个进程直接崩，日志里的报错和真实原因毫无关系。
 */
export async function launchWithExtension({
  port,
  profile,
  extensionPath,
  width = 1280,
  height = 800,
}) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(join(profile, 'crash'), { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-crash-reporter',
      '--disable-breakpad',
      `--crash-dumps-dir=${join(profile, 'crash')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  );

  let version = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error('Chrome 的 CDP 没起来');

  const browser = await Cdp.attach(version.webSocketDebuggerUrl);
  const loaded = await browser.send('Extensions.loadUnpacked', { path: extensionPath });
  browser.close();

  if (!loaded?.id) throw new Error('扩展装载失败（拿不到 id）');

  return {
    chrome,
    extId: loaded.id,
    /** 关掉整个进程组 */
    async close() {
      try {
        process.kill(-chrome.pid);
      } catch {
        /* 已经退了 */
      }
      await sleep(400);
    },
  };
}

/** 连到页面 target，并把视口固定成商店要求的尺寸 */
export async function attachToPage(port, { width = 1280, height = 800 } = {}) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = await Cdp.attach(page.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return cdp;
}

/**
 * 收集页面里的错误，供冒烟测试断言"没有报错"。
 *
 * 两条来源都要接：`Runtime.exceptionThrown` 是未捕获异常，
 * `Log.entryAdded` 是 console.error 之类。只接一个会漏。
 */
export function collectErrors(cdp) {
  const errors = [];

  cdp.on('Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails;
    errors.push(d?.exception?.description ?? d?.text ?? '未捕获异常');
  });
  cdp.on('Log.entryAdded', (params) => {
    const entry = params.entry;
    if (entry?.level !== 'error') return;
    // favicon 缺失是噪音：mock 页面本来就没放图标，每个页面都会报一条，
    // 混在里面会把真正的 404 淹掉
    if (entry.url?.endsWith('/favicon.ico')) return;
    // 带上 URL —— 只说"404"没法定位是哪个资源
    const where = entry.url ? ` (${entry.url})` : '';
    errors.push(`${entry.text ?? 'console error'}${where}`);
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    errors.push(params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });

  return errors;
}

export async function enableLogging(cdp) {
  await cdp.send('Log.enable');
}
