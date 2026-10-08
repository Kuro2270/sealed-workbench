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
 *
 * 先行版（発売直後のショート）
 * 4) 発売前後のセットで、まだ先行版の動画が無いものについて、17Lands の色別勝率を1回だけ見て、
 *    試合数が EARLY_MIN_GAMES（既定 25,000 ≒ 発売2〜3日目）を超えていれば「EARLY <SET>」を出す
 *    （workflow がそれを見て「環境まとめ動画を作る」を mode=early で起こす）。
 *    17Lands への通信は、候補セット1つにつき1日1回だけ。
 */

import { readFile } from "node:fs/promises";

const UA = "sealed-workbench/1.0 (https://sealed-workbench.com)";
const BASE = "https://17lands-public.s3.amazonaws.com/analysis_data/game_data";
const EMBARGO_DAYS = 12, MONTHS_BACK = 4, MIN_CARDS = 150;
const EARLY_MIN_GAMES = +(process.env.EARLY_MIN_GAMES || 25000), EARLY_BEFORE = 10, EARLY_AFTER = 20;   // 先行版：紙の発売の10日前〜20日後のセットを見る

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

/* ---------- 先行版 ---------- */
const videos = JSON.parse(await readFile("data/videos.json", "utf8").catch(() => "{}"));
const { readdir } = await import("node:fs/promises");
const pending = new Set((await readdir("data/videos").catch(() => [])).filter(f => /-ja-early\.json$/.test(f)).map(f => f.replace(/-ja-early\.json$/, "")));
const hasEarly = c => pending.has(c) || !!(videos[c] && videos[c].ja && videos[c].ja.early);
const eFrom = iso(now - EARLY_AFTER * 86400000), eUntil = iso(now + EARLY_BEFORE * 86400000);
const eCands = d.data
  .filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at && s.released_at >= eFrom && s.released_at <= eUntil && s.card_count > MIN_CARDS)
  .map(s => s.code.toUpperCase())
  .filter(c => !have.has(c) && !hasEarly(c));
const L17 = process.env.L17_API || "https://www.17lands.com";
for(const code of eCands){
  const start = iso(now - 40 * 86400000), end = iso(now + 86400000);
  try{
    const r = await fetch(`${L17}/color_ratings/data?expansion=${code}&event_type=PremierDraft&start_date=${start}&end_date=${end}&combine_splash=true`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if(!r.ok){ console.error(`${code}: 先行版の確認ができません（17Lands HTTP ${r.status}）`); continue; }
    const rows = await r.json();
    const all = (rows || []).find(x => x.is_summary && /^All/i.test(x.color_name || ""));
    const games = all ? +all.games || 0 : (rows || []).filter(x => !x.is_summary).reduce((n, x) => n + (+x.games || 0), 0);
    console.error(`${code}: 先行版 ${games.toLocaleString()} 試合（${games >= EARLY_MIN_GAMES ? "作れる" : `まだ。${EARLY_MIN_GAMES.toLocaleString()} 試合から`}）`);
    if(games >= EARLY_MIN_GAMES) console.log(`EARLY ${code}`);
  }catch(e){ console.error(`${code}: 先行版の確認ができません（${e.message}）`); }
}
