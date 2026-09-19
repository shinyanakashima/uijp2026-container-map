// 農業用コンテナシェアリング デモ 疑似データ生成
// docs/spec.md 第4節に対応。出力はすべて架空のデータ。
//
// 実行: node scripts/generate-data.ts
// 乱数種を固定しているため、何度実行しても同一の結果になる。

import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { BASES } from "./bases.ts";

// ---------------------------------------------------------------- 調整パラメータ

const SEED = 20260801;
const TOTAL_CONTAINERS = 1200;
const START_DATE = "2026-08-01";
const DAYS = 92; // 8/1〜10/31

/** 季節係数の山の中心（日インデックス）。55 = 9月25日 */
const PEAK_DAY = 55;
/** 山の広がり（日） */
const PEAK_WIDTH = 17;
/** 端の底上げ。8月上旬・10月下旬でもゼロにはしない */
const SEASON_FLOOR = 0.18;

/** 常時「輸送中」にする比率 */
const TRANSIT_RATIO = 0.1;
/** 常時「点検中」にする比率 */
const INSPECTION_RATIO = 0.03;

/** 過不足がこの値以上なら余剰拠点、符号反転した値以下なら不足拠点とみなす */
const IMBALANCE_THRESHOLD = 5;

/** 完成条件の判定対象期間 */
const CHECK_FROM = "2026-09-20";
const CHECK_TO = "2026-09-30";
const CHECK_SHORTAGE_MIN = 3;
const CHECK_SHORTAGE_MAX = 5;
const CHECK_SURPLUS_MIN = 5;

const STATUS_LABELS = ["稼働中", "空き", "輸送中", "点検中"] as const;
const ST_ACTIVE = 0, ST_FREE = 1, ST_TRANSIT = 2, ST_INSPECT = 3;

const CONTAINER_TYPES = [
  { id: "large-steel", label: "大型鉄コンテナ", share: 0.40 },
  { id: "small", label: "小型コンテナ", share: 0.35 },
  { id: "pallet", label: "パレット型", share: 0.25 },
];

// ---------------------------------------------------------------- 乱数

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

function pickWeighted(weights: number[]): number {
  let sum = 0;
  for (const w of weights) sum += w;
  let r = rng() * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ---------------------------------------------------------------- 日付・距離

function dateList(): string[] {
  const out: string[] = [];
  const d = new Date(`${START_DATE}T00:00:00Z`);
  for (let i = 0; i < DAYS; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** 十勝程度の範囲なら平面近似で足りる。単位km */
function distanceKm(a: typeof BASES[number], b: typeof BASES[number]): number {
  const latMid = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lng - b.lng) * 111.32 * Math.cos(latMid);
  const dy = (a.lat - b.lat) * 110.57;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 収穫期に向けて立ち上がり、10月下旬に下がる季節係数 */
function season(t: number): number {
  const g = Math.exp(-((t - PEAK_DAY) ** 2) / (2 * PEAK_WIDTH ** 2));
  return SEASON_FLOOR + (1 - SEASON_FLOOR) * g;
}

function transitDays(km: number): number {
  if (km < 25) return 1;
  if (km < 60) return 2;
  return 3;
}

// ---------------------------------------------------------------- 準備

const dates = dateList();
const nBases = BASES.length;
const dist: number[][] = BASES.map((a) => BASES.map((b) => distanceKm(a, b)));

// コンテナを拠点に配る。保有台数の合計が総数と一致するため、各拠点に capacity 台ずつ。
type Container = { id: string; type: string; homeBaseId: string };
const containers: Container[] = [];
const homeBase: number[] = [];
for (let b = 0; b < nBases; b++) {
  for (let k = 0; k < BASES[b].capacity; k++) {
    const ti = pickWeighted(CONTAINER_TYPES.map((x) => x.share));
    containers.push({
      id: `C${String(containers.length + 1).padStart(4, "0")}`,
      type: CONTAINER_TYPES[ti].id,
      homeBaseId: BASES[b].id,
    });
    homeBase.push(b);
  }
}
if (containers.length !== TOTAL_CONTAINERS) {
  throw new Error(`コンテナ総数が一致しません: ${containers.length}`);
}

// ---------------------------------------------------------------- シミュレーション

const N = TOTAL_CONTAINERS;
const loc = Int16Array.from(homeBase);       // 所在拠点。-1 は輸送中
const trFrom = new Int16Array(N).fill(-1);
const trTo = new Int16Array(N).fill(-1);
const trLeft = new Int8Array(N);
const trTotal = new Int8Array(N);

// 出力バッファ
const baseOfDay: Int16Array[] = Array.from({ length: N }, () => new Int16Array(DAYS));
const statusOfDay: Uint8Array[] = Array.from({ length: N }, () => new Uint8Array(DAYS));
const demand: number[][] = Array.from({ length: nBases }, () => new Array<number>(DAYS).fill(0));
const stock: number[][] = Array.from({ length: nBases }, () => new Array<number>(DAYS).fill(0));
const freeCount: number[][] = Array.from({ length: nBases }, () => new Array<number>(DAYS).fill(0));
const imbalance: number[][] = Array.from({ length: nBases }, () => new Array<number>(DAYS).fill(0));
const transitPos = new Map<string, Record<string, [number, number]>>();

function depart(i: number, from: number, to: number): void {
  const d = transitDays(dist[from][to]);
  loc[i] = -1;
  trFrom[i] = from;
  trTo[i] = to;
  trTotal[i] = d;
  trLeft[i] = d;
}

const targetTransit = Math.round(N * TRANSIT_RATIO);

for (let t = 0; t < DAYS; t++) {
  // 1. 到着処理
  for (let i = 0; i < N; i++) {
    if (loc[i] !== -1) continue;
    trLeft[i]--;
    if (trLeft[i] <= 0) {
      loc[i] = trTo[i];
      trFrom[i] = -1;
      trTo[i] = -1;
    }
  }

  // 2. 在席台数と目標配分
  const held: number[][] = Array.from({ length: nBases }, () => [] as number[]);
  let inTransit = 0;
  for (let i = 0; i < N; i++) {
    if (loc[i] === -1) inTransit++;
    else held[loc[i]].push(i);
  }

  const s = season(t);
  const w = BASES.map((b) => b.capacity * (1 + b.driftWeight * s));
  const wSum = w.reduce((a, b) => a + b, 0);
  const stationed = N - inTransit;
  const target = w.map((x) => (stationed * x) / wSum);

  // 3. 目標との差を埋める移動。畑作中核から流出し、周辺部に滞留する
  const gap = held.map((h, b) => h.length - target[b]);
  const donors = gap.map((g, b) => [b, g] as [number, number]).filter(([, g]) => g > 0.5).sort((a, b) => b[1] - a[1]);
  const receivers = gap.map((g, b) => [b, -g] as [number, number]).filter(([, g]) => g > 0.5).sort((a, b) => b[1] - a[1]);

  for (const rcv of receivers) {
    let need = Math.floor(rcv[1]);
    for (const don of donors) {
      if (need <= 0) break;
      let spare = Math.floor(don[1]);
      while (need > 0 && spare > 0 && held[don[0]].length > 0) {
        const idx = Math.floor(rng() * held[don[0]].length);
        const i = held[don[0]][idx];
        held[don[0]].splice(idx, 1);
        depart(i, don[0], rcv[0]);
        inTransit++;
        need--;
        spare--;
        don[1]--;
      }
    }
  }

  // 4. 輸送中が規定比率に満たない分は、近隣間の通常の循環で埋める
  let guard = 0;
  while (inTransit < targetTransit && guard++ < 5000) {
    const src = pickWeighted(held.map((h) => h.length));
    if (held[src].length === 0) continue;
    const dstW = w.map((x, b) => (b === src ? 0 : x / Math.pow(Math.max(dist[src][b], 5), 1.5)));
    const dst = pickWeighted(dstW);
    if (dst === src) continue;
    const idx = Math.floor(rng() * held[src].length);
    const i = held[src][idx];
    held[src].splice(idx, 1);
    depart(i, src, dst);
    inTransit++;
  }

  // 5. ステータスの割り当て
  for (let b = 0; b < nBases; b++) {
    const present = held[b];
    // シャッフル
    for (let k = present.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [present[k], present[j]] = [present[j], present[k]];
    }
    const inspect = Math.min(present.length, Math.floor(present.length * INSPECTION_RATIO + rng()));
    const available = present.length - inspect;

    const jitter = 0.9 + 0.2 * rng();
    const d = Math.max(0, Math.round(BASES[b].capacity * BASES[b].demandPeak * s * jitter));
    const allocated = Math.min(available, d);
    const free = available - allocated;

    for (let k = 0; k < present.length; k++) {
      const i = present[k];
      baseOfDay[i][t] = b;
      statusOfDay[i][t] =
        k < inspect ? ST_INSPECT : k < inspect + allocated ? ST_ACTIVE : ST_FREE;
    }

    demand[b][t] = d;
    stock[b][t] = present.length;
    freeCount[b][t] = free;
    imbalance[b][t] = available - d; // = 空き − 未充足
  }

  // 6. 輸送中の位置
  for (let i = 0; i < N; i++) {
    if (loc[i] !== -1) continue;
    baseOfDay[i][t] = -1;
    statusOfDay[i][t] = ST_TRANSIT;
    const a = BASES[trFrom[i]], z = BASES[trTo[i]];
    const p = (trTotal[i] - trLeft[i] + 1) / (trTotal[i] + 1);
    const lng = Math.round((a.lng + (z.lng - a.lng) * p) * 10000) / 10000;
    const lat = Math.round((a.lat + (z.lat - a.lat) * p) * 10000) / 10000;
    const key = containers[i].id;
    let rec = transitPos.get(key);
    if (!rec) { rec = {}; transitPos.set(key, rec); }
    rec[String(t)] = [lng, lat];
  }
}

// ---------------------------------------------------------------- 出力

mkdirSync("public/data", { recursive: true });

const geojson = {
  type: "FeatureCollection",
  features: BASES.map((b) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [b.lng, b.lat] },
    properties: { id: b.id, name: b.name, city: b.city, capacity: b.capacity },
  })),
};
writeFileSync("public/data/bases.geojson", JSON.stringify(geojson, null, 2));
writeFileSync("public/data/containers.json", JSON.stringify(containers));

const daily = {
  meta: {
    note: "本データはすべて架空のものです。実在の組織・施設とは関係ありません。",
    seed: SEED,
    generatedBy: "scripts/generate-data.ts",
    statusLabels: STATUS_LABELS,
    containerTypes: CONTAINER_TYPES,
    imbalanceThreshold: IMBALANCE_THRESHOLD,
  },
  dates,
  baseIds: BASES.map((b) => b.id),
  // 拠点ごと・日ごとの想定必要数
  demand: demand.map((row) => row),
  // コンテナごと・日ごとの所在拠点（インデックス。-1は輸送中）とステータス
  containers: containers.map((c, i) => ({
    id: c.id,
    base: Array.from(baseOfDay[i]),
    status: Array.from(statusOfDay[i]),
  })),
  // 輸送中の座標のみ疎に保持。拠点在席時は拠点座標を用いる
  transit: Object.fromEntries(transitPos),
};
const gz = gzipSync(Buffer.from(JSON.stringify(daily)), { level: 9 });
writeFileSync("public/data/daily.json.gz", gz);

// ---------------------------------------------------------------- 集計出力

const fmt = (n: number, w: number) => String(n).padStart(w, " ");
const pad = (s: string, w: number) => {
  let width = 0;
  for (const ch of s) width += /[　-鿿！-｠]/.test(ch) ? 2 : 1;
  return s + " ".repeat(Math.max(0, w - width));
};
const augIdx = dates.map((d, i) => (d.startsWith("2026-08") ? i : -1)).filter((i) => i >= 0);
const octIdx = dates.map((d, i) => (d.startsWith("2026-10") ? i : -1)).filter((i) => i >= 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const peakIdx = dates.indexOf("2026-09-25");

console.log("=== 拠点別 在庫の推移（8月平均 → 10月平均） ===");
console.log(pad("拠点", 22) + " 保有  8月在庫 10月在庫   増減   9/25必要 9/25空き 9/25過不足");
for (let b = 0; b < nBases; b++) {
  const a = mean(augIdx.map((t) => stock[b][t]));
  const o = mean(octIdx.map((t) => stock[b][t]));
  console.log(
    pad(BASES[b].name, 22) +
    fmt(BASES[b].capacity, 5) +
    fmt(a.toFixed(1), 9) +
    fmt(o.toFixed(1), 9) +
    fmt((o - a >= 0 ? "+" : "") + (o - a).toFixed(1), 8) +
    fmt(demand[b][peakIdx], 10) +
    fmt(freeCount[b][peakIdx], 9) +
    fmt((imbalance[b][peakIdx] >= 0 ? "+" : "") + imbalance[b][peakIdx], 11)
  );
}

console.log("\n=== 日付ごとの不足拠点数・余剰拠点数（閾値 ±" + IMBALANCE_THRESHOLD + "台） ===");
const shortageByDay: number[] = [];
const surplusByDay: number[] = [];
for (let t = 0; t < DAYS; t++) {
  let sh = 0, su = 0;
  for (let b = 0; b < nBases; b++) {
    if (imbalance[b][t] <= -IMBALANCE_THRESHOLD) sh++;
    else if (imbalance[b][t] >= IMBALANCE_THRESHOLD) su++;
  }
  shortageByDay.push(sh);
  surplusByDay.push(su);
  console.log(`${dates[t]}  不足 ${fmt(sh, 2)} 拠点   余剰 ${fmt(su, 2)} 拠点`);
}

console.log("\n=== 完成条件の判定 ===");
const from = dates.indexOf(CHECK_FROM), to = dates.indexOf(CHECK_TO);
let pass = true;
for (let t = from; t <= to; t++) {
  const okSh = shortageByDay[t] >= CHECK_SHORTAGE_MIN && shortageByDay[t] <= CHECK_SHORTAGE_MAX;
  const okSu = surplusByDay[t] >= CHECK_SURPLUS_MIN;
  if (!(okSh && okSu)) pass = false;
  console.log(
    `${dates[t]}  不足 ${fmt(shortageByDay[t], 2)} (${CHECK_SHORTAGE_MIN}〜${CHECK_SHORTAGE_MAX}) ${okSh ? "OK" : "NG"}   ` +
    `余剰 ${fmt(surplusByDay[t], 2)} (${CHECK_SURPLUS_MIN}以上) ${okSu ? "OK" : "NG"}`
  );
}
console.log(pass ? "\n判定: 条件を満たしています" : "\n判定: 条件を満たしていません");

const { statSync } = await import("node:fs");
const sizes = ["bases.geojson", "containers.json", "daily.json.gz"].map(
  (f) => [f, statSync(`public/data/${f}`).size] as [string, number]
);
console.log("\n=== 出力ファイル ===");
let total = 0;
for (const [f, sz] of sizes) {
  total += sz;
  console.log(pad(f, 22) + fmt((sz / 1024).toFixed(1) + " KB", 12));
}
console.log(pad("合計", 22) + fmt((total / 1024 / 1024).toFixed(2) + " MB", 12) + (total <= 10 * 1024 * 1024 ? "  (上限10MB以内)" : "  (上限超過)"));
if (!pass) process.exitCode = 1;
