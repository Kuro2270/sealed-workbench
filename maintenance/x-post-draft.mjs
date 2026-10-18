#!/usr/bin/env node
/*
 * 動画を作ったときに、X に手で投稿するための「おすすめの投稿文」（タグ付き）を作り、Markdown で書き出す。
 * X への自動投稿は止めている（従量課金のため）ので、ショート｜1・長尺｜1 の実行ページのまとめ（Summary）に出して、手で貼る。
 * X は日本語だけに投稿する（英語圏への案内は Bluesky に自動で出す。日英が混ざると、どちらのフォロワーにも邪魔になるため）。
 * 英語を渡したときは、投稿文は作らず、その旨を1行だけ書く。
 *
 *   node maintenance/x-post-draft.mjs short FRA ja early   … ショート（形式は draft | sealed | early）
 *   node maintenance/x-post-draft.mjs long  FRA en         … 長尺
 *   VIDEO_URL=https://… を付けると、動画のリンクにそれを使う
 *
 * 読むもの：YouTube に上げたときの記録（short/<SET>/<TAG>.youtube.json、long/<SET>/[en/]youtube.json）、
 *           記事データ（data/articles/<SET>_<形式>.json。無ければ暫定版 data/provisional。report-data.mjs で読む）、カードの日本語名（data/names/<SET>.json）
 * 役割はこれだけ（投稿はしない。文字数の数え方は x-text.mjs）。
 */
import { readFile } from "node:fs/promises";
import { xLength } from "./x-text.mjs";
import { setName } from "./set-name.mjs";
import { loadArticle } from "./report-data.mjs";

const [kind = "short", SET_IN = "", LANG_IN = "ja", MODE_IN = "draft"] = process.argv.slice(2);
const SET = SET_IN.toUpperCase(), JA = LANG_IN !== "en", LANG = JA ? "ja" : "en";
const MODE = kind === "long" ? "draft" : (["sealed", "early"].includes(MODE_IN) ? MODE_IN : "draft");
const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const readJson = async (p, fb) => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return fb; } };

const COLOR = JA ? { W: "白", U: "青", B: "黒", R: "赤", G: "緑" } : { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const pairName = c => [...c].map(k => COLOR[k] || k).join(JA ? "" : "-");
const pct = v => (v * 100).toFixed(1) + "%";
const tagOf = s => "#" + String(s).replace(/[\s・:：'’!！?？,，.。&＆\-－]/g, "");

async function main(){
  if(!SET){ console.error("使い方: node maintenance/x-post-draft.mjs short|long SET ja|en [draft|sealed|early]"); process.exit(1); }
  if(!JA){
    process.stdout.write(`\n### X の投稿文\n\n英語の動画は X には投稿しません。Bluesky に自動で案内が出ます（${kind === "long" ? "長尺はサイトに載った日に「SNS｜長尺の案内」が投稿" : "ショートは公開後に「ショート｜2 動画を配信」を押したとき"}）。\n\n`);
    return;
  }
  const TAG = MODE === "draft" ? LANG : `${LANG}-${MODE}`;
  const yt = kind === "long" ? await readJson(`long/${SET}/${JA ? "" : "en/"}youtube.json`, null) : await readJson(`short/${SET}/${TAG}.youtube.json`, null);
  const d = MODE === "early" ? await readJson(`data/articles/${SET}_${MODE}.json`, null) : await loadArticle(SET, MODE);
  const names = (await readJson(`data/names/${SET}.json`, {})).names || {};
  const nm = (await setName(SET))[LANG];
  // VIDEO_URL があればそれを使う（公開後に「SNS｜X の文案を作る」が呼ぶとき。YouTube に上げたときの記録はリポジトリに残らないため）
  const link = process.env.VIDEO_URL || (yt ? (kind === "long" ? yt.url : (yt.shortsUrl || yt.url)) : (JA ? "（YouTube のリンク）" : "(YouTube link)"));

  // 見どころ：いちばん勝っている2色の組み合わせと、ボムの1位（記事データがあるときだけ。数字は動画と同じもの）
  let pairLine = null, bombLine = null;
  if(d){
    const pairs = (d.archetypes || []).filter(a => a.colors && a.colors.length === 2);
    const total = pairs.reduce((n, a) => n + a.games, 0);
    const best = pairs.filter(a => a.games >= Math.max(1000, total * 0.01)).sort((a, b) => b.wr - a.wr)[0];
    if(best) pairLine = JA ? `最強の組み合わせ：${pairName(best.colors)}（${pct(best.wr)}）` : `Best pair: ${pairName(best.colors)} (${pct(best.wr)})`;
    const bomb = [...((d.top || {}).rare || []), ...((d.top || {}).mythic || [])].sort((a, b) => b.gih - a.gih)[0];
    if(bomb) bombLine = JA ? `ボム1位：${names[bomb.name] || bomb.name}（${pct(bomb.gih)}）` : `Top bomb: ${String(bomb.name).split(" // ")[0]} (${pct(bomb.gih)})`;
  }

  const head = kind === "long"
    ? (JA ? `【${nm}】リミテッド環境まとめ動画を公開しました` : `${nm} Limited review is out`)
    : MODE === "early"
      ? (JA ? `【${nm}】速報！発売直後のリミテッド環境を1分で` : `${nm} Limited: the early look in 60 seconds`)
      : (JA ? `【${nm}】1分でわかる${MODE === "sealed" ? "シールド" : "ドラフト"}環境` : `${nm} ${MODE === "sealed" ? "Sealed" : "Draft"} in 60 seconds`);
  const lead = kind === "long"
    ? (JA ? "強い色・狙い目の色・ボム10枚・罠なレアまで、17Landsの実戦データで解説しました。" : "Best colours, sleeper pairs, the top 10 bombs and trap rares, all from 17Lands data.")
    : MODE === "early"
      ? (JA ? "17Landsの発売直後のデータから、強い色の組み合わせとボム・コモン／アンコモンのトップを速報でまとめました。" : "Best pairs, top bombs and the best commons and uncommons from the first days of 17Lands data.")
      : (JA ? "17Landsの実戦データから、強い色の組み合わせとボム・コモン／アンコモンのトップを1分にまとめました。" : "Best pairs, top bombs and the best commons and uncommons from 17Lands data, in one minute.");
  const siteUrl = `${SITE}/${MODE === "early" ? "" : `sets/${SET}${JA ? "" : ".en"}.html`}`;
  const tags = JA ? ["#MTGアリーナ", "#MTGA", "#リミテッド", tagOf(nm)] : ["#MTGArena", "#MTGA", "#MTGLimited", tagOf(nm)];

  // 280 文字（X の数え方）に収まるまで、説明の文 → ボム1位の行 → 4つ目のタグ の順に落とす（見どころの数字を説明より優先する）
  const build = (useLead, useBomb, nTags) => [
    head, "",
    useLead ? lead : null,
    pairLine, useBomb ? bombLine : null, "",
    link,
    // 速報のころは、サイトにはまだ全カードの勝率が無い（発売12日目から）ので、練習ツールとして案内する
    MODE === "early" ? (JA ? `練習ツール（無料） ${siteUrl}` : `Free practice tools: ${siteUrl}`) : (JA ? `全カードの勝率（無料） ${siteUrl}` : `Every card's win rate (free): ${siteUrl}`),
    "",
    tags.slice(0, nTags).join(" ")
  ].filter(l => l != null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const text = [[true, true, 4], [false, true, 4], [false, false, 4], [false, false, 3]].map(o => build(...o)).find(t => xLength(t) <= 280) || build(false, false, 3);

  const out = [
    "",
    `### X のおすすめ投稿文（${JA ? "日本語" : "英語"}）`,
    "",
    JA ? "そのまま貼れます。動画は YouTube のリンクのほかに、Artifacts の動画ファイルを添付するとより表示されやすくなります。"
       : "Ready to paste. Attaching the video file from Artifacts (instead of only the YouTube link) tends to reach more people.",
    "",
    "```",
    text,
    "```",
    "",
    `（X の数え方で ${xLength(text)} / 280 文字）`,
    ""
  ];
  process.stdout.write(out.join("\n") + "\n");
}
main().catch(e => { console.error("X のおすすめ投稿文を作れませんでした: " + e.message); process.exit(0); });
