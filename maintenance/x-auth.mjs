#!/usr/bin/env node
/*
 * X（旧Twitter）で、投稿先のアカウントがアプリに「投稿してよい」と許可を出し、
 * そのアカウント名義のアクセストークンを受け取る（OAuth 1.0a の PIN 方式）。
 *
 * 使い方（GitHub Actions「X 投稿許可」から実行する想定）
 *   1) 開始：  node maintenance/x-auth.mjs start
 *        → 許可用のURLと、引き換え用の一時トークン2つを表示する
 *   2) 完了：  PIN=1234567 REQ_TOKEN=... REQ_SECRET=... node maintenance/x-auth.mjs finish
 *        → 投稿先アカウント名義の ACCESS_TOKEN / ACCESS_SECRET を表示する
 *
 * 必要な環境変数： X_API_KEY, X_API_SECRET（開発者コンソールのコンシューマーキー）
 * 依存ライブラリなし（Node 18 以上）。
 */

import crypto from "node:crypto";

const KEY = process.env.X_API_KEY, SECRET = process.env.X_API_SECRET;
if(!KEY || !SECRET){ console.error("X_API_KEY / X_API_SECRET が設定されていません。"); process.exit(1); }

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/* OAuth 1.0a の署名つきヘッダーを作る */
function oauthHeader(method, url, params, tokenSecret = ""){
  const base = {
    oauth_consumer_key: KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...params
  };
  const norm = Object.keys(base).sort().map(k => `${enc(k)}=${enc(base[k])}`).join("&");
  const baseStr = [method.toUpperCase(), enc(url), enc(norm)].join("&");
  const signKey = `${enc(SECRET)}&${enc(tokenSecret)}`;
  base.oauth_signature = crypto.createHmac("sha1", signKey).update(baseStr).digest("base64");
  return "OAuth " + Object.keys(base).sort().map(k => `${enc(k)}="${enc(base[k])}"`).join(", ");
}

async function post(url, params, tokenSecret){
  const r = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url, params, tokenSecret) } });
  const text = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return Object.fromEntries(new URLSearchParams(text));
}

const mode = process.argv[2];

if(mode === "start"){
  // 1) 一時トークンをもらう（oob = PIN を画面に表示する方式）
  const res = await post("https://api.x.com/oauth/request_token", { oauth_callback: "oob" });
  console.log("");
  console.log("================ 手順 ================");
  console.log("1. 投稿先アカウント（@MTGtbg）でログインしたブラウザで、次のURLを開く：");
  console.log("");
  console.log(`   https://api.x.com/oauth/authorize?oauth_token=${res.oauth_token}`);
  console.log("");
  console.log("2. 「アプリを認証」を押すと、7桁の PIN が表示される");
  console.log("3. このワークフローをもう一度実行し、次の3つを入力する：");
  console.log("");
  console.log(`   pin        : （表示された PIN）`);
  console.log(`   req_token  : ${res.oauth_token}`);
  console.log(`   req_secret : ${res.oauth_token_secret}`);
  console.log("");
  console.log("※ 一時トークンは数分で失効します。続けて行ってください。");
  console.log("======================================");
}else if(mode === "finish"){
  const { PIN, REQ_TOKEN, REQ_SECRET } = process.env;
  if(!PIN || !REQ_TOKEN || !REQ_SECRET){ console.error("PIN / REQ_TOKEN / REQ_SECRET が足りません。"); process.exit(1); }
  const res = await post("https://api.x.com/oauth/access_token",
    { oauth_token: REQ_TOKEN, oauth_verifier: PIN.trim() }, REQ_SECRET);
  console.log("");
  console.log("================ 完了 ================");
  console.log(`許可したアカウント： @${res.screen_name}`);
  console.log("");
  console.log("GitHub の Settings → Secrets and variables → Actions に、次の2つを登録してください：");
  console.log("");
  console.log(`   X_ACCESS_TOKEN  : ${res.oauth_token}`);
  console.log(`   X_ACCESS_SECRET : ${res.oauth_token_secret}`);
  console.log("");
  console.log("登録が済んだら、この実行のログは削除してください（右上の「…」→ Delete logs）。");
  console.log("======================================");
}else{
  console.error("使い方: node maintenance/x-auth.mjs start | finish");
  process.exit(1);
}
