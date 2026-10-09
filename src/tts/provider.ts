import type { TtsVoice } from '../types';

export interface SpeakOptions {
  /** BCP-47 语种标签 */
  lang: string;
  /** 用户手动绑定的音色，优先于自动匹配 */
  voiceURI?: string;
  rate: number;
  pitch: number;
  volume: number;
  /** 逐词回调，用于进度显示 */
  onBoundary?: (charIndex: number, charLength: number) => void;
  onStart?: () => void;
  /** abort 之后 speak() 必须尽快以 'cancelled' 结束 */
  signal?: AbortSignal;
}

export type SpeakOutcome = 'ended' | 'cancelled' | 'error';

/**
 * 朗读引擎抽象。
 *
 * P1 只实现 Web Speech API；后面接 Azure / OpenAI / ElevenLabs
 * 只要再写一个实现，上层朗读队列完全不用改。
 */
/** 整段朗读时的句子进度 */
export interface SegmentProgress {
  /** 在 `segments` 里的下标 */
  index: number;
  /** 这一句里读到第几个字（用于高亮） */
  charIndex: number;
}

export interface SpeakBlockOptions extends SpeakOptions {
  /** 这段文本的句子划分；进度回调里给的是它的下标 */
  segments: string[];
  onSegment?: (progress: SegmentProgress) => void;
}

export interface TtsProvider {
  readonly name: string;
  isSupported(): boolean;
  /** 首次调用可能返回空数组，用 onVoicesChanged 等就绪 */
  getVoices(): TtsVoice[];
  onVoicesChanged(cb: (voices: TtsVoice[]) => void): () => void;
  /** 等音色列表就绪（Chrome 首次 getVoices() 常返回空） */
  ensureReady(): Promise<void>;
  speak(text: string, opts: SpeakOptions): Promise<SpeakOutcome>;
  pause(): void;
  resume(): void;
  stop(): void;
  /**
   * 该引擎为某个语言选用的音色 id。
   *
   * Web Speech 的 id 是 voiceURI，豆包的 id 是 speaker —— 上层不需要知道
   * 这个区别，只问"这个语言该用哪个音色"。返回 undefined 表示该引擎
   * 没有这个语言的音色（调用方据此降级或提示）。
   */
  voiceFor?(lang: string): string | undefined;
  /**
   * 预取提示：提前把下一段合成好。
   *
   * 对本地合成的引擎（Web Speech）没意义，但对云端引擎很关键 ——
   * 网络往返几百毫秒到几秒，不预取的话每句之间都会断一下。
   * 实现方应当把它当作 best-effort：失败静默忽略。
   */
  prefetch?(text: string, lang: string): void;
  /**
   * 是否值得**整段**朗读。
   *
   * 只有能一次请求合成整段文本的引擎才算。这个能力对云端引擎是决定性的：
   * 逐句朗读意味着 N 次网络往返、每句都等一次完整延迟，只要"合成一句的
   * 时间 > 朗读一句的时间"就必然断断续续；整段朗读只要 1 次，而且句子
   * 之间共用同一个音频文件，**段内不可能有停顿**。
   *
   * 本地引擎（Web Speech）不需要它 —— 逐句反而能拿到更细的进度。
   */
  supportsBlock?: boolean;
  /**
   * 一次请求朗读整段文本，并在播放过程中报告读到第几句。
   * 仅在 `supportsBlock` 为 true 时有意义。
   */
  speakBlock?(text: string, opts: SpeakBlockOptions): Promise<SpeakOutcome>;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
