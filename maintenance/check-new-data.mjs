#!/usr/bin/env node
/*
 * 新しいセットの勝率データが 17Lands に出たかを軽く調べる（毎日の点検用）。
 *
 *   node maintenance/check-new-data.mjs
 *
 * 1) Scryfall のセット一覧から、発売（紙）から12日以上経っていて、まだ環境レポートが無いセットを拾う
 * 2) そのセットの PremierDraft のデータファイルが 17Lands にあるか HEAD で確かめる
 * 3) あれば標準出力にセットコードを1行ずつ出す（workflow がそれを見て「勝率データ集計」を起こす）
 *
 * 通信は Scryfall 1回と HEAD 数回だけ。ダウンロードはしない。
 */

import { readFile } from "node:fs/promises";

const UA = "sealed-workbench/1.0 (https://sealed-workbench.com)";
const BASE = "https://17lands-public.s3.amazonaws.com/analysis_data/game_data";
const EMBARGO_DAYS = 12, MONTHS_BACK = 4, MIN_CARDS = 150;

const have = new Set();
try{
  const idx = JSON.parse(await readFile("data/articles/index.json", "utf8"));
  for(const a of idx.articles || []) have.add(String(a.set).toUpperCase());
}catch(e){}

const res = await fetch("https://api.scryfall.com/sets", { headers: { "User-Agent": UA, Accept: "application/json" } });
if(!res.ok){ console.error(`Scryfall からセット一覧を取得できませんでした（HTTP ${res.status}）`); process.exit(1); }
const d = await res.json();
const now = Date.now(), iso = t => new Date(t).toISOString().slice(0, 10);
const from = iso(now - MONTHS_BACK * 30 * 86400000), until = iso(now - EMBARGO_DAYS * 86400000);
const cands = d.data
  .filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at && s.released_at <= until && s.released_at >= from && s.card_count > MIN_CARDS)
  .map(s => s.code.toUpperCase())
  .filter(c => !have.has(c));

const ready = [];
for(const code of cands){
  const url = `${BASE}/game_data_public.${code}.PremierDraft.csv.gz`;
  try{
    const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
    console.error(`${code}: ${r.ok ? "データあり" : `まだ（HTTP ${r.status}）`}`);
    if(r.ok) ready.push(code);
  }catch(e){ console.error(`${code}: 確認できず（${e.message}）`); }
}
console.error(ready.length ? `集計できる新セット: ${ready.join(" ")}` : "新しいデータはありません。");
for(const c of ready) console.log(c);
