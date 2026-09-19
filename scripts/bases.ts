// 十勝管内の拠点定義。
// 座標は各市町村の市街地・役場近傍に手で置いたもので、自動生成しない。
// demandPeak / driftWeight は疑似データの味付けパラメータであり、実測値ではない。

export type BaseClass = "crop" | "mid" | "periphery";

export interface BaseDef {
  /** 拠点ID */
  id: string;
  /** 拠点名。機能を表す名称とし、実在組織を想起させない */
  name: string;
  /** 所在市町村。実在の市町村名を用いる */
  city: string;
  lng: number;
  lat: number;
  /** 保有台数。24拠点の合計が4,800になるよう配分 */
  capacity: number;
  /** 拠点の性格。畑作中核／中間／周辺 */
  cls: BaseClass;
  /** 季節係数1.0のときの想定必要数を capacity 比で表したもの */
  demandPeak: number;
  /** 収穫期の在庫シェア変化。負は流出、正は滞留 */
  driftWeight: number;
}

export const BASES: BaseDef[] = [
  { id: "obihiro-1",     name: "帯広 第1集荷拠点",   city: "帯広市",   lng: 143.1963, lat: 42.9239, capacity: 400, cls: "crop",      demandPeak: 1.00, driftWeight: -0.40 },
  { id: "obihiro-2",     name: "帯広 西部保管拠点",   city: "帯広市",   lng: 143.1510, lat: 42.9165, capacity: 300, cls: "mid",       demandPeak: 0.55, driftWeight:  0.30 },
  { id: "obihiro-3",     name: "帯広 南部中継拠点",   city: "帯広市",   lng: 143.2100, lat: 42.8760, capacity: 220, cls: "mid",       demandPeak: 0.60, driftWeight:  0.20 },
  { id: "otofuke-1",     name: "音更 第1集荷拠点",   city: "音更町",   lng: 143.2032, lat: 42.9759, capacity: 320, cls: "crop",      demandPeak: 1.10, driftWeight: -0.45 },
  { id: "otofuke-2",     name: "音更 北部保管拠点",   city: "音更町",   lng: 143.2200, lat: 43.0330, capacity: 180, cls: "mid",       demandPeak: 0.60, driftWeight:  0.45 },
  { id: "memuro-1",      name: "芽室 第1集荷拠点",   city: "芽室町",   lng: 143.0494, lat: 42.9106, capacity: 340, cls: "crop",      demandPeak: 1.15, driftWeight: -0.50 },
  { id: "memuro-2",      name: "芽室 西部中継拠点",   city: "芽室町",   lng: 142.9800, lat: 42.8890, capacity: 200, cls: "mid",       demandPeak: 0.55, driftWeight:  0.35 },
  { id: "makubetsu-1",   name: "幕別 第1集荷拠点",   city: "幕別町",   lng: 143.3573, lat: 42.9106, capacity: 300, cls: "crop",      demandPeak: 1.05, driftWeight: -0.40 },
  { id: "makubetsu-2",   name: "幕別 札内保管拠点",   city: "幕別町",   lng: 143.2700, lat: 42.8880, capacity: 180, cls: "mid",       demandPeak: 0.55, driftWeight:  0.40 },
  { id: "shihoro",       name: "士幌 集荷拠点",      city: "士幌町",   lng: 143.2412, lat: 43.1414, capacity: 220, cls: "crop",      demandPeak: 1.10, driftWeight: -0.45 },
  { id: "kamishihoro",   name: "上士幌 集荷拠点",    city: "上士幌町", lng: 143.2896, lat: 43.2364, capacity: 160, cls: "mid",       demandPeak: 0.70, driftWeight:  0.20 },
  { id: "shikaoi",       name: "鹿追 集荷拠点",      city: "鹿追町",   lng: 142.9962, lat: 43.0803, capacity: 180, cls: "mid",       demandPeak: 0.75, driftWeight:  0.15 },
  { id: "shintoku",      name: "新得 中継拠点",      city: "新得町",   lng: 142.8367, lat: 43.0793, capacity: 140, cls: "periphery", demandPeak: 0.30, driftWeight:  1.10 },
  { id: "shimizu",       name: "清水 集荷拠点",      city: "清水町",   lng: 142.8853, lat: 43.0000, capacity: 220, cls: "mid",       demandPeak: 0.60, driftWeight:  0.15 },
  { id: "nakasatsunai",  name: "中札内 集荷拠点",    city: "中札内村", lng: 143.1350, lat: 42.7100, capacity: 200, cls: "mid",       demandPeak: 0.70, driftWeight:  0.20 },
  { id: "sarabetsu",     name: "更別 集荷拠点",      city: "更別村",   lng: 143.0472, lat: 42.6656, capacity: 160, cls: "mid",       demandPeak: 0.65, driftWeight:  0.30 },
  { id: "taiki",         name: "大樹 集荷拠点",      city: "大樹町",   lng: 143.2960, lat: 42.4886, capacity: 140, cls: "mid",       demandPeak: 0.55, driftWeight:  0.50 },
  { id: "hiroo",         name: "広尾 港湾中継拠点",  city: "広尾町",   lng: 143.3121, lat: 42.2842, capacity: 120, cls: "periphery", demandPeak: 0.25, driftWeight:  1.30 },
  { id: "ikeda",         name: "池田 集荷拠点",      city: "池田町",   lng: 143.4506, lat: 42.9247, capacity: 160, cls: "mid",       demandPeak: 0.65, driftWeight:  0.35 },
  { id: "toyokoro",      name: "豊頃 集荷拠点",      city: "豊頃町",   lng: 143.5083, lat: 42.8175, capacity: 120, cls: "mid",       demandPeak: 0.50, driftWeight:  0.60 },
  { id: "honbetsu",      name: "本別 集荷拠点",      city: "本別町",   lng: 143.6094, lat: 43.1236, capacity: 160, cls: "mid",       demandPeak: 0.60, driftWeight:  0.45 },
  { id: "ashoro",        name: "足寄 集荷拠点",      city: "足寄町",   lng: 143.5500, lat: 43.2436, capacity: 140, cls: "periphery", demandPeak: 0.35, driftWeight:  1.00 },
  { id: "rikubetsu",     name: "陸別 保管拠点",      city: "陸別町",   lng: 143.7383, lat: 43.4650, capacity: 100, cls: "periphery", demandPeak: 0.20, driftWeight:  1.40 },
  { id: "urahoro",       name: "浦幌 集荷拠点",      city: "浦幌町",   lng: 143.6547, lat: 42.8047, capacity: 140, cls: "mid",       demandPeak: 0.55, driftWeight:  0.55 },
];
