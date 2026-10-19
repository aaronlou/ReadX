import { t } from '@/i18n';
import { PROVIDER_ORIGINS } from './origins';
import {
  CloudTtsError,
  describeHttpFailure,
  type CloudTtsSpec,
  type ProviderVoice,
  type SynthesizeRequest,
  type SynthesizeResult,
} from './types';

/**
 * 本地语音服务（自建 TTS）。
 *
 * 存在的问题：云端 TTS 按量计费，读到一定量就会因为余额或额度停下。
 * 对「一直在听时间线」这种用法来说，这是最扫兴的一种中断 —— 而且它不是
 * 网络问题，重试再多次也没用。
 *
 * 这里的做法：**接任何 OpenAI 兼容的本地 TTS 服务**。因为这类服务的接口
 * 长得和 OpenAI 一模一样（`POST /v1/audio/speech`，body 里 `model` / `input` /
 * `voice` / `response_format`），所以合成逻辑几乎不用重写。
 *
 * 已验证可直接对接的：
 *   - Kokoro-FastAPI（Apache-2.0，82M 参数，CPU 就能跑）
 *     `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest`
 *   - openedai-speech（把 Piper 包成 OpenAI 接口）
 *
 * 好处不只是免费：音频**根本不离开这台机器**，比云端方案更符合 ReadX
 * 一贯的隐私立场。
 */

const DEFAULT_BASE_URL = 'http://localhost:8880/v1';
const DEFAULT_MODEL = 'kokoro';

/** `default` 是特殊值：发请求时**不带 voice 字段**，让服务端用它自己的默认音色 */
const SERVER_DEFAULT_VOICE = 'default';

const VOICES: ProviderVoice[] = [
  {
    id: SERVER_DEFAULT_VOICE,
    name: t('provider_local_voiceServerDefault'),
    note: t('provider_local_voiceServerDefaultNote'),
  },

  // Kokoro-82M 的音色 ID。命名规则是「语种+性别_名字」：
  // a=美式英语, b=英式英语, z=中文, j=日文, e=西语, f=法语, p=葡语, i=意语, h=印地语
  // ⚠️ 下面这些 ID 都**对着真跑起来的 Kokoro-FastAPI 核过**
  // （`GET /v1/audio/voices` 返回 72 个，这里挑的 22 个全部存在）。
  // 加新条目前请先确认服务端真的有，用不存在的 ID 只会换来一个 400。
  { id: 'af_heart', name: 'Heart', lang: 'en', note: t('provider_local_voiceFemale') },
  { id: 'af_bella', name: 'Bella', lang: 'en', note: t('provider_local_voiceFemale') },
  { id: 'af_nova', name: 'Nova', lang: 'en', note: t('provider_local_voiceFemale') },
  { id: 'af_sarah', name: 'Sarah', lang: 'en', note: t('provider_local_voiceFemale') },
  { id: 'am_michael', name: 'Michael', lang: 'en', note: t('provider_local_voiceMale') },
  { id: 'am_fenrir', name: 'Fenrir', lang: 'en', note: t('provider_local_voiceMale') },
  { id: 'am_adam', name: 'Adam', lang: 'en', note: t('provider_local_voiceMale') },
  { id: 'bf_emma', name: 'Emma', lang: 'en', note: t('provider_local_voiceBritish') },
  { id: 'bm_george', name: 'George', lang: 'en', note: t('provider_local_voiceBritish') },

  { id: 'zf_xiaobei', name: '晓北', lang: 'zh', note: t('provider_local_voiceFemale') },
  { id: 'zf_xiaoxiao', name: '晓晓', lang: 'zh', note: t('provider_local_voiceFemale') },
  { id: 'zf_xiaoyi', name: '晓伊', lang: 'zh', note: t('provider_local_voiceFemale') },
  { id: 'zm_yunxi', name: '云希', lang: 'zh', note: t('provider_local_voiceMale') },
  { id: 'zm_yunjian', name: '云健', lang: 'zh', note: t('provider_local_voiceMale') },
  { id: 'zm_yunxia', name: '云夏', lang: 'zh', note: t('provider_local_voiceMale') },

  { id: 'jf_alpha', name: 'Alpha', lang: 'ja', note: t('provider_local_voiceFemale') },
  { id: 'jf_gongitsune', name: 'Gongitsune', lang: 'ja', note: t('provider_local_voiceFemale') },
  { id: 'jm_kumo', name: 'Kumo', lang: 'ja', note: t('provider_local_voiceMale') },

  { id: 'ef_dora', name: 'Dora', lang: 'es', note: t('provider_local_voiceFemale') },
  { id: 'em_alex', name: 'Alex', lang: 'es', note: t('provider_local_voiceMale') },
  { id: 'em_santa', name: 'Santa', lang: 'es', note: t('provider_local_voiceMale') },

  { id: 'ff_siwis', name: 'Siwis', lang: 'fr', note: t('provider_local_voiceFemale') },
];

/**
 * 用户可能填 `http://localhost:8880`、`http://localhost:8880/v1`、
 * 或者带尾斜杠 —— 都归一化到「以 /v1 结尾、无尾斜杠」。
 */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim() || DEFAULT_BASE_URL;
  const trimmed = value.replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

export const localSpec: CloudTtsSpec = {
  id: 'local',
  name: t('provider_local_name'),
  summary: t('provider_local_summary'),
  origins: [PROVIDER_ORIGINS.local, PROVIDER_ORIGINS.localIp],
  credentials: [
    {
      key: 'baseUrl',
      label: t('provider_local_credBaseUrlLabel'),
      placeholder: DEFAULT_BASE_URL,
      help: t('provider_local_credBaseUrlHelp'),
    },
    {
      key: 'model',
      label: t('provider_local_credModelLabel'),
      placeholder: DEFAULT_MODEL,
      help: t('provider_local_credModelHelp'),
    },
  ],
  pickerLangs: [
    { code: 'zh', label: t('provider_local_langZh') },
    { code: 'en', label: t('provider_local_langEn') },
    { code: 'ja', label: t('provider_local_langJa') },
    { code: 'es', label: t('provider_local_langEs') },
    { code: 'fr', label: t('provider_local_langFr') },
  ],
  voices: VOICES,
  defaultVoiceByLang: {
    zh: 'zf_xiaoxiao',
    en: 'af_heart',
    ja: 'jf_alpha',
    es: 'ef_dora',
    fr: 'ff_siwis',
  },
  // 语言无关的兜底：服务端自己的默认音色。这样即使服务端一个 Kokoro 音色
  // 都没有（比如换成 Piper），也仍然能出声。
  fallbackVoice: SERVER_DEFAULT_VOICE,
  // 本地服务没有接口层面的字符上限，限制主要来自合成耗时。
  maxChars: 4096,
  chunkChars: 400,
  // 本地服务没有并发配额，但同机 CPU 推理时并发反而会互相拖慢。
  maxConcurrency: 1,
  // 不需要任何凭据：base URL 有默认值，密钥更是没有。选上就能用。
  privacyNote: t('provider_local_privacyNote'),
  needsCredentials: false,
  isConfigured: () => true,
  synthesize: synthesizeLocal,
};

async function synthesizeLocal(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const text = request.text.trim();
  if (!text) throw new CloudTtsError(t('provider_common_errEmptyText'));

  const baseUrl = normalizeBaseUrl(request.credentials.baseUrl);
  const model = request.credentials.model?.trim() || DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    model,
    input: text,
    response_format: 'mp3',
    // 语速统一交给播放端的 playbackRate
    speed: 1,
  };
  // `default` 表示不指定 —— 服务端会用自己的默认音色。
  // 硬塞一个服务端不认识的音色名只会换来一个 400。
  if (request.voice && request.voice !== SERVER_DEFAULT_VOICE) {
    body.voice = request.voice;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    // 本地服务没起来是最常见的失败，而且报错原文（Failed to fetch）
    // 完全看不出是"服务没启动"
    throw new CloudTtsError(t('provider_local_errUnreachable', baseUrl), {
      hint: t('provider_local_errUnreachableHint'),
    });
  }

  if (!response.ok) {
    const error = await readErrorBody(response);
    throw new CloudTtsError(
      error.message || t('provider_local_errSynthesizeFailed', String(response.status)),
      {
        code: response.status,
        hint:
          describeHttpFailure(response.status, t('provider_local_name'), error.code) ??
          t('provider_local_errFailureHint'),
      },
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new CloudTtsError(t('provider_local_errEmptyAudio'));
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

/**
 * 读出错误响应里的可读信息。
 *
 * **不同服务的错误形状不一样**，这是实测出来的：
 *   - OpenAI 系：`{ error: { message, type, code } }`
 *   - FastAPI 系（Kokoro-FastAPI、openedai-speech）：
 *     `{ detail: { error, message } }` 或 `{ detail: "..." }`
 *
 * 只认第一种的话，Kokoro 那条最有用的报错
 * （`Voice 'x' not found. Available voices: ...`）会被整个吞掉，
 * 用户只看到一句干巴巴的 "returned an error" —— 而那句话对解决问题毫无帮助。
 */
async function readErrorBody(response: Response): Promise<{ message?: string; code?: string }> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string; type?: string } | string;
    detail?: { message?: string; code?: string; type?: string; error?: string } | string;
    message?: string;
  };

  const candidates = [body.error, body.detail];
  let message: string | undefined;
  let code: string | undefined;

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      message ??= candidate;
      continue;
    }
    if (!candidate || typeof candidate !== 'object') continue;
    message ??= candidate.message;
    code ??= candidate.code ?? candidate.type;
    // FastAPI 的 `detail.error` 是个错误分类字符串（validation_error 之类）
    if (!code && 'error' in candidate && typeof candidate.error === 'string') {
      code = candidate.error;
    }
  }

  return { message: message ?? body.message, code: code ?? undefined };
}
