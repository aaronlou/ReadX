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
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
