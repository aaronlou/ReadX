import { SELECTORS, pickAll } from './selectors';
import { statusIdOf } from './extract';

export const POST_SELECTOR = 'article[data-testid="tweet"], article[role="article"]';

export function isPromoted(post: HTMLElement): boolean {
  return !!post.closest('[data-testid="placementTracking"]');
}

/**
 * 取出当前真正渲染在 DOM 里的帖子。
 * X 用的是虚拟列表，滚动时远端节点会被卸载，所以这里永远只能拿到视口附近的一批。
 */
export function renderedPosts({ includeAds = false } = {}): HTMLElement[] {
  const posts = pickAll<HTMLElement>(document, SELECTORS.post);
  return includeAds ? posts : posts.filter((p) => !isPromoted(p));
}

/** 阅读锚线：帖子顶部对齐到视口高度的这个比例 */
export function anchorY(ratio: number): number {
  return window.innerHeight * ratio;
}

/** 锚线下方第一条还没被读完的帖子 */
export function postAtAnchor(ratio: number): HTMLElement | null {
  const y = anchorY(ratio);
  return renderedPosts().find((p) => p.getBoundingClientRect().bottom > y) ?? null;
}

/** 按 DOM 顺序取相邻的一条；目标已被虚拟列表卸载时退化为按锚线定位 */
export function relativeOrder(post: HTMLElement, dir: 1 | -1, ratio: number): HTMLElement | null {
  const posts = renderedPosts();
  const i = posts.indexOf(post);
  if (i < 0) return postAtAnchor(ratio);
  return posts[i + dir] ?? null;
}

/**
 * 帖子的稳定身份。
 * 优先用 status id —— React 复用 DOM 节点时也能正确分辨；
 * 少数没有永久链接的帖子（推广位等）退化成一次性编号。
 */
const ANON_KEYS = new WeakMap<HTMLElement, string>();
let anonSeq = 0;
export function keyOf(post: HTMLElement): string {
  const id = statusIdOf(post);
  if (id) return id;
  let key = ANON_KEYS.get(post);
  if (!key) {
    key = `anon-${++anonSeq}`;
    ANON_KEYS.set(post, key);
  }
  return key;
}

/** 等页面滚动静止（连续 3 帧位移 < 1px） */
export function waitForScrollIdle(timeout = 1200): Promise<void> {
  return new Promise((resolve) => {
    let last = window.scrollY;
    let stable = 0;
    const t0 = performance.now();
    const tick = () => {
      const y = window.scrollY;
      stable = Math.abs(y - last) < 1 ? stable + 1 : 0;
      last = y;
      if (stable >= 3 || performance.now() - t0 > timeout) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 把某条帖子滚到锚线上。
 * 不能用 scrollIntoView —— X 顶部有 sticky header，会被压在下面挡住。
 */
export async function scrollToPost(post: HTMLElement, ratio: number): Promise<void> {
  const top = post.getBoundingClientRect().top + window.scrollY - anchorY(ratio);
  return smoothScrollTo(top);
}

export async function smoothScrollTo(top: number, timeout = 1500): Promise<void> {
  const target = Math.max(0, Math.round(top));
  if (Math.abs(target - window.scrollY) < 4) return waitForScrollIdle(200);
  window.scrollTo({ top: target, behavior: 'smooth' });
  return waitForScrollIdle(timeout);
}

/** 等 X 把下一批帖子渲染出来（滚动到底部触发无限加载后调用） */
export function waitForMorePosts(before: number, { timeout = 3500 } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (renderedPosts().length > before) {
      resolve(true);
      return;
    }
    const observer = new MutationObserver(() => {
      if (renderedPosts().length > before) cleanup(true);
    });
    const timer = setTimeout(() => cleanup(false), timeout);
    const cleanup = (ok: boolean) => {
      clearTimeout(timer);
      observer.disconnect();
      resolve(ok);
    };
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
