/**
 * 云语音服务商的接口域名。
 *
 * ⚠️ **这个文件必须保持零依赖，不要 import 任何东西。**
 *
 * 原因：`wxt.config.ts` 要在 Node 里用 jiti 加载它来生成
 * `optional_host_permissions`，而 jiti 解析不了 `#imports`、`@/` 这类
 * WXT/构建期别名。一旦这里（或它的依赖链上）出现运行时代码 ——
 * 比如本地化用的 `@/i18n` —— `wxt build` 和 `vitest` 会直接起不来，
 * 报一个和真实原因毫不相干的 `Cannot find module '#imports'`。
 *
 * 所以"服务商有哪些域名"这件事被单独放在这里：它同时被构建期
 * （生成权限清单）和运行期（各 spec 声明自己的 origin）使用，
 * 但两侧都对它没有额外依赖。
 */
export const PROVIDER_ORIGINS = {
  openrouter: 'https://openrouter.ai/*',
  openai: 'https://api.openai.com/*',
  doubao: 'https://openspeech.bytedance.com/*',
} as const;

/** 去重后的全部域名，直接作为 optional_host_permissions */
export const CLOUD_TTS_ORIGINS: string[] = [...new Set(Object.values(PROVIDER_ORIGINS))];
