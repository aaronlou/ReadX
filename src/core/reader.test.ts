import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED, mountPost } from '../../playground/fixtures/x-dom.js';
import type { SpeakOptions, SpeakOutcome, TtsProvider } from '../tts/provider';
import { DEFAULT_SETTINGS, type ReadXSettings } from '../settings';
import { Reader } from './reader';

/**
 * Reader 的滚动/推进逻辑依赖真实布局（getBoundingClientRect、scrollY），
 * 而 happy-dom 里所有矩形都是 0 —— 那样 postAtAnchor 永远返回 null，
 * 什么都测不出来。所以这里铺一个**假布局**：每条帖子固定 300px 高，
 * 从 y=0 开始依次排列，视口 800px，锚线在 25%。
 */
const POST_HEIGHT = 300;
const VIEWPORT_HEIGHT = 800;

let scrollY = 0;
let scrollToCalls: Array<{ top: number; behavior?: string }> = [];

function installFakeLayout(posts: HTMLElement[]) {
  const docTop = new Map<HTMLElement, number>();
  posts.forEach((post, index) => docTop.set(post, index * POST_HEIGHT));

  for (const post of posts) {
    post.getBoundingClientRect = () => {
      const top = (docTop.get(post) ?? 0) - scrollY;
      return {
        top,
        bottom: top + POST_HEIGHT,
        left: 0,
        right: 600,
        width: 600,
        height: POST_HEIGHT,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }

  Object.defineProperty(window, 'innerHeight', { value: VIEWPORT_HEIGHT, configurable: true });
  Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });

  // 立即到位，模拟滚动已经结束；waitForScrollIdle 靠连续 3 帧不动来判定
  const applyScroll = (target: number) => {
    scrollY = Math.max(0, Math.round(target));
  };
  window.scrollTo = ((options: ScrollToOptions | number) => {
    const top = typeof options === 'number' ? options : (options.top ?? 0);
    scrollToCalls.push({ top, behavior: typeof options === 'object' ? options.behavior : undefined });
    applyScroll(top);
  }) as typeof window.scrollTo;
  window.scrollBy = ((options: ScrollToOptions | number) => {
    const delta = typeof options === 'number' ? options : (options.top ?? 0);
    scrollToCalls.push({ top: scrollY + delta, behavior: typeof options === 'object' ? options.behavior : undefined });
    applyScroll(scrollY + delta);
  }) as typeof window.scrollBy;
}

/** 假 TTS：默认立即读完，也可以挂住不返回，用来模拟「正在朗读」的中间态 */
class FakeTts implements TtsProvider {
  readonly name = 'fake';
  spoken: string[] = [];
  stopCalls = 0;
  /** true = 每句立刻结束；false = 挂住，直到 release() 或 stop() */
  autoFinish = true;
  private pending: Array<() => void> = [];

  isSupported() {
    return true;
  }
  getVoices() {
    return [];
  }
  onVoicesChanged() {
    return () => {};
  }
  async ensureReady() {}

  async speak(text: string, opts: SpeakOptions): Promise<SpeakOutcome> {
    if (opts.signal?.aborted) return 'cancelled';
    this.spoken.push(text);
    opts.onStart?.();

    if (!this.autoFinish) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }
    return opts.signal?.aborted ? 'cancelled' : 'ended';
  }

  release() {
    const pending = this.pending;
    this.pending = [];
    for (const resolve of pending) resolve();
  }

  pause() {}
  resume() {}
  stop() {
    this.stopCalls += 1;
    this.release();
  }
}

/** 让所有挂起的 then/定时器跑完 */
async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function buildTimeline(posts: Array<Record<string, unknown>>): HTMLElement[] {
  document.body.innerHTML = '<div id="timeline"></div>';
  const timeline = document.getElementById('timeline')!;
  const mounted = posts.map((post) => mountPost(timeline, post) as HTMLElement);
  // 推广帖外面包了一层容器，取里面的 article
  return mounted.map((node) => node.querySelector('article') ?? node);
}

function makeReader(tts: TtsProvider, overrides: Partial<ReadXSettings> = {}) {
  const settings: ReadXSettings = { ...DEFAULT_SETTINGS, autoAdvance: false, ...overrides };
  return new Reader(tts, settings);
}

beforeEach(() => {
  scrollY = 0;
  scrollToCalls = [];
  // 让 3 帧稳定判定瞬间完成，测试才快且不抖
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Reader 定位', () => {
  it('start() 从锚线所在的帖子开始读', async () => {
    const posts = buildTimeline(SEED.slice(0, 3));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const reader = makeReader(tts);

    await reader.start();

    // 锚线 200px：第 0 条 bottom=300 > 200，所以从第 0 条开始
    expect(tts.spoken[0]).toBe('Paul Graham');
    expect(tts.spoken.join(' ')).toContain('The best way to get startup ideas');
  });
});

describe('Reader.next()', () => {
  it('朗读中点「下一条」会切到下一条帖子，而不是卡住', async () => {
    const posts = buildTimeline(SEED.slice(0, 3));
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false; // 挂住，模拟正在朗读
    const reader = makeReader(tts);

    void reader.start();
    await flush();
    expect(tts.spoken).toEqual(['Paul Graham']);

    void reader.next();
    await flush();

    // 关键断言：必须换成下一条帖子的作者
    expect(tts.spoken.length).toBeGreaterThan(1);
    expect(tts.spoken.at(-1)).toBe('阮一峰');
    expect(reader.currentPost).not.toBeNull();
  });

  it('空闲时点「下一条」应该前进，而不是重读刚刚读完的那条', async () => {
    const posts = buildTimeline(SEED.slice(0, 3));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const reader = makeReader(tts); // autoAdvance: false → 读完一条就回到 idle

    await reader.start();
    expect(tts.spoken).toContain('Paul Graham');
    expect(reader.snapshot.state).toBe('idle');

    tts.spoken = [];
    await reader.next();

    // 现在应该读到第 1 条（阮一峰），而不是又读一遍第 0 条（Paul Graham）
    expect(tts.spoken[0]).toBe('阮一峰');
  });

  it('已经在最后一条时，给出提示而不是静默无反应', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false;
    const reader = makeReader(tts);

    void reader.start();
    await flush();
    // 直接跳到第 1 条（最后一条）
    void reader.next();
    await flush();
    expect(tts.spoken.at(-1)).toBe('阮一峰');

    tts.release();
    await flush();

    // 最后一条之后再点「下一条」：会滚一屏等 X 加载（这里是假布局，永远等不到），
    // 然后必须给出可见提示。注意这一步要等真实的超时，所以这里 await 整个 next()
    await reader.next();

    expect(reader.snapshot.message).toMatch(/末尾/);
    expect(reader.snapshot.state).toBe('idle');
  });

  it('还没开始播放时点「下一条」等价于开始播放', async () => {
    const posts = buildTimeline(SEED.slice(0, 3));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const reader = makeReader(tts);

    expect(reader.currentPost).toBeNull();
    await reader.next();

    expect(tts.spoken).toContain('Paul Graham');
  });
});

/**
 * 这一组守的是同一个根因：内部状态曾经是一个独立字段，
 * 所有变更却只写快照，导致 isActive / state 判断永远是 idle。
 * 除了 next()，「朗读中点 ▶ 变成从头重读」也是它造成的。
 */
describe('Reader 播放控制', () => {
  it('朗读中点 ▶ 是暂停，而不是从头重读', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false;
    const reader = makeReader(tts);

    void reader.start();
    await flush();
    expect(reader.snapshot.state).toBe('speaking');

    const spokenBefore = tts.spoken.length;
    await reader.toggle();
    expect(reader.snapshot.state).toBe('paused');
    expect(tts.spoken.length).toBe(spokenBefore);

    await reader.toggle();
    expect(reader.snapshot.state).toBe('speaking');
    expect(tts.spoken.length).toBe(spokenBefore);
  });

  it('stop() 回到 idle 并清掉当前帖子', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false;
    const reader = makeReader(tts);

    void reader.start();
    await flush();
    expect(reader.currentPost).not.toBeNull();

    reader.stop();
    expect(reader.snapshot.state).toBe('idle');
    expect(reader.currentPost).toBeNull();
    expect(reader.isActive).toBe(false);
  });
});
