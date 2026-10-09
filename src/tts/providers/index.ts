import { doubaoSpec } from './doubao';
import { openaiSpec } from './openai';
import type { CloudTtsSpec } from './types';

/**
 * 云语音服务商注册表。
 *
 * **加一家新的服务商 = 写一个 spec 文件 + 在这里加一行。**
 * 设置项、background 的分发、设置面板的输入框、域名权限申请
 * 全都是从这份注册表读出来的，不需要改别的地方。
 *
 * 写新 spec 时的要点见 providers/types.ts 里 `CloudTtsSpec` 的注释。
 */
export const CLOUD_TTS_PROVIDERS: CloudTtsSpec[] = [doubaoSpec, openaiSpec];

export const DEFAULT_CLOUD_PROVIDER = doubaoSpec.id;

export function findCloudProvider(id: string): CloudTtsSpec | undefined {
  return CLOUD_TTS_PROVIDERS.find((provider) => provider.id === id);
}

export * from './types';
