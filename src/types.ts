/**
 * 跨模块共享的类型定义。
 * 这里不 import 任何 WXT 运行时，方便在普通 TS 环境里复用。
 */

/** 朗读器的运行状态 */
export type ReaderState =
  | 'idle'
  | 'loading'
  | 'speaking'
  | 'paused'
  | 'error'
  /** 当前帖子需要翻译，但语言包还没下载，等用户手势触发 */
  | 'need-language-pack';

/** 待下载的语言包 */
export interface PendingLanguagePack {
  /** Translator API 代码，如 'en' */
  from: string;
  /** 同上，如 'zh' */
  to: string;
}

/** 面板上展示的一份快照 */
export interface ReaderSnapshot {
  state: ReaderState;
  /** 当前帖子的 status id（取不到时为空） */
  postId: string | null;
  author: string;
  /** 实际用于朗读的语种：翻译开启时是目标语言 */
  lang: string;
  /** 语种是怎么判出来的，便于排查误判 */
  langSource: 'dom' | 'script' | 'cld' | 'fallback';
  /** 这条帖子被翻译过的话，这里是原文语言；否则为 null */
  translatedFrom: string | null;
  /** 当前正在读的这一句 */
  sentence: string;
  sentenceIndex: number;
  sentenceCount: number;
  /** 当前句读到的字符位置，用于进度显示 */
  charIndex: number;
  /** 给用户看的提示（跳过广告、已到底等） */
  message: string;
  /** 非 null 时表示需要用户点一下才能下载语言包 */
  pendingPack: PendingLanguagePack | null;
  /** 语言包下载进度 0~1；null 表示当前没在下载 */
  packProgress: number | null;
  /**
   * 语音引擎的**持久**告警（比如云语音失败已降级到系统语音）。
   *
   * 和 `message` 分开是必要的：message 会被下一条状态更新冲掉，
   * 而"我明明启用了云语音，听到的却是机器音"这种情况必须一直看得见 ——
   * 否则用户根本不知道该去设置页看一眼。
   */
  engineWarning: string | null;
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

// ---------------------------------------------------------------- 能力探测

/**
 * 探测发生在哪个 JS realm。
 *
 * 曾经还有 `'main-world'`（页面的 realm）。它当初用来回答「万一内容脚本的
 * isolated world 拿不到内置 AI 怎么办」，这个问题已经有答案了，那条探测路径
 * 连同 MAIN world 脚本一起删掉了。
 */
export type ProbeContext = 'isolated-world' | 'extension-page';

export interface AiProbeReport {
  context: ProbeContext;
  url: string;
  chromeVersion: string;
  secureContext: boolean;
  /** 各个内置 AI 全局对象的存在形态：'function' / 'undefined' … */
  globals: Record<string, string>;
  translatorAvailability: string;
  languageDetectorAvailability: string;
  at: string;
}

/** 内容脚本所在 realm 的探测报告 */
export interface ProbePageContextsResponse {
  isolated: AiProbeReport;
}

export interface TabProbeResult {
  tabId: number;
  isolated: AiProbeReport | null;
}

// ---------------------------------------------------------------- 消息协议

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

/** 扩展页面 → 内容脚本：在 isolated world + MAIN world 各探测一次 */
export interface ProbePageContextsMessage {
  type: 'readx:probe-page-contexts';
}

/** 扩展页面 → background：广播到所有标签页，收集页面上下文的探测结果 */
export interface ProbeAllTabsMessage {
  type: 'readx:probe-all-tabs';
}

// ---------------------------------------------------------------- 云语音

export type { SubtitleSentence } from './tts/providers/types';
import type { SubtitleSentence } from './tts/providers/types';

/**
 * 内容脚本 → background：用某个服务商合成一段语音。
 *
 * 为什么必须绕到 background：内容脚本的跨域请求受**页面 CORS** 约束，
 * 而扩展的 service worker 有 host_permissions 就能直接发。凭据也只存在
 * background 能读到的地方，内容脚本不碰。
 *
 * 这里刻意只传 `providerId` 而不是整个 spec —— 具体怎么发请求由
 * background 按注册表查出来的 spec 决定，加服务商不用改消息协议。
 */
export interface CloudTtsSynthesizeMessage {
  type: 'readx:cloud-tts-synthesize';
  providerId: string;
  text: string;
  voice: string;
}

export interface CloudTtsSynthesizeResponse {
  ok: boolean;
  /** base64 音频（二进制响应在服务商实现里已就地转换） */
  audio?: string;
  mimeType?: string;
  /** 秒 */
  duration?: number;
  sentences?: SubtitleSentence[];
  error?: string;
  /** 用户能直接照做的提示 */
  hint?: string;
}

export type RuntimeMessage =
  | DetectLanguageMessage
  | ReaderCommandMessage
  | GetStateMessage
  | ProbePageContextsMessage
  | ProbeAllTabsMessage
  | CloudTtsSynthesizeMessage;

export interface GetStateResponse {
  ok: boolean;
  snapshot?: ReaderSnapshot;
  /** 内容脚本没注入时给出可读的原因 */
  error?: string;
}
