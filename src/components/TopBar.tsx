import type { Mode } from "./MapView.tsx";
import { formatDate } from "../data.ts";

interface Props {
  dates: string[];
  day: number;
  mode: Mode;
  playing: boolean;
  onDay: (d: number) => void;
  onMode: (m: Mode) => void;
  onTogglePlay: () => void;
}

export function TopBar({ dates, day, mode, playing, onDay, onMode, onTogglePlay }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>農業用コンテナ 所在・過不足マップ</h1>
        <p>十勝管内／展示デモ</p>
      </div>

      <div className="mode-switch" role="group" aria-label="表示の切替">
        <button
          type="button"
          className={mode === "stock" ? "is-active" : ""}
          aria-pressed={mode === "stock"}
          onClick={() => onMode("stock")}
        >在庫表示</button>
        <button
          type="button"
          className={mode === "imbalance" ? "is-active" : ""}
          aria-pressed={mode === "imbalance"}
          onClick={() => onMode("imbalance")}
        >過不足表示</button>
      </div>

      <div className="time-control">
        <button
          type="button"
          className="play-button"
          onClick={onTogglePlay}
          aria-label={playing ? "停止" : "再生"}
        >{playing ? "■ 停止" : "▶ 再生"}</button>

        <div className="slider-wrap">
          <input
            type="range"
            min={0}
            max={dates.length - 1}
            value={day}
            onChange={(e) => onDay(Number(e.target.value))}
            aria-label="日付"
          />
          <div className="slider-scale">
            <span>8月1日</span><span>9月15日</span><span>10月31日</span>
          </div>
        </div>

        <output className="date-readout">{formatDate(dates[day])}</output>
      </div>
    </header>
  );
}
