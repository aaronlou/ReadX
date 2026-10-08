import type { AiProbeReport, ProbeContext } from '../types';

/**
 * 探测 Chrome 内置 AI（Translator / LanguageDetector）在当前 JS realm 里能不能用。
 *
 * 为什么需要这份探测：内置 AI API 挂在 `window` 上，而扩展的内容脚本跑在
 * isolated world —— 那是另一个 JS realm，这些 API 是否可见并无保证。
 * 翻译功能放在哪一层，完全取决于这个问题的答案。
 *
 * playground/probe.html 里有一份等价的零依赖实现（那个页面要能独立打开），
 * 两边结论应保持一致，改动时请同步。
 */

interface TranslatorGlobal {
  availability?: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
}

interface DetectorGlobal {
  availability?: () => Promise<string>;
}

function kindOf(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return typeof value;
}

async function attempt(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (error) {
    const err = error as Error;
    return `抛错：${err.name}: ${err.message}`;
  }
}

export async function probeBuiltInAi(
  context: ProbeContext,
  pair: { from: string; to: string } = { from: 'en', to: 'zh' },
): Promise<AiProbeReport> {
  const g = globalThis as typeof globalThis & {
    Translator?: TranslatorGlobal;
    LanguageDetector?: DetectorGlobal;
    // 这两个只是顺便记录一下存在性，暂不使用，所以不需要具体形状
    LanguageModel?: unknown;
    Summarizer?: unknown;
  };

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  const report: AiProbeReport = {
    context,
    url: typeof location !== 'undefined' ? location.href : '(n/a)',
    chromeVersion: ua.match(/Chrome\/(\d+)/)?.[1] ?? 'unknown',
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    globals: {
      Translator: kindOf(g.Translator),
      LanguageDetector: kindOf(g.LanguageDetector),
      LanguageModel: kindOf(g.LanguageModel),
      Summarizer: kindOf(g.Summarizer),
    },
    translatorAvailability: '未检测',
    languageDetectorAvailability: '未检测',
    at: new Date().toISOString(),
  };

  report.translatorAvailability = await attempt(async () =>
    g.Translator?.availability
      ? String(await g.Translator.availability({ sourceLanguage: pair.from, targetLanguage: pair.to }))
      : 'API 不存在',
  );

  report.languageDetectorAvailability = await attempt(async () =>
    g.LanguageDetector?.availability
      ? String(await g.LanguageDetector.availability())
      : 'API 不存在',
  );

  return report;
}
