import { useEffect, useRef, useState } from 'react';
import type { Reader } from '@/core/reader';
import { patchSettings, watchSettings, type ReadXSettings } from '@/settings';
import { LANGUAGE_CHOICES, languageLabel, toApiCode } from '@/translate/languages';
import type { ReaderSnapshot } from '@/types';

/**
 * 用户要求翻译成某语言，但这条帖子最终不是那个语言 ——
 * 说明走了降级读原文，面板上要给个显眼的提示。
 */
function wantsTranslation(readingLang: string, spokenLang: string): boolean {
  if (!readingLang || readingLang === 'auto') return false;
  if (!spokenLang) return false;
  return toApiCode(spokenLang) !== toApiCode(readingLang);
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const STATE_LABEL: Record<ReaderSnapshot['state'], string> = {
  idle: '待机',
  loading: '定位中',
  speaking: '朗读中',
  paused: '已暂停',
  error: '出错了',
  'need-language-pack': '等待语言包',
};

const STATE_DOT: Record<ReaderSnapshot['state'], string> = {
  idle: 'bg-slate-400',
  loading: 'bg-amber-400 animate-pulse',
  speaking: 'bg-emerald-400 animate-pulse',
  paused: 'bg-sky-400',
  error: 'bg-rose-500',
  'need-language-pack': 'bg-amber-400 animate-pulse',
};

export function Overlay({
  reader,
  initialSettings,
}: {
  reader: Reader;
  initialSettings: ReadXSettings;
}) {
  const [snap, setSnap] = useState<ReaderSnapshot>(() => reader.snapshot);
  const [settings, setSettings] = useState<ReadXSettings>(initialSettings);
  const [box, setBox] = useState<Box | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const lastBoxKey = useRef('');

  useEffect(() => {
    reader.onSnapshot = (next) => setSnap(next);
    return () => {
      reader.onSnapshot = null;
    };
  }, [reader]);

  /**
   * 高亮框跟随当前帖子的位置。
   *
   * 用 rAF 轮询而不是监听 scroll —— X 会频繁改动布局，scroll 事件覆盖不全。
   *
   * ⚠️ 但**只在有当前帖子时**才转这个循环。早先的写法是无条件常驻 rAF，
   * 意味着用户在任何一个 x.com 页面（哪怕从没点过播放）都会每 16ms 醒一次，
   * 浏览器永远进不了空闲状态 —— 长开的标签页上是实打实的耗电。
   */
  useEffect(() => {
    let raf = 0;

    const tick = () => {
      const el = reader.currentPost;
      const rect = el && el.isConnected ? el.getBoundingClientRect() : null;
      const key = rect
        ? `${Math.round(rect.top)}:${Math.round(rect.left)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
        : '';
      if (key !== lastBoxKey.current) {
        lastBoxKey.current = key;
        setBox(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null);
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf) return;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastBoxKey.current = '';
      setBox(null);
    };

    // 朗读器用 onFocusPost 通知"当前在读哪一条"，据此起停
    reader.onFocusPost = (post) => (post ? start() : stop());
    if (reader.currentPost) start();

    return () => {
      stop();
      if (reader.onFocusPost) reader.onFocusPost = null;
    };
  }, [reader]);

  useEffect(
    () =>
      watchSettings((next) => {
        setSettings(next);
        reader.setSettings(next);
      }),
    [reader],
  );

  const update = (patch: Partial<ReadXSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    void patchSettings(patch);
  };

  // 用户一旦真的开始朗读，就认为引导已经达成目的了 —— 不必再让他手动关掉
  useEffect(() => {
    if (snap.state === 'speaking' && !settings.hasSeenIntro) {
      update({ hasSeenIntro: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.state]);

  const showIntro = !settings.hasSeenIntro;

  const active = snap.state === 'speaking' || snap.state === 'paused';
  const progress =
    snap.sentenceCount > 0 ? `${snap.sentenceIndex + 1}/${snap.sentenceCount}` : '';

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {box && (
        <div
          className="absolute rounded-xl border-2 border-emerald-400/80 transition-[top,left,width,height] duration-200 ease-out"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      )}

      <div className="pointer-events-auto absolute bottom-5 left-1/2 flex w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
        {showIntro && <IntroCard onDismiss={() => update({ hasSeenIntro: true })} />}

        {/* 语音引擎降级告警：必须一直看得见，否则用户只会觉得"声音怎么变回去了" */}
        {snap.engineWarning && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-950/90 px-4 py-2.5 text-xs leading-relaxed text-amber-100 shadow-2xl backdrop-blur">
            <span className="font-semibold">⚠️ 语音引擎</span> {snap.engineWarning}
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-3 text-slate-100 shadow-2xl backdrop-blur">
          {/* 第一行：状态 + 控制按钮 */}
          <div className="flex items-center gap-3">
            <span className={`size-2.5 shrink-0 rounded-full ${STATE_DOT[snap.state]}`} />
            <span className="shrink-0 text-xs font-medium tabular-nums text-slate-300">
              {STATE_LABEL[snap.state]}
            </span>

            {snap.lang && (
              <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
                {snap.lang}
                <span className="ml-1 font-normal text-slate-400">{snap.langSource}</span>
              </span>
            )}

            {/* 翻译状态：译过就标注原文语言；被要求翻译却没译成，给个显眼的警示 */}
            {snap.translatedFrom ? (
              <span
                className="shrink-0 rounded-md bg-sky-400/20 px-1.5 py-0.5 text-[11px] font-semibold text-sky-300"
                title={`已从 ${snap.translatedFrom} 翻译`}
              >
                译·{snap.translatedFrom}
              </span>
            ) : (
              wantsTranslation(settings.readingLang, snap.lang) && (
                <span
                  className="shrink-0 rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300"
                  title="没能翻译，正在读原文"
                >
                  未译
                </span>
              )
            )}

            <div className="min-w-0 flex-1 truncate text-sm">
              {snap.author && <span className="font-semibold">{snap.author}</span>}
              {snap.author && progress && <span className="text-slate-500"> · </span>}
              {progress && <span className="text-slate-400 tabular-nums">{progress}</span>}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <IconButton title="上一条 (Alt+Shift+B)" onClick={() => void reader.prev()}>
                ⏮
              </IconButton>
              <IconButton
                title="播放 / 暂停 (Alt+Shift+P)"
                primary
                onClick={() => void reader.toggle()}
              >
                {snap.state === 'speaking' ? '⏸' : '▶'}
              </IconButton>
              <IconButton title="下一条 (Alt+Shift+N)" onClick={() => void reader.next()}>
                ⏭
              </IconButton>
              <IconButton title="停止" onClick={() => reader.stop()}>
                ⏹
              </IconButton>
              <IconButton title={collapsed ? '展开' : '收起'} onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? '⌃' : '⌄'}
              </IconButton>
            </div>
          </div>

          {/* 语言包下载：Chrome 要求必须由用户手势触发，所以只能做成显式按钮 */}
          {snap.pendingPack && (
            <div className="mt-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-200">
                  {snap.state === 'loading'
                    ? `正在下载 ${snap.pendingPack.from} → ${snap.pendingPack.to} 语言包…`
                    : `${snap.pendingPack.from} → ${snap.pendingPack.to} 语言包还没下载（只需一次）`}
                </span>
                <button
                  type="button"
                  disabled={snap.state === 'loading'}
                  onClick={() => void reader.prepareLanguagePack()}
                  className="ml-auto shrink-0 cursor-pointer rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-amber-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-400"
                >
                  {snap.state === 'loading' ? '下载中…' : '下载'}
                </button>
              </div>
              {snap.packProgress !== null && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/40">
                  <div
                    className="h-full bg-amber-400 transition-[width] duration-200"
                    style={{ width: `${Math.round(snap.packProgress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* 第二行：当前句子 */}
          {!collapsed && (
            <>
              {(snap.sentence || snap.message) && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-300">
                  {snap.sentence || snap.message}
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-2.5 text-[11px] text-slate-400">
                <label className="flex items-center gap-1.5">
                  朗读语言
                  <select
                    value={settings.readingLang}
                    onChange={(event) => update({ readingLang: event.target.value })}
                    className="cursor-pointer rounded border border-white/15 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200"
                  >
                    <option value="auto">跟随原文</option>
                    {LANGUAGE_CHOICES.map((code) => (
                      <option key={code} value={code}>
                        {languageLabel(code)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2">
                  语速
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={settings.rate}
                    onChange={(e) => update({ rate: Number(e.target.value) })}
                    className="h-1 w-24 cursor-pointer accent-emerald-400"
                  />
                  <span className="tabular-nums text-slate-300">{settings.rate.toFixed(2)}x</span>
                </label>

                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={settings.autoAdvance}
                    onChange={(e) => update({ autoAdvance: e.target.checked })}
                    className="size-3.5 cursor-pointer accent-emerald-400"
                  />
                  自动滚到下一条
                </label>

                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={settings.readAuthor}
                    onChange={(e) => update({ readAuthor: e.target.checked })}
                    className="size-3.5 cursor-pointer accent-emerald-400"
                  />
                  先读作者名
                </label>

                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={settings.skipAds}
                    onChange={(e) => update({ skipAds: e.target.checked })}
                    className="size-3.5 cursor-pointer accent-emerald-400"
                  />
                  跳过推广帖
                </label>

                {active && (
                  <span className="ml-auto tabular-nums text-slate-500">
                    {snap.charIndex}/{snap.sentence.length}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={[
        'grid size-7 cursor-pointer place-items-center rounded-lg text-xs transition-colors',
        primary
          ? 'bg-emerald-500 text-slate-900 hover:bg-emerald-400'
          : 'bg-white/10 text-slate-200 hover:bg-white/20',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * 首次使用引导。
 *
 * 不做独立的欢迎页 —— 用户装上扩展之后本来就会去 x.com，
 * 在真正需要它的地方出现一次最自然。点 ▶ 或点「知道了」都会永久关闭。
 */
function IntroCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-slate-900/95 px-4 py-3 text-slate-100 shadow-2xl backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="text-base leading-none">👋</span>
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-slate-300">
          <p className="font-semibold text-slate-100">ReadX 已就绪</p>
          <p className="mt-1">
            点 <span className="font-semibold text-emerald-400">▶</span> 开始朗读，
            它会自动滚到下一条帖子。你自己滚动时它会立刻让位。
          </p>
          <p className="mt-1">
            想听中文？把下面的「朗读语言」设成中文，外语帖子会先翻译再朗读。
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 cursor-pointer rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/20"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
