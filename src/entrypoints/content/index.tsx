import ReactDOM from 'react-dom/client';
import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { Reader } from '@/core/reader';
import { probePageContext } from '@/diagnostics/pageProbe';
import { t } from '@/i18n';
import { DEV_MATCHES, X_MATCHES } from '@/matches';
import { getSettings, watchSettings } from '@/settings';
import { ChromeTranslatorProvider } from '@/translate/chromeTranslator';
import { CloudTtsProvider } from '@/tts/cloudTts';
import { TtsEngineSwitch } from '@/tts/engineSwitch';
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
    let settings = await getSettings();

    // 两个朗读引擎 + 自动降级。
    // 云语音音色自然得多，但失败方式也多（凭据、授权、网络、额度），
    // 所以由 TtsEngineSwitch 兜底：失败就用系统语音接着读。
    const systemTts = new WebSpeechProvider(() => settings.voiceOverrides);
    const cloudTts = new CloudTtsProvider(() => settings);
    const tts = new TtsEngineSwitch(systemTts, cloudTts, () => settings.ttsEngine);

    if (!systemTts.isSupported()) {
      console.warn(`[ReadX] ${t('content.noWebSpeech')}`);
    }
    await systemTts.ensureReady();

    // 设备端翻译：需要用户手势才能下载语言包，所以只在这里实例化，由 UI 触发 prepare
    const reader = new Reader(tts, new ChromeTranslatorProvider(), settings);

    tts.onError = (message, hint) => {
      console.warn('[ReadX]', t('content.speechEngine'), message, hint ?? '');
      const text = hint ? `${message} · ${hint}` : message;
      // 既要弹一次提示，也要在面板上留住 —— 否则用户只会觉得"声音怎么变回去了"
      reader.note(text);
      reader.setEngineWarning(text);
    };

    // 设置变化（来自 popup 或控制条）实时同步给朗读器和语音引擎
    watchSettings((next) => {
      settings = next;
      // 任何设置变化都清掉旧的降级告警：用户很可能刚去修了问题，
      // 我们再试一次。真没修好，下一次朗读会重新报出来。
      reader.setEngineWarning(null);
      tts.onSettingsChanged();
      reader.setSettings(next);
    });

    // 页面卸载时释放缓存里的音频 object URL
    ctx.onInvalidated(() => cloudTts.dispose());

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
        // 诊断页要求探测内容脚本 realm 里内置 AI 的可见性
        if (message?.type === 'readx:probe-page-contexts') {
          void probePageContext().then((isolated) => sendResponse({ isolated }));
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
        root.render(<Overlay reader={reader} initialSettings={settings} />);
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
