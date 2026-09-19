import type { Dataset } from "../types.ts";
import type { Link, Mode } from "./MapView.tsx";
import {
  BASE_FILL, FREE_FILL, IMBALANCE_STOPS, STATUS_LABELS, STATUS_SWATCH,
  TYPE_COLORS, TYPE_LABELS,
} from "../theme.ts";

interface Props {
  dataset: Dataset;
  day: number;
  mode: Mode;
  selected: number | null;
  links: Link[];
  /** 狭い画面でパネルを開いているか */
  open: boolean;
  onToggle: () => void;
}

export function SidePanel({ dataset, day, mode, selected, links, open, onToggle }: Props) {
  const st = dataset.stats[day];
  const total = dataset.containers.length;

  return (
    <aside className={`panel${open ? " is-open" : ""}`}>
      {/* 狭い画面では下端のバーだけを残して折りたためるようにする */}
      <div className="panel-bar">
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span aria-hidden="true">{open ? "▼" : "▲"}</span>
          {open ? "閉じる" : selected === null ? "全体サマリ" : dataset.bases[selected].name}
        </button>
        <div className="panel-notes">
          <p className="disclaimer">本画面のデータはすべて架空のものです。</p>
          <p className="source">出典：国土地理院（地理院タイルを加工して作成）</p>
        </div>
      </div>

      <div className="panel-scroll">
        {selected === null ? (
          <section>
            <h2>全体サマリ</h2>
            <dl className="figures">
              <div><dt>コンテナ総数</dt><dd>{total.toLocaleString()}<span>台</span></dd></div>
              <div><dt>稼働率</dt><dd>{Math.round((st.totalActive / total) * 100)}<span>%</span></dd></div>
              <div><dt>不足拠点数</dt><dd>{st.shortageBases}<span>拠点</span></dd></div>
              <div><dt>余剰拠点数</dt><dd>{st.surplusBases}<span>拠点</span></dd></div>
            </dl>
            <p className="hint">
              {mode === "stock"
                ? "拠点を選ぶと内訳を表示します。ズームすると個体が点で表示されます。"
                : "不足拠点を選ぶと、近い余剰拠点からの融通候補を表示します。"}
            </p>
          </section>
        ) : (
          <SelectedBase dataset={dataset} day={day} index={selected} links={links} />
        )}

        <Legend mode={mode} />

        <section className="concept">
          <h3>構想中の機能</h3>
          <p>選んだ候補に対してその場で予約を入れ、貸し手と借り手の双方に控えが残る仕組みを検討しています。</p>
          <p>一定期間戻らないコンテナを検知し、最後に確認された拠点とあわせて通知する仕組みも想定しています。</p>
        </section>
      </div>
    </aside>
  );
}

function SelectedBase({ dataset, day, index, links }: {
  dataset: Dataset; day: number; index: number; links: Link[];
}) {
  const b = dataset.bases[index];
  const st = dataset.stats[day];
  const nTypes = dataset.typeIds.length;
  const demand = dataset.daily.demand[index][day];
  const imbalance = st.imbalance[index];
  const present = st.statusCount.slice(index * 4, index * 4 + 4);

  return (
    <section>
      <h2>{b.name}</h2>
      <p className="subhead">{b.city}／保有 {b.capacity}台</p>

      <dl className="figures two">
        <div><dt>在席数</dt><dd>{st.available[index]}<span>台</span></dd></div>
        <div><dt>想定必要数</dt><dd>{demand}<span>台</span></dd></div>
      </dl>
      <p className={`imbalance ${imbalance < 0 ? "is-short" : "is-surplus"}`}>
        過不足 <strong>{imbalance >= 0 ? `+${imbalance}` : imbalance}</strong> 台
      </p>

      <h3>種類別</h3>
      <ul className="breakdown">
        {dataset.typeIds.map((t, i) => (
          <li key={t}>
            <i style={{ background: TYPE_COLORS[t] }} />
            <span>{TYPE_LABELS[t]}</span>
            <b>{st.typeCount[index * nTypes + i]}</b>
          </li>
        ))}
      </ul>

      <h3>ステータス別</h3>
      <ul className="breakdown">
        {STATUS_LABELS.map((s, i) => (
          i === 2 ? null : (
            <li key={s}>
              <i style={{ background: STATUS_SWATCH[i], borderColor: "#9aa5ad" }} />
              <span>{s}</span>
              <b>{present[i]}</b>
            </li>
          )
        ))}
      </ul>

      {links.length > 0 && (
        <>
          <h3>融通候補</h3>
          <ul className="candidates">
            {links.map((l) => (
              <li key={l.to}>
                <span>{dataset.bases[l.to].name}</span>
                <b>{l.distKm.toFixed(1)} km ／ {l.qty}台</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Legend({ mode }: { mode: Mode }) {
  return (
    <section className="legend">
      <h3>凡例</h3>
      {mode === "stock" ? (
        <>
          <ul className="breakdown">
            <li><i style={{ background: BASE_FILL, borderColor: "#8b9299" }} /><span>拠点（大きさは保有台数）</span></li>
            <li><i style={{ background: FREE_FILL }} /><span>うち空き</span></li>
          </ul>
          <ul className="breakdown">
            {Object.keys(TYPE_COLORS).map((t) => (
              <li key={t}><i style={{ background: TYPE_COLORS[t] }} /><span>{TYPE_LABELS[t]}</span></li>
            ))}
          </ul>
          <p className="hint">空きは白抜き、点検中は灰色、輸送中は薄く表示します。</p>
        </>
      ) : (
        <>
          <div className="ramp">
            <div style={{ background: `linear-gradient(to right, ${IMBALANCE_STOPS.map(([, c]) => c).join(",")})` }} />
            <div className="ramp-scale"><span>不足</span><span>0</span><span>余剰</span></div>
          </div>
          <p className="hint">円の大きさは過不足の絶対値に比例します。</p>
        </>
      )}
    </section>
  );
}
