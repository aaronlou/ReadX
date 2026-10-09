import { browser } from '#imports';

/**
 * ⚠️ **不能在模块加载时把 `browser.i18n.getMessage` 抓成一个常量。**
 *
 * 那样拿到的是当时的函数引用，之后谁再替换 `browser.i18n.getMessage`
 * 都不会生效 —— 测试的 i18n mock 就是这么被架空的：测试全绿，实际
 * 一条文案都没验证到，断言拿到的全是 key。所以每次调用都重新取一次。
 *
 * 另外 WXT 会把 key 参数窄化成一个字面量联合，我们的 key 是普通字符串，
 * 套不上，所以这里要放宽类型。那条类型只能保证"写下来的 key 存在"，
 * 保证不了"源码里用到的 key 都存在" —— 后者由 `i18n.test.ts` 用真实
 * 扫描来守，比类型检查更严格。
 */
function getMessage(key: string): string {
  const fn = browser.i18n.getMessage as unknown as (name: string) => string;
  return fn(key);
}

/**
 * 取一条本地化文案。
 *
 * Chrome 的 `i18n.getMessage()` 在**找不到 key 时返回空字符串**，而不是报错。
 * 直接用它的话，漏翻译的后果是界面上凭空少一句话或一个按钮 ——
 * 用户说不清哪里不对，我们也很难定位。
 *
 * ## 为什么自己实现占位符替换，而不用 Chrome 的
 *
 * ⚠️ Chrome 的占位符替换会**破坏紧随其后的那个字符**。最小复现（实测）：
 *
 *     "$p1$ 凭据"    →  "X凭据"      空格被吃掉
 *     "$p1$。后面"   →  "X��后面"    中文标点变成乱码
 *     "$p1$ 后面"    →  "X后面"
 *     "纯文本。没有占位符" → 正常（没有占位符就没事）
 *
 * 也就是说每条"值在句首"的文案在中文界面下都会缺字符或出乱码。
 * 换成 Chrome 不认识的 `{0}`、`{1}` 记号后，取到的原文**原样完好**，
 * 再由这里做替换 —— 完全绕开那个 bug。
 *
 * 代价是不能用 `messages.json` 的 `placeholders` 字段，替换逻辑得自己写。
 * 好处是行为可预测、可测试（`i18n.test.ts` 会校验记号完整性和两种语言一致）。
 */
export function t(key: string, substitutions?: string | string[]): string {
  let template = '';
  try {
    // 刻意**不**把 substitutions 交给 Chrome，见上面
    template = getMessage(key);
  } catch {
    // 极少数环境下 i18n 不可用（比如单元测试），退回显示 key
    template = '';
  }

  if (!template) {
    console.warn(`[ReadX] 缺少 i18n 文案：${key}`);
    return key;
  }

  return fill(template, substitutions);
}

/**
 * 把 `{0}`、`{1}` 换成实际值。
 *
 * 下标越界时**保留记号**而不是替换成空串 —— 那样"参数传少了"会在界面上
 * 直接暴露成 `{2}`，比悄悄少一段字容易发现得多。
 */
export function fill(template: string, substitutions?: string | string[]): string {
  if (substitutions === undefined) return template;

  const subs = typeof substitutions === 'string' ? [substitutions] : substitutions;
  return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
    const i = Number(index);
    return i < subs.length ? (subs[i] ?? '') : whole;
  });
}

/**
 * 本地化 manifest 字段用。
 * 和 `t()` 的区别：它不告警 —— 那些 key 由构建期注入，运行时拿不到属正常。
 */
export function msg(key: string): string {
  return `__MSG_${key}__`;
}
