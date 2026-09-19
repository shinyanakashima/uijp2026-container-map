import type { StyleSpecification } from "maplibre-gl";
import { UI } from "./theme.ts";

const BASE_URL = import.meta.env.BASE_URL;

/** 背景地図の種類 */
export type Basemap = "pale" | "photo";

export const BASEMAP_LABELS: Record<Basemap, string> = {
  pale: "地図",
  photo: "衛星",
};

export const ATTRIBUTION = "出典：国土地理院（地理院タイルを加工して作成）";

const source = (file: string) => ({
  type: "raster" as const,
  tiles: [`pmtiles://${BASE_URL}basemap/${file}/{z}/{x}/{y}`],
  tileSize: 256,
  minzoom: 6,
  maxzoom: 13,
  attribution: ATTRIBUTION,
});

/**
 * 背景地図のスタイル。
 * - タイルは同梱の PMTiles のみを参照し、外部タイルサーバーを見ない
 * - 地図と衛星の2枚を重ねて置き、表示の切替で見せ分ける
 * - ラベル（symbol）レイヤは持たない。グリフの外部読み込みを避けるため、
 *   拠点名などの文字は地図の上に HTML で重ねる
 */
export function buildBasemapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      pale: source("gsi-pale.pmtiles"),
      photo: source("gsi-photo.pmtiles"),
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": UI.bg } },
      { id: "basemap-pale", type: "raster", source: "pale" },
      {
        id: "basemap-photo", type: "raster", source: "photo",
        layout: { visibility: "none" },
      },
    ],
  };
}
