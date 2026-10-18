#!/usr/bin/env node
/*
 * 長尺動画を自動で作る日が来たセットを選ぶ（「長尺｜1b 自動作成の起動」用）。役割はこれだけ（動画は作らない・Issue も立てない）。
 *
 *   node maintenance/long-due.mjs        … 作る日が来たセットを1行ずつ出す（「SET<TAB>紙の発売日<TAB>暫定版|確定版」）
 *
 * 決まり
 *   ・紙の発売から LONG_FROM_DAY（既定 14）〜 LONG_UNTIL_DAY（既定 40）日のセット。
 *     ふつうは、確定版（公開データセット）を待たずに、暫定版（17Lands の毎日の集計）で作る。旬のうちに出すため
 *   ・ドラフトとシールドの両方の材料がある（report-data.mjs。確定版があれば確定版、無ければ暫定版）
 *   ・長尺がまだサイトに載っていない（data/long.json）
 *   同じセットで2回作らないための確認（Issue の題）は、呼ぶ側のワークフローでする。確定版が出たあとに作り直すことはしない
 *
 * 紙の発売日は、記事データの一覧（data/articles/index.json）・下見の一覧（data/profiles/index.json）・カード名（data/names/<SET>.json）から取る。通信はしない。
 */
import { readFile, readdir } from "node:fs/promises";
import { loadReport } from "./report-data.mjs";

const FROM = +(process.env.LONG_FROM_DAY || 14), UNTIL = +(process.env.LONG_UNTIL_DAY || 40);
const NOW = process.env.LONG_NOW ? Date.parse(process.env.LONG_NOW + "T00:00:00Z") : Date.now();   // 確認用に日付を差し替えられる
const DAY = 86400000;
const readJson = async p => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return null; } };

/* 材料のありそうなセット（記事データか暫定版のどちらかがある） */
const sets = new Set();
for(const dir of ["data/articles", "data/provisional"]){
  for(const f of await readdir(dir).catch(() => [])){ const m = f.match(/^([A-Z0-9]+)_draft\.json$/); if(m) sets.add(m[1]); }
}

/* 紙の発売日 */
const released = {};
for(const a of ((await readJson("data/articles/index.json")) || {}).articles || []) if(a.set && a.released_at && !released[a.set]) released[a.set] = a.released_at;
for(const p of ((await readJson("data/profiles/index.json")) || {}).profiles || []) if(p.set && p.released_at && !released[p.set]) released[p.set] = p.released_at;
for(const s of sets) if(!released[s]){ const n = await readJson(`data/names/${s}.json`); if(n && n.released_at) released[s] = n.released_at; }

const long = (await readJson("data/long.json")) || {};
const jstToday = Date.parse(new Date(NOW + 9 * 3600000).toISOString().slice(0, 10));
for(const set of [...sets].sort()){
  const rel = Date.parse(released[set] || "");
  if(!rel){ console.error(`${set}: 紙の発売日が分からないので飛ばす`); continue; }
  const day = Math.floor((jstToday - rel) / DAY);
  if(day < FROM || day > UNTIL){ if(day >= 0 && day < FROM) console.error(`${set}: 発売から${day}日目（${FROM}日目から）`); continue; }
  if(long[set] && long[set].ja && long[set].ja.id){ console.error(`${set}: 長尺はもうサイトに載っている`); continue; }
  const d = await loadReport(set, "draft"), s = await loadReport(set, "sealed");
  if(!d || !s){ console.error(`${set}: 発売から${day}日目だが、ドラフトとシールドの材料がそろっていない`); continue; }
  const kind = d.provisional || s.provisional ? "暫定版" : "確定版";
  console.error(`${set}: 発売から${day}日目。${kind}で作る日`);
  console.log(`${set}\t${released[set]}\t${kind}`);
}
