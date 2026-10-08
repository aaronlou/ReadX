import { defineContentScript } from '#imports';
import { MAIN_WORLD_REQUEST, MAIN_WORLD_RESPONSE } from '@/diagnostics/events';
import { probeBuiltInAi } from '@/diagnostics/probe';
import { DEV_MATCHES, X_MATCHES } from '@/matches';

/**
 * 跑在页面的 **MAIN world**（页面自己的 JS realm）里。
 *
 * 存在的理由：内置 AI API 挂在 `window` 上，而内容脚本跑在 isolated world，
 * 那些 API 在 isolated world 里是否可见并没有保证。这个脚本负责回答
 * 「万一 isolated world 用不了，MAIN world 能不能兜住」——
 * 如果能，那就是一条明确的退路：把翻译放到 MAIN world，
 * 再用 DOM 事件桥回内容脚本（就是下面这对事件名）。
 *
 * 它只做一件事：收到请求时报告一次 `typeof Translator` 之类的信息，没有任何副作用。
 */
export default defineContentScript({
  matches: import.meta.env.DEV ? DEV_MATCHES : X_MATCHES,
  world: 'MAIN',
  runAt: 'document_idle',

  main() {
    window.addEventListener(MAIN_WORLD_REQUEST, () => {
      void probeBuiltInAi('main-world').then((report) => {
        window.dispatchEvent(
          new CustomEvent(MAIN_WORLD_RESPONSE, { detail: JSON.stringify(report) }),
        );
      });
    });
  },
});
