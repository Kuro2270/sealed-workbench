#!/usr/bin/env node
/*
 * セットごとの環境レポートを作る。
 *
 *   node maintenance/build-articles.mjs
 *
 * 出力: data/articles/<SET>_<FORMAT>.json
 *
 * 数値の部分だけを自動で作る。考察は data/notes/<SET>_<FORMAT>.json に
 * 書いておけば取り込まれる（無ければ空欄のまま）。
 *
 * 考察ファイルの書き方（日本語と英語を両方書く）
 * {
 *   "summary":   { "ja": "…", "en": "…" },
 *   "archetypes":{ "ja": "…", "en": "…" },
 *   "speed":     { "ja": "…", "en": "…" },
 *   "cards":     { "ja": "…", "en": "…" }
 * }
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const RATINGS = "data/ratings";
const NOTES   = "data/notes";
const OUT_DIR = "data/articles";

const MIN_GAMES = 500;        // トップ10に載せる最低試合数
const TOP_N = 10;

async function readJson(p, fallback = null){
  try{ return JSON.parse(await readFile(p, "utf8")); }
  catch(e){ return fallback; }
}

/* レアリティごとの上位カード */
function topByRarity(cards, rarity, n = TOP_N){
  return cards
    .filter(c => c.rarity === rarity && !c.land && c.gih != null && c.games >= MIN_GAMES)
    .sort((a, b) => b.gih - a.gih)
    .slice(0, n)
    .map(c => ({
      name: c.name, cmc: c.cmc, color: c.color,
      gih: c.gih, iwd: c.iwd, games: c.games
    }));
}

/* 単色の強さ（その色を含むデッキの勝率を試合数で重みづけ） */
function colorStrength(archetypes){
  const acc = {};
  "WUBRG".split("").forEach(k => { acc[k] = { games: 0, wins: 0 }; });
  archetypes.forEach(a => {
    [...a.colors].forEach(k => {
      if(!acc[k]) return;
      acc[k].games += a.games;
      acc[k].wins  += a.wr * a.games;
    });
  });
  return Object.entries(acc)
    .filter(([, v]) => v.games > 0)
    .map(([color, v]) => ({ color, games: v.games, wr: v.wins / v.games }))
    .sort((a, b) => b.wr - a.wr);
}

/* 環境の速さを一言で表す */
function speedVerdict(speed, avgTurns, curve){
  const fast = speed.find(s => s.key === "fast");
  const slow = speed.find(s => s.key === "slower") || speed.find(s => s.key === "slow");
  let gap = null;
  if(fast && slow) gap = fast.wr - slow.wr;

  // マナ総量ごとの傾き（低マナが強いほど負）
  let tilt = null;
  const low  = curve.filter(c => c.cmc >= 1 && c.cmc <= 3);
  const high = curve.filter(c => c.cmc >= 5);
  if(low.length && high.length){
    const avg = rows => rows.reduce((n, r) => n + r.wr * r.games, 0) / rows.reduce((n, r) => n + r.games, 0);
    tilt = avg(low) - avg(high);
  }

  let key = "even";
  if(gap != null && gap >= 0.02) key = "fast";
  else if(gap != null && gap <= -0.02) key = "slow";
  else if(tilt != null && tilt >= 0.015) key = "fast";
  else if(tilt != null && tilt <= -0.015) key = "slow";

  return { key, gap, tilt, avg_turns: avgTurns };
}

async function main(){
  let files = [];
  try{ files = (await readdir(RATINGS)).filter(f => f.endsWith(".json") && f !== "index.json"); }
  catch(e){ process.stderr.write("集計データがありません。先に build-ratings を実行してください。\n"); return; }

  if(!files.length){ process.stderr.write("集計データがありません。\n"); return; }

  await mkdir(OUT_DIR, { recursive: true });
  const made = [];

  for(const f of files){
    const d = await readJson(path.join(RATINGS, f));
    if(!d || !Array.isArray(d.cards)) continue;

    const notes = await readJson(path.join(NOTES, f), {});
    const cards = d.cards;

    const article = {
      set: d.set,
      event: d.event,
      generated_at: new Date().toISOString(),
      data_generated_at: d.generated_at,
      total_games: d.total_games,
      overall_win_rate: d.overall_win_rate,
      avg_turns: d.avg_turns ?? null,

      top: {
        mythic:   topByRarity(cards, "mythic"),
        rare:     topByRarity(cards, "rare"),
        uncommon: topByRarity(cards, "uncommon"),
        common:   topByRarity(cards, "common")
      },
      colors: colorStrength(d.archetypes || []),
      archetypes: (d.archetypes || []).slice(0, 12),
      curve: d.curve || [],
      speed: d.speed || [],
      verdict: speedVerdict(d.speed || [], d.avg_turns ?? null, d.curve || []),

      // 考察。無ければ空のまま（サイト側では表示しない）
      notes: {
        summary:    notes.summary    || null,
        archetypes: notes.archetypes || null,
        speed:      notes.speed      || null,
        cards:      notes.cards      || null
      },

      source: "17Lands Public Data (CC BY 4.0)",
      source_url: "https://www.17lands.com/public_datasets"
    };

    const out = path.join(OUT_DIR, f);
    await writeFile(out, JSON.stringify(article), "utf8");
    made.push({ set: d.set, event: d.event, verdict: article.verdict.key,
                hasNotes: Object.values(article.notes).some(Boolean) });
  }

  await writeFile(path.join(OUT_DIR, "index.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), articles: made }), "utf8");

  process.stderr.write(`環境レポートを生成: ${made.length}件\n`);
  made.forEach(m => process.stderr.write(
    `  ${m.set} ${m.event}（${m.verdict}${m.hasNotes ? " / 考察あり" : ""}）\n`));
}

main().catch(e => {
  console.error("レポートの生成に失敗しました:", e.message);
  process.exit(1);
});
