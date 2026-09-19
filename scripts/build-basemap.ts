// 背景地図を単一のPMTilesとして切り出す。
// 地理院タイル（淡色地図・写真）から対象範囲・ズームのタイルだけを取得し、
// 再圧縮したうえで PMTiles v3 として詰め直す。
// 会場で外部タイルサーバーを参照しないための前処理であり、一度だけ実行する。
//
// 実行: node scripts/build-basemap.ts
//       node scripts/build-basemap.ts --dry-run   取得せずに枚数だけ見積もる
//
// 出典：国土地理院（地理院タイルを加工して作成）
// https://maps.gsi.go.jp/development/ichiran.html

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { PMTiles, zxyToTileId } from "pmtiles";
import { BASES } from "./bases.ts";

// ---------------------------------------------------------------- 取得する範囲

/** docs/spec.md 第3.1節の対象範囲に、端が欠けないよう余白を足したもの */
const NEAR = { minLng: 142.4, maxLng: 144.3, minLat: 42.2, maxLat: 43.6 };
/**
 * 低ズームでは画面が対象範囲より広くなるため、こちらで埋める。
 * 256pxのラスタタイルは画面ズームより1段深いタイルが要求されるため、
 * z10までを広域で持たないと初期表示の左右が欠ける。
 */
const WIDE = { minLng: 141.4, maxLng: 145.1, minLat: 41.6, maxLat: 44.2 };

const MIN_ZOOM = 6, MAX_ZOOM = 13;
/** このズームまでは広域（WIDE）で取る */
const WIDE_UNTIL_ZOOM = 10;
/** z13は全域だと枚数が膨らむため、各拠点の周囲だけに絞る（前後この枚数ぶん） */
const Z13_RADIUS_TILES = 3;

const CONCURRENCY = 6;

interface LayerDef {
  id: string;
  label: string;
  out: string;
  /** PMTiles のタイル種別。2=PNG、3=JPEG */
  tileType: number;
  url: (z: number, x: number, y: number) => string;
  recompress: (buf: Buffer) => Promise<Buffer>;
}

const LAYERS: LayerDef[] = [
  {
    id: "pale",
    label: "淡色地図",
    out: "public/basemap/gsi-pale.pmtiles",
    tileType: 2,
    url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`,
    // 淡色地図は色数が少ない。線と文字を潰さないようパレットPNGに落とす
    recompress: (b) => sharp(b).png({ palette: true, colours: 96, effort: 9 }).toBuffer(),
  },
  {
    id: "photo",
    label: "写真",
    out: "public/basemap/gsi-photo.pmtiles",
    tileType: 3,
    url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`,
    recompress: (b) => sharp(b).jpeg({ quality: 62, mozjpeg: true }).toBuffer(),
  },
];

// ---------------------------------------------------------------- タイル座標

const lngToX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

interface Want { z: number; x: number; y: number; id: number; }

function planTiles(): Want[] {
  const keys = new Set<string>();
  const out: Want[] = [];
  const add = (z: number, x: number, y: number) => {
    const k = `${z}/${x}/${y}`;
    if (keys.has(k)) return;
    keys.add(k);
    out.push({ z, x, y, id: zxyToTileId(z, x, y) });
  };

  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    if (z === MAX_ZOOM) {
      // 拠点の周囲だけ。俯瞰から寄ったときに背景が欠けない範囲に留める
      for (const b of BASES) {
        const bx = lngToX(b.lng, z), by = latToY(b.lat, z);
        for (let dx = -Z13_RADIUS_TILES; dx <= Z13_RADIUS_TILES; dx++) {
          for (let dy = -Z13_RADIUS_TILES; dy <= Z13_RADIUS_TILES; dy++) add(z, bx + dx, by + dy);
        }
      }
      continue;
    }
    const box = z <= WIDE_UNTIL_ZOOM ? WIDE : NEAR;
    const x0 = lngToX(box.minLng, z), x1 = lngToX(box.maxLng, z);
    const y0 = latToY(box.maxLat, z), y1 = latToY(box.minLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) add(z, x, y);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

// ---------------------------------------------------------------- PMTiles 書き出し

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

interface HeaderFields {
  tileType: number;
  rootOffset: number; rootLength: number;
  metaOffset: number; metaLength: number;
  leafOffset: number;
  dataOffset: number; dataLength: number;
  addressed: number; entries: number; contents: number;
}

function buildHeader(f: HeaderFields): Buffer {
  const b = Buffer.alloc(127);
  b.write("PMTiles", 0, "ascii");
  b.writeUInt8(3, 7);
  const u64 = (v: number, o: number) => b.writeBigUInt64LE(BigInt(v), o);
  u64(f.rootOffset, 8);   u64(f.rootLength, 16);
  u64(f.metaOffset, 24);  u64(f.metaLength, 32);
  u64(f.leafOffset, 40);  u64(0, 48);
  u64(f.dataOffset, 56);  u64(f.dataLength, 64);
  u64(f.addressed, 72);   u64(f.entries, 80);  u64(f.contents, 88);
  b.writeUInt8(1, 96);          // クラスタ済み
  b.writeUInt8(2, 97);          // ディレクトリの圧縮 = gzip
  b.writeUInt8(1, 98);          // タイルの圧縮 = なし（PNG/JPEGは自前で圧縮済み）
  b.writeUInt8(f.tileType, 99);
  b.writeUInt8(MIN_ZOOM, 100);
  b.writeUInt8(MAX_ZOOM, 101);
  const e7 = (v: number, o: number) => b.writeInt32LE(Math.round(v * 1e7), o);
  e7(WIDE.minLng, 102); e7(WIDE.minLat, 106); e7(WIDE.maxLng, 110); e7(WIDE.maxLat, 114);
  b.writeUInt8(9, 118);
  e7((NEAR.minLng + NEAR.maxLng) / 2, 119);
  e7((NEAR.minLat + NEAR.maxLat) / 2, 123);
  return b;
}

// ---------------------------------------------------------------- 本体

const wanted = planTiles();
const byZoom = new Map<number, number>();
for (const w of wanted) byZoom.set(w.z, (byZoom.get(w.z) ?? 0) + 1);
console.log("取得するタイル枚数");
for (const [z, n] of [...byZoom].sort((a, b) => a[0] - b[0])) {
  console.log(`  z${z}: ${String(n).padStart(5)} 枚${z === MAX_ZOOM ? "（拠点周辺のみ）" : ""}`);
}
console.log(`  合計 ${wanted.length} 枚 × ${LAYERS.length} レイヤ = ${wanted.length * LAYERS.length} リクエスト`);

if (process.argv.includes("--dry-run")) process.exit(0);

mkdirSync("public/basemap", { recursive: true });

for (const layer of LAYERS) {
  console.log(`\n=== ${layer.label} ===`);
  const fetched = new Map<number, Buffer>();
  let done = 0, missing = 0, rawBytes = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= wanted.length) return;
      const w = wanted[i];
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(layer.url(w.z, w.x, w.y));
          if (res.status === 404) { missing++; break; }
          if (!res.ok) throw new Error(String(res.status));
          const raw = Buffer.from(await res.arrayBuffer());
          rawBytes += raw.length;
          fetched.set(w.id, await layer.recompress(raw));
          break;
        } catch {
          if (attempt === 3) missing++;
          else await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
      }
      if (++done % 250 === 0) console.log(`  ${done}/${wanted.length} 取得`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`  取得 ${fetched.size} 枚（欠け ${missing} 枚）`);

  const blobs: Buffer[] = [];
  const seen = new Map<string, { offset: number; length: number }>();
  const entries: Entry[] = [];
  let dataLen = 0;

  for (const w of wanted) {
    const tile = fetched.get(w.id);
    if (!tile) continue;
    const hash = tile.toString("base64");
    let pos = seen.get(hash);
    if (!pos) {
      pos = { offset: dataLen, length: tile.length };
      seen.set(hash, pos);
      blobs.push(tile);
      dataLen += tile.length;
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
    name: `十勝 背景地図（${layer.label}）`,
    description: "展示デモ用。地理院タイルから十勝域を切り出し、再圧縮したもの",
    attribution: "出典：国土地理院（地理院タイルを加工して作成）",
  })), { level: 9 });

  const rootBuf = serializeDirectory(entries);
  const rootOffset = 127;
  const metaOffset = rootOffset + rootBuf.length;
  const leafOffset = metaOffset + metaBuf.length;

  const header = buildHeader({
    tileType: layer.tileType,
    rootOffset, rootLength: rootBuf.length,
    metaOffset, metaLength: metaBuf.length,
    leafOffset,
    dataOffset: leafOffset, dataLength: dataLen,
    addressed: entries.reduce((a, e) => a + e.runLength, 0),
    entries: entries.length,
    contents: blobs.length,
  });

  writeFileSync(layer.out, Buffer.concat([header, rootBuf, metaBuf, ...blobs]));
  const size = statSync(layer.out).size;
  console.log(`  ${layer.out}`);
  console.log(`    ${entries.length} エントリ / 実体 ${blobs.length} 枚`);
  console.log(`    元 ${(rawBytes / 1024 / 1024).toFixed(1)} MB -> ${(size / 1024 / 1024).toFixed(2)} MB`);

  // 書き出したものを読み戻し、元のタイルと一致するか抜き取りで確かめる
  const { FileSource } = await import("pmtiles");
  const { open } = await import("node:fs/promises");
  const fh = await open(layer.out, "r");
  const verify = new PMTiles(new FileSource({
    name: layer.out,
    slice: (a: number, b: number) => ({
      arrayBuffer: async () => {
        const buf = Buffer.alloc(b - a);
        await fh.read(buf, 0, b - a, a);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
      },
    }),
  } as never));
  let checked = 0, ok = 0;
  for (const w of wanted.filter((_, i) => i % 191 === 0)) {
    const orig = fetched.get(w.id);
    if (!orig) continue;
    const back = await verify.getZxy(w.z, w.x, w.y);
    checked++;
    if (back?.data && Buffer.from(back.data).equals(orig)) ok++;
    else console.log(`    不一致: z${w.z}/${w.x}/${w.y}`);
  }
  await fh.close();
  console.log(`    抜き取り検査 ${ok}/${checked} 一致`);
  if (ok !== checked) process.exitCode = 1;
}
