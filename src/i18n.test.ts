import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * i18n 文案的完整性守卫。
 *
 * Chrome 的 `i18n.getMessage()` 找不到 key 时**返回空字符串而不是报错**，
 * 所以漏翻译的后果是界面上凭空少一句话或一个按钮 —— 线上很难发现，
 * 用户也说不清哪里不对。
 *
 * 这个测试扫描源码里所有 `t('...')` 调用，逐个核对两种语言是否都有。
 * 加新文案时忘了补某一侧，这里就会失败。
 */

const ROOT = join(__dirname, '..');
const LOCALES = ['en', 'zh_CN'] as const;

type Messages = Record<string, { message: string }>;

function loadLocale(locale: string): Messages {
  const path = join(ROOT, 'public', '_locales', locale, 'messages.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Messages;
}

/** 递归列出所有需要检查的源码文件（跳过测试文件自身） */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/** 源码里所有 `t('key')` / `t("key")` 用到的 key */
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8');
    // 匹配 t('xxx') 与 t("xxx")，允许后面跟替换参数
    for (const match of source.matchAll(/\bt\(\s*['"]([A-Za-z][\w.]*)['"]/g)) {
      const key = match[1]!;
      // 同一个 key 出现在多个文件里是正常的，记第一个就行
      if (!keys.has(key)) keys.set(key, relative(ROOT, file));
    }
  }
  return keys;
}

/** wxt.config.ts 里以 __MSG_xxx__ 形式引用的 key */
function manifestKeys(): string[] {
  const source = readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8');
  return [...source.matchAll(/__MSG_([A-Za-z][\w]*)__/g)].map((m) => m[1]!);
}

describe('i18n 文案完整性', () => {
  const messages = Object.fromEntries(LOCALES.map((l) => [l, loadLocale(l)])) as Record<
    (typeof LOCALES)[number],
    Messages
  >;

  it('两种语言的 key 集合完全一致', () => {
    const en = Object.keys(messages.en).sort();
    const zh = Object.keys(messages.zh_CN).sort();

    const onlyEn = en.filter((k) => !zh.includes(k));
    const onlyZh = zh.filter((k) => !en.includes(k));

    expect({ onlyEn, onlyZh }).toEqual({ onlyEn: [], onlyZh: [] });
  });

  it('源码里用到的 key 两种语言都有', () => {
    const used = usedKeys();
    const missing: string[] = [];

    for (const [key, file] of used) {
      for (const locale of LOCALES) {
        if (!messages[locale][key]) missing.push(`${locale} 缺 "${key}"（${file} 用到）`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('manifest 里引用的 __MSG_ key 都存在', () => {
    const missing = manifestKeys().filter((key) => !messages.en[key] || !messages.zh_CN[key]);
    expect(missing).toEqual([]);
  });

  it('没有空文案（空的会渲染成一片空白，比缺 key 更难查）', () => {
    const empty: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, entry] of Object.entries(messages[locale])) {
        if (!entry.message?.trim()) empty.push(`${locale} 的 "${key}" 是空的`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('英文文案里不该混入中文', () => {
    const suspicious = Object.entries(messages.en)
      .filter(([, entry]) => /[\u4e00-\u9fa5]/.test(entry.message))
      .map(([key]) => key);
    expect(suspicious).toEqual([]);
  });

  /**
   * Chrome 对 manifest description 有 132 字符硬上限，
   * 超了商店直接拒绝上传，而且报错信息不好懂。
   */
  it('manifest 描述不超过 132 字符', () => {
    for (const locale of LOCALES) {
      const description = messages[locale].extDescription?.message ?? '';
      expect(description.length, `${locale} 的描述 ${description.length} 字符`).toBeLessThanOrEqual(
        132,
      );
    }
  });
});
