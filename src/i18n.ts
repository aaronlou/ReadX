import { browser } from '#imports';

/**
 * WXT 会扫描 default locale，把 `getMessage` 的 key 参数窄化成一个**字面量联合**。
 * 我们的 key 是跨文件、拼装出来的普通字符串，套那个窄类型根本没法调用。
 *
 * 而且那个类型只能保证"写下来的 key 存在"，保证不了"源码里用到的 key 都存在"。
 * 后者由 `src/i18n.test.ts` 用真实扫描来守 —— 它会同时核对两种语言的 key 集合、
 * 空文案、以及 wxt.config 里 `__MSG_*__` 引用的 key，比类型检查更严格。
 * 所以这里放宽类型是安全的，不是偷懒。
 */
const getMessage = browser.i18n.getMessage as unknown as (
  key: string,
  substitutions?: string | string[],
) => string;

/**
 * 取一条本地化文案。
 *
 * Chrome 的 `i18n.getMessage()` 在**找不到 key 时返回空字符串**，而不是报错。
 * 直接用它的话，漏翻译的后果是界面上凭空少一句话或一个按钮 ——
 * 用户说不清哪里不对，我们也很难定位。
 *
 * 所以这里做两件事：
 *   1. 缺失时回退成 key 本身，界面上至少能看出"这里漏了 popup.engine"
 *   2. 控制台告警，开发时立刻能发现
 */
export function t(key: string, substitutions?: string | string[]): string {
  let message = '';
  try {
    message = getMessage(key, substitutions);
  } catch {
    // 极少数环境下 i18n 不可用（比如单元测试），退回显示 key
    message = '';
  }

  if (message) return message;

  console.warn(`[ReadX] 缺少 i18n 文案：${key}`);
  return key;
}

/**
 * 本地化 manifest 字段用。
 * 和 `t()` 的区别：它不告警 —— 那些 key 由构建期注入，运行时拿不到属正常。
 */
export function msg(key: string): string {
  return `__MSG_${key}__`;
}
