import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import { DEFAULT_SETTINGS, type ReadXSettings } from '../settings';
import { DoubaoTtsProvider } from './doubaoTts';

/**
 * 这一层最容易出错的是**缓存与去重**：预取和正式朗读会为同一段文本
 * 各发一次请求，如果没去重，等于每句话都花两倍的钱和时间。
 */

/** 让 play() 拒绝，用来模拟自动播放策略拦截 */
let playRejects = false;

class FakeAudio {
  src = '';
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  preload = '';
  currentTime = 0;
  currentSrc = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  // 注意：类字段是**实例属性**，不在原型上，所以测试里不能补 prototype
  play = vi.fn(() => {
    if (playRejects) return Promise.reject(new Error('NotAllowedError'));
    this.currentSrc = this.src;
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  });
  pause = vi.fn();
  removeAttribute = vi.fn(() => {
    this.currentSrc = '';
  });
  load = vi.fn();
}

let objectUrlSeq = 0;
let sendMessage: ReturnType<typeof vi.fn>;

function makeSettings(overrides: Partial<ReadXSettings> = {}): ReadXSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeProvider(overrides: Partial<ReadXSettings> = {}) {
  return new DoubaoTtsProvider(() => makeSettings(overrides));
}

const SPEAK_OPTS = { lang: 'zh', rate: 1, pitch: 1, volume: 1 };

beforeEach(() => {
  objectUrlSeq = 0;
  playRejects = false;
  sendMessage = vi.fn(async () => ({
    ok: true,
    audio: 'QUJD',
    mimeType: 'audio/mpeg',
    duration: 2,
    sentences: [],
  }));
  vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(sendMessage as never);

  vi.stubGlobal('Audio', FakeAudio);
  (URL as unknown as Record<string, unknown>).createObjectURL = () => `blob:fake-${++objectUrlSeq}`;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DoubaoTtsProvider 音色选择', () => {
  it('没绑定就用该语言的默认音色', () => {
    expect(makeProvider().voiceFor('zh')).toBe('zh_female_xiaohe_uranus_bigtts');
    expect(makeProvider().voiceFor('en')).toBe('en_female_dacey_uranus_bigtts');
  });

  it('用户绑定优先于默认', () => {
    const provider = makeProvider({ doubaoVoices: { zh: 'zh_male_qingcang_mars_bigtts' } });
    expect(provider.voiceFor('zh')).toBe('zh_male_qingcang_mars_bigtts');
  });

  it('地区变体回退到主语言', () => {
    const provider = makeProvider({ doubaoVoices: { zh: 'zh_male_qingcang_mars_bigtts' } });
    expect(provider.voiceFor('zh-TW')).toBe('zh_male_qingcang_mars_bigtts');
  });

  it('没有对应语言的音色时返回 undefined，让上层去提示', () => {
    expect(makeProvider().voiceFor('ja')).toBeUndefined();
  });
});

describe('DoubaoTtsProvider 请求与缓存', () => {
  it('同一段文本只合成一次', async () => {
    const provider = makeProvider();

    await provider.speak('你好', SPEAK_OPTS);
    await provider.speak('你好', SPEAK_OPTS);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('预取过的文本，真读到时不再请求（in-flight 去重）', async () => {
    const provider = makeProvider();

    provider.prefetch('你好', 'zh');
    await provider.speak('你好', SPEAK_OPTS);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('不同文本各自请求', async () => {
    const provider = makeProvider();

    await provider.speak('一', SPEAK_OPTS);
    await provider.speak('二', SPEAK_OPTS);

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('换音色后缓存不复用（否则会拿旧音色的音频）', async () => {
    const provider = makeProvider();

    await provider.speak('你好', { ...SPEAK_OPTS, voiceURI: 'voice-a' });
    await provider.speak('你好', { ...SPEAK_OPTS, voiceURI: 'voice-b' });

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('请求里带上模型和音色', async () => {
    const provider = makeProvider({ doubaoModel: 'seed-audio-1.0' });
    await provider.speak('你好', SPEAK_OPTS);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'readx:doubao-synthesize',
        text: '你好',
        voice: 'zh_female_xiaohe_uranus_bigtts',
        model: 'seed-audio-1.0',
      }),
    );
  });
});

describe('DoubaoTtsProvider 失败处理', () => {
  it('接口报错时把原因和提示报给 UI，并返回 error', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'API Key 无效', hint: '去控制台确认' });
    const provider = makeProvider();
    const onError = vi.fn();
    provider.onError = onError;

    const outcome = await provider.speak('你好', SPEAK_OPTS);

    expect(outcome).toBe('error');
    expect(onError).toHaveBeenCalledWith('API Key 无效', '去控制台确认');
  });

  it('没有该语言的音色时报错，而不是发一个必然失败的请求', async () => {
    const provider = makeProvider();
    const onError = vi.fn();
    provider.onError = onError;

    const outcome = await provider.speak('こんにちは', { ...SPEAK_OPTS, lang: 'ja' });

    expect(outcome).toBe('error');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('音色'), expect.any(String));
  });

  it('播放被拒绝时也报错，不会静默什么都不发生', async () => {
    const provider = makeProvider();
    const onError = vi.fn();
    provider.onError = onError;

    playRejects = true;
    try {
      const outcome = await provider.speak('你好', SPEAK_OPTS);
      expect(outcome).toBe('error');
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('播放'), expect.any(String));
    } finally {
      playRejects = false;
    }
  });
});

describe('DoubaoTtsProvider 停止', () => {
  it('stop() 会暂停并清掉 src，避免残留的 ended 事件串到下一次', async () => {
    const provider = makeProvider();
    await provider.speak('你好', SPEAK_OPTS);

    provider.stop();

    expect(provider.isSupported()).toBe(true);
  });

  it('dispose() 释放缓存的 object URL', async () => {
    const provider = makeProvider();
    await provider.speak('你好', SPEAK_OPTS);

    const revoke = (URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> })
      .revokeObjectURL;
    provider.dispose();

    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
