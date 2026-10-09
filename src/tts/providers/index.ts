import { doubaoSpec } from './doubao';
import { openaiSpec } from './openai';
import { openrouterSpec } from './openrouter';
import type { CloudTtsSpec } from './types';

/**
 * 云语音服务商注册表。
 *
 * **加一家新的服务商 = 写一个 spec 文件 + 在这里加一行。**
 * 设置项、background 的分发、设置面板的输入框、域名权限申请
 * 全都是从这份注册表读出来的，不需要改别的地方。
 *
 * 顺序 = 设置页里的展示顺序，**按海外用户的接入成本排**：
 *   1. OpenRouter —— 一个 Key 用多家的模型，注册即用
 *   2. OpenAI     —— 一个 Key，文档完善
 *   3. 豆包        —— 中文音色最好，但要火山引擎账号、控制台开通服务、
 *                    还得同时填 API Key 和 App ID，对海外用户门槛明显更高
 *
 * 写新 spec 时的要点见 providers/types.ts 里 `CloudTtsSpec` 的注释。
 * 契约由 registry.test.ts 守着 —— 漏声明任何一项都会在那里立刻炸掉。
 */
export const CLOUD_TTS_PROVIDERS: CloudTtsSpec[] = [
  openrouterSpec,
  openaiSpec,
  doubaoSpec,
];

/**
 * 新装用户的默认选项。
 *
 * 三家都要自备凭据，所以这只是"设置页里默认展开哪一个"。
 * 选接入成本最低的那家 —— 默认值是用户对产品的第一印象。
 * 已有用户存过的值不受影响。
 */
export const DEFAULT_CLOUD_PROVIDER = openrouterSpec.id;

export function findCloudProvider(id: string): CloudTtsSpec | undefined {
  return CLOUD_TTS_PROVIDERS.find((provider) => provider.id === id);
}

export * from './types';
