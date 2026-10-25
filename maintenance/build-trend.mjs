#!/usr/bin/env node
/*
 * 修正版（確定版のあとのショート）のデータを作る。役割はこれだけ。
 * 17Lands 公開データセット（CC BY 4.0。1試合ごとの記録）を、試合の日付で区切って、
 * 「1週目」と「直近の1週間」の、カードの勝率と2色の組み合わせの勝率を比べる。
 *
 *   node maintenance/build-trend.mjs FRA             … ドラフト（PremierDraft）
 *
 * 出力: data/trends/<SET>_draft.json
 *   window … 比べた2つの期間（日付・試合数・全体の勝率）
 *   risers / fallers … 1週目から勝率（引けた試合の勝率）が上がった／下がったコモン・アンコモン（上位 TREND_TOP 枚）
 *   pairs … 2色の組み合わせごとの、2つの期間の勝率と差（試合数が少ない組み合わせは除く）
 *   cards … 比べられたコモン・アンコモンすべて（名前・レアリティ・色・2つの期間の勝率と試合数・差）
 *   rarities … 比べたレアリティ（["common", "uncommon"]）
 *
 * 考え方
 *   ・発売からの合計どうしで比べると、最近の変化が最初の大量の試合に薄まって見えなくなる。
 *     そこで期間を区切り、遊び方が分かってきたことによる変化をそのまま出す。
 *   ・カードの勝率は「引けた試合の勝率」（開始時の手札か、引いたカードにあった試合。17Lands の GIH WR と同じ）。
 *   ・比べるのは同じデータセット（同じイベント）の中だけ。差は、そのまま「直近 − 1週目」（ポイント）。
 *   ・どちらかの期間の試合数が少ないカード・組み合わせは、揺れが大きいので除く。
 *   ・比べるカードはコモンとアンコモンだけ。ドラフトで何枚も取れて、デッキの中身を左右するため。
 *     レア・神話レアは1回のドラフトで出会う数が少なく、修正版で言う「評価の変化」の主役にはしない（色の組み合わせは、全カードの試合で数える）
 *   ・2つの期間が重ならないよう、データの期間が TREND_MIN_SPAN 日に満たないときは作らない（終了コード 2）。
 *
 * カードのレアリティ・色は、確定版の勝率一覧（data/ratings/events/<SET>_PremierDraft.json）から取る。
 * 環境変数: TREND_DAYS（1つの期間の日数。既定 7）、TREND_MIN_GAMES（カードの最低試合数。既定 2000）、
 *           TREND_MIN_PAIR（組み合わせの最低試合数。既定 1500）、TREND_TOP（上がった／下がったカードの数。既定 3）、TREND_MIN_DELTA（上がった／下がったと言う最低の差。既定 0.015）、
 *           TREND_MIN_SPAN（データの期間の最低日数。既定 TREND_DAYS × 2）、L17_DATASET（データセットの置き場所。確認用）
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { csvRows, csvUrl, isWin } from "./l17-csv.mjs";
import { eventFile } from "./ratings-files.mjs";

const SET = String(process.argv[2] || "").toUpperCase();
if(!/^[A-Z0-9]{2,6}$/.test(SET)){ console.error("使い方: node maintenance/build-trend.mjs <SET>"); process.exit(1); }
const FORMAT = "PremierDraft";
const DAYS = +(process.env.TREND_DAYS || 7), DAY = 86400000;
const MIN_GAMES = +(process.env.TREND_MIN_GAMES || 2000), MIN_PAIR = +(process.env.TREND_MIN_PAIR || 1500);
const MIN_DELTA = +(process.env.TREND_MIN_DELTA || 0.015);   // 上がった／下がったと言う最低の差（1.5 ポイント）
const TOP = +(process.env.TREND_TOP || 3), MIN_SPAN = +(process.env.TREND_MIN_SPAN || DAYS * 2);
const PAIRS = ["WU", "WB", "WR", "WG", "UB", "UR", "UG", "BR", "BG", "RG"];
const ORDER = "WUBRG";
const canon = s => [...String(s)].filter(c => ORDER.includes(c)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join("");
const dayOf = s => { const t = Date.parse(String(s).slice(0, 10) + "T00:00:00Z"); return isNaN(t) ? null : t; };
const iso = t => new Date(t).toISOString().slice(0, 10);

/* データセットを1回だけ読み、日ごとに集計する（日ごとの合計なら小さいので、全部持っておける）。
   どの日を「1週目」「直近」にするかは、読み終わってから、データの最初と最後の日で決める */
async function readByDay(url){
  const timeCol = h => { const g = h.indexOf("game_time"); return g >= 0 ? g : h.indexOf("draft_time"); };
  let header = null, wonIdx = -1, colorsIdx = -1, tIdx = -1, names = [], gihCols = [];
  const days = new Map();                        // 日 → { g, w, cg: Int32Array, cw: Int32Array, pair: Map }
  for await (const cols of csvRows(url)){
    if(!header){
      header = cols; wonIdx = header.indexOf("won"); colorsIdx = header.indexOf("main_colors"); tIdx = timeCol(header);
      if(wonIdx < 0) throw new Error("won 列が見つかりません");
      if(tIdx < 0) throw new Error("試合の日付の列（game_time / draft_time）が見つかりません");
      const by = new Map();
      header.forEach((h, i) => { const m = h.match(/^(opening_hand|drawn|tutored)_(.+)$/); if(!m) return; if(!by.has(m[2])) by.set(m[2], []); by.get(m[2]).push(i); });
      names = [...by.keys()]; gihCols = names.map(n => by.get(n));
      continue;
    }
    const t = dayOf(cols[tIdx]); if(t == null) continue;
    let d = days.get(t);
    if(!d){ d = { g: 0, w: 0, cg: new Int32Array(names.length), cw: new Int32Array(names.length), pair: new Map() }; days.set(t, d); }
    const won = isWin(cols[wonIdx]);
    d.g++; if(won) d.w++;
    const pc = canon(cols[colorsIdx] || "");
    if(pc.length === 2){ const p = d.pair.get(pc) || { g: 0, w: 0 }; p.g++; if(won) p.w++; d.pair.set(pc, p); }
    for(let i = 0; i < names.length; i++){
      const cs = gihCols[i];
      for(let j = 0; j < cs.length; j++){ const v = cols[cs[j]]; if(v && v !== "0"){ d.cg[i]++; if(won) d.cw[i]++; break; } }
    }
  }
  return header ? { names, days } : null;
}
/* 日ごとの集計を、期間（from〜to の日）で足し合わせる */
function sumDays(days, n, from, to){
  const s = { g: 0, w: 0, cg: new Int32Array(n), cw: new Int32Array(n), pair: new Map() };
  for(const [t, d] of days){
    if(t < from || t > to) continue;
    s.g += d.g; s.w += d.w;
    for(let i = 0; i < n; i++){ s.cg[i] += d.cg[i]; s.cw[i] += d.cw[i]; }
    for(const [k, p] of d.pair){ const q = s.pair.get(k) || { g: 0, w: 0 }; q.g += p.g; q.w += p.w; s.pair.set(k, q); }
  }
  return s;
}

async function main(){
  const url = csvUrl(SET, FORMAT);
  console.error(`読み込み: ${url}`);
  const data = await readByDay(url);
  if(!data){ console.error(`${SET}: ${FORMAT} の公開データセットがありません`); process.exit(2); }
  const { names, days } = data;
  const lo = Math.min(...days.keys()), hi = Math.max(...days.keys());
  const span = Math.round((hi - lo) / DAY) + 1, rows = [...days.values()].reduce((n, d) => n + d.g, 0);
  console.error(`  ${iso(lo)} 〜 ${iso(hi)}（${span}日・${rows.toLocaleString()}試合）`);
  if(span < MIN_SPAN){ console.error(`${SET}: データの期間が ${span} 日しかないので作りません（${MIN_SPAN} 日以上が必要）`); process.exit(2); }
  const W = { first: { from: lo, to: lo + (DAYS - 1) * DAY }, last: { from: hi - (DAYS - 1) * DAY, to: hi } };
  const A = sumDays(days, names.length, W.first.from, W.first.to), B = sumDays(days, names.length, W.last.from, W.last.to);
  if(!A.g || !B.g){ console.error(`${SET}: どちらかの期間に試合がありません`); process.exit(2); }
  const gG = [A.cg, B.cg], gW = [A.cw, B.cw], tot = [{ g: A.g, w: A.w }, { g: B.g, w: B.w }], pair = [A.pair, B.pair];

  // カードの属性（レアリティ・色・土地）。確定版の勝率一覧から
  const meta = new Map();
  try{ const r = JSON.parse(await readFile(eventFile(SET, FORMAT), "utf8")); for(const c of r.cards || []) meta.set(c.name, c); }
  catch(e){}
  if(!meta.size){ console.error(`${SET}: カードのレアリティが読めません（${eventFile(SET, FORMAT)}）。コモン・アンコモンを選べないので作りません`); process.exit(1); }
  const RARITIES = ["common", "uncommon"];

  const r4 = v => Math.round(v * 10000) / 10000;
  const cards = [];
  names.forEach((n, i) => {
    const a = gG[0][i], b = gG[1][i];
    if(a < MIN_GAMES || b < MIN_GAMES) return;
    const m = meta.get(n) || {};
    if(m.land || !RARITIES.includes(m.rarity)) return;
    const first = gW[0][i] / a, last = gW[1][i] / b;
    const se = Math.sqrt(first * (1 - first) / a + last * (1 - last) / b) || 1;
    cards.push({ name: n, rarity: m.rarity || "", color: m.color || "", cmc: m.cmc ?? null,
                 first: { gih: r4(first), games: a }, last: { gih: r4(last), games: b }, delta: r4(last - first), z: Math.round((last - first) / se * 100) / 100 });
  });
  cards.sort((x, y) => y.delta - x.delta);
  const pairs = PAIRS.map(p => {
    const a = pair[0].get(p), b = pair[1].get(p);
    if(!a || !b || a.g < MIN_PAIR || b.g < MIN_PAIR) return null;
    return { colors: p, first: { wr: r4(a.w / a.g), games: a.g }, last: { wr: r4(b.w / b.g), games: b.g }, delta: r4(b.w / b.g - a.w / a.g) };
  }).filter(Boolean).sort((x, y) => y.last.wr - x.last.wr);

  const win = k => { const x = tot[k === "first" ? 0 : 1]; return { from: iso(W[k].from), to: iso(W[k].to), games: x.g, wr: r4(x.w / x.g) }; };
  const out = {
    set: SET, mode: "draft", event: FORMAT, generated_at: new Date().toISOString(),
    source: "17Lands Public Data (CC BY 4.0)", source_url: "https://www.17lands.com/public_datasets",
    data_from: iso(lo), data_to: iso(hi), days: DAYS, min_games: MIN_GAMES, min_pair_games: MIN_PAIR, rarities: RARITIES,
    window: { first: win("first"), last: win("last") },
    // 上がった／下がったカードは、差の大きさを、試合数から見た揺れの大きさで割った値（z）の順に選ぶ。
    // 試合の少ないカードがたまたま大きく動いただけのものを、上に出さないため（画面とセリフで言うのは差そのもの）
    risers: cards.filter(c => c.delta >= MIN_DELTA).sort((x, y) => y.z - x.z).slice(0, TOP),
    fallers: cards.filter(c => c.delta <= -MIN_DELTA).sort((x, y) => x.z - y.z).slice(0, TOP),
    pairs, cards
  };
  await mkdir("data/trends", { recursive: true });
  const file = `data/trends/${SET}_draft.json`;
  await writeFile(file, JSON.stringify(out, null, 1) + "\n", "utf8");
  const pt = v => (v * 100).toFixed(1);
  console.error(`\n${file}`);
  console.error(`  1週目 ${out.window.first.from}〜${out.window.first.to}（${out.window.first.games.toLocaleString()}試合）／直近 ${out.window.last.from}〜${out.window.last.to}（${out.window.last.games.toLocaleString()}試合）`);
  console.error(`  比べたコモン・アンコモン ${cards.length} 枚・組み合わせ ${pairs.length} 通り`);
  for(const [h, l] of [["上がった", out.risers], ["下がった", out.fallers]]) console.error(`  ${h}: ` + l.map(c => `${c.name} ${pt(c.first.gih)}→${pt(c.last.gih)}（${c.delta > 0 ? "+" : ""}${pt(c.delta)}）`).join(" / "));
  console.error(`  組み合わせ: ` + pairs.map(p => `${p.colors} ${pt(p.first.wr)}→${pt(p.last.wr)}`).join(" / "));
}

main().catch(e => { console.error("修正版のデータを作れませんでした:", e.message); process.exit(1); });
