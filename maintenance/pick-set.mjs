#!/usr/bin/env node
/*
 * 「どのセットの動画を作るか」を自動で決める（Actions の入力を空にしたとき用）。
 *
 *   node maintenance/pick-set.mjs early     … 先行版：発売前後（紙の発売の20日前〜14日後）で、先行版の動画がまだ無い、いちばん新しいセット
 *   node maintenance/pick-set.mjs legacy    … 旧版（本編ショート）：記事データ（data/articles）がある、いちばん新しいセット
 *   node maintenance/pick-set.mjs long      … 長尺：記事データ（確定版か暫定版）があって、長尺（data/long.json）がまだ無い、いちばん新しいセット
 *   node maintenance/pick-set.mjs early-note … 速報メモ：発売前後で、速報メモ（data/early）がまだ無い、いちばん新しいセット
 *
 * 決まればセットコードを標準出力に1行出す。決まらなければ何も出さずに終了コード 2。
 * 通信は Scryfall のセット一覧 1 回だけ（early のとき）。
 */

import { readFile, readdir } from "node:fs/promises";

const KIND = String(process.argv[2] || "early").toLowerCase();
const UA = "sealed-workbench/1.0 (https://sealed-workbench.com)";
const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const iso = t => new Date(t).toISOString().slice(0, 10);

const idx = await readJson("data/articles/index.json", { articles: [] });
const byRelease = {};
for(const a of idx.articles || []) if(a.set && !byRelease[a.set]) byRelease[a.set] = a.released_at || "";
const articleSets = Object.entries(byRelease).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).map(([c]) => c.toUpperCase());

let pick = null, why = "";
if(KIND === "early" || KIND === "early-note"){
  const videos = await readJson("data/videos.json", {});
  const pending = new Set((await readdir("data/videos").catch(() => [])).filter(f => /-(ja|en)-early\.json$/.test(f)).map(f => f.replace(/-(ja|en)-early\.json$/, "")));
  const { existsSync } = await import("node:fs");
  const hasEarly = KIND === "early-note"
    ? c => existsSync(`data/early/${c}.json`)
    : c => pending.has(c) || !!(videos[c] && Object.values(videos[c]).some(l => l && l.early && l.early.id));
  const r = await fetch("https://api.scryfall.com/sets", { headers: { "User-Agent": UA, Accept: "application/json" } });
  if(!r.ok){ console.error(`Scryfall HTTP ${r.status}`); process.exit(1); }
  const now = Date.now(), from = iso(now - 20 * 86400000), to = iso(now + 14 * 86400000);
  const sets = (await r.json()).data
    .filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at && s.released_at >= from && s.released_at <= to && s.card_count > 150)
    .sort((a, b) => b.released_at.localeCompare(a.released_at));
  for(const s of sets){
    const c = s.code.toUpperCase();
    if(hasEarly(c)){ console.error(`${c}: ${KIND === "early-note" ? "速報メモ" : "速報の動画"}はもう作ってあるので飛ばす`); continue; }
    pick = c; why = `${s.name}（発売 ${s.released_at}）の${KIND === "early-note" ? "速報メモ" : "速報の動画"}がまだ無い`; break;
  }
  if(!pick) why = `発売前後のセットで、${KIND === "early-note" ? "速報メモ" : "速報の動画"}がまだ無いものはありません`;
}else if(KIND === "legacy"){
  pick = articleSets[0] || null; why = pick ? `記事データがある、いちばん新しいセット` : "記事データのあるセットがありません";
}else if(KIND === "long"){
  const long = await readJson("data/long.json", {});
  // 暫定版（data/provisional）しか無いセットも候補にする。発売日は下見の一覧から
  const rel = { ...byRelease };
  for(const p of (await readJson("data/profiles/index.json", { profiles: [] })).profiles || []) if(p.set && p.released_at && !rel[p.set]) rel[p.set] = p.released_at;
  const prov = (await readdir("data/provisional").catch(() => [])).map(f => (f.match(/^([A-Z0-9]+)_draft\.json$/) || [])[1]).filter(Boolean);
  const cands = [...new Set([...articleSets, ...prov])].sort((a, b) => String(rel[b] || "").localeCompare(String(rel[a] || "")));
  pick = cands.find(c => !(long[c] && long[c].ja && long[c].ja.id)) || null;
  why = pick ? `記事データ（確定版か暫定版）があって、長尺がまだ無い、いちばん新しいセット` : "長尺がまだ無いセットはありません";
}else{ console.error("使い方: node maintenance/pick-set.mjs early|early-note|legacy|long"); process.exit(1); }

if(!pick){ console.error(`自動では決められませんでした：${why}。セットコードを入れて実行してください。`); process.exit(2); }
console.error(`セットを自動で選びました: ${pick}（${why}）`);
console.log(pick);
