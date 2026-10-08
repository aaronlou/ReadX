import { browser } from '#imports';

export interface CldLanguage {
  language: string;
  percentage: number;
}

export interface CldResult {
  isReliable: boolean;
  languages: CldLanguage[];
}

/**
 * 调用 Chrome 内置的 CLD2 语种识别。
 *
 * 两个兼容性坑：
 * 1. 不同 Chrome 版本对 Promise 形式支持不一致 → 回调形式永远可用，两手都试；
 * 2. content script 里不一定拿得到这个 API → 失败时转发给 background 再试一次。
 */
export async function detectWithCld(text: string): Promise<CldResult | null> {
  const direct = await callCldLocally(text);
  if (direct) return direct;

  try {
    const viaBackground = (await browser.runtime.sendMessage({
      type: 'readx:detect-language',
      text,
    })) as CldResult | null;
    return viaBackground ?? null;
  } catch {
    return null;
  }
}

function cldApi(): { detectLanguage: (...args: unknown[]) => unknown } | null {
  const fromBrowser = (browser as unknown as { i18n?: { detectLanguage?: unknown } }).i18n;
  if (fromBrowser && typeof fromBrowser.detectLanguage === 'function') {
    return fromBrowser as { detectLanguage: (...args: unknown[]) => unknown };
  }
  const fromChrome = (globalThis as { chrome?: { i18n?: { detectLanguage?: unknown } } }).chrome?.i18n;
  if (fromChrome && typeof fromChrome.detectLanguage === 'function') {
    return fromChrome as { detectLanguage: (...args: unknown[]) => unknown };
  }
  return null;
}

function callCldLocally(text: string): Promise<CldResult | null> {
  const api = cldApi();
  if (!api) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: unknown) => {
      if (settled) return;
      settled = true;
      resolve((result as CldResult | null) ?? null);
    };

    // 兜底超时：万一某个实现既不回调也不 resolve，别把朗读流程卡死
    setTimeout(() => done(null), 2000);

    try {
      const maybe = api.detectLanguage({ text }, done);
      if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
        (maybe as Promise<unknown>).then(done, () => done(null));
      }
    } catch {
      done(null);
    }
  });
}
