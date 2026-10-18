#!/usr/bin/env node
/*
 * MTGアリーナのカード番号（ログに出る番号）→ カード名 の対応表を、17Lands の公開しているカード一覧から作る。役割はこれだけ。
 *   ドラフト補助・シールド補助は、ふだんは Scryfall のカード情報（arena_id）で番号からカードを特定する。
 *   ところが新しいセットは、Scryfall への番号の登録がアリーナの配信より遅れることがある（2026年10月 FRA で、配信から2週間以上たっても未登録）。
 *   そのときは、この対応表でカード名を引き、カード名で Scryfall の情報と勝率を付ける。
 *
 *   node maintenance/build-arena-ids.mjs
 *
 * 出力: data/arena-ids.json … { generated_at, sets: [...], ids: { "<番号>": "<カード名>" } }。中身が変わったときだけ書き直す
 * 対象: 紙の発売が150日前〜40日後のセット（Scryfall のセット一覧）と、同じ時期に加わったカード
 *       （そのセットのいちばん小さい番号より大きい番号のカード。別のセットから入る特別枠も、ここで拾える）
 * 通信は 17Lands のカード一覧（CSV）1回と、Scryfall のセット一覧1回。
 * 環境変数: L17_CARDS_CSV（確認用に差し替えられる）、SCRY_API
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

const CSV_URL = process.env.L17_CARDS_CSV || "https://17lands-public.s3.amazonaws.com/analysis_data/cards/cards.csv";
const SCRY = process.env.SCRY_API || "https://api.scryfall.com";
const UA = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "*/*" };
const OUT = "data/arena-ids.json";
const DAY = 86400000, BACK_DAYS = 150, AHEAD_DAYS = 40, MAX_IDS = 20000;

/* CSV（引用符の中のカンマ・改行・"" に対応） */
function parseCsv(text){
  const rows = []; let row = [], cell = "", q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){
      if(ch === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += ch;
    }else if(ch === '"') q = true;
    else if(ch === ","){ row.push(cell); cell = ""; }
    else if(ch === "\n" || ch === "\r"){ if(ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if(cell !== "" || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

async function main(){
  const now = Date.now(), iso = t => new Date(t).toISOString().slice(0, 10);
  const sr = await fetch(`${SCRY}/sets`, { headers: UA });
  if(!sr.ok) throw new Error(`Scryfall のセット一覧 HTTP ${sr.status}`);
  const recent = new Set((await sr.json()).data
    .filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at && s.released_at >= iso(now - BACK_DAYS * DAY) && s.released_at <= iso(now + AHEAD_DAYS * DAY))
    .map(s => s.code.toUpperCase()));

  const cr = await fetch(CSV_URL, { headers: UA });
  if(!cr.ok) throw new Error(`17Lands のカード一覧 HTTP ${cr.status}`);
  const rows = parseCsv(await cr.text());
  const head = rows.shift().map(h => h.trim().toLowerCase());
  const col = names => head.findIndex(h => names.includes(h));
  const iId = col(["id", "mtga_id", "grpid", "arena_id"]), iSet = col(["expansion", "set"]), iName = col(["name"]);
  if(iId < 0 || iSet < 0 || iName < 0) throw new Error(`17Lands のカード一覧の列が読めません（${head.join(",")}）`);

  const cards = rows.map(r => ({ id: +r[iId], set: String(r[iSet] || "").toUpperCase(), name: String(r[iName] || "").trim() })).filter(c => c.id > 0 && c.name);
  const inSets = cards.filter(c => recent.has(c.set));
  if(!inSets.length){ console.error(`対象のセット（${[...recent].join(" ") || "なし"}）のカードが 17Lands の一覧にまだありません。`); return; }
  const minId = Math.min(...inSets.map(c => c.id));
  let pick = cards.filter(c => c.id >= minId);
  if(pick.length > MAX_IDS) pick = inSets;            // 番号の付き方が思ったのと違うときは、対象のセットのカードだけにする
  const ids = {};
  for(const c of pick.sort((a, b) => a.id - b.id)) ids[String(c.id)] = c.name;
  const sets = [...new Set(inSets.map(c => c.set))].sort();

  const prev = JSON.parse(await readFile(OUT, "utf8").catch(() => "{}"));
  if(JSON.stringify(prev.ids || {}) === JSON.stringify(ids) && JSON.stringify(prev.sets || []) === JSON.stringify(sets)){
    console.error(`変わりはありません（${Object.keys(ids).length} 枚・${sets.join(" ")}）`); return;
  }
  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), sets, ids }) + "\n", "utf8");
  console.error(`対応表を作りました: ${Object.keys(ids).length} 枚（セット ${sets.join(" ")}、番号 ${minId} から）`);
}

main().catch(e => { console.error("対応表を作れませんでした:", e.message); process.exit(1); });
