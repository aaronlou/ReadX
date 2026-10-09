import type { TtsEngine } from '../settings';
import type { TtsVoice } from '../types';
import type { SpeakOptions, SpeakOutcome, TtsProvider } from './provider';

/**
 * 引擎切换 + 自动降级。
 *
 * 为什么需要这一层：豆包音色好听，但它有太多失败方式 —— 没填密钥、
 * 没授予域名权限、网络不通、额度用尽、音色 ID 失效。任何一种都不应该让
 * 用户面对"点了播放却什么都没有"。
 *
 * 所以：豆包失败一次就**立刻降级到系统引擎继续读**，并把原因告诉用户。
 * 降级是粘性的（不会每句都去撞一次墙），用户改了设置之后自动复位。
 */
export class TtsEngineSwitch implements TtsProvider {
  readonly name = 'engine-switch';

  /** 给 UI 报错用 */
  onError: ((message: string, hint?: string) => void) | null = null;

  private degraded = false;
  private lastEngine: TtsEngine | null = null;

  constructor(
    private readonly system: TtsProvider,
    private readonly doubao: TtsProvider,
    private readonly getEngine: () => TtsEngine,
  ) {
    const forward = (message: string, hint?: string) => this.onError?.(message, hint);
    // 子引擎的错误都往上抛，UI 只需要订阅这一个
    (this.doubao as { onError?: typeof forward }).onError = forward;
  }

  /** 当前是不是已经因为失败降级到系统引擎 */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /** 设置变了（尤其是换了引擎或音色）时调用，复位降级状态 */
  onSettingsChanged(): void {
    const engine = this.getEngine();
    if (engine !== this.lastEngine) {
      this.lastEngine = engine;
      this.degraded = false;
      // 切引擎时把两边都停掉，避免上一个引擎的音频还在响
      this.stopBoth();
    }
    // 音色/模型变了的话，豆包那边缓存的音频要作废
    (this.doubao as { invalidate?: () => void }).invalidate?.();
  }

  isSupported(): boolean {
    return this.active().isSupported();
  }

  getVoices(): TtsVoice[] {
    return this.active().getVoices();
  }

  onVoicesChanged(cb: (voices: TtsVoice[]) => void): () => void {
    return this.active().onVoicesChanged(cb);
  }

  async ensureReady(): Promise<void> {
    return this.active().ensureReady();
  }

  voiceFor(lang: string): string | undefined {
    return this.active().voiceFor?.(lang);
  }

  prefetch(text: string, lang: string): void {
    this.active().prefetch?.(text, lang);
  }

  async speak(text: string, opts: SpeakOptions): Promise<SpeakOutcome> {
    const primary = this.active();
    const outcome = await primary.speak(text, opts);

    if (
      outcome === 'error' &&
      primary === this.doubao &&
      !this.degraded &&
      !opts.signal?.aborted
    ) {
      this.degraded = true;
      this.onError?.(
        '豆包语音不可用，已临时切回系统语音',
        '到选项页检查 API Key、域名授权和余额',
      );
      return this.system.speak(text, opts);
    }

    return outcome;
  }

  pause(): void {
    this.active().pause();
  }

  resume(): void {
    this.active().resume();
  }

  stop(): void {
    this.stopBoth();
  }

  private active(): TtsProvider {
    const engine = this.getEngine();
    if (engine !== this.lastEngine) {
      // 首次调用或外部直接改了设置，这里兜一下
      this.lastEngine = engine;
      this.degraded = false;
    }
    return engine === 'doubao' && !this.degraded ? this.doubao : this.system;
  }

  /** 两个都停：切换引擎的那一刻无法确定谁在播 */
  private stopBoth(): void {
    this.system.stop();
    this.doubao.stop();
  }
}
