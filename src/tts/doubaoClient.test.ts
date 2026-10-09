import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoubaoError, hasCredentials, synthesizeDoubao } from './doubaoClient';

/**
 * 用假 fetch 锁住请求形状和错误提示。
 *
 * 请求头/字段名写错是最容易犯、又最难在真机上定位的错误 ——
 * 接口只会返回一个 400，看不出到底哪里不对。
 */

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let captured: Captured | null = null;

function installFetch(response: {
  status?: number;
  ok?: boolean;
  headers?: Record<string, string>;
  json?: unknown;
  throwError?: Error;
}) {
  captured = null;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured = {
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    };
    if (response.throwError) throw response.throwError;

    const status = response.status ?? 200;
    return {
      ok: response.ok ?? status < 400,
      status,
      headers: { get: (name: string) => response.headers?.[name] ?? null },
      json: async () => response.json ?? {},
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const OK_AUDIO = {
  code: 0,
  audio: 'QUJD',
  duration: 3.2,
  subtitle: {
    sentences: [
      { start_time: 1200, end_time: 2400, text: '第二句' },
      { start_time: 0, end_time: 1200, text: '第一句' },
    ],
  },
};

describe('hasCredentials', () => {
  it('有 API Key 或 AppID+AccessKey 之一即可', () => {
    expect(hasCredentials({ apiKey: 'k' })).toBe(true);
    expect(hasCredentials({ appId: 'a', accessKey: 'b' })).toBe(true);
    expect(hasCredentials({ appId: 'a' })).toBe(false);
    expect(hasCredentials({})).toBe(false);
  });
});

describe('synthesizeDoubao', () => {
  it('用 API Key 时的请求形状', async () => {
    installFetch({ json: OK_AUDIO });

    await synthesizeDoubao(
      { apiKey: 'secret-key' },
      { text: '  你好  ', voice: 'zh_female_xiaohe_uranus_bigtts', model: 'seed-audio-1.0' },
    );

    expect(captured?.url).toBe('https://openspeech.bytedance.com/api/v3/tts/create');
    expect(captured?.headers['X-Api-Key']).toBe('secret-key');
    expect(captured?.headers['Content-Type']).toBe('application/json');
    // 每个请求都要带唯一 request id，接口靠它排查问题
    expect(captured?.headers['X-Api-Request-Id']).toBeTruthy();

    const body = captured?.body as Record<string, unknown>;
    expect(body.model).toBe('seed-audio-1.0');
    expect(body.text_prompt).toBe('你好'); // 前后空白要去掉
    expect(body.references).toEqual([{ speaker: 'zh_female_xiaohe_uranus_bigtts' }]);
    // 字幕是拿来做高亮的前提，必须显式打开
    expect((body.audio_config as Record<string, unknown>).enable_subtitle).toBe(true);
    expect((body.audio_config as Record<string, unknown>).format).toBe('mp3');
  });

  it('用旧版 AppID + AccessKey 时换成对应的头', async () => {
    installFetch({ json: OK_AUDIO });

    await synthesizeDoubao(
      { appId: 'app-1', accessKey: 'ak-1' },
      { text: '你好', voice: 'v', model: 'm' },
    );

    expect(captured?.headers['X-Api-App-Id']).toBe('app-1');
    expect(captured?.headers['X-Api-Access-Key']).toBe('ak-1');
    expect(captured?.headers['X-Api-Key']).toBeUndefined();
  });

  it('语速会被夹到接口允许的 -50~100', async () => {
    installFetch({ json: OK_AUDIO });

    await synthesizeDoubao({ apiKey: 'k' }, { text: 'x', voice: 'v', model: 'm', speechRate: 999 });
    expect((captured?.body.audio_config as Record<string, unknown>).speech_rate).toBe(100);

    await synthesizeDoubao({ apiKey: 'k' }, { text: 'x', voice: 'v', model: 'm', speechRate: -999 });
    expect((captured?.body.audio_config as Record<string, unknown>).speech_rate).toBe(-50);
  });

  it('返回音频和按时间排序的字幕', async () => {
    installFetch({ json: OK_AUDIO });

    const result = await synthesizeDoubao(
      { apiKey: 'k' },
      { text: '你好', voice: 'v', model: 'm' },
    );

    expect(result.audio).toBe('QUJD');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.duration).toBe(3.2);
    expect(result.sentences.map((s) => s.text)).toEqual(['第一句', '第二句']);
  });

  it('没有密钥时给出可照做的提示，而不是干巴巴报错', async () => {
    await expect(
      synthesizeDoubao({}, { text: '你好', voice: 'v', model: 'm' }),
    ).rejects.toMatchObject({ hint: expect.stringContaining('API Key') });
  });

  it('401/403 提示去检查 Key 和服务开通状态', async () => {
    installFetch({ status: 401, ok: false, json: { message: 'unauthorized' } });

    await expect(
      synthesizeDoubao({ apiKey: 'bad' }, { text: '你好', voice: 'v', model: 'm' }),
    ).rejects.toMatchObject({
      name: 'DoubaoError',
      hint: expect.stringContaining('API Key'),
    });
  });

  it('429 提示限流', async () => {
    installFetch({ status: 429, ok: false, json: { message: 'too many' } });

    await expect(
      synthesizeDoubao({ apiKey: 'k' }, { text: '你好', voice: 'v', model: 'm' }),
    ).rejects.toMatchObject({ hint: expect.stringContaining('限流') });
  });

  it('接口返回 200 但没有音频也算失败（不能静默当成成功）', async () => {
    installFetch({ json: { code: 0, message: 'no audio' } });

    await expect(
      synthesizeDoubao({ apiKey: 'k' }, { text: '你好', voice: 'v', model: 'm' }),
    ).rejects.toBeInstanceOf(DoubaoError);
  });

  it('网络异常被包成带提示的 DoubaoError', async () => {
    installFetch({ throwError: new Error('network down') });

    await expect(
      synthesizeDoubao({ apiKey: 'k' }, { text: '你好', voice: 'v', model: 'm' }),
    ).rejects.toMatchObject({ hint: expect.stringContaining('网络') });
  });

  it('空文本不发请求', async () => {
    installFetch({ json: OK_AUDIO });

    await expect(
      synthesizeDoubao({ apiKey: 'k' }, { text: '   ', voice: 'v', model: 'm' }),
    ).rejects.toThrow(/为空/);
    expect(captured).toBeNull();
  });
});
