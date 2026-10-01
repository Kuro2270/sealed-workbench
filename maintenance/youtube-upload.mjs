#!/usr/bin/env node
/*
 * できあがった環境まとめ動画を YouTube に上げる（非公開で）。
 *
 *   node maintenance/youtube-upload.mjs HOB            … short/HOB/ja.mp4 を日本語チャンネルへ
 *   node maintenance/youtube-upload.mjs HOB en         … short/HOB/en.mp4 を英語チャンネルへ（英語版ができてから）
 *
 * 必要な環境変数
 *   YT_CLIENT_ID, YT_CLIENT_SECRET            … Google Cloud の OAuth クライアント
 *   YT_REFRESH_TOKEN_JA / YT_REFRESH_TOKEN_EN … 「YouTube 投稿許可」で取ったチャンネルの許可
 *   SITE_URL                                   … 既定 https://sealed-workbench.com
 *
 * 結果は short/<SET>/<lang>.youtube.json に書く（動画ID・URL・上げた日時）。
 *
 * 必ず「非公開」で上げる。Google の審査を受けていないアプリからの動画は非公開から変えられないので、
 * 内容を確認したあと YouTube Studio で手で「公開」にする。
 * 依存ライブラリなし（Node 18 以上）。
 */

import { readFile, writeFile, stat } from "node:fs/promises";

const SET = (process.argv[2] || "").toUpperCase();
const LANG = (process.argv[3] || "ja").toLowerCase();
if(!SET){ console.error("使い方: node maintenance/youtube-upload.mjs <SET> [ja|en]"); process.exit(1); }

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET;
const REFRESH = process.env[`YT_REFRESH_TOKEN_${LANG.toUpperCase()}`];
if(!ID || !SECRET || !REFRESH){
  console.log(`YouTube: ${LANG} チャンネルの許可（YT_REFRESH_TOKEN_${LANG.toUpperCase()}）が無いので上げません。`);
  process.exit(0);
}

const FILE = `short/${SET}/${LANG}.mp4`;
const size = (await stat(FILE).catch(() => null))?.size;
if(!size){ console.error(`${FILE} がありません。先に動画を作ってください。`); process.exit(1); }

/* セット名（日本語は i18n.js の SET_JA、英語は記事データのセット名） */
async function setName(){
  let ja = null;
  try{
    const src = await readFile("i18n.js", "utf8");
    const m = src.match(/const SET_JA = (\{[\s\S]*?\});/);
    if(m) ja = new Function("return " + m[1])()[SET.toLowerCase()];
  }catch(e){}
  let en = null;
  try{ const n = JSON.parse(await readFile(`data/names/${SET}.json`, "utf8")); en = n.set || n.setName || null; }catch(e){}
  return { ja: ja || en || SET, en: en || ja || SET };
}
const name = await setName();
let games = 0, mode = "draft";
try{
  const d = JSON.parse(await readFile(`data/articles/${SET}_draft.json`, "utf8").catch(() => readFile(`data/articles/${SET}_sealed.json`, "utf8")));
  games = d.total_games || 0; mode = d.mode || "draft";
}catch(e){}
const gamesTxt = games ? games.toLocaleString(LANG === "ja" ? "ja-JP" : "en-US") : "";

const pageUrl = `${SITE}/sets/${SET}${LANG === "en" ? ".en" : ""}.html`;
const meta = LANG === "ja" ? {
  title: `【${name.ja}】1分でわかるリミテッド環境｜MTGアリーナ #Shorts`,
  description: [
    `MTGアリーナ『${name.ja}』のリミテッド（${mode === "sealed" ? "シールド" : "ドラフト"}）環境を、${gamesTxt ? gamesTxt + "試合の" : ""}実戦データから1分でまとめました。`,
    ``,
    `▼ 全カードの勝率・環境レポート（無料）`,
    pageUrl,
    ``,
    `▼ シールド／ドラフトの構築練習・対戦卓（無料・登録なし）`,
    SITE,
    ``,
    `データ: 17Lands Public Data（CC BY 4.0） https://www.17lands.com/`,
    `音声: VOICEVOX:ずんだもん`,
    `カード画像・マナシンボル: Scryfall`,
    ``,
    `Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.`,
    ``,
    `#MTGアリーナ #MTGA #リミテッド #${name.ja.replace(/[\s・]/g, "")}`
  ].join("\n"),
  tags: ["MTGアリーナ", "MTGA", "マジック：ザ・ギャザリング", "リミテッド", "ドラフト", "シールド", name.ja, "17Lands"]
} : {
  title: `${name.en} Limited in 60 seconds | MTG Arena #Shorts`,
  description: [
    `The ${name.en} Limited (${mode}) format on MTG Arena, summarised in one minute from ${gamesTxt ? gamesTxt + " games of " : ""}real match data.`,
    ``,
    `▼ Every card's win rate and the full format report (free)`,
    pageUrl,
    ``,
    `▼ Sealed / Draft practice and the play table (free, no sign-up)`,
    SITE,
    ``,
    `Data: 17Lands Public Data (CC BY 4.0) https://www.17lands.com/`,
    `Card images and mana symbols: Scryfall`,
    ``,
    `Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.`,
    ``,
    `#MTGArena #MTGA #MTGLimited`
  ].join("\n"),
  tags: ["MTG Arena", "MTGA", "Magic: The Gathering", "Limited", "Draft", "Sealed", name.en, "17Lands"]
};

/* 許可から短命のアクセストークンをもらう */
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
  snippet: { title: meta.title.slice(0, 100), description: meta.description.slice(0, 5000), tags: meta.tags, categoryId: "20", defaultLanguage: LANG, defaultAudioLanguage: LANG },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false, license: "youtube" }
};
// 1) 送り先をもらう（再開可能アップロード）
const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
             "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
  body: JSON.stringify(body) });
if(!init.ok){ console.error(`アップロードの開始に失敗しました（HTTP ${init.status}）: ${await init.text()}`); process.exit(1); }
const location = init.headers.get("location");
// 2) 本体を送る
const data = await readFile(FILE);
const put = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(size) }, body: data });
const res = await put.json().catch(() => ({}));
if(!put.ok || !res.id){ console.error(`アップロードに失敗しました（HTTP ${put.status}）: ${JSON.stringify(res).slice(0, 500)}`); process.exit(1); }

const out = { set: SET, lang: LANG, videoId: res.id, url: `https://youtu.be/${res.id}`, shortsUrl: `https://www.youtube.com/shorts/${res.id}`,
              title: meta.title, privacy: "private", uploadedAt: new Date().toISOString() };
await writeFile(`short/${SET}/${LANG}.youtube.json`, JSON.stringify(out, null, 2), "utf8");
// サイト用の一覧にも記録しておく（まだ非公開なので public: false。「動画を配信」で true にするとセットページに載る）
{
  let all = {};
  try{ all = JSON.parse(await readFile("data/videos.json", "utf8")); }catch(e){}
  all[SET] = all[SET] || {};
  all[SET][LANG] = { id: res.id, mode, title: meta.title, uploadedAt: out.uploadedAt.slice(0, 10), public: false };
  await writeFile("data/videos.json", JSON.stringify(all, null, 2) + "\n", "utf8");
}
console.log(`YouTube に非公開で上げました: ${out.url}`);
console.log(`タイトル: ${meta.title}`);
console.log(`公開するときは YouTube Studio → コンテンツ → この動画 → 公開設定を「公開」に。`);
