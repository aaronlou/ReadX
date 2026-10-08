import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * 正式环境只注入 X 的两个域名，保持权限最小化，方便商店审核。
 * 开发环境额外注入本地 mock 时间线，这样不用登录 x.com 也能调试。
 */
const X_MATCHES = ['*://x.com/*', '*://twitter.com/*'];
const DEV_MATCHES = [...X_MATCHES, '*://localhost/*', '*://127.0.0.1/*'];

export default defineConfig({
  // 源码集中在 src/，WXT 内置的 `@` 别名正好指向 srcDir，
  // 于是所有内部引用都可以写成 `@/core/reader`。
  srcDir: 'src',

  modules: ['@wxt-dev/module-react'],

  manifest: (env) => ({
    name: 'ReadX',
    description: '自动滚动定位 X 帖子，并按帖子语言自动选择音色朗读。',
    permissions: ['storage'],
    host_permissions: env.mode === 'development' ? DEV_MATCHES : X_MATCHES,
    commands: {
      'toggle-reading': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: '开始 / 暂停朗读',
      },
      'next-post': {
        suggested_key: { default: 'Alt+Shift+N' },
        description: '跳到下一个帖子',
      },
      'prev-post': {
        suggested_key: { default: 'Alt+Shift+B' },
        description: '回到上一个帖子',
      },
    },
  }),

  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
