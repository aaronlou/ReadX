import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import { DEFAULT_SETTINGS } from '../settings';
import { CloudTtsProvider } from './cloudTts';

/**
 * 通用云语音引擎。
 *
 * 最容易出错的是**缓存与去重**：预取和正式朗读会为同一段文本各发一次请求，
 * 不去重等于每句话都花两倍的钱和时间。另外换服务商之后缓存必须隔离 ——
 * 同样的音色 id 在不同服务商那里可能指向完全不同的东西。
 */

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

  // 注意：类字段是实例属性，不在原型上
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

function makeProvider(overrides: Record<string, unknown> = {}) {
  return new CloudTtsProvider(() => ({
    ...DEFAULT_SETTINGS,
    cloudProvider: 'doubao',
    ...overrides,
  }) as never);
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

describe('CloudTtsProvider 音色选择', () => {
  it('从当前服务商的 spec 里取音色', () => {
    expect(makeProvider().voiceFor('zh')).toBe('zh_female_xiaohe_uranus_bigtts');
  });

  it('用户绑定优先于 spec 默认', () => {
    const provider = makeProvider({
      cloudVoices: { doubao: { zh: 'zh_male_qingcang_mars_bigtts' } },
    });
    expect(provider.voiceFor('zh')).toBe('zh_male_qingcang_mars_bigtts');
  });

  it('换服务商后音色跟着换（OpenAI 的音色是语言无关的）', () => {
    const provider = makeProvider({ cloudProvider: 'openai' });
    expect(provider.voiceFor('zh')).toBe('nova');
    expect(provider.voiceFor('ja')).toBe('nova');
  });

  it('音色绑定按服务商隔离，不会串台', () => {
    const provider = makeProvider({
      cloudProvider: 'openai',
      cloudVoices: { doubao: { zh: 'zh_male_qingcang_mars_bigtts' } },
    });
    // doubao 的绑定不该影响 openai
    expect(provider.voiceFor('zh')).toBe('nova');
  });

  it('未知的服务商 id 不会崩，只是没声音', () => {
    expect(makeProvider({ cloudProvider: 'nope' }).voiceFor('zh')).toBeUndefined();
  });
});

describe('CloudTtsProvider 请求与缓存', () => {
  it('同一段文本只合成一次', async () => {
    const provider = makeProvider();
    await provider.speak('你好', SPEAK_OPTS);
    await provider.speak('你好', SPEAK_OPTS);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('预取过的文本，真读到时不再请求', async () => {
    const provider = makeProvider();
    provider.prefetch('你好', 'zh');
    await provider.speak('你好', SPEAK_OPTS);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('不同服务商之间缓存隔离', async () => {
    const doubao = makeProvider();
    await doubao.speak('你好', SPEAK_OPTS);

    // 服务商和音色都在缓存 key 里 —— 同样的音色 id 在不同服务商那里
    // 可能指向完全不同的东西，绝不能复用
    const openai = makeProvider({ cloudProvider: 'openai' });
    await openai.speak('你好', SPEAK_OPTS);

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('请求里带上 providerId，由 background 决定怎么发', async () => {
    await makeProvider().speak('你好', SPEAK_OPTS);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'readx:cloud-tts-synthesize',
        providerId: 'doubao',
        text: '你好',
        voice: 'zh_female_xiaohe_uranus_bigtts',
      }),
    );
  });
});

describe('CloudTtsProvider 失败处理', () => {
  it('合成失败时把原因和提示报给 UI，并返回 error', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'API Key 无效', hint: '去控制台确认' });
    const provider = makeProvider();
    const onError = vi.fn();
    provider.onError = onError;

    const outcome = await provider.speak('你好', SPEAK_OPTS);

    expect(outcome).toBe('error');
    expect(onError).toHaveBeenCalledWith('API Key 无效', '去控制台确认');
  });

  it('未知服务商立刻报错，不发请求', async () => {
    const provider = makeProvider({ cloudProvider: 'nope' });
    const onError = vi.fn();
    provider.onError = onError;

    const outcome = await provider.speak('你好', SPEAK_OPTS);

    expect(outcome).toBe('error');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
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

describe('CloudTtsProvider 并发控制', () => {
  /** 记录同时在飞的请求数峰值，以及请求顺序 */
  function trackConcurrency(gapMs = 4) {
    let inFlight = 0;
    const peak = { value: 0 };
    const order: string[] = [];
    sendMessage.mockImplementation(async (message: { text: string }) => {
      inFlight += 1;
      peak.value = Math.max(peak.value, inFlight);
      order.push(message.text);
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      inFlight -= 1;
      return { ok: true, audio: 'QUJD', mimeType: 'audio/mpeg', duration: 1, sentences: [] };
    });
    return { peak, order };
  }

  // 这是我们真实撞过的坑：预取一激进就把服务商的并发配额撞了，
  // 豆包直接返回 `quota exceeded for types: concurrency`，整句读数就断了。
  it('并发数不超过服务商配额（豆包是 1）', async () => {
    const { peak } = trackConcurrency();
    const provider = makeProvider(); // doubao: maxConcurrency = 1

    for (let i = 0; i < 8; i += 1) provider.prefetch(`预取句子${i}`, 'zh');
    await provider.speak('真正要读的句子', SPEAK_OPTS);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(peak.value).toBe(1);
  });

  it('配额更高的服务商可以用到 2', async () => {
    const { peak } = trackConcurrency();
    const provider = makeProvider({ cloudProvider: 'openai' });

    for (let i = 0; i < 6; i += 1) provider.prefetch(`预取句子${i}`, 'zh');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(peak.value).toBeLessThanOrEqual(2);
    expect(peak.value).toBeGreaterThan(1); // 确实用上了并行
  });

  // 否则用户会等在一堆"为后面准备的"预取后面，越预取越卡。
  it('真正要读的句子插在排队的预取前面', async () => {
    const { order } = trackConcurrency();
    const provider = makeProvider();

    for (let i = 0; i < 8; i += 1) provider.prefetch(`预取句子${i}`, 'zh');
    await provider.speak('真正要读的句子', SPEAK_OPTS);
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 第一个预取已经占住槽位，所以真正要读的排第二 —— 但必须早于其余预取
    expect(order[1]).toBe('真正要读的句子');
  });

  it('预取队伍不会无限增长（超了就丢弃新的）', async () => {
    const { order } = trackConcurrency(20);
    const provider = makeProvider();

    for (let i = 0; i < 30; i += 1) provider.prefetch(`预取句子${i}`, 'zh');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 1 个在飞 + 最多 4 个排队，其余直接丢掉
    expect(order.length).toBeLessThanOrEqual(6);
  });
});

describe('CloudTtsProvider 资源释放', () => {
  it('dispose() 释放缓存的 object URL', async () => {
    const provider = makeProvider();
    await provider.speak('你好', SPEAK_OPTS);

    const revoke = (URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> })
      .revokeObjectURL;
    provider.dispose();

    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('invalidate() 之后会重新合成（换音色时必须这样）', async () => {
    const provider = makeProvider();
    await provider.speak('你好', SPEAK_OPTS);
    provider.invalidate();
    await provider.speak('你好', SPEAK_OPTS);

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
