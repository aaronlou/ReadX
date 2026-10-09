import { browser } from '#imports';
import type { ReadXSettings } from '../settings';
import type { CloudTtsSynthesizeResponse, TtsVoice } from '../types';
import { findCloudProvider, resolveVoice, type CloudTtsSpec } from './providers';
import type { SpeakOptions, SpeakOutcome, TtsProvider } from './provider';

/** 音频缓存上限。一段语音几十 KB，60 段大约几 MB */
const CLIP_CACHE_LIMIT = 60;

interface Clip {
  url: string;
  /** 秒 */
  duration: number;
  /** 句级时间戳，为后续高亮预留 */
  sentences: Array<{ start_time: number; end_time: number; text: string }>;
}

type CloudConfig = Pick<ReadXSettings, 'cloudProvider' | 'cloudVoices'>;

/**
 * 云语音引擎（内容脚本侧）—— 对**所有**服务商统一实现。
 *
 * 它不关心背后是豆包还是 OpenAI：音色从 spec 读，请求发给 background
 * 由对应 spec 处理。加新服务商时这个文件一行都不用改。
 *
 * 和 Web Speech 最大的不同：这里产出的是音频文件，不是实时语音流。由此：
 *   1. 必须缓存 —— 否则重读同一句要再花一次钱和时间
 *   2. 必须预取 —— 网络往返几百毫秒，不预取每句之间都会断
 *   3. 倍速用 playbackRate —— 即时生效，也不用清缓存
 *
 * 真正的网络请求在 background 里发（内容脚本受页面 CORS 约束），
 * 这里只负责调度、缓存和播放。
 */
export class CloudTtsProvider implements TtsProvider {
  readonly name = 'cloud-tts';

  /** 出错时回调，让 UI 能把原因显示出来 */
  onError: ((message: string, hint?: string) => void) | null = null;

  private readonly clips = new Map<string, Clip>();
  private readonly inflight = new Map<string, Promise<Clip>>();
  private audio: HTMLAudioElement | null = null;

  constructor(private readonly getConfig: () => CloudConfig) {}

  /** 当前选中的服务商；配置里写了一个不存在的 id 时返回 undefined */
  get spec(): CloudTtsSpec | undefined {
    return findCloudProvider(this.getConfig().cloudProvider);
  }

  isSupported(): boolean {
    // 播放只需要 <audio>；能不能真的合成取决于 background + 凭据，
    // 那个由凭据是否填全单独回答。
    return typeof Audio !== 'undefined';
  }

  getVoices(): TtsVoice[] {
    const spec = this.spec;
    if (!spec) return [];
    return spec.voices.map((voice) => ({
      uri: voice.id,
      name: voice.note ? `${voice.name} · ${voice.note}` : voice.name,
      lang: voice.lang ?? '',
      local: false,
      isDefault: false,
    }));
  }

  onVoicesChanged(): () => void {
    // 音色目录来自内置的 spec，不会变
    return () => {};
  }

  async ensureReady(): Promise<void> {
    // 无需预热
  }

  /** 该语言用哪个音色：用户绑定 > spec 里该语言的默认 > spec 的兜底 */
  voiceFor(lang: string): string | undefined {
    const spec = this.spec;
    if (!spec) return undefined;
    const bound = this.getConfig().cloudVoices[spec.id] ?? {};
    return resolveVoice(spec, lang, bound);
  }

  async speak(text: string, opts: SpeakOptions): Promise<SpeakOutcome> {
    if (!this.isSupported()) return 'error';

    const spec = this.spec;
    if (!spec) {
      this.onError?.(`未知的语音服务商：${this.getConfig().cloudProvider}`, '到选项页重新选一个');
      return 'error';
    }

    const voice = opts.voiceURI ?? this.voiceFor(opts.lang);
    if (!voice) {
      this.onError?.(
        `${spec.name} 还没有可用于 ${opts.lang} 的音色`,
        '到选项页为这个语言选一个音色',
      );
      return 'error';
    }

    let clip: Clip;
    try {
      clip = await this.getClip(spec, text, voice);
    } catch (error) {
      const err = error as Error & { hint?: string };
      this.onError?.(err.message, err.hint);
      return 'error';
    }

    if (opts.signal?.aborted) return 'cancelled';
    return this.play(clip, opts);
  }

  /** 预取提示：等真正轮到这句时直接命中缓存 */
  prefetch(text: string, lang: string): void {
    const spec = this.spec;
    if (!spec || !this.isSupported()) return;
    const voice = this.voiceFor(lang);
    if (!voice) return;
    void this.getClip(spec, text, voice).catch(() => {
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

  /** 释放所有缓存的 object URL（页面卸载时调用） */
  dispose(): void {
    this.stop();
    this.releaseClips();
  }

  /** 作废缓存（换了服务商或音色之后必须这样做） */
  invalidate(): void {
    this.releaseClips();
  }

  // ---------------------------------------------------------------- 内部

  private releaseClips(): void {
    for (const clip of this.clips.values()) URL.revokeObjectURL(clip.url);
    this.clips.clear();
    this.inflight.clear();
  }

  private cacheKey(spec: CloudTtsSpec, text: string, voice: string): string {
    // 服务商也要进 key —— 换服务商后同一个音色 id 可能指向完全不同的东西
    return `${spec.id}|${voice}|${text}`;
  }

  private getClip(spec: CloudTtsSpec, text: string, voice: string): Promise<Clip> {
    const key = this.cacheKey(spec, text, voice);

    const cached = this.clips.get(key);
    if (cached) return Promise.resolve(cached);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = this.requestClip(spec, text, voice)
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

  private async requestClip(spec: CloudTtsSpec, text: string, voice: string): Promise<Clip> {
    const response = (await browser.runtime.sendMessage({
      type: 'readx:cloud-tts-synthesize',
      providerId: spec.id,
      text,
      voice,
    })) as CloudTtsSynthesizeResponse | undefined;

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
