import { useCallback, useEffect, useState } from 'react';
import { browser } from '#imports';
import { probeBuiltInAi } from '@/diagnostics/probe';
import type { AiProbeReport, TabProbeResult } from '@/types';

/**
 * 能力检测页。
 *
 * 存在的唯一理由：Chrome 内置 AI（Translator / LanguageDetector）挂在 `window` 上，
 * 而扩展的内容脚本跑在 isolated world —— 那是另一个 JS realm，API 是否可见没有保证。
 * 翻译功能放在哪一层，完全由这个页面的结论决定。
 *
 * 三种上下文都测：
 *   1. 扩展页面（本页）      —— 能不能在设置页里预下载语言包
 *   2. isolated world        —— 我们的内容脚本真正运行的地方（**最关键**）
 *   3. MAIN world            —— 万一 (2) 不行，这是退路
 */

const CONTEXT_LABEL: Record<AiProbeReport['context'], string> = {
  'extension-page': '扩展页面（本页）',
  'isolated-world': '内容脚本 isolated world',
  'main-world': '页面 MAIN world',
};

export default function App() {
  const [selfReport, setSelfReport] = useState<AiProbeReport | null>(null);
  const [tabs, setTabs] = useState<TabProbeResult[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void probeBuiltInAi('extension-page').then(setSelfReport);
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

  const isolated = tabs?.[0]?.isolated ?? null;
  const mainWorld = tabs?.[0]?.mainWorld ?? null;

  const copyReport = useCallback(async () => {
    const payload = {
      extensionPage: selfReport,
      tabs: tabs ?? '未检测',
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [selfReport, tabs]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-bold">ReadX 能力检测</h1>
      <p className="mt-1 text-sm text-slate-400">
        用来确认 Chrome 内置的设备端翻译 API（Translator）在这三种 JS 上下文里到底能不能用。
        结论直接决定翻译功能放在哪一层。
      </p>

      <Verdict selfReport={selfReport} isolated={isolated} tabs={tabs} />

      <Section title="1. 扩展页面（本页）" hint="自动检测，用于判断能否在设置页里预下载语言包">
        {selfReport ? <ReportTable reports={[selfReport]} /> : <Loading />}
      </Section>

      <Section
        title="2. 页面上下文（isolated world / MAIN world）"
        hint="需要先在浏览器里打开 x.com 或 npm run mock 的页面，否则收不到报告"
      >
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void probeTabs()}
            disabled={probing}
            className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {probing ? '检测中…' : '检测已打开的页面'}
          </button>
          <button
            type="button"
            onClick={() => void copyReport()}
            className="cursor-pointer rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/20"
          >
            {copied ? '已复制 ✓' : '复制完整报告'}
          </button>
        </div>

        {tabs === null ? (
          <p className="text-sm text-slate-500">还没检测。点上面的按钮。</p>
        ) : tabs.length === 0 ? (
          <p className="text-sm text-amber-400">
            没有找到装了内容脚本的标签页。请先打开 <code className="text-slate-300">x.com</code>{' '}
            或者运行 <code className="text-slate-300">npm run mock</code> 后打开{' '}
            <code className="text-slate-300">http://localhost:5174</code>，再回来点检测。
          </p>
        ) : (
          tabs.map((tab) => (
            <div key={tab.tabId} className="mb-4 last:mb-0">
              <p className="mb-2 text-xs text-slate-500">
                标签页 #{tab.tabId} · {tab.isolated?.url ?? '(未知地址)'}
              </p>
              <ReportTable
                reports={[tab.isolated, tab.mainWorld].filter(Boolean) as AiProbeReport[]}
              />
            </div>
          ))
        )}
      </Section>

      <Section title="3. 怎么解读" hint="">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-400">
          <li>
            <b className="text-slate-200">isolated world 里是 function</b> → 最理想。翻译直接写在
            content script 里，不需要任何桥接。
          </li>
          <li>
            <b className="text-slate-200">isolated world 是 undefined，但 MAIN world 是 function</b>{' '}
            → 退路明确：把翻译放进 MAIN world 脚本，用 DOM 事件桥回内容脚本
            （`mainWorldProbe.content.ts` 已经是这个桥的雏形）。代价是 MAIN world 拿不到{' '}
            <code className="text-slate-300">chrome.*</code>。
          </li>
          <li>
            <b className="text-slate-200">两边都是 undefined</b> → 本机 Chrome 不暴露这个 API（版本
            &lt; 138 或非桌面版）。只能走云翻译，或降级为读原文。
          </li>
          <li>
            <code className="text-slate-300">availability</code> 返回{' '}
            <code className="text-slate-300">unavailable</code> → API 在但硬件不达标（官方门槛：
            16GB 内存 / 22GB 空闲磁盘 / 4 核以上）。可以到{' '}
            <code className="text-slate-300">chrome://on-device-internals</code> 看详情。
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Verdict({
  selfReport,
  isolated,
  tabs,
}: {
  selfReport: AiProbeReport | null;
  isolated: AiProbeReport | null;
  tabs: TabProbeResult[] | null;
}) {
  if (tabs === null) {
    return (
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        点下面的「检测已打开的页面」，我会同时看扩展页面和页面里的两个 JS realm，然后给结论。
      </div>
    );
  }
  if (tabs.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        <b>缺页面上下文。</b> 请先打开 x.com 或本地 mock 页面，再回来点检测 —— 只有页面上才有内容脚本。
      </div>
    );
  }

  const isolatedOk = isolated?.globals.Translator === 'function';
  const mainOk = tabs[0]?.mainWorld?.globals.Translator === 'function';
  const isolatedAvail = isolated?.translatorAvailability;
  const usable = ['available', 'downloadable', 'downloading'];

  if (isolatedOk && usable.includes(isolatedAvail ?? '')) {
    return (
      <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
        <b>结论：可以，而且是最省事的架构。</b> 内容脚本的 isolated world 里{' '}
        <code>Translator</code> 可用，状态 <code>{isolatedAvail}</code>。
        翻译直接写在 content script 里即可，不需要 MAIN world 桥接。
        {isolatedAvail !== 'available' && '（首次使用需要用户手势触发语言包下载）'}
      </div>
    );
  }

  if (!isolatedOk && mainOk) {
    return (
      <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        <b>结论：API 存在，但内容脚本看不到。</b> MAIN world 里有、isolated world 里没有 ——
        这是个明确的架构信号：翻译要放进 MAIN world 脚本，再用 DOM 事件桥回内容脚本。
        代价是那个脚本拿不到任何 <code>chrome.*</code> API。
      </div>
    );
  }

  if (isolatedOk && !usable.includes(isolatedAvail ?? '')) {
    return (
      <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        <b>结论：API 在，但本机不可用。</b> 状态是 <code>{isolatedAvail}</code>。
        大概率是硬件没到官方门槛。需要接云翻译，或降级为读原文。
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
      <b>结论：这个浏览器不暴露内置 Translator API。</b>
      {selfReport?.chromeVersion && (
        <>
          {' '}
          当前 Chrome 版本 <code>{selfReport.chromeVersion}</code>
          {Number(selfReport.chromeVersion) < 138 && '（内置 AI 需要 138+ 桌面版）'}。
        </>
      )}{' '}
      ReadX 只能走云翻译（自备 Key），或者降级为按原文朗读。
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

function Loading() {
  return <p className="text-sm text-slate-500">检测中…</p>;
}

function ReportTable({ reports }: { reports: AiProbeReport[] }) {
  const rows: Array<[string, (r: AiProbeReport) => string]> = [
    ['Translator', (r) => r.globals.Translator ?? '?'],
    ['LanguageDetector', (r) => r.globals.LanguageDetector ?? '?'],
    ['LanguageModel', (r) => r.globals.LanguageModel ?? '?'],
    ['availability (en→zh)', (r) => r.translatorAvailability],
    ['LanguageDetector availability', (r) => r.languageDetectorAvailability],
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
  if (value === 'unavailable') return 'text-amber-400';
  if (['available', 'downloadable', 'downloading'].includes(value)) return 'text-emerald-400';
  if (value === 'function' || value === 'object') return 'text-emerald-400';
  return 'text-slate-300';
}
