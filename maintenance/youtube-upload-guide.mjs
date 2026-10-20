#!/usr/bin/env node
/*
 * できあがった解説動画（guide-video/<名前>/out/<ja|en>/<ja|en>.mp4）を YouTube に非公開で上げる。役割はこれだけ。
 *
 *   node maintenance/youtube-upload-guide.mjs beginner        … 日本語（YT_REFRESH_TOKEN_JA のチャンネルへ）
 *   node maintenance/youtube-upload-guide.mjs beginner en     … 英語（YT_REFRESH_TOKEN_EN のチャンネルへ）
 *
 * 必要な環境変数: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN_JA / YT_REFRESH_TOKEN_EN（長尺・ショートと同じ許可）
 * 題は out/<lang>/title.txt、概要欄（目次つき）は description.txt、サムネイルは thumbnail.jpg、タグは台本（<lang>.json）の tags を使う。
 * 結果は out/<lang>/youtube.json に書く。必ず「非公開」。内容を確認したあと YouTube Studio で手で「公開」にする。
 * 上げる手順は長尺（youtube-upload-long.mjs）と同じ。依存ライブラリなし（Node 18 以上）。
 */
import { readFile, writeFile, stat } from "node:fs/promises";

const NAME = String(process.argv[2] || "").replace(/[^A-Za-z0-9_-]/g, "");
const LANG = (process.argv[3] || "ja").toLowerCase(), EN = LANG === "en";
if(!NAME || !["ja", "en"].includes(LANG)){ console.error("使い方: node maintenance/youtube-upload-guide.mjs <名前> [ja|en]"); process.exit(1); }
const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET, REFRESH = process.env[`YT_REFRESH_TOKEN_${LANG.toUpperCase()}`];
if(!ID || !SECRET || !REFRESH){
  console.log(`YouTube: ${EN ? "英語" : "日本語"}チャンネルの許可（YT_REFRESH_TOKEN_${LANG.toUpperCase()}）が無いので上げません。`);
  process.exit(0);
}

const DIR = `guide-video/${NAME}/out/${LANG}`, FILE = `${DIR}/${LANG}.mp4`;
const size = (await stat(FILE).catch(() => null))?.size;
if(!size){ console.error(`${FILE} がありません。先に動画を作ってください。`); process.exit(1); }
const book = JSON.parse(await readFile(`guide-video/${NAME}/${LANG}.json`, "utf8"));
const title = (await readFile(`${DIR}/title.txt`, "utf8").catch(() => book.title || NAME)).trim();
const description = (await readFile(`${DIR}/description.txt`, "utf8")).trim();
const tags = [...new Set((book.tags || []).filter(t => t && String(t).trim()))];

async function accessToken(){
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, refresh_token: REFRESH, grant_type: "refresh_token" }) });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.access_token) throw new Error(`許可の更新に失敗しました（HTTP ${r.status}）: ${j.error_description || j.error || ""}。「YouTube 投稿許可」をやり直してください`);
  return j.access_token;
}
let token = await accessToken();
const body = {
  snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), tags,
             categoryId: "20", defaultLanguage: LANG, defaultAudioLanguage: LANG },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false, license: "youtube" }
};
// 開始の手続き。401・5xx は一時的なことがあるので、許可を取り直して3回まで試す（長尺と同じ）
let init = null;
for(let n = 1; n <= 3; n++){
  init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify(body) });
  if(init.ok) break;
  const txt = await init.text();
  console.error(`アップロードの開始に失敗しました（HTTP ${init.status}、${n}回目）: ${txt.slice(0, 400)}`);
  if(n === 3 || !(init.status === 401 || init.status >= 500)) break;
  await new Promise(r => setTimeout(r, 15000 * n));
  token = await accessToken();
}
if(!init.ok){
  if(init.status === 401 || init.status === 403) console.error(`\n→ 許可（YT_REFRESH_TOKEN_${LANG.toUpperCase()}）が、${EN ? "英語" : "日本語"}チャンネルの投稿に使えない状態かもしれません。続くなら Actions の「YouTube 投稿許可」をやり直してください。動画は作ってあるので、Artifacts からダウンロードして Studio で手で上げることもできます。`);
  process.exit(1);
}
const location = init.headers.get("location");
const data = await readFile(FILE);
const put = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(size) }, body: data });
const res = await put.json().catch(() => ({}));
if(!put.ok || !res.id){ console.error(`アップロードに失敗しました（HTTP ${put.status}）: ${JSON.stringify(res).slice(0, 500)}`); process.exit(1); }

// サムネイル（長尺と同じ。断られたら Studio で手で付ける）
try{
  const img = await readFile(`${DIR}/thumbnail.jpg`);
  let r = null, tok = token;
  for(let n = 1; n <= 3; n++){
    r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(res.id)}`, {
      method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "image/jpeg", "Content-Length": String(img.length) }, body: img });
    if(r.ok || !(r.status === 401 || r.status >= 500) || n === 3) break;
    await new Promise(res => setTimeout(res, 10000 * n));
    tok = await accessToken().catch(() => tok);
  }
  console.log(r.ok ? "サムネイルを付けました。" : `サムネイルは付けられませんでした（HTTP ${r.status}）。Studio で thumbnail.jpg を手で付けてください。`);
}catch(e){ console.log("サムネイルの設定に失敗: " + e.message); }

const out = { guide: NAME, lang: LANG, videoId: res.id, url: `https://youtu.be/${res.id}`, title, privacy: "private", uploadedAt: new Date().toISOString() };
await writeFile(`${DIR}/youtube.json`, JSON.stringify(out, null, 2), "utf8");
console.log(`YouTube に非公開で上げました: ${out.url}`);
console.log("公開するときは YouTube Studio → コンテンツ → この動画 → 公開設定を「公開」に。");
