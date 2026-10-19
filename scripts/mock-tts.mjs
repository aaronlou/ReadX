#!/usr/bin/env node
/**
 * 一个**假的 OpenAI 兼容 TTS 服务**，只用于端到端测试。
 *
 *   node scripts/mock-tts.mjs            # 监听 8899
 *   MOCK_TTS_PORT=9000 node scripts/mock-tts.mjs
 *
 * 为什么要这个：ReadX 新增了「本地语音服务」provider，而真跑一个 Kokoro
 * 需要 Docker + 几百 MB 模型，不适合放进自动化测试。这个假服务实现了同样的
 * 接口形状（`POST /v1/audio/speech`），于是可以在**真浏览器里**验证整条链路：
 * 扩展 → background → provider → 这里的音频 → 播放器。
 *
 * 它不是 mock 掉 fetch，而是真的监听 HTTP —— 所以 base URL 拼接、请求头、
 * 请求体、响应解析、音频解码这些环节全都真的走了一遍。
 *
 * `GET /__stats` 返回已收到的请求，测试用它断言"确实合成过"。
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_TTS_PORT ?? 8899);

let requestCount = 0;
let lastBody = null;
let lastPath = null;

/**
 * 生成一小段 16-bit 单声道 WAV。
 *
 * 用正弦波而不是静音：静音的音频时长可能被某些解码器判成 0，
 * 那样"有没有真的播起来"就说不清了。
 */
function makeWav({ seconds = 0.4, freq = 440, rate = 24000 } = {}) {
  const samples = Math.floor(rate * seconds);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt 块长度
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 单声道
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); // 字节率
  buffer.writeUInt16LE(2, 32); // 块对齐
  buffer.writeUInt16LE(16, 34); // 位深
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples; i += 1) {
    // 音量压到 0.15，测试时不会突然很吵
    const value = Math.sin((2 * Math.PI * freq * i) / rate) * 0.15 * 32767;
    buffer.writeInt16LE(Math.round(value), 44 + i * 2);
  }
  return buffer;
}

/** 每请求生成一次，避免共享同一个 Buffer 被并发改写 */
const WAV_CACHE = makeWav();

const server = createServer((req, res) => {
  // 浏览器里的扩展是跨源请求，必须带 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requests: requestCount, lastBody, lastPath }));
    return;
  }

  if (url.pathname === '/__reset') {
    requestCount = 0;
    lastBody = null;
    lastPath = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // Kokoro-FastAPI 有这个接口；列出来是为了以后能改成动态音色列表
  if (url.pathname === '/v1/audio/voices') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ voices: [{ id: 'mock_voice', name: 'Mock' }] }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        lastBody = JSON.parse(raw);
      } catch {
        lastBody = { __unparsable: raw.slice(0, 200) };
      }
      lastPath = url.pathname;
      requestCount += 1;

      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': WAV_CACHE.length,
      });
      res.end(WAV_CACHE);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `no route: ${url.pathname}` } }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`  mock TTS 监听 http://localhost:${PORT}/v1`);
});
