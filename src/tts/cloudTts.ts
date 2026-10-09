import { browser } from '#imports';
import { joinSegments } from '../core/text';
import type { ReadXSettings } from '../settings';
import type { CloudTtsSynthesizeResponse, TtsVoice } from '../types';
import { findCloudProvider, resolveVoice, type CloudTtsSpec } from './providers';
import type { SpeakBlockOptions, SpeakOptions, SpeakOutcome, TtsProvider } from './provider';

/** 音频缓存上限。一段语音几十 KB，60 段大约几 MB */
const CLIP_CACHE_LIMIT = 60;

/**
 * 排队等合成槽位的预取上限。
 *
 * 超了就丢弃新的 —— 预取本来就是 best-effort，而且队排太长只会让
 * **真正要读的句子**排在过时的预取后面，反而更卡。
 */
const MAX_QUEUED_PREFETCH = 4;

/** 真正要读的句子 vs 后台预取 —— 前者永远优先 */
type Priority = 'speak' | 'prefetch';

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

  /**
   * 云端引擎一律走**整段朗读**。
   *
   * 这是这类服务唯一可行的做法：逐句朗读意味着一条帖子 N 次网络往返、
   * 每句都等一次完整延迟，只要"合成一句的时间 > 朗读一句的时间"就必然
   * 断断续续 —— 调预取是治不好的。整段朗读只要 1 次请求，而且句子之间
   * 共用同一个音频文件，**段内不可能有停顿**。
   */
  readonly supportsBlock = true;

  /** 出错时回调，让 UI 能把原因显示出来 */
  onError: ((message: string, hint?: string) => void) | null = null;

  private readonly clips = new Map<string, Clip>();
  private readonly inflight = new Map<string, Promise<Clip>>();
  private audio: HTMLAudioElement | null = null;

  /** 正在飞的合成请求数 */
  private active = 0;
  /**
   * 等合成槽位的队列，读的句子和预取分开排。
   *
   * 这个队列是**必需品**，不是优化：服务商对并发数有配额（豆包超了会
   * 直接返回 `quota exceeded for types: concurrency`）。我们一次会预取
   * 好几句，不自己排队就一定会撞上去。
   */
  private readonly speakQueue: Array<() => void> = [];
  private readonly prefetchQueue: Array<() => void> = [];

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
      clip = await this.getClip(spec, text, voice, 'speak');
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
    // 队伍已经太长就别再排了，否则会把真正要读的句子堵在后面
    if (this.prefetchQueue.length >= MAX_QUEUED_PREFETCH) {
      console.debug('[ReadX] 预取队伍已满，跳过', preview(text));
      return;
    }

    const voice = this.voiceFor(lang);
    if (!voice) return;
    // 已经缓存或在合成中的就不用再发了
    if (this.clips.has(this.cacheKey(spec, text, voice))) return;

    console.debug('[ReadX] 预取 →', preview(text));
    void this.getClip(spec, text, voice, 'prefetch').catch(() => {
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

  private getClip(
    spec: CloudTtsSpec,
    text: string,
    voice: string,
    priority: Priority,
  ): Promise<Clip> {
    const key = this.cacheKey(spec, text, voice);

    // 先查缓存：命中就不该占用合成槽位，更不该排队
    const cached = this.clips.get(key);
    if (cached) {
      console.debug('[ReadX] 命中缓存 ·', preview(text));
      return Promise.resolve(cached);
    }

    // 同一段文本已经在合成/排队 → 共用那一个 promise，绝不重复请求
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = (async () => {
      await this.acquire(priority);
      try {
        const clip = await this.requestClip(spec, text, voice);
        this.remember(key, clip);
        return clip;
      } finally {
        this.releaseSlot();
      }
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, task);
    return task;
  }

  /** 占一个合成槽位；满了就在对应优先级的队列里等 */
  private async acquire(priority: Priority): Promise<void> {
    const limit = Math.max(1, this.spec?.maxConcurrency ?? 2);
    if (this.active < limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      (priority === 'speak' ? this.speakQueue : this.prefetchQueue).push(resolve);
    });
    this.active += 1;
  }

  private releaseSlot(): void {
    this.active -= 1;
    // 真正要读的句子永远插在预取前面
    const next = this.speakQueue.shift() ?? this.prefetchQueue.shift();
    next?.();
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

  /**
   * 一次请求朗读整段文本。
   *
   * 超长帖子会按服务商的单次上限切成几段 —— 段与段之间仍可能有一次
   * 往返的停顿，但 2048 字大约相当于 40 句，正常帖子根本碰不到。
   */
  async speakBlock(text: string, opts: SpeakBlockOptions): Promise<SpeakOutcome> {
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

    const chunks = chunkSegments(spec.maxChars, opts.segments, text);
    let indexOffset = 0;

    for (const chunk of chunks) {
      if (opts.signal?.aborted) return 'cancelled';

      let clip: Clip;
      try {
        clip = await this.getClip(spec, chunk.text, voice, 'speak');
      } catch (error) {
        const err = error as Error & { hint?: string };
        this.onError?.(err.message, err.hint);
        return 'error';
      }

      if (opts.signal?.aborted) return 'cancelled';

      const outcome = await this.playSegments(clip, chunk.segments, indexOffset, opts);
      if (outcome !== 'ended') return outcome;
      indexOffset += chunk.segments.length;
    }

    return 'ended';
  }

  /**
   * 播放一段音频，并在过程中把"读到第几句、第几个字"报上去。
   *
   * 时间轴优先用服务商返回的句级时间戳（豆包会给），拿不到就按字数比例估算。
   * 两者都只影响高亮的精度，不影响播放本身。
   */
  private playSegments(
    clip: Clip,
    segments: string[],
    indexOffset: number,
    opts: SpeakBlockOptions,
  ): Promise<SpeakOutcome> {
    return new Promise<SpeakOutcome>((resolve) => {
      const audio = this.ensureAudio();
      let settled = false;
      let timeline: TimelineEntry[] | null = null;

      const done = (outcome: SpeakOutcome) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        audio.removeEventListener('timeupdate', onTime);
        audio.onended = null;
        audio.onerror = null;
        resolve(outcome);
      };

      const ensureTimeline = (): TimelineEntry[] => {
        if (timeline) return timeline;
        // 浏览器加载完元数据后拿到的 duration 比接口返回的更可靠
        const duration =
          Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : clip.duration;
        timeline = buildTimeline(segments, clip.sentences, duration);
        return timeline;
      };

      const onTime = () => {
        const line = ensureTimeline();
        const index = indexAt(line, audio.currentTime);
        const entry = line[index];
        if (!entry) return;

        // 用这一句的时间跨度估出读到第几个字，高亮才能跟着走
        const span = entry.end - entry.start;
        const ratio = span > 0 ? (audio.currentTime - entry.start) / span : 0;
        const charIndex = Math.round(Math.min(1, Math.max(0, ratio)) * entry.text.length);

        opts.onSegment?.({ index: indexOffset + index, charIndex });
      };

      const onAbort = () => {
        audio.pause();
        done('cancelled');
      };

      audio.onended = () => done('ended');
      audio.onerror = () => {
        if (!audio.currentSrc) return;
        this.onError?.('音频播放失败');
        done('error');
      };

      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      audio.addEventListener('timeupdate', onTime);

      audio.src = clip.url;
      audio.volume = Math.max(0, Math.min(1, opts.volume));
      audio.playbackRate = Math.max(0.5, Math.min(2, opts.rate));
      audio.currentTime = 0;

      // 先报第一句，别让面板在音频真正出声前还停在上一条
      opts.onSegment?.({ index: indexOffset, charIndex: 0 });

      opts.onStart?.();
      audio.play().catch((error: unknown) => {
        if ((error as Error)?.name === 'AbortError') return;
        this.onError?.(`音频播放被拒绝：${(error as Error).message}`, '点一下页面再试');
        done('error');
      });
    });
  }

  private async requestClip(spec: CloudTtsSpec, text: string, voice: string): Promise<Clip> {
    const startedAt = performance.now();

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

    const clip: Clip = {
      url: URL.createObjectURL(base64ToBlob(response.audio, response.mimeType ?? 'audio/mpeg')),
      duration: response.duration ?? 0,
      sentences: response.sentences ?? [],
    };

    // 合成耗时 vs 音频时长是判断"能不能跟上"的唯一依据：
    // 只要前者持续大于后者，逐句朗读就必然断，怎么调预取都没用。
    // 这条日志就是用来一眼看出该走哪条路的。
    const seconds = (performance.now() - startedAt) / 1000;
    console.debug(
      `[ReadX] 合成 ${seconds.toFixed(2)}s · 音频 ${clip.duration.toFixed(2)}s · ${text.length} 字 · ${preview(text)}`,
      clip.duration > 0 && seconds > clip.duration ? '⚠️ 合成比朗读慢' : '',
    );

    return clip;
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

// ---------------------------------------------------------------- 整段朗读的辅助

/** 日志里用的短预览 —— 够认出是哪一段就行，不刷屏 */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return `"${flat.slice(0, 16)}${flat.length > 16 ? '…' : ''}"`;
}

/** 按服务商的单次文本上限把句子切成几块 */
function chunkSegments(
  maxChars: number,
  segments: string[],
  fallbackText: string,
): Array<{ text: string; segments: string[] }> {
  // 调用方偶尔直接给整段文本而不给句子划分，那就原样当一块
  if (!segments.length) return [{ text: fallbackText, segments: [fallbackText] }];

  const chunks: Array<{ text: string; segments: string[] }> = [];
  let current: string[] = [];

  for (const segment of segments) {
    const candidate = current.length ? joinSegments([...current, segment]) : segment;
    if (current.length && candidate.length > maxChars) {
      chunks.push({ text: joinSegments(current), segments: current });
      current = [segment];
    } else {
      current.push(segment);
    }
  }
  if (current.length) chunks.push({ text: joinSegments(current), segments: current });
  return chunks;
}

interface TimelineEntry {
  start: number;
  end: number;
  text: string;
}

/**
 * 算出每一句在音频里的起止时间（秒）。
 *
 * 优先用服务商返回的句级时间戳（豆包会给，而且很准）；
 * 数量和我们的切句对不上、或者干脆没有（OpenAI / OpenRouter）时，
 * 退化成按字数比例估算 —— 只影响高亮精度，不影响播放。
 */
function buildTimeline(
  segments: string[],
  sentences: Array<{ start_time: number; end_time: number }>,
  duration: number,
): TimelineEntry[] {
  if (sentences.length === segments.length && duration > 0) {
    // 接口可能用毫秒（豆包历史上两种都出现过），用总时长反推一下单位
    const last = sentences[sentences.length - 1]?.end_time ?? 0;
    const scale = last > duration * 1.5 ? 1 / 1000 : 1;
    return segments.map((text, i) => ({
      text,
      start: (sentences[i]?.start_time ?? 0) * scale,
      end: (sentences[i]?.end_time ?? 0) * scale,
    }));
  }

  // 退化路径：按字数比例切分。分隔符也会占用时间，所以用真实偏移算。
  const total = joinSegments(segments).length || 1;
  const out: TimelineEntry[] = [];
  let offset = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const text = segments[i]!;
    if (i > 0 && !/[。！？!?.;；:：,，、\s]$/.test(out[i - 1]!.text)) offset += 1;
    const start = (offset / total) * duration;
    offset += text.length;
    const end = (offset / total) * duration;
    out.push({ text, start, end });
  }
  return out;
}

/** 当前时间落在第几句 */
function indexAt(timeline: TimelineEntry[], time: number): number {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (time >= timeline[i]!.start) return i;
  }
  return 0;
}
