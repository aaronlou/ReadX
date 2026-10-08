/**
 * 翻译引擎抽象。
 *
 * 和 TtsProvider 是同一个套路：P2 先实现 Chrome 设备端翻译，
 * 之后接 LLM（自备 Key）或云 MT 只要再写一个实现，上层朗读流程不用改。
 */

export type TranslationReadiness =
  /** 语言包已就绪，可以直接翻 */
  | 'ready'
  /** 语言包没下载，**必须在用户手势里**触发下载 */
  | 'need-download'
  /** 这一对语言 API 不支持 */
  | 'unsupported'
  /** API 存在，但本机不可用（硬件不达标等） */
  | 'unavailable';

export interface TranslateRequest {
  text: string;
  /** 检测到的源语言（BCP-47 或已经是 API 代码） */
  from: string;
  /** 目标语言 */
  to: string;
  signal?: AbortSignal;
}

export interface TranslationProvider {
  readonly name: string;
  /** 当前浏览器/页面上下文里这个引擎能不能用 */
  isSupported(): boolean;
  /** 这一对语言现在处于什么状态 */
  readiness(from: string, to: string): Promise<TranslationReadiness>;
  /**
   * 准备某个语言对（下载语言包）。
   * ⚠️ 调用方必须保证它是在**用户手势**里被调用的，否则 Chrome 会抛 NotAllowedError。
   */
  prepare(
    from: string,
    to: string,
    onProgress?: (ratio: number) => void,
  ): Promise<TranslationReadiness>;
  /** 翻译。语言包没准备好时应当抛出可读的错误，而不是静默返回原文 */
  translate(request: TranslateRequest): Promise<string>;
  /** 释放底层实例 */
  dispose(): void;
}
