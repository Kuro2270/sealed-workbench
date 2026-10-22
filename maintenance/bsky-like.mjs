#!/usr/bin/env node
/*
 * Bluesky で、MTGアリーナ・マジック：ザ・ギャザリングについての最近の投稿を探して、いいねを付ける（1日の上限つき）。
 *   役割はこれだけ。投稿はしない（告知は release-post.mjs）。
 *
 *   node maintenance/bsky-like.mjs                 … いいねを付ける
 *   DRY_RUN=1 node maintenance/bsky-like.mjs       … 付ける候補を見るだけ（いいねはしない）
 *
 * 環境変数：BSKY_HANDLE, BSKY_APP_PASSWORD（無ければ何もしない）
 *           LIKE_LIMIT … 1日（日本時間）に付ける上限。既定 50。50〜200 の間で使う（50 より小さい数は 50、200 より大きい数は 200）。
 *                        今日すでに付けた数（手で付けたものも含む）を引いた分だけ付ける
 *           LIKE_LIMIT_SRC … 上限の数をどこから取ったか（input / var / default。Summary に出すだけ）
 *           MANUAL     … 1 なら手で押した実行。今日の数は見ずに、LIKE_LIMIT の件数をそのまま付ける（手で入れた件数は 1〜200）
 *           BSKY_BASE  … 確認用（作り物のサーバーに向ける）
 *
 * 付けない投稿：自分の投稿、もう付けた投稿、返信、ラベル（成人向け・スパムなど）の付いた投稿や人、
 *               ミュート・ブロックの関係にある人、短すぎる投稿、2日より前の投稿。
 * 同じ人には、きのう・きょう（日本時間）にいいねを付けていたら付けない（毎日同じ人に付かないよう、1日以上あける。手で付けたいいねも含む）。
 * 1回の実行で、同じ人には1つだけ。いいねとの間は「20秒〜75秒のランダム」あける（毎回ばらつかせる。200件で平均2時間半ほど）。
 *   確認用に LIKE_WAIT_MS（固定の分）・LIKE_JITTER_MIN_MS / LIKE_JITTER_MAX_MS（ランダムの幅）で変えられる。
 */
import { appendFile } from "node:fs/promises";

const BASE = process.env.BSKY_BASE || "https://bsky.social/xrpc";
const DRY = process.env.DRY_RUN === "1";
const MANUAL = process.env.MANUAL === "1";
// 全角の数字（「５０」）や「50件」のような書き方でも読めるようにする（読めないと既定の 10 件になってしまうため）
const RAW_LIMIT = String(process.env.LIKE_LIMIT || "").replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).trim();
// 1日の上限は 50〜200 件（2026年10月：10〜50 件から引き上げ）。手で押して件数を入れたときだけは、少ない件数（1件〜）でも試せる
const LIMIT_MIN = 50, LIMIT_MAX = 200;
const LIMIT = (() => {
  const n = parseInt(RAW_LIMIT || String(LIMIT_MIN), 10) || LIMIT_MIN;
  return Math.min(LIMIT_MAX, Math.max(MANUAL && process.env.LIKE_LIMIT_SRC === "input" ? 1 : LIMIT_MIN, n));
})();
// 上限の数をどこから取ったか（Summary に出す。「50 にしたのに 10 になる」ときの確認用）
const LIMIT_FROM = { input: "手で押したときの入力", var: "設定（Variables の BSKY_LIKE_LIMIT）", default: "既定（BSKY_LIKE_LIMIT が Variables に無い）" }[process.env.LIKE_LIMIT_SRC] || "";
const WAIT_MS = +(process.env.LIKE_WAIT_MS ?? 0);
const JITTER_MIN = +(process.env.LIKE_JITTER_MIN_MS ?? 20000), JITTER_MAX = +(process.env.LIKE_JITTER_MAX_MS ?? 75000);
const waitMs = () => WAIT_MS + JITTER_MIN + Math.random() * Math.max(0, JITTER_MAX - JITTER_MIN);
const MAX_AGE_H = 48, MIN_TEXT = 20;
const SEARCH_PAGES = 3;          // 言葉ごとに探す回数（1回 100 件まで）。上限 200 件でも候補が足りるように
const REFRESH_MS = 60 * 60000;   // ログインの鍵を取り直す間隔（1時間。鍵は2時間ほどで切れる）
/* MTG の話をしている投稿か（本文に MTG らしい言葉があるか）。検索は「magic」だけで当たる投稿や、宣伝のついでにタグを付けた投稿も返すため */
const ON_TOPIC = /\bmtg|magic[:\s]+the gathering|magic arena|マジック|ギャザリング/i;

/* 探す言葉。英語と日本語。上から順に1件ずつ交互に選ぶ */
const QUERIES = [
  { q: "\"MTG Arena\"", lang: "en" },
  { q: "#MTGArena", lang: "en" },
  { q: "\"Magic: The Gathering\"", lang: "en" },
  { q: "MTGアリーナ", lang: "ja" },
  { q: "マジック：ザ・ギャザリング", lang: "ja" },
  { q: "#MTGA" }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const summary = async md => { if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n"); };
const jstMidnight = () => { const d = new Date(Date.now() + 9 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 9 * 3600000; };
const postUrl = p => `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`;
const oneLine = s => String(s || "").replace(/\s+/g, " ").slice(0, 80);

async function api(path, auth, init = {}){
  const r = await fetch(`${BASE}/${path}`, { ...init, headers: { ...(init.headers || {}), ...auth } });
  if(!r.ok) throw new Error(`${path.split("?")[0]} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* 自分のいいねの記録を新しい順に見て、次の2つを返す（手で付けたいいねも含む）
     today   … 今日（日本時間）付けたいいねの数
     authors … きのう・きょう（日本時間）にいいねを付けた投稿の人（did）。この人たちには、今日は付けない
   いいねの記録には相手の投稿の URI（at://<相手の did>/app.bsky.feed.post/...）が入っているので、そこから人を取る */
async function recentLikes(auth, did){
  const today = jstMidnight(), from = today - 24 * 3600000;
  const out = { today: 0, authors: new Set() };
  let cursor = "";
  for(let page = 0; page < 10; page++){       // 1日 200 件まで × 2日分を見られるように
    const d = await api(`com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=app.bsky.feed.like&limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, auth);
    for(const rec of d.records || []){
      const at = Date.parse(rec.value && rec.value.createdAt);
      if(!(at >= from)) return out;
      if(at >= today) out.today++;
      const m = String((rec.value.subject || {}).uri || "").match(/^at:\/\/([^/]+)\//);
      if(m) out.authors.add(m[1]);
    }
    if(!d.cursor) return out;
    cursor = d.cursor;
  }
  return out;
}

function suitable(p, me, recentAuthors){
  const rec = p.record || {};
  if(p.author.did === me) return false;
  if(recentAuthors.has(p.author.did)) return false;   // きのう・きょう、いいねを付けた人
  if(p.viewer && p.viewer.like) return false;
  if(rec.reply) return false;
  if((p.labels || []).length || (p.author.labels || []).length) return false;
  const v = p.author.viewer || {};
  if(v.muted || v.blockedBy || v.blocking) return false;
  if(String(rec.text || "").trim().length < MIN_TEXT) return false;
  if(!ON_TOPIC.test(String(rec.text || ""))) return false;
  if(Date.now() - Date.parse(p.indexedAt || rec.createdAt) > MAX_AGE_H * 3600000) return false;
  return true;
}

async function main(){
  const H = process.env.BSKY_HANDLE, P = process.env.BSKY_APP_PASSWORD;
  if(!H || !P){ console.log("Bluesky の鍵（BSKY_HANDLE / BSKY_APP_PASSWORD）が無いので、何もしません。"); return; }
  const s = await fetch(`${BASE}/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: H, password: P }) });
  if(!s.ok) throw new Error(`Bluesky のログインに失敗 HTTP ${s.status}: ${(await s.text()).slice(0, 200)}`);
  const session = await s.json();
  const auth = { Authorization: `Bearer ${session.accessJwt}` };
  /* ログインの鍵（accessJwt）は2時間ほどで切れる。50件付けると間をあけるので2時間を超え、途中から「ExpiredToken」で落ちた（2026年10月）。
     そこで、前に取ってから REFRESH_MS たったら、いいねを付ける前に取り直す（refreshJwt を使う。パスワードでログインし直さない） */
  let fresh = Date.now();
  const refresh = async () => {
    const r = await fetch(`${BASE}/com.atproto.server.refreshSession`, { method: "POST", headers: { Authorization: `Bearer ${session.refreshJwt}` } });
    if(!r.ok) throw new Error(`Bluesky の鍵の取り直しに失敗 HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const n = await r.json();
    session.accessJwt = n.accessJwt; session.refreshJwt = n.refreshJwt;
    auth.Authorization = `Bearer ${n.accessJwt}`; fresh = Date.now();
    console.log("（ログインの鍵を取り直しました）");
  };

  const recent = await recentLikes(auth, session.did), done = recent.today;
  console.log(`きのう・きょういいねを付けた人：${recent.authors.size} 人（今日は付けない）`);
  const room = MANUAL ? LIMIT : Math.max(0, LIMIT - done);   // 手で押したときは、今日の数に関係なく付ける
  console.log(MANUAL ? `手で押した実行：今日のいいね ${done} 件に関係なく、${room} 件まで付けます` : `今日のいいね：${done} 件（上限 ${LIMIT}）。あと ${room} 件まで`);
  if(!room && !DRY){ await summary(`今日はもう上限（${LIMIT}件${LIMIT_FROM ? `、${LIMIT_FROM}` : ""}）まで付けています。`); return; }

  /* 言葉ごとに探して、交互に並べる */
  const since = new Date(Date.now() - MAX_AGE_H * 3600000).toISOString();
  const lists = [];
  for(const { q, lang } of QUERIES){
    try{
      const found = []; let cursor = "";
      for(let page = 0; page < SEARCH_PAGES; page++){
        const d = await api(`app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=latest&limit=100&since=${encodeURIComponent(since)}${lang ? "&lang=" + lang : ""}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, auth);
        found.push(...(d.posts || []));
        if(!d.cursor || !(d.posts || []).length) break;
        cursor = d.cursor;
      }
      lists.push(found.filter(p => suitable(p, session.did, recent.authors)));
    }catch(e){ console.log(`「${q}」を探せませんでした: ${e.message}`); lists.push([]); }
  }
  const picked = [], seenPost = new Set(), seenAuthor = new Set();
  const want = DRY ? Math.max(room, LIMIT) : room;
  for(let i = 0; picked.length < want && lists.some(l => i < l.length); i++){
    for(const l of lists){
      const p = l[i]; if(!p || picked.length >= want) continue;
      if(seenPost.has(p.uri) || seenAuthor.has(p.author.did)) continue;
      seenPost.add(p.uri); seenAuthor.add(p.author.did); picked.push(p);
    }
  }
  console.log(`候補：${picked.length} 件（付けたい数 ${want} 件）`);
  if(!picked.length){ console.log("いいねを付ける投稿は見つかりませんでした。"); await summary("いいねを付ける投稿は見つかりませんでした。"); return; }

  const rows = [];
  for(const [i, p] of picked.entries()){
    if(i && !DRY){ const w = waitMs(); console.log(`（${Math.round(w / 1000)} 秒待ちます）`); await sleep(w); }   // 前のいいねから間をあける
    const line = `@${p.author.handle}：${oneLine(p.record.text)}`;
    if(DRY){ console.log("候補 " + line); rows.push(`| 候補 | [${line.replace(/\|/g, "／")}](${postUrl(p)}) |`); continue; }
    try{
      if(!DRY && Date.now() - fresh > REFRESH_MS) await refresh();
      const like = () => api("com.atproto.repo.createRecord", auth, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.like", record: { $type: "app.bsky.feed.like", subject: { uri: p.uri, cid: p.cid }, createdAt: new Date().toISOString() } }) });
      // それでも鍵が切れていたら（ExpiredToken）、1回だけ取り直して付け直す
      try{ await like(); }catch(e){ if(!/ExpiredToken/.test(e.message)) throw e; await refresh(); await like(); }
      console.log("いいね " + line); rows.push(`| いいね | [${line.replace(/\|/g, "／")}](${postUrl(p)}) |`);
    }catch(e){ console.log(`いいねに失敗（${line}）: ${e.message}`); rows.push(`| 失敗 | ${line.replace(/\|/g, "／")} |`); process.exitCode = 1; }
  }
  await summary(`## Bluesky のいいね${DRY ? "（候補を見るだけ）" : ""}\n\n今日のいいね：実行前 ${done} 件 / ${MANUAL ? "今回付ける上限" : "1日の上限"} ${LIMIT} 件${LIMIT_FROM ? `（${LIMIT_FROM}）` : ""}\n\n| | 投稿 |\n|---|---|\n${rows.join("\n")}\n`);
}

main().catch(e => { console.error("いいねに失敗しました:", e.message); process.exit(1); });
