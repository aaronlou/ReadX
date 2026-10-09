/**
 * 云语音服务商的接入规范。
 *
 * 设计目标：**新增一个服务商 = 新增一个文件 + 在 registry 里注册一行**，
 * 不需要动 settings、background、UI 或权限逻辑。
 *
 * 所以服务商要自己声明：需要哪些凭据（UI 按声明渲染输入框）、
 * 需要哪些域名权限（按声明申请）、有哪些音色、怎么发请求。
 */

/** 句级时间戳，有的话可以用来做朗读高亮 */
export interface SubtitleSentence {
  start_time: number;
  end_time: number;
  text: string;
}

/** UI 上要渲染的一个凭据输入框 */
export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  /** 密钥类字段：输入框打码显示 */
  secret?: boolean;
  /** 输入框下方的说明 */
  help?: string;
}

export interface ProviderVoice {
  id: string;
  name: string;
  /**
   * BCP-47 主语言。
   * 留空表示**语言无关** —— 有些服务商的音色什么语言都能读（OpenAI），
   * 有些则是一个音色只会一门语言（豆包），这个区别会影响选音色的逻辑。
   */
  lang?: string;
  note?: string;
}

export interface SynthesizeRequest {
  text: string;
  voice: string;
  credentials: Record<string, string>;
  signal?: AbortSignal;
}

export interface SynthesizeResult {
  /** 统一成 base64 —— 便于跨消息传递，二进制响应在服务商实现里就地转换 */
  audio: string;
  mimeType: string;
  /** 秒；拿不到就省略 */
  duration?: number;
  sentences?: SubtitleSentence[];
}

export class CloudTtsError extends Error {
  readonly code?: number | string;
  /** 用户能直接照做的提示 */
  readonly hint?: string;

  constructor(message: string, options: { code?: number | string; hint?: string } = {}) {
    super(message);
    this.name = 'CloudTtsError';
    this.code = options.code;
    this.hint = options.hint;
  }
}

export interface CloudTtsSpec {
  id: string;
  name: string;
  /** 一句话介绍，选择服务商时显示 */
  summary: string;
  /** 需要申请的域名权限；启用时由 UI 发起申请 */
  origins: string[];
  /** 凭据字段，UI 按这个渲染 */
  credentials: CredentialField[];
  /** 音色选择器要展示哪些语言 */
  pickerLangs: Array<{ code: string; label: string }>;
  voices: ProviderVoice[];
  /** 语言 -> 默认音色 */
  defaultVoiceByLang: Record<string, string>;
  /** 语言无关服务商的兜底音色 */
  fallbackVoice?: string;
  /** 单次请求的文本上限 */
  maxChars: number;
  /** 凭据填全了吗 */
  isConfigured(credentials: Record<string, string>): boolean;
  /** 真正发请求 —— 只在 background 里调用 */
  synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>;
}

/**
 * 选音色的统一逻辑：
 *   用户为该语言手动绑定 → 服务商为该语言指定的默认 → 服务商的兜底音色
 */
export function resolveVoice(
  spec: CloudTtsSpec,
  lang: string,
  bound: Record<string, string> = {},
): string | undefined {
  const normalized = (lang || '').toLowerCase();
  const base = normalized.split('-')[0] ?? '';

  const fromBinding = bound[normalized] ?? (base ? bound[base] : undefined);
  if (fromBinding) return fromBinding;

  const fromSpec = spec.defaultVoiceByLang[normalized] ?? (base ? spec.defaultVoiceByLang[base] : undefined);
  if (fromSpec) return fromSpec;

  return spec.fallbackVoice;
}

/** 把常见 HTTP 失败翻译成"下一步该干什么" */
export function describeHttpFailure(status: number, serviceName: string): string | undefined {
  if (status === 401 || status === 403) return `API Key 可能无效，或没有开通 ${serviceName} 服务`;
  if (status === 404) return '接口地址或模型名不对';
  if (status === 429) return '触发限流或额度用尽，稍后再试';
  if (status >= 500) return `${serviceName} 服务端异常，稍后重试`;
  return undefined;
}
