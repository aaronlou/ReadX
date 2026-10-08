import { SELECTORS, pick, pickAll } from './selectors';

/** 从一条帖子里抽出来的、朗读需要的一切 */
export interface PostData {
  /** status id，取不到时为空字符串 */
  id: string;
  author: string;
  handle: string;
  /** 正文：emoji 已还原成字符，媒体/卡片已剔除 */
  text: string;
  /** 引用帖正文，没有则为空 */
  quotedText: string;
  /** X 自己标在正文节点上的 lang，最可靠 */
  domLang: string | null;
  isAd: boolean;
  /** 整条帖子没有任何可读文字（纯图片/视频） */
  isEmpty: boolean;
  element: HTMLElement;
}

/** 正文里需要整块跳过的子树 */
const SKIP_TESTIDS = new Set([
  'tweetPhoto',
  'videoPlayer',
  'card.wrapper',
  'tweetText', // 嵌套的引用帖正文，由外层单独抽取
]);

/**
 * X 把 emoji 渲染成 `<img alt="😀">`，`innerText` 拿不到，
 * 所以必须自己走一遍 DOM：文本节点取 textContent，img 取 alt。
 */
function readRichText(root: HTMLElement): string {
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    if (node !== root) {
      const testid = node.dataset.testid;
      if (testid && SKIP_TESTIDS.has(testid)) return;
    }

    if (node.tagName === 'IMG') {
      const alt = node.getAttribute('alt');
      if (alt) parts.push(alt);
      return;
    }
    if (node.tagName === 'BR') {
      parts.push('\n');
      return;
    }

    for (const child of node.childNodes) walk(child);
  };

  walk(root);
  return normalizeWhitespace(parts.join(''));
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 取出属于「这一条帖子自己」的正文节点。
 * 引用帖是嵌套结构，必须把它单独挑出来，否则会把引用的内容当成正文读。
 */
function ownTextNodes(post: HTMLElement): { main: HTMLElement | null; quoted: HTMLElement | null } {
  const all = pickAll<HTMLElement>(post, SELECTORS.text).filter((el) => {
    if (el.closest('[data-testid="quoteTweet"]')) return true;
    const owner = el.closest('article[data-testid="tweet"], article[role="article"]');
    return owner === post;
  });

  const main = all.find((el) => !el.closest('[data-testid="quoteTweet"]')) ?? null;
  const quoted = all.find((el) => !!el.closest('[data-testid="quoteTweet"]')) ?? null;
  return { main, quoted };
}

function extractAuthor(post: HTMLElement): { author: string; handle: string } {
  const box = pick<HTMLElement>(post, SELECTORS.userName);
  if (!box) return { author: '', handle: '' };

  const links = [...box.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')];

  // 第一个有文字的链接就是显示名；@handle 是纯 /username 形式的那个
  const nameLink = links.find((a) => (a.textContent ?? '').trim().length > 0);
  const author = (nameLink?.textContent ?? (box.textContent ?? '').split('\n')[0] ?? '').trim();

  const handleHref = links
    .map((a) => a.getAttribute('href') ?? '')
    .find((href) => /^\/[A-Za-z0-9_]+$/.test(href));

  return { author, handle: handleHref ? handleHref.slice(1) : '' };
}

/** 从帖子的永久链接里拿到 status id（最稳定的帖子身份标识） */
export function statusIdOf(post: HTMLElement): string | null {
  const timeEl = post.querySelector('time');
  const href = timeEl?.closest('a')?.getAttribute('href')
    ?? post.querySelector('a[href*="/status/"]')?.getAttribute('href')
    ?? '';
  return href.match(/\/status\/(\d+)/)?.[1] ?? null;
}

export function extractPost(post: HTMLElement): PostData {
  const { main, quoted } = ownTextNodes(post);
  const text = main ? readRichText(main) : '';
  const quotedText = quoted ? readRichText(quoted) : '';
  const { author, handle } = extractAuthor(post);

  return {
    id: statusIdOf(post) ?? '',
    author,
    handle,
    text,
    quotedText,
    domLang: main?.getAttribute('lang') ?? null,
    isAd: !!post.closest('[data-testid="placementTracking"]'),
    isEmpty: !text && !quotedText,
    element: post,
  };
}
