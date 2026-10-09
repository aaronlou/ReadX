import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED, mountPost } from '../../playground/fixtures/x-dom.js';
import type { SpeakOptions, SpeakOutcome, TtsProvider } from '../tts/provider';
import type {
  TranslateRequest,
  TranslationProvider,
  TranslationReadiness,
} from '../translate/provider';
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
  /** 被要求提前合成的句子，用来验证预取策略 */
  prefetched: string[] = [];
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
  prefetch(text: string) {
    this.prefetched.push(text);
  }

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

/** 假翻译：默认已就绪，翻译结果加个前缀方便断言 */
class FakeTranslation implements TranslationProvider {
  readonly name = 'fake';
  readinessValue: TranslationReadiness = 'ready';
  prepareResult: TranslationReadiness = 'ready';
  supported = true;
  readonly translated: Array<{ text: string; from: string; to: string }> = [];
  readonly prepareCalls: Array<{ from: string; to: string }> = [];

  isSupported() {
    return this.supported;
  }
  async readiness(): Promise<TranslationReadiness> {
    return this.readinessValue;
  }
  async prepare(
    from: string,
    to: string,
    onProgress?: (ratio: number) => void,
  ): Promise<TranslationReadiness> {
    this.prepareCalls.push({ from, to });
    onProgress?.(0.5);
    onProgress?.(1);
    return this.prepareResult;
  }
  async translate({ text, from, to }: TranslateRequest): Promise<string> {
    this.translated.push({ text, from, to });
    return `【译】${text}`;
  }
  /** 某段文本被翻译了几次 —— 用来验证缓存/预取去重 */
  countFor(text: string): number {
    return this.translated.filter((t) => t.text === text).length;
  }
  dispose() {}
}

function buildTimeline(posts: Array<Record<string, unknown>>): HTMLElement[] {
  document.body.innerHTML = '<div id="timeline"></div>';
  const timeline = document.getElementById('timeline')!;
  const mounted = posts.map((post) => mountPost(timeline, post) as HTMLElement);
  // 推广帖外面包了一层容器，取里面的 article
  return mounted.map((node) => node.querySelector('article') ?? node);
}

function makeReader(
  tts: TtsProvider,
  translation: TranslationProvider = new FakeTranslation(),
  overrides: Partial<ReadXSettings> = {},
) {
  const settings: ReadXSettings = { ...DEFAULT_SETTINGS, autoAdvance: false, ...overrides };
  return new Reader(tts, translation, settings);
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

describe('语音预取', () => {
  // 只预取下一句的话，云端合成只要比朗读慢一点就会断。
  it('朗读一条帖子时，会提前合成后面不止一句', async () => {
    const posts = buildTimeline([{ text: '第一句话。第二句话。第三句话。第四句话。' }]);
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false; // 挂在第一句上，观察它在读的时候预取了什么
    const reader = makeReader(tts, new FakeTranslation(), { readAuthor: false });

    void reader.start();
    await flush();

    expect(tts.spoken[0]).toBe('第一句话。');
    expect(tts.prefetched).toContain('第二句话。');
    expect(tts.prefetched).toContain('第三句话。'); // 深度必须 > 1
    reader.stop();
  });

  // 这一条守的是一个真实踩过的坑：帖子之间原本**完全不做音频预取**，
  // 因为预取逻辑挂在"翻译"上，同语言的帖子直接整条跳过了。
  // 于是每换一条帖子都要从零等一次完整往返 —— 表现就是"延迟特别严重"。
  it('同语言的帖子同样要预热音频（不能因为"不需要翻译"就跳过）', async () => {
    const posts = buildTimeline([
      { text: '第一条帖子。' },
      { text: '第二条帖子的开头。第二句。' },
    ]);
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false;
    const translation = new FakeTranslation();
    // 中文帖子 + 中文朗读 → 不需要翻译，但**照样要热音频**
    const reader = makeReader(tts, translation, {
      readAuthor: false,
      readingLang: 'zh',
    });

    void reader.start();
    await flush();

    expect(translation.translated).toEqual([]); // 确实没走翻译
    expect(tts.prefetched).toContain('第二条帖子的开头。'); // 但音频热了
    reader.stop();
  });
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

describe('Reader 翻译', () => {
  it('readingLang=auto 时完全不碰翻译', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    const reader = makeReader(tts, translation);

    await reader.start();

    expect(translation.translated).toHaveLength(0);
    expect(reader.snapshot.translatedFrom).toBeNull();
    expect(reader.snapshot.lang).toBe('en');
  });

  it('指定中文时，英文帖子会被翻译并用中文朗读', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    await reader.start();

    expect(translation.translated.length).toBeGreaterThan(0);
    expect(translation.translated[0]).toMatchObject({ from: 'en', to: 'zh' });
    expect(tts.spoken.join(' ')).toContain('【译】');
    // 朗读语种必须变成目标语言，否则音色会和文本对不上
    expect(reader.snapshot.lang).toBe('zh');
    expect(reader.snapshot.translatedFrom).toBe('en');
  });

  it('帖子本来就是目标语言时不翻译', async () => {
    const posts = buildTimeline(SEED.slice(0, 2)); // 第 0 条是英文，第 1 条是中文
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    await reader.start(); // 读第 0 条（英文）
    await reader.next(); // 切到第 1 条（中文）

    // 第 1 条本来就说中文，不该再翻一次
    const textsForSecondPost = translation.translated.filter((t) => t.text.includes('技术的价值'));
    expect(textsForSecondPost).toHaveLength(0);
    expect(reader.snapshot.translatedFrom).toBeNull();
  });

  it('语言包没下载时挂起等用户手势，准备好之后自动继续', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    translation.readinessValue = 'need-download';
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    void reader.start();
    await flush();

    // 必须挂起：下载语言包只能由用户手势触发，不能在朗读流程里偷偷做
    expect(reader.snapshot.state).toBe('need-language-pack');
    expect(reader.snapshot.pendingPack).toEqual({ from: 'en', to: 'zh' });
    expect(tts.spoken).toHaveLength(0);

    // 用户点了「下载」→ 模拟语言包就绪后重试
    translation.readinessValue = 'ready';
    await reader.prepareLanguagePack();

    expect(translation.prepareCalls).toEqual([{ from: 'en', to: 'zh' }]);
    expect(reader.snapshot.pendingPack).toBeNull();
    expect(tts.spoken.join(' ')).toContain('【译】');
    expect(reader.snapshot.lang).toBe('zh');
  });

  it('翻译不可用时降级读原文，并把原因显示出来', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    translation.supported = false;
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    const messages: string[] = [];
    reader.onSnapshot = (s) => {
      if (s.message) messages.push(s.message);
    };

    await reader.start();

    expect(translation.translated).toHaveLength(0);
    expect(reader.snapshot.lang).toBe('en');
    expect(tts.spoken.join(' ')).toContain('The best way to get startup ideas');
    expect(reader.snapshot.translatedFrom).toBeNull();
    // 必须告诉用户"为什么我要中文却在读英文"，不能默默降级
    expect(messages.some((m) => /不支持/.test(m))).toBe(true);
  });

  it('翻译失败时同样降级读原文，并说明原因', async () => {
    const posts = buildTimeline(SEED.slice(0, 2));
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    vi.spyOn(translation, 'translate').mockRejectedValue(new Error('boom'));
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    const messages: string[] = [];
    reader.onSnapshot = (s) => {
      if (s.message) messages.push(s.message);
    };

    await reader.start();

    expect(reader.snapshot.lang).toBe('en');
    expect(tts.spoken.join(' ')).toContain('The best way to get startup ideas');
    expect(messages.some((m) => /翻译失败/.test(m))).toBe(true);
  });
});

describe('Reader 翻译预取', () => {
  // 三条都是非中文的帖子，readingLang=zh 时都需要翻译
  // （as const 让下标访问有确定的类型，否则 noUncheckedIndexedAccess 会当成可能 undefined）
  const ALL_FOREIGN = [SEED[0]!, SEED[2]!, SEED[3]!] as const;
  const FIRST_TEXT = ALL_FOREIGN[0].text as string;
  const SECOND_TEXT = ALL_FOREIGN[1].text as string;
  const THIRD_TEXT = ALL_FOREIGN[2].text as string;

  it('朗读当前条时就把后面几条翻好，避免每条之间卡一次翻译', async () => {
    const posts = buildTimeline([...ALL_FOREIGN]);
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false; // 卡在第一条，模拟"正在朗读"
    const translation = new FakeTranslation();
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    void reader.start();
    await flush(40);

    // 第 0 条正在读，后面两条的翻译这时候应该已经做好了
    expect(translation.countFor(SECOND_TEXT)).toBe(1);
    expect(translation.countFor(THIRD_TEXT)).toBe(1);
  });

  it('真的读到那一条时命中缓存，不会重复翻译', async () => {
    const posts = buildTimeline([...ALL_FOREIGN]);
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    await reader.start(); // 读完第 0 条后停住（autoAdvance 关）

    const before = translation.countFor(SECOND_TEXT);

    await reader.next(); // 手动推进到第 1 条

    expect(translation.countFor(SECOND_TEXT)).toBe(before);
    expect(reader.snapshot.lang).toBe('zh');
  });

  it('预取绝不触发语言包下载 —— 后台行为没有用户手势', async () => {
    // 第 0 条本来就是中文（不需要翻译，能正常读下去），
    // 第 1 条是英文且语言包没下载
    const posts = buildTimeline([SEED[1]!, SEED[0]!]);
    installFakeLayout(posts);

    const tts = new FakeTts();
    const translation = new FakeTranslation();
    translation.readinessValue = 'need-download';
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    await reader.start();

    // 中文那条照常读出来了
    expect(tts.spoken.join(' ')).toContain('技术的价值');

    // 但预取碰到 need-download 必须直接跳过：既不能翻译，更不能触发下载
    expect(translation.translated).toHaveLength(0);
    expect(translation.prepareCalls).toHaveLength(0);
  });

  it('readingLang=auto 时不做任何预取', async () => {
    const posts = buildTimeline([...ALL_FOREIGN]);
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false;
    const translation = new FakeTranslation();
    const reader = makeReader(tts, translation);

    void reader.start();
    await flush(40);

    expect(translation.translated).toHaveLength(0);
  });

  it('文本相同的帖子只翻一次（转推 / 重复帖）', async () => {
    // 两条帖子正文完全一样，只是 id 不同
    const posts = buildTimeline([
      { ...SEED[0]!, id: '9001' },
      { ...SEED[0]!, id: '9002' },
    ]);
    installFakeLayout(posts);

    const tts = new FakeTts();
    tts.autoFinish = false;
    const translation = new FakeTranslation();
    const reader = makeReader(tts, translation, { readingLang: 'zh' });

    void reader.start();
    await flush(40);

    expect(translation.countFor(FIRST_TEXT)).toBe(1);
  });
});
