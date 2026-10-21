#!/usr/bin/env node
/*
 * セットごとの環境レポートを作る。
 *
 *   node maintenance/build-articles.mjs
 *
 * 出力: data/articles/<SET>_<MODE>.json（記事用）
 *       data/ratings/<SET>_<MODE>.json（カード全件・勝率一覧用）
 *
 * 数値の部分だけを自動で作る。考察は data/notes/<SET>_<FORMAT>.json に
 * 書いておけば取り込まれる（無ければ空欄のまま）。<MODE> は sealed / draft。
 *
 * 考察ファイルの書き方（日本語と英語を両方書く）
 * {
 *   "summary":   { "ja": "…", "en": "…" },
 *   "archetypes":{ "ja": "…", "en": "…" },
 *   "speed":     { "ja": "…", "en": "…" },
 *   "cards":     { "ja": "…", "en": "…" }
 * }
 */

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { cardTiers } from "./card-tier.mjs";
import { readAllEventRatings } from "./ratings-files.mjs";

const RATINGS = "data/ratings";
const NOTES   = "data/notes";
const OUT_DIR = "data/articles";

const MIN_GAMES = 500;        // トップ10に載せる最低試合数
const COMPARE_SETS = 8;       // 環境の速さを比べる対象（発売の新しい順）

// 形式のまとめ方。試合数で重みづけして1つにする。
const MODES = {
  sealed: ["Sealed", "TradSealed"],
  draft:  ["PremierDraft", "TradDraft", "PickTwoDraft"]
};
const TOP_N = 10;

async function readJson(p, fallback = null){
  try{ return JSON.parse(await readFile(p, "utf8")); }
  catch(e){ return fallback; }
}


/* ---------- 複数の形式を試合数で重みづけして1つにまとめる ---------- */
function mergeSources(list){
  const total = list.reduce((n, d) => n + (d.total_games || 0), 0);
  if(!total) return null;

  const wavg = (get) => {
    let g = 0, w = 0;
    list.forEach(d => {
      const v = get(d);
      if(v == null) return;
      g += d.total_games; w += v * d.total_games;
    });
    return g ? w / g : null;
  };

  // カードは名前ごとに試合数で重みづけ
  const byName = new Map();
  list.forEach(d => (d.cards || []).forEach(c => {
    if(!byName.has(c.name)) byName.set(c.name, {
      name: c.name, cmc: c.cmc, rarity: c.rarity, color: c.color, land: c.land,
      gihG: 0, gihW: 0, iwdG: 0, iwdW: 0, gpG: 0, gpW: 0, pair: {}
    });
    const e = byName.get(c.name);
    if(c.gih != null && c.games){ e.gihG += c.games; e.gihW += c.gih * c.games; }
    // 2色のデッキごとの勝率も試合数で重みづけして統合する
    Object.entries(c.by_pair || {}).forEach(([k, v]) => {
      if(!Array.isArray(v)) return;
      if(!e.pair[k]) e.pair[k] = { g: 0, w: 0 };
      e.pair[k].g += v[1]; e.pair[k].w += v[0] * v[1];
    });
    if(c.iwd != null && c.games){ e.iwdG += c.games; e.iwdW += c.iwd * c.games; }
    if(c.gp  != null && c.gp_games){ e.gpG += c.gp_games; e.gpW += c.gp * c.gp_games; }
    if(c.cmc != null && e.cmc == null) e.cmc = c.cmc;
    if(c.rarity && !e.rarity) e.rarity = c.rarity;
    if(c.color && !e.color) e.color = c.color;
    if(c.land) e.land = true;
  }));
  const cards = [...byName.values()].map(e => ({
    name: e.name, cmc: e.cmc, rarity: e.rarity, color: e.color, land: !!e.land,
    gih: e.gihG ? e.gihW / e.gihG : null,
    iwd: e.iwdG ? e.iwdW / e.iwdG : null,
    gp:  e.gpG  ? e.gpW  / e.gpG  : null,
    games: e.gihG, gp_games: e.gpG,
    by_pair: Object.fromEntries(Object.entries(e.pair).filter(([, v]) => v.g >= 200).map(([k, v]) => [k, [Math.round(v.w / v.g * 10000) / 10000, v.g]]))
  })).sort((a, b) => (b.gih ?? -1) - (a.gih ?? -1));

  // 色の組み合わせ
  const arche = new Map();
  list.forEach(d => (d.archetypes || []).forEach(a => {
    if(!arche.has(a.colors)) arche.set(a.colors, { g: 0, w: 0 });
    const e = arche.get(a.colors); e.g += a.games; e.w += a.wr * a.games;
  }));
  const archetypes = [...arche.entries()]
    .map(([colors, v]) => ({ colors, games: v.g, wr: v.w / v.g }))
    .sort((a, b) => b.wr - a.wr);

  // マナ総量
  const cv = new Map();
  list.forEach(d => (d.curve || []).forEach(c => {
    if(!cv.has(c.cmc)) cv.set(c.cmc, { cards: 0, games: 0, wins: 0 });
    const e = cv.get(c.cmc);
    e.cards = Math.max(e.cards, c.cards); e.games += c.games; e.wins += c.wr * c.games;
  }));
  const curve = [...cv.entries()].sort((a, b) => a[0] - b[0])
    .map(([cmc, e]) => ({ cmc, cards: e.cards, games: e.games, wr: e.games ? e.wins / e.games : null }));

  // デッキの速さ
  const sp = new Map();
  list.forEach(d => (d.speed || []).forEach(r => {
    if(!sp.has(r.key)) sp.set(r.key, { max: r.max, g: 0, w: 0 });
    const e = sp.get(r.key); e.g += r.games; e.w += r.wr * r.games;
  }));
  const order = ["fast", "mid", "slow", "slower"];
  const speed = order.filter(k => sp.has(k))
    .map(k => ({ key: k, max: sp.get(k).max, games: sp.get(k).g, wr: sp.get(k).w / sp.get(k).g }));

  return {
    events: list.map(d => ({ event: d.event, games: d.total_games })),
    total_games: total,
    overall_win_rate: wavg(d => d.overall_win_rate),
    avg_turns: wavg(d => d.avg_turns),
    generated_at: list.map(d => d.generated_at).sort().pop(),
    cards, archetypes, curve, speed
  };
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
/* 記事に載せる色の組み合わせ。試合数が少なすぎるもの（300 試合未満・全体の 0.2% 未満）は除く。
   2色の組み合わせは全部残す（勝率順の上位12件だけにすると、3色が多い環境（FRA など）で弱い2色が落ちて、
   「一番勝ちにくい組み合わせ」や使用率の平均が狂うため。2026年10月に修正）。
   1色・3色以上は、これまでどおり勝率順の上位12件に入ったものだけ */
function keepArchetypes(archetypes, totalGames){
  const ok = archetypes.filter(a => a.games >= Math.max(300, Math.floor(totalGames * 0.002)));
  const top = new Set(ok.slice(0, 12));
  return ok.filter(a => a.colors.length === 2 || top.has(a));
}

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

  // 帯が軽い順（または重い順）にきれいに並んでいるか（単調なら、差が小さくても傾向として読む）
  const bands = ["fast", "mid", "slow", "slower"].map(k => speed.find(s => s.key === k)).filter(s => s && s.wr != null);
  const monoFast = bands.length >= 3 && bands.every((b, i) => i === 0 || b.wr <= bands[i - 1].wr);
  const monoSlow = bands.length >= 3 && bands.every((b, i) => i === 0 || b.wr >= bands[i - 1].wr);

  let key = "even";
  if(gap != null && gap >= 0.02) key = "fast";
  else if(gap != null && gap <= -0.02) key = "slow";
  else if(tilt != null && tilt >= 0.015) key = "fast";
  else if(tilt != null && tilt <= -0.015) key = "slow";
  else if(gap != null && gap >= 0.01 && monoFast) key = "lean-fast";     // 1〜2pt で軽い順に並ぶ → やや速い
  else if(gap != null && gap <= -0.01 && monoSlow) key = "lean-slow";
  else if(tilt != null && tilt >= 0.008 && monoFast) key = "lean-fast";
  else if(tilt != null && tilt <= -0.008 && monoSlow) key = "lean-slow";

  return { key, gap, tilt, avg_turns: avgTurns };
}

async function main(){
  // セットごとに、形式別（イベントごと）の集計を読み込む。置き場所は ratings-files.mjs が決める（data/ratings/events/）
  const inputs = await readAllEventRatings();
  if(!inputs.length){ process.stderr.write("集計データがありません。先に build-ratings を実行してください。\n"); return; }
  const bySet = new Map();
  for(const d of inputs){
    if(!bySet.has(d.set)) bySet.set(d.set, []);
    bySet.get(d.set).push(d);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const made = [];

  for(const [set, sources] of bySet){
    for(const [mode, events] of Object.entries(MODES)){
      const list = sources.filter(d => events.includes(d.event));
      if(!list.length) continue;

      const m = mergeSources(list);
      if(!m) continue;

      const notes = await readJson(path.join(NOTES, `${set}_${mode}.json`), {});
      const cards = m.cards;

      const article = {
        set, mode,
        events: m.events,
        generated_at: new Date().toISOString(),
        data_generated_at: m.generated_at,
        total_games: m.total_games,
        overall_win_rate: m.overall_win_rate,
        avg_turns: m.avg_turns,

        top: {
          mythic:   topByRarity(cards, "mythic"),
          rare:     topByRarity(cards, "rare"),
          uncommon: topByRarity(cards, "uncommon"),
          common:   topByRarity(cards, "common")
        },
        colors: colorStrength(m.archetypes),
        archetypes: keepArchetypes(m.archetypes, m.total_games),
        curve: m.curve,
        speed: m.speed,
        verdict: speedVerdict(m.speed, m.avg_turns, m.curve),
        tiers: cardTiers(cards, MIN_GAMES),        // カードのティア表（神話レア・レア／アンコモン／コモン）

        notes: {
          summary:    notes.summary    || null,
          archetypes: notes.archetypes || null,
          speed:      notes.speed      || null,
          cards:      notes.cards      || null
        },

        source: "17Lands Public Data (CC BY 4.0)",
        source_url: "https://www.17lands.com/public_datasets"
      };

      await writeFile(path.join(OUT_DIR, `${set}_${mode}.json`), JSON.stringify(article), "utf8");

      // カード全件（勝率一覧が読む）。記事側と分けて、記事ファイルの肥大化を避ける。
      await writeFile(path.join(RATINGS, `${set}_${mode}.json`), JSON.stringify({
        set, mode,
        events: m.events,
        generated_at: article.generated_at,
        data_generated_at: m.generated_at,
        total_games: m.total_games,
        overall_win_rate: m.overall_win_rate,
        count: cards.length,
        cards,
        source: "17Lands Public Data (CC BY 4.0)",
        source_url: "https://www.17lands.com/public_datasets"
      }), "utf8");

      made.push({
        set, mode,
        released_at: list.map(d => d.released_at).find(Boolean) || null,
        total_games: m.total_games,
        avg_turns: m.avg_turns,
        verdict: article.verdict.key,
        hasNotes: Object.values(article.notes).some(Boolean)
      });
    }
  }

  // 環境の速さの比較（発売の新しい順に COMPARE_SETS セットまで。各セットを等しく扱う）
  const speedIndex = { sealed: [], draft: [] };
  made.forEach(m => {
    if(m.avg_turns == null) return;
    speedIndex[m.mode].push({
      set: m.set, avg_turns: m.avg_turns, games: m.total_games,
      released_at: m.released_at || ""
    });
  });
  Object.keys(speedIndex).forEach(k => {
    const recent = speedIndex[k]
      .sort((a, b) => (b.released_at || "").localeCompare(a.released_at || ""))
      .slice(0, COMPARE_SETS);
    speedIndex[k] = {
      average: recent.length ? recent.reduce((n, r) => n + r.avg_turns, 0) / recent.length : null,
      count: recent.length,
      sets: recent.sort((a, b) => a.avg_turns - b.avg_turns)
    };
  });

  await writeFile(path.join(OUT_DIR, "index.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    articles: made.map(m => ({ set: m.set, mode: m.mode, total_games: m.total_games, released_at: m.released_at || null })),
    speed: speedIndex
  }), "utf8");

  await removeCaseTwins(OUT_DIR, made.map(m => `${m.set}_${m.mode}.json`));

  process.stderr.write(`環境レポートを生成: ${made.length}件\n`);
  made.forEach(m => process.stderr.write(
    `  ${m.set} ${m.mode}（${m.total_games.toLocaleString()}試合 / ${m.avg_turns ? m.avg_turns.toFixed(1) + "ターン" : "—"} / ${m.verdict}${m.hasNotes ? " / 考察あり" : ""}）\n`));
}

/* 書いたファイルと、大文字・小文字の違いだけの名前のファイル（例：FRA_sealed.json に対する FRA_Sealed.json）を消す。
   以前の版が残した古いファイルで、どこからも読まれていない。Windows（大文字・小文字を区別しない）のフォルダを通ると、
   同じファイルとして扱われて中身が混ざるため（2026年10月） */
async function removeCaseTwins(dir, written){
  const keep = new Set(written), lower = new Set(written.map(n => n.toLowerCase()));
  let files = [];
  try{ files = await readdir(dir); }catch(e){ return; }
  const twins = files.filter(f => !keep.has(f) && lower.has(f.toLowerCase()));
  for(const f of twins) await unlink(path.join(dir, f));
  if(twins.length) process.stderr.write(`大文字・小文字の違いだけの古いファイルを消しました: ${twins.join(", ")}\n`);
}

export { MIN_GAMES, topByRarity, colorStrength };
// 直接実行したときだけ動かす（build-provisional.mjs から部品を借りるため）
import { pathToFileURL } from "node:url";
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  main().catch(e => {
    console.error("レポートの生成に失敗しました:", e.message);
    process.exit(1);
  });
}
