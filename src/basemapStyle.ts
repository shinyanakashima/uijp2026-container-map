import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import { UI } from "./theme.ts";

const BASE_URL = import.meta.env.BASE_URL;

/**
 * 背景地図のスタイル。
 * - タイルは同梱の PMTiles のみを参照し、外部タイルサーバーを見ない
 * - ラベル（symbol）レイヤは全て落とす。グリフの外部読み込みを避けるためで、
 *   拠点名などの文字は地図の上に HTML で重ねる
 */
export function buildBasemapStyle(): StyleSpecification {
  const themed = layers("basemap", namedFlavor("light"), { lang: "ja" })
    .filter((l) => l.type !== "symbol");

  return {
    version: 8,
    sources: {
      basemap: {
        type: "vector",
        url: `pmtiles://${BASE_URL}basemap/tokachi.pmtiles`,
        attribution: "© OpenStreetMap contributors, © Protomaps",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": UI.bg } },
      ...themed,
    ],
  } as StyleSpecification;
}
