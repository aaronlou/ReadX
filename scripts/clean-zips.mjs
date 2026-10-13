#!/usr/bin/env node
/**
 * 打包前清掉 `.output` 里旧的压缩包。
 *
 * 为什么需要：WXT 按版本号给压缩包命名，所以**每次升版本都会多出一个**，
 * 旧的不会自己消失。开发者后台里要从文件选择器挑一个上传，一堆
 * `readx-0.1.0` / `0.1.1` / `0.1.2` 摆在一起很容易挑错 ——
 * 而挑错的报错信息（"版本号必须大于线上版本"）根本不会提示你选错了文件。
 *
 * 挂在 npm 的 `prezip` 钩子上，跑 `npm run zip` 时自动执行。
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(new URL('..', import.meta.url).pathname, '.output');
if (!existsSync(OUT)) process.exit(0);

const stale = readdirSync(OUT).filter((name) => name.endsWith('.zip'));
for (const name of stale) {
  rmSync(join(OUT, name));
  console.log(`  已清理旧压缩包：${name}`);
}
