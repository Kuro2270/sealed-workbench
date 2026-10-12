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

import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { setName } from "./set-name.mjs";

const SET = (process.argv[2] || "").toUpperCase();
const LANG = (process.argv[3] || "ja").toLowerCase();
const MODE = (process.argv[4] || "draft").toLowerCase();
const TAG = MODE === "draft" ? LANG : `${LANG}-${MODE}`;
if(!SET || !["draft", "sealed", "early"].includes(MODE)){ console.error("使い方: node maintenance/youtube-upload.mjs <SET> [ja|en] [draft|sealed|early]"); process.exit(1); }
const EARLY = MODE === "early";   // 先行版（発売直後。データは 17Lands のカード勝率・色別勝率。サイトにはまだ載っていない）

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET;
const REFRESH = process.env[`YT_REFRESH_TOKEN_${LANG.toUpperCase()}`];
if(!ID || !SECRET || !REFRESH){
  console.log(`YouTube: ${LANG} チャンネルの許可（YT_REFRESH_TOKEN_${LANG.toUpperCase()}）が無いので上げません。`);
  process.exit(0);
}

const FILE = `short/${SET}/${TAG}.mp4`;
const size = (await stat(FILE).catch(() => null))?.size;
if(!size){ console.error(`${FILE} がありません。先に動画を作ってください。`); process.exit(1); }

const name = await setName(SET);   // maintenance/set-name.mjs（長いセット名は後半だけ）
let games = 0, mode = MODE;
try{ const d = JSON.parse(await readFile(`data/articles/${SET}_${MODE}.json`, "utf8")); games = d.total_games || 0; }catch(e){}
const bgmCredit = (await readFile(`short/${SET}/${TAG}/bgm.txt`, "utf8").catch(() => "")).trim();
const gamesTxt = games ? games.toLocaleString(LANG === "ja" ? "ja-JP" : "en-US") : "";

const pageUrl = `${SITE}/sets/${SET}${LANG === "en" ? ".en" : ""}.html`;
const meta = EARLY ? (LANG === "ja" ? {
  title: `【${name.ja}】速報！発売直後のリミテッド環境を1分で｜MTGアリーナ #Shorts`,
  description: [
    `MTGアリーナ『${name.ja}』のリミテッド環境を、発売直後${gamesTxt ? "・" + gamesTxt + "試合時点" : ""}のデータ（ドラフトとシールドを合算）から速報でまとめました。`,
    `まだ序盤のデータなので、順位はこれから動きます。確定版（ドラフト／シールド）は、データが揃う約2週間後に出します。`,
    ``,
    `▼ 環境レポート・シールド／ドラフトの構築練習（無料・登録なし）`,
    SITE,
    ``,
    `データ: 17Lands（カード勝率・色別勝率） https://www.17lands.com/`,
    `音声: VOICEVOX:ずんだもん`,
    ...(bgmCredit ? [`BGM: ${bgmCredit}`] : []),
    `カード画像・マナシンボル: Scryfall`,
    ``,
    `Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.`,
    ``,
    `#MTGアリーナ #MTGA #リミテッド #${name.ja.replace(/[\s・]/g, "")}`
  ].join("\n"),
  tags: ["MTGアリーナ", "MTGA", "マジック：ザ・ギャザリング", "リミテッド", "ドラフト", "速報", name.ja, "17Lands"]
} : {
  title: `${name.en} Limited: Early Look in 60 seconds | MTG Arena #Shorts`,
  description: [
    `An early look at the ${name.en} Limited format on MTG Arena, from the first days of data${gamesTxt ? " (" + gamesTxt + " games so far, Draft and Sealed combined)" : " (Draft and Sealed combined)"}.`,
    `Rankings will move as more games come in. The full review (Draft and Sealed) follows in about two weeks.`,
    ``,
    `▼ Format reports, Sealed / Draft practice and the play table (free, no sign-up)`,
    SITE,
    ``,
    `Data: 17Lands (card and colour win rates) https://www.17lands.com/`,
    `Card images and mana symbols: Scryfall`,
    `Character: Shikoku Metan (VOICEVOX / Tohoku Zunko project; illustration by Sakamoto Ahiru, recoloured)`,
    ``,
    `Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.`,
    ``,
    `#MTGArena #MTGA #MTGLimited`
  ].join("\n"),
  tags: ["MTG Arena", "MTGA", "Magic: The Gathering", "Limited", "Draft", "Early look", name.en, "17Lands"]
}) : LANG === "ja" ? {
  title: `【${name.ja}】1分でわかるリミテッド環境（${mode === "sealed" ? "シールド" : "ドラフト"}）｜MTGアリーナ #Shorts`,
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
    ...(bgmCredit ? [`BGM: ${bgmCredit}`] : []),
    `カード画像・マナシンボル: Scryfall`,
    ``,
    `Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.`,
    ``,
    `#MTGアリーナ #MTGA #リミテッド #${name.ja.replace(/[\s・]/g, "")}`
  ].join("\n"),
  tags: ["MTGアリーナ", "MTGA", "マジック：ザ・ギャザリング", "リミテッド", "ドラフト", "シールド", name.ja, "17Lands"]
} : {
  title: `${name.en} ${mode === "sealed" ? "Sealed" : "Draft"} in 60 seconds | MTG Arena #Shorts`,
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
    `Character: Shikoku Metan (VOICEVOX / Tohoku Zunko project; illustration by Sakamoto Ahiru, recoloured)`,
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

// サムネイル（冒頭のタイトル場面）。YouTube 側にも付ける。
//   短い動画（ショート）でも API では付けられる。チャンネルの電話番号確認が済んでいないと 403 で断られるので、その時はサイト側だけ。
//   使う画像は、1080×1920 の short/<SET>/<TAG>.thumbnail.jpg（workflow が冒頭の場面から作る）。無ければサイト用の assets/video/<SET>-<TAG>.jpg（540×960）
const posterPath = `assets/video/${SET}-${TAG}.jpg`;
const poster = (await stat(posterPath).catch(() => null)) ? posterPath : null;
const thumbPath = `short/${SET}/${TAG}.thumbnail.jpg`;
const thumb = (await stat(thumbPath).catch(() => null)) ? thumbPath : poster;
if(thumb){
  try{
    const img = await readFile(thumb);
    let r = null, tok = token;
    for(let n = 1; n <= 3; n++){
      r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(res.id)}`, {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "image/jpeg", "Content-Length": String(img.length) }, body: img });
      if(r.ok || !(r.status === 401 || r.status >= 500) || n === 3) break;
      // 発行したばかりのトークンを YouTube が一時的に断ることがある（英語チャンネルで確認）。待って取り直す
      console.log(`サムネイル: HTTP ${r.status} なので ${10 * n} 秒待ってトークンを取り直します（${n}回目）`);
      await new Promise(res => setTimeout(res, 10000 * n));
      tok = await accessToken().catch(() => tok);
    }
    if(r.ok) console.log(`YouTube のサムネイルを冒頭の場面にしました（${thumb}）。`);
    else console.log(`YouTube のサムネイルは変えられませんでした（HTTP ${r.status}: ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}）。${r.status === 403 ? "チャンネルの電話番号確認が済むと使えます。" : ""}Artifacts の thumbnail.jpg を Studio で手で付けてください。`);
  }catch(e){ console.log("YouTube のサムネイル設定に失敗: " + e.message); }
}

const out = { set: SET, lang: LANG, mode, videoId: res.id, poster, url: `https://youtu.be/${res.id}`, shortsUrl: `https://www.youtube.com/shorts/${res.id}`,
              title: meta.title, privacy: "private", uploadedAt: new Date().toISOString() };
await writeFile(`short/${SET}/${TAG}.youtube.json`, JSON.stringify(out, null, 2), "utf8");
// サイト用の記録は 1本ごとの小さなファイルに置く（同時に動画を作っても衝突しない）。「動画を配信」がまとめて取り込む
{
  await mkdir("data/videos", { recursive: true });
  await writeFile(`data/videos/${SET}-${LANG}-${mode}.json`, JSON.stringify({ set: SET, lang: LANG, mode, id: res.id, title: meta.title, poster, uploadedAt: out.uploadedAt.slice(0, 10) }, null, 2) + "\n", "utf8");
}
console.log(`YouTube に非公開で上げました: ${out.url}`);
console.log(`タイトル: ${meta.title}`);
console.log(`公開するときは YouTube Studio → コンテンツ → この動画 → 公開設定を「公開」に。`);
