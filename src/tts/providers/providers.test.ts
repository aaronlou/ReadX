import { afterEach, describe, expect, it, vi } from 'vitest';
import { doubaoSpec } from './doubao';
import { openaiSpec } from './openai';
import { openrouterSpec } from './openrouter';
import { en } from '../../test/i18n';
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

  // 这一条守的是一个很容易写错的地方：App-Id 是**应用配置**，不是认证因子，
  // 官方 SDK 会把它和 X-Api-Key 一起发。写成二选一的话，需要靠 App-Id
  // 判定应用、进而决定授予哪个资源的接口会报 "resource not granted" ——
  // 看起来像"没开通服务"，实际是"没告诉我你是哪个应用"。
  it('同时填了 API Key 和 App ID 时，两个头都要发出去', async () => {
    installFetch({ json: okBody });

    await doubaoSpec.synthesize(
      request({ credentials: { apiKey: 'secret', appId: 'app-123' } }),
    );

    expect(captured?.headers['X-Api-Key']).toBe('secret');
    expect(captured?.headers['X-Api-App-Id']).toBe('app-123');
    // 有 API Key 时不该再发 Access Key
    expect(captured?.headers['X-Api-Access-Key']).toBeUndefined();
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
    ).rejects.toMatchObject({ hint: en('provider_common_errAuth', en('provider_doubao_name')) });
  });

  it('429 提示限流', async () => {
    installFetch({ status: 429, ok: false, json: { message: 'too many' } });

    await expect(
      doubaoSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toMatchObject({ hint: en('provider_common_errRateLimited') });
  });

  // 这是用户实际撞到的错误：Key 有效，但账号没开通这个接口对应的服务。
  // 原文 "requested resource not granted" 完全看不出该做什么，
  // 所以必须把"去开通音频生成服务"写进提示里。
  it('resource not granted 提示去开通「音频生成」服务，而不是笼统说 Key 无效', async () => {
    installFetch({
      status: 403,
      ok: false,
      json: {
        message: '[resource_id=volc.service_type.10074] requested resource not granted',
      },
    });

    await expect(
      doubaoSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toMatchObject({ hint: en('provider_doubao_errResourceNotGrantedHint') });
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
    ).rejects.toMatchObject({ hint: en('provider_doubao_errRequestFailedHint') });
  });

  it('空文本不发请求', async () => {
    installFetch({ json: okBody });

    await expect(
      doubaoSpec.synthesize(request({ text: '   ', credentials: { apiKey: 'k' } })),
    ).rejects.toThrow(en('provider_common_errEmptyText'));
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
      hint: en('provider_common_errAuth', en('provider_openai_name')),
    });
  });

  it('返回空音频算失败', async () => {
    installFetch({ binary: new ArrayBuffer(0) });

    await expect(
      openaiSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toThrow(en('provider_openai_errEmptyAudio'));
  });

  it('凭据只需要一个 apiKey', () => {
    expect(openaiSpec.isConfigured({})).toBe(false);
    expect(openaiSpec.isConfigured({ apiKey: 'sk-x' })).toBe(true);
  });
});

// ---------------------------------------------------------------- OpenRouter

describe('OpenRouter spec', () => {
  it('走 OpenAI 兼容的接口，模型名带厂商前缀', async () => {
    installFetch({ binary: new ArrayBuffer(8), headers: { 'Content-Type': 'audio/mpeg' } });

    await openrouterSpec.synthesize(
      request({ voice: 'nova', credentials: { apiKey: 'sk-or-v1-x' } }),
    );

    expect(captured?.url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(captured?.headers.Authorization).toBe('Bearer sk-or-v1-x');
    expect((captured?.body as Record<string, unknown>).model).toBe(
      'openai/gpt-4o-mini-tts-2025-12-15',
    );
  });

  it('可以换模型 —— 比如换成豆包的 Seed Audio', async () => {
    installFetch({ binary: new ArrayBuffer(8) });

    await openrouterSpec.synthesize(
      request({
        voice: 'zh_female_xiaohe_uranus_bigtts',
        credentials: { apiKey: 'k', model: 'bytedance-seed/seed-audio-1-0' },
      }),
    );

    expect((captured?.body as Record<string, unknown>).model).toBe('bytedance-seed/seed-audio-1-0');
  });

  it('把二进制响应转成 base64', async () => {
    installFetch({
      binary: new Uint8Array([65, 66, 67]).buffer,
      headers: { 'Content-Type': 'audio/mpeg' },
    });

    const result = await openrouterSpec.synthesize(
      request({ credentials: { apiKey: 'k' } }),
    );

    expect(result.audio).toBe('QUJD');
  });

  it('模型名不对时提示去哪里查可用模型', async () => {
    installFetch({
      status: 400,
      ok: false,
      json: { error: { message: 'model not found: openai/typo' } },
    });

    await expect(
      openrouterSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toMatchObject({ hint: en('provider_openrouter_errModelNotFoundHint') });
  });

  it('402 提示余额不足（OpenRouter 特有的失败方式）', async () => {
    installFetch({ status: 402, ok: false, json: { error: { message: 'insufficient credits' } } });

    await expect(
      openrouterSpec.synthesize(request({ credentials: { apiKey: 'k' } })),
    ).rejects.toMatchObject({ hint: en('provider_openrouter_errInsufficientCreditsHint') });
  });

  it('只需要一个 apiKey 就算配置完整（模型有默认值）', () => {
    expect(openrouterSpec.isConfigured({})).toBe(false);
    expect(openrouterSpec.isConfigured({ apiKey: 'k' })).toBe(true);
  });
});
