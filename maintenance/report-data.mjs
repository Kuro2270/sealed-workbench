#!/usr/bin/env node
/*
 * 環境レポートの材料（記事データと勝率一覧）を、確定版 → 暫定版の順に探して読む。役割はこれだけ。
 *   ・確定版：公開データセットから作ったもの（data/articles/<SET>_<形式>.json と data/ratings/<SET>_PremierDraft.json / _Sealed.json）
 *   ・暫定版：17Lands の毎日の集計から作ったもの（data/provisional/<SET>_<形式>.json と data/ratings/<SET>_<形式>.json。provisional: true）
 *     確定版が出るまでのつなぎ。ゲームごとのデータが無いので、速さ（speed・verdict・avg_turns・pair_speed・pair_curve）は入っていない
 * 長尺動画（build-long.mjs）と、X の投稿文（x-post-draft.mjs）から使う。
 *
 *   node maintenance/report-data.mjs FRA   … ドラフトとシールドがそろっているか、確定版か暫定版かを表示する（そろっていなければ終了コード 1）
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const EVENT = { draft: "PremierDraft", sealed: "Sealed" };
const readJson = async p => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return null; } };

/* 1つの形式（draft / sealed）の材料。{ article, ratings, provisional } か null */
export async function loadReport(set, mode){
  const S = String(set).toUpperCase();
  const article = await readJson(`data/articles/${S}_${mode}.json`), ratings = await readJson(`data/ratings/${S}_${EVENT[mode]}.json`);
  if(article && ratings) return { article, ratings, provisional: false };
  const pa = await readJson(`data/provisional/${S}_${mode}.json`), pr = await readJson(`data/ratings/${S}_${mode}.json`);
  if(pa && pr && pr.provisional) return { article: pa, ratings: pr, provisional: true };
  return null;
}

/* 記事データだけ（X の投稿文など）。確定版が無ければ暫定版。無ければ null */
export async function loadArticle(set, mode){
  const S = String(set).toUpperCase();
  return (await readJson(`data/articles/${S}_${mode}.json`)) || (await readJson(`data/provisional/${S}_${mode}.json`));
}

if(import.meta.url === pathToFileURL(process.argv[1] || "").href){
  const set = (process.argv[2] || "").toUpperCase();
  if(!set){ console.error("使い方: node maintenance/report-data.mjs <SET>"); process.exit(1); }
  const d = await loadReport(set, "draft"), s = await loadReport(set, "sealed");
  const say = (m, r) => r ? `${m}: ${r.provisional ? "暫定版" : "確定版"}（${(r.article.total_games || 0).toLocaleString()} 試合）` : `${m}: なし`;
  console.log(say("ドラフト", d)); console.log(say("シールド", s));
  if(!d || !s) process.exit(1);
  if(d.provisional !== s.provisional) console.log("::warning::ドラフトとシールドで、確定版と暫定版が混ざっています");
}
