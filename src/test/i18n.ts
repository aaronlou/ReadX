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
 *   expect(err.hint).toBe(en('provider_doubao_errRateLimitedHint'))
 *   expect(message).toContain(en('reader_endOfTimeline'))
 *   expect(text).toBe(en('overlay_progress', ['2', '3']))   // 带替换参数
 *
 * ⚠️ 这里必须自己实现一遍 Chrome 的替换逻辑。Chrome 用的是**具名占位符**：
 *
 *     "message": "Post $current$ of $total$",
 *     "placeholders": { "current": { "content": "$1$" }, "total": { "content": "$2$" } }
 *
 * 消息里出现的是 `$current$`，而调用方传的是位置参数 —— 中间靠 `content`
 * 映射。只替换 `$1$` 的话一条都换不上，测试会拿到带 `$current$` 的原文，
 * 而且**看起来还在跑**。
 */
interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

const MESSAGES = JSON.parse(
  readFileSync(join(__dirname, '../../public/_locales/en/messages.json'), 'utf8'),
) as Record<string, MessageEntry>;

export function en(key: string, substitutions?: string | string[]): string {
  const entry = MESSAGES[key];
  if (!entry) throw new Error(`测试引用了不存在的 i18n key：${key}`);

  const subs = typeof substitutions === 'string' ? [substitutions] : (substitutions ?? []);

  return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name: string) => {
    const positional = entry.placeholders?.[name]?.content;
    if (!positional) return whole; // 没声明的原样留着，让断言暴露问题

    const index = Number(positional.replace(/\$/g, ''));
    return subs[index - 1] ?? '';
  });
}
