import { describe, expect, it } from 'vitest';
import {
  isSameLanguage,
  isSupportedLanguage,
  languageLabel,
  toApiCode,
  translationPair,
} from './languages';

describe('toApiCode', () => {
  // API 只认 base code，地区变体都是非法的 —— 这是最容易踩的坑
  it('把地区变体归一化成 base code', () => {
    expect(toApiCode('en-US')).toBe('en');
    expect(toApiCode('pt-BR')).toBe('pt');
    expect(toApiCode('ja-JP')).toBe('ja');
    expect(toApiCode('EN')).toBe('en');
    expect(toApiCode('zh_CN')).toBe('zh');
  });

  it('中文必须先分辨简繁，因为 API 只认 zh 和 zh-Hant', () => {
    expect(toApiCode('zh-CN')).toBe('zh');
    expect(toApiCode('zh-Hans')).toBe('zh');
    expect(toApiCode('zh')).toBe('zh');
    expect(toApiCode('zh-TW')).toBe('zh-Hant');
    expect(toApiCode('zh-HK')).toBe('zh-Hant');
    expect(toApiCode('zh-Hant')).toBe('zh-Hant');
    expect(toApiCode('zh-MO')).toBe('zh-Hant');
  });

  it('处理新旧代码不一致的语种', () => {
    expect(toApiCode('nb')).toBe('no');
    expect(toApiCode('nn')).toBe('no');
    expect(toApiCode('iw')).toBe('he');
    expect(toApiCode('in')).toBe('id');
  });

  it('不支持的语种返回 null，调用方据此降级读原文', () => {
    expect(toApiCode('fa')).toBeNull();
    expect(toApiCode('sw')).toBeNull();
    expect(toApiCode('')).toBeNull();
    expect(toApiCode(null)).toBeNull();
    expect(toApiCode(undefined)).toBeNull();
  });

  it('无法解析的语言标签不会被误判成支持', () => {
    expect(toApiCode('und')).toBeNull();
  });
});

describe('isSupportedLanguage', () => {
  it('与 toApiCode 保持一致', () => {
    expect(isSupportedLanguage('zh-CN')).toBe(true);
    expect(isSupportedLanguage('fa')).toBe(false);
  });
});

describe('isSameLanguage', () => {
  it('简体中文的各种写法是同一门语言', () => {
    expect(isSameLanguage('zh-CN', 'zh')).toBe(true);
    expect(isSameLanguage('zh-Hans', 'zh-CN')).toBe(true);
  });

  it('简体和繁体不是同一门语言', () => {
    expect(isSameLanguage('zh-CN', 'zh-TW')).toBe(false);
  });

  it('地区变体不影响判定', () => {
    expect(isSameLanguage('en-US', 'en-GB')).toBe(true);
    expect(isSameLanguage('pt-BR', 'pt-PT')).toBe(true);
  });

  it('两边都超出 API 支持范围时退回 base code 比较', () => {
    expect(isSameLanguage('fa-IR', 'fa')).toBe(true);
    expect(isSameLanguage('fa', 'zh')).toBe(false);
  });
});

describe('translationPair', () => {
  it('正常情况下给出 API 代码', () => {
    expect(translationPair('en-US', 'zh-CN')).toEqual({ from: 'en', to: 'zh' });
    expect(translationPair('ja', 'zh-TW')).toEqual({ from: 'ja', to: 'zh-Hant' });
  });

  // 返回 null 表示"不需要翻译"，这是最常见的情况，不该被当成错误
  it('源和目标其实是同一门语言时返回 null', () => {
    expect(translationPair('en', 'en-US')).toBeNull();
    expect(translationPair('zh-CN', 'zh')).toBeNull();
  });

  it('任一侧 API 不支持时返回 null', () => {
    expect(translationPair('fa', 'zh')).toBeNull();
    expect(translationPair('en', 'fa')).toBeNull();
  });
});

describe('languageLabel', () => {
  it('有收录的给可读名称，没收录的直接显示代码', () => {
    expect(languageLabel('zh')).toBe('中文（简体）');
    expect(languageLabel('ja')).toBe('日本語');
    expect(languageLabel('xx')).toBe('xx');
  });
});
