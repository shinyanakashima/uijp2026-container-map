import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * MapLibre はワーカーの URL を実行時に組み立てるため、バンドラが静的に検出できない。
 * ワーカー本体と、それが隣から読む共有モジュールを出力先へ複写する。
 * これを怠ると本番ビルドで地図が描画されない。
 */
function copyMaplibreWorker(): Plugin {
  let config: ResolvedConfig;
  const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
  return {
    name: "copy-maplibre-worker",
    apply: "build",
    configResolved(c) { config = c; },
    closeBundle() {
      const from = resolve("node_modules/maplibre-gl/dist");
      const to = join(config.build.outDir, config.build.assetsDir);
      mkdirSync(to, { recursive: true });
      for (const f of FILES) {
        const src = join(from, f);
        if (!existsSync(src)) throw new Error(`${f} が見つかりません`);
        copyFileSync(src, join(to, f));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyMaplibreWorker()],
  // GitHub Pages のプロジェクトページ配下に置くため base を指定する。
  // ローカルで配信する場合は BASE=./ を渡して相対パスにする。
  base: process.env.BASE ?? "/uijp2026-container-map/",
  build: { assetsInlineLimit: 0 },
});
