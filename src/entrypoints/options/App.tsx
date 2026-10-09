import { useCallback, useEffect, useState } from 'react';
import { browser } from '#imports';
import { probeBuiltInAi } from '@/diagnostics/probe';
import { t } from '@/i18n';
import { getSettings, patchSettings, type ReadXSettings } from '@/settings';
import { TtsSettingsPanel } from '@/tts/TtsSettingsPanel';
import type { AiProbeReport, ProbeStatus, TabProbeResult } from '@/types';

/**
 * 使用说明 + 翻译能力检测。
 *
 * 为什么两件事放在一起：这是个扩展，用户很少主动打开一个"设置页"，
 * 通常是因为**遇到了问题**（比如"我选了中文怎么还在读英文"）才会来。
 * 所以第一屏应该先讲怎么用，往下才是排查工具。
 */

const CONTEXT_LABEL: Record<AiProbeReport['context'], string> = {
  'extension-page': t('options_contextExtensionPage'),
  'isolated-world': t('options_contextContentScript'),
};

export default function App() {
  const [selfReport, setSelfReport] = useState<AiProbeReport | null>(null);
  const [tabs, setTabs] = useState<TabProbeResult[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<ReadXSettings | null>(null);

  useEffect(() => {
    void probeBuiltInAi('extension-page').then(setSelfReport);
    void getSettings().then(setSettings);
  }, []);

  const update = useCallback((patch: Partial<ReadXSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    void patchSettings(patch);
  }, []);

  const probeTabs = useCallback(async () => {
    setProbing(true);
    setCopied(false);
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'readx:probe-all-tabs',
      })) as TabProbeResult[] | undefined;
      setTabs(result ?? []);
    } catch {
      setTabs([]);
    } finally {
      setProbing(false);
    }
  }, []);

  const copyReport = useCallback(async () => {
    await navigator.clipboard.writeText(
      JSON.stringify({ extensionPage: selfReport, tabs: tabs ?? t('options_notChecked') }, null, 2),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [selfReport, tabs]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-bold">ReadX</h1>
      <p className="mt-1 text-sm text-slate-400">
        {t('options_tagline')}
      </p>

      <Section title={t('options_howToTitle')} hint="">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>
            {t('options_step1Open')} <Code>x.com</Code>
            {t('options_step1Rest')}
          </li>
          <li>
            {t('options_step2Tap')} <Code>▶</Code> {t('options_step2Start')} <Code>Alt+Shift+P</Code>
            {t('options_step2Rest')}
          </li>
          <li>
            {t('options_step3Intro')}
            <b className="text-slate-200">{t('options_step3LangLabel')}</b>
            {t('options_step3Middle')}{' '}
            <b className="text-slate-200">{t('options_step3Bold2')}</b>
            {t('options_step3Outro')}
          </li>
          <li>
            {t('options_step4')}
          </li>
          <li>
            {t('options_step5')}
          </li>
        </ol>
      </Section>

      <Section title={t('options_voiceTitle')} hint={t('options_voiceHint')}>
        {settings ? (
          <TtsSettingsPanel settings={settings} onChange={update} />
        ) : (
          <p className="text-sm text-slate-500">{t('options_loading')}</p>
        )}
      </Section>

      <Section title={t('options_probeTitle')} hint={t('options_probeHint')}>
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void probeTabs()}
            disabled={probing}
            className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {probing ? t('options_probing') : t('options_probe')}
          </button>
          <button
            type="button"
            onClick={() => void copyReport()}
            className="cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/20"
          >
            {copied ? t('options_copied') : t('options_copyReport')}
          </button>
        </div>

        {tabs === null ? (
          <p className="text-sm text-slate-500">
            {t('options_probeIdleHint')}
          </p>
        ) : tabs.length === 0 ? (
          <p className="text-sm text-amber-400">
            {t('options_noTabsBefore')} <Code>x.com</Code> {t('options_noTabsAfter')}
          </p>
        ) : (
          tabs.map((tab) => (
            <div key={tab.tabId} className="mb-4 last:mb-0">
              <p className="mb-2 text-xs text-slate-500">
                {t('options_tabLabel', [String(tab.tabId)])} ·{' '}
                {tab.isolated?.url ?? t('options_unknownUrl')}
              </p>
              <ReportTable
                reports={[selfReport, tab.isolated].filter(Boolean) as AiProbeReport[]}
              />
            </div>
          ))
        )}

        {tabs !== null && tabs.length > 0 && <Verdict isolated={tabs[0]?.isolated ?? null} />}
      </Section>

      <Section title={t('options_verdictTitle')} hint="">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-400">
          <li>
            <Code>Translator</Code> {t('options_verdict1Is')} <Code>function</Code>{' '}
            {t('options_verdict1Then')}
          </li>
          <li>
            <Code>availability</Code> {t('options_verdict2Is')} <Code>available</Code>{' '}
            {t('options_verdict2Ready')} {t('options_verdict2Is')} <Code>downloadable</Code>{' '}
            {t('options_verdict2Download')}
          </li>
          <li>
            <Code>unavailable</Code> {t('options_verdict3Or')} <Code>Translator</Code>{' '}
            {t('options_verdict3Is')} <Code>undefined</Code> {t('options_verdict3Then')}
            <b className="text-slate-200">{t('options_verdict3Bold')}</b>
            {t('options_verdict3End')}
          </li>
        </ul>
      </Section>

      <Section title={t('options_stuckTitle')} hint="">
        <ol className="list-decimal space-y-2.5 pl-5 text-sm text-slate-400">
          <li>
            {t('options_stuckStep1Open')} <ChromeUrl value="chrome://on-device-translation-internals" />{' '}
            {t('options_stuckStep1After')}
            <b className="text-slate-200">{t('options_stuckStep1Bold')}</b>
            <br />
            <span className="text-slate-500">
              {t('options_stuckStep1Note')}
            </span>
          </li>
          <li>
            {t('options_stuckStep2Open')} <ChromeUrl value="chrome://components" />
            {t('options_stuckStep2After')} <Code>0.0.0.0</Code> {t('options_stuckStep2End')}
          </li>
          <li>
            {t('options_stuckStep3')}
          </li>
        </ol>
      </Section>

      <p className="mt-10 text-xs text-slate-600">
        {t('options_footer')}
      </p>
    </div>
  );
}

function Verdict({ isolated }: { isolated: AiProbeReport | null }) {
  if (!isolated) return null;

  const supported = isolated.globals.Translator === 'function';
  const usable = ['available', 'downloadable', 'downloading'].includes(
    isolated.translatorAvailability,
  );

  if (supported && usable) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
        <b>{t('options_verdictUsableTitle')}</b>
        {isolated.translatorAvailability === 'available'
          ? t('options_verdictReady')
          : t('options_verdictDownloadOnFirstUse')}
      </div>
    );
  }

  if (supported) {
    return (
      <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        <b>{t('options_verdictApiUnavailable', [isolated.translatorAvailability])}</b>{' '}
        {t('options_verdictApiBody')}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-500/30 bg-slate-500/10 p-4 text-sm text-slate-300">
      <b>{t('options_verdictNoApiTitle')}</b>{' '}
      {isolated.chromeVersion && Number(isolated.chromeVersion) < 138 && (
        <>{t('options_verdictChromeVersion', [isolated.chromeVersion])}</>
      )}{' '}
      {t('options_verdictNoApiBody')}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
      {hint && <p className="mb-2 mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-slate-300">
      {children}
    </code>
  );
}

/**
 * chrome:// 链接不能从网页里直接点开（Chrome 会拦），所以做成复制按钮 ——
 * 复制完粘到地址栏是最省事也最可靠的做法。
 */
function ChromeUrl({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="whitespace-nowrap">
      <code className="text-sky-300">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="ml-1 cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
      >
        {copied ? t('options_copiedLink') : t('options_copyLink')}
      </button>
    </span>
  );
}

function ReportTable({ reports }: { reports: AiProbeReport[] }) {
  // 第三列是可选的"状态着色"，只有需要区分"缺失/抛错"的行才用它
  const rows: Array<[string, (r: AiProbeReport) => string, (r: AiProbeReport) => string]> = [
    [t('options_reportChromeVersion'), (r) => r.chromeVersion, (r) => toneOf(r.chromeVersion)],
    ['Translator', (r) => r.globals.Translator ?? '?', (r) => toneOf(r.globals.Translator ?? '?')],
    [
      'availability',
      (r) => r.translatorAvailability,
      (r) => statusTone(r.translatorStatus),
    ],
    [
      'LanguageDetector',
      (r) => r.globals.LanguageDetector ?? '?',
      (r) => toneOf(r.globals.LanguageDetector ?? '?'),
    ],
    [
      t('options_reportSecureContext'),
      (r) => String(r.secureContext),
      (r) => toneOf(String(r.secureContext)),
    ],
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="w-1/3 pb-2 font-medium">{t('options_reportItem')}</th>
            {reports.map((r) => (
              <th key={r.context} className="pb-2 font-medium">
                {CONTEXT_LABEL[r.context]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, read, tone]) => (
            <tr key={label} className="border-t border-slate-800">
              <td className="py-1.5 pr-3 text-slate-400">{label}</td>
              {reports.map((r) => {
                const value = read(r);
                return (
                  <td key={r.context} className={`py-1.5 pr-3 font-mono ${tone(r)}`}>
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 诊断单元格的颜色。
 *
 * ⚠️ 这里**只处理语言无关的原始值**（'function' / 'true' / 'available' …）。
 * 那些"没检测到 / API 不存在 / 抛错了"的情况一律走 `statusTone()` ——
 * 曾经这里是拿中文显示文案做字面量比较的，改成英文界面后判定会静默失效。
 */
function toneOf(value: string): string {
  if (value === 'undefined' || value === 'null') return 'text-rose-400';
  if (value === 'unavailable' || value === 'false') return 'text-amber-400';
  if (['available', 'downloadable', 'downloading', 'function', 'object', 'true'].includes(value)) {
    return 'text-emerald-400';
  }
  return 'text-slate-300';
}

/** 探测状态 → 颜色。用结构化的 status，不比对显示文案。 */
function statusTone(status: ProbeStatus): string {
  if (status === 'missing' || status === 'threw') return 'text-rose-400';
  if (status === 'unavailable') return 'text-amber-400';
  return 'text-emerald-400';
}
