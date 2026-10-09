import { t } from '@/i18n';

/**
 * Chrome 内置 Translator API 支持的语言。
 *
 * ⚠️ 它只认 **base code**，不认地区变体：`en-US` / `pt-BR` / `zh-CN` 都不合法。
 * 唯一的例外是 `zh-Hant`（繁体中文）与 `zh`（简体中文）并列。
 * 所以从我们检测出的 BCP-47 标签到 API 代码之间必须做一次归一化。
 *
 * 列表来自官方文档：
 * https://developer.chrome.com/docs/ai/translator-api
 */
export const TRANSLATOR_LANGUAGES = [
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi',
  'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko',
  'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl',
  'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hant',
] as const;

export type TranslatorLanguage = (typeof TRANSLATOR_LANGUAGES)[number];

const SUPPORTED = new Set<string>(TRANSLATOR_LANGUAGES);

/** 检测结果与 API 代码不一致的少数语种 */
const ALIASES: Record<string, TranslatorLanguage> = {
  nb: 'no', // 书面挪威语
  nn: 'no', // 新挪威语
  iw: 'he', // 希伯来语旧代码
  in: 'id', // 印尼语旧代码
  cmn: 'zh',
  yue: 'zh-Hant', // 粤语：繁体中文是最接近的可选项
};

/**
 * BCP-47 → Translator API 代码。
 * 返回 null 表示这个语种 API 不支持 —— 调用方应当降级为读原文。
 */
export function toApiCode(lang: string | null | undefined): TranslatorLanguage | null {
  if (!lang) return null;
  const normalized = lang.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) return null;

  // 中文必须先分辨简繁：API 只认 zh 和 zh-Hant，zh-CN / zh-TW 都是非法的
  if (normalized.startsWith('zh')) {
    return /(hant|tw|hk|mo)/.test(normalized) ? 'zh-Hant' : 'zh';
  }

  const base = normalized.split('-')[0] ?? normalized;
  const aliased = ALIASES[base] ?? base;
  return SUPPORTED.has(aliased) ? (aliased as TranslatorLanguage) : null;
}

export function isSupportedLanguage(lang: string | null | undefined): boolean {
  return toApiCode(lang) !== null;
}

/**
 * 两个语言标签是不是"同一种语言"（按 API 的粒度）。
 * 用于判断某条帖子是否**本来就不需要翻译** —— 这是最省事也最常见的情况。
 */
export function isSameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const codeA = toApiCode(a);
  const codeB = toApiCode(b);
  if (codeA && codeB) return codeA === codeB;

  // 有一边 API 不支持时退回 base code 比较，避免误判成"需要翻译"
  const baseA = (a ?? '').toLowerCase().split('-')[0];
  const baseB = (b ?? '').toLowerCase().split('-')[0];
  return !!baseA && baseA === baseB;
}

/**
 * 语言对。任一侧不支持、或两侧其实是同一种语言时返回 null ——
 * 后者意味着"不需要翻译"，不是错误。
 */
export function translationPair(
  from: string | null | undefined,
  to: string | null | undefined,
): { from: TranslatorLanguage; to: TranslatorLanguage } | null {
  const codeFrom = toApiCode(from);
  const codeTo = toApiCode(to);
  if (!codeFrom || !codeTo || codeFrom === codeTo) return null;
  return { from: codeFrom, to: codeTo };
}

/** UI 上展示用的名称。没收录的就直接显示代码。 */
const LABELS: Record<string, string> = {
  ar: 'translate_langAr',
  bg: 'translate_langBg',
  bn: 'translate_langBn',
  cs: 'translate_langCs',
  da: 'translate_langDa',
  de: 'translate_langDe',
  el: 'translate_langEl',
  en: 'translate_langEn',
  es: 'translate_langEs',
  fi: 'translate_langFi',
  fr: 'translate_langFr',
  he: 'translate_langHe',
  hi: 'translate_langHi',
  hr: 'translate_langHr',
  hu: 'translate_langHu',
  id: 'translate_langId',
  it: 'translate_langIt',
  ja: 'translate_langJa',
  kn: 'translate_langKn',
  ko: 'translate_langKo',
  lt: 'translate_langLt',
  mr: 'translate_langMr',
  nl: 'translate_langNl',
  no: 'translate_langNo',
  pl: 'translate_langPl',
  pt: 'translate_langPt',
  ro: 'translate_langRo',
  ru: 'translate_langRu',
  sk: 'translate_langSk',
  sl: 'translate_langSl',
  sv: 'translate_langSv',
  ta: 'translate_langTa',
  te: 'translate_langTe',
  th: 'translate_langTh',
  tr: 'translate_langTr',
  uk: 'translate_langUk',
  vi: 'translate_langVi',
  zh: 'translate_langZhHans',
  'zh-Hant': 'translate_langZhHant',
};

export function languageLabel(lang: string): string {
  const key = LABELS[lang];
  return key ? t(key) : lang;
}

/** 选择器里优先展示的语种 —— 把最常用的排前面，而不是按字母序 */
const PREFERRED_ORDER = ['zh', 'zh-Hant', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru'];

export const LANGUAGE_CHOICES: string[] = [
  ...PREFERRED_ORDER,
  ...TRANSLATOR_LANGUAGES.filter((lang) => !PREFERRED_ORDER.includes(lang)),
];
