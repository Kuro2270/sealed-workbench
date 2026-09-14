#!/usr/bin/env node
/*
 * 17Lands 公開データセット（CC BY 4.0）からカードごとの勝率を集計する。
 *
 *   node maintenance/build-ratings.mjs              直近セットを自動で対象にする
 *   node maintenance/build-ratings.mjs HOB Sealed   組み合わせを指定して集計する
 *
 * 出力: data/ratings/<SET>_<FORMAT>.json と index.json
 *
 * 対象セットは Scryfall から自動取得するので、新セットが出れば
 * 次回の実行で勝手に加わる。公開データセットに無い組み合わせは飛ばす。
 * ファイルは数百MBになるため、gzip を展開しながら1行ずつ読んで集計する。
 */

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://17lands-public.s3.amazonaws.com/analysis_data/game_data";
const SCRY = "https://api.scryfall.com";
const OUT_DIR = "data/ratings";
const UA = "LimitedWorkbench/1.0 (https://sealed-workbench.com)";

// デッキの平均マナ総量をこの区切りで分けて、環境の速さを読む
const SPEED_BUCKETS = [
  { key: "fast",   max: 2.90 },
  { key: "mid",    max: 3.20 },
  { key: "slow",   max: 3.50 },
  { key: "slower", max: Infinity }
];

// 自動で対象にする範囲
const MONTHS_BACK = 30;        // 直近何か月のセットまで見るか
const MIN_CARDS   = 100;       // リミテッドに使えるセットの目安
const EMBARGO_DAYS = 12;       // 17Lands 規約：発売後12日間は対象外
const FORMATS = ["PremierDraft", "TradDraft", "QuickDraft", "Sealed", "TradSealed", "PickTwoDraft"];

/* ---------- Scryfall からカードの属性（マナ総量・レアリティ・色）を取る ---------- */
async function cardMeta(setCode){
  const meta = new Map();
  const add = c => {
    const ci = (c.color_identity || []).filter(x => "WUBRG".includes(x)).join("");
    const land = (c.type_line || "").split("//")[0].includes("Land");
    const e = { cmc: Math.floor(c.cmc ?? 0), rarity: c.rarity || "", color: land && !ci ? "" : ci, land };
    const names = [c.name];
    if(c.name.includes(" // ")) names.push(c.name.split(" // ")[0].trim());
    if(Array.isArray(c.card_faces)) c.card_faces.forEach(f => { if(f.name) names.push(f.name); });
    [...new Set(names)].forEach(n => { if(!meta.has(n)) meta.set(n, e); });
  };
  let url = SCRY + "/cards/search?q=" + encodeURIComponent("set:" + setCode) + "&unique=prints";
  while(url){
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if(!res.ok) break;
    const d = await res.json();
    d.data.forEach(add);
    url = d.has_more ? d.next_page : null;
    if(url) await sleep(120);
  }
  return meta;
}

/* ---------- 対象セットを Scryfall から決める ---------- */
async function listTargets(){
  const res = await fetch(SCRY + "/sets", {
    headers: { "User-Agent": UA, Accept: "application/json" }
  });
  if(!res.ok) throw new Error(`Scryfall からセット一覧を取得できませんでした（HTTP ${res.status}）`);
  const d = await res.json();

  const now = Date.now();
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const from = iso(now - MONTHS_BACK * 30 * 86400000);
  const until = iso(now - EMBARGO_DAYS * 86400000);   // 発売から12日経ったものだけ

  const sets = d.data
    .filter(s => ["expansion", "core"].includes(s.set_type)
              && s.released_at
              && s.released_at <= until
              && s.released_at >= from
              && s.card_count > MIN_CARDS)
    .sort((a, b) => b.released_at.localeCompare(a.released_at));

  const targets = [];
  for(const s of sets){
    for(const f of FORMATS) targets.push([s.code.toUpperCase(), f]);
  }
  process.stderr.write(`対象候補: ${sets.length}セット × ${FORMATS.length}形式 = ${targets.length}件\n`);
  return targets;
}

/* ---------- CSVヘッダー用の簡易パーサー（カード名にカンマが入るため） ---------- */
function parseCsvLine(line){
  const out = [];
  let cur = "", inQ = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(inQ){
      if(ch === '"'){
        if(line[i + 1] === '"'){ cur += '"'; i++; }
        else inQ = false;
      }else cur += ch;
    }else{
      if(ch === '"') inQ = true;
      else if(ch === ","){ out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const isWin = s => s === "True" || s === "true" || s === "1";

async function build(set, format, metaCache){
  const url = `${BASE}/game_data_public.${set}.${format}.csv.gz`;
  process.stderr.write(`取得中: ${url}\n`);

  const res = await fetch(url);
  if(res.status === 403 || res.status === 404){
    if(res.body) await res.body.cancel();
    return null;                                  // 公開データセットに無い組み合わせ
  }
  if(!res.ok) throw new Error(`ダウンロードに失敗しました（HTTP ${res.status}）: ${url}`);

  if(!metaCache.has(set)) metaCache.set(set, await cardMeta(set));
  const meta = metaCache.get(set);

  const rl = createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity
  });

  let header = null, wonIdx = -1, colorsIdx = -1, turnsIdx = -1;
  let names = [];              // カード名
  let deckCol = [];            // deck_<name> の列番号
  let gihCols = [];            // opening_hand / drawn / tutored の列番号（カードごとの配列）
  let cmcOf = [], isLand = []; // カードごとのマナ総量と土地かどうか
  let gihGames, gihWins, gpGames, gpWins, gnsGames, gnsWins;
  let rows = 0, wins = 0, turnSum = 0, turnCount = 0;

  const arche = new Map();                                        // 色の組み合わせ → {g, w}
  const speed = new Map(SPEED_BUCKETS.map(b => [b.key, { g: 0, w: 0 }]));

  for await (const line of rl){
    if(!line) continue;

    // ---- ヘッダー行 ----
    if(!header){
      header = parseCsvLine(line);
      wonIdx = header.indexOf("won");
      colorsIdx = header.indexOf("main_colors");
      turnsIdx = header.indexOf("num_turns");
      if(wonIdx < 0) throw new Error("won 列が見つかりません");

      const byName = new Map();   // カード名 → {deck, gih:[]}
      header.forEach((h, i) => {
        const m = h.match(/^(deck|opening_hand|drawn|tutored)_(.+)$/);
        if(!m) return;
        const [, kind, name] = m;
        if(!byName.has(name)) byName.set(name, { deck: -1, gih: [] });
        const e = byName.get(name);
        if(kind === "deck") e.deck = i;
        else e.gih.push(i);
      });

      // deck 列があるカードだけを対象にする
      for(const [name, e] of byName){
        if(e.deck < 0) continue;
        const m = meta.get(name);
        names.push(name);
        deckCol.push(e.deck);
        gihCols.push(e.gih);
        cmcOf.push(m ? m.cmc : 0);
        isLand.push(m ? m.land : false);
      }

      const n = names.length;
      gihGames = new Int32Array(n); gihWins = new Int32Array(n);
      gpGames  = new Int32Array(n); gpWins  = new Int32Array(n);
      gnsGames = new Int32Array(n); gnsWins = new Int32Array(n);
      process.stderr.write(`  対象カード: ${n}種\n`);
      continue;
    }

    // ---- データ行（数値のみなので単純分割でよい） ----
    const f = line.split(",");
    const won = isWin(f[wonIdx]) ? 1 : 0;
    rows++; wins += won;

    if(turnsIdx >= 0){
      const t = +f[turnsIdx];
      if(t > 0){ turnSum += t; turnCount++; }
    }

    if(colorsIdx >= 0){
      const c = (f[colorsIdx] || "").trim();
      if(c){
        if(!arche.has(c)) arche.set(c, { g: 0, w: 0 });
        const a = arche.get(c); a.g++; a.w += won;
      }
    }

    let deckCmcSum = 0, deckSpells = 0;
    for(let i = 0; i < names.length; i++){
      const n = +f[deckCol[i]] || 0;
      if(!n) continue;
      gpGames[i]++; gpWins[i] += won;

      if(!isLand[i]){ deckCmcSum += cmcOf[i] * n; deckSpells += n; }

      let seen = 0;
      const cols = gihCols[i];
      for(let k = 0; k < cols.length; k++) seen += +f[cols[k]] || 0;

      if(seen > 0){ gihGames[i]++; gihWins[i] += won; }
      else { gnsGames[i]++; gnsWins[i] += won; }
    }

    // デッキの平均マナ総量から、速い／遅いを振り分ける
    if(deckSpells >= 15){
      const avg = deckCmcSum / deckSpells;
      const b = SPEED_BUCKETS.find(x => avg < x.max);
      if(b){ const sp = speed.get(b.key); sp.g++; sp.w += won; }
    }

    if(rows % 200000 === 0) process.stderr.write(`  ${rows.toLocaleString()} 行\n`);
  }

  const rate = (w, g) => g > 0 ? w / g : null;
  const cards = names.map((name, i) => {
    const m = meta.get(name) || {};
    const gih = rate(gihWins[i], gihGames[i]);
    const gns = rate(gnsWins[i], gnsGames[i]);
    return {
      name,
      cmc: m.cmc ?? null,
      rarity: m.rarity || "",
      color: m.color ?? "",
      land: !!m.land,
      gih,
      gp:  rate(gpWins[i], gpGames[i]),
      gns,
      iwd: (gih != null && gns != null) ? gih - gns : null,
      games:    gihGames[i],
      gp_games: gpGames[i]
    };
  }).filter(c => c.gp_games > 0)
    .sort((a, b) => (b.gih ?? -1) - (a.gih ?? -1));

  // マナ総量ごとの勝率（試合数で重みづけ。母数の小さいカードは除く）
  const curveMap = new Map();
  cards.forEach(c => {
    if(c.cmc == null || c.gih == null || c.games < 200) return;
    if(meta.get(c.name)?.land) return;            // 土地はマナカーブに含めない
    const k = Math.min(c.cmc, 7);
    if(!curveMap.has(k)) curveMap.set(k, { cards: 0, games: 0, wins: 0 });
    const e = curveMap.get(k);
    e.cards++; e.games += c.games; e.wins += c.gih * c.games;
  });
  const curve = [...curveMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cmc, e]) => ({ cmc, cards: e.cards, games: e.games, wr: e.games ? e.wins / e.games : null }));

  // 色の組み合わせ（母数の小さいものは落とす）
  const minArche = Math.max(300, Math.floor(rows * 0.002));
  const archetypes = [...arche.entries()]
    .filter(([, v]) => v.g >= minArche)
    .map(([colors, v]) => ({ colors, games: v.g, wr: v.w / v.g }))
    .sort((a, b) => b.wr - a.wr);

  // デッキの平均マナ総量ごとの勝率
  const speedRows = SPEED_BUCKETS
    .map(b => ({ key: b.key, max: b.max === Infinity ? null : b.max, ...speed.get(b.key) }))
    .filter(r => r.g > 0)
    .map(r => ({ key: r.key, max: r.max, games: r.g, wr: r.w / r.g }));

  const payload = {
    set,
    event: format,
    generated_at: new Date().toISOString(),
    total_games: rows,
    overall_win_rate: rate(wins, rows),
    avg_turns: turnCount ? turnSum / turnCount : null,
    count: cards.length,
    source: "17Lands Public Data (CC BY 4.0)",
    source_url: "https://www.17lands.com/public_datasets",
    curve, archetypes, speed: speedRows,
    cards
  };

  await mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${set}_${format}.json`);
  await writeFile(out, JSON.stringify(payload), "utf8");

  process.stderr.write(`完了: ${out}（${rows.toLocaleString()}試合 / ${cards.length}種`
    + `${payload.avg_turns ? " / 平均" + payload.avg_turns.toFixed(1) + "ターン" : ""}`
    + `${archetypes.length ? " / " + archetypes.length + "アーキタイプ" : ""}）\n`);
  return { set, format, rows, cards: cards.length };
}

async function main(){
  const args = process.argv.slice(2);
  const targets = args.length >= 2
    ? [[args[0].toUpperCase(), args[1]]]
    : await listTargets();
  const metaCache = new Map();

  const done = [], skipped = [];
  for(const [set, format] of targets){
    try{
      const r = await build(set, format, metaCache);
      if(r) done.push(r); else skipped.push(`${set} ${format}`);
    }catch(e){
      process.stderr.write(`失敗: ${set} ${format} — ${e.message}\n`);
    }
  }

  process.stderr.write(`\n集計: ${done.length}件 ／ 見送り: ${skipped.length}件\n`);
  if(skipped.length) process.stderr.write(`  見送り: ${skipped.join(", ")}\n`);

  if(!done.length){
    process.stderr.write("集計できた組み合わせがありませんでした。\n");
    process.exit(1);
  }

  // 一覧ファイル（サイト側がどの組み合わせを持っているか知るため）
  const index = done.map(d => ({ set: d.set, event: d.format, total_games: d.rows, count: d.cards }));
  await writeFile(path.join(OUT_DIR, "index.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), datasets: index }), "utf8");
}

main().catch(e => {
  console.error("集計中にエラーが起きました:", e.message);
  process.exit(2);
});
