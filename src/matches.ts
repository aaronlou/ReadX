/**
 * 内容脚本的注入范围，以及扩展的 host_permissions。
 *
 * 这份列表是**唯一真相**：`wxt.config.ts` 和各个入口都从这里取，
 * 免得新增域名时漏改某一处。
 */
export const X_MATCHES = ['*://x.com/*', '*://twitter.com/*'];

/**
 * 开发环境额外包含本地 mock 时间线（`npm run mock`），
 * 这样不用登录 x.com 也能调试滚动 / 提取 / 朗读。
 */
export const DEV_MATCHES = [...X_MATCHES, '*://localhost/*', '*://127.0.0.1/*'];
