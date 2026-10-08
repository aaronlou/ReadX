/**
 * X 帖子 DOM 的「唯一真相」。
 *
 * 两个地方共用它，保证测试和手动调试面对的 DOM 完全一致：
 *   1. playground/mock-timeline.html —— 浏览器里手动调试
 *   2. src/x/extract.test.ts        —— 单元测试
 *
 * 结构严格对齐 X 真实标记，参考：
 * https://github.com/nirholas/XActions/blob/main/docs/dom-selectors.md
 */

const TRANSPARENT_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** 每条帖子声明自己的语言 —— X 会把它标在 tweetText 的 lang 属性上 */
export const SEED = [
  {
    id: '1001',
    name: 'Paul Graham',
    handle: 'paulg',
    lang: 'en',
    text: 'The best way to get startup ideas is not to think of startup ideas. It is to look for problems, preferably problems you have yourself.',
  },
  {
    id: '1002',
    name: '阮一峰',
    handle: 'ruanyf',
    lang: 'zh',
    text: '技术的价值不在于它有多新，而在于它能不能解决真实的问题。今天读了一篇关于浏览器扩展架构的文章，很有启发。',
  },
  {
    id: '1003',
    name: 'ひろゆき',
    handle: 'hirox246',
    lang: 'ja',
    text: '努力すれば報われるって言うけど、報われない努力もたくさんあるんですよね。大事なのは方向を間違えないことだと思います。',
  },
  {
    id: '1004',
    name: 'Dmitry',
    handle: 'dm',
    lang: 'ru',
    text: 'Лучший способ предсказать будущее — это создать его самому. Начните с малого уже сегодня.',
  },
  {
    id: '1005',
    name: 'مستخدم',
    handle: 'ar_user',
    lang: 'ar',
    text: 'أفضل طريقة للتعلم هي أن تبني شيئًا حقيقيًا وتشاركه مع الناس.',
  },
  {
    id: '1006',
    name: '김개발',
    handle: 'kimdev',
    lang: 'ko',
    text: '코드를 읽기 쉽게 쓰는 것이 가장 어려운 일이다. 오늘도 리팩터링만 세 시간 했다.',
  },
  {
    id: '1007',
    name: 'María',
    handle: 'maria_dev',
    lang: 'es',
    text: 'La mejor forma de aprender es construir algo real y compartirlo con la gente.',
  },
  {
    id: '1008',
    name: 'Amélie',
    handle: 'amelie',
    lang: 'fr',
    text: 'La simplicité est la sophistication suprême. Un bon outil disparaît derrière son usage.',
  },
  // emoji 被渲染成 <img alt>，innerText 拿不到 —— 专门验证提取逻辑
  {
    id: '1009',
    name: 'Emoji Fan',
    handle: 'emoji',
    lang: 'zh',
    emoji: true,
    text: '终于把插件跑通了，太开心了！',
  },
  // 引用帖：验证不会把引用内容当正文读串
  {
    id: '1010',
    name: 'Quoter',
    handle: 'quoter',
    lang: 'en',
    text: 'This is exactly the point I keep making.',
    quote: {
      name: 'Original Author',
      handle: 'orig',
      lang: 'en',
      text: 'Shipping a rough prototype beats polishing a plan nobody has used.',
    },
  },
  // 纯图片没有文字 → 应被 skipMediaOnly 跳过
  { id: '1011', name: 'Photographer', handle: 'photo', lang: 'en', text: '', mediaOnly: true },
  // 推广帖 → 应被 skipAds 跳过
  {
    id: '1012',
    name: 'Sponsored',
    handle: 'sponsored',
    lang: 'en',
    promoted: true,
    text: 'Buy our amazing product today and get 50% off your first order!',
  },
  // 短到 CLD 无法可靠判语种的拉丁文本
  { id: '1013', name: 'Shorty', handle: 'shorty', lang: null, text: 'nice' },
];

function esc(value) {
  return String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

/** 渲染成 X 那样的一条帖子；返回的根节点已经是 data-testid="tweet" 的 article */
export function renderPost(post) {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.setAttribute('role', 'article');

  const emojiMarkup = post.emoji
    ? ` <img alt="🎉" src="${TRANSPARENT_GIF}"> <img alt="🚀" src="${TRANSPARENT_GIF}">`
    : '';

  const quoteMarkup = post.quote
    ? `<div data-testid="quoteTweet">
         <div>
           <span class="name">${esc(post.quote.name)}</span>
           <span class="handle">@${esc(post.quote.handle)}</span>
         </div>
         <div data-testid="tweetText"${post.quote.lang ? ` lang="${post.quote.lang}"` : ''}>${esc(post.quote.text)}</div>
       </div>`
    : '';

  const mediaMarkup = post.mediaOnly ? '<div data-testid="tweetPhoto"></div>' : '';

  const textMarkup = post.text
    ? `<div data-testid="tweetText"${post.lang ? ` lang="${post.lang}"` : ''}>${esc(post.text)}${emojiMarkup}</div>`
    : '';

  article.innerHTML = `
    <div class="avatar"></div>
    <div class="body">
      <div data-testid="User-Name">
        <a href="/${esc(post.handle)}"><span class="name">${esc(post.name)}</span></a>
        <a href="/${esc(post.handle)}"><span class="handle">@${esc(post.handle)}</span></a>
      </div>
      ${textMarkup}
      ${mediaMarkup}
      ${quoteMarkup}
      <div class="meta">
        <a href="/${esc(post.handle)}/status/${post.id}">
          <time datetime="2026-01-01T00:00:00.000Z">1月1日</time>
        </a>
      </div>
    </div>`;

  return article;
}

/** 把一条帖子挂到时间线上；推广帖会被包进 placementTracking 容器 */
export function mountPost(container, post) {
  const node = renderPost(post);
  if (post.promoted) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-testid', 'placementTracking');
    wrapper.appendChild(node);
    container.appendChild(wrapper);
    return wrapper;
  }
  container.appendChild(node);
  return node;
}
