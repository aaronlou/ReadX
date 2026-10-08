import { storage } from '#imports';

export interface ReadXSettings {
  /** 语速，0.5 ~ 2 */
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
  /** 手动绑定的音色：lang -> voiceURI */
  voiceOverrides: Record<string, string>;
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
