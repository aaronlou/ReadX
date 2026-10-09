import type { ReadXSettings } from '../settings';
import type { PendingLanguagePack, ReaderSnapshot, ReaderState } from '../types';
import { detectLanguage } from '../lang/detect';
import { isSameLanguage, translationPair } from '../translate/languages';
import type { TranslationProvider } from '../translate/provider';
import type { TtsProvider } from '../tts/provider';
import { extractPost, type PostData } from '../x/extract';
import {
  keyOf,
  postAtAnchor,
  postsAfter,
  relativeOrder,
  renderedPosts,
  scrollToPost,
  waitForMorePosts,
  waitForScrollIdle,
} from '../x/timeline';
import { splitSentences } from './text';

/** 两条帖子之间的停顿，避免听起来像连读 */
const INTER_POST_DELAY = 320;

/** 正在朗读第 N 条时，提前把后面这几条的翻译和音频做掉 */
const PREFETCH_AHEAD = 2;

/**
 * 朗读一条帖子时，提前合成到后面第几句。
 *
 * 云端引擎每句一次网络往返（几百毫秒到几秒）。只预取下一句的话，
 * 一旦合成比朗读慢，每句之间都会断一下 —— 所以要留出两三句的缓冲。
 * 多预取的代价是可能白花一两次合成费，远小于听感上的损失。
 */
const SPEECH_PREFETCH_AHEAD = 2;

/**
 * 预取后面几条帖子时，每条只热前面这几句。
 *
 * 这是"延迟特别严重"的主因：帖子之间原本完全没有音频预取，
 * 每换一条都要从零等一次完整往返。只热开头几句就够消除冷启动，
 * 再往后热是浪费 —— 用户完全可能中途停下或跳过。
 */
const POST_PREFETCH_SENTENCES = 2;

/** 翻译缓存上限，超出后按插入顺序淘汰（FIFO） */
const TRANSLATION_CACHE_LIMIT = 60;

const EMPTY_SNAPSHOT: ReaderSnapshot = {
  state: 'idle',
  postId: null,
  author: '',
  lang: '',
  langSource: 'fallback',
  translatedFrom: null,
  sentence: '',
  sentenceIndex: 0,
  sentenceCount: 0,
  charIndex: 0,
  message: '',
  pendingPack: null,
  packProgress: null,
  engineWarning: null,
};

/** 这一条帖子最终要怎么读 */
interface SpeechPlan {
  /** 实际朗读用的语种（翻译开启时是目标语言） */
  lang: string;
  text: string;
  quotedText: string;
  /** 被翻译过的话，这里是原文语言 */
  translatedFrom: string | null;
  /**
   * 降级说明（比如"翻译不可用，读原文"）。
   * 必须由 SpeechPlan 带回给 run() —— 曾经在这里直接 patch，
   * 结果立刻被后面的 `patch({ message: '' })` 覆盖，用户根本看不到。
   */
  note?: string;
}

/** 需要挂起等用户下载语言包时，记住要回到哪一条 */
interface PendingPackState extends PendingLanguagePack {
  post: HTMLElement;
}

/**
 * 朗读主控。
 *
 * 只做编排，不碰 DOM 之外的展示：
 *   定位帖子 → 抽取文本 → 判定语种 → 切句 → 逐句朗读 → 滚到下一条 → 循环
 *
 * 所有「取消」都靠 epoch + AbortController 组合：
 * epoch 变了，旧的异步循环在下一个检查点自己退出，不会和新循环抢朗读。
 */
export class Reader {
  /** 面板订阅快照 */
  onSnapshot: ((snapshot: ReaderSnapshot) => void) | null = null;
  /** 当前正在读的帖子变了（用于高亮框跟随） */
  onFocusPost: ((post: HTMLElement | null) => void) | null = null;

  private readonly tts: TtsProvider;
  private readonly translation: TranslationProvider;
  private settings: ReadXSettings;
  /** 等用户手势下载语言包时，记着要回到哪一条帖子 */
  private pendingPack: PendingPackState | null = null;

  /**
   * 翻译结果缓存。
   *
   * key 直接用原文而不是哈希 —— 缓存很小（上限几十条），
   * 用原文可以彻底排除哈希碰撞导致"读到别人的译文"这种极难排查的错误。
   */
  private readonly translationCache = new Map<string, string>();
  /** 正在翻译中的任务：预取和正式朗读撞上同一段文本时复用同一次调用 */
  private readonly translationInflight = new Map<string, Promise<string>>();
  private prefetchAbort: AbortController | null = null;

  private epoch = 0;
  private abort: AbortController | null = null;
  private focusPost: HTMLElement | null = null;
  private followUser = false;
  private snap: ReaderSnapshot = { ...EMPTY_SNAPSHOT };

  constructor(tts: TtsProvider, translation: TranslationProvider, settings: ReadXSettings) {
    this.tts = tts;
    this.translation = translation;
    this.settings = settings;
  }

  /**
   * 状态只有一份 —— 快照里的那个。
   *
   * ⚠️ 这里曾经是一个独立的字段，结果所有状态变更都走 `patch({ state })`（只写快照），
   * 没人写这个字段，于是它永远是初始值 'idle'：
   * `isActive` 恒为 false → `next()` 每次都走 `!isActive` 分支去调 `start()`，
   * 而 `start()` 会重新锚定到**当前这条**帖子 → 「下一条」表现为重读当前条。
   * 同理暂停也失效。改成 getter 之后，读写只有一处，不可能再走岔。
   */
  private get state(): ReaderState {
    return this.snap.state;
  }

  get snapshot(): ReaderSnapshot {
    return { ...this.snap };
  }

  get currentPost(): HTMLElement | null {
    return this.focusPost;
  }

  get isActive(): boolean {
    return this.state === 'speaking' || this.state === 'paused' || this.state === 'loading';
  }

  setSettings(settings: ReadXSettings): void {
    this.settings = settings;
  }

  // ---------------------------------------------------------------- 对外命令

  async toggle(): Promise<void> {
    if (this.state === 'speaking') {
      this.pause();
      return;
    }
    if (this.state === 'paused') {
      this.resume();
      return;
    }
    await this.start();
  }

  async start(): Promise<void> {
    if (this.state === 'speaking' || this.state === 'loading') return;

    this.followUser = false;
    const first = this.pickStartPost();
    if (!first) {
      this.halt('error', '当前页面没找到帖子。请打开 X 的时间线、列表或帖子详情页再试。');
      return;
    }
    await this.run(first);
  }

  stop(): void {
    this.epoch += 1;
    this.abort?.abort();
    this.abort = null;
    this.tts.stop();
    this.setFocus(null);
    this.pendingPack = null;
    this.prefetchAbort?.abort();
    this.prefetchAbort = null;
    // EMPTY_SNAPSHOT 的 state 就是 'idle'，不需要单独再赋一次
    this.push({ ...EMPTY_SNAPSHOT });
  }

  /** 跳到下一条 */
  async next(): Promise<void> {
    const from = this.focusPost;

    // 刻意**不**检查 isActive：只要还记得"刚才读到哪一条"，就应该从它往后走。
    // 曾经这里写的是 `if (!isActive) return this.start()`，而 start() 会用
    // postAtAnchor 重新锚定 —— 刚读完的那条正好停在锚线上，于是会被再读一遍，
    // 听感上就是「点了下一条没反应」。
    if (!from || !from.isConnected) {
      await this.start();
      return;
    }

    this.cancelCurrent();

    let target = relativeOrder(from, 1, this.settings.anchorRatio);
    if (!target) {
      // 已渲染的帖子里没有下一条 → 往下滚一屏触发 X 的无限加载。
      // 这一步要等网络，先给用户一个可见的反馈，避免"点了没动静"。
      this.patch({ message: '正在加载更多帖子…' });
      target = await this.loadMoreThenPick(from);
    }
    if (!target) target = this.pickStartPost();

    if (!target || keyOf(target) === keyOf(from)) {
      this.halt('idle', '已经到时间线末尾了。');
      return;
    }
    await scrollToPost(target, this.settings.anchorRatio);
    await this.run(target);
  }

  /** 回到上一条 */
  async prev(): Promise<void> {
    const from = this.focusPost;
    if (!from || !from.isConnected) {
      await this.start();
      return;
    }

    this.cancelCurrent();
    const target = relativeOrder(from, -1, this.settings.anchorRatio) ?? from;
    await scrollToPost(target, this.settings.anchorRatio);
    await this.run(target);
  }

  pause(): void {
    if (this.state !== 'speaking') return;
    this.tts.pause();
    this.patch({ state: 'paused', message: '已暂停' });
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.tts.resume();
    this.patch({ state: 'speaking', message: '' });
  }

  /**
   * 外部想把一条提示显示到面板上（比如语音引擎降级、权限没给、密钥失效）。
   *
   * 可能发生在朗读之前（点播放时才发现没配密钥），也可能发生在朗读中间
   * （合成失败降级），所以不区分状态，直接写快照。
   */
  note(message: string): void {
    this.patch({ message });
  }

  /**
   * 语音引擎的持久告警。和 `note()` 的区别是它**不会被后续状态冲掉** ——
   * 「启用了云语音却听到机器音」必须一直看得见，用户才知道要去设置页看。
   * 传 null 清除。
   */
  setEngineWarning(message: string | null): void {
    this.patch({ engineWarning: message });
  }

  /**
   * 用户手动滚动了页面。
   * 之后不再按「DOM 里的下一条」推进，改成从当前锚线重新定位，
   * 这样才不会跟用户抢滚动条。
   */
  notifyUserScroll(): void {
    if (!this.isActive) return;
    this.followUser = true;
    this.patch({ message: '已跟随你的滚动位置' });
  }

  // ---------------------------------------------------------------- 主循环

  private async run(start: HTMLElement): Promise<void> {
    const myEpoch = ++this.epoch;
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const { signal } = controller;

    let post: HTMLElement | null = start;

    // guard 只是防呆：正常流程永远不会接近这个上限
    for (let guard = 0; post && guard < 1000; guard += 1) {
      if (this.stale(myEpoch, signal)) return;

      this.setFocus(post);
      const data = extractPost(post);

      if (data.isAd && this.settings.skipAds) {
        this.patch({ message: '跳过：推广帖' });
        post = await this.advance(post, myEpoch, signal);
        continue;
      }
      if (data.isEmpty && this.settings.skipMediaOnly) {
        this.patch({ message: '跳过：这条帖子没有可读文字' });
        post = await this.advance(post, myEpoch, signal);
        continue;
      }

      const { lang, source } = await detectLanguage(data.text, data.domLang);
      if (this.stale(myEpoch, signal)) return;

      const plan = await this.planSpeech(data, lang, myEpoch, signal);
      // 语言包没备好 → 已经挂起等用户点按钮；循环到此为止，避免继续往下滚
      if (!plan) return;

      // 趁这一条还在读，把后面几条先翻好。不这样做的话，
      // 每条帖子之间都会卡一次翻译延迟，连续听下去就断了。
      this.startPrefetch(post, myEpoch);

      const script = this.buildScript(data, plan.lang, plan.text, plan.quotedText);
      if (!script.length) {
        post = await this.advance(post, myEpoch, signal);
        continue;
      }

      this.patch({
        state: 'speaking',
        postId: data.id || null,
        author: data.author,
        lang: plan.lang,
        langSource: source,
        translatedFrom: plan.translatedFrom,
        sentenceCount: script.length,
        sentenceIndex: 0,
        charIndex: 0,
        message: plan.note ?? '',
      });

      const finished = await this.speakAll(script, plan.lang, myEpoch, signal);
      if (!finished) return;

      if (!this.settings.autoAdvance) {
        this.patch({ state: 'idle', message: '已读完这一条（自动推进已关闭）' });
        return;
      }

      this.patch({ message: '正在定位下一条…' });
      post = await this.advance(post, myEpoch, signal);
    }

    if (!this.stale(myEpoch, signal)) {
      this.setFocus(null);
      this.patch({ state: 'idle', message: '已经读到时间线末尾了。' });
    }
  }

  private async speakAll(
    script: string[],
    lang: string,
    myEpoch: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    for (let i = 0; i < script.length; i += 1) {
      if (this.stale(myEpoch, signal)) return false;

      const sentence = script[i];
      if (sentence === undefined) continue;
      this.patch({ sentence, sentenceIndex: i, charIndex: 0 });

      // 提前把后面几句合成好。云端引擎每句一次网络往返，
      // 只预取下一句的话，合成一旦比朗读慢就会断。
      for (let ahead = 1; ahead <= SPEECH_PREFETCH_AHEAD; ahead += 1) {
        const upcoming = script[i + ahead];
        if (upcoming !== undefined) this.tts.prefetch?.(upcoming, lang);
      }

      const outcome = await this.tts.speak(sentence, {
        lang,
        voiceURI: this.voiceFor(lang),
        rate: this.settings.rate,
        pitch: this.settings.pitch,
        volume: this.settings.volume,
        signal,
        onBoundary: (charIndex) => this.patch({ charIndex }),
      });

      if (outcome === 'cancelled') return false;
      if (outcome === 'error') {
        // 单句失败不中断整条帖子，继续往下读
        console.warn('[ReadX] 这一句朗读失败：', sentence);
      }
    }
    return true;
  }

  /**
   * 推进到下一条帖子。
   * 三种情况依次处理：已在 DOM 里的下一条 → 滚一屏触发无限加载 → 仍不动就放弃。
   * 「放弃」很重要：否则 X 到底部时会陷入死循环。
   */
  private async advance(
    from: HTMLElement,
    myEpoch: number,
    signal: AbortSignal,
  ): Promise<HTMLElement | null> {
    const ratio = this.settings.anchorRatio;
    const fromKey = keyOf(from);

    await delay(INTER_POST_DELAY);
    if (this.stale(myEpoch, signal)) return null;

    // 用户刚才自己滚了 → 完全以锚线为准
    if (this.followUser) {
      this.followUser = false;
      const atAnchor = postAtAnchor(ratio);
      if (atAnchor && keyOf(atAnchor) !== fromKey) {
        await scrollToPost(atAnchor, ratio);
        return atAnchor;
      }
    }

    const inline = relativeOrder(from, 1, ratio);
    if (inline && keyOf(inline) !== fromKey) {
      await scrollToPost(inline, ratio);
      return inline;
    }

    // DOM 里没有下一条 → 往下滚一屏，让 X 触发无限加载
    const before = renderedPosts().length;
    window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: 'smooth' });
    await waitForScrollIdle();
    await waitForMorePosts(before, { timeout: 3500 });
    if (this.stale(myEpoch, signal)) return null;

    let next = postAtAnchor(ratio);
    if (next && keyOf(next) === fromKey) {
      // X 还在加载，或者已经到底了 → 再滚一屏确认一次
      window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: 'smooth' });
      await waitForScrollIdle(1500);
      next = postAtAnchor(ratio);
    }
    if (!next || keyOf(next) === fromKey) return null;

    await scrollToPost(next, ratio);
    return next;
  }

  /**
   * 滚一屏，等 X 把下一批帖子渲染出来。
   *
   * timeout 刻意比自动推进时短：这是用户**主动点了「下一条」**之后的等待，
   * 让他盯着屏幕干等 3.5 秒是不可接受的。自动推进那条路径用的是 advance()，
   * 那里可以等久一点。
   */
  private async loadMoreThenPick(from: HTMLElement, timeout = 1500): Promise<HTMLElement | null> {
    const before = renderedPosts().length;
    window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: 'smooth' });
    await waitForScrollIdle();
    await waitForMorePosts(before, { timeout });

    const candidate = relativeOrder(from, 1, this.settings.anchorRatio) ?? this.pickStartPost();
    if (candidate && keyOf(candidate) !== keyOf(from)) return candidate;
    return null;
  }

  // ---------------------------------------------------------------- 翻译

  /**
   * 决定这一条帖子要怎么读：读原文，还是先翻译。
   *
   * 返回 null 表示**已经挂起**等用户下载语言包（调用方必须就此收手）。
   * 翻译不可用时一律降级为读原文 —— 宁可读原文，也不要静默什么都不读。
   */
  private async planSpeech(
    data: PostData,
    detectedLang: string,
    myEpoch: number,
    signal: AbortSignal,
  ): Promise<SpeechPlan | null> {
    const original: SpeechPlan = {
      lang: detectedLang,
      text: data.text,
      quotedText: data.quotedText,
      translatedFrom: null,
    };

    const target = this.settings.readingLang;
    if (!target || target === 'auto') return original;
    // 帖子本来就是目标语言 —— 最常见的情况，完全不需要翻译
    if (isSameLanguage(detectedLang, target)) return original;

    const pair = translationPair(detectedLang, target);
    if (!pair) {
      return { ...original, note: `${detectedLang} → ${target} 暂不支持，读原文` };
    }

    if (!this.translation.isSupported()) {
      return { ...original, note: '本机不支持设备端翻译，读原文' };
    }

    const readiness = await this.translation.readiness(detectedLang, target);
    if (this.stale(myEpoch, signal)) return null;

    // 下载语言包必须由用户手势触发，所以这里只能挂起，等用户点按钮
    if (readiness === 'need-download') {
      this.pendingPack = { from: pair.from, to: pair.to, post: data.element };
      this.patch({
        state: 'need-language-pack',
        pendingPack: { from: pair.from, to: pair.to },
        packProgress: null,
        message: `需要先下载 ${pair.from} → ${pair.to} 语言包（约十几秒，只需一次）`,
      });
      return null;
    }

    if (readiness !== 'ready') {
      return { ...original, note: '设备端翻译当前不可用，读原文' };
    }

    try {
      const [text, quotedText] = await Promise.all([
        this.translateCached(data.text, detectedLang, target, signal),
        data.quotedText
          ? this.translateCached(data.quotedText, detectedLang, target, signal)
          : Promise.resolve(''),
      ]);
      if (this.stale(myEpoch, signal)) return null;

      return {
        // 用目标语言朗读，音色才会匹配
        lang: target,
        text: text || data.text,
        quotedText,
        translatedFrom: detectedLang,
      };
    } catch (error) {
      console.warn('[ReadX] 翻译失败，改读原文', error);
      return { ...original, note: '翻译失败，读原文' };
    }
  }

  /**
   * 带缓存的翻译。
   *
   * 两层去重：
   *   1. 结果缓存 —— 同一条帖子（转推、重复帖）不重复翻
   *   2. in-flight 复用 —— 预取和正式朗读撞上同一段文本时共用一次调用
   */
  private async translateCached(
    text: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const key = `${from}\u0000${to}\u0000${text}`;

    const cached = this.translationCache.get(key);
    if (cached !== undefined) return cached;

    const inflight = this.translationInflight.get(key);
    if (inflight) return inflight;

    const pending = this.translation
      .translate({ text, from, to, signal })
      .then((value) => {
        this.remember(key, value);
        return value;
      })
      .finally(() => {
        this.translationInflight.delete(key);
      });

    this.translationInflight.set(key, pending);
    return pending;
  }

  private remember(key: string, value: string): void {
    this.translationCache.set(key, value);
    while (this.translationCache.size > TRANSLATION_CACHE_LIMIT) {
      const oldest = this.translationCache.keys().next().value;
      if (oldest === undefined) break;
      this.translationCache.delete(oldest);
    }
  }

  /**
   * 预取后面几条帖子的**翻译和音频**。
   *
   * 有意做成"每次成功规划一条就重开一批"：上一批跑完 prefetchAbort 会被清空，
   * 推进到下一条时自然会覆盖新的窗口。
   *
   * ⚠️ 这里**不能**因为"不需要翻译"就提前返回。音频预取和翻译是两件独立的
   * 事：同语言的帖子不需要翻译，但照样需要预热语音 —— 否则每换一条帖子
   * 都要从零等一次完整的网络往返，连续听下去就是一句一顿。
   * 这正是"延迟特别严重"的主因。
   */
  private startPrefetch(from: HTMLElement, myEpoch: number): void {
    // 已经有一批在跑，它覆盖的窗口就够用了
    if (this.prefetchAbort) return;

    const upcoming = postsAfter(from, PREFETCH_AHEAD);
    if (!upcoming.length) return;

    const controller = new AbortController();
    this.prefetchAbort = controller;
    const { signal } = controller;

    void (async () => {
      for (const post of upcoming) {
        if (signal.aborted || myEpoch !== this.epoch) break;
        try {
          await this.prefetchOne(post, signal);
        } catch {
          // 预取失败不影响任何事 —— 真读到那一条时还会再试一次
        }
      }
    })().finally(() => {
      if (this.prefetchAbort === controller) this.prefetchAbort = null;
    });
  }

  private async prefetchOne(post: HTMLElement, signal: AbortSignal): Promise<void> {
    const data = extractPost(post);
    if (data.isEmpty) return;

    const detected = await detectLanguage(data.text, data.domLang);
    if (signal.aborted) return;

    // 顺序很重要：先翻译，再热音频。因为音频要用**译文**合成，
    // 反过来做的话合成的是原文，真正朗读时缓存键对不上，等于白发一次请求。
    const { text, quotedText, readLang } = await this.prefetchTranslate(
      data,
      detected.lang,
      signal,
    );
    if (signal.aborted) return;

    const script = this.buildScript(data, readLang, text, quotedText);
    for (const sentence of script.slice(0, POST_PREFETCH_SENTENCES)) {
      if (signal.aborted) return;
      this.tts.prefetch?.(sentence, readLang);
    }
  }

  /**
   * 预取专用的翻译：返回这一条**最终会用哪段文本、哪个语种**朗读。
   *
   * 和 planSpeech 的关键区别是**完全不产生副作用**。预取是后台行为：
   *   - 没有用户手势，绝不能触发语言包下载（会抛 NotAllowedError）
   *   - 不该改动界面状态（否则会闪出"需要下载语言包"的提示）
   * 所以遇到"没就绪"一律按读原文处理，把决定权留给真正朗读时的 planSpeech。
   */
  private async prefetchTranslate(
    data: PostData,
    detectedLang: string,
    signal: AbortSignal,
  ): Promise<{ text: string; quotedText: string; readLang: string }> {
    const original = { text: data.text, quotedText: data.quotedText, readLang: detectedLang };

    const target = this.settings.readingLang;
    if (!target || target === 'auto') return original;
    // 帖子本来就是目标语言 —— 最常见的情况，不需要翻译（但音频照样要热）
    if (isSameLanguage(detectedLang, target)) return original;
    if (!translationPair(detectedLang, target)) return original;
    if (!this.translation.isSupported()) return original;

    const readiness = await this.translation.readiness(detectedLang, target);
    if (signal.aborted) return original;
    // 只预取已经就绪的语言对
    if (readiness !== 'ready') return original;

    try {
      const [text, quotedText] = await Promise.all([
        this.translateCached(data.text, detectedLang, target, signal),
        data.quotedText
          ? this.translateCached(data.quotedText, detectedLang, target, signal)
          : Promise.resolve(''),
      ]);
      if (signal.aborted || !text) return original;
      return { text, quotedText, readLang: target };
    } catch {
      return original;
    }
  }

  /**
   * 下载语言包并继续朗读。
   *
   * ⚠️ 必须在用户手势（点击）里调用 —— Chrome 要求语言包下载由用户手势触发，
   * 否则 Translator.create() 会抛 NotAllowedError。
   */
  async prepareLanguagePack(): Promise<void> {
    const pending = this.pendingPack;
    if (!pending) return;

    this.patch({ state: 'loading', message: '正在下载语言包…', packProgress: 0 });

    const result = await this.translation.prepare(pending.from, pending.to, (ratio) => {
      this.patch({ packProgress: ratio });
    });

    if (result === 'ready') {
      this.pendingPack = null;
      this.patch({ pendingPack: null, packProgress: null, message: '语言包已就绪' });
      const post = pending.post;
      if (post.isConnected) {
        await this.run(post);
      } else {
        await this.start();
      }
      return;
    }

    this.patch({
      state: 'error',
      packProgress: null,
      message:
        result === 'unsupported'
          ? '这一对语言不受支持'
          : '语言包下载失败。可到 chrome://on-device-translation-internals 手动安装',
    });
  }

  // ---------------------------------------------------------------- 小工具

  private buildScript(data: PostData, lang: string, text: string, quotedText: string): string[] {
    const out: string[] = [];
    if (this.settings.readAuthor && data.author) out.push(data.author);
    out.push(...splitSentences(text, lang));
    if (quotedText) out.push(...splitSentences(quotedText, lang));
    return out;
  }

  /**
   * 该语言用哪个音色 —— 交给引擎自己决定。
   *
   * 上层不该知道 Web Speech 的 voiceURI 和豆包的 speaker id 有什么区别，
   * 所以这里只是把问题转给 provider。
   */
  private voiceFor(lang: string): string | undefined {
    return this.tts.voiceFor?.(lang);
  }

  private pickStartPost(): HTMLElement | null {
    return postAtAnchor(this.settings.anchorRatio);
  }

  private cancelCurrent(): void {
    this.epoch += 1;
    this.abort?.abort();
    this.abort = null;
    this.tts.stop();
    // 换帖子/换指令之后，之前挂起的"等语言包"和预取都失效了
    this.pendingPack = null;
    this.prefetchAbort?.abort();
    this.prefetchAbort = null;
    this.patch({ pendingPack: null, packProgress: null });
  }

  private stale(myEpoch: number, signal: AbortSignal): boolean {
    return signal.aborted || myEpoch !== this.epoch;
  }

  private setFocus(post: HTMLElement | null): void {
    this.focusPost = post;
    this.onFocusPost?.(post);
  }

  private halt(state: ReaderState, message: string): void {
    this.setFocus(null);
    this.patch({ state, message });
  }

  private push(snapshot: ReaderSnapshot): void {
    this.snap = snapshot;
    this.onSnapshot?.({ ...snapshot });
  }

  private patch(partial: Partial<ReaderSnapshot>): void {
    this.snap = { ...this.snap, ...partial };
    this.onSnapshot?.({ ...this.snap });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
