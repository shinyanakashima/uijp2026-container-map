# 農業用コンテナシェアリング デモ

展示会・講演での実演を想定した、操作可能な地図デモです。仕様は [docs/spec.md](docs/spec.md) にあります。

**本デモのデータはすべて架空です。** 実在の組織名・施設名は用いていません。地名のみ実在の市町村名を使っています。

## 何を示すデモか

十勝管内24拠点・コンテナ4,800台について、位置・種類・稼働ステータスを一枚の地図で把握し、拠点ごとの余剰と不足を色で見分けられる状態を示します。予約・シェアの実行、紛失防止アラートは実装していません。

## 動かす

```
npm install
npm run dev
```

データと背景地図はリポジトリに同梱しているため、生成し直さなくても動きます。

## 会場でオフライン起動する

展示会場の回線は不安定であることを前提に、ネットワークなしで動く状態を作れます。

```
BASE=./ npm run build
```

`BASE=./` を付けると、生成物が相対パスになり、どの階層に置いても動きます。`dist/` の中身一式をUSBにコピーし、会場のPCで次のいずれかを実行してください。

```
npx serve dist
# または、Python が入っている端末なら
python3 -m http.server --directory dist 8000
```

ブラウザで表示されたURLを開きます。`file://` で直接開くことはできません（ブラウザがモジュールとデータの読み込みを拒否するため）。

### オフラインで動くことを確認する

Wi-Fiを切らずに、外部通信を遮断した状態で全機能を通しで確認できます。

```
npm run build
npm run check
```

第2節の90秒シナリオを順に実行し、各段階の判定と、外部ホストへの通信が一度も発生していないことを表示します。画面の記録は `check-shots/` に残ります。

会場で実機確認する場合は、上の手順で起動したうえで端末のWi-Fiを切り、次を順に操作してください。

1. 拠点が24か所表示される
2. 時間スライダーを9月25日まで動かすと、不足拠点数が5になる
3. 「過不足表示」に切り替えると、拠点が暖色と寒色に分かれる
4. 不足拠点（芽室 第1集荷拠点など）をクリックすると、候補が3本の線で結ばれる
5. 「在庫表示」に戻してズームすると、コンテナが個体の点になる

## データの持ち方

地物はGeoJSONで、それ以外は用途に合わせた形式で持っています。

| ファイル | 内容 | 形式 | 理由 |
| --- | --- | --- | --- |
| `public/data/bases.geojson` | 拠点24か所 | GeoJSON FeatureCollection（Point） | 位置が固定の地物。そのまま地図のソースになる |
| `public/data/containers.json` | コンテナ4,800台の台帳 | JSON配列 | 固有の位置を持たない属性データ |
| `public/data/daily.json.gz` | 92日分の所在とステータス | 列指向JSON（gzip） | 日×個体の時系列。GeoJSONにすると同じ座標を44万回書くことになる |

コンテナの点は、日次データの所在拠点IDから拠点座標を引いて、画面側でGeoJSONに組み立てています。表示位置は拠点の周囲に正規分布で散らしており、個体ごとの実座標は持ちません。輸送中の個体だけは拠点間の経路上の座標を持つため、日次データに疎に格納しています。

## データを作り直す

```
npm run generate
```

`public/data/` に拠点・コンテナ・92日分の日次状態を書き出します。乱数種を固定しているため、何度実行しても同じ結果になります。実行すると拠点別の在庫推移と、日付ごとの不足・余剰拠点数、完成条件の判定が標準出力に出ます。

拠点の座標・保有台数・季節パラメータは `scripts/bases.ts` にあります。座標は手で置いたものです。

## 背景地図を作り直す

```
npm run basemap          # 取得して作り直す
npm run basemap -- --dry-run   # 取得せず枚数だけ見積もる
```

地理院タイル（淡色地図・写真）から十勝域を切り出し、再圧縮して2つのPMTilesにまとめます。画面左下のボタンで「地図」と「衛星」を切り替えられます。

**この処理だけはネットワークを使います。** 一度作れば以降は不要です。

| ファイル | 元データ | 形式 |
| --- | --- | --- |
| `public/basemap/gsi-pale.pmtiles` | 地理院タイル 淡色地図 | パレットPNG |
| `public/basemap/gsi-photo.pmtiles` | 地理院タイル 写真（シームレス空中写真） | JPEG |

ズーム6〜13のうち、z13は枚数が膨らむため各拠点の周囲のみを取得しています（`Z13_RADIUS_TILES`）。範囲やズームは `scripts/build-basemap.ts` 冒頭の定数で変えられます。

## 公開

`main` へのpushで GitHub Pages に自動デプロイされます（`.github/workflows/deploy.yml`）。

**初回のみ、リポジトリ側の設定が要ります。** ワークフローのトークンでは Pages サイトを作成できないためです。

1. Settings → Pages → Build and deployment → Source を **GitHub Actions** にする
2. Settings → Actions → General → Workflow permissions が **Read and write permissions** になっていることを確認する

設定後、Actions タブから「GitHub Pages へデプロイ」を Run workflow で実行すると公開されます。以降は `main` へのpushで自動的に更新されます。

公開先は `https://shinyanakashima.github.io/uijp2026-container-map/` です。

## 構成

```
docs/spec.md              仕様書
scripts/bases.ts          拠点24か所の定義（座標は手置き）
scripts/generate-data.ts  疑似データ生成
scripts/build-basemap.ts  地理院タイルからPMTilesを作成
scripts/check-demo.mjs    オフライン動作の確認
src/                      画面
public/data/              地物データ（拠点はGeoJSON）
public/basemap/           背景地図（地図・衛星の2ファイル）
```

## 出典

背景地図は地理院タイルを加工して作成しています。

> 出典：国土地理院（地理院タイルを加工して作成）

地理院タイル一覧: https://maps.gsi.go.jp/development/ichiran.html

加工の内容は、対象範囲（十勝管内）の切り出しと、オフライン配布のための再圧縮（淡色地図はパレットPNG化、写真はJPEG再エンコード）です。
