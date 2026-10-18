/*
 * サイトのデータが段階的に新しくなったことの「出来事」と、その告知文（X は日本語・Bluesky は英語）を作る。役割はこれだけ（投稿はしない）。
 *   出来事は5つ。どれもサイトのファイルを見て決める（17Lands には問い合わせない）。
 *     memo    … 速報メモを、アリーナの配信から7日目の数字で書き直した（data/early/<SET>.json の round が 2）
 *     first   … 全カードの勝率とティア表を載せた（配信12日目。data/provisional/<SET>_draft.json の stage）
 *     assist  … ドラフト補助・シールド補助が、そのセットの勝率つきで使えるようになった（first の翌日。同じ日に2件出さないため1日ずらす）
 *     refined … その1週間後に、増えたデータで勝率を作り直した（stage が refined）
 *     final   … 17Lands の公開データで作り直し、「環境の速さ」が加わった（data/articles/<SET>_draft.json に speed がある、発売から60日以内のセット）
 *   X の文案は x-drafts.mjs、Bluesky への投稿は post-data-news.mjs が、ここを使う。
 *
 *   await dataEvents()            … [{ id, kind, set, at }]
 *   await newsText(event, track)  … track が "x" なら日本語（X 用）、"bsky" なら英語（Bluesky 用）の本文。{ text, title, url, desc }
 *   SEED_SKIP … はじめての実行でも「告知済み」にしないで出す出来事（補助ツールの告知は、いま使えるセットにも出したいため）
 */
import { readFile, readdir } from "node:fs/promises";
import { fit } from "./x-text.mjs";
import { setName } from "./set-name.mjs";
import { loadArticle } from "./report-data.mjs";

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const DAY = 86400000;
const readJson = async (p, f) => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return f; } };
const tagOf = s => "#" + String(s).replace(/[\s・:：'’!！?？,，.。&＆\-－]/g, "");
const pct = v => (v * 100).toFixed(1) + "%";
const CJ = { W: "白", U: "青", B: "黒", R: "赤", G: "緑" }, CE = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const jstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export const SEED_SKIP = ["assist"];

export async function dataEvents(){
  const out = [];
  for(const f of await readdir("data/early").catch(() => [])){
    const m = f.match(/^([A-Z0-9]+)\.json$/); if(!m) continue;
    const n = await readJson(`data/early/${f}`, null);
    if(n && (n.round || 1) >= 2) out.push({ id: `${m[1]}-memo`, kind: "memo", set: m[1], at: n.as_of });
  }
  for(const f of await readdir("data/provisional").catch(() => [])){
    const m = f.match(/^([A-Z0-9]+)_draft\.json$/); if(!m) continue;
    const d = await readJson(`data/provisional/${f}`, null); if(!d) continue;
    const firstAt = d.first_at || String(d.generated_at || "").slice(0, 10);
    out.push({ id: `${m[1]}-first`, kind: "first", set: m[1], at: firstAt });
    const assistAt = new Date(Date.parse(firstAt + "T00:00:00Z") + DAY).toISOString().slice(0, 10);
    if(jstToday() >= assistAt) out.push({ id: `${m[1]}-assist`, kind: "assist", set: m[1], at: assistAt });
    if(d.stage === "refined") out.push({ id: `${m[1]}-refined`, kind: "refined", set: m[1], at: String(d.generated_at || "").slice(0, 10) });
  }
  const idx = await readJson("data/articles/index.json", { articles: [] });
  for(const a of idx.articles || []){
    if(a.mode !== "draft" || !a.released_at || Date.now() - Date.parse(a.released_at) > 60 * DAY) continue;
    const d = await readJson(`data/articles/${a.set}_draft.json`, null);
    if(d && (d.speed || []).some(s => s.wr != null)) out.push({ id: `${a.set}-final`, kind: "final", set: a.set, at: String(d.data_generated_at || d.generated_at || "").slice(0, 10) });
  }
  return out;
}

/* 見どころ（数字は数個だけ）：最も勝っている2色と、勝率1位のレア・神話レア */
function highlights(d, names, ja){
  const pairs = (d.archetypes || []).filter(a => a.colors && a.colors.length === 2);
  const total = pairs.reduce((n, a) => n + a.games, 0);
  const best = pairs.filter(a => a.games >= Math.max(1000, total * 0.01)).sort((a, b) => b.wr - a.wr)[0];
  const bomb = [...((d.top || {}).rare || []), ...((d.top || {}).mythic || [])].sort((a, b) => b.gih - a.gih)[0];
  const out = [];
  if(best) out.push(ja ? `~最強の組み合わせ：${[...best.colors].map(c => CJ[c]).join("")}（${pct(best.wr)}）` : `~Best pair: ${[...best.colors].map(c => CE[c]).join("-")} (${pct(best.wr)})`);
  if(bomb) out.push(ja ? `~ボム1位：${names[bomb.name] || bomb.name}（${pct(bomb.gih)}）` : `~Top bomb: ${String(bomb.name).split(" // ")[0]} (${pct(bomb.gih)})`);
  return out;
}

export async function newsText(e, track){
  const ja = track === "x";
  const nm = (await setName(e.set))[ja ? "ja" : "en"];
  const names = ja ? ((await readJson(`data/names/${e.set}.json`, {})).names || {}) : {};
  // 補助ツールの告知は「MTGアリーナで使う」のページ（ドラフト補助・シールド補助の入口）へ。ほかはセット別ページ（速報メモは下見ページ）
  const page = e.kind === "assist" ? `${SITE}/arena.html` : `${SITE}/sets/${e.set}${e.kind === "memo" ? ".profile" : ""}${ja ? "" : ".en"}.html`;
  const url = `${page}?from=${track}`;
  const tags = ja ? ["#MTGアリーナ", "#MTGA", "#リミテッド", tagOf(nm)] : ["#MTGArena", "#MTGLimited", tagOf(nm)];
  let head, body = [], desc = "Card win rates, a card tier list and colour pairs for MTG Arena Limited. Free, no sign-up.";
  if(e.kind === "assist"){
    head = ja ? `【${nm}】ドラフト補助・シールド補助が、全カードの勝率つきで使えます` : `${nm}: the Draft and Sealed assistants now have every card's win rate`;
    body = ja ? ["・ドラフト補助：いま見ているパックを、勝率と自分の色からおすすめ順に", "・シールド補助：配られたプールから、2色のデッキ案を組みます", "~アリーナのログを読むだけ。PCのChrome／Edgeで無料"]
              : ["• Draft assistant: ranks the pack in front of you by win rate and your colours", "• Sealed assistant: builds two-colour deck ideas from your real pool", "~It just reads Arena's log. Free, on PC (Chrome / Edge)."];
    desc = "Draft and Sealed assistants for MTG Arena: they read Arena's log and suggest picks and decks by win rate. Free, PC (Chrome / Edge).";
  }else if(e.kind === "memo"){
    const n = await readJson(`data/early/${e.set}.json`, {});
    head = ja ? `【${nm}】発売1週間の速報メモを更新しました` : `${nm}: the early look, updated with week-one data`;
    const first = String((ja ? n.ja : n.en) || "").split(ja ? /(?<=。)/ : /(?<=\.)\s/)[0];
    if(first) body.push("~" + first.trim());
  }else{
    const d = await loadArticle(e.set, "draft") || {};
    if(e.kind === "first") head = ja ? `【${nm}】全カードの勝率とティア表を公開しました` : `${nm}: every card's win rate and a card tier list are up`;
    else if(e.kind === "refined") head = ja ? `【${nm}】1週間分のデータで、全カードの勝率を更新しました` : `${nm}: card win rates updated with another week of data`;
    else{
      head = ja ? `【${nm}】環境の速さを追加しました` : `${nm}: format speed is now in the report`;
      const rows = (d.speed || []).filter(s => s.wr != null), best = rows.slice().sort((a, b) => b.wr - a.wr)[0];
      const band = best ? (best.key === "fast" ? (ja ? "2.9未満" : "under 2.9") : best.key === "slower" ? (ja ? "3.5以上" : "3.5+") : best.key === "mid" ? "2.9–3.2" : "3.2–3.5") : "";
      if(best) body.push(ja ? `~平均マナ総量${band}のデッキが最も勝っています（${pct(best.wr)}）` : `~Decks averaging ${band} mana value win the most (${pct(best.wr)})`);
    }
    body.push(...highlights(d, names, ja));
  }
  const text = fit([head, "", ...body, "", url, "", tags.join(" ")], track);
  return { text, title: head, url: page, desc };
}
