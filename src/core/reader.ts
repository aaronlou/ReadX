import type { ReadXSettings } from '../settings';
import type { ReaderSnapshot, ReaderState } from '../types';
import { detectLanguage } from '../lang/detect';
import type { TtsProvider } from '../tts/provider';
import { extractPost, type PostData } from '../x/extract';
import {
  keyOf,
  postAtAnchor,
  relativeOrder,
  renderedPosts,
  scrollToPost,
  waitForMorePosts,
  waitForScrollIdle,
} from '../x/timeline';
import { splitSentences } from './text';

/** 两条帖子之间的停顿，避免听起来像连读 */
const INTER_POST_DELAY = 320;

const EMPTY_SNAPSHOT: ReaderSnapshot = {
  state: 'idle',
  postId: null,
  author: '',
  lang: '',
  langSource: 'fallback',
  sentence: '',
  sentenceIndex: 0,
  sentenceCount: 0,
  charIndex: 0,
  message: '',
};

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
  private settings: ReadXSettings;

  private epoch = 0;
  private abort: AbortController | null = null;
  private state: ReaderState = 'idle';
  private focusPost: HTMLElement | null = null;
  private followUser = false;
  private snap: ReaderSnapshot = { ...EMPTY_SNAPSHOT };

  constructor(tts: TtsProvider, settings: ReadXSettings) {
    this.tts = tts;
    this.settings = settings;
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
    this.state = 'idle';
    this.push({ ...EMPTY_SNAPSHOT });
  }

  /** 跳到下一条 */
  async next(): Promise<void> {
    if (!this.isActive) {
      await this.start();
      return;
    }

    const from = this.focusPost;
    this.cancelCurrent();

    if (!from || !from.isConnected) {
      const atAnchor = this.pickStartPost();
      if (!atAnchor) return this.halt('error', '没有找到可读的帖子。');
      await this.run(atAnchor);
      return;
    }

    const target = relativeOrder(from, 1, this.settings.anchorRatio)
      ?? (await this.loadMoreThenPick(from))
      ?? this.pickStartPost();

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

      const script = this.buildScript(data, lang);
      if (!script.length) {
        post = await this.advance(post, myEpoch, signal);
        continue;
      }

      this.patch({
        state: 'speaking',
        postId: data.id || null,
        author: data.author,
        lang,
        langSource: source,
        sentenceCount: script.length,
        sentenceIndex: 0,
        charIndex: 0,
        message: '',
      });

      const finished = await this.speakAll(script, lang, myEpoch, signal);
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

  private async loadMoreThenPick(from: HTMLElement): Promise<HTMLElement | null> {
    const before = renderedPosts().length;
    window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: 'smooth' });
    await waitForScrollIdle();
    await waitForMorePosts(before, { timeout: 3500 });

    const candidate = relativeOrder(from, 1, this.settings.anchorRatio) ?? postAtAnchor(this.settings.anchorRatio);
    if (candidate && keyOf(candidate) !== keyOf(from)) return candidate;
    return null;
  }

  // ---------------------------------------------------------------- 小工具

  private buildScript(data: PostData, lang: string): string[] {
    const out: string[] = [];
    if (this.settings.readAuthor && data.author) out.push(data.author);
    out.push(...splitSentences(data.text, lang));
    if (data.quotedText) out.push(...splitSentences(data.quotedText, lang));
    return out;
  }

  private voiceFor(lang: string): string | undefined {
    const overrides = this.settings.voiceOverrides ?? {};
    const base = lang.split('-')[0];
    return overrides[lang] ?? (base ? overrides[base] : undefined);
  }

  private pickStartPost(): HTMLElement | null {
    return postAtAnchor(this.settings.anchorRatio);
  }

  private cancelCurrent(): void {
    this.epoch += 1;
    this.abort?.abort();
    this.abort = null;
    this.tts.stop();
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
