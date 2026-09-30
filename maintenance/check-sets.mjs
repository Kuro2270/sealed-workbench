#!/usr/bin/env node
/*
 * リミテッド・ワークベンチ 月次メンテナンス
 *
 *   node maintenance/check-sets.mjs                  点検して結果を表示する
 *   node maintenance/check-sets.mjs --report out.md  結果を Markdown に書き出す
 *   node maintenance/check-sets.mjs --add msh="マーベル スーパー・ヒーローズ"
 *                                                   セット名を i18n.js の SET_JA に追記する
 *
 * 日本語のセット名は機械的に取れる元が無いので、ここだけは人が入れる。
 * 未登録のセットは点検で見つかり、Actions の「セット名を登録」から追記できる。
 *
 * Node 18 以降で動きます。外部パッケージは使いません。
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API = "https://api.scryfall.com";
const HTML = process.env.TOOL_HTML || "i18n.js";        // SET_JA がある場所
const UA = "SealedWorkbench-Maintenance/1.0";
const MONTHS_BACK = 24;      // 何か月前までのセットを対象にするか
const MIN_CARDS = 100;       // リミテッドに使えるセットの目安

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const say = s => { console.log(s); log.push(s); };

let needsAttention = false;

async function api(pathname){
  await sleep(150);                       // Scryfall のリクエスト間隔ガイドラインに合わせる
  const res = await fetch(API + pathname, {
    headers: { "User-Agent": UA, "Accept": "application/json" }
  });
  if(res.status === 404) return null;
  if(!res.ok) throw new Error(`${pathname} が HTTP ${res.status} を返しました`);
  return res.json();
}

/* ---------- i18n.js から登録済みのセット名を読む ---------- */
async function readSetJa(file){
  const src = await readFile(file, "utf8");
  const m = src.match(/const SET_JA = \{([\s\S]*?)\n[ \t]*\};/);     // 閉じ括弧は字下げされていてもよい
  if(!m) throw new Error(`${file} の中に SET_JA の定義が見つかりませんでした`);
  // 1行に複数のセットが並ぶことがあるので、行頭ではなく「コード:"名前"」の組をすべて拾う
  const codes = new Set();
  for(const k of m[1].matchAll(/(?:^|[,{\s])([a-z0-9]+)\s*:\s*"/gi)) codes.add(k[1].toLowerCase());
  return { src, block: m[0], codes };
}

/* ---------- 対象セットを調べる ---------- */
async function listSets(){
  const data = await api("/sets");
  const today = new Date();
  const limit = new Date(today);
  limit.setMonth(limit.getMonth() - MONTHS_BACK);
  const iso = d => d.toISOString().slice(0, 10);

  return data.data.filter(s =>
    ["expansion", "core"].includes(s.set_type) &&
    s.released_at &&
    s.released_at <= iso(today) &&
    s.released_at >= iso(limit) &&
    s.card_count > MIN_CARDS
  );
}

/* ---------- セット単位の点検 ---------- */
async function inspect(code){
  const result = { booster: 0, ja: 0, image: false, rarities: [] };

  const queries = [
    `set:${code} is:booster -is:extra`,
    `set:${code} is:booster`,
    `set:${code} -is:extra`,
    `set:${code}`
  ];
  for(const q of queries){
    const d = await api("/cards/search?q=" + encodeURIComponent(q) + "&unique=cards");
    if(d && d.total_cards){
      result.booster = d.total_cards;
      result.rarities = [...new Set(d.data.map(c => c.rarity))];
      const sample = d.data.find(c => c.image_uris || c.card_faces);
      result.image = Boolean(sample && (sample.image_uris?.normal || sample.card_faces?.[0]?.image_uris?.normal));
      result.query = q;
      break;
    }
  }

  const ja = await api("/cards/search?q=" + encodeURIComponent(`set:${code} lang:ja`) +
                       "&unique=prints&include_multilingual=true");
  result.ja = ja ? ja.total_cards : 0;

  return result;
}

/* ---------- セット名を SET_JA に追記する ---------- */
async function addSetName(file, code, name){
  const { src, block } = await readSetJa(file);
  if(new RegExp(`^\\s*${code}\\s*:`, "mi").test(block)){
    say(`⚠ ${code} はすでに登録されています。追記しませんでした。`);
    return;
  }
  // 閉じ括弧の直前に1行足す。字下げは既存の行に合わせる
  const indent = (block.match(/\n([ \t]*)[a-z0-9]+\s*:/i) || [, "  "])[1];
  const updated = block.replace(/,?\s*\n([ \t]*)\};$/, `,\n${indent}${code}:"${name.replace(/"/g, "\u201d")}"\n$1};`);
  await writeFile(file, src.replace(block, updated), "utf8");
  say(`✓ ${code} に「${name}」を追記しました。`);
}

/* ---------- 本体 ---------- */
async function main(){
  const args = process.argv.slice(2);
  const file = path.resolve(HTML);

  const add = args.find(a => a.startsWith("--add"));
  if(add){
    const val = add.includes("=") ? add.slice(add.indexOf("=") + 1) : args[args.indexOf(add) + 1];
    const [code, ...rest] = String(val).split("=");
    const name = rest.join("=").replace(/^["']|["']$/g, "");
    if(!code || !name){
      console.error('使い方: node maintenance/check-sets.mjs --add msh="セット名"');
      process.exit(1);
    }
    await addSetName(file, code.toLowerCase().replace(/^["']/, ""), name);
    return;
  }

  say(`# リミテッド・ワークベンチ 点検結果（${new Date().toISOString().slice(0, 10)}）`);
  say("");

  const { codes } = await readSetJa(file);
  say(`登録済みのセット名: ${codes.size}件`);

  const sets = await listSets();
  say(`直近${MONTHS_BACK}か月の対象セット: ${sets.length}件`);
  say("");

  const missing = sets.filter(s => !codes.has(s.code.toLowerCase()));

  if(missing.length){
    needsAttention = true;
    say("## 日本語のセット名が未登録");
    say("");
    say("公式サイト（https://mtg-jp.com/products/）で正式な表記を確認して、Actions の「セット名を登録」を実行してください。");
    say("登録するまでは英語名で表示されます（動作には支障ありません）。");
    say("");
    for(const s of missing){
      say(`- **${s.code.toUpperCase()}**（${s.name}）→ code=\`${s.code}\`、name=日本語の正式名称`);
    }
    say("");
    say("| コード | 英語名 | 発売日 | 収録枚数 |");
    say("| --- | --- | --- | --- |");
    for(const s of missing){
      say(`| ${s.code.toUpperCase()} | ${s.name} | ${s.released_at} | ${s.card_count} |`);
    }
    say("");
  }else{
    say("## 日本語のセット名");
    say("");
    say("未登録のセットはありません。");
    say("");
  }

  // 最新3セットの動作点検
  say("## 動作点検（最新3セット）");
  say("");
  say("| コード | 取得件数 | レアリティ | 日本語版 | 画像 |");
  say("| --- | --- | --- | --- | --- |");
  for(const s of sets.slice(0, 3)){
    try{
      const r = await inspect(s.code);
      const rarOk = ["common", "uncommon", "rare"].every(x => r.rarities.includes(x));
      if(!r.booster || !rarOk || !r.image) needsAttention = true;
      say(`| ${s.code.toUpperCase()} | ${r.booster} | ${rarOk ? "OK" : "⚠ 不足"} | ${r.ja} | ${r.image ? "OK" : "⚠ なし"} |`);
    }catch(e){
      needsAttention = true;
      say(`| ${s.code.toUpperCase()} | ⚠ ${e.message} | | | |`);
    }
  }
  say("");

  if(needsAttention){
    say("対応が必要な項目があります。");
  }else{
    say("問題は見つかりませんでした。");
  }

  const rep = args.indexOf("--report");
  if(rep >= 0 && args[rep + 1]){
    await writeFile(args[rep + 1], log.join("\n") + "\n", "utf8");
  }

  process.exit(needsAttention ? 1 : 0);
}

main().catch(e => {
  console.error("点検中にエラーが起きました:", e.message);
  process.exit(2);
});
