import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapView, type Link, type Mode } from "./components/MapView.tsx";
import { BASEMAP_LABELS, type Basemap } from "./basemapStyle.ts";
import { TopBar } from "./components/TopBar.tsx";
import { SidePanel } from "./components/SidePanel.tsx";
import { distanceKm, loadDataset } from "./data.ts";
import type { Dataset } from "./types.ts";

/** 無操作でこの時間が過ぎたら初期状態に戻す */
const IDLE_RESET_MS = 120_000;
/** 再生時は1秒あたり3日進む */
const PLAY_INTERVAL_MS = 1000 / 3;
/** 融通候補の最大表示件数 */
const MAX_CANDIDATES = 3;

export function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [mode, setMode] = useState<Mode>("stock");
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("pale");
  /** 俯瞰に戻したいときに増やす。地図側がこれを見てカメラを戻す */
  const [viewResetKey, setViewResetKey] = useState(0);

  useEffect(() => {
    loadDataset().then(setDataset).catch((e: Error) => setError(e.message));
  }, []);

  // ---------------------------------------------------------------- 無操作リセット
  const idleTimer = useRef<number | null>(null);
  const resetToInitial = useCallback(() => {
    setDay(0); setMode("stock"); setSelected(null); setPlaying(false);
    setBasemap("pale");
    setViewResetKey((k) => k + 1);
  }, []);
  const touch = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(resetToInitial, IDLE_RESET_MS);
  }, [resetToInitial]);

  useEffect(() => {
    touch();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [touch]);

  // ---------------------------------------------------------------- 再生
  useEffect(() => {
    if (!playing || !dataset) return;
    const last = dataset.daily.dates.length - 1;
    const id = window.setInterval(() => {
      setDay((d) => { if (d >= last) { setPlaying(false); return last; } return d + 1; });
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, dataset]);

  // ---------------------------------------------------------------- 融通候補
  const links: Link[] = useMemo(() => {
    if (!dataset || selected === null || mode !== "imbalance") return [];
    const st = dataset.stats[day];
    const th = dataset.daily.meta.imbalanceThreshold;
    const shortage = st.imbalance[selected];
    if (shortage > -th) return [];

    return dataset.bases
      .map((b, i) => ({ i, surplus: st.imbalance[i], d: distanceKm(dataset.bases[selected], b) }))
      .filter((x) => x.i !== selected && x.surplus >= th)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_CANDIDATES)
      .map((x) => ({
        from: selected, to: x.i, distKm: x.d,
        qty: Math.min(x.surplus, -shortage),
      }));
  }, [dataset, selected, mode, day]);

  const onMode = useCallback((m: Mode) => { setMode(m); setSelected(null); }, []);
  /** 選択を外したら俯瞰に戻す。候補表示で寄ったままにしない */
  const onSelect = useCallback((i: number | null) => {
    setSelected(i);
    if (i === null) setViewResetKey((k) => k + 1);
  }, []);
  const onDay = useCallback((d: number) => { setDay(d); setPlaying(false); }, []);

  if (error) return <div className="loading"><p>データを読み込めませんでした。</p><p className="hint">{error}</p></div>;
  if (!dataset) return <div className="loading"><p>読み込み中…</p></div>;

  return (
    <div className="layout">
      <TopBar
        dates={dataset.daily.dates}
        day={day}
        mode={mode}
        playing={playing}
        onDay={onDay}
        onMode={onMode}
        onTogglePlay={() => setPlaying((p) => !p)}
      />
      <main className="stage">
        <div className="map-area">
          <MapView
            dataset={dataset}
            day={day}
            mode={mode}
            selected={selected}
            links={links}
            onSelect={onSelect}
            onInteract={touch}
            viewResetKey={viewResetKey}
            basemap={basemap}
          />
          <div className="basemap-switch" role="group" aria-label="背景地図の切替">
            {(Object.keys(BASEMAP_LABELS) as Basemap[]).map((b) => (
              <button
                key={b}
                type="button"
                className={basemap === b ? "is-active" : ""}
                aria-pressed={basemap === b}
                onClick={() => setBasemap(b)}
              >{BASEMAP_LABELS[b]}</button>
            ))}
          </div>
        </div>
        <SidePanel dataset={dataset} day={day} mode={mode} selected={selected} links={links} />
      </main>
    </div>
  );
}
