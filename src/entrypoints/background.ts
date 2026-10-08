import { browser, defineBackground } from '#imports';
import type { CldResult } from '@/lang/cld';
import type { ReaderCommand, RuntimeMessage } from '@/types';

/** 快捷键 → 朗读指令 */
const COMMAND_MAP: Record<string, ReaderCommand> = {
  'toggle-reading': 'toggle',
  'next-post': 'next',
  'prev-post': 'prev',
};

export default defineBackground(() => {
  // ---------------------------------------------------------- 快捷键
  browser.commands.onCommand.addListener(async (command) => {
    const mapped = COMMAND_MAP[command];
    if (!mapped) return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await browser.tabs.sendMessage(tab.id, {
        type: 'readx:command',
        command: mapped,
      } satisfies RuntimeMessage);
    } catch {
      // 当前标签页没有注入内容脚本（不是 x.com），静默忽略
    }
  });

  // ---------------------------------------------------------- 语种识别兜底
  // 部分 Chrome 版本里 content script 拿不到 chrome.i18n.detectLanguage，
  // 这里在扩展上下文里再试一次。
  browser.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse: (response: unknown) => void) => {
      if (message?.type !== 'readx:detect-language') return undefined;

      detectLanguageInExtension(message.text)
        .then(sendResponse)
        .catch(() => sendResponse(null));

      // 告诉 Chrome 我们会异步调用 sendResponse
      return true;
    },
  );
});

function detectLanguageInExtension(text: string): Promise<CldResult | null> {
  const i18n = (globalThis as { chrome?: { i18n?: { detectLanguage?: unknown } } }).chrome?.i18n;
  if (!i18n || typeof i18n.detectLanguage !== 'function') return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: unknown) => {
      if (settled) return;
      settled = true;
      resolve((result as CldResult | null) ?? null);
    };
    setTimeout(() => done(null), 2000);

    try {
      const maybe = (
        i18n.detectLanguage as (d: { text: string }, cb: (r: unknown) => void) => unknown
      )({ text }, done);
      if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
        (maybe as Promise<unknown>).then(done, () => done(null));
      }
    } catch {
      done(null);
    }
  });
}
