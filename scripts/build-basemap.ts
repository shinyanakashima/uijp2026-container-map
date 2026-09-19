// 十勝域の背景地図を単一のPMTilesとして切り出す。
// 公開ベクタタイル（Protomaps daily build）から対象範囲・ズームのタイルだけを
// レンジリクエストで取得し、PMTiles v3として再パックする。
// 会場で外部タイルサーバーを参照しないための前処理であり、ビルド時に一度だけ実行する。
//
// 実行: node scripts/build-basemap.ts

import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { PMTiles, zxyToTileId } from "pmtiles";

const SOURCE = "https://build.protomaps.com/20260915.pmtiles";
const OUT = "public/basemap/tokachi.pmtiles";

// docs/spec.md 第3.1節の対象範囲に、端が欠けないよう少し余白を足したもの。
// 低ズームでは画面が対象範囲より広くなり、端に背景の無い帯ができる。
// z9以下だけ範囲を広げて埋める。広域のタイルは数十枚で済むため容量には響かない。
const NEAR = { minLng: 142.4, maxLng: 144.3, minLat: 42.2, maxLat: 43.6 };
const WIDE = { minLng: 141.4, maxLng: 145.1, minLat: 41.6, maxLat: 44.2 };
const WIDE_UNTIL_ZOOM = 9;
const MIN_ZOOM = 6, MAX_ZOOM = 13;

const boxFor = (z: number) => (z <= WIDE_UNTIL_ZOOM ? WIDE : NEAR);

const CONCURRENCY = 16;

const lngToX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// ---------------------------------------------------------------- varint

function pushVarint(out: number[], v: number): void {
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  out.push(v);
}

interface Entry { tileId: number; offset: number; length: number; runLength: number; }

function serializeDirectory(entries: Entry[]): Buffer {
  const out: number[] = [];
  pushVarint(out, entries.length);
  let last = 0;
  for (const e of entries) { pushVarint(out, e.tileId - last); last = e.tileId; }
  for (const e of entries) pushVarint(out, e.runLength);
  for (const e of entries) pushVarint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) pushVarint(out, 0);
    else pushVarint(out, e.offset + 1);
  }
  return gzipSync(Buffer.from(out), { level: 9 });
}

function buildHeader(f: {
  rootOffset: number; rootLength: number;
  metaOffset: number; metaLength: number;
  leafOffset: number; leafLength: number;
  dataOffset: number; dataLength: number;
  addressed: number; entries: number; contents: number;
}): Buffer {
  const b = Buffer.alloc(127);
  b.write("PMTiles", 0, "ascii");
  b.writeUInt8(3, 7);
  const u64 = (v: number, o: number) => b.writeBigUInt64LE(BigInt(v), o);
  u64(f.rootOffset, 8);   u64(f.rootLength, 16);
  u64(f.metaOffset, 24);  u64(f.metaLength, 32);
  u64(f.leafOffset, 40);  u64(f.leafLength, 48);
  u64(f.dataOffset, 56);  u64(f.dataLength, 64);
  u64(f.addressed, 72);   u64(f.entries, 80);  u64(f.contents, 88);
  b.writeUInt8(1, 96);  // clustered
  b.writeUInt8(2, 97);  // internal compression = gzip
  b.writeUInt8(2, 98);  // tile compression = gzip
  b.writeUInt8(1, 99);  // tile type = mvt
  b.writeUInt8(MIN_ZOOM, 100);
  b.writeUInt8(MAX_ZOOM, 101);
  const e7 = (v: number, o: number) => b.writeInt32LE(Math.round(v * 1e7), o);
  e7(WIDE.minLng, 102); e7(WIDE.minLat, 106); e7(WIDE.maxLng, 110); e7(WIDE.maxLat, 114);
  b.writeUInt8(9, 118); // center zoom = 初期ズーム
  e7((NEAR.minLng + NEAR.maxLng) / 2, 119);
  e7((NEAR.minLat + NEAR.maxLat) / 2, 123);
  return b;
}

// ---------------------------------------------------------------- 取得

const src = new PMTiles(SOURCE);
const srcHeader = await src.getHeader();
const srcMeta = await src.getMetadata() as Record<string, unknown>;
console.log(`元データ: z${srcHeader.minZoom}-${srcHeader.maxZoom} / タイル種別 ${srcHeader.tileType}`);
console.log(`レイヤ: ${(srcMeta.vector_layers as { id: string }[] | undefined)?.map((l) => l.id).join(", ") ?? "(不明)"}`);

type Want = { z: number; x: number; y: number; id: number };
const wanted: Want[] = [];
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
  const box = boxFor(z);
  const x0 = lngToX(box.minLng, z), x1 = lngToX(box.maxLng, z);
  const y0 = latToY(box.maxLat, z), y1 = latToY(box.minLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    wanted.push({ z, x, y, id: zxyToTileId(z, x, y) });
  }
  console.log(`z${z}: ${(x1 - x0 + 1)} × ${(y1 - y0 + 1)} = ${(x1 - x0 + 1) * (y1 - y0 + 1)} タイル`);
}
wanted.sort((a, b) => a.id - b.id);
console.log(`合計 ${wanted.length} タイルを取得します`);

const fetched = new Map<number, Buffer>();
let done = 0, missing = 0;
let cursor = 0;

async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++;
    if (i >= wanted.length) return;
    const w = wanted[i];
    let got: { data: ArrayBuffer } | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { got = await src.getZxy(w.z, w.x, w.y); break; }
      catch { await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); }
    }
    if (got?.data && got.data.byteLength > 0) fetched.set(w.id, Buffer.from(got.data));
    else missing++;
    if (++done % 250 === 0) console.log(`  ${done}/${wanted.length} 取得`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`取得完了: ${fetched.size} タイル（空 ${missing}）`);

// ---------------------------------------------------------------- 再パック

const blobs: Buffer[] = [];
const offsetByHash = new Map<string, { offset: number; length: number }>();
const entries: Entry[] = [];
let dataLen = 0;

for (const w of wanted) {
  const raw = fetched.get(w.id);
  if (!raw) continue;
  const gz = gzipSync(raw, { level: 9 });
  const hash = gz.toString("base64");
  let pos = offsetByHash.get(hash);
  if (!pos) {
    pos = { offset: dataLen, length: gz.length };
    offsetByHash.set(hash, pos);
    blobs.push(gz);
    dataLen += gz.length;
  }
  const prev = entries[entries.length - 1];
  if (prev && prev.offset === pos.offset && prev.length === pos.length &&
      prev.tileId + prev.runLength === w.id) {
    prev.runLength++;
  } else {
    entries.push({ tileId: w.id, offset: pos.offset, length: pos.length, runLength: 1 });
  }
}

const metaBuf = gzipSync(Buffer.from(JSON.stringify({
  name: "十勝 背景地図",
  description: "展示デモ用。Protomaps daily build から十勝域を切り出したもの",
  attribution: "© OpenStreetMap contributors, © Protomaps",
  vector_layers: srcMeta.vector_layers ?? [],
})), { level: 9 });

const rootBuf = serializeDirectory(entries);
const rootOffset = 127;
const metaOffset = rootOffset + rootBuf.length;
const leafOffset = metaOffset + metaBuf.length;
const dataOffset = leafOffset; // リーフディレクトリなし

const header = buildHeader({
  rootOffset, rootLength: rootBuf.length,
  metaOffset, metaLength: metaBuf.length,
  leafOffset, leafLength: 0,
  dataOffset, dataLength: dataLen,
  addressed: entries.reduce((a, e) => a + e.runLength, 0),
  entries: entries.length,
  contents: blobs.length,
});

mkdirSync("public/basemap", { recursive: true });
writeFileSync(OUT, Buffer.concat([header, rootBuf, metaBuf, ...blobs]));
console.log(`\n${OUT} を書き出しました`);
console.log(`  ディレクトリ ${entries.length} エントリ / 実体 ${blobs.length} タイル / ${(statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);

// ---------------------------------------------------------------- 検証

const { FileSource } = await import("pmtiles");
const { open } = await import("node:fs/promises");
const fh = await open(OUT, "r");
const verify = new PMTiles(new FileSource({
  // FileSource は File オブジェクトを想定するため、最小限のシムで代用する
  name: OUT,
  slice: (a: number, b: number) => ({
    arrayBuffer: async () => {
      const buf = Buffer.alloc(b - a);
      await fh.read(buf, 0, b - a, a);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    },
  }),
} as never));
const vh = await verify.getHeader();
console.log(`\n検証: z${vh.minZoom}-${vh.maxZoom} / ${vh.numAddressedTiles} タイル`);
let checked = 0, ok = 0;
for (const w of wanted.filter((_, i) => i % 331 === 0)) {
  const orig = fetched.get(w.id);
  if (!orig) continue;
  const back = await verify.getZxy(w.z, w.x, w.y);
  checked++;
  if (back?.data && Buffer.from(back.data).equals(orig)) ok++;
  else console.log(`  不一致: z${w.z}/${w.x}/${w.y}`);
}
await fh.close();
console.log(`  抜き取り検査 ${ok}/${checked} 一致`);
if (ok !== checked) process.exitCode = 1;
