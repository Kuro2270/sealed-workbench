/*
 * セット名を引く（YouTube への投稿で、題・概要欄・タグに使う）。
 *   日本語は i18n.js の SET_JA、英語は data/names/<SET>.json のセット名。
 *   どちらかが無ければもう片方、両方無ければセットコードを返す。
 *   長いセット名（「Magic: The Gathering | ○○」など）は後半だけにする（タイトルが一覧で切れないように）。
 * 役割はこれだけ。ショート（youtube-upload.mjs）と長尺（youtube-upload-long.mjs）の両方から使う。
 */
import { readFile } from "node:fs/promises";

export const shortName = n => {
  const m = String(n).replace(/^Magic:\s*The Gathering\s*[:|｜-]?\s*/i, "").split(/\s*[｜|]\s*/);
  return (m[m.length - 1] || "").trim() || String(n);
};

/* { ja, en } … 元のままのセット名 */
export async function fullSetName(set){
  const SET = String(set).toUpperCase();
  let ja = null, en = null;
  try{
    const src = await readFile("i18n.js", "utf8");
    const m = src.match(/const SET_JA = (\{[\s\S]*?\});/);
    if(m) ja = new Function("return " + m[1])()[SET.toLowerCase()];
  }catch(e){}
  try{ const n = JSON.parse(await readFile(`data/names/${SET}.json`, "utf8")); en = n.set || n.setName || null; }catch(e){}
  return { ja: ja || en || SET, en: en || ja || SET };
}

/* { ja, en } … 題やタグに使う短いセット名 */
export async function setName(set){
  const n = await fullSetName(set);
  return { ja: shortName(n.ja), en: shortName(n.en) };
}
