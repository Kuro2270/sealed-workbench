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

let all = {};
try{ all = JSON.parse(await readFile("data/videos.json", "utf8")); }catch(e){}

// 手で足す（記録に無い動画）
if(process.env.MANUAL){
  const [set, lang, mode, id] = process.env.MANUAL.trim().split(/\s+/);
  if(set && lang && mode && id){
    const S = set.toUpperCase();
    all[S] = all[S] || {};
    if(all[S][lang] && all[S][lang].id) all[S][lang] = { draft: all[S][lang] };
    all[S][lang] = all[S][lang] || {};
    all[S][lang][mode] = { ...(all[S][lang][mode] || {}), id, mode, public: false, uploadedAt: (all[S][lang][mode] || {}).uploadedAt || new Date().toISOString().slice(0, 10) };
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

const published = [], waiting = [], failed = [];
for(const S of Object.keys(all).sort()){
  if(ONLY && S !== ONLY) continue;
  for(const L of ["ja", "en"]){
    for(const M of ["draft", "sealed"]){
      const v = all[S][L] && all[S][L][M];
      if(!v || !v.id || v.public) continue;
      const st = await privacy(L, v.id);
      if(st === "public"){
        v.public = true; v.publishedAt = v.publishedAt || new Date().toISOString().slice(0, 10);
        published.push({ set: S, lang: L, mode: M, id: v.id });
        console.log(`配信: ${S} ${L} ${M} https://www.youtube.com/shorts/${v.id}`);
      }else if(st === "missing"){
        failed.push({ set: S, lang: L, mode: M, id: v.id, why: "YouTube に見つかりません（削除した？）" });
        console.log(`見つからない: ${S} ${L} ${M} ${v.id}`);
      }else{
        waiting.push({ set: S, lang: L, mode: M, id: v.id, status: st });
        console.log(`まだ${st === "private" ? "非公開" : st === "unlisted" ? "限定公開" : "不明"}: ${S} ${L} ${M} https://www.youtube.com/shorts/${v.id}`);
      }
    }
  }
}

await writeFile("data/videos.json", JSON.stringify(all, null, 2) + "\n", "utf8");

// 投稿（公開になったものだけ。言語ごとに1本ずつ）
if(POST){
  for(const p of published){
    try{
      execFileSync("node", ["maintenance/post-social.mjs", "video"], { stdio: "inherit",
        env: { ...process.env, ANNOUNCE_SETS: p.set, LANGS: p.lang, BSKY_LANGS: process.env.BSKY_LANGS || "en", VIDEO_ID: p.id, VIDEO_MODE: p.mode } });
    }catch(e){ console.error(`投稿に失敗: ${p.set} ${p.lang} ${p.mode}`); process.exitCode = 1; }
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
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
await writeFile("publish-result.json", JSON.stringify({ published, waiting, failed }), "utf8");
console.log(`\n配信 ${published.length} / 待ち ${waiting.length} / 確認できず ${failed.length}`);
