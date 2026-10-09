import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { getProviderCredentials, maskSecret, setProviderCredentials } from '@/credentials';
import { t } from '@/i18n';
import type { ReadXSettings } from '@/settings';
import type { CloudTtsSynthesizeResponse } from '@/types';
import { base64ToBlob } from '@/tts/cloudTts';
import { CLOUD_TTS_PROVIDERS, resolveVoice, type CloudTtsSpec } from '@/tts/providers';

/** 试听用的样本 */
const SAMPLE_TEXT = t('tts_sampleText');

/**
 * 语音引擎设置面板（选项页和 popup 共用）。
 *
 * **整个面板是从服务商注册表渲染出来的** —— 输入框来自 `spec.credentials`，
 * 域名权限来自 `spec.origins`，音色来自 `spec.voices`。
 * 加一家新的服务商不需要改这个文件。
 *
 * 有个必须注意的顺序问题：**Chrome 要求域名权限的申请必须在用户手势里**，
 * 而且只能从扩展页面发起（内容脚本里不行）。所以「启用」做成了
 * 「申请权限 + 写设置」的原子动作 —— 反过来用户会在朗读时才发现没权限。
 */
export function TtsSettingsPanel({
  settings,
  onChange,
}: {
  settings: ReadXSettings;
  onChange: (patch: Partial<ReadXSettings>) => void;
}) {
  const selected = useMemo(
    () => CLOUD_TTS_PROVIDERS.find((p) => p.id === settings.cloudProvider) ?? CLOUD_TTS_PROVIDERS[0]!,
    [settings.cloudProvider],
  );

  const [saved, setSaved] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadState = useCallback(async (spec: CloudTtsSpec) => {
    const [creds, ok] = await Promise.all([
      getProviderCredentials(spec.id),
      browser.permissions.contains({ origins: spec.origins }),
    ]);
    setSaved(creds);
    setDraft(creds);
    setGranted((prev) => ({ ...prev, [spec.id]: ok }));
  }, []);

  useEffect(() => {
    for (const spec of CLOUD_TTS_PROVIDERS) void loadState(spec);
  }, [loadState]);

  /** 申请域名权限并切到这家服务商 —— 必须在点击事件里调用 */
  const enable = useCallback(
    async (spec: CloudTtsSpec) => {
      setBusy(true);
      setStatus(null);
      try {
        const ok = await browser.permissions.request({ origins: spec.origins });
        setGranted((prev) => ({ ...prev, [spec.id]: ok }));
        if (!ok) {
          setStatus(t('tts_permissionDenied', [spec.origins.join(', '), spec.name]));
          return;
        }
        onChange({ cloudProvider: spec.id, ttsEngine: 'cloud' });
        setStatus(t('tts_enabled', [spec.name]));
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const saveCredentials = useCallback(async () => {
    await setProviderCredentials(selected.id, draft);
    const next = await getProviderCredentials(selected.id);
    setSaved(next);
    setDraft(next);
    setStatus(t('tts_credentialsSaved'));
  }, [draft, selected.id]);

  const test = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const lang = settings.readingLang === 'auto' ? 'zh' : settings.readingLang;
      const bound = settings.cloudVoices[selected.id] ?? {};
      const voice = resolveVoice(selected, lang, bound);
      if (!voice) {
        setStatus(t('tts_noVoiceForLang', [selected.name, lang]));
        return;
      }

      const response = (await browser.runtime.sendMessage({
        type: 'readx:cloud-tts-synthesize',
        providerId: selected.id,
        text: SAMPLE_TEXT,
        voice,
      })) as CloudTtsSynthesizeResponse | undefined;

      if (!response?.ok || !response.audio) {
        setStatus(
          `${t('tts_previewFailed', [response?.error ?? t('tts_noAudioReturned')])}${
            response?.hint ? t('tts_previewHint', [response.hint]) : ''
          }`,
        );
        return;
      }

      const url = URL.createObjectURL(
        base64ToBlob(response.audio, response.mimeType ?? 'audio/mpeg'),
      );
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setStatus(t('tts_audioPlaybackFailed'));
      };
      await audio.play();
      setStatus(t('tts_previewOk'));
    } catch (error) {
      setStatus(t('tts_previewFailed', [(error as Error).message]));
    } finally {
      setBusy(false);
    }
  }, [selected, settings.cloudVoices, settings.readingLang]);

  const configured = selected.isConfigured(saved);
  const isActive = settings.ttsEngine === 'cloud' && settings.cloudProvider === selected.id;

  return (
    <div className="space-y-4">
      {/* ---- 引擎选择 ---- */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <EngineCard
          active={settings.ttsEngine === 'system'}
          title={t('tts_systemVoice')}
          subtitle={t('tts_systemVoiceHint')}
          onClick={() => onChange({ ttsEngine: 'system' })}
        />
        {CLOUD_TTS_PROVIDERS.map((spec) => (
          <EngineCard
            key={spec.id}
            active={isActive && spec.id === selected.id}
            title={spec.name}
            subtitle={spec.summary}
            onClick={() => void enable(spec)}
          />
        ))}
      </div>

      {settings.ttsEngine === 'cloud' && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          <b>{t('tts_privacyNotice')}</b>
          {t('tts_privacyBody', [selected.name])}
        </p>
      )}

      {settings.ttsEngine === 'cloud' && !granted[selected.id] && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
          {t('tts_grantIntro')} <Code>{selected.origins.join(', ')}</Code>
          {t('tts_grantReason', [selected.name])}
          <button
            type="button"
            disabled={busy}
            onClick={() => void enable(selected)}
            className="ml-2 cursor-pointer rounded bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950 disabled:opacity-50"
          >
            {t('tts_grantAccess')}
          </button>
        </p>
      )}

      {/* ---- 凭据：完全按 spec 渲染 ---- */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <p className="text-xs font-medium text-slate-300">
          {t('tts_credentialsTitle', [selected.name])}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {t('tts_storageBefore')}
          <Code>storage.local</Code>
          {t('tts_storageAfter')}
        </p>

        <div className="mt-2 space-y-2">
          {selected.credentials.map((field) => (
            <label key={field.key} className="block">
              <span className="flex items-center gap-2 text-[11px] text-slate-400">
                {field.label}
                {field.help && <span className="text-slate-600">· {field.help}</span>}
              </span>
              <input
                type={field.secret ? 'password' : 'text'}
                value={draft[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
              />
              {saved[field.key] && field.secret && (
                <span className="mt-0.5 block text-[10px] text-slate-600">
                  {t('tts_currentValue', [maskSecret(saved[field.key]!)])}
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveCredentials()}
            className="cursor-pointer rounded-lg bg-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/20 disabled:opacity-50"
          >
            {t('tts_save')}
          </button>
          <button
            type="button"
            disabled={busy || !configured}
            onClick={() => void test()}
            className="cursor-pointer rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            {busy ? t('tts_previewing') : t('tts_preview')}
          </button>
          {isActive && (
            <button
              type="button"
              onClick={() => onChange({ ttsEngine: 'system' })}
              className="cursor-pointer rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/10"
            >
              {t('tts_switchToSystem')}
            </button>
          )}
          <span className="text-[11px] text-slate-500">
            {t('tts_maxChars', [String(selected.maxChars)])}
          </span>
        </div>
      </div>

      {/* ---- 音色：只展示该服务商声明支持的语言 ---- */}
      {settings.ttsEngine === 'cloud' && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-medium text-slate-300">{t('tts_voicesTitle')}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {t('tts_voicesHint')}
          </p>

          <div className="mt-2 space-y-2">
            {selected.pickerLangs.map(({ code, label }) => {
              const usable = selected.voices.filter((v) => !v.lang || v.lang === code);
              const fallback = resolveVoice(selected, code, {});
              return (
                <label key={code} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="w-10 shrink-0">{label}</span>
                  <select
                    value={settings.cloudVoices[selected.id]?.[code] ?? ''}
                    onChange={(e) =>
                      onChange({
                        cloudVoices: {
                          ...settings.cloudVoices,
                          [selected.id]: {
                            ...(settings.cloudVoices[selected.id] ?? {}),
                            [code]: e.target.value,
                          },
                        },
                      })
                    }
                    className="min-w-0 flex-1 cursor-pointer rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="">
                      {t('tts_defaultVoice')}
                      {fallback ? t('tts_defaultVoiceName', [voiceName(selected, fallback)]) : ''}
                    </option>
                    {usable.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                        {voice.note ? ` · ${voice.note}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {status && <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">{status}</p>}
    </div>
  );
}

function EngineCard({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'cursor-pointer rounded-xl border px-3 py-2 text-left transition-colors',
        active
          ? 'border-emerald-400/60 bg-emerald-400/10'
          : 'border-slate-800 bg-slate-950/40 hover:border-slate-700',
      ].join(' ')}
    >
      <span
        className={`block text-xs font-semibold ${active ? 'text-emerald-300' : 'text-slate-300'}`}
      >
        {active ? '● ' : '○ '}
        {title}
      </span>
      <span className="mt-0.5 block text-[11px] text-slate-500">{subtitle}</span>
    </button>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-950 px-1 py-0.5 font-mono text-[11px] text-slate-300">
      {children}
    </code>
  );
}

function voiceName(spec: CloudTtsSpec, id: string): string {
  return spec.voices.find((v) => v.id === id)?.name ?? id;
}
