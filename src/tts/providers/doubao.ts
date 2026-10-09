import {
  CloudTtsError,
  describeHttpFailure,
  type CloudTtsSpec,
  type ProviderVoice,
  type SynthesizeRequest,
  type SynthesizeResult,
  type SubtitleSentence,
} from './types';

/**
 * 豆包（火山引擎）语音合成。
 *
 * 用的是「音频生成」通道（模型 seed-audio-1.0）：
 *   POST https://openspeech.bytedance.com/api/v3/tts/create
 * 鉴权支持两种控制台版本：
 *   - 新版：X-Api-Key
 *   - 旧版：X-Api-App-Id + X-Api-Access-Key
 *
 * 特点：音色**按语言区分**（中文音色读英文会得到很怪的发音），
 * 响应是 JSON 里带 base64 音频，并且**会返回句级字幕**，可以做高亮。
 */

const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/create';
const ORIGIN = 'https://openspeech.bytedance.com/*';
const DEFAULT_MODEL = 'seed-audio-1.0';

/** 列表沿用已在本机 BookReader 项目验证过的一份 */
const VOICES: ProviderVoice[] = [
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi', lang: 'zh' },
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何', lang: 'zh' },
  { id: 'zh_female_qingxinnvsheng_uranus_bigtts', name: '清新女声', lang: 'zh' },
  { id: 'zh_female_tianmeixiaoyuan_uranus_bigtts', name: '甜美小源', lang: 'zh' },
  { id: 'zh_female_shuangkuaisisi_uranus_bigtts', name: '爽快思思', lang: 'zh' },
  { id: 'zh_female_linjianvhai_uranus_bigtts', name: '邻家女孩', lang: 'zh' },
  { id: 'zh_female_wenroumama_uranus_bigtts', name: '温柔妈妈', lang: 'zh' },
  { id: 'zh_female_wenrouxiaoya_uranus_bigtts', name: '温柔小雅', lang: 'zh' },
  { id: 'zh_female_meilinvyou_uranus_bigtts', name: '魅力女友', lang: 'zh' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟', lang: 'zh' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天', lang: 'zh' },
  { id: 'zh_male_liufei_uranus_bigtts', name: '刘飞', lang: 'zh' },
  { id: 'zh_male_linjiananhai_uranus_bigtts', name: '邻家男孩', lang: 'zh' },
  { id: 'zh_male_jieshuoxiaoming_uranus_bigtts', name: '解说小明', lang: 'zh' },
  { id: 'zh_male_wenrouxiaoge_uranus_bigtts', name: '温柔小哥', lang: 'zh' },
  { id: 'zh_male_yizhipiannan_uranus_bigtts', name: '译制片男', lang: 'zh' },
  { id: 'zh_female_tvbnv_uranus_bigtts', name: 'TVB 女声', lang: 'zh' },
  // 有声阅读场景，念长文本比「通用」更自然
  { id: 'zh_male_ruyaqingnian_mars_bigtts', name: '儒雅青年', lang: 'zh', note: '有声阅读' },
  { id: 'zh_female_wenroushunv_mars_bigtts', name: '温柔淑女', lang: 'zh', note: '有声阅读' },
  { id: 'zh_male_qingcang_mars_bigtts', name: '擎苍', lang: 'zh', note: '有声阅读' },
  { id: 'zh_male_changtianyi_mars_bigtts', name: '悬疑解说', lang: 'zh', note: '有声阅读' },
  { id: 'zh_female_shaoergushi_uranus_bigtts', name: '少儿故事', lang: 'zh', note: '有声阅读' },
  { id: 'zh_female_liuchangnv_uranus_bigtts', name: '流畅女声', lang: 'zh', note: '视频配音' },
  { id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰', lang: 'zh', note: '视频配音' },
  // 英文
  { id: 'en_female_dacey_uranus_bigtts', name: 'Dacey', lang: 'en' },
  { id: 'en_male_tim_uranus_bigtts', name: 'Tim', lang: 'en' },
];

export const doubaoSpec: CloudTtsSpec = {
  id: 'doubao',
  name: '豆包语音',
  summary: '火山引擎，中文音色自然，30+ 音色可选',
  origins: [ORIGIN],
  credentials: [
    {
      key: 'apiKey',
      label: 'API Key',
      secret: true,
      placeholder: '粘贴 API Key',
      help: '新版控制台「语音技术 → 应用管理」获取',
    },
    {
      key: 'appId',
      label: 'App ID（可选）',
      placeholder: '旧版控制台才需要',
      help: '只有旧版控制台才用 App ID + Access Key，新版填上面的 API Key 即可',
    },
    {
      key: 'accessKey',
      label: 'Access Key（可选）',
      secret: true,
      placeholder: '旧版控制台才需要',
    },
  ],
  pickerLangs: [
    { code: 'zh', label: '中文' },
    { code: 'en', label: '英文' },
  ],
  voices: VOICES,
  defaultVoiceByLang: {
    zh: 'zh_female_xiaohe_uranus_bigtts',
    en: 'en_female_dacey_uranus_bigtts',
  },
  // 接口限制：text_prompt 最长 2048 字符（官方 SDK 文档口径）
  maxChars: 2048,
  isConfigured: (c) => Boolean(c.apiKey || (c.appId && c.accessKey)),
  synthesize: synthesizeDoubao,
};

async function synthesizeDoubao(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const text = request.text.trim();
  if (!text) throw new CloudTtsError('待合成的文本为空');

  const { apiKey, appId, accessKey } = request.credentials;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Request-Id': crypto.randomUUID(),
  };
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  } else {
    headers['X-Api-App-Id'] = appId!;
    headers['X-Api-Access-Key'] = accessKey!;
  }

  const body = {
    model: DEFAULT_MODEL,
    text_prompt: text,
    references: [{ speaker: request.voice }],
    audio_config: {
      format: 'mp3',
      sample_rate: 44100,
      // 语速统一交给播放端的 playbackRate（即时生效、不用重新合成）
      speech_rate: 0,
      loudness_rate: 0,
      pitch_rate: 0,
      // 字幕是后续做高亮的前提，必须显式打开
      enable_subtitle: true,
    },
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new CloudTtsError(`调用豆包语音失败：${(error as Error).message}`, {
      hint: '检查网络，或确认已授予 openspeech.bytedance.com 的访问权限',
    });
  }

  const payload = (await response.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    audio?: string;
    duration?: number;
    original_duration?: number;
    subtitle?: { sentences?: SubtitleSentence[] };
  };

  if (!response.ok || !payload.audio) {
    const message = payload.message || `豆包语音合成失败（HTTP ${response.status}）`;
    throw new CloudTtsError(message, {
      code: payload.code ?? response.status,
      hint: hintForFailure(message, response.status),
    });
  }

  return {
    audio: payload.audio,
    mimeType: 'audio/mpeg',
    duration: payload.duration ?? payload.original_duration,
    sentences: normalizeSentences(payload.subtitle?.sentences),
  };
}

/**
 * 把豆包特有的失败翻译成"下一步该干什么"。
 *
 * `requested resource not granted` 是这里最容易卡住的一种：它**不是认证失败**
 * ——Key 有效，是账号没开通这个**接口**对应的服务。「音频生成」是独立于
 * 「语音合成」的另一个服务，必须单独开通。这个错误原文完全看不出该做什么。
 */
function hintForFailure(message: string, status: number): string | undefined {
  if (/not granted|resource_id|service_type/i.test(message)) {
    return '这个账号没有开通「音频生成」服务。到火山引擎控制台开通它，或把凭据换成「语音合成大模型」的 AppID + Access Token';
  }
  if (/not activated|未开通|服务未开通/i.test(message)) {
    return '到火山引擎控制台开通对应服务';
  }
  return describeHttpFailure(status, '豆包语音');
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
