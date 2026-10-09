import { useCallback, useEffect, useState } from 'react';
import { browser } from '#imports';
import { probeBuiltInAi } from '@/diagnostics/probe';
import { getSettings, patchSettings, type ReadXSettings } from '@/settings';
import { TtsSettingsPanel } from '@/tts/TtsSettingsPanel';
import type { AiProbeReport, TabProbeResult } from '@/types';

/**
 * 使用说明 + 翻译能力检测。
 *
 * 为什么两件事放在一起：这是个扩展，用户很少主动打开一个"设置页"，
 * 通常是因为**遇到了问题**（比如"我选了中文怎么还在读英文"）才会来。
 * 所以第一屏应该先讲怎么用，往下才是排查工具。
 */

const CONTEXT_LABEL: Record<AiProbeReport['context'], string> = {
  'extension-page': '扩展页面（本页）',
  'isolated-world': '内容脚本',
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
      JSON.stringify({ extensionPage: selfReport, tabs: tabs ?? '未检测' }, null, 2),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [selfReport, tabs]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-bold">ReadX</h1>
      <p className="mt-1 text-sm text-slate-400">
        用耳朵刷 X：自动滚动定位到下一条帖子，按它的语言朗读，需要时先翻译。
      </p>

      <Section title="怎么用" hint="">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>
            打开 <Code>x.com</Code>，页面右下角会出现一条控制条。
          </li>
          <li>
            点 <Code>▶</Code> 开始朗读（快捷键 <Code>Alt+Shift+P</Code>）。
            它会自己滚动到下一条帖子 —— 你一旦自己滚动，它就让位并跟着你的位置继续。
          </li>
          <li>
            想听中文？在控制条或插件弹窗里把「<b className="text-slate-200">朗读语言</b>」设成中文。
            外语帖子会先翻译再朗读；<b className="text-slate-200">帖子本来就是中文时直接读原文</b>，不做无谓翻译。
          </li>
          <li>
            首次选择某个语言时，需要下载一次语言包（十几秒，只需一次）。
            控制条上会出现下载按钮和进度条 —— Chrome 要求这一步必须由你亲手点击触发。
          </li>
          <li>
            没有声音？先确认系统装了对应语种的语音包
            （macOS：系统设置 → 辅助功能 → 朗读内容 → 系统声音）。
          </li>
        </ol>
      </Section>

      <Section
        title="语音"
        hint="系统语音零配置但偏机械；豆包语音自然得多，需要自备 API Key、并且只在你主动启用时才申请域名权限。"
      >
        {settings ? (
          <TtsSettingsPanel settings={settings} onChange={update} />
        ) : (
          <p className="text-sm text-slate-500">加载中…</p>
        )}
      </Section>

      <Section
        title="翻译能力检测"
        hint="翻译走的是 Chrome 内置的设备端模型 —— 免费、离线、内容不出本机。这里可以确认它在你机器上能不能用。"
      >
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void probeTabs()}
            disabled={probing}
            className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {probing ? '检测中…' : '检测'}
          </button>
          <button
            type="button"
            onClick={() => void copyReport()}
            className="cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/20"
          >
            {copied ? '已复制 ✓' : '复制报告'}
          </button>
        </div>

        {tabs === null ? (
          <p className="text-sm text-slate-500">
            点「检测」会同时检查扩展页面和已打开的页面。
          </p>
        ) : tabs.length === 0 ? (
          <p className="text-sm text-amber-400">
            没找到装了内容脚本的标签页。请先打开 <Code>x.com</Code> 再回来点检测。
          </p>
        ) : (
          tabs.map((tab) => (
            <div key={tab.tabId} className="mb-4 last:mb-0">
              <p className="mb-2 text-xs text-slate-500">
                标签页 #{tab.tabId} · {tab.isolated?.url ?? '(未知地址)'}
              </p>
              <ReportTable
                reports={[selfReport, tab.isolated].filter(Boolean) as AiProbeReport[]}
              />
            </div>
          ))
        )}

        {tabs !== null && tabs.length > 0 && <Verdict isolated={tabs[0]?.isolated ?? null} />}
      </Section>

      <Section title="结果怎么解读" hint="">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-400">
          <li>
            <Code>Translator</Code> 是 <Code>function</Code> → 你的浏览器支持设备端翻译。
          </li>
          <li>
            <Code>availability</Code> 是 <Code>available</Code> → 语言包已就绪；
            是 <Code>downloadable</Code> → 还没下载，在页面上点一次「下载」即可。
          </li>
          <li>
            是 <Code>unavailable</Code> 或 <Code>Translator</Code> 为 <Code>undefined</Code> →
            本机用不了设备端翻译，ReadX 会<b className="text-slate-200">自动降级为只朗读不翻译</b>。
          </li>
        </ul>
      </Section>

      <Section title="如果「下载语言包」一直卡住" hint="">
        <ol className="list-decimal space-y-2.5 pl-5 text-sm text-slate-400">
          <li>
            新标签页打开 <ChromeUrl value="chrome://on-device-translation-internals" />
            ，这里会列出所有语言包、支持手动下载，并显示下载失败的原因。
            翻译需要源语言和目标语言<b className="text-slate-200">两个包都装</b>。
            <br />
            <span className="text-slate-500">
              如果这个页面打不开或没有内容，说明这台机器/这个版本根本不支持内置翻译。
            </span>
          </li>
          <li>
            打开 <ChromeUrl value="chrome://components" />
            ，找与 Translation / Optimization Guide 相关的条目点「检查是否有更新」。
            版本停在 <Code>0.0.0.0</Code> 就是组件压根没下发。
          </li>
          <li>
            确认 Chrome 是 138+ 的桌面版。低于这个版本没有内置翻译，
            ReadX 会退化为只朗读原文。
          </li>
        </ol>
      </Section>

      <p className="mt-10 text-xs text-slate-600">
        ReadX 不是 X Corp 的官方产品，与 X Corp 无关联。朗读与翻译都在你的设备上完成，
        不会上传任何内容。
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
        <b>可以用设备端翻译。</b>
        {isolated.translatorAvailability === 'available'
          ? '语言包已就绪。'
          : '首次使用时在页面上点一下「下载」即可（只需一次）。'}
      </div>
    );
  }

  if (supported) {
    return (
      <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        <b>API 在，但本机当前不可用（{isolated.translatorAvailability}）。</b>
        大概率是硬件没达到官方门槛（16GB 内存 / 22GB 空闲磁盘 / 4 核以上）。
        ReadX 会自动降级为只朗读原文。
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-500/30 bg-slate-500/10 p-4 text-sm text-slate-300">
      <b>这个浏览器不提供设备端翻译。</b>
      {isolated.chromeVersion && Number(isolated.chromeVersion) < 138 && (
        <> 当前 Chrome {isolated.chromeVersion}，内置翻译需要 138+ 桌面版。</>
      )}{' '}
      朗读功能不受影响，只是不会自动翻译。
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
        {copied ? '已复制' : '复制'}
      </button>
    </span>
  );
}

function ReportTable({ reports }: { reports: AiProbeReport[] }) {
  const rows: Array<[string, (r: AiProbeReport) => string]> = [
    ['Chrome 版本', (r) => r.chromeVersion],
    ['Translator', (r) => r.globals.Translator ?? '?'],
    ['availability', (r) => r.translatorAvailability],
    ['LanguageDetector', (r) => r.globals.LanguageDetector ?? '?'],
    ['安全上下文', (r) => String(r.secureContext)],
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="w-1/3 pb-2 font-medium">项目</th>
            {reports.map((r) => (
              <th key={r.context} className="pb-2 font-medium">
                {CONTEXT_LABEL[r.context]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, read]) => (
            <tr key={label} className="border-t border-slate-800">
              <td className="py-1.5 pr-3 text-slate-400">{label}</td>
              {reports.map((r) => {
                const value = read(r);
                return (
                  <td key={r.context} className={`py-1.5 pr-3 font-mono ${toneOf(value)}`}>
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

function toneOf(value: string): string {
  if (value === 'undefined' || value.startsWith('抛错') || value === 'API 不存在') {
    return 'text-rose-400';
  }
  if (value === 'unavailable' || value === 'false') return 'text-amber-400';
  if (['available', 'downloadable', 'downloading', 'function', 'object', 'true'].includes(value)) {
    return 'text-emerald-400';
  }
  return 'text-slate-300';
}
