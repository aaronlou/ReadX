import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { getProviderCredentials } from '@/credentials';
import { t } from '@/i18n';
import { getSettings, patchSettings, type ReadXSettings } from '@/settings';
import { LANGUAGE_CHOICES, languageLabel } from '@/translate/languages';
import { CLOUD_TTS_PROVIDERS, type CloudTtsSpec } from '@/tts/providers';
import { WebSpeechProvider } from '@/tts/webSpeech';
import type { GetStateResponse, ReaderCommand, ReaderSnapshot, RuntimeMessage } from '@/types';

const provider = new WebSpeechProvider();

const STATE_LABEL: Record<ReaderSnapshot['state'], string> = {
  idle: t('popup_stateIdle'),
  loading: t('popup_stateLoading'),
  speaking: t('popup_stateSpeaking'),
  paused: t('popup_statePaused'),
  error: t('popup_stateError'),
  'need-language-pack': t('popup_stateNeedLanguagePack'),
};

async function sendToTab(message: RuntimeMessage): Promise<GetStateResponse> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: t('popup_noActiveTab') };
  try {
    const response = (await browser.tabs.sendMessage(tab.id, message)) as GetStateResponse | undefined;
    return response ?? { ok: false, error: t('popup_noPageResponse') };
  } catch {
    return { ok: false, error: t('popup_openXFirst') };
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<ReaderSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReadXSettings | null>(null);
  const [voices, setVoices] = useState(() => provider.getVoices());
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineStatus, setEngineStatus] = useState<string | null>(null);
  /** 当前云语音服务商的凭据填全了没有；null 表示没在云语音模式或还没查 */
  const [cloudConfigured, setCloudConfigured] = useState<boolean | null>(null);

  // 每次打开 popup 或切换服务商时都重新查一遍 —— 用户很可能刚去选项页填过凭据
  useEffect(() => {
    if (!settings || settings.ttsEngine !== 'cloud') {
      setCloudConfigured(null);
      return;
    }
    const spec = CLOUD_TTS_PROVIDERS.find((p) => p.id === settings.cloudProvider);
    if (!spec) {
      setCloudConfigured(false);
      return;
    }
    let cancelled = false;
    void getProviderCredentials(spec.id).then((credentials) => {
      if (!cancelled) setCloudConfigured(spec.isConfigured(credentials));
    });
    return () => {
      cancelled = true;
    };
  }, [settings?.ttsEngine, settings?.cloudProvider, settings]);

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
      setError(response.error ?? t('popup_cannotConnect'));
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
   * 启用某个云语音服务商。必须先拿到域名权限再切引擎 ——
   * 反过来的话用户会在朗读时才发现请求发不出去。
   * 申请权限必须在用户手势（就是这次点击）里发起，且只能从扩展页面发起。
   */
  const enableCloud = useCallback(
    async (spec: CloudTtsSpec) => {
      setEngineBusy(true);
      setEngineStatus(null);
      try {
        const granted = await browser.permissions.request({ origins: spec.origins });
        if (!granted) {
          setEngineStatus(t('popup_permissionDenied', [spec.origins.join(', ')]));
          return;
        }
        update({ ttsEngine: 'cloud', cloudProvider: spec.id });
        setEngineStatus(t('popup_cloudEnabled', [spec.name]));
      } catch (error) {
        setEngineStatus(t('popup_permissionFailed', [(error as Error).message]));
      } finally {
        setEngineBusy(false);
      }
    },
    [update],
  );

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
          <span className="text-[11px] text-slate-500">{t('popup_tagline')}</span>
        </div>
        <span className="text-[11px] tabular-nums text-slate-500">
          {snapshot ? STATE_LABEL[snapshot.state] : t('popup_notConnected')}
        </span>
      </header>

      {!supported && (
        <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          {t('popup_unsupported')}
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
                    <span>{t('popup_waitingLang')}</span>
                  )}
                  {snapshot?.langSource && (
                    <span className="text-slate-500">
                      {t('popup_source', [snapshot.langSource])}
                    </span>
                  )}
                  {progress && (
                    <span className="tabular-nums">{t('popup_sentenceProgress', [progress])}</span>
                  )}
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
                    ? t('popup_packDownloading', [
                        snapshot.pendingPack.from,
                        snapshot.pendingPack.to,
                        String(Math.round((snapshot.packProgress ?? 0) * 100)),
                      ])
                    : t('popup_packNeeded', [snapshot.pendingPack.from, snapshot.pendingPack.to])}
                </p>
              </div>
            )}
          </section>

          <section className="mt-3 grid grid-cols-4 gap-2">
            <ControlButton onClick={() => void command('prev')}>{t('popup_prevPost')}</ControlButton>
            <ControlButton primary onClick={() => void command('toggle')}>
              {snapshot?.state === 'speaking' ? t('popup_pause') : t('popup_play')}
            </ControlButton>
            <ControlButton onClick={() => void command('next')}>{t('popup_nextPost')}</ControlButton>
            <ControlButton onClick={() => void command('stop')}>{t('popup_stop')}</ControlButton>
          </section>
        </>
      )}

      {settings && (
        <section className="mt-4 space-y-3 border-t border-white/10 pt-3">
          {/* 引擎切换：云语音需要先申请域名权限，所以按钮必须真的可点（用户手势）。
              选项来自注册表，加服务商不用改这里。 */}
          <div>
            <span className="text-xs text-slate-400">{t('popup_engine')}</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => update({ ttsEngine: 'system' })}
                className={engineClass(settings.ttsEngine === 'system')}
              >
                {t('popup_systemVoice')}
              </button>
              {CLOUD_TTS_PROVIDERS.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  disabled={engineBusy}
                  onClick={() => void enableCloud(spec)}
                  className={engineClass(
                    settings.ttsEngine === 'cloud' && settings.cloudProvider === spec.id,
                  )}
                >
                  {engineBusy ? t('popup_authorizing') : spec.name}
                </button>
              ))}
            </div>
            {engineStatus && (
              <p className="mt-1 text-[11px] text-amber-300">{engineStatus}</p>
            )}

            {/* 选了云语音但凭据还没填 —— 这是最容易卡住的一步，必须在这里
                直接给出可点的入口。凭据只在选项页填（popup 太窄，而且那里
                还有音色等其他设置）。 */}
            {settings.ttsEngine === 'cloud' && cloudConfigured === false && (
              <button
                type="button"
                onClick={() => void browser.runtime.openOptionsPage()}
                className="mt-2 w-full cursor-pointer rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-200 transition-colors hover:bg-amber-400/20"
              >
                <b>
                  {t('popup_notConfigured', [
                    CLOUD_TTS_PROVIDERS.find((p) => p.id === settings.cloudProvider)?.name ??
                      t('popup_cloudFallback'),
                  ])}
                </b>
                <span className="mt-0.5 block text-amber-200/70">
                  {t('popup_notConfiguredHint')}
                </span>
              </button>
            )}
          </div>

          <label className="block">
            <span className="text-xs text-slate-400">{t('popup_readingLang')}</span>
            <select
              value={settings.readingLang}
              onChange={(e) => update({ readingLang: e.target.value })}
              className="mt-1 w-full cursor-pointer rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="auto">{t('popup_followOriginal')}</option>
              {LANGUAGE_CHOICES.map((code) => (
                <option key={code} value={code}>
                  {languageLabel(code)}
                </option>
              ))}
            </select>
            {settings.readingLang !== 'auto' && (
              <span className="mt-1 block text-[11px] text-slate-500">
                {t('popup_translateHint')}
              </span>
            )}
          </label>

          <label className="block">
            <span className="flex items-center justify-between text-xs text-slate-400">
              {t('popup_rate')}
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
              {t('popup_volume')}
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
                {t('popup_voicePickerLabel', [String(relevantVoices.length), snapshot.lang])}
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
                <option value="">{t('popup_voiceAuto')}</option>
                {relevantVoices.map((voice) => (
                  <option key={voice.uri} value={voice.uri}>
                    {t('popup_voiceOption', [
                      voice.name,
                      voice.lang,
                      voice.local ? t('popup_voiceLocal') : t('popup_voiceOnline'),
                    ])}
                  </option>
                ))}
              </select>
              {relevantVoices.length === 0 && (
                <span className="mt-1 block text-[11px] text-amber-400">
                  {t('popup_noVoiceForLang')}
                </span>
              )}
            </label>
          )}

          <div className="space-y-2">
            <Toggle
              label={t('popup_autoAdvance')}
              checked={settings.autoAdvance}
              onChange={(v) => update({ autoAdvance: v })}
            />
            <Toggle
              label={t('popup_readAuthor')}
              checked={settings.readAuthor}
              onChange={(v) => update({ readAuthor: v })}
            />
            <Toggle
              label={t('popup_skipAds')}
              checked={settings.skipAds}
              onChange={(v) => update({ skipAds: v })}
            />
            <Toggle
              label={t('popup_skipMediaOnly')}
              checked={settings.skipMediaOnly}
              onChange={(v) => update({ skipMediaOnly: v })}
            />
          </div>

          <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
            {t('popup_shortcuts')}
          </p>

          <button
            type="button"
            onClick={() => void browser.runtime.openOptionsPage()}
            className="w-full cursor-pointer rounded-lg border border-white/10 px-3 py-2 text-left text-[11px] text-slate-300 transition-colors hover:bg-white/5 hover:text-slate-100"
          >
            <b>{t('popup_openSettings')}</b>
            <span className="mt-0.5 block text-slate-500">
              {t('popup_openSettingsHint')}
            </span>
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
