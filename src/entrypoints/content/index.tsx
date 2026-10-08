import ReactDOM from 'react-dom/client';
import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { Reader } from '@/core/reader';
import { probePageContexts } from '@/diagnostics/pageProbe';
import { DEV_MATCHES, X_MATCHES } from '@/matches';
import { getSettings, watchSettings } from '@/settings';
import { ChromeTranslatorProvider } from '@/translate/chromeTranslator';
import { WebSpeechProvider } from '@/tts/webSpeech';
import type { ReaderCommand, RuntimeMessage } from '@/types';
import { Overlay } from './Overlay';
import './style.css';

export default defineContentScript({
  // 开发环境额外匹配本地 mock 时间线页面，方便不登录 X 也能调试
  matches: import.meta.env.DEV ? DEV_MATCHES : X_MATCHES,
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  async main(ctx) {
    const tts = new WebSpeechProvider();
    if (!tts.isSupported()) {
      console.warn('[ReadX] 当前浏览器没有 Web Speech API，朗读不可用（刷新页面再试）。');
    }
    await tts.ensureReady();

    const initialSettings = await getSettings();
    // 设备端翻译：需要用户手势才能下载语言包，所以只在这里实例化，由 UI 触发 prepare
    const reader = new Reader(tts, new ChromeTranslatorProvider(), initialSettings);

    // 设置变化（来自 popup 或控制条）实时同步给朗读器
    watchSettings((next) => reader.setSettings(next));

    // 用户自己滚动 / 按键 → 停止跟用户抢滚动条
    const markUserScroll = () => reader.notifyUserScroll();
    ctx.addEventListener(window, 'wheel', markUserScroll, { passive: true });
    ctx.addEventListener(window, 'touchmove', markUserScroll, { passive: true });
    ctx.addEventListener(window, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(key)) {
        markUserScroll();
      }
    });

    // X 是 SPA，换页后旧时间线的节点会被卸载，必须重置
    ctx.addEventListener(window, 'wxt:locationchange', () => reader.stop());

    browser.runtime.onMessage.addListener(
      (message: RuntimeMessage, _sender, sendResponse: (response: unknown) => void) => {
        if (message?.type === 'readx:get-state') {
          sendResponse({ ok: true, snapshot: reader.snapshot });
          return undefined;
        }
        if (message?.type === 'readx:command') {
          void handleCommand(reader, message.command);
          sendResponse({ ok: true });
          return undefined;
        }
        // 诊断页要求探测 isolated world / MAIN world 里内置 AI 的可见性
        if (message?.type === 'readx:probe-page-contexts') {
          void probePageContexts().then(sendResponse);
          return true; // 异步响应
        }
        return undefined;
      },
    );

    const ui = await createShadowRootUi(ctx, {
      name: 'readx-overlay',
      position: 'overlay',
      anchor: 'body',
      // ⚠️ WXT 的 overlay 默认不设 z-index，此时面板属于
      // "position:fixed + z-index:auto"，会被 X 侧边栏 / 顶栏这些
      // 正 z-index 的元素盖住，所以必须显式拉到最大。
      zIndex: 2147483647,
      onMount(container, _shadow, shadowHost) {
        // 宿主是 0x0 的，本身点不到；这里再兜一层，
        // 保证 x.com 上的点击依然全部穿透到原页面。
        shadowHost.style.pointerEvents = 'none';
        const root = ReactDOM.createRoot(container);
        root.render(<Overlay reader={reader} initialSettings={initialSettings} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();
  },
});

async function handleCommand(reader: Reader, command: ReaderCommand): Promise<void> {
  switch (command) {
    case 'toggle':
      return reader.toggle();
    case 'next':
      return reader.next();
    case 'prev':
      return reader.prev();
    case 'stop':
      reader.stop();
      return;
  }
}
