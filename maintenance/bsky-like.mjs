#!/usr/bin/env node
/*
 * Bluesky で、MTGアリーナ・マジック：ザ・ギャザリングについての最近の投稿を探して、いいねを付ける（1日の上限つき）。
 *   役割はこれだけ。投稿はしない（告知は release-post.mjs）。
 *
 *   node maintenance/bsky-like.mjs                 … いいねを付ける
 *   DRY_RUN=1 node maintenance/bsky-like.mjs       … 付ける候補を見るだけ（いいねはしない）
 *
 * 環境変数：BSKY_HANDLE, BSKY_APP_PASSWORD（無ければ何もしない）
 *           LIKE_LIMIT … 1日（日本時間）に付ける上限。既定 10。今日すでに付けた数（手で付けたものも含む）を引いた分だけ付ける
 *           BSKY_BASE  … 確認用（作り物のサーバーに向ける）
 *
 * 付けない投稿：自分の投稿、もう付けた投稿、返信、ラベル（成人向け・スパムなど）の付いた投稿や人、
 *               ミュート・ブロックの関係にある人、短すぎる投稿、2日より前の投稿。
 * 1回の実行で、同じ人には1つだけ。いいねとの間は「75秒 ＋ 10秒〜3分のランダム」あける（人が付けるくらいの間隔で、毎回ばらつかせる）。
 *   確認用に LIKE_WAIT_MS（固定の分）・LIKE_JITTER_MIN_MS / LIKE_JITTER_MAX_MS（ランダムの幅）で変えられる。
 */
import { appendFile } from "node:fs/promises";

const BASE = process.env.BSKY_BASE || "https://bsky.social/xrpc";
const DRY = process.env.DRY_RUN === "1";
const LIMIT = Math.max(0, Math.min(50, parseInt(process.env.LIKE_LIMIT || "10", 10) || 10));
const WAIT_MS = +(process.env.LIKE_WAIT_MS ?? 75000);
const JITTER_MIN = +(process.env.LIKE_JITTER_MIN_MS ?? 10000), JITTER_MAX = +(process.env.LIKE_JITTER_MAX_MS ?? 180000);
const waitMs = () => WAIT_MS + JITTER_MIN + Math.random() * Math.max(0, JITTER_MAX - JITTER_MIN);
const MAX_AGE_H = 48, MIN_TEXT = 20;

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

/* 今日（日本時間）すでに付けたいいねの数。自分のいいねの記録を新しい順に見る */
async function likedToday(auth, did){
  const from = jstMidnight(); let n = 0, cursor = "";
  for(let page = 0; page < 5; page++){
    const d = await api(`com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=app.bsky.feed.like&limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, auth);
    for(const rec of d.records || []){
      if(Date.parse(rec.value && rec.value.createdAt) >= from) n++;
      else return n;
    }
    if(!d.cursor) return n;
    cursor = d.cursor;
  }
  return n;
}

function suitable(p, me){
  const rec = p.record || {};
  if(p.author.did === me) return false;
  if(p.viewer && p.viewer.like) return false;
  if(rec.reply) return false;
  if((p.labels || []).length || (p.author.labels || []).length) return false;
  const v = p.author.viewer || {};
  if(v.muted || v.blockedBy || v.blocking) return false;
  if(String(rec.text || "").trim().length < MIN_TEXT) return false;
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

  const done = await likedToday(auth, session.did);
  const room = Math.max(0, LIMIT - done);
  console.log(`今日のいいね：${done} 件（上限 ${LIMIT}）。あと ${room} 件まで`);
  if(!room && !DRY){ await summary(`今日はもう上限（${LIMIT}件）まで付けています。`); return; }

  /* 言葉ごとに探して、交互に並べる */
  const since = new Date(Date.now() - MAX_AGE_H * 3600000).toISOString();
  const lists = [];
  for(const { q, lang } of QUERIES){
    try{
      const d = await api(`app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=latest&limit=50&since=${encodeURIComponent(since)}${lang ? "&lang=" + lang : ""}`, auth);
      lists.push((d.posts || []).filter(p => suitable(p, session.did)));
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
  if(!picked.length){ console.log("いいねを付ける投稿は見つかりませんでした。"); await summary("いいねを付ける投稿は見つかりませんでした。"); return; }

  const rows = [];
  for(const [i, p] of picked.entries()){
    if(i && !DRY){ const w = waitMs(); console.log(`（${Math.round(w / 1000)} 秒待ちます）`); await sleep(w); }   // 前のいいねから間をあける
    const line = `@${p.author.handle}：${oneLine(p.record.text)}`;
    if(DRY){ console.log("候補 " + line); rows.push(`| 候補 | [${line.replace(/\|/g, "／")}](${postUrl(p)}) |`); continue; }
    try{
      await api("com.atproto.repo.createRecord", auth, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.like", record: { $type: "app.bsky.feed.like", subject: { uri: p.uri, cid: p.cid }, createdAt: new Date().toISOString() } }) });
      console.log("いいね " + line); rows.push(`| いいね | [${line.replace(/\|/g, "／")}](${postUrl(p)}) |`);
    }catch(e){ console.log(`いいねに失敗（${line}）: ${e.message}`); rows.push(`| 失敗 | ${line.replace(/\|/g, "／")} |`); process.exitCode = 1; }
  }
  await summary(`## Bluesky のいいね${DRY ? "（候補を見るだけ）" : ""}\n\n今日のいいね：実行前 ${done} 件 / 上限 ${LIMIT} 件\n\n| | 投稿 |\n|---|---|\n${rows.join("\n")}\n`);
}

main().catch(e => { console.error("いいねに失敗しました:", e.message); process.exit(1); });
