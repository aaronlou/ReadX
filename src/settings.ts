import { storage } from '#imports';
import { DEFAULT_CLOUD_PROVIDER } from './tts/providers';

/**
 * 朗读引擎。
 *
 * - `system`：浏览器 / 系统自带的 Web Speech，零配置、离线，但音色偏机械
 * - `cloud`：云语音服务商（豆包 / OpenAI / …），音色自然得多，
 *   需要自备凭据且要联网。具体用哪家由 `cloudProvider` 决定。
 */
export type TtsEngine = 'system' | 'cloud';

export interface ReadXSettings {
  /** 语速，0.5 ~ 2（系统引擎用） */
  rate: number;
  /** 音调，0 ~ 2 */
  pitch: number;
  /** 音量，0 ~ 1 */
  volume: number;
  /** 阅读锚线：帖子顶部对齐到视口高度的百分比（0.1 ~ 0.6） */
  anchorRatio: number;
  /** 读完一条自动滚到下一条 */
  autoAdvance: boolean;
  /** 朗读前先念一遍作者名 */
  readAuthor: boolean;
  /** 跳过推广帖 */
  skipAds: boolean;
  /** 跳过纯图片 / 视频，没有文字的帖子 */
  skipMediaOnly: boolean;
  /** 系统引擎手动绑定的音色：lang -> voiceURI */
  voiceOverrides: Record<string, string>;
  /**
   * 朗读使用的语言。
   *
   * - `'auto'`：各读各的 —— 帖子是什么语言就用对应音色读原文（默认）
   * - 其它值（BCP-47 或 API 代码，如 `zh` / `ja`）：统一翻译成该语言再朗读。
   *   与帖子的语言相同时不翻译，直接读原文。
   */
  readingLang: string;
  /** 是否已经看过首次使用引导（看过之后不再显示） */
  hasSeenIntro: boolean;

  // ---------------------------------------------------------------- 朗读引擎
  /** 用哪个引擎朗读 */
  ttsEngine: TtsEngine;
  /**
   * 选中的云语音服务商 id。
   * 可选项来自 `src/tts/providers` 的注册表 —— 加服务商不需要动这里。
   */
  cloudProvider: string;
  /**
   * 各服务商的音色绑定：providerId -> { lang: voiceId }。
   * 留空则该语言用服务商 spec 里声明的默认音色。
   *
   * 注意这里**没有**凭据 —— API Key 存在 storage.local（见 src/credentials.ts），
   * 因为这个设置对象是走 sync 的。
   */
  cloudVoices: Record<string, Record<string, string>>;
}

export const DEFAULT_SETTINGS: ReadXSettings = {
  rate: 1,
  pitch: 1,
  volume: 1,
  anchorRatio: 0.25,
  autoAdvance: true,
  readAuthor: true,
  skipAds: true,
  skipMediaOnly: true,
  voiceOverrides: {},
  readingLang: 'auto',
  hasSeenIntro: false,
  ttsEngine: 'system',
  cloudProvider: DEFAULT_CLOUD_PROVIDER,
  cloudVoices: {},
};

export const settingsItem = storage.defineItem<ReadXSettings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
});

export async function getSettings(): Promise<ReadXSettings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

export async function patchSettings(patch: Partial<ReadXSettings>): Promise<void> {
  await settingsItem.setValue({ ...(await getSettings()), ...patch });
}

export function watchSettings(cb: (settings: ReadXSettings) => void): () => void {
  return settingsItem.watch((next) => cb({ ...DEFAULT_SETTINGS, ...next }));
}
