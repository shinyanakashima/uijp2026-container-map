// 展示前の確認スクリプト。
// dist を配信し、外部ホストへの通信をすべて遮断した状態で
// docs/spec.md 第2節の90秒シナリオを順に実行する。
// Wi-Fiを切った会場と同じ条件を、回線を落とさずに再現する。
//
// 実行: npm run build && npm run check

import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = "dist";
const PORT = 4173;
// 相対パス（BASE=./）で作った USB 用ビルドと、GitHub Pages 用ビルドの
// どちらでも確認できるよう、index.html を見て配信位置を決める
const PREFIX = /(src|href)="\.\//.test(fs.readFileSync("dist/index.html", "utf8"))
  ? "" : "/uijp2026-container-map";
console.log(PREFIX ? `配信位置: ${PREFIX}/` : "配信位置: / （相対パスのビルド）");
const SHOTS = "check-shots";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".geojson": "application/json",
  ".gz": "application/gzip", ".pmtiles": "application/octet-stream",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (PREFIX && p.startsWith(PREFIX)) p = p.slice(PREFIX.length);
  if (p === "" || p === "/") p = "/index.html";
  const file = join(ROOT, p);
  try {
    const st = await stat(file);
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const from = Number(m[1]), to = m[2] ? Number(m[2]) : st.size - 1;
      const buf = (await readFile(file)).subarray(from, to + 1);
      res.writeHead(206, {
        "Content-Type": type, "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${from}-${to}/${st.size}`, "Content-Length": buf.length,
      });
      return res.end(buf);
    }
    res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": st.size });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const problems = [];
const external = [];
// 会場の回線が無い状態を再現する。自分以外への通信はすべて落とす
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(`http://127.0.0.1:${PORT}`) || url.startsWith("data:") || url.startsWith("blob:")) {
    return route.continue();
  }
  external.push(url);
  return route.abort();
});
page.on("pageerror", (e) => problems.push(`スクリプトエラー: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`コンソール: ${m.text()}`); });

const shot = async (name, wait = 2200) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const check = (label, ok, detail) => {
  console.log(`${ok ? "OK  " : "NG  "} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) problems.push(label);
};

console.log(`=== 90秒シナリオ（外部通信を遮断した状態） ===`);
await page.goto(`http://127.0.0.1:${PORT}${PREFIX}/`, { waitUntil: "load" });
await page.waitForSelector(".panel", { timeout: 30000 });

// 0〜15秒 十勝全域に拠点が並ぶ
await shot("01-initial", 4500);
const labels = await page.locator(".base-label").count();
check("拠点24か所が地図に出ている", labels === 24, `${labels}か所`);
check("架空データの注記が常時見えている",
  await page.locator(".disclaimer").isVisible());
check("構想中の機能が右パネルにある",
  (await page.locator(".concept p").count()) === 2);

// 15〜35秒 時間スライダーを収穫期へ
await page.locator('input[type="range"]').fill("55");
await shot("02-slider");
const date = await page.locator(".date-readout").innerText();
check("スライダーで9月25日へ移動できる", date === "9月25日", date);
const summary = await page.locator(".figures").first().innerText();
check("収穫期に不足拠点が現れる", /不足拠点数\s*5/.test(summary.replace(/\n/g, " ")),
  summary.replace(/\n/g, " "));

// 35〜60秒 過不足表示へ切替
await page.getByRole("button", { name: "過不足表示" }).click();
await shot("03-imbalance");
check("過不足表示に切り替わる",
  await page.getByRole("button", { name: "過不足表示" }).evaluate((e) => e.classList.contains("is-active")));

// 60〜80秒 不足拠点から融通候補を引く
const spot = await page.evaluate(() => {
  const el = [...document.querySelectorAll(".base-label")]
    .find((e) => e.textContent.includes("芽室 第1"));
  if (!el) throw new Error("芽室 第1集荷拠点のラベルが見つかりません");
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top - 10 };
});
await page.mouse.click(spot.x, spot.y);
await shot("04-candidates", 3000);
const lineLabels = await page.locator(".link-label").allTextContents();
check("融通候補が3件、線で結ばれる", lineLabels.length === 3, lineLabels.join(" / "));
check("線に距離と融通可能台数が出ている",
  lineLabels.every((t) => /km/.test(t) && /台/.test(t)));
const panel = await page.locator(".panel-scroll").innerText();
check("右パネルに選択拠点の内訳が出る", panel.includes("芽室 第1集荷拠点") && panel.includes("過不足"));

// 80〜90秒 在庫表示に戻し、ズーム11以上で個体を表示
await page.getByRole("button", { name: "在庫表示" }).click();
await page.waitForTimeout(800);
await page.locator(".maplibregl-ctrl-zoom-in").click();
await shot("05-containers", 3500);

console.log(`\n=== 外部通信 ===`);
check("外部ホストへの通信が一度も発生していない", external.length === 0,
  external.length ? external.slice(0, 5).join(", ") : "");

await browser.close();
server.close();

console.log(`\n画面の記録: ${SHOTS}/`);
if (problems.length) {
  console.log(`\n問題 ${problems.length}件:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\nすべて問題ありません。`);
}
