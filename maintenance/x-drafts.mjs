#!/usr/bin/env node
/*
 * X に手で投稿する告知の文案を作り、data/social/x-queue/<id>.json に置く（知らせるのは「SNS｜X 投稿の催促」）。
 * X の告知は、次の3つのときだけ（毎日の投稿はしない）。
 *   1. 新セットで練習（ドラフト・シールド）ができるようになったとき … 「SNS｜新セット発売の告知」の記録（data/social/release-posted.json）
 *   2. 速報のショート（日本語）を公開したとき                       … data/videos.json の <SET>.ja.early が公開（public）になったもの
 *   3. 環境まとめの長尺（日本語）を公開したとき                     … data/long.json の <SET>.ja（サイトに載った＝公開済み）
 * 文案を作ったものは data/social/x-drafted.json に記録し、2回は作らない。
 * はじめて動かしたとき（記録が無いとき）は、過去の分をまとめて出さないよう、いまあるものを「作成済み」として記録するだけにする。
 * 14日より前の出来事は、時機を逃しているので作らない。
 *
 *   node maintenance/x-drafts.mjs
 *   DRY_RUN=1 node maintenance/x-drafts.mjs   … 文面を表示するだけ（置かない・記録しない）
 *   PREVIEW_SET=FRA node maintenance/x-drafts.mjs … そのセットの3つの文面を、記録に関係なく見るだけ（置かない・記録しない）
 *
 * 文面：1 は release-text.mjs、2・3 は動画を作ったときと同じ x-post-draft.mjs（リンクは公開した動画）。
 * 添える画像：1 はセット名入りの画像を作る（x-release-image.mjs → data/social/x-img/<SET>-release.png。サイトから見られる）、
 *            2 は速報動画のサムネイル（assets/video/<SET>-ja-early.jpg）、3 は YouTube のサムネイル。
 */
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { releaseTexts } from "./release-text.mjs";
import { setName } from "./set-name.mjs";
import { makeReleaseImage } from "./x-release-image.mjs";

const DRY = process.env.DRY_RUN === "1";
const PREVIEW = (process.env.PREVIEW_SET || "").trim().toUpperCase();
const LOG = "data/social/x-drafted.json";
const QUEUE = "data/social/x-queue";
const FRESH_MS = 14 * 86400000;
const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const IMG_DIR = "data/social/x-img", PREVIEW_DIR = "x-preview";
const readJson = async (p, f) => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return f; } };
const summary = async md => { if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n"); };

/* いま分かっている出来事の一覧 */
async function events(){
  const out = [];
  for(const [SET, r] of Object.entries(await readJson("data/social/release-posted.json", {})))
    out.push({ id: `${SET}-release`, kind: "release", set: SET, at: r.at, fallbackName: r.name });
  for(const [SET, v] of Object.entries(await readJson("data/videos.json", {}))){
    const e = v && v.ja && v.ja.early;
    if(e && e.id && e.public) out.push({ id: `${SET}-early`, kind: "early", set: SET, at: e.publishedAt || e.uploadedAt, url: `https://youtube.com/shorts/${e.id}` });
  }
  for(const [SET, v] of Object.entries(await readJson("data/long.json", {}))){
    const l = v && v.ja;
    if(l && l.id) out.push({ id: `${SET}-long`, kind: "long", set: SET, at: l.publishedAt || l.uploadedAt, url: `https://www.youtube.com/watch?v=${l.id}`, videoId: l.id });
  }
  return out;
}

/* 動画の告知文（動画を作ったときの「X のおすすめ投稿文」と同じ作り方） */
function videoText(e){
  const args = e.kind === "long" ? ["long", e.set, "ja"] : ["short", e.set, "ja", "early"];
  const md = execFileSync("node", ["maintenance/x-post-draft.mjs", ...args], { env: { ...process.env, VIDEO_URL: e.url }, encoding: "utf8" });
  const m = md.match(/```\n([\s\S]*?)\n```/);
  if(!m) throw new Error(`${e.id}: 文面を作れませんでした`);
  return m[1];
}

/* 文面を作る（3つ共通） */
async function draft(e){
  const nm = await setName(e.set);
  const ja = nm.ja === e.set && e.fallbackName ? e.fallbackName : nm.ja;
  const text = e.kind === "release" ? releaseTexts({ ja, en: nm.en }).x : videoText(e);
  const title = `${ja}（${e.set}）の${{ release: "発売告知", early: "速報動画の告知", long: "環境まとめ動画の告知" }[e.kind]}`;
  return { title, text, ja };
}

/* 投稿に添える画像の URL（発売告知は画像を作る。dir は書き出す場所） */
async function imageFor(e, ja, dir){
  if(e.kind === "release"){
    const path = `${dir}/${e.set}-release.png`;
    await makeReleaseImage(e.set, ja, path);
    return { url: `${SITE}/${path}`, path };
  }
  if(e.kind === "early"){
    const path = `assets/video/${e.set}-ja-early.jpg`;
    return existsSync(path) ? { url: `${SITE}/${path}` } : null;
  }
  return e.videoId ? { url: `https://i.ytimg.com/vi/${e.videoId}/maxresdefault.jpg` } : null;
}

/* 見るだけ：そのセットの3つの文面を、記録に関係なく出す（動画がまだ無いものは、その旨だけ） */
async function preview(){
  const all = await events();
  for(const kind of ["release", "early", "long"]){
    const e = all.find(x => x.set === PREVIEW && x.kind === kind) || (kind === "release" ? { id: `${PREVIEW}-release`, kind, set: PREVIEW } : null);
    const label = { release: "発売告知", early: "速報動画の告知", long: "環境まとめ動画の告知" }[kind];
    if(!e){ console.log(`\n--- ${PREVIEW} の${label} ---\n（公開した動画がまだ無いので作れません）`); await summary(`## ${PREVIEW} の${label}\n\n公開した動画がまだ無いので作れません。\n`); continue; }
    const d = await draft(e);
    const img = await imageFor(e, d.ja, PREVIEW_DIR);
    console.log(`\n--- ${d.title} ---\n${d.text}\n（画像: ${img ? (img.path || img.url) : "なし"}）`);
    const imgMd = !img ? "" : img.path ? `添える画像：成果物（Artifacts）の「x-preview」に入っています（${img.path.split("/").pop()}）\n` : `添える画像：\n\n![](${img.url})\n`;
    await summary(`## ${d.title}\n\n\`\`\`\n${d.text}\n\`\`\`\n\n${imgMd}`);
  }
}

async function main(){
  if(PREVIEW) return preview();
  const first = !existsSync(LOG);
  const done = await readJson(LOG, {});
  let n = 0;
  for(const e of await events()){
    if(done[e.id]) continue;
    if(first){ done[e.id] = { at: new Date().toISOString(), seeded: true }; continue; }
    if(e.at && Date.now() - Date.parse(e.at) > FRESH_MS){ console.log(`${e.id}: 古いので作りません（${e.at}）`); done[e.id] = { at: new Date().toISOString(), skipped: "old" }; continue; }
    const { title, text, ja } = await draft(e);
    const img = await imageFor(e, ja, DRY ? PREVIEW_DIR : IMG_DIR);
    console.log(`\n--- ${title} ---\n${text}\n（画像: ${img ? img.url : "なし"}）`);
    await summary(`## ${title}\n\n\`\`\`\n${text}\n\`\`\`\n`);
    n++;
    if(DRY) continue;
    await mkdir(QUEUE, { recursive: true });
    await writeFile(`${QUEUE}/${e.id}.json`, JSON.stringify({ id: e.id, title, text, image: img ? img.url : null, created: new Date().toISOString() }, null, 2) + "\n", "utf8");
    done[e.id] = { at: new Date().toISOString() };
  }
  if(first) console.log(DRY
    ? `はじめての実行です。本番では、いまある ${Object.keys(done).length} 件を「作成済み」として記録するだけで、文案は作りません（いまは確認だけなので、記録もしていません）。文面を見たいときは「文面を見るだけ：セット」にセットを入れて実行してください`
    : `はじめての実行なので、いまある ${Object.keys(done).length} 件を「作成済み」として記録しました（文案は作りません）`);
  else if(!n) console.log("新しい告知はありません。");
  if(!DRY) { await mkdir("data/social", { recursive: true }); await writeFile(LOG, JSON.stringify(done, null, 2) + "\n", "utf8"); }
}

main().catch(e => { console.error("X の文案を作れませんでした:", e.message); process.exit(1); });
