import type { BaseInfo, ContainerInfo, DailyFile, DayStats, Dataset } from "./types.ts";

const BASE_URL = import.meta.env.BASE_URL;

/**
 * gzip を手で展開する。GitHub Pages は .gz を application/gzip として返すため
 * fetch の自動展開が効かない。配信側が Content-Encoding を付ける場合に備えて
 * マジックナンバーを見てから判断する。
 */
async function loadMaybeGzip(path: string): Promise<string> {
  const res = await fetch(BASE_URL + path);
  if (!res.ok) throw new Error(`${path} の読み込みに失敗しました (${res.status})`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

const ST_ACTIVE = 0, ST_FREE = 1;

function computeStats(daily: DailyFile, typeIndex: number[], nTypes: number): DayStats[] {
  const nBases = daily.baseIds.length;
  const nDays = daily.dates.length;
  const out: DayStats[] = [];

  for (let t = 0; t < nDays; t++) {
    const statusCount = new Int16Array(nBases * 4);
    const typeCount = new Int16Array(nBases * nTypes);
    let totalTransit = 0;

    for (let i = 0; i < daily.containers.length; i++) {
      const c = daily.containers[i];
      const b = c.base[t];
      const st = c.status[t];
      if (b < 0) { totalTransit++; continue; }
      statusCount[b * 4 + st]++;
      typeCount[b * nTypes + typeIndex[i]]++;
    }

    const available = new Int16Array(nBases);
    const free = new Int16Array(nBases);
    const imbalance = new Int16Array(nBases);
    let totalActive = 0, totalFree = 0, shortageBases = 0, surplusBases = 0;
    const th = daily.meta.imbalanceThreshold;

    for (let b = 0; b < nBases; b++) {
      const active = statusCount[b * 4 + ST_ACTIVE];
      const fr = statusCount[b * 4 + ST_FREE];
      available[b] = active + fr;
      free[b] = fr;
      imbalance[b] = available[b] - daily.demand[b][t];
      totalActive += active;
      totalFree += fr;
      if (imbalance[b] <= -th) shortageBases++;
      else if (imbalance[b] >= th) surplusBases++;
    }

    out.push({ statusCount, typeCount, available, free, imbalance,
               totalActive, totalFree, totalTransit, shortageBases, surplusBases });
  }
  return out;
}

export async function loadDataset(): Promise<Dataset> {
  const [geoText, containersText, dailyText] = await Promise.all([
    loadMaybeGzip("data/bases.geojson"),
    loadMaybeGzip("data/containers.json"),
    loadMaybeGzip("data/daily.json.gz"),
  ]);

  const geo = JSON.parse(geoText) as {
    features: { geometry: { coordinates: [number, number] };
                properties: { id: string; name: string; city: string; capacity: number } }[];
  };
  const bases: BaseInfo[] = geo.features.map((f) => ({
    ...f.properties,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

  const containers = JSON.parse(containersText) as ContainerInfo[];
  const daily = JSON.parse(dailyText) as DailyFile;

  const typeIds = daily.meta.containerTypes.map((t) => t.id);
  const byId = new Map(containers.map((c) => [c.id, c]));
  const typeIndex = daily.containers.map((c) => typeIds.indexOf(byId.get(c.id)!.type));

  const stats = computeStats(daily, typeIndex, typeIds.length);
  return { bases, containers, daily, stats, typeIndex, typeIds };
}

/** 2点間の直線距離（km）。十勝程度の範囲なら平面近似で足りる */
export function distanceKm(a: BaseInfo, b: BaseInfo): number {
  const latMid = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lng - b.lng) * 111.32 * Math.cos(latMid);
  const dy = (a.lat - b.lat) * 110.57;
  return Math.sqrt(dx * dx + dy * dy);
}

export function formatDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}月${Number(d)}日`;
}
