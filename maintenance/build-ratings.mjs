#!/usr/bin/env node
/*
 * 17Lands 公開データセット（CC BY 4.0）からカードごとの勝率を集計する。
 *
 *   node maintenance/build-ratings.mjs HOB PremierDraft
 *   node maintenance/build-ratings.mjs            （既定の組み合わせをまとめて処理）
 *
 * 出力: data/ratings/<SET>_<FORMAT>.json
 *
 * ファイルは数百MB〜になるため、gzip を展開しながら1行ずつ読んで集計する。
 * メモリに載せるのはカードごとのカウンタだけ。
 */

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://17lands-public.s3.amazonaws.com/analysis_data/game_data";
const OUT_DIR = "data/ratings";

// 既定で処理する組み合わせ（引数なしで実行したとき）
const DEFAULT_TARGETS = [
  ["HOB", "PremierDraft"],
  ["MSH", "PremierDraft"]
];

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

async function build(set, format){
  const url = `${BASE}/game_data_public.${set}.${format}.csv.gz`;
  process.stderr.write(`取得中: ${url}\n`);

  const res = await fetch(url);
  if(!res.ok) throw new Error(`ダウンロードに失敗しました（HTTP ${res.status}）: ${url}`);

  const rl = createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity
  });

  let header = null, wonIdx = -1;
  let names = [];              // カード名
  let deckCol = [];            // deck_<name> の列番号
  let gihCols = [];            // opening_hand / drawn / tutored の列番号（カードごとの配列）
  let gihGames, gihWins, gpGames, gpWins, gnsGames, gnsWins;
  let rows = 0, wins = 0;

  for await (const line of rl){
    if(!line) continue;

    // ---- ヘッダー行 ----
    if(!header){
      header = parseCsvLine(line);
      wonIdx = header.indexOf("won");
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
        names.push(name);
        deckCol.push(e.deck);
        gihCols.push(e.gih);
      }

      const n = names.length;
      gihGames = new Int32Array(n); gihWins = new Int32Array(n);
      gpGames  = new Int32Array(n); gpWins  = new Int32Array(n);
      gnsGames = new Int32Array(n); gnsWins = new Int32Array(n);
      process.stderr.write(`対象カード: ${n}種\n`);
      continue;
    }

    // ---- データ行（数値のみなので単純分割でよい） ----
    const f = line.split(",");
    const won = isWin(f[wonIdx]) ? 1 : 0;
    rows++; wins += won;

    for(let i = 0; i < names.length; i++){
      const inDeck = +f[deckCol[i]] > 0;
      if(!inDeck) continue;
      gpGames[i]++; gpWins[i] += won;

      let seen = 0;
      const cols = gihCols[i];
      for(let k = 0; k < cols.length; k++) seen += +f[cols[k]] || 0;

      if(seen > 0){ gihGames[i]++; gihWins[i] += won; }
      else { gnsGames[i]++; gnsWins[i] += won; }
    }

    if(rows % 200000 === 0) process.stderr.write(`  ${rows.toLocaleString()} 行\n`);
  }

  const rate = (w, g) => g > 0 ? w / g : null;
  const cards = names.map((name, i) => {
    const gih = rate(gihWins[i], gihGames[i]);
    const gns = rate(gnsWins[i], gnsGames[i]);
    return {
      name,
      gih,
      gp:  rate(gpWins[i], gpGames[i]),
      gns,
      iwd: (gih != null && gns != null) ? gih - gns : null,
      games:    gihGames[i],
      gp_games: gpGames[i]
    };
  }).filter(c => c.gp_games > 0)
    .sort((a, b) => (b.gih ?? -1) - (a.gih ?? -1));

  const payload = {
    set,
    event: format,
    generated_at: new Date().toISOString(),
    total_games: rows,
    overall_win_rate: rate(wins, rows),
    count: cards.length,
    source: "17Lands Public Data (CC BY 4.0)",
    source_url: "https://www.17lands.com/public_datasets",
    cards
  };

  await mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${set}_${format}.json`);
  await writeFile(out, JSON.stringify(payload), "utf8");

  process.stderr.write(`完了: ${out}（${rows.toLocaleString()}試合 / ${cards.length}種）\n`);
  return { set, format, rows, cards: cards.length };
}

async function main(){
  const args = process.argv.slice(2);
  const targets = args.length >= 2 ? [[args[0].toUpperCase(), args[1]]] : DEFAULT_TARGETS;

  const done = [];
  for(const [set, format] of targets){
    try{
      done.push(await build(set, format));
    }catch(e){
      process.stderr.write(`失敗: ${set} ${format} — ${e.message}\n`);
    }
  }

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
