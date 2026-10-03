#!/usr/bin/env node
/*
 * できあがった長尺の環境まとめ動画（long/<SET>/ja.mp4）を YouTube に非公開で上げる。
 *
 *   node maintenance/youtube-upload-long.mjs TMT
 *
 * 必要な環境変数: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN_JA（ショートと同じ許可）
 * 題は long/<SET>/title.txt、概要欄（目次つき）は description.txt、サムネイルは thumbnail.jpg を使う。
 * 結果は long/<SET>/youtube.json に書く。必ず「非公開」。内容を確認したあと YouTube Studio で手で「公開」にする。
 * 依存ライブラリなし（Node 18 以上）。
 */
import { readFile, writeFile, stat } from "node:fs/promises";

const SET = (process.argv[2] || "").toUpperCase();
if(!SET){ console.error("使い方: node maintenance/youtube-upload-long.mjs <SET>"); process.exit(1); }
const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET, REFRESH = process.env.YT_REFRESH_TOKEN_JA;
if(!ID || !SECRET || !REFRESH){
  console.log("YouTube: 日本語チャンネルの許可（YT_REFRESH_TOKEN_JA）が無いので上げません。");
  process.exit(0);
}

const DIR = `long/${SET}`, FILE = `${DIR}/ja.mp4`;
const size = (await stat(FILE).catch(() => null))?.size;
if(!size){ console.error(`${FILE} がありません。先に動画を作ってください。`); process.exit(1); }
const title = (await readFile(`${DIR}/title.txt`, "utf8").catch(() => `【${SET}】環境まとめ｜MTGアリーナ リミテッド`)).trim();
const description = (await readFile(`${DIR}/description.txt`, "utf8")).trim();

async function accessToken(){
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, refresh_token: REFRESH, grant_type: "refresh_token" }) });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.access_token) throw new Error(`許可の更新に失敗しました（HTTP ${r.status}）: ${j.error_description || j.error || ""}。「YouTube 投稿許可」をやり直してください`);
  return j.access_token;
}
const token = await accessToken();
const body = {
  snippet: { title: title.slice(0, 100), description: description.slice(0, 5000),
             tags: ["MTGアリーナ", "MTGA", "マジック：ザ・ギャザリング", "リミテッド", "ドラフト", "シールド", "環境", "17Lands"],
             categoryId: "20", defaultLanguage: "ja", defaultAudioLanguage: "ja" },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false, license: "youtube" }
};
const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
  body: JSON.stringify(body) });
if(!init.ok){ console.error(`アップロードの開始に失敗しました（HTTP ${init.status}）: ${await init.text()}`); process.exit(1); }
const location = init.headers.get("location");
const data = await readFile(FILE);
const put = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(size) }, body: data });
const res = await put.json().catch(() => ({}));
if(!put.ok || !res.id){ console.error(`アップロードに失敗しました（HTTP ${put.status}）: ${JSON.stringify(res).slice(0, 500)}`); process.exit(1); }

// サムネイル。チャンネルの電話番号確認が済んでいないと 403 で断られるので、その時は Studio で手で付ける
try{
  const img = await readFile(`${DIR}/thumbnail.jpg`);
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(res.id)}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "Content-Length": String(img.length) }, body: img });
  console.log(r.ok ? "サムネイルを付けました。" : `サムネイルは付けられませんでした（HTTP ${r.status}）。Studio で thumbnail.jpg を手で付けてください。`);
}catch(e){ console.log("サムネイルの設定に失敗: " + e.message); }

const out = { set: SET, videoId: res.id, url: `https://youtu.be/${res.id}`, title, privacy: "private", uploadedAt: new Date().toISOString() };
await writeFile(`${DIR}/youtube.json`, JSON.stringify(out, null, 2), "utf8");
console.log(`YouTube に非公開で上げました: ${out.url}`);
console.log("公開するときは YouTube Studio → コンテンツ → この動画 → 公開設定を「公開」に。");
