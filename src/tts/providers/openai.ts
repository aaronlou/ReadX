import { t } from '@/i18n';
import {
  CloudTtsError,
  describeHttpFailure,
  type CloudTtsSpec,
  type ProviderVoice,
  type SynthesizeRequest,
  type SynthesizeResult,
} from './types';

/**
 * OpenAI 语音合成。
 *
 *   POST https://api.openai.com/v1/audio/speech
 *   Authorization: Bearer <key>
 *
 * 和豆包的差异正好用来检验抽象是否成立：
 *   - 鉴权是标准 Bearer，不是自定义头
 *   - **响应是二进制音频流**，不是 JSON 里塞 base64
 *   - 音色**语言无关**（nova 既能读中文也能读英文），所以没有 per-language 默认值
 */

const ENDPOINT = 'https://api.openai.com/v1/audio/speech';
import { PROVIDER_ORIGINS } from './origins';

const ORIGIN = PROVIDER_ORIGINS.openai;

/**
 * 官方内置音色。这些是语言无关的 —— 同一个音色可以读任何支持的语言，
 * 所以 defaultVoiceByLang 留空，用 fallbackVoice 兜底。
 */
const VOICES: ProviderVoice[] = [
  { id: 'alloy', name: 'Alloy', note: t('provider_openai_voiceNoteNeutral') },
  { id: 'ash', name: 'Ash', note: t('provider_openai_voiceNoteSteady') },
  { id: 'ballad', name: 'Ballad', note: t('provider_openai_voiceNoteNarrative') },
  { id: 'coral', name: 'Coral', note: t('provider_openai_voiceNoteBright') },
  { id: 'echo', name: 'Echo', note: t('provider_openai_voiceNoteMale') },
  { id: 'fable', name: 'Fable', note: t('provider_openai_voiceNoteBritish') },
  { id: 'nova', name: 'Nova', note: t('provider_openai_voiceNoteFemaleGeneral') },
  { id: 'onyx', name: 'Onyx', note: t('provider_openai_voiceNoteDeepMale') },
  { id: 'sage', name: 'Sage', note: t('provider_openai_voiceNoteGentle') },
  { id: 'shimmer', name: 'Shimmer', note: t('provider_openai_voiceNoteSoftFemale') },
  { id: 'verse', name: 'Verse', note: t('provider_openai_voiceNoteExpressive') },
];

/** OpenRouter 上的 OpenAI 兼容接口用的是同一套音色，所以两个 spec 共用 */
export const OPENAI_COMPATIBLE_VOICES = VOICES;

export const openaiSpec: CloudTtsSpec = {
  id: 'openai',
  name: t('provider_openai_name'),
  summary: t('provider_openai_summary'),
  origins: [ORIGIN],
  credentials: [
    {
      key: 'apiKey',
      label: t('provider_openai_credApiKeyLabel'),
      secret: true,
      placeholder: t('provider_openai_credApiKeyPlaceholder'),
      help: t('provider_openai_credApiKeyHelp'),
    },
  ],
  pickerLangs: [
    { code: 'zh', label: t('provider_openai_langZh') },
    { code: 'en', label: t('provider_openai_langEn') },
  ],
  voices: VOICES,
  // 音色语言无关，所以不给每种语言指定默认值，统一用 fallback
  defaultVoiceByLang: {},
  fallbackVoice: 'nova',
  // 接口限制：input 最长 4096 字符
  maxChars: 4096,
  // OpenAI 按 RPM/TPM 限流，不是并发数
  maxConcurrency: 2,
  isConfigured: (c) => Boolean(c.apiKey),
  synthesize: synthesizeOpenAI,
};

async function synthesizeOpenAI(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const text = request.text.trim();
  if (!text) throw new CloudTtsError(t('provider_common_errEmptyText'));

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.credentials.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: text,
        voice: request.voice,
        response_format: 'mp3',
        // 语速统一交给播放端的 playbackRate，这里保持 1
        speed: 1,
      }),
      signal: request.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new CloudTtsError(t('provider_openai_errRequestFailed', (error as Error).message), {
      hint: t('provider_openai_errRequestFailedHint'),
    });
  }

  if (!response.ok) {
    // 失败时返回的是 JSON，不是音频
    const detail = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new CloudTtsError(
      detail.error?.message || t('provider_openai_errSynthesizeFailed', String(response.status)),
      {
        code: response.status,
        hint: describeHttpFailure(response.status, t('provider_openai_name')),
      },
    );
  }

  // 和豆包不同：这里拿到的是**二进制音频流**，没有 base64 也没有字幕
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new CloudTtsError(t('provider_openai_errEmptyAudio'));
  }

  return {
    audio: arrayBufferToBase64(buffer),
    mimeType: response.headers.get('Content-Type') || 'audio/mpeg',
  };
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
