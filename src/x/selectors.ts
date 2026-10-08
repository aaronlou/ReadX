/**
 * X (Twitter) 的 DOM 选择器 —— 全部集中在这一个文件。
 *
 * X 会不定期改版，改版时只需要动这里。
 * 每个字段都是一条「降级链」：从左往右试，取第一个命中的。
 * 参考：https://github.com/nirholas/XActions/blob/main/docs/dom-selectors.md
 */
export const SELECTORS = {
  /** 一条帖子的根节点 */
  post: ['article[data-testid="tweet"]', 'article[role="article"]'],
  /** 帖子正文容器（X 会在它上面标 lang 属性，是最可靠的语种来源） */
  text: ['[data-testid="tweetText"]'],
  /** 作者名 + @handle 区域 */
  userName: ['[data-testid="User-Name"]'],
  /** 推广帖的外层标记 */
  promoted: ['[data-testid="placementTracking"]'],
  /** 引用帖（转推附带的那条） */
  quote: ['[data-testid="quoteTweet"]'],
  /** 视频播放器 */
  video: ['[data-testid="videoPlayer"]'],
  /** 链接预览卡片 */
  card: ['[data-testid="card.wrapper"]'],
  /** 帖子里的图片 */
  photo: ['[data-testid="tweetPhoto"]'],
} as const;

export type SelectorChain = readonly string[];

/** 按降级链取第一个命中的元素 */
export function pick<T extends Element = HTMLElement>(
  root: ParentNode | null | undefined,
  chain: SelectorChain,
): T | null {
  if (!root) return null;
  for (const sel of chain) {
    try {
      const el = root.querySelector<T>(sel);
      if (el) return el;
    } catch {
      /* 选择器语法在个别浏览器上不合法时直接跳过 */
    }
  }
  return null;
}

/** 按降级链取第一组非空结果 */
export function pickAll<T extends Element = HTMLElement>(
  root: ParentNode | null | undefined,
  chain: SelectorChain,
): T[] {
  if (!root) return [];
  for (const sel of chain) {
    try {
      const els = [...root.querySelectorAll<T>(sel)];
      if (els.length) return els;
    } catch {
      /* noop */
    }
  }
  return [];
}
