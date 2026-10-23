#!/usr/bin/env node
/*
 * Bluesky の自動いいねが「今日の分」をもう済ませたかを調べる。役割はこれだけ（いいねを付けるのは bsky-like.mjs）。
 *   自動の実行（schedule）は、GitHub の混み具合で数時間遅れたり、飛ばされたりする（2026年10月：20:43 の分が翌 1:01 に動いた）。
 *   そこで、1日に何回か予備の時刻を入れておき、その日の分がもう済んでいたら、あとの回は何もしない（＝自動は確実に1日1回）。
 *
 *   「今日」は、日本時間の朝4時から翌朝4時まで（夜の分が遅れて日付をまたいでも、同じ日の分として数える）。
 *   済んだ＝この「今日」に作られた自動の実行（自分は除く）で、成功で終わったものがある。
 *     失敗で終わった実行（ログインできない・1件も付けられない）は済んだことにしない（次の時刻にもう一度動く）。
 *   手で押した実行は数えない。
 *
 *   node maintenance/bsky-like-done.mjs   … GITHUB_OUTPUT に done=true / done=false を書く
 * 環境変数：GITHUB_TOKEN（actions: read）、GITHUB_REPOSITORY、GITHUB_RUN_ID（Actions が入れる）
 *           LIKE_WORKFLOW … ワークフローのファイル名（既定 bsky-like.yml）
 *           LIKE_DAY_START_JST … 「今日」の始まりの時刻（日本時間。既定 4）
 * 調べられなかったとき（GitHub に届かないなど）は失敗にする（次の時刻にもう一度調べる。済んでいないのに止めたり、2回付けたりしないため）
 */
import { appendFile } from "node:fs/promises";

const API = process.env.GITHUB_API_URL || "https://api.github.com";
const REPO = process.env.GITHUB_REPOSITORY, RUN_ID = Number(process.env.GITHUB_RUN_ID || 0), TOKEN = process.env.GITHUB_TOKEN;
const WORKFLOW = process.env.LIKE_WORKFLOW || "bsky-like.yml";
const START_H = Number(process.env.LIKE_DAY_START_JST ?? 4);
const NOW = process.env.LIKE_NOW ? Date.parse(process.env.LIKE_NOW) : Date.now();   // 確認用（時刻を決めて試す）

/* 「今日」の始まり（UTC のミリ秒）：日本時間の朝 START_H 時 */
export function dayStart(now = NOW, startH = START_H){
  const j = new Date(now + 9 * 3600000 - startH * 3600000);
  return Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - 9 * 3600000 + startH * 3600000;
}

async function main(){
  if(!REPO || !TOKEN) throw new Error("GITHUB_REPOSITORY と GITHUB_TOKEN が要ります（Actions の中で動かす）");
  const from = new Date(dayStart()).toISOString().replace(/\.\d+Z$/, "Z");
  const url = `${API}/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=schedule&created=${encodeURIComponent(">=" + from)}&per_page=100`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" } });
  if(!r.ok) throw new Error(`実行の一覧を取れませんでした HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const runs = (await r.json()).workflow_runs || [];
  const done = runs.filter(x => x.id !== RUN_ID && x.conclusion === "success");
  const jst = t => new Date(Date.parse(t) + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ");
  const msg = done.length
    ? `今日（日本時間 ${jst(from)} から）の自動のいいねは、もう済んでいます（#${done.map(x => x.run_number).join("・#")}）。今回は何もしません。`
    : `今日（日本時間 ${jst(from)} から）の自動のいいねは、まだです。いいねを付けます。`;
  console.log(msg);
  if(process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `done=${done.length ? "true" : "false"}\n`);
  if(done.length && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, msg + "\n");
}

if(import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error("調べられませんでした:", e.message); process.exit(1); });
