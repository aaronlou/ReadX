import { storage } from '#imports';

/**
 * 云语音服务商的凭据（API Key 之类）。
 *
 * ⚠️ **必须存在 `storage.local`，绝不能用 `storage.sync`。**
 *
 * sync 会把内容上传到 Google 的服务器，并在用户登录的**所有设备**间同步 ——
 * 那等于把用户的 API Key 复制到我们无法控制的地方。密钥只应留在本机。
 * 代价是换设备要重填一次，这个取舍是明确的：安全 > 方便。
 *
 * 结构：{ [providerId]: { [fieldKey]: value } }
 */
export type ProviderCredentials = Record<string, Record<string, string>>;

export const cloudCredentialsItem = storage.defineItem<ProviderCredentials>(
  'local:cloudCredentials',
  { fallback: {} },
);

/** 早期版本把豆包密钥单独存在这个键下，这里做一次性搬迁 */
const LEGACY_DOUBAO_KEY = 'local:doubaoApiKey';

export async function getAllCredentials(): Promise<ProviderCredentials> {
  return (await cloudCredentialsItem.getValue()) ?? {};
}

export async function getProviderCredentials(
  providerId: string,
): Promise<Record<string, string>> {
  const all = await getAllCredentials();
  const current = all[providerId];
  if (current && Object.keys(current).length > 0) return current;

  // 从旧格式搬迁，避免用户重填
  if (providerId === 'doubao') {
    const legacy = await storage.getItem<string>(LEGACY_DOUBAO_KEY);
    if (legacy && legacy.trim()) return { apiKey: legacy.trim() };
  }
  return {};
}

export async function setProviderCredentials(
  providerId: string,
  values: Record<string, string>,
): Promise<void> {
  const all = await getAllCredentials();
  const cleaned = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, (v ?? '').trim()]),
  );
  await cloudCredentialsItem.setValue({ ...all, [providerId]: cleaned });
}

/** 遮罩显示，用于确认"填的是哪个 key"而不泄露完整值 */
export function maskSecret(value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 12) return '•'.repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${'•'.repeat(8)}${trimmed.slice(-4)}`;
}
