#!/usr/bin/env node
/*
 * 17Lands 公開データセット（CC BY 4.0）の game data から、全勝（トロフィー）デッキを集める。
 *
 *   node maintenance/build-trophies.mjs            環境レポートがある一番新しいセット
 *   node maintenance/build-trophies.mjs EOE        セットを指定
 *   node maintenance/build-trophies.mjs EOE ECL    複数も可
 *
 * 出力: data/trophies/<SET>_draft.json（プレミア／クイック／トラディショナル・ドラフト）
 *       data/trophies/<SET>_sealed.json（シールド）
 *
 * 全勝の決め方
 *   game data にはイベントの最終成績の列が無いので、draft_id（1回のイベント）ごとに、記録された試合の勝ち数を数える。
 *   プレミア・クイック・シールド（1本先取）は7勝、トラディショナル（3本先取）はマッチ3勝で全勝（トロフィー）とみなす。
 *   17Lands に記録されなかった試合があると、全勝でも数えられないことがある（少なめに出る）。
 *   デッキは、そのイベントで一番最後に記録された試合のデッキ（途中で組み替えた人もいるため）。
 *
 * 役割はこれだけ（勝率の集計は build-ratings.mjs、画面は reports.html）。
 */

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.TROPHY_BASE || "https://17lands-public.s3.amazonaws.com/analysis_data/game_data";   // TROPHY_BASE／TROPHY_SCRY は確認用（作り物のデータを読ませる）
const SCRY = process.env.TROPHY_SCRY || "https://api.scryfall.com";
const OUT_DIR = process.env.TROPHY_OUT || "data/trophies";
const UA = "LimitedWorkbench/1.0 (https://sealed-workbench.com)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 形式ごとの全勝の条件。bo3 はマッチ（2本先取）で数える */
const FORMATS = {
  draft:  [{ event: "PremierDraft", need: 7, bo3: false }, { event: "QuickDraft", need: 7, bo3: false }, { event: "TradDraft", need: 3, bo3: true }],
  sealed: [{ event: "Sealed", need: 7, bo3: false }],
};
const SAMPLES = 8;                       // 色の組み合わせごとに残すサンプルの数
const RANK_ORDER = ["mythic", "diamond", "platinum", "gold", "silver", "bronze"];   // サンプルは上のランクを優先

/* ---------- Scryfall：土地かどうかとマナ総量 ---------- */
async function cardMeta(setCode){
  const meta = new Map();
  let url = SCRY + "/cards/search?q=" + encodeURIComponent("set:" + setCode) + "&unique=prints";
  while(url){
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if(!res.ok) break;
    const d = await res.json();
    for(const c of d.data){
      const e = { cmc: Math.floor(c.cmc ?? 0), land: (c.type_line || "").split("//")[0].includes("Land") };
      const names = [c.name];
      if(c.name.includes(" // ")) names.push(c.name.split(" // ")[0].trim());
      for(const n of names) if(!meta.has(n)) meta.set(n, e);
    }
    url = d.has_more ? d.next_page : null;
    if(url) await sleep(120);
  }
  return meta;
}
/* 基本土地は Scryfall のセット検索に出ないことがあるので、名前でも見分ける */
const BASIC = /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/;

/* ---------- CSV のヘッダー（カード名にカンマが入る） ---------- */
function parseCsvLine(line){
  const out = []; let cur = "", inQ = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(inQ){ if(ch === '"'){ if(line[i + 1] === '"'){ cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if(ch === '"') inQ = true;
    else if(ch === ","){ out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const isWin = s => s === "True" || s === "true" || s === "1";
const pairKey = s => "WUBRG".split("").filter(x => String(s || "").includes(x)).join("");

/* ---------- 1つの形式のファイルを読み、イベントごとの成績と最後のデッキをまとめる ---------- */
async function readEvents(set, fmt, meta){
  const url = `${BASE}/game_data_public.${set}.${fmt.event}.csv.gz`;
  process.stderr.write(`取得中: ${url}\n`);
  const res = await fetch(url);
  if(res.status === 403 || res.status === 404){ if(res.body) await res.body.cancel(); return null; }
  if(!res.ok) throw new Error(`ダウンロードに失敗しました（HTTP ${res.status}）`);
  const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });

  let header = null, ix = {}, cardIdx = [], cardName = [], cardLand = [];
  const events = new Map();      // draft_id → { m: {match: [勝ち, 負け]}, t, b, deck, lands, colors, splash, rank }
  let rows = 0;
  for await (const line of rl){
    if(!line) continue;
    if(!header){
      header = parseCsvLine(line);
      for(const k of ["draft_id", "draft_time", "match_number", "game_number", "game_time", "build_index", "main_colors", "splash_colors", "rank", "won"]) ix[k] = header.indexOf(k);
      if(ix.draft_id < 0 || ix.won < 0) throw new Error("draft_id／won の列が見つかりません");
      header.forEach((h, i) => {
        const m = h.match(/^deck_(.+)$/); if(!m) return;
        const name = m[1], e = meta.get(name);
        cardIdx.push(i); cardName.push(name); cardLand.push(BASIC.test(name) || !!(e && e.land));
      });
      continue;
    }
    rows++;
    const f = line.split(",");
    const id = f[ix.draft_id]; if(!id) continue;
    let ev = events.get(id);
    if(!ev){ ev = { m: {}, t: "", b: -1, deck: "", lands: 0, colors: "", splash: "", rank: "", time: f[ix.draft_time] || "" }; events.set(id, ev); }
    const mn = f[ix.match_number] || "1", won = isWin(f[ix.won]);
    const r = ev.m[mn] || (ev.m[mn] = [0, 0]);
    r[won ? 0 : 1]++;
    /* 一番最後に記録された試合のデッキを残す（時刻が同じなら build_index の大きいほう） */
    const gt = f[ix.game_time] || "", bi = +f[ix.build_index] || 0;
    if(gt > ev.t || (gt === ev.t && bi >= ev.b)){
      const parts = []; let lands = 0;
      for(let k = 0; k < cardIdx.length; k++){
        const n = +f[cardIdx[k]] || 0; if(!n) continue;
        if(cardLand[k]) lands += n; else parts.push(k + ":" + n);
      }
      ev.t = gt; ev.b = bi; ev.deck = parts.join(","); ev.lands = lands;
      ev.colors = pairKey(f[ix.main_colors]); ev.splash = pairKey(f[ix.splash_colors]); ev.rank = (f[ix.rank] || "").toLowerCase();
    }
    if(rows % 500000 === 0) process.stderr.write(`  ${rows.toLocaleString()} 行\n`);
  }
  process.stderr.write(`  ${rows.toLocaleString()} 試合・${events.size.toLocaleString()} イベント\n`);
  return { events, cardName };
}

/* ---------- イベントの成績 → 全勝かどうか ---------- */
function record(ev, fmt){
  let w = 0, l = 0;
  for(const [gw, gl] of Object.values(ev.m)){
    if(fmt.bo3){ if(gw >= 2) w++; else if(gl >= 2) l++; }
    else { if(gw) w++; else l++; }
  }
  return { wins: w, losses: l, trophy: w >= fmt.need };
}

async function buildMode(set, mode, meta){
  const by = new Map();          // 色 → { drafts, trophies, samples: [] }
  let drafts = 0, trophies = 0, read = 0;
  const events = [];
  for(const fmt of FORMATS[mode]){
    const r = await readEvents(set, fmt, meta);
    if(!r) continue;
    read++;
    for(const ev of r.events.values()){
      if(!ev.colors) continue;
      const rec = record(ev, fmt);
      drafts++;
      const g = by.get(ev.colors) || { drafts: 0, trophies: 0, samples: [] };
      by.set(ev.colors, g);
      g.drafts++;
      if(!rec.trophy) continue;
      trophies++; g.trophies++;
      g.samples.push({
        event: fmt.event, wins: rec.wins, losses: rec.losses, rank: ev.rank, splash: ev.splash, time: ev.time, lands: ev.lands,
        cards: ev.deck.split(",").filter(Boolean).map(p => { const [k, n] = p.split(":"); const name = r.cardName[+k]; return [name, +n, (meta.get(name) || {}).cmc ?? null]; })
      });
    }
  }
  if(!read) return null;
  /* サンプル：ランクの高い順 → 新しい順に SAMPLES 件。デッキが40枚に満たない（記録が欠けた）ものは除く */
  const rankOf = r => { const i = RANK_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  const colors = [...by.entries()].map(([c, g]) => ({
    colors: c, drafts: g.drafts, trophies: g.trophies,
    trophy_rate: g.drafts ? g.trophies / g.drafts : 0,
    share: trophies ? g.trophies / trophies : 0,
    samples: g.samples.filter(s => s.lands + s.cards.reduce((n, x) => n + x[1], 0) >= 40)
      .sort((a, b) => rankOf(a.rank) - rankOf(b.rank) || b.time.localeCompare(a.time)).slice(0, SAMPLES)
  })).filter(c => c.trophies > 0).sort((a, b) => b.trophies - a.trophies);
  return {
    set, mode, events: FORMATS[mode].map(f => f.event), generated_at: new Date().toISOString(),
    total_events: drafts, total_trophies: trophies,
    rule: "Premier/Quick/Sealed: 7 wins, Traditional: 3 match wins (counted from recorded games)",
    source: "17Lands Public Data (CC BY 4.0)", source_url: "https://www.17lands.com/public_datasets",
    colors
  };
}

/* 引数が無ければ、環境レポート（data/articles）がある一番新しいセット */
async function defaultSets(){
  const files = await readdir("data/articles").catch(() => []);
  const sets = [...new Set(files.map(f => f.split("_")[0]))];
  if(!sets.length) return [];
  /* 発売日の新しい順に並べるため、Scryfall のセット一覧を使う */
  const res = await fetch(SCRY + "/sets", { headers: { "User-Agent": UA } });
  const d = res.ok ? await res.json() : { data: [] };
  const rel = new Map(d.data.map(s => [s.code.toUpperCase(), s.released_at || ""]));
  return sets.sort((a, b) => (rel.get(b) || "").localeCompare(rel.get(a) || "")).slice(0, 1);
}

async function main(){
  const sets = process.argv.slice(2).map(s => s.toUpperCase());
  const targets = sets.length ? sets : await defaultSets();
  if(!targets.length){ process.stderr.write("対象のセットがありません。\n"); process.exit(1); }
  await mkdir(OUT_DIR, { recursive: true });
  let made = 0;
  for(const set of targets){
    const meta = await cardMeta(set);
    for(const mode of Object.keys(FORMATS)){
      try{
        const out = await buildMode(set, mode, meta);
        if(!out){ process.stderr.write(`見送り: ${set} ${mode}（データなし）\n`); continue; }
        const file = path.join(OUT_DIR, `${set}_${mode}.json`);
        await writeFile(file, JSON.stringify(out), "utf8");
        process.stderr.write(`完了: ${file}（${out.total_events.toLocaleString()} イベント中 全勝 ${out.total_trophies.toLocaleString()}）\n`);
        made++;
      }catch(e){ process.stderr.write(`失敗: ${set} ${mode} — ${e.message}\n`); }
    }
  }
  if(!made){ process.stderr.write("作れたファイルがありませんでした。\n"); process.exit(1); }
}
main().catch(e => { console.error("全勝デッキの集計でエラー:", e.message); process.exit(2); });
