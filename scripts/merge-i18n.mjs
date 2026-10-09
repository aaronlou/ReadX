#!/usr/bin/env node
/**
 * 把各区域的 i18n 文案片段合并进 _locales。
 *
 * 字符串抽取是按区域并行做的，每个区域产出 .i18n-fragments/<区域>.<lang>.json。
 * 这个脚本负责合并，并且**在合并前先报出两边的 key 差集** ——
 * 某个区域漏翻了某一条，在这里就能看见，而不用等测试失败再去猜是哪个文件。
 *
 * 幂等：可以反复运行。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FRAGMENTS = join(ROOT, '.i18n-fragments');

/**
 * locale 目录名和片段文件名后缀**不是一回事**：
 * 目录要用 Chrome 认的 `zh_CN`，而片段是子代理按人读得懂的方式命名的 `.zh.json`。
 * 这个映射写错的话，中文那份会被静默当成"没有片段"。
 */
const LOCALES = [
  { dir: 'en', suffix: 'en' },
  { dir: 'zh_CN', suffix: 'zh' },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 收集某个语言的所有片段 */
function collectFragments(suffix) {
  if (!existsSync(FRAGMENTS)) return { merged: {}, files: [] };

  const merged = {};
  const files = readdirSync(FRAGMENTS).filter((f) => f.endsWith(`.${suffix}.json`)).sort();

  for (const file of files) {
    const entries = readJson(join(FRAGMENTS, file));
    const collisions = Object.keys(entries).filter((k) => k in merged);
    if (collisions.length) {
      console.warn(`  ⚠️  ${file} 覆盖了已有的 key：${collisions.join(', ')}`);
    }
    Object.assign(merged, entries);
  }
  return { merged, files };
}

const collected = {};
for (const locale of LOCALES) collected[locale.dir] = collectFragments(locale.suffix);

// 先报差集 —— 这是这个脚本存在的主要理由
const [a, b] = LOCALES.map((l) => l.dir);
const keysA = new Set(Object.keys(collected[a].merged));
const keysB = new Set(Object.keys(collected[b].merged));
const onlyA = [...keysA].filter((k) => !keysB.has(k));
const onlyB = [...keysB].filter((k) => !keysA.has(k));

console.log(
  `片段文件：${collected[a].files.length + collected[b].files.length} 个` +
    `（${a} ${collected[a].files.length} / ${b} ${collected[b].files.length}）`,
);
console.log(`片段 key 数：${a} ${keysA.size} / ${b} ${keysB.size}`);

if (onlyA.length || onlyB.length) {
  console.log('');
  if (onlyA.length) {
    console.log(`  ❌ 只有 ${a} 有（${onlyA.length} 个）：`);
    console.log(`     ${onlyA.slice(0, 10).join(', ')}${onlyA.length > 10 ? ' …' : ''}`);
  }
  if (onlyB.length) {
    console.log(`  ❌ 只有 ${b} 有（${onlyB.length} 个）：`);
    console.log(`     ${onlyB.slice(0, 10).join(', ')}${onlyB.length > 10 ? ' …' : ''}`);
  }
  console.log('');
  console.log('  两边必须一一对应，先补齐再合并。');
  process.exit(1);
}

// 合并进 _locales（保留已有的 manifest key）
for (const { dir } of LOCALES) {
  const path = join(ROOT, 'public', '_locales', dir, 'messages.json');
  const existing = existsSync(path) ? readJson(path) : {};
  const merged = { ...existing, ...collected[dir].merged };

  const sorted = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];

  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`  ✓ public/_locales/${dir}/messages.json → ${Object.keys(sorted).length} 条`);
}
