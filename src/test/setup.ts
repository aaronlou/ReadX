import { beforeEach } from 'vitest';
import { browser } from '#imports';
import { en } from './i18n';

/**
 * 让单元测试里的 i18n 真的能取到文案。
 *
 * 假 browser 的 `i18n.getMessage()` 恒返回空串，于是 `t()` 会回退成 key。
 * 后果很隐蔽：所有断言用户可见文案的测试其实在比较
 * `provider.doubao.errRateLimited` 这种 key —— 看不出对错，
 * 也完全测不到真实文案。
 *
 * ⚠️ **必须同时装在顶层，不能只放 beforeEach。**
 * 服务商的 spec（`src/tts/providers/*.ts`）在**模块加载时**就把
 * `name` / `summary` / 凭据 label 这些文案算好存进对象了，而模块加载
 * 发生在任何 beforeEach 之前。只装在 beforeEach 里的话，spec 里那一批
 * 文案会永远固化成 key —— 而且测试会"看起来在跑、其实什么都没验证"。
 */
function install(): void {
  const target = browser.i18n as unknown as { getMessage?: unknown } | undefined;
  if (!target) return;

  target.getMessage = (key: string, substitutions?: string | string[]) => {
    try {
      return en(key, substitutions);
    } catch {
      // 找不到就返回空串，交给 t() 走"回退成 key + 告警"那条路
      return '';
    }
  };
}

// 顶层先装一次：spec 模块 import 时就会用到
install();

// 再在每个用例前装一次：有的测试文件会在 afterEach 里 restoreAllMocks()
beforeEach(install);
