/**
 * 单句长度上限。
 *
 * Chrome 的 speechSynthesis 在朗读很长的 utterance 时会莫名中断
 * （历史上大约 15 秒左右被截断），按句切分是官方推荐的规避方式，
 * 顺带也让「跳过这一句 / 高亮进度」变得可能。
 */
const MAX_CHUNK = 160;

/** 只有标点 / emoji / 空格的碎片没有朗读价值 */
function hasSpeakableContent(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/**
 * 切句。
 * 优先用 Intl.Segmenter —— 它按语言规则切分，中日文不用空格也能正确断句；
 * 不支持时退回正则。
 */
export function splitSentences(raw: string, lang: string): string[] {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  let segments: string[] = [];

  const SegmenterCtor = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (typeof SegmenterCtor === 'function') {
    try {
      const segmenter = new SegmenterCtor(lang, { granularity: 'sentence' });
      segments = [...segmenter.segment(text)].map((s) => s.segment);
    } catch {
      /* 个别语种不被支持，走下面的正则 */
    }
  }
  if (!segments.length) {
    segments = text.split(/(?<=[.!?。！？…；;])\s*/);
  }

  return segments
    .flatMap((s) => hardSplit(s.trim(), MAX_CHUNK))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && hasSpeakableContent(s));
}

/** 超长句在标点 / 空格处二次切分 */
function hardSplit(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];

  const out: string[] = [];
  let rest = sentence;

  while (rest.length > max) {
    let cut = -1;
    for (let i = Math.min(max - 1, rest.length - 1); i > Math.floor(max * 0.5); i--) {
      if (/[\s，,、；;：:。.!?？]/.test(rest[i] ?? '')) {
        cut = i + 1;
        break;
      }
    }
    if (cut < 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
