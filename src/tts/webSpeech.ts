import type { TtsVoice } from '../types';
import { clamp, type SpeakOptions, type SpeakOutcome, type TtsProvider } from './provider';

/**
 * 基于浏览器 Web Speech API 的朗读引擎。
 *
 * 选它的理由：零权限、免费、离线、有 onboundary 事件可以做进度。
 * 代价：音色取决于操作系统，长句会被 Chrome 截断（已在 text.ts 里按句切分规避）。
 */
export class WebSpeechProvider implements TtsProvider {
  readonly name = 'web-speech';

  private ready: Promise<void> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  isSupported(): boolean {
    return (
      typeof globalThis.speechSynthesis !== 'undefined' &&
      typeof globalThis.SpeechSynthesisUtterance !== 'undefined'
    );
  }

  getVoices(): TtsVoice[] {
    if (!this.isSupported()) return [];
    return globalThis.speechSynthesis.getVoices().map((v) => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      local: v.localService,
      isDefault: v.default,
    }));
  }

  onVoicesChanged(cb: (voices: TtsVoice[]) => void): () => void {
    if (!this.isSupported()) return () => {};
    const handler = () => cb(this.getVoices());
    globalThis.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => globalThis.speechSynthesis.removeEventListener('voiceschanged', handler);
  }

  /** Chrome 首次 getVoices() 经常返回空数组，要等 voiceschanged 事件 */
  ensureReady(timeout = 2500): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve) => {
      if (!this.isSupported()) return resolve();
      if (globalThis.speechSynthesis.getVoices().length > 0) return resolve();

      const finish = () => {
        clearTimeout(timer);
        globalThis.speechSynthesis.removeEventListener('voiceschanged', finish);
        resolve();
      };
      const timer = setTimeout(finish, timeout);
      globalThis.speechSynthesis.addEventListener('voiceschanged', finish);
    });
    return this.ready;
  }

  async speak(text: string, opts: SpeakOptions): Promise<SpeakOutcome> {
    if (!this.isSupported()) return 'error';
    await this.ensureReady();

    return new Promise<SpeakOutcome>((resolve) => {
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const done = (outcome: SpeakOutcome) => {
        if (settled) return;
        settled = true;
        if (watchdog !== null) clearTimeout(watchdog);
        opts.signal?.removeEventListener('abort', onAbort);
        this.stopKeepAlive();
        resolve(outcome);
      };

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = opts.lang;
      const voice = this.pickVoice(opts.lang, opts.voiceURI);
      if (voice) utterance.voice = voice;
      utterance.rate = clamp(opts.rate, 0.1, 10);
      utterance.pitch = clamp(opts.pitch, 0, 2);
      utterance.volume = clamp(opts.volume, 0, 1);

      utterance.onstart = () => {
        opts.onStart?.();
        this.startKeepAlive();
      };
      utterance.onboundary = (event) => opts.onBoundary?.(event.charIndex ?? 0, event.charLength ?? 0);
      utterance.onend = () => done('ended');
      utterance.onerror = (event) => {
        const reason = (event as SpeechSynthesisErrorEvent).error;
        done(reason === 'canceled' || reason === 'interrupted' ? 'cancelled' : 'error');
      };

      const onAbort = () => {
        try {
          globalThis.speechSynthesis.cancel();
        } catch {
          /* noop */
        }
        done('cancelled');
      };

      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        globalThis.speechSynthesis.speak(utterance);
      } catch (error) {
        console.warn('[ReadX] speechSynthesis.speak 失败', error);
        done('error');
        return;
      }

      // 看门狗：系统里一个可用音色都没有时（比如无头 Chrome、
      // 或者缺少对应语种的语音包），onend / onerror 可能永远不触发，
      // 没有这个超时整个朗读循环就会永久卡死。
      const estimate = Math.min(60_000, Math.max(8_000, (text.length * 350) / Math.max(0.5, opts.rate)));
      watchdog = setTimeout(() => {
        console.warn('[ReadX] 朗读超时，跳过这一句。可能是系统缺少对应语种的音色。');
        try {
          globalThis.speechSynthesis.cancel();
        } catch {
          /* noop */
        }
        done('error');
      }, estimate);
    });
  }

  pause(): void {
    if (!this.isSupported()) return;
    try {
      globalThis.speechSynthesis.pause();
    } catch {
      /* noop */
    }
  }

  resume(): void {
    if (!this.isSupported()) return;
    try {
      globalThis.speechSynthesis.resume();
    } catch {
      /* noop */
    }
  }

  stop(): void {
    if (!this.isSupported()) return;
    this.stopKeepAlive();
    try {
      globalThis.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
  }

  /**
   * 老版本 Chrome 在连续朗读约 15 秒后会自己暂停，
   * 这里定期 poke 一下把它顶回来。按句切分后大部分情况用不上，
   * 但遇到长句（比如一长串没有标点的中文）仍然救命。
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAlive = setInterval(() => {
      const synth = globalThis.speechSynthesis;
      if (!synth.speaking || synth.paused) return;
      try {
        synth.pause();
        synth.resume();
      } catch {
        /* noop */
      }
    }, 9000);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive !== null) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }

  /**
   * 音色匹配优先级：
   * 用户手动绑定 → 完全同语种地区 → 同语种的本地音色 → 同语种任意音色 → 用默认音色
   */
  private pickVoice(lang: string, voiceURI?: string): SpeechSynthesisVoice | null {
    const voices = globalThis.speechSynthesis.getVoices();
    if (!voices.length) return null;

    if (voiceURI) {
      const bound = voices.find((v) => v.voiceURI === voiceURI);
      if (bound) return bound;
    }

    const want = lang.toLowerCase().replace('_', '-');
    const base = want.split('-')[0] ?? want;
    const candidates = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base));

    return (
      candidates.find((v) => v.lang.toLowerCase().replace('_', '-') === want) ??
      candidates.find((v) => v.localService) ??
      candidates[0] ??
      null
    );
  }
}
