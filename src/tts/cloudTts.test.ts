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
/** play() 后是否自动结束。整段朗读的进度测试需要手动控制播放位置 */
let audioAutoEnd = true;
/** 最近创建的 audio —— 整段朗读的进度测试要拿它模拟播放 */
let lastAudio: FakeAudio | null = null;

class FakeAudio {
  src = '';
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  preload = '';
  currentTime = 0;
  currentSrc = '';
  duration = Number.NaN;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor() {
    lastAudio = this;
  }

  addEventListener(type: string, cb: EventListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: EventListener) {
    this.listeners.get(type)?.delete(cb);
  }
  emit(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb(new Event(type));
  }
  /** 模拟播放到某一时刻 */
  seek(time: number) {
    this.currentTime = time;
    this.emit('timeupdate');
  }
  /** 模拟播放结束 */
  finish() {
    this.onended?.();
  }

  // 注意：类字段是实例属性，不在原型上
  play = vi.fn(() => {
    if (playRejects) return Promise.reject(new Error('NotAllowedError'));
    this.currentSrc = this.src;
    if (audioAutoEnd) queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  });
  pause = vi.fn();
  removeAttribute = vi.fn(() => {
    this.currentSrc = '';
  });
  load = vi.fn();
}

/** 让挂起的 promise 跑完 */
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  audioAutoEnd = true;
  lastAudio = null;
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

describe('CloudTtsProvider 整段朗读', () => {
  const SEGMENTS = ['第一句话。', '第二句话。', '第三句话。'];
  const BLOCK_TEXT = '第一句话。第二句话。第三句话。';

  function blockOpts(overrides: Record<string, unknown> = {}) {
    return { ...SPEAK_OPTS, segments: SEGMENTS, ...overrides };
  }

  // 这是整段朗读存在的全部理由：一条帖子从 N 次往返降到 1 次。
  // 逐句方案里"合成一句的时间 > 朗读一句的时间"必然导致断句，
  // 而整段共用一个音频文件，段内**不可能**有停顿。
  it('整条帖子只发一次请求', async () => {
    const provider = makeProvider();
    await provider.speakBlock(BLOCK_TEXT, blockOpts());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect((sendMessage.mock.calls[0]![0] as { text: string }).text).toBe(BLOCK_TEXT);
  });

  // 分块按的是**延迟预算**（chunkChars）而不是接口上限 maxChars。
  // 两者的区别很要命：按 maxChars(2048) 分块会得到几百秒的音频、
  // 几十秒的合成，实测直接撞穿 30 秒超时。
  it('按延迟预算分块，块数远少于句数', async () => {
    // 10 句、每句约 23 字 → 共 230 字，豆包预算 150 字/块 → 2 块
    const segments = Array.from({ length: 10 }, (_, i) => `这是第${i}句话，我在这里多写一些字来凑够长度。`);
    const provider = makeProvider();

    await provider.speakBlock(segments.join(''), blockOpts({ segments }));

    const chunks = sendMessage.mock.calls.length;
    expect(chunks).toBeGreaterThan(1);
    expect(chunks).toBeLessThan(10); // 换成逐句就是 10 次
  });

  // 这是块与块之间不断的关键：等这一块播完再去请求下一块，中间必然断一次。
  it('播放当前块的同时就把下一块合成上', async () => {
    audioAutoEnd = false;
    const segments = Array.from({ length: 10 }, (_, i) => `这是第${i}句话，我在这里多写一些字来凑够长度。`);
    const started: string[] = [];
    sendMessage.mockImplementation(async (message: { text: string }) => {
      started.push(message.text);
      return { ok: true, audio: 'QUJD', mimeType: 'audio/mpeg', duration: 1, sentences: [] };
    });

    void makeProvider().speakBlock(segments.join(''), blockOpts({ segments }));
    await flushAsync();

    // 第一块还在播（audioAutoEnd = false），第二块就应该已经发出去了
    expect(started.length).toBeGreaterThanOrEqual(2);
    lastAudio!.finish();
  });

  it('按句级时间戳回报读到第几句', async () => {
    audioAutoEnd = false;
    sendMessage.mockResolvedValue({
      ok: true,
      audio: 'QUJD',
      mimeType: 'audio/mpeg',
      duration: 9,
      sentences: [
        { start_time: 0, end_time: 3000, text: '第一句话。' },
        { start_time: 3000, end_time: 6000, text: '第二句话。' },
        { start_time: 6000, end_time: 9000, text: '第三句话。' },
      ],
    });

    const provider = makeProvider();
    const seen: number[] = [];
    void provider.speakBlock(
      BLOCK_TEXT,
      blockOpts({ onSegment: ({ index }: { index: number }) => seen.push(index) }),
    );
    await flushAsync();

    lastAudio!.duration = 9;
    lastAudio!.seek(1); // 第一句
    lastAudio!.seek(4); // 第二句
    lastAudio!.seek(7); // 第三句

    expect(seen).toContain(0);
    expect(seen).toContain(1);
    expect(seen).toContain(2);
    lastAudio!.finish();
  });

  // OpenAI / OpenRouter 不返回时间戳，这时只能按字数比例估 ——
  // 只影响高亮精度，不能因此让进度完全不动
  it('没有时间戳时按字数比例估算进度', async () => {
    audioAutoEnd = false;
    sendMessage.mockResolvedValue({
      ok: true,
      audio: 'QUJD',
      mimeType: 'audio/mpeg',
      duration: 9,
      sentences: [],
    });

    const provider = makeProvider();
    const seen: number[] = [];
    void provider.speakBlock(
      BLOCK_TEXT,
      blockOpts({ onSegment: ({ index }: { index: number }) => seen.push(index) }),
    );
    await flushAsync();

    lastAudio!.duration = 9;
    lastAudio!.seek(8); // 接近末尾 → 应该是最后一句

    expect(seen).toContain(2);
    lastAudio!.finish();
  });

  it('整段朗读同样受并发配额约束', async () => {
    let inFlight = 0;
    let peak = 0;
    sendMessage.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, audio: 'QUJD', mimeType: 'audio/mpeg', duration: 1, sentences: [] };
    });

    const segments = Array.from({ length: 10 }, (_, i) => `这是第${i}句话，我在这里多写一些字来凑够长度。`);
    await makeProvider().speakBlock(segments.join(''), blockOpts({ segments }));

    expect(peak).toBe(1);
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
