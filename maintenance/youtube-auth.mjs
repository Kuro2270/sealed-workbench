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

const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

async function form(url, params){
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

const mode = process.argv[2];

if(mode === "start"){
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
  console.log("======================================");
}else{
  console.error("使い方: node maintenance/youtube-auth.mjs start | finish");
  process.exit(1);
}
