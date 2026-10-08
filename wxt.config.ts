import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { DEV_MATCHES, X_MATCHES } from './src/matches';

/**
 * `npm run dev` 拉起浏览器的能力由 web-ext 提供（WXT 在 import 失败时会
 * 静默退化成「手动加载」，所以 web-ext 是 devDependencies 里的必需项）。
 *
 * profile 必须是**持久化**的：Chrome 内置 AI 的语言包存在 profile 里，
 * 而 web-ext 默认用临时 profile —— 那样每次 npm run dev 都要重新下载
 * 一遍翻译模型（实测 12 秒）。
 *
 * 刻意放在 .output 之外：wxt clean 会整个删掉 .output，那样已下载的语言包就白下了。
 */
const CHROME_PROFILE = fileURLToPath(new URL('./.chrome-profile', import.meta.url));

// 必须先把目录建出来：web-ext 底层的 chrome-launcher 会直接往 profile 目录里
// 写 chrome-out.log，但它**不会自己创建目录**，目录不存在就 ENOENT 崩掉。
// 在这里建而不是用 predev 脚本，是为了让 `git clone` 后直接能跑，不依赖 shell 差异。
mkdirSync(CHROME_PROFILE, { recursive: true });

export default defineConfig({
  // 源码集中在 src/，WXT 内置的 `@` 别名正好指向 srcDir，
  // 于是所有内部引用都可以写成 `@/core/reader`。
  srcDir: 'src',

  modules: ['@wxt-dev/module-react'],

  webExt: {
    chromiumProfile: CHROME_PROFILE,
    keepProfileChanges: true,
  },

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
