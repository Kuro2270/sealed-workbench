#!/usr/bin/env node
/*
 * 暫定版の環境レポートを、17Lands の毎日の集計（カード勝率・色別勝率）から作る。
 *   公開データセット（CSV）が出るまでの間だけ使う。出たら確定版（build-ratings → build-articles）に切り替わり、暫定版は消す。
 *
 *   node maintenance/build-provisional.mjs FRA      … セットを決めて作る
 *   node maintenance/build-provisional.mjs --auto   … 対象のセットを探して作る（紙の発売から12〜60日で、確定版が無いもの）
 *
 * 出力: data/provisional/<SET>_<mode>.json … 環境レポートと同じ形（provisional: true）。環境レポートの画面と下見ページが読む
 *       data/ratings/<SET>_<mode>.json     … 全カードの勝率（provisional: true）。勝率一覧・練習ツールの勝率表示が読む
 *   <mode> は draft（PremierDraft）と sealed（Sealed）。
 *
 * 決まりごと
 *   ・17Lands の利用ガイドラインでは、第三者サイトでのデータの掲載は発売12日目から。それより前のセットは作らない。
 *   ・確定版（data/articles/<SET>_<mode>.json）があるセットは作らない（確定版のファイルを上書きしないため）。
 *     そのセットの暫定版が残っていれば消す（data/provisional/ だけ。data/ratings/ は確定版が上書き済み）。
 *   ・環境の速さ（デッキの平均マナ総量ごとの勝率）とゲームの長さは、試合ごとのデータが要るので暫定版には無い。
 *   ・17Lands への通信は、1セットにつき 26 回ほど（形式ごとに色別勝率・カード勝率2つの取り口・2色10通りのカード勝率）。間を 1.5 秒あける。
 *
 * 環境変数: L17_API / SCRY_API（確認用に差し替えられる）、PROV_NOW（確認用。今日の日付 YYYY-MM-DD）
 */
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { cardTiers } from "./card-tier.mjs";
import { MIN_GAMES, topByRarity, colorStrength } from "./build-articles.mjs";

const UA = "sealed-workbench/1.0 (https://sealed-workbench.com)";
const L17 = process.env.L17_API || "https://www.17lands.com";
const SCRY = process.env.SCRY_API || "https://api.scryfall.com";
const NOW = process.env.PROV_NOW ? Date.parse(process.env.PROV_NOW + "T12:00:00Z") : Date.now();
const DAY = 86400000, FROM_DAYS = 12, UNTIL_DAYS = 60;
const MODES = { draft: "PremierDraft", sealed: "Sealed" };
const PAIRS = ["WU", "WB", "WR", "WG", "UB", "UR", "UG", "BR", "BG", "RG"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = t => new Date(t).toISOString().slice(0, 10);
const readJson = async (p, f) => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return f; } };
const front = s => String(s || "").split(" // ")[0].trim();

async function getJson(url){
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(/\?.*/, "")}`);
  return r.json();
}

/* 確定版がある（＝暫定版は作らない） */
const hasFinal = async (set, mode) => { const a = await readJson(`data/articles/${set}_${mode}.json`, null); return !!(a && !a.provisional); };

/* 確定版ができたセットの暫定版を消す */
async function cleanup(){
  let files = [];
  try{ files = await readdir("data/provisional"); }catch(e){ return; }
  for(const f of files){
    const m = f.match(/^([A-Z0-9]+)_(draft|sealed)\.json$/); if(!m) continue;
    if(await hasFinal(m[1], m[2])){ await unlink(`data/provisional/${f}`); console.error(`${m[1]} ${m[2]}: 確定版ができたので、暫定版を消しました`); }
  }
}

/* Scryfall：マナ総量・レアリティ・色・土地（build-ratings.mjs と同じ決め方） */
async function cardMeta(set){
  const meta = new Map();
  let url = `${SCRY}/cards/search?q=${encodeURIComponent("set:" + set)}&unique=prints`;
  while(url){
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if(!r.ok) break;
    const d = await r.json();
    for(const c of d.data || []){
      const ci = (c.color_identity || []).filter(x => "WUBRG".includes(x)).join("");
      const land = String((c.card_faces && c.card_faces[0] && c.card_faces[0].type_line) || c.type_line || "").split("//")[0].includes("Land");
      const e = { cmc: Math.floor(c.cmc ?? (c.card_faces && c.card_faces[0] && c.card_faces[0].cmc) ?? 0), rarity: c.rarity || "", color: land && !ci ? "" : ci, land };
      for(const n of new Set([c.name, front(c.name), ...((c.card_faces || []).map(f => f.name))])) if(n && !meta.has(n)) meta.set(n, e);
    }
    url = d.has_more ? d.next_page : null;
    if(url) await sleep(120);
  }
  return meta;
}

/* 1つの形式（PremierDraft / Sealed）を作る */
async function buildMode(set, mode, released, meta){
  const fmt = MODES[mode];
  /* カード勝率の取り口は2つ試して、試合数の多いほうを使う。
     ・/api/card_data（17Lands のカード表の画面が使っているもの。全期間）… 画面と同じ数字
     ・/card_ratings/data（以前からのもの）… 2026年10月 FRA では、全体の4%ほどの試合しか返らなかった（期間の指定を変えても同じ）
     どちらも項目の名前は同じ（game_count・ever_drawn_win_rate など） */
  const set_ = encodeURIComponent(set);
  const variants = [
    { label: "カード表の画面と同じ（全期間）", url: extra => `${L17}/api/card_data?expansion=${set_}&event_type=${fmt}&time_period=ALL_TIME${extra}` },
    { label: "以前からの取り口", url: extra => `${L17}/card_ratings/data?expansion=${set_}&format=${fmt}&start_date=${iso(Date.parse(released) - 21 * DAY)}&end_date=${iso(NOW + DAY)}${extra}` }
  ];
  const listOf = d => Array.isArray(d) ? d : (d && (d.data || d.cards)) || [];
  const sumGames = rows => (rows || []).reduce((n, r) => n + (+r.game_count || 0), 0);
  let pick = variants[0], cardRows = null, best = -1;
  for(const v of variants){
    try{
      const rows = listOf(await getJson(v.url("")));
      const n = sumGames(rows);
      console.error(`  ${set} ${fmt}: カード勝率（${v.label}）の試合数の合計 ${n.toLocaleString()}／カード ${rows.length} 種`);
      if(n > best){ best = n; pick = v; cardRows = rows; }
    }catch(e){ console.error(`  ${e.message}`); }
    await sleep(1500);
  }
  if(!cardRows) throw new Error("カード勝率を取れませんでした");
  const colorRows = await getJson(`${L17}/color_ratings/data?expansion=${set_}&event_type=${fmt}&start_date=${iso(Date.parse(released) - 21 * DAY)}&end_date=${iso(NOW + DAY)}&combine_splash=true`); await sleep(1500);

  /* 色の組み合わせと、全体の試合数・勝率 */
  const MONO = { White: "W", Blue: "U", Black: "B", Red: "R", Green: "G" };
  let total = 0, wins = 0, sum = 0;
  const arche = [];
  for(const r of colorRows || []){
    const name = String(r.color_name || ""), g = +r.games || 0, w = +r.wins || 0;
    if(r.is_summary){ if(/^All/i.test(name)){ total = g; wins = w; } continue; }
    const m1 = name.match(/^Mono-(White|Blue|Black|Red|Green)$/), m2 = name.match(/\(([WUBRG]+)\)/);
    const code = m1 ? MONO[m1[1]] : m2 ? m2[1] : "";
    if(!code || !g) continue;
    arche.push({ colors: code, games: g, wr: w / g }); sum += g;
  }
  if(!total){ total = sum; wins = arche.reduce((n, a) => n + a.wr * a.games, 0); }
  if(!total){ console.error(`  ${set} ${fmt}: まだ試合がありません`); return null; }
  /* 試合数の確かめ：1試合で使われるカード（デッキの23枚前後）を考えると、カードの試合数の合計は全体の試合数の10倍以上になる。
     3倍に届かないときは、カード勝率がごく一部の試合からしか取れていないので、載せない（間違った印象を与えないため） */
  if(best < total * 3){
    console.error(`::warning::${set} ${fmt}: カード勝率の試合数（合計 ${best.toLocaleString()}）が、全体の試合数（${total.toLocaleString()}）に比べて少なすぎます。17Lands の取り方が合っていないため、暫定版を載せません`);
    return { skip: true };
  }

  /* カード */
  const cards = [];
  for(const c of cardRows || []){
    const games = +c.ever_drawn_game_count || 0, gih = c.ever_drawn_win_rate;
    if(!games || gih == null) continue;
    const m = meta.get(c.name) || meta.get(front(c.name)) || {};
    const gns = c.never_drawn_win_rate ?? null;
    cards.push({
      name: c.name, cmc: m.cmc ?? null, rarity: m.rarity || String(c.rarity || "").toLowerCase(), color: m.color ?? String(c.color || ""), land: !!m.land,
      gih: +gih, gp: c.win_rate ?? null, gns, iwd: c.drawn_improvement_win_rate ?? (gns != null ? gih - gns : null),
      games, gp_games: +c.game_count || 0, by_pair: {}
    });
  }
  /* 2色のデッキごとの勝率（勝率一覧・ドラフト補助で使う）。取れなければ無しのまま */
  const byName = new Map(cards.map(c => [c.name, c]));
  for(const p of PAIRS){
    try{
      const rows = listOf(await getJson(pick.url(`&colors=${p}`)));
      // 色の指定が効いていない（全デッキと同じ数字が返ってきた）ときは、2色ごとの勝率は付けない
      const matched = (rows || []).filter(r => byName.has(r.name) && +r.ever_drawn_game_count > 0);
      const same = matched.filter(r => +r.ever_drawn_game_count === byName.get(r.name).games).length;
      if(matched.length && same >= matched.length * 0.8){ console.error(`  2色ごとの勝率が取れない形でした（${p}）。付けずに進めます`); break; }
      for(const r of rows || []){
        const c = byName.get(r.name), g = +r.ever_drawn_game_count || 0;
        if(c && g >= 200 && r.ever_drawn_win_rate != null) c.by_pair[p] = [Math.round(r.ever_drawn_win_rate * 10000) / 10000, g];
      }
    }catch(e){ console.error(`  ${p}: ${e.message}（この組み合わせは飛ばします）`); }
    await sleep(1500);
  }
  cards.sort((a, b) => (b.gih ?? -1) - (a.gih ?? -1));

  /* マナ総量ごとの勝率（build-ratings.mjs と同じく、カードの GIH 勝率を試合数で重みづけ） */
  const cv = new Map();
  for(const c of cards){
    if(c.land || c.cmc == null || c.games < 200) continue;
    const k = Math.min(c.cmc, 7);
    if(!cv.has(k)) cv.set(k, { cards: 0, games: 0, wins: 0 });
    const e = cv.get(k); e.cards++; e.games += c.games; e.wins += c.gih * c.games;
  }
  const curve = [...cv.entries()].sort((a, b) => a[0] - b[0]).map(([cmc, e]) => ({ cmc, cards: e.cards, games: e.games, wr: e.wins / e.games }));

  const now = new Date(NOW).toISOString(), events = [{ event: fmt, games: total }];
  const source = "17Lands（毎日の集計）", source_url = `https://www.17lands.com/card_data?expansion=${set}&format=${fmt}`;
  const archetypes = arche.sort((a, b) => b.wr - a.wr);
  const article = {
    set, mode, provisional: true, events, generated_at: now, data_generated_at: now,
    total_games: total, overall_win_rate: wins / total, avg_turns: null,
    top: { mythic: topByRarity(cards, "mythic"), rare: topByRarity(cards, "rare"), uncommon: topByRarity(cards, "uncommon"), common: topByRarity(cards, "common") },
    colors: colorStrength(archetypes),
    archetypes: archetypes.filter(a => a.games >= Math.max(300, Math.floor(total * 0.002))).slice(0, 12),
    curve, speed: [], verdict: null,
    tiers: cardTiers(cards, MIN_GAMES),
    notes: { summary: null, archetypes: null, speed: null, cards: null },
    source, source_url
  };
  const ratings = { set, mode, provisional: true, events, generated_at: now, data_generated_at: now, total_games: total, overall_win_rate: wins / total, count: cards.length, cards, source, source_url };
  console.error(`  ${set} ${mode}: ${total.toLocaleString()} 試合／カード ${cards.length} 種／2色の勝率つき ${cards.filter(c => Object.keys(c.by_pair).length).length} 種`);
  return { article, ratings };
}

async function buildSet(set){
  const info = await getJson(`${SCRY}/sets/${set.toLowerCase()}`);
  const days = (NOW - Date.parse(info.released_at)) / DAY;
  if(days < FROM_DAYS){ console.error(`${set}: 紙の発売から ${Math.floor(days)} 日。12日目まではサイトに載せない決まりなので作りません`); return 0; }
  const meta = await cardMeta(set);
  let made = 0;
  for(const mode of Object.keys(MODES)){
    if(await hasFinal(set, mode)){ console.error(`${set} ${mode}: 確定版があるので作りません`); continue; }
    let r = null;
    try{ r = await buildMode(set, mode, info.released_at, meta); }catch(e){ console.error(`${set} ${mode}: ${e.message}`); process.exitCode = 1; }
    if(!r) continue;
    if(r.skip){                                   // 数字が当てにならないときは、前に作った暫定版も下げる（下見・速報に戻る）
      for(const f of [`data/provisional/${set}_${mode}.json`, `data/ratings/${set}_${mode}.json`]) await unlink(f).catch(() => {});
      process.exitCode = 1;
      made++;                                     // 下見ページを作り直す（暫定版の欄を外す）ため、変わったものとして数える
      continue;
    }
    await mkdir("data/provisional", { recursive: true });
    await writeFile(`data/provisional/${set}_${mode}.json`, JSON.stringify(r.article), "utf8");
    await writeFile(`data/ratings/${set}_${mode}.json`, JSON.stringify(r.ratings), "utf8");
    made++;
  }
  return made;
}

/* --auto：紙の発売から12〜60日で、確定版がまだ無いセット */
async function autoTargets(){
  const d = await getJson(`${SCRY}/sets`);
  return (d.data || []).filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at && s.card_count > 150
    && NOW - Date.parse(s.released_at) >= FROM_DAYS * DAY && NOW - Date.parse(s.released_at) <= UNTIL_DAYS * DAY).map(s => s.code.toUpperCase());
}

const arg = String(process.argv[2] || "").toUpperCase();
if(!arg){ console.error("使い方: node maintenance/build-provisional.mjs <SET> | --auto"); process.exit(1); }
await cleanup();
const sets = arg === "--AUTO" ? await autoTargets() : [arg];
const made = [];
for(const s of sets){
  if(arg === "--AUTO" && await hasFinal(s, "draft") && await hasFinal(s, "sealed")) continue;
  if((await buildSet(s)) > 0) made.push(s);
}
console.error(made.length ? `暫定版を作りました: ${made.join(" ")}` : "暫定版を作るセットはありませんでした。");
for(const s of made) console.log(s);       // 下見ページを作り直すセット（ワークフローが読む）
