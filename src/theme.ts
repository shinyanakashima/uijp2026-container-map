// 配色。展示会場の照明と投影を想定し、彩度を落とした業務画面寄りの組み合わせとする。
// 種類は色相で、ステータスは塗りと輪郭の差で区別する。

export const UI = {
  bg: "#f4f3f0",
  panelBg: "#ffffff",
  border: "#d7d4ce",
  text: "#23282c",
  textMuted: "#6d7379",
  accent: "#3d6b80",
  accentSoft: "#e7eef1",
};

/** コンテナ種類。色相で区別する */
export const TYPE_COLORS: Record<string, string> = {
  "large-steel": "#4a6b8a", // 大型鉄コンテナ／青系
  small: "#7a8f5c",         // 小型コンテナ／緑系
  pallet: "#a8763f",        // パレット型／黄土系
};

export const TYPE_LABELS: Record<string, string> = {
  "large-steel": "大型鉄コンテナ",
  small: "小型コンテナ",
  pallet: "パレット型",
};

/** 稼働ステータス。地図上は塗りの濃淡と輪郭で表す */
export const STATUS_LABELS = ["稼働中", "空き", "輸送中", "点検中"] as const;
export const STATUS_SWATCH = ["#55606a", "#ffffff", "#9aa5ad", "#c8c3ba"];

/** 拠点の在庫表示 */
export const BASE_RING = "#8b9299";
export const BASE_FILL = "#e9e7e2";
export const FREE_FILL = "#5b8fa3";

/**
 * 過不足の発散配色。正（余剰）は寒色、負（不足）は暖色、0近傍は無彩色。
 * MapLibre の interpolate にそのまま渡す。
 */
export const IMBALANCE_STOPS: [number, string][] = [
  [-280, "#8f4620"],
  [-120, "#bc7e50"],
  [-24, "#ddd7cf"],
  [0, "#d6d4d0"],
  [24, "#c2d3d9"],
  [120, "#4e8a9e"],
  [280, "#1f5f75"],
];

/** 円の半径を決めるときの、保有台数と過不足の基準値 */
export const CAPACITY_RANGE = { min: 100, max: 400 };
export const IMBALANCE_MAX = 280;

/** 融通候補の線 */
export const LINK_COLOR = "#2f5d6e";
