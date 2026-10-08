import { beforeEach, describe, expect, it } from 'vitest';
import { SEED, mountPost } from '../../playground/fixtures/x-dom.js';
import { extractPost, statusIdOf } from './extract';
import { relativeOrder, renderedPosts } from './timeline';

/** 用 playground 里那份「唯一真相」的 DOM 结构铺满时间线 */
function mountAll(): void {
  document.body.innerHTML = '<div id="timeline"></div>';
  const timeline = document.getElementById('timeline')!;
  for (const post of SEED) mountPost(timeline, post);
}

function postByStatusId(id: string): HTMLElement {
  const post = renderedPosts().find((p) => statusIdOf(p) === id);
  if (!post) throw new Error(`没有渲染出 status ${id} 的帖子`);
  return post;
}

describe('extractPost', () => {
  beforeEach(mountAll);

  it('抽取正文、作者和 handle', () => {
    const data = extractPost(postByStatusId('1001'));

    expect(data.author).toBe('Paul Graham');
    expect(data.handle).toBe('paulg');
    expect(data.text).toContain('The best way to get startup ideas');
    expect(data.isAd).toBe(false);
    expect(data.isEmpty).toBe(false);
  });

  it('从 X 标的 lang 属性读出语种', () => {
    expect(extractPost(postByStatusId('1002')).domLang).toBe('zh');
    expect(extractPost(postByStatusId('1003')).domLang).toBe('ja');
    expect(extractPost(postByStatusId('1013')).domLang).toBeNull();
  });

  // X 把 emoji 渲染成 <img alt="😀">，innerText 拿不到这个字符
  it('把 emoji 的 img alt 还原成文字', () => {
    const data = extractPost(postByStatusId('1009'));
    expect(data.text).toContain('终于把插件跑通了');
    expect(data.text).toContain('🎉');
    expect(data.text).toContain('🚀');
  });

  it('引用帖的正文和引用内容分开，不会读串', () => {
    const data = extractPost(postByStatusId('1010'));

    expect(data.text).toBe('This is exactly the point I keep making.');
    expect(data.text).not.toContain('Shipping a rough prototype');
    expect(data.quotedText).toBe(
      'Shipping a rough prototype beats polishing a plan nobody has used.',
    );
  });

  it('纯图片帖被标记为没有可读文字', () => {
    const data = extractPost(postByStatusId('1011'));
    expect(data.isEmpty).toBe(true);
    expect(data.text).toBe('');
  });

  it('识别出推广帖', () => {
    const artifact = document.querySelector<HTMLElement>('[data-testid="placementTracking"]')!;
    const article = artifact.querySelector<HTMLElement>('article[data-testid="tweet"]')!;
    expect(extractPost(article).isAd).toBe(true);
  });

  it('statusId 取自 time 的永久链接', () => {
    expect(statusIdOf(postByStatusId('1004'))).toBe('1004');
  });
});

describe('renderedPosts', () => {
  beforeEach(mountAll);

  it('默认过滤掉推广帖', () => {
    const posts = renderedPosts();
    expect(posts).toHaveLength(SEED.length - 1);
    expect(posts.every((p) => !p.closest('[data-testid="placementTracking"]'))).toBe(true);
  });

  it('可以选择把推广帖也算进来', () => {
    expect(renderedPosts({ includeAds: true })).toHaveLength(SEED.length);
  });
});

describe('relativeOrder', () => {
  beforeEach(mountAll);

  it('按 DOM 顺序向后推进一条', () => {
    const first = postByStatusId('1001');
    expect(statusIdOf(relativeOrder(first, 1, 0.25)!)).toBe('1002');
  });

  it('向回退一条', () => {
    const second = postByStatusId('1002');
    expect(statusIdOf(relativeOrder(second, -1, 0.25)!)).toBe('1001');
  });

  it('已经是最后一条时返回 null，不会绕回去造成死循环', () => {
    const posts = renderedPosts();
    const last = posts[posts.length - 1]!;
    expect(relativeOrder(last, 1, 0.25)).toBeNull();
  });
});
