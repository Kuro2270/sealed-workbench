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
 * 4) 発売前後のセットで、まだ先行版の動画が無いものについて、MTGアリーナの発売から3日たったら「EARLY <SET>」を出す
 *    （workflow がそれを見て「環境まとめ動画を作る」を mode=early で起こす）。
 *    アリーナの発売日は Scryfall に無い（紙の発売日だけ）ので、17Lands の色別勝率で「3日前（日本時間）までの試合があるか」を見て決める。
 *    あれば、念のため今までの試合数が EARLY_MIN_GAMES（既定 25,000）以上あることも確かめる。
 *    17Lands への通信は、候補セット1つにつき1日1〜2回だけ。
 * 5) 速報ショートを作ったセットで、アリーナの配信から7日たったら「NOTE <SET>」を出す（速報メモを、その日の数字で1回だけ書き直す。
 *    workflow がそれを見て「速報｜サイトに速報メモを載せる」を起こす）。勝率を載せたあと（12日目から）は出さない。
 */

import { readFile } from "node:fs/promises";
import { arenaDays, gamesBetween } from "./arena-days.mjs";

const UA = "sealed-workbench/1.0 (https://sealed-workbench.com)";
const BASE = "https://17lands-public.s3.amazonaws.com/analysis_data/game_data";
const EMBARGO_DAYS = 12, MONTHS_BACK = 4, MIN_CARDS = 150;
const EARLY_MIN_GAMES = +(process.env.EARLY_MIN_GAMES || 25000), EARLY_BEFORE = 10, EARLY_AFTER = 20;   // 先行版：紙の発売の10日前〜20日後のセットを見る
const EARLY_DAYS = +(process.env.EARLY_DAYS || 3);       // 先行版：アリーナの配信から何日たったら作るか
const EARLY_NOTE_DAYS = +(process.env.EARLY_NOTE_DAYS || 7);   // 速報メモの更新：アリーナの配信から何日たったら書き直すか（速報ショートの4日後）

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

/* ---------- 先行版（速報ショート）と、速報メモの更新 ---------- */
const videos = JSON.parse(await readFile("data/videos.json", "utf8").catch(() => "{}"));
const { readdir } = await import("node:fs/promises");
const { existsSync } = await import("node:fs");
const pending = new Set((await readdir("data/videos").catch(() => [])).filter(f => /-ja-early\.json$/.test(f)).map(f => f.replace(/-ja-early\.json$/, "")));
const hasEarly = c => pending.has(c) || !!(videos[c] && videos[c].ja && videos[c].ja.early);
/* 速報メモを、配信から EARLY_NOTE_DAYS 日目の数字で一度だけ書き直すか（勝率を載せる前のセットだけ） */
const noteRound = async c => { try{ return JSON.parse(await readFile(`data/early/${c}.json`, "utf8")).round || 1; }catch(e){ return 0; } };
const hasWinRates = c => existsSync(`data/provisional/${c}_draft.json`) || existsSync(`data/articles/${c}_draft.json`);
const eFrom = iso(now - EARLY_AFTER * 86400000), eUntil = iso(now + EARLY_BEFORE * 86400000);
const eCands = d.data
  .filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at && s.released_at >= eFrom && s.released_at <= eUntil && s.card_count > MIN_CARDS)
  .map(s => s.code.toUpperCase())
  .filter(c => !have.has(c));
for(const code of eCands){
  try{
    if(!hasEarly(code)){
      // 速報ショート：アリーナの配信から EARLY_DAYS 日たったら（念のため、試合数も EARLY_MIN_GAMES 以上あること）
      if(!(await arenaDays(code, EARLY_DAYS))){ console.error(`${code}: 先行版はまだ（アリーナの配信から${EARLY_DAYS}日たっていない）`); continue; }
      await new Promise(r => setTimeout(r, 1500));
      const games = await gamesBetween(code, iso(now - 60 * 86400000), iso(now + 86400000));
      console.error(`${code}: 先行版 ${games.toLocaleString()} 試合（アリーナの配信から${EARLY_DAYS}日以上。${games >= EARLY_MIN_GAMES ? "作れる" : `まだ。${EARLY_MIN_GAMES.toLocaleString()} 試合から`}）`);
      if(games >= EARLY_MIN_GAMES) console.log(`EARLY ${code}`);
    }else if(await noteRound(code) === 1 && !hasWinRates(code)){
      // 速報メモの更新：アリーナの配信から EARLY_NOTE_DAYS 日たったら、1回だけ（文章だけ。表は 12 日目から）
      if(!(await arenaDays(code, EARLY_NOTE_DAYS))){ console.error(`${code}: 速報メモの更新はまだ（アリーナの配信から${EARLY_NOTE_DAYS}日たっていない）`); continue; }
      console.error(`${code}: 速報メモを最新の数字で書き直す日`);
      console.log(`NOTE ${code}`);
    }
  }catch(e){ console.error(`${code}: 先行版の確認ができません（${e.message}）`); }
}
