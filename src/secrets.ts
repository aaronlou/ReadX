import { storage } from '#imports';
import type { DoubaoCredentials } from './tts/doubaoClient';

/**
 * 豆包语音的 API Key。
 *
 * ⚠️ **必须存在 `storage.local`，绝不能用 `storage.sync`。**
 *
 * sync 会把内容上传到 Google 的服务器，并在用户登录的**所有设备**间同步 ——
 * 那等于把用户的 API Key 复制到我们无法控制的地方。密钥只应留在本机。
 *
 * 这也意味着换设备要重新填一次，这个取舍是明确的：安全 > 方便。
 */
export const doubaoApiKeyItem = storage.defineItem<string>('local:doubaoApiKey', {
  fallback: '',
});

export async function getDoubaoCredentials(): Promise<DoubaoCredentials> {
  const apiKey = (await doubaoApiKeyItem.getValue()).trim();
  return apiKey ? { apiKey } : {};
}

export async function setDoubaoApiKey(key: string): Promise<void> {
  await doubaoApiKeyItem.setValue(key.trim());
}

export async function hasDoubaoApiKey(): Promise<boolean> {
  return (await doubaoApiKeyItem.getValue()).trim().length > 0;
}

/**
 * 遮罩显示，用于在界面上确认"填的是哪个 key"而不泄露完整值。
 * 只保留前 4 位和后 4 位。
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 12) return '•'.repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${'•'.repeat(8)}${trimmed.slice(-4)}`;
}
