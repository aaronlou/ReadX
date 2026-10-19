import { describe, expect, it } from 'vitest';
import { splitSentences, readableLength } from './text';

describe('splitSentences', () => {
  it('英文按句末标点切分', () => {
    expect(splitSentences('Hello there. How are you? I am fine!', 'en')).toHaveLength(3);
  });

  it('中文按句末标点切分，不依赖空格', () => {
    const out = splitSentences('今天天气不错。我们去公园吧！你觉得呢？', 'zh');
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('今天天气不错。');
  });

  it('丢掉纯 emoji / 标点碎片', () => {
    expect(splitSentences('🎉🎉 ...', 'zh')).toEqual([]);
  });

  it('空输入返回空数组', () => {
    expect(splitSentences('', 'en')).toEqual([]);
    expect(splitSentences('   \n  ', 'en')).toEqual([]);
  });

  // Chrome 的 speechSynthesis 在长 utterance 上会被截断，
  // 所以超过上限的句子必须在标点 / 空格处二次切分
  it('超长句会被二次切分，且每段都不超过上限', () => {
    const long = `${'word '.repeat(200).trim()}.`;
    const out = splitSentences(long, 'en');

    expect(out.length).toBeGreaterThan(1);
    expect(out.every((s) => s.length <= 160)).toBe(true);
    // 切分不能丢内容
    expect(out.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' ').trim());
  });

  it('一长串没有标点的中文也能被切开', () => {
    const long = '这是一段没有任何标点的超长中文文本'.repeat(20);
    const out = splitSentences(long, 'zh');

    expect(out.length).toBeGreaterThan(1);
    expect(out.every((s) => s.length <= 160)).toBe(true);
    expect(out.join('')).toBe(long);
  });
});

describe('readableLength', () => {
  it('数的是真正会被念出来的字数', () => {
    expect(readableLength('hello')).toBe(5);
    expect(readableLength('  你好  世界  ')).toBe(4); // 空白不算
  });

  it('链接不算内容', () => {
    // 光是一条链接，念出来没有任何意义
    expect(readableLength('https://t.co/abcdefghij')).toBe(0);
    expect(readableLength('看这个 https://t.co/abcdefghij')).toBe(3);
  });

  it('@提及不算内容', () => {
    expect(readableLength('@alice 谢谢')).toBe(2);
    expect(readableLength('@alice')).toBe(0);
  });

  it('emoji 按 1 个算，不是 2 个', () => {
    // 用 .length 数的话这里会是 4
    expect(readableLength('🔥🔥')).toBe(2);
  });

  it('引用帖的正文要计入 —— 短帖配长引用是有信息量的', () => {
    expect(readableLength('This 👇', '一段很长的引用内容，说的是一个完整的观点。')).toBeGreaterThan(
      20,
    );
  });

  it('什么都没有就是 0', () => {
    expect(readableLength('')).toBe(0);
    expect(readableLength('   ', '')).toBe(0);
  });
});
