import { describe, expect, it } from 'vitest';
import { detectByScript, detectLanguage } from './detect';

describe('detectByScript', () => {
  it('假名优先于汉字 —— 否则日文会被整片误判成中文', () => {
    expect(detectByScript('これは日本語です')).toBe('ja');
    expect(detectByScript('カタカナのテキスト')).toBe('ja');
  });

  it('没有假名的汉字文本判为中文', () => {
    expect(detectByScript('这是一段中文')).toBe('zh');
  });

  it('西里尔 / 阿拉伯 / 韩文 / 泰文', () => {
    expect(detectByScript('Привет мир')).toBe('ru');
    expect(detectByScript('مرحبا بالعالم')).toBe('ar');
    expect(detectByScript('안녕하세요')).toBe('ko');
    expect(detectByScript('สวัสดี')).toBe('th');
  });

  it('拉丁字母不做字符集判定，交给 CLD', () => {
    expect(detectByScript('Hello world')).toBeNull();
  });

  it('纯 emoji / 数字也判不出来', () => {
    expect(detectByScript('🎉🚀 12345')).toBeNull();
  });

  // 已知局限：整句都是汉字的日文会被认成中文。
  // 实际使用中 X 的 lang 属性会兜住这种情况（真实日文几乎总含假名）。
  it('已知局限：纯汉字日文会被判成中文', () => {
    expect(detectByScript('日本語')).toBe('zh');
  });
});

describe('detectLanguage', () => {
  it('第 1 层：X 标的 lang 优先级最高', async () => {
    // 即便正文是拉丁字母，X 说是法语就按法语读
    await expect(detectLanguage('Hello', 'fr')).resolves.toMatchObject({
      lang: 'fr',
      source: 'dom',
    });
  });

  it('忽略 und / zxx 这类无意义标注', async () => {
    await expect(detectLanguage('这是一段中文', 'und')).resolves.toMatchObject({
      lang: 'zh',
      source: 'script',
    });
  });

  it('第 2 层：非拉丁语系走字符集判定', async () => {
    await expect(detectLanguage('こんにちは', null)).resolves.toMatchObject({
      lang: 'ja',
      source: 'script',
    });
    await expect(detectLanguage('안녕', null)).resolves.toMatchObject({
      lang: 'ko',
      source: 'script',
    });
  });

  it('归一化语种标签', async () => {
    await expect(detectLanguage('x', 'zh_CN')).resolves.toMatchObject({ lang: 'zh-CN' });
    await expect(detectLanguage('x', 'EN')).resolves.toMatchObject({ lang: 'en' });
    await expect(detectLanguage('x', 'pt-br')).resolves.toMatchObject({ lang: 'pt-BR' });
  });

  it('空文本不抛错，回退到英语', async () => {
    const result = await detectLanguage('', null);
    expect(result.lang).toBe('en');
    expect(result.source).toBe('fallback');
  });

  it('拉丁文本在没有 CLD 的环境下也能给出结果', async () => {
    const result = await detectLanguage('The quick brown fox jumps over the lazy dog', null);
    expect(['cld', 'fallback']).toContain(result.source);
    expect(result.lang).toMatch(/^[a-z]{2}/);
  });
});
