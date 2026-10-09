import { browser } from '#imports';
import type { ReadXSettings } from '../settings';
import type { DoubaoSynthesizeResponse, SubtitleSentencePayload, TtsVoice } from '../types';
import { DOUBAO_VOICES, defaultVoiceFor } from './doubaoVoices';
import type { SpeakOptions, SpeakOutcome, TtsProvider } from './provider';

/** 音频缓存上限。一段语音几十 KB，60 段大约几 MB */
const CLIP_CACHE_LIMIT = 60;

interface Clip {
  url: string;
  /** 秒，来自接口返回 */
  duration: number;
  /** 句级时间戳，可用于高亮 */
  sentences: SubtitleSentencePayload[];
}

/**
 * 豆包语音合成引擎（内容脚本侧）。
 *
 * 和 Web Speech 最大的不同：**这里产出的是音频文件，不是实时合成的语音流**。
 * 由此带来三件事：
 *   1. 必须缓存 —— 否则每次重读同一句都要再花一次钱和时间
 *   2. 必须预取 —— 网络往返是几百毫秒，不预取的话每句之间都会断
 *   3. 倍速用 `playbackRate` 而不是重新合成 —— 即时生效，也不用清缓存
 *
 * 真正的网络请求在 background 里发（内容脚本受页面 CORS 约束），
 * 这里只负责调度、缓存和播放。
 */
export class DoubaoTtsProvider implements TtsProvider {
  readonly name = 'doubao';

  /** 出错时回调，让 UI 能把原因显示出来 */
  onError: ((message: string, hint?: string) => void) | null = null;

  private readonly clips = new Map<string, Clip>();
  private readonly inflight = new Map<string, Promise<Clip>>();
  /** 已经因为降级被警告过，避免每句都弹一次 */
  private audio: HTMLAudioElement | null = null;

  constructor(private readonly getSettings: () => ReadXSettings) {}

  isSupported(): boolean {
    // 播放只需要 <audio>；能不能真的合成取决于 background + 密钥，
    // 那个由 isConfigured() 单独回答。
    return typeof Audio !== 'undefined';
  }

  getVoices(): TtsVoice[] {
    return DOUBAO_VOICES.map((voice) => ({
      uri: voice.id,
      name: `${voice.name}（${voice.scene}）`,
      lang: voice.lang,
      local: false,
      isDefault: false,
    }));
  }

  onVoicesChanged(): () => void {
    // 音色目录是静态的，不会变
    return () => {};
  }

  async ensureReady(): Promise<void> {
    // 无需预热
  }

  /** 该语言用哪个音色：用户绑定 > 内置默认 */
  voiceFor(lang: string): string | undefined {
    const bound = this.getSettings().doubaoVoices[lang];
    if (bound) return bound;
    const base = (lang || '').split('-')[0];
    if (base) {
      const boundBase = this.getSettings().doubaoVoices[base];
      if (boundBase) return boundBase;
    }
    return defaultVoiceFor(lang);
  }

  async speak(text: string, opts: SpeakOptions): Promise<SpeakOutcome> {
    if (!this.isSupported()) return 'error';

    const voice = opts.voiceURI ?? this.voiceFor(opts.lang);
    if (!voice) {
      this.onError?.(`豆包还没有支持 ${opts.lang} 的音色`, '到选项页为这个语言选一个音色');
      return 'error';
    }

    let clip: Clip;
    try {
      clip = await this.getClip(text, voice);
    } catch (error) {
      const err = error as Error & { hint?: string };
      this.onError?.(err.message, err.hint);
      return 'error';
    }

    if (opts.signal?.aborted) return 'cancelled';
    return this.play(clip, opts);
  }

  /**
   * 预取提示：等真正轮到这句时直接命中缓存。
   * 由 Reader 在朗读上一句时调用。
   */
  prefetch(text: string, lang: string): void {
    if (!this.isSupported()) return;
    const voice = this.voiceFor(lang);
    if (!voice) return;
    void this.getClip(text, voice).catch(() => {
      // 预取失败无所谓，真读到时候会再试一次
    });
  }

  pause(): void {
    this.audio?.pause();
  }

  resume(): void {
    void this.audio?.play().catch(() => undefined);
  }

  stop(): void {
    const audio = this.audio;
    if (!audio) return;
    audio.pause();
    // 清掉 src 才能打断正在缓冲的播放，否则残留的 ended 事件会串到下一次
    audio.removeAttribute('src');
    audio.load();
  }

  /** 释放所有缓存的 object URL（页面卸载或切引擎时调用） */
  dispose(): void {
    this.stop();
    for (const clip of this.clips.values()) URL.revokeObjectURL(clip.url);
    this.clips.clear();
    this.inflight.clear();
  }

  /** 清空缓存并重新合成 —— 改了音色或模型之后必须这样做 */
  invalidate(): void {
    for (const clip of this.clips.values()) URL.revokeObjectURL(clip.url);
    this.clips.clear();
    this.inflight.clear();
  }

  // ---------------------------------------------------------------- 内部

  private cacheKey(text: string, voice: string): string {
    const { doubaoModel } = this.getSettings();
    return `${voice}|${doubaoModel}|${text}`;
  }

  private getClip(text: string, voice: string): Promise<Clip> {
    const key = this.cacheKey(text, voice);

    const cached = this.clips.get(key);
    if (cached) return Promise.resolve(cached);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = this.requestClip(text, voice)
      .then((clip) => {
        this.remember(key, clip);
        return clip;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, task);
    return task;
  }

  private remember(key: string, clip: Clip): void {
    this.clips.set(key, clip);
    while (this.clips.size > CLIP_CACHE_LIMIT) {
      const oldest = this.clips.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this.clips.get(oldest);
      if (evicted) URL.revokeObjectURL(evicted.url);
      this.clips.delete(oldest);
    }
  }

  private async requestClip(text: string, voice: string): Promise<Clip> {
    const { doubaoModel } = this.getSettings();

    const response = (await browser.runtime.sendMessage({
      type: 'readx:doubao-synthesize',
      text,
      voice,
      model: doubaoModel,
      // 语速交给 playbackRate（即时生效、不用重新合成），所以这里固定 0
      speechRate: 0,
    })) as DoubaoSynthesizeResponse | undefined;

    if (!response?.ok || !response.audio) {
      const error = new Error(response?.error || '语音合成失败') as Error & { hint?: string };
      error.hint = response?.hint;
      throw error;
    }

    return {
      url: URL.createObjectURL(base64ToBlob(response.audio, response.mimeType ?? 'audio/mpeg')),
      duration: response.duration ?? 0,
      sentences: response.sentences ?? [],
    };
  }

  private play(clip: Clip, opts: SpeakOptions): Promise<SpeakOutcome> {
    return new Promise<SpeakOutcome>((resolve) => {
      const audio = this.ensureAudio();
      let settled = false;

      const done = (outcome: SpeakOutcome) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        audio.onended = null;
        audio.onerror = null;
        resolve(outcome);
      };

      const onAbort = () => {
        audio.pause();
        done('cancelled');
      };

      audio.onended = () => done('ended');
      audio.onerror = () => {
        // 主动清空 src（比如 stop()）会触发一个没有 currentSrc 的 error，忽略掉
        if (!audio.currentSrc) return;
        this.onError?.('音频播放失败');
        done('error');
      };

      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      audio.src = clip.url;
      audio.volume = Math.max(0, Math.min(1, opts.volume));
      audio.playbackRate = Math.max(0.5, Math.min(2, opts.rate));
      audio.currentTime = 0;

      opts.onStart?.();
      audio.play().catch((error: unknown) => {
        if ((error as Error)?.name === 'AbortError') return;
        this.onError?.(`音频播放被拒绝：${(error as Error).message}`, '点一下页面再试');
        done('error');
      });
    });
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;

    const audio = new Audio();
    audio.preload = 'auto';
    // 默认就保留音高；显式写出来是为了表明这是有意为之
    audio.preservesPitch = true;
    this.audio = audio;
    return audio;
  }
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
