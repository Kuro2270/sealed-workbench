#!/usr/bin/env node
/*
 * サイト用の「速報メモ」（文章だけ）を作る。
 *
 *   node maintenance/build-early-note.mjs FRA
 *
 * 入力: data/articles/<SET>_early.json（build-early.mjs が 17Lands から作ったもの。commit はしない）
 *       data/names/<SET>.json（日本語のカード名）
 * 出力: data/early/<SET>.json … 日本語・英語の文章だけ（数字の元データは残さない）。下見ページ（build-set-profile.mjs）が読む
 *
 * 17Lands の利用ガイドラインでは、第三者サイトでのデータの掲載（別の形での可視化）は発売12日目まで控えるよう求められている一方、
 * 記事での個別の数字の引用は初日から差し支えないとされている。そこで、数字を3〜4個だけ含む文章にして載せる。表やグラフにはしない。
 * 17Lands の名前は添える（出どころの明記）が、リンクは置かない。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SET = String(process.argv[2] || "").toUpperCase();
if(!SET){ console.error("使い方: node maintenance/build-early-note.mjs <SET>"); process.exit(1); }
const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const iso = t => new Date(t).toISOString().slice(0, 10);

const d = await readJson(`data/articles/${SET}_early.json`, null);
if(!d){ console.error(`${SET}: 先行版の記事データ（data/articles/${SET}_early.json）がありません。先に build-early.mjs を実行してください。`); process.exit(1); }
const namesJa = (await readJson(`data/names/${SET}.json`, { names: {} })).names || {};

const CJ = { W: "白", U: "青", B: "黒", R: "赤", G: "緑" }, CE = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const pairName = (p, ja) => [...p].map(c => (ja ? CJ : CE)[c] || c).join(ja ? "" : "-");
const pct = v => (v * 100).toFixed(1);
const archetypes = d.archetypes || [], colors = d.colors || [], total = d.total_games || 0;
const totalPair = archetypes.reduce((n, a) => n + a.games, 0) || 1;
const pairs = archetypes.filter(a => a.colors.length === 2 && a.games >= Math.max(400, totalPair * 0.04)).sort((a, b) => b.wr - a.wr);
const best = pairs[0], second = pairs[1];
const mono = colors.slice().sort((a, b) => b.wr - a.wr)[0];
const c1 = ((d.top || {}).common || [])[0];
const monthDay = s => { const [, m, dd] = s.split("-"); return { ja: `${+m}月${+dd}日`, en: new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) }; };
const asOfDate = d.as_of || iso(Date.now());
const gamesJa = total >= 10000 ? `約${Math.round(total / 10000)}万` : total.toLocaleString("ja-JP");
const gamesEn = total >= 1000 ? `${Math.round(total / 1000)}K` : String(total);

const ja = [
  `発売直後の${gamesJa}試合（ドラフト＋シールド）では、` + (best ? `最も勝っている組み合わせは${pairName(best.colors, true)}（${pct(best.wr)}%）` : "まだ組み合わせの傾向は出ていません") + (second ? `、次いで${pairName(second.colors, true)}（${pct(second.wr)}%）。` : "。"),
  mono ? `単色では${CJ[mono.color]}が最も安定しています。` : "",
  c1 ? `コモンでは《${namesJa[c1.name] || c1.name}》の勝率が頭ひとつ抜けています。` : "",
  `順位はこの後のデータで動きます。`
].filter(Boolean).join("");
const en = [
  `Across the first ${gamesEn} games (Draft and Sealed combined), ` + (best ? `the best-performing pair is ${pairName(best.colors)} (${pct(best.wr)}%)` : "no pair has pulled ahead yet") + (second ? `, followed by ${pairName(second.colors)} (${pct(second.wr)}%).` : "."),
  mono ? ` ${CE[mono.color]} is the most reliable single colour so far.` : "",
  c1 ? ` Among commons, ${c1.name} is clearly ahead.` : "",
  ` Rankings will move as more games come in.`
].filter(Boolean).join("");

const note = { set: SET, as_of: asOfDate, as_of_label: monthDay(asOfDate), ja, en, source: "17Lands" };
await mkdir("data/early", { recursive: true });
await writeFile(`data/early/${SET}.json`, JSON.stringify(note, null, 2) + "\n", "utf8");
console.error(`${SET}: 速報メモを保存（data/early/${SET}.json）`);
console.error(`  ${ja}`);
