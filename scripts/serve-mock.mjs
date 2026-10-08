#!/usr/bin/env node
/**
 * 给 playground/ 下的静态页面用的零依赖开发服务器。
 *
 *   npm run mock
 *     → 时间线 http://localhost:5174
 *     → 能力检测 http://localhost:5174/probe.html
 *
 * 为什么需要它：开发环境的内容脚本匹配 *://localhost/*，
 * 这样不用登录 x.com 就能调试滚动、提取、语种识别和朗读。
 *
 * 端口被占用时会自动往后找一个可用端口，而不是抛堆栈 ——
 * 忘了关掉上一次的服务器是最常见的情况，不该让人一脸懵。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../playground', import.meta.url));
const BASE_PORT = Number(process.env.PORT ?? 5174);
const MAX_PORT_TRIES = 10;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname === '/' ? '/mock-timeline.html' : url.pathname;

  // 防目录穿越：解析后必须仍在 playground/ 里
  const resolved = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(resolved);
    res.writeHead(200, {
      'content-type': MIME[extname(resolved)] ?? 'application/octet-stream',
      // 开发工具，别让浏览器缓存住旧版本
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch(() => {
        res.writeHead(500).end('Internal Error');
      });
    });

    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

let server = null;
let actualPort = BASE_PORT;

for (let port = BASE_PORT; port < BASE_PORT + MAX_PORT_TRIES; port += 1) {
  try {
    server = await tryListen(port);
    actualPort = port;
    break;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') {
      console.error('启动失败：', error.message);
      process.exit(1);
    }
  }
}

if (!server) {
  console.error(
    `端口 ${BASE_PORT} ~ ${BASE_PORT + MAX_PORT_TRIES - 1} 都被占用了。\n` +
      '先找出占用者：lsof -nP -iTCP:' + BASE_PORT + ' -sTCP:LISTEN\n' +
      '或者换个端口启动：PORT=6000 npm run mock',
  );
  process.exit(1);
}

if (actualPort !== BASE_PORT) {
  console.log(`端口 ${BASE_PORT} 已被占用（多半是上一次的 mock server 还在跑），已自动改用 ${actualPort}。`);
  console.log(`想腾出 ${BASE_PORT} 的话：kill $(lsof -nP -iTCP:${BASE_PORT} -sTCP:LISTEN -t)\n`);
}

console.log(`ReadX mock 时间线  http://localhost:${actualPort}`);
console.log(`能力检测页         http://localhost:${actualPort}/probe.html`);
console.log('\n按 Ctrl+C 停止。');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n正在关闭 mock server…');
    server.close(() => process.exit(0));
    // 有 keep-alive 连接挂着时 close() 不会立刻回调，兜个底
    setTimeout(() => process.exit(0), 800).unref();
  });
}
