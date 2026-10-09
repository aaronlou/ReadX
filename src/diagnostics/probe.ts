import { t } from '@/i18n';
import type { AiProbeReport, ProbeContext, ProbeStatus } from '../types';

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

/**
 * 跑一次探测，同时给出**显示文本**和**机器可判状态**。
 *
 * 两者必须一起返回：UI 上色要靠状态，绝不能回头去比显示文本 ——
 * 那样一换界面语言就会静默失效。
 */
async function attempt(
  fn: () => Promise<{ text: string; status: ProbeStatus }>,
): Promise<{ text: string; status: ProbeStatus }> {
  try {
    return await fn();
  } catch (error) {
    const err = error as Error;
    return { text: t('probe_threw', [err.name, err.message]), status: 'threw' };
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
    translatorAvailability: t('probe_notDetected'),
    languageDetectorAvailability: t('probe_notDetected'),
    translatorStatus: 'missing',
    languageDetectorStatus: 'missing',
    at: new Date().toISOString(),
  };

  const translator = await attempt(async () =>
    g.Translator?.availability
      ? {
          text: String(
            await g.Translator.availability({ sourceLanguage: pair.from, targetLanguage: pair.to }),
          ),
          status: 'ok' as const,
        }
      : { text: t('probe_apiMissing'), status: 'missing' as const },
  );
  report.translatorAvailability = translator.text;
  report.translatorStatus = translator.status;

  const detector = await attempt(async () =>
    g.LanguageDetector?.availability
      ? { text: String(await g.LanguageDetector.availability()), status: 'ok' as const }
      : { text: t('probe_apiMissing'), status: 'missing' as const },
  );
  report.languageDetectorAvailability = detector.text;
  report.languageDetectorStatus = detector.status;

  return report;
}
