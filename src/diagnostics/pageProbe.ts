import type { AiProbeReport } from '../types';
import { probeBuiltInAi } from './probe';

/**
 * 在页面里探测内置 AI 的可用性。
 *
 * 这里只需要探测 **内容脚本自己的 realm（isolated world）** —— 那才是我们的
 * 翻译代码真正运行的地方。
 *
 * 曾经还探测过页面的 MAIN world，用来回答「万一 isolated world 拿不到
 * `Translator` 怎么办」。这个问题已经在真实 Chrome 上验证过：拿得到。
 * 所以 MAIN world 脚本、事件桥和这个探测分支全都被删掉了 ——
 * 生产包不该往 x.com 注入 MAIN world 脚本，那是没必要的信任面。
 *
 * 如果将来要复查这个结论，可以从 git 历史里取回那段实现：
 *   git show be2d8eb:src/entrypoints/main-world-probe.content.ts
 */
export function probePageContext(): Promise<AiProbeReport> {
  return probeBuiltInAi('isolated-world');
}
