#!/usr/bin/env node
/*
 * 先行版（発売直後）の記事データを、17Lands のカード勝率・色別勝率から作る。
 *
 *   node maintenance/build-early.mjs RFA
 *
 * 出力: data/articles/<SET>_early.json（「環境まとめ動画を作る」が mode=early で読む）
 *       data/names/<SET>.json（無ければ作る。日本語名とカード画像）
 *
 * 考え方
 *   ・本編（ドラフト／シールド）は、17Lands の公開データ（CSV）が出る発売12日目以降に作る。
 *     先行版は、その前に「発売直後の傾向」をショート動画で出すためのもの。
 *   ・17Lands の利用ガイドラインでは、第三者サイトでのデータ掲載は発売12日目まで控える（Embargo）一方、
 *     動画や記事で数字を引用するのは初日から差し支えないとされている。そのため、先行版のデータは
 *     サイトには載せず、動画にだけ使う。このファイルは commit しない（ワークフローの中だけで使う）。
 *   ・通信は 17Lands に 2 回（カード勝率・色別勝率）と Scryfall だけ。毎日たたかない。
 *   ・動画の概要欄とコメントに「データ: 17Lands」の表記を入れる（ガイドラインの引用の決まり）。
 *
 *   ・ドラフト（PremierDraft）とシールド（Sealed）を合算した「リミテッド速報」にする。発売直後はシールドの試合が
 *     少ないので、分けると数字が薄い。シールドにまだ試合が無ければドラフトだけで作る（formats に残る）。
 *
 * 環境変数: EARLY_FORMATS（既定 PremierDraft,Sealed）、EARLY_MIN_GAMES（上位に出すカードの最低試合数。既定 300）
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SET = String(process.argv[2] || "").toUpperCase();
if(!SET){ console.error("使い方: node maintenance/build-early.mjs <SET>"); process.exit(1); }
const FORMATS = (process.env.EARLY_FORMATS || "PremierDraft,Sealed").split(",").map(x => x.trim()).filter(Boolean);
const MIN_GAMES = +(process.env.EARLY_MIN_GAMES || 300);
const UA = "sealed-workbench/1.0 (https://sealed-workbench.com; contact@sealed-workbench.com)";
const SCRY = process.env.SCRY_API || "https://api.scryfall.com";
const L17 = process.env.L17_API || "https://www.17lands.com";   // 試験用に差し替えられる
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const iso = t => new Date(t).toISOString().slice(0, 10);

async function getJson(url, what){
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if(!r.ok) throw new Error(`${what}: HTTP ${r.status}`);
  return r.json();
}

/* ---------- Scryfall（セット情報・カードのマナ総量） ---------- */
async function scryAll(q){
  const out = [];
  let url = `${SCRY}/cards/search?q=${encodeURIComponent(q)}`;
  while(url){
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if(!r.ok) break;
    const d = await r.json();
    out.push(...(d.data || []));
    url = d.has_more ? d.next_page : null;
    if(url) await sleep(120);
  }
  return out;
}
const front = s => String(s || "").split(" // ")[0].trim();

const setInfo = await getJson(`${SCRY}/sets/${SET.toLowerCase()}`, "Scryfall のセット情報").catch(e => { console.error(e.message); return null; });
if(!setInfo){ console.error(`${SET}: Scryfall にセットがありません。`); process.exit(1); }
console.error(`${SET}: ${setInfo.name}（発売 ${setInfo.released_at}）`);

const en = await scryAll(`set:${SET.toLowerCase()} unique:prints`);
const cmcOf = {}, rarityOf = {};
for(const c of en){
  for(const k of [c.name, front(c.name)]){
    if(cmcOf[k] == null) cmcOf[k] = c.cmc != null ? c.cmc : (c.card_faces && c.card_faces[0] && c.card_faces[0].cmc) || 0;
    if(!rarityOf[k]) rarityOf[k] = c.rarity;
  }
}

/* 日本語名とカード画像（無ければ作る。build-set-pages.mjs と同じ作り方） */
async function ensureNames(){
  const path = `data/names/${SET}.json`;
  const cached = await readJson(path, null);
  if(cached && cached.names && Object.keys(cached.names).length && cached.v === 4) return cached;
  const ja = await scryAll(`set:${SET.toLowerCase()} lang:ja unique:prints`);
  const jaOf = c => (c.card_faces && c.card_faces[0] && c.card_faces[0].printed_name) || front(c.printed_name);
  const jaByCn = {}, jaByName = {}, jaImgByCn = {};
  const imgOf = c => (c.image_uris && c.image_uris.normal) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal) || "";
  for(const c of ja){
    const p = jaOf(c); if(!p) continue;
    if(!jaByCn[c.collector_number]) jaByCn[c.collector_number] = p;
    if(!jaByName[c.name]) jaByName[c.name] = p;
    if(!jaByName[front(c.name)]) jaByName[front(c.name)] = p;
    const u = imgOf(c); if(u && !jaImgByCn[c.collector_number]) jaImgByCn[c.collector_number] = u;
  }
  const names = {}, images = {};
  const put = (key, p) => { if(key && p && !names[key]) names[key] = p; };
  for(const c of en){
    const p = jaByCn[c.collector_number] || jaByName[c.name] || jaByName[front(c.name)];
    put(c.name, p); put(front(c.name), p);
    const u = jaImgByCn[c.collector_number] || imgOf(c);
    for(const key of [c.name, front(c.name)]) if(u && !images[key]) images[key] = u;
  }
  for(const n of Object.keys(jaByName)) put(n, jaByName[n]);
  const out = { v: 4, set: setInfo.name, released_at: setInfo.released_at, names, images, fetched_at: new Date().toISOString() };
  await mkdir("data/names", { recursive: true });
  await writeFile(path, JSON.stringify(out), "utf8");
  console.error(`${SET}: 日本語名 ${Object.keys(names).length} 件を保存`);
  return out;
}
await ensureNames();

/* ---------- 17Lands（色別勝率・カード勝率）。形式ごとに取って合算する ---------- */
const start = iso(Date.parse(setInfo.released_at) - 21 * 86400000);   // Arena は紙より先に出るので、少し前から
const end = iso(Date.now() + 86400000);
const q = `expansion=${encodeURIComponent(SET)}&start_date=${start}&end_date=${end}`;
const MONO = { White: "W", Blue: "U", Black: "B", Red: "R", Green: "G" };
const pairs = {}, contains = { W: [0, 0], U: [0, 0], B: [0, 0], R: [0, 0], G: [0, 0] };
const cards = {};                                  // name → { games, wins, iwdW, iwdG, color, rarity }
const formats = [];
let total = 0, totalWins = 0;
for(const FORMAT of FORMATS){
  let colorRows = [], cardRows = [];
  try{
    colorRows = await getJson(`${L17}/color_ratings/data?${q}&event_type=${encodeURIComponent(FORMAT)}&combine_splash=true`, `17Lands の色別勝率（${FORMAT}）`);
    await sleep(1500);
    cardRows = await getJson(`${L17}/card_ratings/data?${q}&format=${encodeURIComponent(FORMAT)}`, `17Lands のカード勝率（${FORMAT}）`);
    await sleep(1500);
  }catch(e){ console.error(`  ${e.message}（この形式は飛ばします）`); continue; }
  let fGames = 0, fWins = 0, fPairs = 0;
  for(const r of colorRows || []){
    const name = String(r.color_name || ""), games = +r.games || 0, wins = +r.wins || 0;
    if(r.is_summary){ if(/^All/i.test(name)){ fGames = games; fWins = wins; } continue; }
    let code = "";
    const m1 = name.match(/^Mono-(White|Blue|Black|Red|Green)$/); if(m1) code = MONO[m1[1]];
    const m2 = name.match(/\(([WUBRG]+)\)/); if(m2) code = m2[1];
    if(!code) continue;
    fPairs += games;
    if(!pairs[code]) pairs[code] = { colors: code, games: 0, wins: 0 };
    pairs[code].games += games; pairs[code].wins += wins;
    for(const c of code) if(contains[c]){ contains[c][0] += games; contains[c][1] += wins; }
  }
  if(!fGames) fGames = fPairs;
  if(!fGames){
    console.error(`  ${FORMAT}: まだ試合がありません。`);
    if(Array.isArray(colorRows) && colorRows.length) console.error(`  （返ってきた形: ${JSON.stringify(colorRows[0]).slice(0, 200)}）`);
    continue;
  }
  total += fGames; totalWins += fWins;
  let nRows = 0;
  for(const c of cardRows || []){
    const name = front(c.name);
    const games = +c.ever_drawn_game_count || 0, gih = c.ever_drawn_win_rate, iwd = c.drawn_improvement_win_rate;
    if(!games || gih == null) continue;
    nRows++;
    const cur = cards[name] || (cards[name] = { games: 0, wins: 0, iwdW: 0, iwdG: 0, color: String(c.color || ""), rarity: String(c.rarity || rarityOf[name] || "").toLowerCase() });
    cur.games += games; cur.wins += games * +gih;
    if(iwd != null){ cur.iwdW += games * +iwd; cur.iwdG += games; }
  }
  if(!nRows && Array.isArray(cardRows) && cardRows.length) console.error(`  カード勝率を読めませんでした（返ってきた形: ${JSON.stringify(cardRows[0]).slice(0, 300)}）`);
  formats.push({ format: FORMAT, mode: /sealed/i.test(FORMAT) ? "sealed" : "draft", games: fGames, wr: fWins / fGames });
  console.error(`  ${FORMAT}: ${fGames.toLocaleString()} 試合／カード ${nRows} 枚`);
}
if(!total){ console.error(`${SET}: 17Lands にまだ試合がありません。`); process.exit(2); }
const colors = Object.entries(contains).filter(([, v]) => v[0] > 0).map(([color, [games, wins]]) => ({ color, games, wr: wins / games })).sort((a, b) => b.wr - a.wr);
const archetypes = Object.values(pairs).filter(p => p.games > 0).map(p => ({ colors: p.colors, games: p.games, wr: p.wins / p.games })).sort((a, b) => b.games - a.games);

/* カード：GIH 勝率（手札に来た試合の勝率）で並べる。試合数が少ないものは外す */
const byRarity = { common: [], uncommon: [], rare: [], mythic: [] };
for(const [name, c] of Object.entries(cards)){
  if(!byRarity[c.rarity] || c.games < MIN_GAMES) continue;
  byRarity[c.rarity].push({ name, cmc: cmcOf[name] != null ? cmcOf[name] : null, color: c.color, gih: c.wins / c.games, iwd: c.iwdG ? c.iwdW / c.iwdG : null, games: c.games });
}
const top = {};
for(const r of Object.keys(byRarity)) top[r] = byRarity[r].sort((a, b) => b.gih - a.gih).slice(0, 10);
const nCards = Object.values(byRarity).reduce((n, a) => n + a.length, 0);

const out = {
  set: SET, mode: "early", early: true, formats,
  generated_at: new Date().toISOString(), data_generated_at: new Date().toISOString(), as_of: iso(Date.now()),
  released_at: setInfo.released_at,
  total_games: total, overall_win_rate: total ? totalWins / total : null,
  top, colors, archetypes,
  notes: { summary: null, archetypes: null, speed: null, cards: null },
  source: "17Lands（card ratings / color ratings）", source_url: `${L17}/card_data?expansion=${SET}&format=PremierDraft`
};
await mkdir("data/articles", { recursive: true });
await writeFile(`data/articles/${SET}_early.json`, JSON.stringify(out, null, 2) + "\n", "utf8");
console.error(`${SET}: 先行版データを作成。${formats.map(f => `${f.format} ${f.games.toLocaleString()}`).join(" + ")} = ${total.toLocaleString()} 試合／色の組み合わせ ${archetypes.length}／カード ${nCards} 枚（${MIN_GAMES} 試合以上）`);
console.error(`  強い色: ${colors.slice(0, 3).map(c => `${c.color} ${(c.wr * 100).toFixed(1)}%`).join("、")}`);
console.error(`  トップコモン: ${(top.common || []).slice(0, 3).map(c => c.name).join(" / ")}`);

/* ---------- サイト用の「速報メモ」（文章だけ。表やグラフにはしない） ----------
   17Lands の利用ガイドラインでは、第三者サイトでのデータの掲載（別の形での可視化）は発売12日目まで控えるよう求められている一方、
   記事での個別の数字の引用は初日から差し支えないとされている。そこで、数字を3〜4個だけ含む文章を作り、下見ページに載せる。
   数字そのものは残さず、できあがった文章だけを data/early/<SET>.json に置く（「動画を配信」のあと、下見ページに動画と一緒に入る） */
{
  const namesJa = (await readJson(`data/names/${SET}.json`, { names: {} })).names || {};
  const CJ = { W: "白", U: "青", B: "黒", R: "赤", G: "緑" }, CE = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
  const pairName = (p, ja) => [...p].map(c => (ja ? CJ : CE)[c] || c).join(ja ? "" : "-");
  const pct = v => (v * 100).toFixed(1);
  const totalPair = archetypes.reduce((n, a) => n + a.games, 0) || 1;
  const pairs = archetypes.filter(a => a.colors.length === 2 && a.games >= Math.max(400, totalPair * 0.04)).sort((a, b) => b.wr - a.wr);
  const best = pairs[0], second = pairs[1];
  const mono = colors[0];
  const c1 = (top.common || [])[0];
  const monthDay = d => { const [y, m, dd] = d.split("-"); return { ja: `${+m}月${+dd}日`, en: new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) }; };
  const asOf = monthDay(iso(Date.now()));
  const dataDay = (() => { const d = new Date(setInfo.released_at + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 12); return monthDay(d.toISOString().slice(0, 10)); })();
  const gamesJa = total >= 10000 ? `約${Math.round(total / 10000)}万` : total.toLocaleString("ja-JP");
  const gamesEn = total >= 1000 ? `${Math.round(total / 1000)}K` : String(total);
  const ja = [
    `発売直後の${gamesJa}試合（ドラフト＋シールド）では、` + (best ? `最も勝っている組み合わせは${pairName(best.colors, true)}（${pct(best.wr)}%）` : "まだ組み合わせの傾向は出ていません") + (second ? `、次いで${pairName(second.colors, true)}（${pct(second.wr)}%）。` : "。"),
    mono ? `単色では${CJ[mono.color]}が最も安定しています。` : "",
    c1 ? `コモンでは《${namesJa[c1.name] || c1.name}》の勝率が頭ひとつ抜けています。` : "",
    `順位はこの後のデータで動きます。確定版（全カードの勝率）は ${dataDay.ja} ごろに。`
  ].filter(Boolean).join("");
  const en = [
    `Across the first ${gamesEn} games (Draft and Sealed combined), ` + (best ? `the best-performing pair is ${pairName(best.colors)} (${pct(best.wr)}%)` : "no pair has pulled ahead yet") + (second ? `, followed by ${pairName(second.colors)} (${pct(second.wr)}%).` : "."),
    mono ? ` ${CE[mono.color]} is the most reliable single colour so far.` : "",
    c1 ? ` Among commons, ${c1.name} is clearly ahead.` : "",
    ` Rankings will move as more games come in; the full review (every card's win rate) lands around ${dataDay.en}.`
  ].filter(Boolean).join("");
  const note = { set: SET, as_of: iso(Date.now()), as_of_label: asOf, ja, en, source: "17Lands", source_url: `${L17}/card_data?expansion=${SET}&format=PremierDraft` };
  await mkdir("data/early", { recursive: true });
  await writeFile(`data/early/${SET}.json`, JSON.stringify(note, null, 2) + "\n", "utf8");
  console.error(`  速報メモ: ${ja}`);
}
