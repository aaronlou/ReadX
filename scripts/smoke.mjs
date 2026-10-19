#!/usr/bin/env node
/**
 * 端到端冒烟测试。
 *
 *   npm run smoke           # 中英两种语言各跑一遍 + 验证正式包
 *   npm run smoke -- zh     # 只跑中文
 *
 * ## 为什么需要这一层
 *
 * 单元测试和真实浏览器之间有一条缝，**上一轮掉的三个 bug 全在这条缝里**：
 *
 *   - i18n 的 key 含点号        → 扩展根本装载不了
 *   - 用了裸 `$1$` 占位符       → 扩展根本装载不了
 *   - Chrome 的占位符替换损坏字符 → 中文标点变乱码
 *
 * 三个都通过了构建、tsc 和 178 个单元测试 —— 因为测试直接读 messages.json，
 * 绕过了 Chrome。所以必须有一个"真的装进浏览器、真的点一下"的检查。
 *
 * 这个脚本同时覆盖两种语言：中英各跑一遍，因为 i18n 的 bug 往往只在
 * 某一种语言下出现（上面第三条就只在中文下暴露）。
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOCK_URL,
  attachToPage,
  collectErrors,
  enableLogging,
  ensureMockServer,
  ensureMockTtsServer,
  mockTtsStats,
  resetMockTts,
  launchWithExtension,
  sleep,
  stopMockServer,
  waitFor,
} from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const BUILD = join(ROOT, '.output', 'chrome-mv3-screenshot');
const PROFILE = join(ROOT, '.smoke-profile');
const STAGING = join(ROOT, '.smoke-extension');
const PORT = 9336;

// ---------------------------------------------------------------- 断言

const failures = [];
let checks = 0;

function check(ok, label, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`    ✓ ${label}`);
  } else {
    console.log(`    ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

// ---------------------------------------------------------------- 页面检查

/** 控制条面板里所有可见文字 */
// 取控制条上真正的文案。
//
// 两个坑：
//   - shadow root 的 `textContent` 把注入的 <style> 也算进去了，
//     断言可能匹配到 CSS 里的词
//   - 宿主元素的 `innerText` 不会穿透 shadow 边界，拿到的是空串
// 所以收集所有叶子节点的文本，并把 STYLE/SCRIPT 排除掉。
const OVERLAY_TEXT = `
  (() => {
    const root = document.querySelector('readx-overlay')?.shadowRoot;
    if (!root) return null;
    return [...root.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && !/^(STYLE|SCRIPT)$/.test(el.tagName))
      .map((el) => el.textContent ?? '')
      .join(' ')
      .replace(/\\s+/g, ' ')
      .trim();
  })()
`;

/** 从 shadow DOM 里点一个按钮 */
const clickInOverlay = (pattern) => `
  (() => {
    const root = document.querySelector('readx-overlay')?.shadowRoot;
    if (!root) return 'no-overlay';
    const btn = [...root.querySelectorAll('button')].find((b) =>
      ${pattern}.test(b.getAttribute('aria-label') || b.title || b.textContent || ''),
    );
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()
`;

async function checkPage(cdp, { locale, name, url, expectOverlay }) {
  console.log(`  [${name}]`);
  const errors = collectErrors(cdp);
  await enableLogging(cdp);

  await cdp.send('Page.navigate', { url });
  const loaded = await waitFor(cdp, 'document.readyState === "complete"', { label: '加载' });
  check(loaded, '页面加载完成');

  if (expectOverlay) {
    const injected = await waitFor(cdp, '!!document.querySelector("readx-overlay")', {
      timeout: 8000,
    });
    check(injected, '扩展的内容脚本已注入');
  } else {
    await sleep(1200);
  }

  // 关键：文案里**不能残留 {0} 这种没被替换掉的记号**。
  // 那意味着某处调用 t() 时少传了参数 —— 用户会直接看到 {1}。
  const text = (await cdp.eval('document.body.innerText')) ?? '';
  const leaked = [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]);
  check(leaked.length === 0, '界面上没有残留的 {N} 记号', leaked.slice(0, 3).join(' '));

  // 也不能出现 i18n 的 key 本身（说明 getMessage 取不到）
  const keyLike = [...text.matchAll(/\b[a-z]+_[a-zA-Z]+(?:\b|_)/g)]
    .map((m) => m[0])
    .filter((k) => /^(popup|options|overlay|reader|provider|tts|bg|probe|cloudTts|engineSwitch|translate|content)_/.test(k));
  check(keyLike.length === 0, '界面上没有裸露的 i18n key', keyLike.slice(0, 3).join(' '));

  check(errors.length === 0, '控制台没有报错', errors.slice(0, 2).join(' | '));
  return errors;
}

// ---------------------------------------------------------------- 单次跑

async function run({ locale, stripLocales }) {
  console.log(`\n[${locale}]`);

  rmSync(STAGING, { recursive: true, force: true });
  cpSync(BUILD, STAGING, { recursive: true });
  for (const extra of stripLocales) {
    rmSync(join(STAGING, '_locales', extra), { recursive: true, force: true });
  }

  const { extId, close } = await launchWithExtension({
    port: PORT,
    profile: PROFILE,
    extensionPath: STAGING,
  });
  console.log(`  扩展已装载：${extId}`);

  const cdp = await attachToPage(PORT);
  await cdp.send('Runtime.enable');

  // 收集全程的错误，最后统一断言
  const allErrors = collectErrors(cdp);
  await enableLogging(cdp);

  try {
    // ---------- 1. 时间线 + 朗读流程 ----------
    console.log('  [timeline]');
    await cdp.send('Page.navigate', { url: MOCK_URL });
    check(await waitFor(cdp, 'document.readyState === "complete"', { label: '加载' }), '页面加载完成');
    check(
      await waitFor(cdp, '!!document.querySelector("readx-overlay")', { timeout: 8000 }),
      '内容脚本已注入',
    );

    const idleText = (await cdp.eval(OVERLAY_TEXT)) ?? '';
    check(idleText.length > 0, '控制条已渲染');

    // 控制条上的下拉框：朗读语言 + 「跳过短帖」阈值 = 2 个。
    // 加新下拉却忘了接到 UI 上，这里会立刻发现。
    const selectCount = await cdp.eval(`
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        return root ? root.querySelectorAll('select').length : 0;
      })()
    `);
    check(selectCount >= 2, '控制条上有朗读语言 + 跳过短帖两个下拉框', `实际 ${selectCount} 个`);
    check(/\d/.test(idleText) || idleText.length > 20, '控制条有实际文案（不是空壳）');

    // 关掉引导卡，免得挡住按钮
    await cdp.eval(clickInOverlay('/got it|知道了|明白了/i'));
    await sleep(400);

    // 点播放
    const clicked = await cdp.eval(clickInOverlay('/play|pause|播放|暂停/i'));
    check(clicked === 'clicked', '找到并点击了播放按钮', clicked);

    await sleep(2500);
    const readingText = (await cdp.eval(OVERLAY_TEXT)) ?? '';
    check(readingText !== idleText, '状态从待机变成了朗读中');

    // 真正在朗读：面板上应该出现帖子的正文
    const sentence = await cdp.eval(`
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        const lines = [...(root?.querySelectorAll('p, div') ?? [])]
          .map((e) => e.textContent?.trim() ?? '')
          .filter((t) => t.length > 12);
        return lines[0] ?? '';
      })()
    `);
    check(Boolean(sentence), '面板上显示了正在朗读的句子', JSON.stringify(sentence).slice(0, 40));

    // 焦点高亮：Reader 在 shadow DOM 里画一个跟随当前帖子的框。
    //
    // 两个踩过的坑：
    //   1. 必须查 shadowRoot —— 它不在 light DOM 里，用 document.querySelectorAll
    //      查不到，会误报成"功能缺失"
    //   2. **不能按颜色匹配**。Tailwind v4 输出的是 `oklab(...)` 而不是 `rgb(...)`，
    //      按 `rgb(52, 211, 153)` 匹配永远匹配不上。改成按"2px 描边 + 帖子大小的框"
    //      来判断，和配色方案解耦。
    const highlighted = await cdp.eval(`
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        if (!root) return false;
        return [...root.querySelectorAll('div')].some((e) => {
          const s = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          return (
            parseFloat(s.borderTopWidth) >= 2 &&
            r.width > 100 &&
            r.height > 40 &&
            r.height < window.innerHeight * 0.9
          );
        });
      })()
    `);
    check(highlighted, '正在朗读的帖子有高亮框（shadow DOM 内）');

    // 朗读在推进：等一会儿，文字应该变了
    await sleep(4000);
    const laterText = (await cdp.eval(OVERLAY_TEXT)) ?? '';
    check(laterText !== readingText, '朗读在继续推进（文案已变化）');

    // 停掉，免得后续页面被朗读干扰
    await cdp.eval(clickInOverlay('/stop|停止/i'));
    await sleep(500);

    // ---------- 关闭控制条 + 持久化 + 能恢复 ----------
    //
    // 这是用户实际反馈的问题：装了扩展之后控制条就赖在每个 x.com 页面上，
    // 折叠按钮只能把它缩成一行，**没有任何办法让它彻底消失**，不卸载就去不掉。
    // 三件事缺一不可：
    //   1. ✕ 能让它真的从页面上消失
    //   2. **刷新之后仍然是关着的** —— 设置没持久化的话这条会挂
    //   3. 能从 popup 里再打开（否则关掉就成了不可逆操作）
    console.log('  [hide / persist / restore]');

    /** 控制条是否已经不在页面上 */
    const overlayGone = `
      (() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        if (!root) return true;
        return root.querySelectorAll('button').length === 0;
      })()
    `;

    const hidden = await cdp.eval(clickInOverlay('/hide|隐藏/i'));
    check(hidden === 'clicked', '找到并点击了隐藏按钮', hidden);
    await sleep(700);
    check(await cdp.eval(overlayGone), '控制条已从页面上消失');

    await cdp.send('Page.reload');
    await waitFor(cdp, 'document.readyState === "complete"', { label: '重新加载' });
    await sleep(1800);
    check(await cdp.eval(overlayGone), '刷新之后仍然是关着的（设置已持久化）');

    // 从 popup 恢复
    await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/popup.html` });
    await waitFor(cdp, 'document.readyState === "complete"', { label: 'popup' });
    await sleep(1000);

    const toggled = await cdp.eval(`
      (() => {
        const label = [...document.querySelectorAll('label')].find((l) =>
          /show the reading bar|显示控制条/i.test(l.textContent || ''));
        const box = label?.querySelector('input[type="checkbox"]');
        if (!box) return 'no-toggle';
        if (!box.checked) box.click();
        return 'clicked';
      })()
    `);
    check(toggled === 'clicked', '在 popup 里找到了控制条开关', toggled);
    await sleep(700);

    // 回到时间线，确认它真的回来了
    await cdp.send('Page.navigate', { url: MOCK_URL });
    await waitFor(cdp, 'document.readyState === "complete"', { label: '时间线' });
    const restored = await waitFor(
      cdp,
      `(() => {
        const root = document.querySelector('readx-overlay')?.shadowRoot;
        return !!root && root.querySelectorAll('button').length > 0;
      })()`,
      { timeout: 8000 },
    );
    check(restored, '从 popup 打开后控制条恢复了');

    // ---------- 本地语音服务：整条云端链路 ----------
    //
    // 这是唯一会真的发 HTTP 出去的一段：扩展 → background → provider →
    // localhost 上的假 TTS 服务 → 音频 → 播放器。
    //
    // 真跑 Kokoro 需要 Docker + 几百 MB 模型，不适合放进自动化测试；
    // 但假服务实现的是同样的接口形状，所以 base URL 拼接、请求体、
    // 响应解析、音频解码这些环节都是真的走了一遍。
    console.log('  [local tts]');

    await resetMockTts();

    // 直接把设置写进 storage —— 比在设置页里点一堆控件稳得多
    await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options.html` });
    await waitFor(cdp, 'document.readyState === "complete"', { label: 'options' });
    await sleep(800);

    const configured = await cdp.eval(`
      (async () => {
        const current = (await chrome.storage.sync.get('settings')).settings ?? {};
        await chrome.storage.sync.set({
          settings: { ...current, ttsEngine: 'cloud', cloudProvider: 'local' },
        });
        await chrome.storage.local.set({
          cloudCredentials: { local: { baseUrl: 'http://localhost:8899/v1' } },
        });
        return true;
      })()
    `);
    check(configured === true, '把朗读引擎切到本地语音服务');

    // 回到时间线，点播放
    await cdp.send('Page.navigate', { url: MOCK_URL });
    await waitFor(cdp, 'document.readyState === "complete"', { label: '时间线' });
    await waitFor(cdp, '!!document.querySelector("readx-overlay")', { timeout: 8000 });
    await sleep(1200);

    await cdp.eval(clickInOverlay('/got it|知道了|明白了/i'));
    await sleep(400);
    const localPlayed = await cdp.eval(clickInOverlay('/play|pause|播放|暂停/i'));
    check(localPlayed === 'clicked', '在本地服务模式下点了播放', localPlayed);
    await sleep(3500);

    const stats = await mockTtsStats();
    check(stats.requests > 0, '假 TTS 服务收到了合成请求', `requests=${stats.requests}`);
    check(
      typeof stats.lastBody?.input === 'string' && stats.lastBody.input.length > 0,
      '请求体带上了要念的文本',
      JSON.stringify(stats.lastBody)?.slice(0, 120),
    );
    check(stats.lastPath === '/v1/audio/speech', '请求打到了 /v1/audio/speech', stats.lastPath);

    const speakingNow = await cdp.eval(OVERLAY_TEXT);
    check(
      /speaking|reading|朗读|正在读/i.test(speakingNow ?? ''),
      '拿到音频后进入了朗读状态',
      (speakingNow ?? '').slice(0, 80),
    );

    // 换回系统音色，免得影响后面的检查
    await cdp.eval(clickInOverlay('/stop|停止/i'));

    // ---------- 2. 选项页 ----------
    await checkPage(cdp, {
      locale,
      name: 'options',
      url: `chrome-extension://${extId}/options.html`,
      expectOverlay: false,
    });

    // ---------- 3. popup ----------
    await checkPage(cdp, {
      locale,
      name: 'popup',
      url: `chrome-extension://${extId}/popup.html`,
      expectOverlay: false,
    });

    // 「跳过短帖」的阈值选择器要真的渲染在 popup 上
    const hasThreshold = await cdp.eval(`
      (() => {
        const label = [...document.querySelectorAll('label')].find((l) =>
          /skip short posts|跳过短帖/i.test(l.textContent || ''));
        const sel = label?.querySelector('select');
        return sel ? sel.options.length : 0;
      })()
    `);
    check(hasThreshold >= 5, 'popup 上有跳过短帖的阈值选择器', `选项 ${hasThreshold} 个`);

    // ---------- 4. 全程无报错 ----------
    check(allErrors.length === 0, '全程控制台无报错', allErrors.slice(0, 2).join(' | '));
  } finally {
    cdp.close();
    await close();
    rmSync(STAGING, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 生产包检查

/**
 * 单独验证**正式包**。
 *
 * 上面所有检查跑的都是 screenshot 构建 —— 它的 manifest 多匹配了 localhost，
 * 而真正要提交的是 `.output/chrome-mv3`。两者的 manifest 不同，
 * 所以正式包必须单独确认一次"能装载 + 权限清单是对的"。
 *
 * 这一步很实在：i18n 那两个 bug 就是让扩展**完全装载不了**，
 * 而当时没有任何检查覆盖"正式包能不能装"。
 */
async function checkReleaseBuild(port, profile) {
  console.log('\n[release build]');

  const manifestPath = join(ROOT, '.output', 'chrome-mv3', 'manifest.json');
  if (!existsSync(manifestPath)) {
    check(false, '正式包存在（先跑 npm run build）');
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  check(manifest.default_locale === 'en', 'default_locale 是 en');
  check(
    typeof manifest.name === 'string' && manifest.name.startsWith('__MSG_'),
    'name 走 __MSG_ 本地化',
  );
  check(
    typeof manifest.description === 'string' && manifest.description.startsWith('__MSG_'),
    'description 走 __MSG_ 本地化',
  );

  const matches = manifest.content_scripts?.[0]?.matches ?? [];
  check(
    matches.every((m) => /x\.com|twitter\.com/.test(m)),
    '内容脚本只匹配 x.com / twitter.com（不含 localhost）',
    matches.join(' '),
  );

  check(
    JSON.stringify(manifest.permissions) === '["storage"]',
    '只要 storage 一个权限',
    JSON.stringify(manifest.permissions),
  );

  check(
    Array.isArray(manifest.optional_host_permissions) &&
      manifest.optional_host_permissions.length > 0,
    '云语音域名在 optional_host_permissions 里',
  );

  // 真的装一次 —— 这是唯一能确认 Chrome 认可这份 manifest 的办法
  try {
    const prod = await launchWithExtension({
      port,
      profile,
      extensionPath: join(ROOT, '.output', 'chrome-mv3'),
    });
    check(Boolean(prod.extId), '正式包能被 Chrome 装载', prod.extId);
    await prod.close();
  } catch (error) {
    check(false, '正式包能被 Chrome 装载', error.message);
  }
}

// ---------------------------------------------------------------- 主流程

async function main() {
  if (!existsSync(BUILD)) {
    console.error(`找不到构建产物：${BUILD}\n先跑 \`npm run smoke\`（它会自动构建）。`);
    process.exit(1);
  }

  const server = await ensureMockServer(ROOT);
  const ttsServer = await ensureMockTtsServer(ROOT);
  const only = process.argv[2];

  const runs = [
    { locale: 'zh', stripLocales: [] },
    { locale: 'en', stripLocales: ['zh_CN'] },
  ].filter((r) => !only || r.locale === only);

  try {
    for (const run_ of runs) await run(run_);
    // 正式包只需要验一次，和语言无关
    await checkReleaseBuild(PORT + 1, PROFILE);
  } finally {
    rmSync(PROFILE, { recursive: true, force: true });
    await stopMockServer(server);
    await stopMockServer(ttsServer);
  }

  console.log(`\n${failures.length ? '✗' : '✓'} ${checks - failures.length}/${checks} 项通过`);
  if (failures.length) {
    console.log('失败项：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('冒烟测试失败：', error.message);
  process.exit(1);
});
