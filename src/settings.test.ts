import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrate } from './settings';

/**
 * 老版本设置的迁移。
 *
 * 这类 bug 的特点：新用户完全正常，**只有升级上来的老用户会中招** ——
 * 因为存储里是旧值，而新代码不认识它。上一轮就踩了一次：
 * 引擎名从 'doubao' 改成 'cloud' 却没迁移，导致老用户"启用了豆包却还是
 * 机器人的声音"，而且设置面板两张卡片都不高亮。
 */
describe('设置迁移', () => {
  it('把旧的 doubao 引擎名迁到 cloud', () => {
    const result = migrate({ ttsEngine: 'doubao' } as never);

    expect(result.ttsEngine).toBe('cloud');
    // 还要记住具体是哪家服务商
    expect(result.cloudProvider).toBe('doubao');
  });

  it('已经是新格式的值原样保留', () => {
    const result = migrate({ ttsEngine: 'cloud', cloudProvider: 'openai' });

    expect(result.ttsEngine).toBe('cloud');
    expect(result.cloudProvider).toBe('openai');
  });

  it('system 不受影响', () => {
    expect(migrate({ ttsEngine: 'system' }).ttsEngine).toBe('system');
  });

  it('把旧的单服务商音色绑定迁到多服务商结构', () => {
    const result = migrate({
      doubaoVoices: { zh: 'zh_male_qingcang_mars_bigtts' },
    } as never);

    expect(result.cloudVoices.doubao).toEqual({ zh: 'zh_male_qingcang_mars_bigtts' });
  });

  it('已经有新结构的音色绑定时不覆盖', () => {
    const result = migrate({
      doubaoVoices: { zh: '旧的' },
      cloudVoices: { doubao: { zh: '新的' } },
    } as never);

    expect(result.cloudVoices.doubao).toEqual({ zh: '新的' });
  });

  it('空的旧字段不会污染结果', () => {
    const result = migrate({ doubaoVoices: {} } as never);
    expect(result.cloudVoices).toEqual({});
  });

  it('完全空的存储得到一份完整的默认值', () => {
    expect(migrate({})).toEqual(DEFAULT_SETTINGS);
  });

  it('缺失的字段一律补默认值', () => {
    const result = migrate({ rate: 1.5 });
    expect(result.rate).toBe(1.5);
    expect(result.readingLang).toBe(DEFAULT_SETTINGS.readingLang);
    expect(result.ttsEngine).toBe('system');
  });
});
