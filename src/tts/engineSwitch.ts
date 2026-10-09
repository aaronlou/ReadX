import { t } from '@/i18n';
import type { TtsEngine } from '../settings';
import type { TtsVoice } from '../types';
import type { SpeakBlockOptions, SpeakOptions, SpeakOutcome, TtsProvider } from './provider';

/**
 * 引擎切换 + 自动降级。
 *
 * 为什么需要这一层：云语音音色好听，但它有太多失败方式 —— 没填凭据、
 * 没授予域名权限、网络不通、额度用尽、音色 ID 失效。任何一种都不应该让
 * 用户面对"点了播放却什么都没有"。
 *
 * 所以：云语音失败一次就**立刻降级到系统引擎继续读**，并把原因告诉用户。
 * 降级是粘性的（不会每句都去撞一次墙），用户改了设置之后自动复位。
 */
export class TtsEngineSwitch implements TtsProvider {
  readonly name = 'engine-switch';

  /** 给 UI 报错用 */
  onError: ((message: string, hint?: string) => void) | null = null;

  private degraded = false;
  private lastEngine: TtsEngine | null = null;
  /**
   * 子引擎最近一次上报的具体错误。
   *
   * 必须有这个：子引擎先报「API Key 无效」，如果降级时再用一句通用的
   * 「云语音不可用」盖掉，用户就只能自己去猜是凭据、授权还是余额的问题 ——
   * 那正是我们要避免的。
   */
  private lastChildError: { message: string; hint?: string } | null = null;

  constructor(
    private readonly system: TtsProvider,
    private readonly cloud: TtsProvider,
    private readonly getEngine: () => TtsEngine,
  ) {
    // 子引擎的错误先记下来，等降级时把具体原因一起带上
    (this.cloud as { onError?: (message: string, hint?: string) => void }).onError = (
      message,
      hint,
    ) => {
      this.lastChildError = { message, hint };
    };
  }

  /** 当前是不是已经因为失败降级到系统引擎 */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * 设置变了时调用。
   *
   * **任何**设置变化都要复位降级状态，而不只是换引擎 —— 用户很可能是
   * 刚去填了 API Key 或改了音色来修问题。如果只在换引擎时复位，
   * 他填完凭据会继续听到系统语音，以为"填了也没用"。
   *
   * 复位的代价只是下一次朗读多试一次云语音，很便宜。
   */
  onSettingsChanged(): void {
    const engine = this.getEngine();
    const engineChanged = engine !== this.lastEngine;
    this.lastEngine = engine;
    this.degraded = false;
    this.lastChildError = null;

    // 切引擎时把两边都停掉，避免上一个引擎的音频还在响
    if (engineChanged) this.stopBoth();

    // 音色/服务商变了的话，云端缓存的音频要作废
    (this.cloud as { invalidate?: () => void }).invalidate?.();
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

  prefetch(text: string, lang: string, segments?: string[]): void {
    this.active().prefetch?.(text, lang, segments);
  }

  /** 当前引擎是否值得整段朗读 —— 由具体引擎决定，ReadX 上层据此选路径 */
  get supportsBlock(): boolean {
    return this.active().supportsBlock === true;
  }

  async speakBlock(text: string, opts: SpeakBlockOptions): Promise<SpeakOutcome> {
    const primary = this.active();
    if (!primary.speakBlock) {
      // 理论上不会走到这里（上层先问 supportsBlock），兜一下
      return this.speak(text, opts);
    }

    const outcome = await primary.speakBlock(text, opts);
    if (outcome === 'error') {
      const fallback = this.degrade(text, opts, primary);
      if (fallback) return fallback;
    }
    return outcome;
  }

  /**
   * 云语音失败时降级到系统引擎，并把子引擎报的具体原因带出去。
   * 返回 null 表示不该降级。
   */
  private degrade(
    text: string,
    opts: SpeakOptions,
    primary: TtsProvider,
  ): Promise<SpeakOutcome> | null {
    if (primary !== this.cloud || this.degraded || opts.signal?.aborted) return null;

    this.degraded = true;
    const detail = this.lastChildError;
    this.lastChildError = null;
    this.onError?.(
      detail
        ? t('engineSwitch_degradedWithDetail', [detail.message])
        : t('engineSwitch_degraded'),
      detail?.hint ?? t('engineSwitch_degradedHint'),
    );

    return this.system.speak(text, opts);
  }

  async speak(text: string, opts: SpeakOptions): Promise<SpeakOutcome> {
    const primary = this.active();
    const outcome = await primary.speak(text, opts);

    if (outcome === 'error') {
      const fallback = this.degrade(text, opts, primary);
      if (fallback) return fallback;
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
    return engine === 'cloud' && !this.degraded ? this.cloud : this.system;
  }

  /** 两个都停：切换引擎的那一刻无法确定谁在播 */
  private stopBoth(): void {
    this.system.stop();
    this.cloud.stop();
  }
}
