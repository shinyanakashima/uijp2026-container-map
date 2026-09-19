export interface BaseInfo {
  id: string;
  name: string;
  city: string;
  capacity: number;
  lng: number;
  lat: number;
}

export interface ContainerInfo {
  id: string;
  type: string;
  homeBaseId: string;
}

export interface DailyFile {
  meta: {
    note: string;
    seed: number;
    statusLabels: string[];
    containerTypes: { id: string; label: string; share: number }[];
    imbalanceThreshold: number;
  };
  dates: string[];
  baseIds: string[];
  demand: number[][];
  containers: { id: string; base: number[]; status: number[] }[];
  transit: Record<string, Record<string, [number, number]>>;
}

/** 日ごと・拠点ごとに前計算した集計 */
export interface DayStats {
  /** [base][status] */
  statusCount: Int16Array;
  /** [base][type] */
  typeCount: Int16Array;
  /** 在席数 = 空き + 稼働中 */
  available: Int16Array;
  free: Int16Array;
  /** 過不足 = 在席数 − 当日の想定必要数 */
  imbalance: Int16Array;
  totalActive: number;
  totalFree: number;
  totalTransit: number;
  shortageBases: number;
  surplusBases: number;
}

export interface Dataset {
  bases: BaseInfo[];
  containers: ContainerInfo[];
  daily: DailyFile;
  stats: DayStats[];
  typeIndex: number[];
  typeIds: string[];
}
