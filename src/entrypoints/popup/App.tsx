import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { getSettings, patchSettings, type ReadXSettings } from '@/settings';
import { DOUBAO_ORIGIN } from '@/matches';
import { LANGUAGE_CHOICES, languageLabel } from '@/translate/languages';
import { WebSpeechProvider } from '@/tts/webSpeech';
import type { GetStateResponse, ReaderCommand, ReaderSnapshot, RuntimeMessage } from '@/types';

const provider = new WebSpeechProvider();

const STATE_LABEL: Record<ReaderSnapshot['state'], string> = {
  idle: '待机',
  loading: '定位中',
  speaking: '朗读中',
  paused: '已暂停',
  error: '出错了',
  'need-language-pack': '等待语言包',
};

async function sendToTab(message: RuntimeMessage): Promise<GetStateResponse> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: '没有找到活动标签页' };
  try {
    const response = (await browser.tabs.sendMessage(tab.id, message)) as GetStateResponse | undefined;
    return response ?? { ok: false, error: '页面没有响应' };
  } catch {
    return { ok: false, error: '请先打开 x.com（或开发用的 mock 页面）再使用' };
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<ReaderSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReadXSettings | null>(null);
  const [voices, setVoices] = useState(() => provider.getVoices());
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineStatus, setEngineStatus] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
    void provider.ensureReady().then(() => setVoices(provider.getVoices()));
    return provider.onVoicesChanged(setVoices);
  }, []);

  const refresh = useCallback(async () => {
    const response = await sendToTab({ type: 'readx:get-state' });
    if (response.ok && response.snapshot) {
      setSnapshot(response.snapshot);
      setError(null);
    } else {
      setSnapshot(null);
      setError(response.error ?? '无法连接页面');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 800);
    return () => clearInterval(timer);
  }, [refresh]);

  const command = useCallback(
    async (cmd: ReaderCommand) => {
      await sendToTab({ type: 'readx:command', command: cmd });
      window.setTimeout(() => void refresh(), 120);
    },
    [refresh],
  );

  const update = useCallback((patch: Partial<ReadXSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    void patchSettings(patch);
  }, []);

  /**
   * 启用豆包语音。必须先拿到 openspeech.bytedance.com 的权限再切引擎 ——
   * 反过来的话用户会在朗读时才发现请求发不出去。
   * 申请权限必须在用户手势（就是这次点击）里发起。
   */
  const enableDoubao = useCallback(async () => {
    setEngineBusy(true);
    setEngineStatus(null);
    try {
      const granted = await browser.permissions.request({ origins: [DOUBAO_ORIGIN] });
      if (!granted) {
        setEngineStatus('没有授权访问豆包接口，无法启用');
        return;
      }
      update({ ttsEngine: 'doubao' });
      setEngineStatus('已启用。API Key 和音色到「设置」里填');
    } catch (error) {
      setEngineStatus(`授权失败：${(error as Error).message}`);
    } finally {
      setEngineBusy(false);
    }
  }, [update]);

  /** 只列出当前帖子语种能用得上的音色 */
  const relevantVoices = useMemo(() => {
    const lang = snapshot?.lang;
    if (!lang) return [];
    const base = lang.split('-')[0] ?? lang;
    return voices
      .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base.toLowerCase()))
      .sort((a, b) => Number(b.local) - Number(a.local));
  }, [voices, snapshot?.lang]);

  const supported = provider.isSupported();
  const progress =
    snapshot && snapshot.sentenceCount > 0
      ? `${snapshot.sentenceIndex + 1}/${snapshot.sentenceCount}`
      : '';

  return (
    <div className="min-h-[320px] bg-slate-950 p-4 text-slate-100">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-bold tracking-tight">ReadX</h1>
          <span className="text-[11px] text-slate-500">读 X，不用盯屏幕</span>
        </div>
        <span className="text-[11px] tabular-nums text-slate-500">
          {snapshot ? STATE_LABEL[snapshot.state] : '未连接'}
        </span>
      </header>

      {!supported && (
        <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          当前环境不支持 Web Speech API，朗读不可用。
        </p>
      )}

      {error ? (
        <p className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">{error}</p>
      ) : (
        <>
          <section className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {snapshot?.author || '—'}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                  {snapshot?.lang ? (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono uppercase">
                      {snapshot.lang}
                    </span>
                  ) : (
                    <span>等待识别语种</span>
                  )}
                  {snapshot?.langSource && (
                    <span className="text-slate-500">来源：{snapshot.langSource}</span>
                  )}
                  {progress && <span className="tabular-nums">句子 {progress}</span>}
                </p>
              </div>
            </div>

            {(snapshot?.sentence || snapshot?.message) && (
              <p className="mt-2 line-clamp-3 border-t border-white/10 pt-2 text-xs leading-relaxed text-slate-300">
                {snapshot?.sentence || snapshot?.message}
              </p>
            )}

            {/* 语言包必须由用户手势触发下载，页面上的控制条才是正确的入口 */}
            {snapshot?.pendingPack && (
              <div className="mt-2 border-t border-white/10 pt-2">
                <p className="text-[11px] text-amber-300">
                  {snapshot.state === 'loading'
                    ? `正在下载 ${snapshot.pendingPack.from} → ${snapshot.pendingPack.to} 语言包… ${Math.round((snapshot.packProgress ?? 0) * 100)}%`
                    : `${snapshot.pendingPack.from} → ${snapshot.pendingPack.to} 语言包未下载，请在页面右下角的面板上点「下载」`}
                </p>
              </div>
            )}
          </section>

          <section className="mt-3 grid grid-cols-4 gap-2">
            <ControlButton onClick={() => void command('prev')}>⏮ 上一条</ControlButton>
            <ControlButton primary onClick={() => void command('toggle')}>
              {snapshot?.state === 'speaking' ? '⏸ 暂停' : '▶ 播放'}
            </ControlButton>
            <ControlButton onClick={() => void command('next')}>⏭ 下一条</ControlButton>
            <ControlButton onClick={() => void command('stop')}>⏹ 停止</ControlButton>
          </section>
        </>
      )}

      {settings && (
        <section className="mt-4 space-y-3 border-t border-white/10 pt-3">
          {/* 引擎切换：豆包需要先申请域名权限，所以这个按钮必须真的可点（用户手势） */}
          <div>
            <span className="text-xs text-slate-400">朗读引擎</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => update({ ttsEngine: 'system' })}
                className={engineClass(settings.ttsEngine === 'system')}
              >
                系统语音
              </button>
              <button
                type="button"
                disabled={engineBusy}
                onClick={() => void enableDoubao()}
                className={engineClass(settings.ttsEngine === 'doubao')}
              >
                {engineBusy ? '授权中…' : '豆包语音'}
              </button>
            </div>
            {engineStatus && (
              <p className="mt-1 text-[11px] text-amber-300">{engineStatus}</p>
            )}
          </div>

          <label className="block">
            <span className="text-xs text-slate-400">朗读语言</span>
            <select
              value={settings.readingLang}
              onChange={(e) => update({ readingLang: e.target.value })}
              className="mt-1 w-full cursor-pointer rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="auto">跟随原文（各读各的）</option>
              {LANGUAGE_CHOICES.map((code) => (
                <option key={code} value={code}>
                  {languageLabel(code)}
                </option>
              ))}
            </select>
            {settings.readingLang !== 'auto' && (
              <span className="mt-1 block text-[11px] text-slate-500">
                其它语言的帖子会先翻译再朗读；帖子本来就是该语言时直接读原文。
              </span>
            )}
          </label>

          <label className="block">
            <span className="flex items-center justify-between text-xs text-slate-400">
              语速
              <span className="tabular-nums text-slate-300">{settings.rate.toFixed(2)}x</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.rate}
              onChange={(e) => update({ rate: Number(e.target.value) })}
              className="mt-1 h-1 w-full cursor-pointer accent-emerald-400"
            />
          </label>

          <label className="block">
            <span className="flex items-center justify-between text-xs text-slate-400">
              音量
              <span className="tabular-nums text-slate-300">
                {Math.round(settings.volume * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => update({ volume: Number(e.target.value) })}
              className="mt-1 h-1 w-full cursor-pointer accent-emerald-400"
            />
          </label>

          {snapshot?.lang && (
            <label className="block">
              <span className="text-xs text-slate-400">
                音色（{relevantVoices.length} 个可用于 {snapshot.lang}）
              </span>
              <select
                value={settings.voiceOverrides[snapshot.lang] ?? ''}
                onChange={(e) =>
                  update({
                    voiceOverrides: {
                      ...settings.voiceOverrides,
                      [snapshot.lang]: e.target.value,
                    },
                  })
                }
                className="mt-1 w-full cursor-pointer rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">自动匹配</option>
                {relevantVoices.map((voice) => (
                  <option key={voice.uri} value={voice.uri}>
                    {voice.name}（{voice.lang}
                    {voice.local ? ' · 本地' : ' · 在线'}）
                  </option>
                ))}
              </select>
              {relevantVoices.length === 0 && (
                <span className="mt-1 block text-[11px] text-amber-400">
                  系统里没有这个语种的音色，会用默认音色朗读，可能读得不准。
                </span>
              )}
            </label>
          )}

          <div className="space-y-2">
            <Toggle
              label="读完自动滚到下一条"
              checked={settings.autoAdvance}
              onChange={(v) => update({ autoAdvance: v })}
            />
            <Toggle
              label="朗读前先念作者名"
              checked={settings.readAuthor}
              onChange={(v) => update({ readAuthor: v })}
            />
            <Toggle
              label="跳过推广帖"
              checked={settings.skipAds}
              onChange={(v) => update({ skipAds: v })}
            />
            <Toggle
              label="跳过没有文字的帖子"
              checked={settings.skipMediaOnly}
              onChange={(v) => update({ skipMediaOnly: v })}
            />
          </div>

          <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
            快捷键：Alt+Shift+P 播放/暂停 · Alt+Shift+N 下一条 · Alt+Shift+B 上一条
          </p>

          <button
            type="button"
            onClick={() => void browser.runtime.openOptionsPage()}
            className="w-full cursor-pointer rounded-lg border border-white/10 px-3 py-2 text-left text-[11px] text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            能力检测 · 检查本机是否支持设备端翻译 →
          </button>
        </section>
      )}
    </div>
  );
}

function engineClass(active: boolean): string {
  return [
    'cursor-pointer rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors',
    active
      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50'
      : 'bg-white/5 text-slate-400 hover:bg-white/10',
  ].join(' ');
}

function ControlButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'cursor-pointer rounded-lg px-2 py-2 text-[11px] font-medium transition-colors',
        primary
          ? 'bg-emerald-500 text-slate-900 hover:bg-emerald-400'
          : 'bg-white/10 text-slate-200 hover:bg-white/20',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-slate-300">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 cursor-pointer accent-emerald-400"
      />
    </label>
  );
}
