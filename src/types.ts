/**
 * 跨模块共享的类型定义。
 * 这里不 import 任何 WXT 运行时，方便在普通 TS 环境里复用。
 */

/** 朗读器的运行状态 */
export type ReaderState = 'idle' | 'loading' | 'speaking' | 'paused' | 'error';

/** 面板上展示的一份快照 */
export interface ReaderSnapshot {
  state: ReaderState;
  /** 当前帖子的 status id（取不到时为空） */
  postId: string | null;
  author: string;
  /** 最终用于朗读的 BCP-47 语种标签，如 en / zh / ja */
  lang: string;
  /** 语种是怎么判出来的，便于排查误判 */
  langSource: 'dom' | 'script' | 'cld' | 'fallback';
  /** 当前正在读的这一句 */
  sentence: string;
  sentenceIndex: number;
  sentenceCount: number;
  /** 当前句读到的字符位置，用于进度显示 */
  charIndex: number;
  /** 给用户看的提示（跳过广告、已到底等） */
  message: string;
}

/** TTS 音色（对我们的场景只暴露需要的字段） */
export interface TtsVoice {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
  isDefault: boolean;
}

/** 面板 / 快捷键发出的指令 */
export type ReaderCommand = 'toggle' | 'next' | 'prev' | 'stop';

export interface DetectLanguageMessage {
  type: 'readx:detect-language';
  text: string;
}

export interface ReaderCommandMessage {
  type: 'readx:command';
  command: ReaderCommand;
}

export interface GetStateMessage {
  type: 'readx:get-state';
}

export type RuntimeMessage =
  | DetectLanguageMessage
  | ReaderCommandMessage
  | GetStateMessage;

export interface GetStateResponse {
  ok: boolean;
  snapshot?: ReaderSnapshot;
  /** 内容脚本没注入时给出可读的原因 */
  error?: string;
}
