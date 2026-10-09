/**
 * 豆包（火山引擎）语音合成的音色目录。
 *
 * 列表沿用 BookReader 项目里已经验证过的那份。完整列表见
 * https://docs.volcengine.com/docs/6561/1257544
 *
 * 音色 ID 和语言是绑定的 —— 用中文音色读英文会得到很怪的发音，
 * 所以选音色时必须先看帖子的语言。
 */

export interface DoubaoVoice {
  id: string;
  name: string;
  /** 展示用的场景标签 */
  scene: string;
  /** BCP-47 主语言，用于按帖子语言自动挑音色 */
  lang: string;
  langLabel: string;
}

export const DOUBAO_VOICES: DoubaoVoice[] = [
  // ---- 中文 · 通用 ----
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_liufei_uranus_bigtts', name: '刘飞', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_qingxinnvsheng_uranus_bigtts', name: '清新女声', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_tianmeixiaoyuan_uranus_bigtts', name: '甜美小源', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_shuangkuaisisi_uranus_bigtts', name: '爽快思思', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_linjianvhai_uranus_bigtts', name: '邻家女孩', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_linjiananhai_uranus_bigtts', name: '邻家男孩', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_jieshuoxiaoming_uranus_bigtts', name: '解说小明', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_wenroumama_uranus_bigtts', name: '温柔妈妈', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_wenrouxiaoge_uranus_bigtts', name: '温柔小哥', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_wenrouxiaoya_uranus_bigtts', name: '温柔小雅', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_meilinvyou_uranus_bigtts', name: '魅力女友', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_yizhipiannan_uranus_bigtts', name: '译制片男', scene: '通用', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_tvbnv_uranus_bigtts', name: 'TVB 女声', scene: '通用', lang: 'zh', langLabel: '中文' },

  // ---- 中文 · 有声阅读（念帖子比「通用」更自然）----
  { id: 'zh_female_shaoergushi_uranus_bigtts', name: '少儿故事', scene: '有声阅读', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_xiaoxue_uranus_bigtts', name: '儿童绘本', scene: '有声阅读', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_ruyaqingnian_mars_bigtts', name: '儒雅青年', scene: '有声阅读', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_wenroushunv_mars_bigtts', name: '温柔淑女', scene: '有声阅读', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_qingcang_mars_bigtts', name: '擎苍', scene: '有声阅读', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_changtianyi_mars_bigtts', name: '悬疑解说', scene: '有声阅读', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_baqiqingshu_mars_bigtts', name: '霸气青叔', scene: '有声阅读', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_liuchangnv_uranus_bigtts', name: '流畅女声', scene: '视频配音', lang: 'zh', langLabel: '中文' },
  { id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰', scene: '视频配音', lang: 'zh', langLabel: '中文' },
  { id: 'zh_female_gufengshaoyu_mars_bigtts', name: '古风少御', scene: '角色', lang: 'zh', langLabel: '中文' },

  // ---- 英文 ----
  { id: 'en_female_dacey_uranus_bigtts', name: 'Dacey', scene: '外语', lang: 'en', langLabel: '美式英语' },
  { id: 'en_male_tim_uranus_bigtts', name: 'Tim', scene: '外语', lang: 'en', langLabel: '美式英语' },
];

const BY_ID = new Map(DOUBAO_VOICES.map((v) => [v.id, v]));

export function findDoubaoVoice(id: string): DoubaoVoice | undefined {
  return BY_ID.get(id);
}

/**
 * 每种语言的默认音色。挑的都是「通用」或「有声阅读」场景里
 * 念长文本比较自然的，而不是角色音。
 */
export const DEFAULT_DOUBAO_VOICE: Record<string, string> = {
  zh: 'zh_female_xiaohe_uranus_bigtts',
  en: 'en_female_dacey_uranus_bigtts',
};

export function defaultVoiceFor(lang: string): string | undefined {
  const base = (lang || '').toLowerCase().split('-')[0] ?? '';
  // 繁体中文也用中文音色
  if (base === 'zh') return DEFAULT_DOUBAO_VOICE.zh;
  return DEFAULT_DOUBAO_VOICE[base];
}

/** 按语言分组，给选择器用 */
export function voicesByLang(lang: string): DoubaoVoice[] {
  const base = (lang || '').toLowerCase().split('-')[0] ?? '';
  return DOUBAO_VOICES.filter((v) => v.lang === base);
}

export const DEFAULT_DOUBAO_MODEL = 'seed-audio-1.0';

/** 接口限制：单次 text_prompt ≤ 3000 字符 */
export const DOUBAO_MAX_TEXT_CHARS = 3000;
