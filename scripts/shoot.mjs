#!/usr/bin/env node
/**
 * 用 CDP 自动截商店要的图。
 *
 *   npm run shoot                  # 中英两套（商店用，1280×800）
 *   npm run shoot:social           # 英文一套 16:9（发 X 用，1600×900）
 *   node scripts/shoot.mjs en      # 只出英文那套
 *
 * Chrome Web Store 的 listing 可以**按语言分别上传截图**，所以这里出两套：
 *   store/screenshots/en/   ← 给英文 listing
 *   store/screenshots/zh/   ← 给中文 listing
 *
 * 两个非显然的点（细节见 scripts/lib/cdp.mjs）：
 *   1. `--load-extension` 在 Chrome 137+ 被静默忽略，必须用 CDP 的
 *      `Extensions.loadUnpacked`
 *   2. macOS 上 Chrome 忽略 `--lang`，扩展语言跟系统走。要出英文图只能
 *      **把 zh_CN 语言包从构建里删掉**，逼它回落到 default locale
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachToPage, launchWithExtension, sleep, waitFor } from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = join(ROOT, 'store', 'screenshots');
const SOCIAL = join(ROOT, 'store', 'social');
const BUILD = join(ROOT, '.output', 'chrome-mv3-screenshot');
const PROFILE = join(ROOT, '.shot-profile');
const STAGING = join(ROOT, '.shot-extension');
const PORT = 9334;
const MOCK = 'http://localhost:5174/mock-timeline.html';

// 商店要 16:10；X 的时间线是 16:9，用 16:10 会被裁掉一点，所以社交图单独截
const SOCIAL_MODE = process.argv.includes('--social');
const WIDTH = SOCIAL_MODE ? 1600 : 1280;
const HEIGHT = SOCIAL_MODE ? 900 : 800;
const OUT_ROOT = SOCIAL_MODE ? SOCIAL : SHOTS;

async function capture({ locale, stripLocales }) {
  const outDir = join(OUT_ROOT, locale);
  mkdirSync(outDir, { recursive: true });

  rmSync(STAGING, { recursive: true, force: true });
  cpSync(BUILD, STAGING, { recursive: true });
  for (const extra of stripLocales) {
    rmSync(join(STAGING, '_locales', extra), { recursive: true, force: true });
  }

  const { extId, close } = await launchWithExtension({
    port: PORT,
    profile: PROFILE,
    extensionPath: STAGING,
    width: WIDTH,
    height: HEIGHT,
  });

  const cdp = await attachToPage(PORT, { width: WIDTH, height: HEIGHT });

  const shoot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`  ✓ ${locale}/${name}.png`);
  };

  /** 从控制条的 shadow DOM 里点一个按钮 */
  const clickInOverlay = (pattern) => `
    (() => {
      const root = document.querySelector('readx-overlay')?.shadowRoot;
      if (!root) return false;
      const btn = [...root.querySelectorAll('button')].find((b) =>
        ${pattern}.test(b.getAttribute('aria-label') || b.title || b.textContent || ''),
      );
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `;

  try {
    await cdp.send('Page.navigate', { url: MOCK });
    await waitFor(cdp, 'document.readyState === "complete"');
    if (!(await waitFor(cdp, '!!document.querySelector("readx-overlay")', { timeout: 8000 }))) {
      console.warn('  ⚠️  扩展没注入，截图里不会有控制条');
    }

    await sleep(1500);
    // 隐藏 mock 页面自己的调试横幅 —— 出现在商店截图里会显得像个测试页面
    await cdp.eval(`(() => { const b = document.querySelector('.banner'); if (b) b.style.display='none'; return !!b; })()`);
    await sleep(400);

    // 1. 引导卡：首次使用的说明，本身也是一张有价值的图
    await shoot('01-intro');

    // 2. 正在朗读：商店搜索结果里的封面图
    await cdp.eval(clickInOverlay('/got it|知道了|明白了/i'));
    await sleep(600);
    const played = await cdp.eval(clickInOverlay('/play|pause|播放|暂停/i'));
    console.log(`  已触发播放：${played}`);
    await sleep(3000);
    await shoot('02-reading');

    // 3. 设置页
    await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options.html` });
    await waitFor(cdp, 'document.readyState === "complete"');
    await sleep(1800);
    await shoot('03-settings');
  } finally {
    cdp.close();
    await close();
    rmSync(STAGING, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(BUILD)) {
    console.error(`找不到截图构建产物：${BUILD}\n先跑 \`npm run shoot\`（它会自动构建）。`);
    process.exit(1);
  }

  const only = process.argv.find((a) => a === 'en' || a === 'zh');
  const runs = (SOCIAL_MODE
    ? [{ locale: 'en', stripLocales: ['zh_CN'] }]
    : [
        { locale: 'zh', stripLocales: [] },
        { locale: 'en', stripLocales: ['zh_CN'] },
      ]
  ).filter((r) => !only || r.locale === only);

  for (const run of runs) {
    console.log(`\n[${run.locale}] 启动 headless Chrome…`);
    await capture(run);
  }

  rmSync(PROFILE, { recursive: true, force: true });
  console.log(`\n截图在 ${SOCIAL_MODE ? 'store/social/' : 'store/screenshots/'}（${WIDTH}×${HEIGHT}）`);
  if (!SOCIAL_MODE) console.log('  上传时：英文 listing 用 en/，中文 listing 用 zh/');
}

main().catch((error) => {
  console.error('截图失败：', error.message);
  process.exit(1);
});
