import { describe, expect, it } from 'vitest';
import { CLOUD_TTS_PROVIDERS, DEFAULT_CLOUD_PROVIDER, findCloudProvider } from './index';
import { resolveVoice } from './types';

/**
 * 注册表的**契约测试**。
 *
 * 这一层的意义：新增一个服务商时，漏掉任何一项声明都会在这里立刻炸掉，
 * 而不是等到用户点了播放才发现「没有可用于该语言的音色」。
 */
describe('云语音服务商注册表', () => {
  it('至少注册了一家，且默认值指向存在的服务商', () => {
    expect(CLOUD_TTS_PROVIDERS.length).toBeGreaterThan(0);
    expect(findCloudProvider(DEFAULT_CLOUD_PROVIDER)).toBeDefined();
  });

  it('id 不重复', () => {
    const ids = CLOUD_TTS_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CLOUD_TTS_PROVIDERS.map((p) => [p.id, p] as const))(
    '%s 的声明是完整的',
    (_id, spec) => {
      expect(spec.name.trim()).not.toBe('');
      expect(spec.summary.trim()).not.toBe('');
      expect(spec.maxChars).toBeGreaterThan(0);
      expect(spec.credentials.length).toBeGreaterThan(0);
      expect(spec.voices.length).toBeGreaterThan(0);
      expect(spec.pickerLangs.length).toBeGreaterThan(0);

      // 凭据字段的 key 不能重复，否则 UI 上的两个输入框会写同一个值
      const keys = spec.credentials.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);

      // 音色 id 不能重复
      const voiceIds = spec.voices.map((v) => v.id);
      expect(new Set(voiceIds).size).toBe(voiceIds.length);
    },
  );

  it.each(CLOUD_TTS_PROVIDERS.map((p) => [p.id, p] as const))(
    '%s 申请的域名是合法的 match pattern',
    (_id, spec) => {
      expect(spec.origins.length).toBeGreaterThan(0);
      for (const origin of spec.origins) {
        // 必须是 https，且以 /* 结尾 —— 别的写法在 optional_host_permissions 里会失效
        expect(origin).toMatch(/^https:\/\/[^/]+\/\*$/);
      }
    },
  );

  it.each(CLOUD_TTS_PROVIDERS.map((p) => [p.id, p] as const))(
    '%s 声明的默认音色都真实存在',
    (_id, spec) => {
      const voiceIds = new Set(spec.voices.map((v) => v.id));
      for (const [lang, voiceId] of Object.entries(spec.defaultVoiceByLang)) {
        expect(voiceIds.has(voiceId), `${lang} 的默认音色 ${voiceId} 不在 voices 里`).toBe(true);
      }
      if (spec.fallbackVoice) {
        expect(voiceIds.has(spec.fallbackVoice)).toBe(true);
      }
    },
  );

  // 最容易漏的一条：声明了某个语言可以选，却没有可用的音色
  it.each(CLOUD_TTS_PROVIDERS.map((p) => [p.id, p] as const))(
    '%s 声明的每种语言都能解析出音色',
    (_id, spec) => {
      for (const { code } of spec.pickerLangs) {
        expect(resolveVoice(spec, code), `${code} 解析不出音色`).toBeTruthy();
      }
    },
  );

  it.each(CLOUD_TTS_PROVIDERS.map((p) => [p.id, p] as const))(
    '%s 的凭据判断能区分"填了"和"没填"',
    (_id, spec) => {
      expect(spec.isConfigured({})).toBe(false);
      // 把所有字段都填上一定算配置完整
      const all = Object.fromEntries(spec.credentials.map((f) => [f.key, 'x']));
      expect(spec.isConfigured(all)).toBe(true);
    },
  );
});

describe('resolveVoice', () => {
  const spec = findCloudProvider('doubao')!;

  it('用户绑定优先于服务商默认', () => {
    expect(resolveVoice(spec, 'zh', { zh: 'custom-voice' })).toBe('custom-voice');
  });

  it('地区变体回退到主语言', () => {
    expect(resolveVoice(spec, 'zh-TW', { zh: 'custom-voice' })).toBe('custom-voice');
    expect(resolveVoice(spec, 'zh-TW')).toBe(spec.defaultVoiceByLang.zh);
  });

  it('没有绑定时用服务商为该语言声明的默认音色', () => {
    expect(resolveVoice(spec, 'en')).toBe(spec.defaultVoiceByLang.en);
  });

  it('语言无关的服务商靠 fallbackVoice 兜底', () => {
    const openai = findCloudProvider('openai')!;
    expect(openai.defaultVoiceByLang).toEqual({});
    expect(resolveVoice(openai, 'zh')).toBe(openai.fallbackVoice);
    expect(resolveVoice(openai, 'ja')).toBe(openai.fallbackVoice);
  });
});
