/**
 * 豆包（火山引擎）语音合成客户端。
 *
 * 这条路只能跑在 **background service worker** 里，不能放在内容脚本：
 * 内容脚本的跨域请求受页面 CORS 约束，而扩展的 service worker 有
 * host_permissions 就能直接发，不受页面限制。
 *
 * 接口用的是「音频生成」通道（seed-audio-1.0）：
 *   POST https://openspeech.bytedance.com/api/v3/tts/create
 *   - 鉴权：X-Api-Key（新版控制台）
 *   - 会返回句级字幕时间戳，可以拿来做高亮
 *
 * 参考实现来自本机的 BookReader 项目（那边是跑在 Next.js 服务端的）。
 */

export const DOUBAO_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/create';

export interface DoubaoCredentials {
  /** 新版控制台的 API Key（X-Api-Key） */
  apiKey?: string;
  /** 旧版控制台：App ID + Access Key */
  appId?: string;
  accessKey?: string;
}

export interface DoubaoSynthOptions {
  text: string;
  /** 音色 ID，如 zh_female_xiaohe_uranus_bigtts */
  voice: string;
  model: string;
  /** -50 ~ 100，0 为正常语速 */
  speechRate?: number;
  signal?: AbortSignal;
}

export interface SubtitleSentence {
  start_time: number;
  end_time: number;
  text: string;
}

export interface DoubaoSynthResult {
  /** base64 音频 */
  audio: string;
  mimeType: string;
  /** 秒 */
  duration: number;
  sentences: SubtitleSentence[];
}

export class DoubaoError extends Error {
  readonly code?: number | string;
  readonly logId?: string;
  /** 用户能直接照做的提示；没有就退回 message */
  readonly hint?: string;

  constructor(message: string, options: { code?: number | string; logId?: string; hint?: string } = {}) {
    super(message);
    this.name = 'DoubaoError';
    this.code = options.code;
    this.logId = options.logId;
    this.hint = options.hint;
  }
}

export function hasCredentials(credentials: DoubaoCredentials): boolean {
  return Boolean(credentials.apiKey || (credentials.appId && credentials.accessKey));
}

export async function synthesizeDoubao(
  credentials: DoubaoCredentials,
  options: DoubaoSynthOptions,
): Promise<DoubaoSynthResult> {
  const text = options.text.trim();
  if (!text) throw new DoubaoError('待合成的文本为空');

  if (!hasCredentials(credentials)) {
    throw new DoubaoError('还没有配置豆包语音的密钥', {
      hint: '到扩展的选项页填入 API Key',
    });
  }

  const format = 'mp3';
  const requestId = crypto.randomUUID();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Request-Id': requestId,
  };
  if (credentials.apiKey) {
    headers['X-Api-Key'] = credentials.apiKey;
  } else {
    headers['X-Api-App-Id'] = credentials.appId!;
    headers['X-Api-Access-Key'] = credentials.accessKey!;
  }

  const body = {
    model: options.model,
    text_prompt: text,
    references: [{ speaker: options.voice }],
    audio_config: {
      format,
      sample_rate: 44100,
      speech_rate: clampInt(options.speechRate ?? 0, -50, 100),
      loudness_rate: 0,
      pitch_rate: 0,
      enable_subtitle: true,
    },
  };

  let response: Response;
  try {
    response = await fetch(DOUBAO_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new DoubaoError(`调用豆包语音失败：${(error as Error).message}`, {
      hint: '检查网络，或确认已授予 openspeech.bytedance.com 的访问权限',
    });
  }

  const logId = response.headers.get('X-Tt-Logid') ?? requestId;

  const payload = (await response.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    audio?: string;
    duration?: number;
    original_duration?: number;
    subtitle?: { sentences?: SubtitleSentence[] };
  };

  if (!response.ok || !payload.audio) {
    throw new DoubaoError(payload.message || `豆包语音合成失败（HTTP ${response.status}）`, {
      code: payload.code ?? response.status,
      logId,
      hint: hintForStatus(response.status, payload.code),
    });
  }

  return {
    audio: payload.audio,
    mimeType: 'audio/mpeg',
    duration: payload.duration ?? payload.original_duration ?? 0,
    sentences: normalizeSentences(payload.subtitle?.sentences),
  };
}

/** 把常见失败翻译成"下一步该干什么"，否则用户只会看到一串错误码 */
function hintForStatus(status: number, code?: number): string | undefined {
  if (status === 401 || status === 403) return 'API Key 可能无效或没有开通「音频生成」服务';
  if (status === 429) return '触发限流了，稍后再试或降低朗读速度';
  if (status >= 500) return '豆包服务端异常，稍后重试';
  if (code === 3001) return '音色 ID 无效，到选项页重新选一个';
  return undefined;
}

function normalizeSentences(sentences?: SubtitleSentence[]): SubtitleSentence[] {
  if (!Array.isArray(sentences)) return [];
  return sentences
    .filter((s) => typeof s?.text === 'string')
    .map((s) => ({
      start_time: Number(s.start_time) || 0,
      end_time: Number(s.end_time) || 0,
      text: String(s.text),
    }))
    .sort((a, b) => a.start_time - b.start_time);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
