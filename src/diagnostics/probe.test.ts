import { afterEach, describe, expect, it } from 'vitest';
import { probeBuiltInAi } from './probe';
import { en } from '../test/i18n';

/**
 * 探测代码最容易犯的错是在 API 不存在时抛错 ——
 * 而"API 不存在"恰恰是它最主要的用途，所以必须锁住。
 */

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globals.Translator;
  delete globals.LanguageDetector;
  delete globals.LanguageModel;
  delete globals.Summarizer;
});

describe('probeBuiltInAi', () => {
  it('API 完全不存在时不抛错，如实报告 undefined', async () => {
    const report = await probeBuiltInAi('isolated-world');

    expect(report.context).toBe('isolated-world');
    expect(report.globals.Translator).toBe('undefined');
    expect(report.globals.LanguageDetector).toBe('undefined');
    expect(report.translatorAvailability).toBe(en('probe.apiMissing'));
    expect(report.languageDetectorAvailability).toBe(en('probe.apiMissing'));
    // ⚠️ UI 上色靠的是这个**机器可判状态**，不是上面的显示文案 ——
    // 拿文案判断的话，换界面语言就会静默失效
    expect(report.translatorStatus).toBe('missing');
    expect(report.languageDetectorStatus).toBe('missing');
  });

  it('API 存在时如实返回 availability 结果', async () => {
    globals.Translator = {
      availability: async () => 'downloadable',
    };
    globals.LanguageDetector = {
      availability: async () => 'available',
    };

    const report = await probeBuiltInAi('extension-page');

    expect(report.context).toBe('extension-page');
    expect(report.globals.Translator).toBe('object');
    expect(report.translatorAvailability).toBe('downloadable');
    expect(report.languageDetectorAvailability).toBe('available');
  });

  it('availability 抛错时把错误记进报告，而不是让整个探测失败', async () => {
    globals.Translator = {
      availability: async () => {
        throw new Error('boom');
      },
    };

    const report = await probeBuiltInAi('extension-page');

    expect(report.translatorAvailability).toBe(en('probe.threw', ['Error', 'boom']));
    expect(report.translatorStatus).toBe('threw');
    expect(report.translatorAvailability).toContain('boom');
  });

  it('把 en→zh 语言对透传给 availability', async () => {
    let seen: unknown = null;
    globals.Translator = {
      availability: async (options: unknown) => {
        seen = options;
        return 'available';
      },
    };

    await probeBuiltInAi('isolated-world', { from: 'ja', to: 'zh-Hant' });

    expect(seen).toEqual({ sourceLanguage: 'ja', targetLanguage: 'zh-Hant' });
  });

  it('报告里带上上下文和 Chrome 版本，便于诊断', async () => {
    const report = await probeBuiltInAi('isolated-world');

    expect(report.chromeVersion).toMatch(/^(\d+|unknown)$/);
    expect(report.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof report.secureContext).toBe('boolean');
  });
});
