import type {
  TranslateRequest,
  TranslationProvider,
  TranslationReadiness,
} from './provider';
import { translationPair } from './languages';

/**
 * Chrome 138+ 内置的**设备端**翻译。
 *
 * 为什么它当默认引擎：免费、离线、模型下载之后内容完全不出设备。
 * 代价是可用性受硬件门槛限制（官方要求 16GB 内存 / 22GB 空闲磁盘 / 4 核），
 * 所以 readiness() 的结果必须被上层认真对待，不能假设它一定可用。
 *
 * 实测（Chrome 154 / macOS）：首次 en→zh 下载约 12 秒，136 次 downloadprogress，
 * 之后 availability 直接变 available。
 */

/** downloadprogress 事件：loaded 是 0~1 的比例，不是字节数 */
interface DownloadProgressEvent {
  loaded: number;
  total: number;
}

interface CreateMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: DownloadProgressEvent) => void,
  ): void;
}

interface TranslatorInstance {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
}

interface TranslatorStatic {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: CreateMonitor) => void;
  }): Promise<TranslatorInstance>;
}

/** 取全局的 Translator；优先走 window，兜底查 chrome 命名空间 */
function translatorApi(): TranslatorStatic | null {
  const fromGlobal = (globalThis as { Translator?: unknown }).Translator;
  if (fromGlobal && typeof (fromGlobal as TranslatorStatic).create === 'function') {
    return fromGlobal as TranslatorStatic;
  }
  return null;
}

export class ChromeTranslatorProvider implements TranslationProvider {
  readonly name = 'chrome-on-device';

  /** 语言对 → 实例。create() 不便宜，绝不能每次翻译都建一个 */
  private readonly instances = new Map<string, Promise<TranslatorInstance>>();

  isSupported(): boolean {
    return translatorApi() !== null;
  }

  async readiness(from: string, to: string): Promise<TranslationReadiness> {
    const api = translatorApi();
    if (!api) return 'unsupported';

    const pair = translationPair(from, to);
    if (!pair) {
      // 同一门语言不需要翻译；真的不支持才叫 unsupported
      return from && to ? 'unsupported' : 'unavailable';
    }

    try {
      const value = await api.availability({
        sourceLanguage: pair.from,
        targetLanguage: pair.to,
      });
      return mapAvailability(value);
    } catch {
      return 'unavailable';
    }
  }

  async prepare(
    from: string,
    to: string,
    onProgress?: (ratio: number) => void,
  ): Promise<TranslationReadiness> {
    const pair = translationPair(from, to);
    if (!translatorApi() || !pair) return 'unsupported';

    try {
      await this.instance(pair.from, pair.to, onProgress);
      return 'ready';
    } catch (error) {
      console.warn('[ReadX] 准备语言包失败', pair, error);
      return 'unavailable';
    }
  }

  async translate({ text, from, to, signal }: TranslateRequest): Promise<string> {
    const pair = translationPair(from, to);
    if (!pair) throw new Error(`不支持的语言对：${from} → ${to}`);
    if (!text.trim()) return text;

    const instance = await this.instance(pair.from, pair.to);
    return instance.translate(text, signal ? { signal } : undefined);
  }

  dispose(): void {
    this.instances.clear();
  }

  /**
   * 按语言对缓存实例。
   *
   * `monitor` 只能在 create() 时挂上，所以进度回调只有**首次创建**那一次拿得到；
   * 后续复用缓存时 onProgress 不会被调用（此时语言包通常已经就绪，也不需要）。
   */
  private instance(
    from: string,
    to: string,
    onProgress?: (ratio: number) => void,
  ): Promise<TranslatorInstance> {
    const api = translatorApi();
    if (!api) return Promise.reject(new Error('当前浏览器不支持内置翻译'));

    const key = `${from}->${to}`;
    const cached = this.instances.get(key);
    if (cached) return cached;

    const created = api
      .create({
        sourceLanguage: from,
        targetLanguage: to,
        monitor: onProgress
          ? (monitor) => {
              monitor.addEventListener('downloadprogress', (event) => {
                onProgress(Math.max(0, Math.min(1, event.loaded ?? 0)));
              });
            }
          : undefined,
      })
      // 失败必须把缓存清掉，否则之后永远拿到同一个 rejected promise
      .catch((error) => {
        this.instances.delete(key);
        throw error;
      });

    this.instances.set(key, created);
    return created;
  }
}

function mapAvailability(value: string): TranslationReadiness {
  switch (value) {
    case 'available':
      return 'ready';
    case 'downloadable':
    case 'downloading':
      return 'need-download';
    default:
      return 'unavailable';
  }
}
