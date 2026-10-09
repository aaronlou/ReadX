import { t } from '@/i18n';
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
import { PROVIDER_ORIGINS } from './origins';

const ORIGIN = PROVIDER_ORIGINS.doubao;
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
  { id: 'zh_male_ruyaqingnian_mars_bigtts', name: '儒雅青年', lang: 'zh', note: t('provider_doubao_voiceNoteAudiobook') },
  { id: 'zh_female_wenroushunv_mars_bigtts', name: '温柔淑女', lang: 'zh', note: t('provider_doubao_voiceNoteAudiobook') },
  { id: 'zh_male_qingcang_mars_bigtts', name: '擎苍', lang: 'zh', note: t('provider_doubao_voiceNoteAudiobook') },
  { id: 'zh_male_changtianyi_mars_bigtts', name: '悬疑解说', lang: 'zh', note: t('provider_doubao_voiceNoteAudiobook') },
  { id: 'zh_female_shaoergushi_uranus_bigtts', name: '少儿故事', lang: 'zh', note: t('provider_doubao_voiceNoteAudiobook') },
  { id: 'zh_female_liuchangnv_uranus_bigtts', name: '流畅女声', lang: 'zh', note: t('provider_doubao_voiceNoteVideoNarration') },
  { id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰', lang: 'zh', note: t('provider_doubao_voiceNoteVideoNarration') },
  // 英文
  { id: 'en_female_dacey_uranus_bigtts', name: 'Dacey', lang: 'en' },
  { id: 'en_male_tim_uranus_bigtts', name: 'Tim', lang: 'en' },
];

export const doubaoSpec: CloudTtsSpec = {
  id: 'doubao',
  name: t('provider_doubao_name'),
  summary: t('provider_doubao_summary'),
  origins: [ORIGIN],
  credentials: [
    {
      key: 'apiKey',
      label: t('provider_doubao_credApiKeyLabel'),
      secret: true,
      placeholder: t('provider_doubao_credApiKeyPlaceholder'),
      help: t('provider_doubao_credApiKeyHelp'),
    },
    {
      key: 'appId',
      label: t('provider_doubao_credAppIdLabel'),
      placeholder: t('provider_doubao_credAppIdPlaceholder'),
      help: t('provider_doubao_credAppIdHelp'),
    },
    {
      key: 'accessKey',
      label: t('provider_doubao_credAccessKeyLabel'),
      secret: true,
      placeholder: t('provider_doubao_credAccessKeyPlaceholder'),
      help: t('provider_doubao_credAccessKeyHelp'),
    },
  ],
  pickerLangs: [
    { code: 'zh', label: t('provider_doubao_langZh') },
    { code: 'en', label: t('provider_doubao_langEn') },
  ],
  voices: VOICES,
  defaultVoiceByLang: {
    zh: 'zh_female_xiaohe_uranus_bigtts',
    en: 'en_female_dacey_uranus_bigtts',
  },
  // 接口限制：text_prompt 最长 2048 字符（官方 SDK 文档口径）
  maxChars: 2048,
  /**
   * 但**绝不能按 2048 分块**。seed-audio-1.0 的合成耗时随输出音频长度增长，
   * 2048 字约合 500 秒音频，实测直接撞穿 30 秒超时（signal timed out）。
   * 150 字大约 35 秒音频、几秒合成 —— 块与块之间靠预取接上，听感仍然连续。
   */
  chunkChars: 150,
  /**
   * 串行合成。
   *
   * 实测预取开到 6 个并发就会撞上
   * `quota exceeded for types: concurrency` —— 新建应用的并发配额往往很低，
   * 而具体是多少控制台才看得到。合成是和播放重叠进行的，串行几乎不影响
   * 听感，却能彻底避免这个问题。配额确认更高之后再调大。
   */
  maxConcurrency: 1,
  isConfigured: (c) => Boolean(c.apiKey || (c.appId && c.accessKey)),
  synthesize: synthesizeDoubao,
};

async function synthesizeDoubao(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const text = request.text.trim();
  if (!text) throw new CloudTtsError(t('provider_common_errEmptyText'));

  const { apiKey, appId, accessKey } = request.credentials;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Request-Id': crypto.randomUUID(),
  };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  // ⚠️ App-Id 是**请求/应用配置**，不是认证因子 —— 官方 SDK 会把它和
  // X-Api-Key **一起**发出去，而不是二选一。
  //
  // 这点很容易写错（我们自己第一版就写错了）：如果把它写成
  // "有 apiKey 就不发 App-Id"，那么需要靠 App-Id 判定请求属于哪个应用、
  // 进而决定授予哪个资源的接口就会返回：
  //     [resource_id=volc.service_type.xxxxx] requested resource not granted
  // 一个看起来像"没开通服务"、实际是"没告诉我你是哪个应用"的错误。
  if (appId) headers['X-Api-App-Id'] = appId;

  // Access Key 才真的是旧版鉴权的替代方案：没有 API Key 时用它
  if (!apiKey && accessKey) headers['X-Api-Access-Key'] = accessKey;

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
    throw new CloudTtsError(t('provider_doubao_errRequestFailed', (error as Error).message), {
      hint: t('provider_doubao_errRequestFailedHint'),
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
    const message = payload.message || t('provider_doubao_errSynthesizeFailed', String(response.status));
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
    return t('provider_doubao_errResourceNotGrantedHint');
  }
  if (/not activated|未开通|服务未开通/i.test(message)) {
    return t('provider_doubao_errServiceNotActivatedHint');
  }
  return describeHttpFailure(status, t('provider_doubao_name'));
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
