import { detectWithCld } from './cld';

export type DetectSource = 'dom' | 'script' | 'cld' | 'fallback';

export interface DetectResult {
  /** BCP-47 语种标签，如 en / zh / ja / pt-BR */
  lang: string;
  source: DetectSource;
  /** 0~1，仅用于日志和调试，不参与决策 */
  confidence: number;
}

/**
 * 字符集 → 语种。
 *
 * ⚠️ 顺序至关重要：日语里也有汉字，必须先判假名再判汉字，
 * 否则所有日文都会被认成中文。
 */
const SCRIPT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u3040-\u309f\u30a0-\u30ff]/, 'ja'], // 平假名 / 片假名
  [/[\uac00-\ud7af\u1100-\u11ff]/, 'ko'], // 谚文
  [/[\u4e00-\u9fff\u3400-\u4dbf]/, 'zh'], // 汉字（此时日语已被排除）
  [/[\u0400-\u04ff]/, 'ru'], // 西里尔
  [/[\u0600-\u06ff\u0750-\u077f]/, 'ar'], // 阿拉伯
  [/[\u0e00-\u0e7f]/, 'th'], // 泰文
  [/[\u0590-\u05ff]/, 'he'], // 希伯来
  [/[\u0900-\u097f]/, 'hi'], // 天城文
  [/[\u0980-\u09ff]/, 'bn'],
  [/[\u0b80-\u0bff]/, 'ta'],
  [/[\u0370-\u03ff]/, 'el'], // 希腊
];

/** 第 2 层：字符集判定。对非拉丁语系几乎 100% 准确。 */
export function detectByScript(text: string): string | null {
  for (const [pattern, lang] of SCRIPT_RULES) {
    if (pattern.test(text)) return lang;
  }
  return null;
}

function normalizeLang(raw: string): string {
  const trimmed = raw.trim().replace('_', '-');
  if (!trimmed) return 'en';
  const [first, second] = trimmed.split('-');
  const base = first ?? trimmed;
  return second ? `${base.toLowerCase()}-${second.toUpperCase()}` : base.toLowerCase();
}

/**
 * 三层语种识别，缺一不可：
 *
 * 1. X 自己标在正文节点上的 `lang` 属性 —— 最准，零成本；
 * 2. 字符集判定 —— 对中日韩俄阿泰等非拉丁语系几乎不会错，且是同步的；
 * 3. CLD2（chrome.i18n.detectLanguage）—— 只用来细分拉丁字母语言（en/es/fr/de…）。
 *
 * 第 3 层对短文本（< ~30 字符）经常给出 `isReliable: false`，
 * 所以只在百分比够高时才采信，否则降级使用它的猜测值。
 */
export async function detectLanguage(rawText: string, domLang?: string | null): Promise<DetectResult> {
  const text = (rawText ?? '').trim();

  // 第 1 层：X 的标注
  if (domLang && domLang !== 'und' && domLang !== 'zxx') {
    return { lang: normalizeLang(domLang), source: 'dom', confidence: 1 };
  }

  if (!text) return { lang: 'en', source: 'fallback', confidence: 0 };

  // 第 2 层：字符集
  const byScript = detectByScript(text);
  if (byScript) return { lang: byScript, source: 'script', confidence: 0.95 };

  // 第 3 层：CLD2
  const cld = await detectWithCld(text);
  const top = cld?.languages?.find((l) => l.language && l.language !== 'un');

  if (top && cld?.isReliable && top.percentage >= 70) {
    return { lang: normalizeLang(top.language), source: 'cld', confidence: top.percentage / 100 };
  }
  if (top && top.percentage >= 40) {
    return { lang: normalizeLang(top.language), source: 'cld', confidence: top.percentage / 100 };
  }

  // 什么都判不出来：拉丁字母文本最常见的假设是英语
  return { lang: 'en', source: 'fallback', confidence: 0.3 };
}
