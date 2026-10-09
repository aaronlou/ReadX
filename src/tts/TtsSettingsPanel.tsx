import { useCallback, useEffect, useState } from 'react';
import { browser } from '#imports';
import { DOUBAO_ORIGIN } from '@/matches';
import { doubaoApiKeyItem, maskApiKey, setDoubaoApiKey } from '@/secrets';
import type { ReadXSettings } from '@/settings';
import type { DoubaoSynthesizeResponse } from '@/types';
import { base64ToBlob } from '@/tts/doubaoTts';
import { DEFAULT_DOUBAO_MODEL, DOUBAO_VOICES, defaultVoiceFor } from '@/tts/doubaoVoices';

/** 试听用的样本，包含中英混排，容易听出音色好坏 */
const SAMPLE_TEXT = '这条帖子在讲一个挺有意思的观点，读起来应该足够自然。';

const PICKER_LANGS: Array<{ code: string; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: '英文' },
];

/**
 * 语音引擎设置面板。被选项页和 popup 共用。
 *
 * 这里有个必须注意的顺序问题：**Chrome 要求域名权限的申请必须在用户手势里**，
 * 而且申请权限的 UI 只能从扩展页面发起（内容脚本里不行）。所以「启用豆包」
 * 这个按钮做成了「申请权限 + 写设置」的原子动作 —— 不能先写设置再补权限，
 * 那样用户会在朗读时才发现没有权限。
 */
export function TtsSettingsPanel({
  settings,
  onChange,
  compact = false,
}: {
  settings: ReadXSettings;
  onChange: (patch: Partial<ReadXSettings>) => void;
  compact?: boolean;
}) {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void doubaoApiKeyItem.getValue().then(setSavedKey);
    void browser.permissions.contains({ origins: [DOUBAO_ORIGIN] }).then(setGranted);
  }, []);

  const saveKey = useCallback(async () => {
    await setDoubaoApiKey(keyDraft);
    setSavedKey(keyDraft.trim());
    setKeyDraft('');
    setStatus('API Key 已保存（存在本机，不会同步到云端）');
  }, [keyDraft]);

  /** 申请域名权限并切到豆包引擎 —— 必须在点击事件里调用 */
  const enableDoubao = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const ok = await browser.permissions.request({ origins: [DOUBAO_ORIGIN] });
      setGranted(ok);
      if (!ok) {
        setStatus('没有授权访问 openspeech.bytedance.com，豆包语音无法工作');
        return;
      }
      onChange({ ttsEngine: 'doubao' });
      setStatus('已启用豆包语音');
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  const disableDoubao = useCallback(() => {
    onChange({ ttsEngine: 'system' });
    setStatus('已切回系统语音（域名授权仍保留，随时可以再启用）');
  }, [onChange]);

  const test = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const lang = settings.readingLang === 'auto' ? 'zh' : settings.readingLang;
      const voice =
        settings.doubaoVoices[lang] ?? defaultVoiceFor(lang) ?? DOUBAO_VOICES[0]!.id;

      const response = (await browser.runtime.sendMessage({
        type: 'readx:doubao-synthesize',
        text: SAMPLE_TEXT,
        voice,
        model: settings.doubaoModel,
        speechRate: 0,
      })) as DoubaoSynthesizeResponse | undefined;

      if (!response?.ok || !response.audio) {
        setStatus(
          `试听失败：${response?.error ?? '没有返回音频'}${response?.hint ? `（${response.hint}）` : ''}`,
        );
        return;
      }

      const url = URL.createObjectURL(base64ToBlob(response.audio, response.mimeType ?? 'audio/mpeg'));
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setStatus('音频播放失败');
      };
      await audio.play();
      setStatus('✓ 试听成功');
    } catch (error) {
      setStatus(`试听失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [settings.doubaoModel, settings.doubaoVoices, settings.readingLang]);

  const configured = Boolean(savedKey);

  return (
    <div className="space-y-4">
      {/* ---- 引擎选择 ---- */}
      <div className="flex flex-wrap gap-2">
        <EngineCard
          active={settings.ttsEngine === 'system'}
          title="系统语音"
          subtitle="零配置、离线，音色偏机械"
          onClick={() => onChange({ ttsEngine: 'system' })}
        />
        <EngineCard
          active={settings.ttsEngine === 'doubao'}
          title="豆包语音"
          subtitle="音色自然，需要 API Key"
          onClick={() => void enableDoubao()}
        />
      </div>

      {settings.ttsEngine === 'doubao' && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          <b>注意</b>：启用后，被朗读的文本会发送到火山引擎（豆包）做语音合成 ——
          这是唯一会离开你设备的内容。翻译仍然在本地完成。
          不想发送就保持「系统语音」，那样完全离线。
        </p>
      )}

      {settings.ttsEngine === 'doubao' && !granted && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
          还需要授权访问 <Code>openspeech.bytedance.com</Code>，豆包语音才能发请求。
          <button
            type="button"
            disabled={busy}
            onClick={() => void enableDoubao()}
            className="ml-2 cursor-pointer rounded bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950 disabled:opacity-50"
          >
            去授权
          </button>
        </p>
      )}

      {/* ---- API Key ---- */}
      {!compact && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-medium text-slate-300">豆包 API Key</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            在火山引擎控制台「语音技术 → 应用管理」获取。**只保存在本机**
            （用 <Code>storage.local</Code> 而不是会同步到云端的 sync）。
          </p>

          {configured && (
            <p className="mt-2 text-[11px] text-slate-400">
              当前：<Code>{maskApiKey(savedKey ?? '')}</Code>
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={keyDraft}
              placeholder={configured ? '粘贴新的 Key 以替换' : '粘贴 API Key'}
              onChange={(e) => setKeyDraft(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
            />
            <button
              type="button"
              disabled={!keyDraft.trim()}
              onClick={() => void saveKey()}
              className="shrink-0 cursor-pointer rounded-lg bg-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/20 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* ---- 音色 ---- */}
      {settings.ttsEngine === 'doubao' && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-medium text-slate-300">音色</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            按语言分别选择。用中文音色读英文会得到很怪的发音，所以每种语言单独设。
          </p>

          <div className="mt-2 space-y-2">
            {PICKER_LANGS.map(({ code, label }) => (
              <label key={code} className="flex items-center gap-2 text-xs text-slate-400">
                <span className="w-10 shrink-0">{label}</span>
                <select
                  value={settings.doubaoVoices[code] ?? ''}
                  onChange={(e) =>
                    onChange({
                      doubaoVoices: { ...settings.doubaoVoices, [code]: e.target.value },
                    })
                  }
                  className="min-w-0 flex-1 cursor-pointer rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="">
                    默认（{voiceName(defaultVoiceFor(code) ?? '')}）
                  </option>
                  {DOUBAO_VOICES.filter((v) => v.lang === code).map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} · {voice.scene}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !configured}
              onClick={() => void test()}
              className="cursor-pointer rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
            >
              {busy ? '试听中…' : '试听'}
            </button>
            {settings.ttsEngine === 'doubao' && (
              <button
                type="button"
                onClick={disableDoubao}
                className="cursor-pointer rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/10"
              >
                切回系统语音
              </button>
            )}
            <span className="text-[11px] text-slate-500">模型 {DEFAULT_DOUBAO_MODEL}</span>
          </div>
        </div>
      )}

      {status && (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">{status}</p>
      )}
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
        'flex-1 cursor-pointer rounded-xl border px-3 py-2 text-left transition-colors',
        active
          ? 'border-emerald-400/60 bg-emerald-400/10'
          : 'border-slate-800 bg-slate-950/40 hover:border-slate-700',
      ].join(' ')}
    >
      <span className={`block text-xs font-semibold ${active ? 'text-emerald-300' : 'text-slate-300'}`}>
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

function voiceName(id: string): string {
  return DOUBAO_VOICES.find((v) => v.id === id)?.name ?? id;
}
