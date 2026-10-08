#!/usr/bin/env node
/**
 * 给 playground/mock-timeline.html 用的零依赖静态服务器。
 *
 *   npm run mock        → http://localhost:5174
 *
 * 为什么需要它：开发环境的内容脚本匹配 *://localhost/*，
 * 这样不用登录 x.com 就能调试滚动、提取、语种识别和朗读。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../playground', import.meta.url));
const PORT = Number(process.env.PORT ?? 5174);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = url.pathname === '/' ? '/mock-timeline.html' : url.pathname;

  // 防目录穿越：解析后必须仍在 playground/ 里
  const resolved = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(resolved);
    res.writeHead(200, { 'content-type': MIME[extname(resolved)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`ReadX mock 时间线：http://localhost:${PORT}`);
  console.log('按 Ctrl+C 停止。');
});
