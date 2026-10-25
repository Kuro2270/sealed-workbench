/*
 * 修正版のデータ（data/trends/<SET>_draft.json）の形の版。役割はこれだけ。
 * 集計（build-trend.mjs）が書き込み、動画づくり（build-short.mjs）が確かめる。
 * データの形を変えたら数字を上げる（古い集計のまま動画を作って、中身が薄くなるのを防ぐため）。
 *   2 … レアリティごとの章（by_rarity：common / uncommon / rare）と、2色の組み合わせの使用率（share）がある形
 */
export const TREND_FORMAT = 2;
