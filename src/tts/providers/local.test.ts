import { afterEach, describe, expect, it, vi } from 'vitest';
import { localSpec, normalizeBaseUrl } from './local';
import { describeHttpFailure } from './types';
import { en } from '../../test/i18n';
import type { SynthesizeRequest } from './types';

/**
 * 本地 TTS 服务。
 *
 * 这里的重点是**请求体不能带多余字段** —— 本地服务常常对未知字段很敏感，
 * 而且用户填的服务地址五花八门（带不带 /v1、带不带尾斜杠），
 * 归一化错了就是一个很难懂 404。
 */

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

let captured: Captured | null = null;

function installFetch(response: {
  status?: number;
  json?: unknown;
  binary?: ArrayBuffer;
  throwError?: Error;
}) {
  captured = null;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured = {
      url,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    if (response.throwError) throw response.throwError;

    const status = response.status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: { get: () => 'audio/mpeg' },
      json: async () => response.json ?? {},
      arrayBuffer: async () => response.binary ?? new Uint8Array([1, 2, 3]).buffer,
    };
  });
}

function request(overrides: Partial<SynthesizeRequest> = {}): SynthesizeRequest {
  return { text: '你好', voice: 'af_heart', credentials: {}, ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeBaseUrl', () => {
  it('只填主机的补上 /v1', () => {
    expect(normalizeBaseUrl('http://localhost:8880')).toBe('http://localhost:8880/v1');
  });

  it('已经带 /v1 的不重复加', () => {
    expect(normalizeBaseUrl('http://localhost:8880/v1')).toBe('http://localhost:8880/v1');
  });

  it('尾斜杠去掉', () => {
    expect(normalizeBaseUrl('http://localhost:8880/')).toBe('http://localhost:8880/v1');
    expect(normalizeBaseUrl('http://localhost:8880/v1///')).toBe('http://localhost:8880/v1');
  });

  it('留空用默认地址', () => {
    expect(normalizeBaseUrl(undefined)).toBe('http://localhost:8880/v1');
    expect(normalizeBaseUrl('   ')).toBe('http://localhost:8880/v1');
  });

  it('自定义端口和自定义版本号都能保留', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:5000')).toBe('http://127.0.0.1:5000/v1');
    expect(normalizeBaseUrl('http://localhost:8000/v2')).toBe('http://localhost:8000/v2');
  });
});

describe('本地服务 spec', () => {
  it('请求形状和 OpenAI 一致，且指向用户填的地址', async () => {
    installFetch({});

    await localSpec.synthesize(
      request({ credentials: { baseUrl: 'http://localhost:9999', model: 'my-model' } }),
    );

    expect(captured?.url).toBe('http://localhost:9999/v1/audio/speech');
    expect(captured?.body).toMatchObject({
      model: 'my-model',
      input: '你好',
      voice: 'af_heart',
      response_format: 'mp3',
      speed: 1,
    });
  });

  it('不填地址就用默认的 8880', async () => {
    installFetch({});
    await localSpec.synthesize(request());
    expect(captured?.url).toBe('http://localhost:8880/v1/audio/speech');
  });

  it('音色选「服务端默认」时不发 voice 字段', async () => {
    // 硬塞一个服务端不认识的音色名只会换来一个 400。
    // 所以这个特殊值必须**完全不出现**在请求体里。
    installFetch({});
    await localSpec.synthesize(request({ voice: 'default' }));
    expect(captured?.body).not.toHaveProperty('voice');
  });

  it('不需要任何凭据就能用', () => {
    // 地址有默认值、也没有密钥 —— 选上就该能出声
    expect(localSpec.needsCredentials).toBe(false);
    expect(localSpec.isConfigured({})).toBe(true);
  });

  it('服务没起来时给出可操作的提示，而不是只丢一句 Failed to fetch', async () => {
    installFetch({ throwError: new TypeError('Failed to fetch') });

    await expect(localSpec.synthesize(request())).rejects.toThrow(
      en('provider_local_errUnreachable', ['http://localhost:8880/v1']),
    );
  });

  it('服务端返回的错误原文要透出来', async () => {
    installFetch({
      status: 400,
      json: { error: { message: 'voice "nope" not found' } },
    });

    await expect(localSpec.synthesize(request({ voice: 'nope' }))).rejects.toThrow(
      'voice "nope" not found',
    );
  });

  it('空音频算失败，不能让播放器静默卡住', async () => {
    installFetch({ binary: new ArrayBuffer(0) });
    await expect(localSpec.synthesize(request())).rejects.toThrow(
      en('provider_local_errEmptyAudio'),
    );
  });

  it('空文本直接拒绝，不发请求', async () => {
    installFetch({});
    await expect(localSpec.synthesize(request({ text: '   ' }))).rejects.toThrow();
    expect(captured).toBeNull();
  });
});

describe('429 的两种含义必须分开', () => {
  // OpenAI（以及照抄它错误格式的一众服务商）用同一个 429 表示两件相反的事。
  // 一律说"请求太频繁"会让余额用完的人一直重试，永远好不了。
  it('insufficient_quota 要说余额用完，不能说请求太频繁', () => {
    const hint = describeHttpFailure(429, 'OpenAI', 'insufficient_quota');
    expect(hint).toBe(en('provider_common_errQuotaExhausted', ['OpenAI']));
    expect(hint).not.toBe(en('provider_common_errRateLimited'));
  });

  it('没有 code 的 429 仍然按限流处理', () => {
    expect(describeHttpFailure(429, 'OpenAI')).toBe(en('provider_common_errRateLimited'));
    expect(describeHttpFailure(429, 'OpenAI', 'rate_limit_exceeded')).toBe(
      en('provider_common_errRateLimited'),
    );
  });

  it('其它状态码不受影响', () => {
    expect(describeHttpFailure(401, 'OpenAI')).toBe(en('provider_common_errAuth', ['OpenAI']));
    expect(describeHttpFailure(404, 'OpenAI')).toBe(en('provider_common_errNotFound'));
    expect(describeHttpFailure(503, 'OpenAI')).toBe(en('provider_common_errServer', ['OpenAI']));
  });
});
