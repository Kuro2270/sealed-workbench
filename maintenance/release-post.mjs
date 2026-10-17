#!/usr/bin/env node
/*
 * 新セットが MTGアリーナに出て、練習（ドラフト・シールド）ができるようになった日に、Bluesky に英語で告知する（リンクのカードつき）。
 *   X は手で投稿する。日本語の文案は「SNS｜X の文案を作る」（x-drafts.mjs）が、ここの記録（release-posted.json）を見て作る。
 *
 *   node maintenance/release-post.mjs                 … 今日が告知の日のセットを探して出す
 *   SET=FRA DRY_RUN=1 node maintenance/release-post.mjs … セットを決めて、文面の確認だけ
 *
 * 告知の日：アリーナは紙の発売日の3日前（米国の火曜）に始まり、日本時間では翌日（水曜）の0時ごろになる。
 *   そこで「紙の発売日の2日前〜1日後（日本時間）」を告知の期間とし、その間に1回だけ出す（Actions が遅れたり失敗したときの余裕）。
 *   カードの情報（Scryfall）がまだ揃っていないセットは、練習が始められないので出さない（翌日にまた見る）。
 * 出したセットは data/social/release-posted.json に記録し、2回は出さない。
 */
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { releaseTexts } from "./release-text.mjs";
import { postBskyLink } from "./bsky-link-post.mjs";
import { setName, shortName } from "./set-name.mjs";
import { makeReleaseImage } from "./x-release-image.mjs";

const SCRY = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" };
const DRY = process.env.DRY_RUN === "1";
const ONLY = (process.env.SET || "").trim().toUpperCase();
const LOG = "data/social/release-posted.json";
const DAYS_BEFORE = 2, DAYS_AFTER = 1;

const readJson = async (p, f) => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return f; } };
const jstDate = (t = Date.now()) => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const summary = async md => { if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n"); };

/* 告知の期間に入っているセット（ONLY があればそれだけ） */
async function targets(){
  const r = await fetch(`${SCRY}/sets`, { headers: HEADERS });
  if(!r.ok) throw new Error(`Scryfall のセット一覧 HTTP ${r.status}`);
  const all = (await r.json()).data;
  if(ONLY){
    const s = all.find(x => x.code.toUpperCase() === ONLY);
    if(!s) throw new Error(`セット ${ONLY} が Scryfall にありません`);
    return [s];
  }
  const today = jstDate();
  return all.filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at
    && today >= addDays(s.released_at, -DAYS_BEFORE) && today <= addDays(s.released_at, DAYS_AFTER) && s.card_count > 150);
}

/* 練習で使うカードが Scryfall に揃っているか（パックに入るカードが100枚以上） */
async function cardsReady(code){
  const r = await fetch(`${SCRY}/cards/search?q=${encodeURIComponent(`set:${code} is:booster`)}`, { headers: HEADERS });
  if(!r.ok) return false;
  return ((await r.json()).total_cards || 0) >= 100;
}

async function main(){
  const posted = await readJson(LOG, {});
  const sets = await targets();
  if(!sets.length){ console.log("今日が告知の日のセットはありません。"); return; }
  for(const s of sets){
    const SET = s.code.toUpperCase();
    if(posted[SET] && !ONLY){ console.log(`${SET}: もう告知しています（${posted[SET].at}）`); continue; }
    if(!(await cardsReady(s.code))){ console.log(`${SET}: カードの情報がまだ揃っていないので、今日は出しません`); continue; }
    const n = await setName(SET);
    const name = { ja: n.ja === SET ? s.name : n.ja, en: shortName(s.name) };   // 英語名は Scryfall のもの（発売直後はサイト側にまだ英語名の記録が無いため）
    const t = releaseTexts(name);
    console.log(`\n--- ${SET}（紙の発売 ${s.released_at}）---\n${t.bsky}`);
    // カードの画像：セットの絵を背景にした告知の画像（英語）。作れなかったときは、ドラフト練習（対人戦）の共有画像
    let image = "ogp-room-en.png";
    try{ image = (await makeReleaseImage(SET, name.en, `social-tmp/${SET}-release-en.jpg`, "en", { small: true })).out; }
    catch(e){ console.log("告知の画像を作れませんでした（ドラフト練習（対人戦）の共有画像を使います）: " + e.message); }
    await summary(`## ${name.en}（${SET}）の告知（Bluesky・英語）\n\n\`\`\`\n${t.bsky}\n\`\`\`\n\nカードの画像：${image.startsWith("social-tmp/") ? "成果物（Artifacts）の「bsky-preview」" : image}\n`);
    if(DRY){ console.log("DRY_RUN のため、投稿も記録もしません"); continue; }

    let bsky = false;
    try{
      const res = await postBskyLink(t.bsky, {
        uri: t.bsky.match(/https?:\/\/\S+/)[0],
        title: `${name.en}: practise Draft & Sealed without spending gems`,
        description: "Draft at the same table as your friends (CPUs fill the empty seats) or against 7 CPUs. Import your deck into MTG Arena and play with Direct Challenge. Free, no sign-up.",
        image
      });
      console.log(res.message); bsky = res.ok;
    }catch(e){ console.error(e.message); process.exitCode = 1; }

    posted[SET] = { at: new Date().toISOString(), released_at: s.released_at, name: s.name, bsky };
    await mkdir("data/social", { recursive: true });
    await writeFile(LOG, JSON.stringify(posted, null, 2) + "\n", "utf8");
  }
}

main().catch(e => { console.error("告知に失敗しました:", e.message); process.exit(1); });
