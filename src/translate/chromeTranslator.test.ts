import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChromeTranslatorProvider } from './chromeTranslator';

/**
 * 用假 Translator 覆盖真实 API 的四种 availability 状态和下载流程。
 * 这些分支在真机上很难复现（要清 profile、要卡硬件门槛），必须靠测试锁住。
 */

interface FakeOptions {
  sourceLanguage: string;
  targetLanguage: string;
  monitor?: (monitor: { addEventListener: (t: string, cb: (e: { loaded: number; total: number }) => void) => void }) => void;
}

const globals = globalThis as Record<string, unknown>;

let createCalls: FakeOptions[] = [];

function installFakeTranslator(availability: string, behavior: {
  failCreate?: Error;
  progress?: number[];
  translate?: (text: string) => string;
} = {}) {
  createCalls = [];
  globals.Translator = {
    availability: async (options: { sourceLanguage: string; targetLanguage: string }) => {
      void options;
      return availability;
    },
    create: async (options: FakeOptions) => {
      createCalls.push(options);
      if (behavior.failCreate) throw behavior.failCreate;
      for (const loaded of behavior.progress ?? []) {
        options.monitor?.({
          addEventListener: (_type, callback) => callback({ loaded, total: 1 }),
        });
      }
      return {
        translate: async (text: string) => behavior.translate?.(text) ?? `[${options.targetLanguage}]${text}`,
      };
    },
  };
}

afterEach(() => {
  delete globals.Translator;
});

describe('ChromeTranslatorProvider.isSupported', () => {
  it('没有 Translator 全局对象时是 false', () => {
    expect(new ChromeTranslatorProvider().isSupported()).toBe(false);
  });

  it('有 Translator 时是 true', () => {
    installFakeTranslator('available');
    expect(new ChromeTranslatorProvider().isSupported()).toBe(true);
  });
});

describe('readiness', () => {
  beforeEach(() => installFakeTranslator('available'));

  it('把 API 的 availability 映射成我们的状态', async () => {
    const provider = new ChromeTranslatorProvider();

    installFakeTranslator('available');
    expect(await provider.readiness('en', 'zh')).toBe('ready');

    installFakeTranslator('downloadable');
    expect(await provider.readiness('en', 'zh')).toBe('need-download');

    installFakeTranslator('downloading');
    expect(await provider.readiness('en', 'zh')).toBe('need-download');

    installFakeTranslator('unavailable');
    expect(await provider.readiness('en', 'zh')).toBe('unavailable');
  });

  it('把地区变体归一化后再问 API', async () => {
    let asked: unknown = null;
    globals.Translator = {
      availability: async (options: unknown) => {
        asked = options;
        return 'downloadable';
      },
      create: async () => ({ translate: async (t: string) => t }),
    };

    await new ChromeTranslatorProvider().readiness('zh-TW', 'en-US');
    expect(asked).toEqual({ sourceLanguage: 'zh-Hant', targetLanguage: 'en' });
  });

  it('API 不支持的语言对是 unsupported', async () => {
    expect(await new ChromeTranslatorProvider().readiness('fa', 'zh')).toBe('unsupported');
  });

  it('availability 抛错时当作不可用，而不是崩掉', async () => {
    globals.Translator = {
      availability: async () => {
        throw new Error('boom');
      },
      create: async () => ({ translate: async (t: string) => t }),
    };
    expect(await new ChromeTranslatorProvider().readiness('en', 'zh')).toBe('unavailable');
  });
});

describe('prepare', () => {
  it('把 downloadprogress 的 0~1 比例透传给回调', async () => {
    installFakeTranslator('downloadable', { progress: [0.25, 0.5, 1] });
    const seen: number[] = [];

    const result = await new ChromeTranslatorProvider().prepare('en', 'zh', (r) => seen.push(r));

    expect(result).toBe('ready');
    expect(seen).toEqual([0.25, 0.5, 1]);
  });

  it('create 抛错时返回 unavailable，不把错误抛给调用方', async () => {
    installFakeTranslator('downloadable', { failCreate: new Error('NotAllowedError') });
    const result = await new ChromeTranslatorProvider().prepare('en', 'zh');
    expect(result).toBe('unavailable');
  });
});

describe('translate', () => {
  it('同一个语言对只 create 一次', async () => {
    installFakeTranslator('available');
    const provider = new ChromeTranslatorProvider();

    await provider.translate({ text: 'hello', from: 'en', to: 'zh' });
    await provider.translate({ text: 'world', from: 'en', to: 'zh' });

    expect(createCalls).toHaveLength(1);
  });

  it('不同语言对各自建实例', async () => {
    installFakeTranslator('available');
    const provider = new ChromeTranslatorProvider();

    await provider.translate({ text: 'a', from: 'en', to: 'zh' });
    await provider.translate({ text: 'b', from: 'en', to: 'ja' });

    expect(createCalls).toHaveLength(2);
    expect(createCalls.map((c) => c.targetLanguage)).toEqual(['zh', 'ja']);
  });

  it('create 失败后不缓存失败的 promise，重试能成功', async () => {
    installFakeTranslator('downloadable', { failCreate: new Error('NotAllowedError') });
    const provider = new ChromeTranslatorProvider();

    await expect(provider.translate({ text: 'x', from: 'en', to: 'zh' })).rejects.toThrow();

    // 第二次应该重新 create（如果缓存了 rejected promise，这里会拿到同一个错误）
    installFakeTranslator('available');
    await expect(provider.translate({ text: 'x', from: 'en', to: 'zh' })).resolves.toContain('x');
    expect(createCalls).toHaveLength(1);
  });

  it('不支持的语言对抛出可读错误，而不是静默返回原文', async () => {
    installFakeTranslator('available');
    const provider = new ChromeTranslatorProvider();

    await expect(provider.translate({ text: 'x', from: 'fa', to: 'zh' })).rejects.toThrow(/不支持的语言对/);
  });

  it('空文本直接返回，不浪费一次调用', async () => {
    installFakeTranslator('available');
    const provider = new ChromeTranslatorProvider();

    await expect(provider.translate({ text: '   ', from: 'en', to: 'zh' })).resolves.toBe('   ');
    expect(createCalls).toHaveLength(0);
  });

  it('把 abort signal 透传下去', async () => {
    let received: AbortSignal | undefined;
    globals.Translator = {
      availability: async () => 'available',
      create: async () => ({
        translate: async (text: string, options?: { signal?: AbortSignal }) => {
          received = options?.signal;
          return text;
        },
      }),
    };

    const controller = new AbortController();
    await new ChromeTranslatorProvider().translate({
      text: 'x',
      from: 'en',
      to: 'zh',
      signal: controller.signal,
    });

    expect(received).toBe(controller.signal);
  });
});

describe('dispose', () => {
  it('清空实例缓存，下次翻译会重新 create', async () => {
    installFakeTranslator('available');
    const provider = new ChromeTranslatorProvider();

    await provider.translate({ text: 'a', from: 'en', to: 'zh' });
    provider.dispose();
    await provider.translate({ text: 'b', from: 'en', to: 'zh' });

    expect(createCalls).toHaveLength(2);
  });
});
