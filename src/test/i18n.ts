import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 测试里取真实英文文案。
 *
 * 断言直接写死字符串的话，改一次文案就要改一堆测试，而且很容易漏 ——
 * 更糟的是你会为了"让测试过"去改文案，而不是反过来。
 * 这里从 default locale 的 messages.json 读，测试断言的是**真实会显示给
 * 用户的英文**，同时又不和文案的措辞耦合。
 *
 * 用法：
 *   expect(err.hint).toBe(en('provider.doubao.errRateLimitedHint'))
 *   expect(message).toContain(en('reader.endOfTimeline'))
 */
const MESSAGES = JSON.parse(
  readFileSync(join(__dirname, '../../public/_locales/en/messages.json'), 'utf8'),
) as Record<string, { message: string }>;

export function en(key: string, substitutions?: string | string[]): string {
  const entry = MESSAGES[key];
  if (!entry) throw new Error(`测试引用了不存在的 i18n key：${key}`);

  const subs = typeof substitutions === 'string' ? [substitutions] : (substitutions ?? []);
  // Chrome 的占位符是 $1$、$2$（从 1 开始）
  return entry.message.replace(/\$(\d+)\$/g, (_, index: string) => subs[Number(index) - 1] ?? '');
}
