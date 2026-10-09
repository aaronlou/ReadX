import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // WxtVitest 会按 wxt.config.ts 配置好 `@/` 别名、`#imports` 和假的 browser API
  plugins: await WxtVitest(),
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    // 让 t() 在测试里能真的取到文案（假 browser 的 i18n 恒返回空串）
    setupFiles: ['./src/test/setup.ts'],
  },
});
