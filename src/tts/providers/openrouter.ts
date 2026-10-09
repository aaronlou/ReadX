import { OPENAI_COMPATIBLE_VOICES } from './openai';
import {
  CloudTtsError,
  describeHttpFailure,
  type CloudTtsSpec,
  type SynthesizeRequest,
  type SynthesizeResult,
} from './types';

/**
 * OpenRouter 的语音合成。
 *
 *   POST https://openrouter.ai/api/v1/audio/speech
 *
 * 它的 TTS 接口是 **OpenAI 兼容**的，所以请求体和我们给 OpenAI 的完全一样，
 * 只是模型名带厂商前缀（`openai/gpt-4o-mini-tts-2025-12-15`）。
 *
 * 为什么值得单独做一个 spec：**一个 Key 就能用到多家的 TTS 模型**，
 * 包括 `bytedance-seed/seed-audio-1-0` —— 也就是豆包「音频生成」背后
 * 同一个模型。对拿不到火山引擎服务开通的人来说，这是最省事的路径。
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const ORIGIN = 'https://openrouter.ai/*';
const DEFAULT_MODEL = 'openai/gpt-4o-mini-tts-2025-12-15';

export const openrouterSpec: CloudTtsSpec = {
  id: 'openrouter',
  name: 'OpenRouter',
  summary: '一个 Key 用多家的模型，含 OpenAI 与豆包 Seed Audio',
  origins: [ORIGIN],
  credentials: [
    {
      key: 'apiKey',
      label: 'API Key',
      secret: true,
      placeholder: 'sk-or-v1-...',
      help: '在 openrouter.ai/keys 创建',
    },
    {
      key: 'model',
      label: '模型（可选）',
      placeholder: DEFAULT_MODEL,
      help: `留空用 ${DEFAULT_MODEL}。想用豆包的音色可以填 bytedance-seed/seed-audio-1-0`,
    },
  ],
  pickerLangs: [
    { code: 'zh', label: '中文' },
    { code: 'en', label: '英文' },
  ],
  // 默认模型是 OpenAI 的，所以用它那套音色
  voices: OPENAI_COMPATIBLE_VOICES,
  defaultVoiceByLang: {},
  fallbackVoice: 'nova',
  maxChars: 4096,
  // OpenRouter 是按请求数限流而不是并发数，可以稍微放开一点
  maxConcurrency: 2,
  isConfigured: (c) => Boolean(c.apiKey),
  synthesize: synthesizeOpenRouter,
};

async function synthesizeOpenRouter(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const text = request.text.trim();
  if (!text) throw new CloudTtsError('待合成的文本为空');

  const model = request.credentials.model?.trim() || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.credentials.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: request.voice,
        response_format: 'mp3',
        // 语速统一交给播放端的 playbackRate
        speed: 1,
      }),
      signal: request.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new CloudTtsError(`调用 OpenRouter 失败：${(error as Error).message}`, {
      hint: '检查网络，或确认已授予 openrouter.ai 的访问权限',
    });
  }

  if (!response.ok) {
    // 非 200 返回的是 JSON 错误体，不是音频
    const detail = (await response.json().catch(() => ({}))) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const message =
      (typeof detail.error === 'object' ? detail.error?.message : detail.error) ||
      detail.message ||
      `OpenRouter 语音合成失败（HTTP ${response.status}）`;

    throw new CloudTtsError(message, {
      code: response.status,
      hint: hintForFailure(message, response.status),
    });
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new CloudTtsError('OpenRouter 返回了空音频');
  }

  return {
    audio: arrayBufferToBase64(buffer),
    mimeType: response.headers.get('Content-Type') || 'audio/mpeg',
  };
}

function hintForFailure(message: string, status: number): string | undefined {
  // 模型名写错在 OpenRouter 上很常见，而且报错不太直观
  if (/model/i.test(message) && /(not found|invalid|unsupported|no endpoints)/i.test(message)) {
    return '模型名不对。到 openrouter.ai/models 用 output modality = speech 筛一下可用的 TTS 模型';
  }
  if (status === 402) return 'OpenRouter 余额不足，去账户里充值或换一个免费模型';
  return describeHttpFailure(status, 'OpenRouter');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // 分块拼接，避免超长文本时 String.fromCharCode 的参数数量爆掉
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
