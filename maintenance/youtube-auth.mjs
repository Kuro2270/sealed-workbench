#!/usr/bin/env node
/*
 * YouTube に動画を上げるための許可を、チャンネルの持ち主がアプリに出す手続き（Google の「デバイス」方式）。
 * ブラウザでコードを入れるだけで済み、パソコンに何も入れなくてよい。
 *
 * 使い方（GitHub Actions「YouTube 投稿許可」から実行する想定）
 *   1) 開始：  node maintenance/youtube-auth.mjs start
 *        → 開くURLと、そこに入れる8文字のコード、引き換え用の device_code を表示する
 *   2) 完了：  DEVICE_CODE=... node maintenance/youtube-auth.mjs finish
 *        → そのチャンネル名義の REFRESH_TOKEN を表示する（Secrets に登録して、ログは削除）
 *
 * 必要な環境変数： YT_CLIENT_ID, YT_CLIENT_SECRET（Google Cloud の OAuth クライアント。種類は「テレビと制限付き入力デバイス」）
 * 依存ライブラリなし（Node 18 以上）。
 *
 * 注意
 *   ・コードの有効期限は 30 分ほど。1) のあと 2) まで時間を空けすぎない
 *   ・OAuth 同意画面の公開ステータスが「テスト」のままだと、取れた許可は 7 日で切れる。「本番」にしておくこと
 *   ・Google の審査を受けていないアプリから上げた動画は「非公開」固定になる。公開にするのは YouTube Studio から手で行う
 */

const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET;
if(!ID || !SECRET){ console.error("YT_CLIENT_ID / YT_CLIENT_SECRET が設定されていません。"); process.exit(1); }

/* 2つの方式に対応する
 *   desktop … OAuth クライアントが「デスクトップ アプリ」のとき（推奨）。コメント投稿の権限（force-ssl）も取れる。
 *             1回目で URL を出す → ブラウザで許可 → localhost に飛ばされて「ページが開けない」画面になるので、
 *             そのアドレス欄の code=... の部分を 2回目に入れる
 *   device  … 「テレビと限定入力デバイス」のとき。コメント投稿の権限は取れない（Google の制限）
 * AUTH_MODE で選ぶ（既定 desktop）。 */
const AUTH_MODE = (process.env.AUTH_MODE || "desktop").toLowerCase();
const REDIRECT = "http://localhost:8765/";
const SCOPE = AUTH_MODE === "device"
  ? "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"
  : "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl";

async function form(url, params){
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

const mode = process.argv[2];

if(mode === "start" && AUTH_MODE !== "device"){
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for(const [k, v] of Object.entries({ client_id: ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true" })) u.searchParams.set(k, v);
  console.log("");
  console.log("================ 手順 ================");
  console.log("1. 動画を上げるチャンネル（ブランドアカウント）でログインしたブラウザで、次のURLを開く：");
  console.log("");
  console.log(`   ${u.toString()}`);
  console.log("");
  console.log("2. アカウントを選ぶ画面で、必ずチャンネル（ブランドアカウント）のほうを選ぶ");
  console.log("   「このアプリは Google で確認されていません」と出たら「詳細」→「（アプリ名）に移動」で進む");
  console.log("3. 「許可」を押すと、localhost のページに飛ばされて「このサイトにアクセスできません」と出る。それで正常。");
  console.log("   そのときのアドレス欄（http://localhost:8765/?code=4/0A...&scope=...）から、code= の後ろから &scope の手前までをコピーする");
  console.log("4. このワークフローをもう一度実行し、code 欄にそれを貼る（10分以内）");
  console.log("======================================");
}else if(mode === "finish" && AUTH_MODE !== "device"){
  let code = (process.env.DEVICE_CODE || "").trim();
  if(!code){ console.error("code が空です。1回目の手順で取った code=... の値を入れてください。"); process.exit(1); }
  // URL ごと貼られたときも拾う
  const m = code.match(/[?&]code=([^&\s]+)/); if(m) code = m[1];
  code = decodeURIComponent(code);
  const { ok, status, j } = await form("https://oauth2.googleapis.com/token", { client_id: ID, client_secret: SECRET, code, grant_type: "authorization_code", redirect_uri: REDIRECT });
  if(!ok){
    const why = j.error === "invalid_grant" ? "code が無効か期限切れです。1回目（開始）からやり直してください。"
              : j.error === "redirect_uri_mismatch" ? "OAuth クライアントの種類が「デスクトップ アプリ」ではありません。Google Cloud でデスクトップ アプリのクライアントを作り、YT_CLIENT_ID / YT_CLIENT_SECRET を差し替えてください。"
              : `HTTP ${status}: ${JSON.stringify(j)}`;
    console.error(`許可の受け取りに失敗しました: ${why}`); process.exit(1);
  }
  await done(j);
}else if(mode === "start"){
  const { ok, status, j } = await form("https://oauth2.googleapis.com/device/code", { client_id: ID, scope: SCOPE });
  if(!ok){ console.error(`開始に失敗しました（HTTP ${status}）: ${JSON.stringify(j)}`); process.exit(1); }
  console.log("");
  console.log("================ 手順 ================");
  console.log("1. 動画を上げるチャンネル（ブランドアカウント）でログインしたブラウザで、次のURLを開く：");
  console.log("");
  console.log(`   ${j.verification_url}`);
  console.log("");
  console.log("2. 次のコードを入れる：");
  console.log("");
  console.log(`   ${j.user_code}`);
  console.log("");
  console.log("3. アカウントを選ぶ画面で、必ずチャンネル（ブランドアカウント）のほうを選ぶ");
  console.log("   「このアプリは Google で確認されていません」と出たら「詳細」→「（アプリ名）に移動」で進む");
  console.log("4. 「許可」を押したら、このワークフローをもう一度実行し、次を入力する：");
  console.log("");
  console.log(`   device_code: ${j.device_code}`);
  console.log("");
  console.log(`（コードの有効期限: ${Math.round((j.expires_in || 1800) / 60)} 分）`);
  console.log("======================================");
}else if(mode === "finish"){
  const dc = process.env.DEVICE_CODE;
  if(!dc){ console.error("DEVICE_CODE が空です。1回目のログに出た device_code を入れてください。"); process.exit(1); }
  const { ok, status, j } = await form("https://oauth2.googleapis.com/token", {
    client_id: ID, client_secret: SECRET, device_code: dc, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  if(!ok){
    const why = j.error === "authorization_pending" ? "まだブラウザで「許可」が押されていません。許可してからもう一度実行してください。"
              : j.error === "expired_token" ? "コードの期限が切れました。1回目（開始）からやり直してください。"
              : j.error === "access_denied" ? "ブラウザで拒否されました。1回目からやり直してください。"
              : `HTTP ${status}: ${JSON.stringify(j)}`;
    console.error(`許可の受け取りに失敗しました: ${why}`); process.exit(1);
  }
  await done(j);
}else{
  console.error("使い方: node maintenance/youtube-auth.mjs start | finish");
  process.exit(1);
}

async function done(j){
  if(!j.refresh_token){ console.error("refresh_token が返ってきませんでした。OAuth 同意画面の設定を確認してください。"); process.exit(1); }
  // どのチャンネルの許可か確認して表示する
  let channel = "";
  try{
    const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${j.access_token}` } });
    const c = await r.json(); channel = c.items && c.items[0] ? `${c.items[0].snippet.title}（${c.items[0].id}）` : "（取得できず）";
  }catch(e){ channel = "（取得できず）"; }
  console.log("");
  console.log("================ 完了 ================");
  console.log(`許可したチャンネル: ${channel}`);
  console.log("");
  console.log("GitHub の Settings → Secrets and variables → Actions に、次の名前で登録する：");
  console.log("");
  console.log(`   YT_REFRESH_TOKEN_JA = ${j.refresh_token}`);
  console.log("");
  console.log("（英語チャンネルなら YT_REFRESH_TOKEN_EN）");
  console.log("登録したら、この実行のログは削除すること（右上の … → Delete logs）。");
  console.log(`（取れた権限: ${j.scope || "不明"}）`);
  console.log("======================================");
}
