#!/usr/bin/env node
/*
 * サイトのデータが段階的に新しくなったこと（data-news.mjs の出来事）を、Bluesky に英語で1回ずつ告知する。役割はこれだけ。
 *   X（日本語・手で投稿）の文案は x-drafts.mjs が同じ出来事から作る。
 *   告知した出来事は data/social/data-posted.json に記録し、2回は出さない。
 *   はじめての実行は、いまある出来事を「告知済み」として記録するだけで、投稿はしない（過去の分をまとめて流さないため）。
 *   14日より前の出来事は出さない（時機を逃した告知を出さないため）。
 *
 *   node maintenance/post-data-news.mjs           … 告知する
 *   DRY_RUN=1 node maintenance/post-data-news.mjs … 文面を見るだけ（投稿も記録もしない）
 * 環境変数：BSKY_HANDLE, BSKY_APP_PASSWORD（bsky-link-post.mjs）
 */
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dataEvents, newsText } from "./data-news.mjs";
import { postBskyLink } from "./bsky-link-post.mjs";

const DRY = process.env.DRY_RUN === "1";
const LOG = "data/social/data-posted.json";
const FRESH_MS = 14 * 86400000;
const readJson = async (p, f) => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return f; } };
const summary = async md => { if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n"); };

async function main(){
  const first = !existsSync(LOG);
  const done = await readJson(LOG, {});
  let n = 0;
  for(const e of await dataEvents()){
    if(done[e.id]) continue;
    if(first){ done[e.id] = { at: new Date().toISOString(), seeded: true }; continue; }
    if(e.at && Date.now() - Date.parse(e.at) > FRESH_MS){ console.log(`${e.id}: 古いので出しません（${e.at}）`); done[e.id] = { at: new Date().toISOString(), skipped: "old" }; continue; }
    const t = await newsText(e, "bsky");
    console.log(`\n--- ${e.id} ---\n${t.text}`);
    await summary(`## ${e.id}（Bluesky・英語）\n\n\`\`\`\n${t.text}\n\`\`\`\n`);
    n++;
    if(DRY) continue;
    // カードの画像：セットの共有画像（build-set-ogp.mjs が作る）。まだ無ければサイト共通の画像
    const image = existsSync(`sets/og/${e.set}-en.png`) ? `sets/og/${e.set}-en.png` : "ogp-en.png";
    let ok = false;
    try{
      const res = await postBskyLink(t.text, { uri: t.url, title: t.title, description: "Card win rates, a card tier list and colour pairs for MTG Arena Limited. Free, no sign-up.", image });
      console.log(res.message); ok = res.ok;
    }catch(err){ console.error(err.message); process.exitCode = 1; continue; }   // 失敗したものは記録せず、次の実行でもう一度
    done[e.id] = { at: new Date().toISOString(), bsky: ok };
  }
  if(first) console.log(DRY ? `はじめての実行です。本番では、いまある ${Object.keys(done).length} 件を「告知済み」として記録するだけで、投稿はしません` : `はじめての実行なので、いまある ${Object.keys(done).length} 件を「告知済み」として記録しました（投稿はしていません）`);
  else if(!n) console.log("新しい告知はありません。");
  if(!DRY){ await mkdir("data/social", { recursive: true }); await writeFile(LOG, JSON.stringify(done, null, 2) + "\n", "utf8"); }
}

main().catch(e => { console.error("告知に失敗しました:", e.message); process.exit(1); });
