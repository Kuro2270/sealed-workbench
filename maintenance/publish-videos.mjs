#!/usr/bin/env node
/*
 * 未配信の動画をまとめて配信する。
 *
 *   node maintenance/publish-videos.mjs            … data/videos.json の「未配信」をすべて調べる
 *   ONLY_SET=HOB node maintenance/publish-videos.mjs … そのセットだけ
 *   MANUAL="HOB ja sealed g7u5JVhJgFk" …           … 記録に無い動画を手で足して配信する
 *
 * 流れ
 *   1) 未配信（public: false）の動画について、YouTube に「公開になっているか」を聞く
 *   2) 公開になっていたら public: true にして、X・Bluesky に案内を投稿する（POST=1 のとき）
 *   3) まだ非公開のものは、そのまま残す（次回また調べる）
 * セット別ページの作り直しは呼び出し側（workflow）で行う。
 *
 * 必要な環境変数: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN_JA / _EN（公開状態の確認用）
 *                 POST=1 なら投稿もする（X_*, BSKY_* は post-social.mjs が読む）
 */

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const ONLY = (process.env.ONLY_SET || "").trim().toUpperCase();
const POST = process.env.POST === "1";
const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET;

console.log(`入力: ONLY_SET=${JSON.stringify(ONLY)} MANUAL=${JSON.stringify(process.env.MANUAL || "")} POST=${POST}`);
let all = {};
try{ all = JSON.parse(await readFile("data/videos.json", "utf8")); }catch(e){}

// 動画づくりが1本ごとに置いた記録（data/videos/<SET>-<lang>-<mode>.json）を取り込む。同時に走っても衝突しない
try{
  const { readdir, unlink } = await import("node:fs/promises");
  for(const f of await readdir("data/videos").catch(() => [])){
    if(!f.endsWith(".json")) continue;
    try{
      const v = JSON.parse(await readFile(`data/videos/${f}`, "utf8"));
      const S = String(v.set).toUpperCase(), Lg = v.lang, M = v.mode || "draft";
      all[S] = all[S] || {};
      if(all[S][Lg] && all[S][Lg].id) all[S][Lg] = { draft: all[S][Lg] };
      all[S][Lg] = all[S][Lg] || {};
      if(!all[S][Lg][M] || all[S][Lg][M].id !== v.id) all[S][Lg][M] = { id: v.id, mode: M, title: v.title, poster: v.poster || undefined, uploadedAt: v.uploadedAt, public: false };
      console.log(`記録を取り込み: ${S} ${Lg} ${M} ${v.id}`);
      await unlink(`data/videos/${f}`);
    }catch(e){ console.log(`記録を読めません: ${f}`); }
  }
}catch(e){}

// 手で足す（記録に無い動画）
if(process.env.MANUAL){
  const [set, lang, mode, id] = process.env.MANUAL.trim().split(/\s+/);
  if(set && lang && mode && id){
    const S = set.toUpperCase();
    all[S] = all[S] || {};
    if(all[S][lang] && all[S][lang].id) all[S][lang] = { draft: all[S][lang] };
    all[S][lang] = all[S][lang] || {};
    const cur = all[S][lang][mode];
    if(cur && cur.id === id && cur.public){
      console.log(`すでに配信済みなので何もしません: ${S} ${lang} ${mode} ${id}`);
    }else
    all[S][lang][mode] = { ...(all[S][lang][mode] || {}), id, mode, public: false, manual: true, uploadedAt: (all[S][lang][mode] || {}).uploadedAt || new Date().toISOString().slice(0, 10) };
    console.log(`手で追加: ${S} ${lang} ${mode} ${id}`);
  }else{
    console.error("MANUAL は「セット 言語 形式 動画ID」の4つを空白で区切って指定してください。"); process.exit(1);
  }
}

// 古い形（言語の直下に id）はドラフトとして読み替える
for(const S of Object.keys(all)) for(const L of Object.keys(all[S])) if(all[S][L] && all[S][L].id) all[S][L] = { draft: all[S][L] };

const tokens = {};
async function accessToken(lang){
  if(tokens[lang]) return tokens[lang];
  const refresh = process.env[`YT_REFRESH_TOKEN_${lang.toUpperCase()}`];
  if(!ID || !SECRET || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, refresh_token: refresh, grant_type: "refresh_token" }) });
  const j = await r.json().catch(() => ({}));
  tokens[lang] = j.access_token || null;
  return tokens[lang];
}
async function privacy(lang, id){
  const tok = await accessToken(lang);
  if(!tok) return "unknown";
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${tok}` } });
  const j = await r.json().catch(() => ({}));
  const it = j.items && j.items[0];
  return it ? (it.status.privacyStatus || "unknown") : "missing";
}

/* 公開した動画に、サイトへの案内コメントを付ける（固定は YouTube Studio で手で。API には固定の機能が無い）。
   許可（YT_REFRESH_TOKEN_*）に force-ssl が無いと 403 になるので、その場合は案内だけ出して続ける */
const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const MODES = ["draft", "sealed", "early", "trend"];   // early = 先行版（発売直後のショート）、trend = 修正版（確定版のあとの、ドラフトの変化）
const shortName = n => { const m = String(n).replace(/^Magic:\s*The Gathering\s*[:|｜-]?\s*/i, "").split(/\s*[｜|]\s*/); return (m[m.length - 1] || "").trim() || String(n); };
async function setNameFor(S, lang){
  try{
    if(lang === "ja"){ const src = await readFile("i18n.js", "utf8"); const m = src.match(/const SET_JA = (\{[\s\S]*?\});/); if(m){ const n = new Function("return " + m[1])()[S.toLowerCase()]; if(n) return n; } }
    const n = JSON.parse(await readFile(`data/names/${S}.json`, "utf8")); return n.set || S;
  }catch(e){ return S; }
}
async function commentText(lang, S, mode){
  const name = shortName(await setNameFor(S, lang));
  const page = `${SITE}/sets/${S}${lang === "en" ? ".en" : ""}.html`;
  const modeName = lang === "ja" ? (mode === "sealed" ? "シールド" : "ドラフト") : (mode === "sealed" ? "Sealed" : "Draft");
  // 先行版：サイトにはまだ載っていない（17Lands の決まりで、サイト掲載は発売12日目から）ので、この先の案内にする
  if(mode === "early") return lang === "ja"
    ? `見てくれてありがとうございます。\n\nこれは発売直後の速報です。データは 17Lands のカード勝率・色別勝率で、順位はこれから動きます。\n全カードの勝率ページはアリーナ配信の12日目から、環境まとめの解説動画は2週間ほどで出します。\n\nシールド／ドラフトの構築練習はこちら（無料・登録不要）→ ${SITE}\n\n「この色が強いのは意外だった」「自分の体感と違う」などあれば、コメントで教えてください。`
    : `Thanks for watching.\n\nThis is an early look from the first days of the format. Data: 17Lands card and colour win rates — rankings will move.\nThe all-cards win rate page follows on day 12 after the Arena release, and the full review video about two weeks in.\n\nFree Sealed / Draft practice → ${SITE}\n\nIf a colour surprised you, or the data doesn't match your experience, tell me in the comments.`;
  // 修正版：1週目 → 直近の変化。全カードの勝率（いまの値）はサイトで見られる
  if(mode === "trend") return lang === "ja"
    ? `見てくれてありがとうございます。\n\nこれは、発売1週目と直近の1週間のドラフトのデータ（17Lands）を比べた修正版です。\n${name}の全カードの勝率・2色の組み合わせは、こちらで見られます（無料・登録不要）\n${page}\n\nシールド／ドラフトの構築練習もできます → ${SITE}\n\n「このカード、最近よく見る」「評価が変わったと感じる」などあれば、コメントで教えてください。`
    : `Thanks for watching.\n\nThis update compares week one with the latest week of ${name} Draft data from 17Lands.\nEvery card's win rate and the colour pairs are here (free, no sign-up):\n${page}\n\nFree Sealed / Draft practice too → ${SITE}\n\nNoticed a card that's been overperforming lately? Tell me in the comments.`;
  const text = lang === "ja"
    ? `見てくれてありがとうございます。\n\n動画で触れた色の勝率・2色の組み合わせ・コモンやレアの評価は、こちらで${name}の${modeName}の全カード分を見られます（無料・登録不要）\n${page}\n\nシールド／ドラフトの構築練習もできます → ${SITE}\n\n「この色が強いのは意外だった」「自分の体感と違う」などあれば、コメントで教えてください。次のセットの動画の参考にします。`
    : `Thanks for watching.\n\nEvery card's win rate for ${name} ${modeName} — colours, two-colour pairs, the best commons and rares — is here (free, no sign-up):\n${page}\n\nFree Sealed / Draft practice too → ${SITE}\n\nIf a colour surprised you, or the data doesn't match your experience, tell me in the comments. It helps shape the next set's video.`;
  return text;
}
/* 2件目：お気に入りのカードやコンボを、コメント欄で共有してもらうための呼びかけ。
   1件目（サイトの案内）と分けて付ける。案内と呼びかけが1つの長いコメントに混ざると、返信が付きにくい */
async function commentText2(lang, S, mode){
  const name = shortName(await setNameFor(S, lang));
  const modeName = lang === "ja" ? (mode === "sealed" ? "シールド" : mode === "early" ? "発売直後のリミテッド" : "ドラフト") : (mode === "sealed" ? "Sealed" : mode === "early" ? "first-week Limited" : "Draft");
  return lang === "ja"
    ? `${name}の${modeName}で、お気に入りのカードや、うまくいったコンボはありますか？\n「このカードが思った以上に強かった」「この組み合わせで勝てた」など、一言だけでも大丈夫です。ぜひコメントで教えてください。`
    : `What's your favourite card or combo in ${name} ${modeName}?\nEven a one-liner is great: "this card overperformed", "this pair won me the run". Share it in the comments!`;
}
async function postComment(lang, id, text){
  const tok = await accessToken(lang);
  if(!tok) return "no-token";
  const r = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { videoId: id, topLevelComment: { snippet: { textOriginal: text } } } }) });
  if(r.ok) return "ok";
  const body = await r.text();
  if(r.status === 403 && /insufficient|scope|forbidden/i.test(body)) return "no-scope";
  return `HTTP ${r.status}: ${body.slice(0, 160)}`;
}

const comments = [], posted = [];
/* 案内（1件目）と呼びかけ（2件目）を、付いていないほうだけ付ける。付けられなければ文面をまとめに出す */
async function addComments(S, L, M, v){
  // 速報（early）は1件目だけ。1件目の最後に感想の呼びかけが入っているので、2件目は付けない（くどくなる）
  if((M === "early" || M === "trend") && !v.comment2) v.comment2 = true;   // 修正版も、1件目の最後に呼びかけが入っている
  const steps = [["comment", await (!v.comment ? commentText(L, S, M) : "")], ["comment2", await (!v.comment2 ? commentText2(L, S, M) : "")]];
  let blocked = null;
  for(const [key, text] of steps){
    if(!text) continue;
    const label = key === "comment" ? "" : "（2件目）";
    const c = blocked || await postComment(L, v.id, text);
    if(c === "ok"){ v[key] = true; posted.push({ set: S, lang: L, mode: M, id: v.id, n: key === "comment" ? 1 : 2 }); console.log(`  ${key === "comment" ? "案内" : "呼びかけ"}コメントを付けました${label}`); }
    else{
      if(!blocked) blocked = c;        // 1件目が付けられなかったら、2件目も同じ理由で付かないので試さない
      comments.push({ set: S, lang: L, mode: M, id: v.id, text, why: c, n: key === "comment" ? 1 : 2 });
      console.log(`  コメント${label}は付けられませんでした（${c === "no-scope" ? "許可にコメントの権限がありません。「YouTube 投稿許可」をデスクトップ アプリの方式でやり直すと付きます" : c}）。文面をまとめに出します`);
    }
  }
}
const published = [], waiting = [], failed = [];
for(const S of Object.keys(all).sort()){
  if(ONLY && S !== ONLY) continue;
  for(const L of ["ja", "en"]){
    for(const M of MODES){
      const v = all[S][L] && all[S][L][M];
      if(!v || !v.id || v.public) continue;
      // 手で足したものは、公開を確認して入れている前提なので YouTube に聞かずに配信する（許可の不調で止まらないように）
      const st = v.manual ? "public" : await privacy(L, v.id);
      if(st === "public"){
        delete v.manual;
        v.public = true; v.publishedAt = v.publishedAt || new Date().toISOString().slice(0, 10);
        published.push({ set: S, lang: L, mode: M, id: v.id });
        console.log(`配信: ${S} ${L} ${M} https://www.youtube.com/shorts/${v.id}`);
        if(!v.comment || !v.comment2) await addComments(S, L, M, v);
      }else if(st === "missing"){
        // YouTube で削除された動画。記録を消して、同じセット・言語・形式を作り直せるようにする（残すと「もう作ってある」と判断されて自動で選ばれない）
        failed.push({ set: S, lang: L, mode: M, id: v.id, why: "YouTube に見つかりません（削除した？）。記録を消したので、作り直せます" });
        console.log(`見つからない: ${S} ${L} ${M} ${v.id} → 記録を消します`);
        delete all[S][L][M];
        if(!Object.keys(all[S][L]).length) delete all[S][L];
        if(!Object.keys(all[S]).length) delete all[S];
      }else{
        waiting.push({ set: S, lang: L, mode: M, id: v.id, status: st });
        console.log(`まだ${st === "private" ? "非公開" : st === "unlisted" ? "限定公開" : "不明"}: ${S} ${L} ${M} https://www.youtube.com/shorts/${v.id}`);
      }
    }
  }
}

// 配信済みの動画の固定コメントの文面だけ出す（COMMENTS_FOR=SET。配信や投稿はしない）
const CF = (process.env.COMMENTS_FOR || "").trim().toUpperCase();
/* ALL を入れると、配信済みのすべての動画について、付いていないほうのコメント（案内・呼びかけ）を付ける */
if(CF && (CF === "ALL" || all[CF])){
  for(const S of (CF === "ALL" ? Object.keys(all).sort() : [CF])){
    for(const L of ["ja", "en"]) for(const M of MODES){
      const v = all[S][L] && all[S][L][M];
      if(!(v && v.id && v.public) || (v.comment && v.comment2) || comments.some(c => c.id === v.id)) continue;
      console.log(`${S} ${L} ${M}`);
      await addComments(S, L, M, v);
    }
  }
  console.log(`コメント: ${CF} … 付けた ${posted.length} 件／文面をまとめに出す ${comments.length} 件`);
}

await writeFile("data/videos.json", JSON.stringify(all, null, 2) + "\n", "utf8");

// 投稿（公開になったものだけ。言語ごとに1本ずつ）。動画ファイルが Releases（タグ videos）にあれば落として添付する
async function fetchVideoFile(p){
  const tag = p.mode === "draft" ? p.lang : `${p.lang}-${p.mode}`;
  const name = `${p.set}-${tag}.mp4`;
  try{
    const { mkdir } = await import("node:fs/promises");
    await mkdir("short/dl", { recursive: true });
    execFileSync("gh", ["release", "download", "videos", "--pattern", name, "--dir", "short/dl", "--clobber"], { stdio: "pipe" });
    const { existsSync } = await import("node:fs");
    if(existsSync(`short/dl/${name}`)){ console.log(`動画ファイル: ${name} を Releases から取りました`); return `short/dl/${name}`; }
  }catch(e){}
  console.log(`動画ファイル: ${name} は Releases に無いので、リンクで投稿します`);
  return "";
}
// SNS への案内。失敗してもこの手順は赤くしない（赤くすると、あとのサイト掲載・記録のコミットまで止まってしまう）。失敗は警告とまとめに出す
const postFailed = [];
if(POST){
  for(const p of published){
    try{
      const file = await fetchVideoFile(p);
      execFileSync("node", ["maintenance/post-social.mjs", "video"], { stdio: "inherit",
        env: { ...process.env, ANNOUNCE_SETS: p.set, LANGS: p.lang, BSKY_LANGS: process.env.BSKY_LANGS || "en", VIDEO_ID: p.id, VIDEO_MODE: p.mode, VIDEO_FILE: file } });
    }catch(e){ console.error(`::warning::SNS への案内に失敗: ${p.set} ${p.lang} ${p.mode}（サイトへの掲載と記録は続けます。X の 403 は、X の開発者ポータルでアプリの権限が「Read and write」になっているか確認してください）`); postFailed.push(p); }
  }
}

// まとめ（workflow の Summary 用）
const lines = [];
lines.push(`## 動画の配信`);
lines.push("");
if(published.length){ lines.push(`### 配信しました（${published.length}本）`); for(const p of published) lines.push(`- ${p.set} ${p.lang} ${p.mode}: https://www.youtube.com/shorts/${p.id}`); lines.push(""); }
if(waiting.length){ lines.push(`### まだ公開になっていません（YouTube Studio で公開にしてから、もう一度）`); for(const p of waiting) lines.push(`- ${p.set} ${p.lang} ${p.mode}（${p.status}）: https://www.youtube.com/shorts/${p.id}`); lines.push(""); }
if(failed.length){ lines.push(`### 確認できませんでした`); for(const p of failed) lines.push(`- ${p.set} ${p.lang} ${p.mode}: ${p.why}`); lines.push(""); }
if(!published.length && !waiting.length && !failed.length) lines.push("未配信の動画はありません。");
if(postFailed.length){ lines.push(""); lines.push(`### SNS への案内に失敗しました（${postFailed.length}本。配信と掲載は済んでいます。必要なら手で投稿してください）`); for(const p of postFailed) lines.push(`- ${p.set} ${p.lang} ${p.mode}: https://www.youtube.com/shorts/${p.id}`); }
if(posted.length){ lines.push(""); lines.push(`### 案内コメントを付けました（${posted.length}本）。YouTube Studio → コメント で「固定」にしてください`); for(const p of posted) lines.push(`- ${p.set} ${p.lang} ${p.mode}: https://www.youtube.com/shorts/${p.id}`); }
if(comments.length){
  lines.push(""); lines.push("### 自動で付けられなかった固定コメントの文面（各動画のコメント欄に貼って「固定」にしてください）");
  for(const c of comments){ lines.push(""); lines.push(`**${c.set} ${c.lang} ${c.mode}${c.n === 2 ? "（2件目：呼びかけ）" : ""}** — https://www.youtube.com/shorts/${c.id}`); lines.push(""); lines.push("```"); lines.push(c.text); lines.push("```"); }
}
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
await writeFile("publish-result.json", JSON.stringify({ published, waiting, failed }), "utf8");
console.log(`\n配信 ${published.length} / 待ち ${waiting.length} / 確認できず ${failed.length}`);
