import { t } from '@/i18n';
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
import { PROVIDER_ORIGINS } from './origins';

const ORIGIN = PROVIDER_ORIGINS.openrouter;
const DEFAULT_MODEL = 'openai/gpt-4o-mini-tts-2025-12-15';

export const openrouterSpec: CloudTtsSpec = {
  id: 'openrouter',
  name: t('provider_openrouter_name'),
  summary: t('provider_openrouter_summary'),
  origins: [ORIGIN],
  credentials: [
    {
      key: 'apiKey',
      label: t('provider_openrouter_credApiKeyLabel'),
      secret: true,
      placeholder: t('provider_openrouter_credApiKeyPlaceholder'),
      help: t('provider_openrouter_credApiKeyHelp'),
    },
    {
      key: 'model',
      label: t('provider_openrouter_credModelLabel'),
      placeholder: DEFAULT_MODEL,
      help: t('provider_openrouter_credModelHelp', [DEFAULT_MODEL, 'bytedance-seed/seed-audio-1-0']),
    },
  ],
  pickerLangs: [
    { code: 'zh', label: t('provider_openrouter_langZh') },
    { code: 'en', label: t('provider_openrouter_langEn') },
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
  if (!text) throw new CloudTtsError(t('provider_common_errEmptyText'));

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
    throw new CloudTtsError(t('provider_openrouter_errRequestFailed', (error as Error).message), {
      hint: t('provider_openrouter_errRequestFailedHint'),
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
      t('provider_openrouter_errSynthesizeFailed', String(response.status));

    throw new CloudTtsError(message, {
      code: response.status,
      hint: hintForFailure(message, response.status),
    });
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new CloudTtsError(t('provider_openrouter_errEmptyAudio'));
  }

  return {
    audio: arrayBufferToBase64(buffer),
    mimeType: response.headers.get('Content-Type') || 'audio/mpeg',
  };
}

function hintForFailure(message: string, status: number): string | undefined {
  // 模型名写错在 OpenRouter 上很常见，而且报错不太直观
  if (/model/i.test(message) && /(not found|invalid|unsupported|no endpoints)/i.test(message)) {
    return t('provider_openrouter_errModelNotFoundHint');
  }
  if (status === 402) return t('provider_openrouter_errInsufficientCreditsHint');
  return describeHttpFailure(status, t('provider_openrouter_name'));
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
