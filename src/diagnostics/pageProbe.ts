import type { AiProbeReport, ProbePageContextsResponse } from '../types';
import { MAIN_WORLD_REQUEST, MAIN_WORLD_RESPONSE } from './events';
import { probeBuiltInAi } from './probe';

/**
 * 在页面里探测两个 JS realm：
 *
 * - `isolated-world`：内容脚本自己的 realm —— 我们的代码真正运行的地方，**这个最关键**
 * - `main-world`：页面自己的 realm —— 如果 isolated world 用不了，这里是备选方案
 *   （代价：MAIN world 拿不到任何 `chrome.*` API，需要再用事件桥回内容脚本）
 */
export async function probePageContexts(): Promise<ProbePageContextsResponse> {
  const isolated = await probeBuiltInAi('isolated-world');
  const mainWorld = await requestMainWorldProbe();
  return { isolated, mainWorld };
}

/** 通过 DOM 事件请 MAIN world 脚本帮我们探测一次 */
function requestMainWorldProbe(timeout = 2000): Promise<AiProbeReport | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (report: AiProbeReport | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(MAIN_WORLD_RESPONSE, onResponse);
      resolve(report);
    };

    const onResponse = (event: Event) => {
      try {
        finish(JSON.parse(String((event as CustomEvent<string>).detail)) as AiProbeReport);
      } catch {
        finish(null);
      }
    };

    window.addEventListener(MAIN_WORLD_RESPONSE, onResponse);
    // 页面可能没装 MAIN world 脚本（比如在非 X 域名上），不能无限等
    setTimeout(() => finish(null), timeout);
    window.dispatchEvent(new CustomEvent(MAIN_WORLD_REQUEST));
  });
}
