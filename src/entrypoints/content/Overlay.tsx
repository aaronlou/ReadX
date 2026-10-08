import { useEffect, useRef, useState } from 'react';
import type { Reader } from '@/core/reader';
import { patchSettings, watchSettings, type ReadXSettings } from '@/settings';
import type { ReaderSnapshot } from '@/types';

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
};

const STATE_DOT: Record<ReaderSnapshot['state'], string> = {
  idle: 'bg-slate-400',
  loading: 'bg-amber-400 animate-pulse',
  speaking: 'bg-emerald-400 animate-pulse',
  paused: 'bg-sky-400',
  error: 'bg-rose-500',
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

  // 高亮框跟随当前帖子的位置。用 rAF 轮询而不是监听 scroll，
  // 因为 X 会频繁改动布局，scroll 事件不足以覆盖所有变化。
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
        setBox(
          rect
            ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
            : null,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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

      <div className="pointer-events-auto absolute bottom-5 left-1/2 -translate-x-1/2">
        <div className="w-[min(680px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-3 text-slate-100 shadow-2xl backdrop-blur">
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

          {/* 第二行：当前句子 */}
          {!collapsed && (
            <>
              {(snap.sentence || snap.message) && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-300">
                  {snap.sentence || snap.message}
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-2.5 text-[11px] text-slate-400">
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
