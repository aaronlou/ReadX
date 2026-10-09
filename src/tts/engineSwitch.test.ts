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

function makeSwitch(engine: TtsEngine = 'doubao') {
  const system = new StubProvider('system');
  const doubao = new StubProvider('doubao');
  let current: TtsEngine = engine;
  const switcher = new TtsEngineSwitch(system, doubao, () => current);
  return {
    system,
    doubao,
    switcher,
    setEngine: (next: TtsEngine) => {
      current = next;
    },
  };
}

const OPTS = { lang: 'zh', rate: 1, pitch: 1, volume: 1 };

describe('TtsEngineSwitch', () => {
  it('选豆包时走豆包，选系统时走系统', async () => {
    const a = makeSwitch('doubao');
    await a.switcher.speak('一', OPTS);
    expect(a.doubao.speakCalls).toEqual(['一']);
    expect(a.system.speakCalls).toEqual([]);

    const b = makeSwitch('system');
    await b.switcher.speak('一', OPTS);
    expect(b.system.speakCalls).toEqual(['一']);
    expect(b.doubao.speakCalls).toEqual([]);
  });

  // 这是这一层存在的全部理由：豆包有一堆失败方式（没密钥 / 没授权 /
  // 网络 / 额度 / 音色失效），任何一种都不该让用户面对"点了播放却什么都没有"
  it('豆包失败时立刻降级到系统语音，并且这一句仍然读出来', async () => {
    const { switcher, system, doubao } = makeSwitch('doubao');
    doubao.outcome = 'error';

    const outcome = await switcher.speak('一', OPTS);

    expect(outcome).toBe('ended');
    expect(doubao.speakCalls).toEqual(['一']);
    expect(system.speakCalls).toEqual(['一']);
    expect(switcher.isDegraded).toBe(true);
  });

  it('降级是粘性的：后续句子不再反复去撞豆包', async () => {
    const { switcher, system, doubao } = makeSwitch('doubao');
    doubao.outcome = 'error';

    await switcher.speak('一', OPTS);
    await switcher.speak('二', OPTS);
    await switcher.speak('三', OPTS);

    expect(doubao.speakCalls).toEqual(['一']);
    expect(system.speakCalls).toEqual(['一', '二', '三']);
  });

  it('降级时把原因报给上层', async () => {
    const { switcher, doubao } = makeSwitch('doubao');
    doubao.outcome = 'error';
    const onError = vi.fn();
    switcher.onError = onError;

    await switcher.speak('一', OPTS);

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('豆包'),
      expect.stringContaining('API Key'),
    );
  });

  it('用户主动切回系统语音后就恢复正常，不再报降级', async () => {
    const { switcher, system, doubao, setEngine } = makeSwitch('doubao');
    doubao.outcome = 'error';
    await switcher.speak('一', OPTS);
    expect(switcher.isDegraded).toBe(true);

    // 用户去设置里改成系统语音
    setEngine('system');
    await switcher.speak('二', OPTS);
    expect(switcher.isDegraded).toBe(false);

    // 再切回豆包（比如重新填了密钥）→ 降级状态复位，会再试一次豆包
    doubao.outcome = 'ended';
    setEngine('doubao');
    switcher.onSettingsChanged();
    await switcher.speak('三', OPTS);

    expect(doubao.speakCalls).toEqual(['一', '三']);
    expect(system.speakCalls).toEqual(['一', '二']);
  });

  it('用户主动中止（cancelled）不触发降级', async () => {
    const { switcher, system, doubao } = makeSwitch('doubao');
    doubao.outcome = 'cancelled';

    const outcome = await switcher.speak('一', OPTS);

    expect(outcome).toBe('cancelled');
    expect(system.speakCalls).toEqual([]);
    expect(switcher.isDegraded).toBe(false);
  });

  it('stop() 同时停掉两个引擎 —— 切换的那一刻无法确定谁在播', () => {
    const { switcher, system, doubao } = makeSwitch('doubao');
    switcher.stop();
    expect(system.stopCalls).toBe(1);
    expect(doubao.stopCalls).toBe(1);
  });

  it('voiceFor 转发给当前引擎', () => {
    const { switcher, doubao } = makeSwitch('doubao');
    expect(switcher.voiceFor('zh')).toBe('doubao-voice');
    void doubao;
  });
});
