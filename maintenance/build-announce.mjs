#!/usr/bin/env node
/*
 * 新しいセットのデータが揃ったら、告知文の下書きを作る。
 *
 *   node maintenance/build-announce.mjs
 *
 * 出力: announce.md（中身があるときだけ。無ければ終了コード 0 で何も出さない）
 *
 * ・data/ratings/index.json と、前回までの記録（data/announced.json）を比べて
 *   新しく加わったセットを見つける
 * ・そのセットの上位カードを添えて、日本語と英語の投稿文案を作る
 * ・投稿そのものは人が行う。文面は必ず目を通してから使うこと。
 */

import { readFile, writeFile } from "node:fs/promises";
import { readEventRatings } from "./ratings-files.mjs";

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const RATINGS = "data/ratings";
const SEEN = "data/announced.json";

const EV_JA = {
  PremierDraft:"プレミアドラフト", TradDraft:"トラディショナルドラフト",
  Sealed:"シールド", TradSealed:"トラディショナルシールド", PickTwoDraft:"2枚ピックドラフト"
};

async function readJson(path, fallback){
  try{ return JSON.parse(await readFile(path, "utf8")); }
  catch(e){ return fallback; }
}

/* セットの上位カードを取り出す */
async function topCards(set, event, n = 3){
  const d = await readEventRatings(set, event);
  if(!d || !Array.isArray(d.cards)) return [];
  return d.cards
    .filter(c => c.gih != null && c.games >= 500)
    .sort((a, b) => b.gih - a.gih)
    .slice(0, n)
    .map(c => ({ name: c.name, pct: (c.gih * 100).toFixed(1) }));
}

function draftJa(set, games, cards){
  const list = cards.map(c => `${c.name}（${c.pct}%）`).join("、");
  return [
    `【${set} のデータを追加しました】`,
    "",
    `MTGアリーナのリミテッドを無料で練習できるツールに、${set} のカード勝率を追加しました。`,
    `17Landsの公開データから ${games.toLocaleString()}試合分を集計しています。`,
    "",
    cards.length ? `現時点のGIH勝率トップ3：${list}` : "",
    "",
    `シールドやドラフトの練習もできます。`,
    SITE,
    "",
    "#MTGアリーナ #リミテッド #MTGJP"
  ].filter(l => l !== "").join("\n");
}

function draftEn(set, games, cards){
  const list = cards.map(c => `${c.name} (${c.pct}%)`).join(", ");
  return [
    `${set} data is now up on Limited Workbench.`,
    "",
    `Free MTG Arena Limited practice — sealed, draft, and per-card win rates`,
    `aggregated from ${games.toLocaleString()} games of 17Lands public data.`,
    "",
    cards.length ? `Top GIH WR right now: ${list}` : "",
    "",
    SITE,
    "",
    "#MTGArena #MTGLimited"
  ].filter(l => l !== "").join("\n");
}

async function main(){
  const index = await readJson(`${RATINGS}/index.json`, null);
  if(!index || !Array.isArray(index.datasets)){
    process.stderr.write("集計データが見つかりません。先に build-ratings を実行してください。\n");
    return;
  }

  const seen = new Set((await readJson(SEEN, { sets: [] })).sets);
  const sets = [...new Set(index.datasets.map(d => d.set))];
  const fresh = sets.filter(s => !seen.has(s));

  if(!fresh.length){
    process.stderr.write("新しいセットはありません。\n");
    return;
  }

  const blocks = [];
  for(const set of fresh){
    const rows = index.datasets.filter(d => d.set === set);
    const main = rows.find(r => r.event === "PremierDraft") || rows[0];
    const games = rows.reduce((n, r) => n + (r.total_games || 0), 0);
    const cards = await topCards(set, main.event, 3);
    const evs = rows.map(r => EV_JA[r.event] || r.event).join("、");

    blocks.push([
      `## ${set}`,
      "",
      `- 取り込んだ形式：${evs}`,
      `- 集計した試合数：${games.toLocaleString()}`,
      `- 主な形式：${EV_JA[main.event] || main.event}（${(main.total_games || 0).toLocaleString()}試合）`,
      "",
      "### 日本語（X向け）",
      "",
      "```",
      draftJa(set, games, cards),
      "```",
      "",
      "### English (X / Reddit / Discord)",
      "",
      "```",
      draftEn(set, games, cards),
      "```",
      ""
    ].join("\n"));
  }

  const body = [
    `${fresh.join("、")} のデータが揃いました。告知文の下書きです。`,
    "",
    "**そのまま投稿せず、必ず目を通してから使ってください。**",
    "セット名の表記、カード名の日本語、ハッシュタグの当たりは確認が必要です。",
    "",
    "投稿先の候補：X、17Lands の Discord、r/lrcast（各コミュニティのルールを確認のうえで）",
    "",
    ...blocks
  ].join("\n");

  await writeFile("announce.md", body, "utf8");
  await writeFile("announce.json", JSON.stringify({ sets: fresh }), "utf8");   // 自動投稿が読む
  await writeFile(SEEN, JSON.stringify({ updated_at: new Date().toISOString(), sets: [...seen, ...fresh] }), "utf8");

  process.stderr.write(`告知文案を作成: ${fresh.join(", ")}\n`);
}

main().catch(e => {
  console.error("告知文案の作成に失敗しました:", e.message);
  process.exit(1);
});
