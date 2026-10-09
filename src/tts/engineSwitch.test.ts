import { describe, expect, it, vi } from 'vitest';
import type { TtsEngine } from '../settings';
import { TtsEngineSwitch } from './engineSwitch';
import type { SpeakOutcome, TtsProvider } from './provider';

class StubProvider implements TtsProvider {
  readonly name: string;
  outcome: SpeakOutcome = 'ended';
  readonly speakCalls: string[] = [];
  stopCalls = 0;

  constructor(name: string) {
    this.name = name;
  }
  isSupported() {
    return true;
  }
  getVoices() {
    return [];
  }
  onVoicesChanged() {
    return () => {};
  }
  async ensureReady() {}
  async speak(text: string): Promise<SpeakOutcome> {
    this.speakCalls.push(text);
    return this.outcome;
  }
  pause() {}
  resume() {}
  stop() {
    this.stopCalls += 1;
  }
  voiceFor() {
    return `${this.name}-voice`;
  }
}

function makeSwitch(engine: TtsEngine = 'cloud') {
  const system = new StubProvider('system');
  const cloud = new StubProvider('cloud');
  let current: TtsEngine = engine;
  const switcher = new TtsEngineSwitch(system, cloud, () => current);
  return {
    system,
    cloud,
    switcher,
    setEngine: (next: TtsEngine) => {
      current = next;
    },
  };
}

const OPTS = { lang: 'zh', rate: 1, pitch: 1, volume: 1 };

describe('TtsEngineSwitch', () => {
  it('选豆包时走豆包，选系统时走系统', async () => {
    const a = makeSwitch('cloud');
    await a.switcher.speak('一', OPTS);
    expect(a.cloud.speakCalls).toEqual(['一']);
    expect(a.system.speakCalls).toEqual([]);

    const b = makeSwitch('system');
    await b.switcher.speak('一', OPTS);
    expect(b.system.speakCalls).toEqual(['一']);
    expect(b.cloud.speakCalls).toEqual([]);
  });

  // 这是这一层存在的全部理由：豆包有一堆失败方式（没密钥 / 没授权 /
  // 网络 / 额度 / 音色失效），任何一种都不该让用户面对"点了播放却什么都没有"
  it('豆包失败时立刻降级到系统语音，并且这一句仍然读出来', async () => {
    const { switcher, system, cloud } = makeSwitch('cloud');
    cloud.outcome = 'error';

    const outcome = await switcher.speak('一', OPTS);

    expect(outcome).toBe('ended');
    expect(cloud.speakCalls).toEqual(['一']);
    expect(system.speakCalls).toEqual(['一']);
    expect(switcher.isDegraded).toBe(true);
  });

  it('降级是粘性的：后续句子不再反复去撞豆包', async () => {
    const { switcher, system, cloud } = makeSwitch('cloud');
    cloud.outcome = 'error';

    await switcher.speak('一', OPTS);
    await switcher.speak('二', OPTS);
    await switcher.speak('三', OPTS);

    expect(cloud.speakCalls).toEqual(['一']);
    expect(system.speakCalls).toEqual(['一', '二', '三']);
  });

  it('降级时把子引擎报的具体原因带出来，而不是用通用文案盖掉', async () => {
    const { switcher, cloud } = makeSwitch('cloud');
    cloud.outcome = 'error';
    // 子引擎先报了具体原因（真实场景里是「API Key 无效」这类）
    (cloud as unknown as { onError?: (m: string, h?: string) => void }).onError?.(
      '豆包语音 还没有配置凭据',
      '到扩展的选项页填写',
    );
    const onError = vi.fn();
    switcher.onError = onError;

    await switcher.speak('一', OPTS);

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('还没有配置凭据'),
      '到扩展的选项页填写',
    );
  });

  it('子引擎没报原因时才退回通用文案', async () => {
    const { switcher, cloud } = makeSwitch('cloud');
    cloud.outcome = 'error';
    const onError = vi.fn();
    switcher.onError = onError;

    await switcher.speak('一', OPTS);

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('云语音不可用'),
      expect.any(String),
    );
  });

  // 这一条守的是"用户去填了 API Key，回来却发现还是系统语音"这个坑。
  // 降级如果只在换引擎时复位，填完凭据根本不会重试云语音。
  it('任何设置变化都会复位降级，让用户修完问题能立刻生效', async () => {
    const { switcher, cloud, system } = makeSwitch('cloud');
    cloud.outcome = 'error';

    await switcher.speak('一', OPTS);
    expect(switcher.isDegraded).toBe(true);
    expect(cloud.speakCalls).toEqual(['一']);

    // 用户去选项页填好了凭据（引擎本身没变），随后保存设置触发了这次调用
    cloud.outcome = 'ended';
    switcher.onSettingsChanged();

    await switcher.speak('二', OPTS);

    expect(switcher.isDegraded).toBe(false);
    expect(cloud.speakCalls).toEqual(['一', '二']); // 真的重试了云语音
    expect(system.speakCalls).toEqual(['一']); // 没有多余地再用系统语音
  });

  it('用户主动切回系统语音后就恢复正常，不再报降级', async () => {
    const { switcher, system, cloud, setEngine } = makeSwitch('cloud');
    cloud.outcome = 'error';
    await switcher.speak('一', OPTS);
    expect(switcher.isDegraded).toBe(true);

    // 用户去设置里改成系统语音
    setEngine('system');
    await switcher.speak('二', OPTS);
    expect(switcher.isDegraded).toBe(false);

    // 再切回豆包（比如重新填了密钥）→ 降级状态复位，会再试一次豆包
    cloud.outcome = 'ended';
    setEngine('cloud');
    switcher.onSettingsChanged();
    await switcher.speak('三', OPTS);

    expect(cloud.speakCalls).toEqual(['一', '三']);
    expect(system.speakCalls).toEqual(['一', '二']);
  });

  it('用户主动中止（cancelled）不触发降级', async () => {
    const { switcher, system, cloud } = makeSwitch('cloud');
    cloud.outcome = 'cancelled';

    const outcome = await switcher.speak('一', OPTS);

    expect(outcome).toBe('cancelled');
    expect(system.speakCalls).toEqual([]);
    expect(switcher.isDegraded).toBe(false);
  });

  it('stop() 同时停掉两个引擎 —— 切换的那一刻无法确定谁在播', () => {
    const { switcher, system, cloud } = makeSwitch('cloud');
    switcher.stop();
    expect(system.stopCalls).toBe(1);
    expect(cloud.stopCalls).toBe(1);
  });

  it('voiceFor 转发给当前引擎', () => {
    const { switcher, cloud } = makeSwitch('cloud');
    expect(switcher.voiceFor('zh')).toBe('cloud-voice');
    void cloud;
  });
});
