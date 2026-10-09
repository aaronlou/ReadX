import { afterEach, describe, expect, it, vi } from 'vitest';
import { doubaoSpec } from './doubao';
import { openaiSpec } from './openai';
import { CloudTtsError, type SynthesizeRequest } from './types';

/**
 * 两家服务商的请求形状和错误提示。
 * 字段名或请求头写错是最容易犯、又最难在真机上定位的 —— 接口只会回一个 400。
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
  binary?: ArrayBuffer;
  throwError?: Error;
}) {
  captured = null;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured = {
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    if (response.throwError) throw response.throwError;

    const status = response.status ?? 200;
    return {
      ok: response.ok ?? status < 400,
      status,
      headers: { get: (name: string) => response.headers?.[name] ?? null },
      json: async () => response.json ?? {},
      arrayBuffer: async () => response.binary ?? new ArrayBuffer(0),
    };
  });
}

function request(overrides: Partial<SynthesizeRequest> = {}): SynthesizeRequest {
  return {
    text: '你好',
    voice: 'v',
    credentials: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- 豆包

describe('豆包 spec', () => {
  const okBody = {
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

  it('用 API Key 时的请求形状', async () => {
    installFetch({ json: okBody });

    await doubaoSpec.synthesize(
      request({ voice: 'zh_female_xiaohe_uranus_bigtts', credentials: { apiKey: 'secret' } }),
    );

    expect(captured?.url).toBe('https://openspeech.bytedance.com/api/v3/tts/create');
    expect(captured?.headers['X-Api-Key']).toBe('secret');
    // 每个请求都要带唯一 request id，接口靠它排查问题
    expect(captured?.headers['X-Api-Request-Id']).toBeTruthy();

    const body = captured?.body as Record<string, unknown>;
    expect(body.text_prompt).toBe('你好');
    expect(body.references).toEqual([{ speaker: 'zh_female_xiaohe_uranus_bigtts' }]);
    // 字幕是后续做高亮的前提，必须显式打开
    expect((body.audio_config as Record<string, unknown>).enable_subtitle).toBe(true);
  });

  it('旧版控制台的 AppID + AccessKey 走另一组请求头', async () => {
    installFetch({ json: okBody });

    await doubaoSpec.synthesize(request({ credentials: { appId: 'a', accessKey: 'b' } }));

    expect(captured?.headers['X-Api-App-Id']).toBe('a');
    expect(captured?.headers['X-Api-Access-Key']).toBe('b');
    expect(captured?.headers['X-Api-Key']).toBeUndefined();
  });

  it('返回音频和按时间排好序的字幕', async () => {
    installFetch({ json: okBody });

    const result = await doubaoSpec.synthesize(request({ credentials: { apiKey: 'k' } }));

    expect(result.audio).toBe('QUJD');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.duration).toBe(3.2);
    expect(result.sentences?.map((s) => s.text)).toEqual(['第一句', '第二句']);
  });

  it('401 提示去检查 Key 和服务开通状态', async () => {
    installFetch({ status: 401, ok: false, json: { message: 'unauthorized' } });

    await expect(
      doubaoSpec.synthesize(request({ credentials: { apiKey: 'bad' } })),
    ).rejects.toMatchObject({ hint: expect.stringContaining('API Key') });
  });

  it('429 提示限流', async () => {
    installFetch({ status: 429, ok: false, json: { message: 'too many' } });

    await expect(
      doubaoSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toMatchObject({ hint: expect.stringContaining('限流') });
  });

  it('200 但没有音频也算失败，不能静默当成成功', async () => {
    installFetch({ json: { code: 0, message: 'no audio' } });

    await expect(
      doubaoSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toBeInstanceOf(CloudTtsError);
  });

  it('网络异常被包成带提示的错误', async () => {
    installFetch({ throwError: new Error('network down') });

    await expect(
      doubaoSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toMatchObject({ hint: expect.stringContaining('网络') });
  });

  it('空文本不发请求', async () => {
    installFetch({ json: okBody });

    await expect(
      doubaoSpec.synthesize(request({ text: '   ', credentials: { apiKey: 'k' } })),
    ).rejects.toThrow(/为空/);
    expect(captured).toBeNull();
  });
});

// ---------------------------------------------------------------- OpenAI

describe('OpenAI spec', () => {
  it('请求形状：Bearer 鉴权 + input/voice/response_format', async () => {
    installFetch({ binary: new ArrayBuffer(8), headers: { 'Content-Type': 'audio/mpeg' } });

    await openaiSpec.synthesize(
      request({ text: '  hello  ', voice: 'nova', credentials: { apiKey: 'sk-test' } }),
    );

    expect(captured?.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(captured?.headers.Authorization).toBe('Bearer sk-test');

    const body = captured?.body as Record<string, unknown>;
    expect(body.input).toBe('hello');
    expect(body.voice).toBe('nova');
    expect(body.response_format).toBe('mp3');
    expect(body.model).toContain('tts');
  });

  // 这是和豆包最大的不同：响应是二进制流，不是 JSON 里塞 base64
  it('把二进制响应转成 base64', async () => {
    const bytes = new Uint8Array([65, 66, 67]); // "ABC"
    installFetch({ binary: bytes.buffer, headers: { 'Content-Type': 'audio/mpeg' } });

    const result = await openaiSpec.synthesize(request({ credentials: { apiKey: 'k' } }));

    expect(result.audio).toBe('QUJD');
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('失败时返回的是 JSON 错误体，要能读出来', async () => {
    installFetch({
      status: 401,
      ok: false,
      json: { error: { message: 'Incorrect API key provided' } },
    });

    await expect(
      openaiSpec.synthesize(request({ credentials: { apiKey: 'bad' } })),
    ).rejects.toMatchObject({
      message: 'Incorrect API key provided',
      hint: expect.stringContaining('API Key'),
    });
  });

  it('返回空音频算失败', async () => {
    installFetch({ binary: new ArrayBuffer(0) });

    await expect(
      openaiSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toThrow(/空音频/);
  });

  it('凭据只需要一个 apiKey', () => {
    expect(openaiSpec.isConfigured({})).toBe(false);
    expect(openaiSpec.isConfigured({ apiKey: 'sk-x' })).toBe(true);
  });
});
