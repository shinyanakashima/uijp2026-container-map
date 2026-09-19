import { useEffect, useRef } from "react";
import {
  LngLatBounds, Map as MlMap, Marker, NavigationControl, addProtocol,
  type GeoJSONSource, type MapMouseEvent,
  type ExpressionSpecification,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { FeatureCollection, Feature, Point } from "geojson";
import type { Dataset } from "../types.ts";
import { buildBasemapStyle, type Basemap } from "../basemapStyle.ts";
import {
  BASE_FILL, BASE_RING, FREE_FILL, IMBALANCE_STOPS, LINK_COLOR, TYPE_COLORS,
} from "../theme.ts";

export interface Link { from: number; to: number; distKm: number; qty: number; }
export type Mode = "stock" | "imbalance";

interface Props {
  dataset: Dataset;
  day: number;
  mode: Mode;
  selected: number | null;
  links: Link[];
  onSelect: (index: number | null) => void;
  onInteract: () => void;
  /** 値が変わったら俯瞰に戻す */
  viewResetKey: number;
  basemap: Basemap;
}

/** 拠点全体が収まる範囲。初期表示と無操作リセットの両方でこれに戻す */
export const OVERVIEW_BOUNDS: [[number, number], [number, number]] =
  [[142.74, 42.20], [143.82, 43.54]];
/** 画面が狭いときは余白を詰める。固定値だと拠点全体が小さくなりすぎる */
const overviewFit = (duration: number) => ({
  padding: Math.max(16, Math.min(56, window.innerWidth * 0.06)),
  maxZoom: 9,
  duration,
});

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

let protocolRegistered = false;
function registerProtocol(): void {
  if (protocolRegistered) return;
  addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

/** 保有台数に比例した円の半径。最小8px、最大28px */
const radiusForCapacity = (capacity: number): number =>
  8 + Math.min(1, Math.max(0, (capacity - 25) / 75)) * 20;

/** 過不足の絶対値に比例した円の半径 */
const radiusForImbalance = (v: number): number =>
  6 + Math.sqrt(Math.min(1, Math.abs(v) / 70)) * 24;

export function MapView({
  dataset, day, mode, selected, links, onSelect, onInteract, viewResetKey, basemap,
}: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const pending = useRef<(() => void)[]>([]);
  const baseMarkers = useRef<Marker[]>([]);
  const linkMarkers = useRef<Marker[]>([]);
  const animation = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const syncLabels = useRef<() => void>(() => {});

  const whenReady = (fn: () => void): void => {
    if (ready.current) fn();
    else pending.current.push(fn);
  };

  // ---------------------------------------------------------------- 初期化
  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    registerProtocol();

    const map = new MlMap({
      container: holder.current,
      style: buildBasemapStyle(),
      bounds: OVERVIEW_BOUNDS,
      fitBoundsOptions: overviewFit(0),
      minZoom: 6,
      maxZoom: 13.9,
      maxBounds: [[141.9, 41.8], [144.8, 44.0]],
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    map.on("error", (e) => {
      // 会場でのトラブル切り分けのため、地図側の失敗は握りつぶさず残す
      console.error("地図の読み込みに失敗しました:", e.error?.message ?? e);
    });

    map.on("load", () => {
      map.addSource("bases", { type: "geojson", data: EMPTY });
      map.addSource("containers", { type: "geojson", data: EMPTY });
      map.addSource("links", { type: "geojson", data: EMPTY });

      map.addLayer({
        id: "bases-circle", type: "circle", source: "bases",
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": ["get", "fill"],
          "circle-opacity": 0.9,
          "circle-stroke-color": ["get", "ring"],
          "circle-stroke-width": ["get", "ringWidth"],
        },
      });
      map.addLayer({
        id: "bases-free", type: "circle", source: "bases",
        filter: ["==", ["get", "showFree"], true],
        paint: {
          "circle-radius": ["get", "rFree"],
          "circle-color": FREE_FILL,
          "circle-opacity": 0.75,
        },
      });

      const typeMatch: ExpressionSpecification = [
        "match", ["get", "ty"],
        "large-steel", TYPE_COLORS["large-steel"],
        "small", TYPE_COLORS.small,
        "pallet", TYPE_COLORS.pallet,
        "#888888",
      ];
      map.addLayer({
        id: "containers-point", type: "circle", source: "containers", minzoom: 11,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 13.9, 5.2],
          "circle-color": [
            "case",
            ["==", ["get", "st"], 1], "#ffffff",
            ["==", ["get", "st"], 3], "#c8c3ba",
            typeMatch,
          ],
          "circle-stroke-color": typeMatch,
          "circle-stroke-width": ["case", ["==", ["get", "st"], 1], 1.6, 0.7],
          "circle-opacity": ["case", ["==", ["get", "st"], 2], 0.6, 1],
        },
      });

      map.addLayer({
        id: "links-casing", type: "line", source: "links",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "links-line", type: "line", source: "links",
        layout: { "line-cap": "round" },
        paint: { "line-color": LINK_COLOR, "line-width": 3, "line-opacity": 0.95 },
      });

      // タップ領域を44px四方以上にするための透明レイヤ
      map.addLayer({
        id: "bases-hit", type: "circle", source: "bases",
        paint: { "circle-radius": ["max", ["get", "r"], 22], "circle-opacity": 0 },
      });

      map.on("click", (e: MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["bases-hit"] });
        if (hits.length === 0) { onSelect(null); return; }
        // 拠点が近接していると判定領域が重なる。押した点に最も近いものを選ぶ
        let best = hits[0];
        let bestDistance = Infinity;
        for (const hit of hits) {
          const g = hit.geometry as Point;
          const p = map.project(g.coordinates as [number, number]);
          const d = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
          if (d < bestDistance) { bestDistance = d; best = hit; }
        }
        onSelect(best.properties.index as number);
      });
      map.on("mouseenter", "bases-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "bases-hit", () => { map.getCanvas().style.cursor = ""; });
      map.on("dragstart", onInteract);
      map.on("zoomstart", onInteract);

      // 拠点名は HTML で重ねる。グリフの外部読み込みを避けるため
      baseMarkers.current = dataset.bases.map((b) => {
        const el = document.createElement("div");
        el.className = "base-label";
        el.textContent = b.name;
        return new Marker({ element: el, anchor: "top", offset: [0, 10] })
          .setLngLat([b.lng, b.lat]).addTo(map);
      });
      syncLabels.current = () => {
        const z = map.getZoom();
        baseMarkers.current.forEach((m, i) => {
          const el = m.getElement();
          const sel = selectedRef.current === i;
          el.classList.toggle("is-visible", z >= 9.3 || sel);
          el.classList.toggle("is-selected", sel);
        });
      };
      map.on("zoom", () => syncLabels.current());

      ready.current = true;
      for (const fn of pending.current) fn();
      pending.current = [];
    });

    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
      baseMarkers.current = [];
    };
    // 初期化は一度だけ行う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- 背景地図の切替
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => {
      map.setLayoutProperty("basemap-pale", "visibility", basemap === "pale" ? "visible" : "none");
      map.setLayoutProperty("basemap-photo", "visibility", basemap === "photo" ? "visible" : "none");
    });
  }, [basemap]);

  // ---------------------------------------------------------------- 俯瞰に戻す
  useEffect(() => {
    const map = mapRef.current;
    if (!map || viewResetKey === 0) return;
    whenReady(() => map.fitBounds(OVERVIEW_BOUNDS, overviewFit(600)));
  }, [viewResetKey]);

  // ---------------------------------------------------------------- 拠点とコンテナ
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => {
      const st = dataset.stats[day];
      const th = dataset.daily.meta.imbalanceThreshold;

      const baseFeatures: Feature[] = dataset.bases.map((b, i) => {
        const imb = st.imbalance[i];
        const isSel = selected === i;
        const r = mode === "stock" ? radiusForCapacity(b.capacity) : radiusForImbalance(imb);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [b.lng, b.lat] },
          properties: {
            index: i,
            r,
            rFree: r * Math.sqrt(st.free[i] / Math.max(b.capacity, 1)),
            showFree: mode === "stock",
            fill: mode === "stock" ? BASE_FILL : colorForImbalance(imb),
            ring: isSel ? "#1d2a31" : mode === "stock" ? BASE_RING : "#ffffff",
            ringWidth: isSel ? 3 : mode === "stock" ? 1.2 : 1.4,
            shortage: imb <= -th,
          },
        };
      });
      (map.getSource("bases") as GeoJSONSource | undefined)
        ?.setData({ type: "FeatureCollection", features: baseFeatures });

      const containerFeatures: Feature[] = [];
      if (mode === "stock") {
        const d = dataset.daily;
        for (let i = 0; i < d.containers.length; i++) {
          const c = d.containers[i];
          const b = c.base[day];
          let lng: number, lat: number;
          if (b >= 0) {
            // 同一拠点の個体が重ならないよう、決定的な微小オフセットを与える
            lng = dataset.bases[b].lng + (((i * 7919) % 1000) / 1000 - 0.5) * 0.020;
            lat = dataset.bases[b].lat + (((i * 40503) % 1000) / 1000 - 0.5) * 0.013;
          } else {
            const p = d.transit[c.id]?.[String(day)];
            if (!p) continue;
            [lng, lat] = p;
          }
          containerFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: { st: c.status[day], ty: dataset.typeIds[dataset.typeIndex[i]] },
          });
        }
      }
      (map.getSource("containers") as GeoJSONSource | undefined)
        ?.setData({ type: "FeatureCollection", features: containerFeatures });

      selectedRef.current = selected;
      syncLabels.current();
    });
  }, [dataset, day, mode, selected]);

  // ---------------------------------------------------------------- 融通候補の線
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    for (const m of linkMarkers.current) m.remove();
    linkMarkers.current = [];

    whenReady(() => {
      const src = map.getSource("links") as GeoJSONSource | undefined;
      if (links.length === 0) { src?.setData(EMPTY); return; }

      // 俯瞰のままでは線が円に隠れて読めないため、候補が収まる範囲まで寄せる
      const pts = [dataset.bases[links[0].from], ...links.map((l) => dataset.bases[l.to])];
      const bounds = new LngLatBounds();
      for (const p of pts) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, {
        padding: Math.max(48, Math.min(160, window.innerWidth * 0.14)),
        maxZoom: 10.5,
        duration: 700,
      });

      // 90秒シナリオの山場。線を不足拠点から余剰拠点へ伸ばして描く
      const start = performance.now();
      const DURATION = 520;
      const draw = (now: number) => {
        const p = Math.min(1, (now - start) / DURATION);
        const eased = 1 - (1 - p) ** 3;
        src?.setData({
          type: "FeatureCollection",
          features: links.map((l): Feature => {
            const a = dataset.bases[l.from], z = dataset.bases[l.to];
            return {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [a.lng, a.lat],
                  [a.lng + (z.lng - a.lng) * eased, a.lat + (z.lat - a.lat) * eased],
                ],
              },
              properties: {},
            };
          }),
        });
        if (p < 1) { animation.current = requestAnimationFrame(draw); return; }
        animation.current = null;
        for (const l of links) {
          const a = dataset.bases[l.from], z = dataset.bases[l.to];
          const el = document.createElement("div");
          el.className = "link-label";
          el.textContent = `${l.distKm.toFixed(1)} km ／ 融通可能 ${l.qty}台`;
          // 中点だと拠点名と重なるため、余剰拠点寄りに置く
          const at = 0.62;
          linkMarkers.current.push(
            new Marker({ element: el, anchor: "bottom", offset: [0, -6] })
              .setLngLat([a.lng + (z.lng - a.lng) * at, a.lat + (z.lat - a.lat) * at])
              .addTo(map),
          );
        }
      };
      animation.current = requestAnimationFrame(draw);
    });

    return () => { if (animation.current !== null) cancelAnimationFrame(animation.current); };
  }, [links, dataset]);

  return <div ref={holder} className={`map-holder is-${basemap}`} />;
}

/** 発散配色から過不足に対応する色を求める */
function colorForImbalance(v: number): string {
  const s = IMBALANCE_STOPS;
  if (v <= s[0][0]) return s[0][1];
  if (v >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 0; i < s.length - 1; i++) {
    if (v >= s[i][0] && v <= s[i + 1][0]) {
      return mix(s[i][1], s[i + 1][1], (v - s[i][0]) / (s[i + 1][0] - s[i][0]));
    }
  }
  return s[0][1];
}

function mix(a: string, b: string, t: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(a), [r2, g2, b2] = parse(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`;
}
