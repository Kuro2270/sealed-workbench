#!/usr/bin/env node
/*
 * サイトのデータから投稿文を作り、X と Bluesky に投稿する。
 *
 *   node maintenance/post-social.mjs weekly    今週の定型投稿（週替わりで話題を回す）
 *   node maintenance/post-social.mjs monthly   月次のデータ更新の告知
 *   node maintenance/post-social.mjs announce  新セットの告知（ANNOUNCE_SETS="HOB MSH" のように渡す）
 *   node maintenance/post-social.mjs test      動作確認（短い文、URLなし）
 *
 * 環境変数
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET   … X に投稿する（無ければ X は飛ばす）
 *   BSKY_HANDLE, BSKY_APP_PASSWORD                              … Bluesky に投稿する（無ければ飛ばす）
 *   DRY_RUN=1                                                   … 投稿せず文面だけ表示する
 *   VIDEO_ID=...  ANNOUNCE_SETS=HOB  node maintenance/post-social.mjs video … 動画の公開を案内する（「動画を配信」から）
 *   node maintenance/post-social.mjs long   … サイトに載った長尺（data/long.json）のうち、まだ案内していないものを案内する（英語・Bluesky）。
 *                                             案内した動画は data/social/long-posted.json に記録し、2回目は出さない
 *   SKIP_X=1                                                    … X には出さない（手で貼る文面も作らない）
 *   LANGS=ja,en                                                 … 投稿する言語（既定は両方）
 *   BSKY_LANGS=en                                               … Bluesky に出す言語（既定は英語だけ。日本語の利用者が少ないため）
 *
 * 投稿の考え方
 *   ・自分のアカウントに、自分のデータから作った内容を、決まった頻度で出すだけ。返信や他人への働きかけはしない。
 *   ・X は文字数に上限があり、日本語は1文字が2文字分に数えられる。URL は一律 23 文字分。
 *   ・URL を含む投稿は X の従量課金で高め（1件 $0.20）なので、1回の実行で言語ごとに1件ずつに抑える。
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import { xLength, fit } from "./x-text.mjs";
import { loadArticle } from "./report-data.mjs";

// Scryfall は送信元を名乗らないアクセスを拒否するので、必ずこのヘッダーを付ける
const SCRY_HEADERS = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" };

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const DRY = process.env.DRY_RUN === "1";
/* X への自動投稿は、X API が使った分だけの課金（PPU）に変わったため止めている（2026年10月）。X_POST=1 のときだけ自動で投稿する。
   止めているあいだは、投稿文・画像・動画の場所を social-manual/ に書き出し、workflow が Artifacts とまとめ（Summary）に出す。手で X に貼る */
const X_ENABLED = process.env.X_POST === "1";
const MANUAL_DIR = "social-manual";
let manualN = 0;
async function saveManual(label, text, image, extra){
  const { mkdir, appendFile } = await import("node:fs/promises");
  await mkdir(MANUAL_DIR, { recursive: true });
  const slug = label.replace(/[^\w\-]+/g, "-");
  let imgName = "";
  if(image){ imgName = `${slug}.jpg`; await writeFile(`${MANUAL_DIR}/${imgName}`, image); }
  const vid = extra.video ? String(extra.video).split("/").pop() : "";
  const md = [
    `## ${label}`, "",
    "```", text, "```", "",
    ...(extra.reply ? [`返信（動画を添付したときは、YouTube のリンクを返信に）:`, "", "```", extra.reply, "```", ""] : []),
    ...(imgName ? [`画像: ${imgName}`] : []),
    ...(vid ? [`動画: ${vid}（Artifacts「x-manual」に入っています）`] : []),
    ""
  ].join("\n");
  await appendFile(`${MANUAL_DIR}/x-posts.md`, md + "\n", "utf8");
  manualN++;
  return `X: 自動投稿は止めているので、文面を ${MANUAL_DIR}/x-posts.md に書き出しました（手で投稿してください）`;
}
const LANGS = (process.env.LANGS || "ja,en").split(",").map(s => s.trim()).filter(Boolean);
const BSKY_LANGS = (process.env.BSKY_LANGS || "en").split(",").map(s => s.trim()).filter(Boolean);
const mode = process.argv[2] || "weekly";

async function readJson(path, fallback){ try{ return JSON.parse(await readFile(path, "utf8")); }catch(e){ return fallback; } }
const pct = v => (v * 100).toFixed(1) + "%";

/* ---------- セット情報 ---------- */
async function setNamesJa(){
  try{
    const src = await readFile("i18n.js", "utf8");
    const m = src.match(/const SET_JA = (\{[\s\S]*?\});/);
    if(m) return new Function("return " + m[1])();
  }catch(e){}
  return {};
}
async function latestSet(){
  const index = await readJson("data/articles/index.json", null);
  if(!index) return null;
  const drafts = index.articles.filter(a => a.mode === "draft");
  // 公開データがまだ出ていない新しいセット（17Lands の毎日の集計の記事 data/provisional がある）も候補にする
  for(const f of await readdir("data/provisional").catch(() => [])){
    const m = f.match(/^([A-Z0-9]+)_draft\.json$/);
    if(m && !drafts.some(a => a.set === m[1])) drafts.push({ set: m[1], mode: "draft", released_at: "" });
  }
  // 発売日は index.json に無ければ data/names/<SET>.json から補う
  for(const a of drafts){
    if(!a.released_at){ const n = await readJson(`data/names/${a.set}.json`, null); if(n && n.released_at) a.released_at = n.released_at; }
  }
  drafts.sort((a, b) => (b.released_at || "").localeCompare(a.released_at || ""));
  return drafts[0] ? drafts[0].set : null;
}
/* カードの日本語名とセット情報。保存済みのものが無い・空なら Scryfall から取り直す */
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Scryfall の検索結果を全ページ集める */
async function scryAll(q){
  const out = [];
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`;
  try{
    while(url){
      const r = await fetch(url, { headers: SCRY_HEADERS });
      if(!r.ok) break;
      const d = await r.json();
      out.push(...(d.data || []));
      url = d.has_more ? d.next_page : null;
      if(url) await sleep(120);
    }
  }catch(e){}
  return out;
}
/* カードの日本語名を作る。カード番号で英語版と日本語版を突き合わせ、名前でも補う。
   （日本語版の name が英語名と一致しないカードがあるため、番号照合を主にする） */
async function fetchJaNames(code){
  const en = await scryAll(`set:${code.toLowerCase()} unique:prints`);
  const ja = await scryAll(`set:${code.toLowerCase()} lang:ja unique:prints`);
  // 出来事・両面カードは「表 // 裏」の形なので、表の名前でも引けるようにする。
  // 日本語名も表の面のものを使う（「表 // 裏」のまま出さない）。
  const front = s => String(s || "").split(" // ")[0].trim();
  // 日本語名に付いているふりがな（例：「量（りょう）子（し）」）は外す（Scryfall の日本語版の名前に入っているセットがある）
  const noRuby = t => String(t || "").replace(/([\u4E00-\u9FFF々〆ヵヶ])[（(][\u3041-\u3096ー]+[）)]/g, "$1");
  const jaOf = c => noRuby((c.card_faces && c.card_faces[0] && c.card_faces[0].printed_name) || front(c.printed_name));
  const jaByCn = {}, jaByName = {};
  ja.forEach(c => {
    const p = jaOf(c);
    if(!p) return;
    if(!jaByCn[c.collector_number]) jaByCn[c.collector_number] = p;
    if(!jaByName[c.name]) jaByName[c.name] = p;
    if(!jaByName[front(c.name)]) jaByName[front(c.name)] = p;
  });
  const names = {}, images = {}, imagesEn = {};
  const put = (key, p) => { if(key && p && !names[key]) names[key] = p; };
  const imgOf = c => (c.image_uris && c.image_uris.normal) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal) || "";
  const jaImgByCn = {};
  ja.forEach(c => { const u = imgOf(c); if(u && !jaImgByCn[c.collector_number]) jaImgByCn[c.collector_number] = u; });
  en.forEach(c => {
    const p = jaByCn[c.collector_number] || jaByName[c.name] || jaByName[front(c.name)];
    put(c.name, p); put(front(c.name), p);
    // 画像は日本語版と英語版を別々に持つ（投稿の言語に合わせて使い分ける）。通常版（最初に出てくる版）を優先
    const ue = imgOf(c), uj = jaImgByCn[c.collector_number] || ue;
    for(const key of [c.name, front(c.name)]){
      if(uj && !images[key]) images[key] = uj;
      if(ue && !imagesEn[key]) imagesEn[key] = ue;
    }
  });
  Object.keys(jaByName).forEach(n => put(n, jaByName[n]));
  return { names, images, imagesEn };
}

/* data/names/<SET>.json の形式の版。中身を増やしたら必ず上げる。
   上げ忘れても取り直せるよう、下の hasAll でも足りない項目を見ている。 */
const NAMES_V = 5;
const filled = o => !!o && Object.keys(o).length > 0;

async function ensureNames(code){
  const path = `data/names/${code}.json`;
  let cur = await readJson(path, null) || { names: {}, set: "", released_at: "" };
  let changed = false;
  if(!cur.set || cur.set === code){
    try{ const r = await fetch(`https://api.scryfall.com/sets/${code.toLowerCase()}`, { headers: SCRY_HEADERS }); if(r.ok){ const j = await r.json(); cur.set = j.name; cur.released_at = j.released_at; changed = true; } }catch(e){}
  }
  // 版が古い、名前が無い、英語版の画像が無い（英語投稿に日本語のカードが出る）のいずれかなら取り直す
  const hasAll = filled(cur.names) && filled(cur.images) && filled(cur.imagesEn);
  if(cur.v !== NAMES_V || !hasAll){
    const { names, images, imagesEn } = await fetchJaNames(code);
    // 取れたものだけ入れ替える。取れなかった分は、前の中身を残す
    if(filled(names)){ cur.names = names; changed = true; }
    if(filled(images)){ cur.images = images; changed = true; }
    if(filled(imagesEn)){ cur.imagesEn = imagesEn; changed = true; }
    if(changed) cur.v = NAMES_V;
  }
  if(changed){ try{ await (await import("node:fs/promises")).mkdir("data/names", { recursive: true }); await writeFile(path, JSON.stringify(cur), "utf8"); }catch(e){} }
  console.log(`${code}: 日本語名 ${Object.keys(cur.names || {}).length}件 / カード画像 日本語 ${Object.keys(cur.images || {}).length}件・英語 ${Object.keys(cur.imagesEn || {}).length}件 / セット名 ${cur.set || "(不明)"}`);
  return cur;
}

/* 中身のある方を選ぶ。空のオブジェクトも「無い」とみなす（|| では拾えないため） */
const pickMap = (...maps) => maps.find(filled) || {};

async function setContext(code){
  const ja = await setNamesJa();
  const names = await ensureNames(code);
  const draft = await loadArticle(code, "draft");       // 公開データの記事。無ければ 17Lands の毎日の集計の記事
  const sealed = await loadArticle(code, "sealed");
  return {
    code,
    name: { ja: ja[code.toLowerCase()] || names.set || code, en: names.set || code },
    cardJa: names.names || {},
    // 投稿の言語に合う画像を使う。片方しか無いときだけ、もう片方で代用する
    cardImg: { ja: pickMap(names.images, names.imagesEn), en: pickMap(names.imagesEn, names.images) },
    draft, sealed,
    url: lang => `${SITE}/sets/${code}${lang === "en" ? ".en" : ""}.html`
  };
}

/* ---------- 文字数（X の数え方）と、上限に収める処理は x-text.mjs（X のおすすめ投稿文と共通） ---------- */
const short = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;

/* ---------- 投稿文 ---------- */
const COLOR = { ja: {W:"白",U:"青",B:"黒",R:"赤",G:"緑"}, en: {W:"W",U:"U",B:"B",R:"R",G:"G"} };
const TAGS = { ja: "#MTGアリーナ #MTGA", en: "#MTGArena #MTGLimited" };

function topBy(d, rarity, n){ return ((d.top || {})[rarity] || []).slice(0, n); }
function cardName(ctx, lang, name){ return lang === "ja" ? (ctx.cardJa[name] || name) : name; }
/* 日本語名があれば14字、無ければ英語名なので30字まで許す */
function cardLabel(ctx, lang, name){
  const n = cardName(ctx, lang, name);
  return short(n, lang === "ja" && ctx.cardJa[name] ? 14 : 30);
}

function weeklyPost(ctx, lang, theme, track){
  const d = ctx.draft; if(!d) return null;
  let picCards = [];
  const nm = ctx.name[lang], url = ctx.url(lang) + `?from=${track}`;
  const L = lang === "ja";
  let lines = [];
  if(theme === 0 || theme === 1){
    const rar = theme === 0 ? "common" : "uncommon";
    const head = L ? `【${nm} ドラフト】今週の${theme === 0 ? "コモン" : "アンコモン"}勝率トップ5`
                   : `${nm} Draft — top 5 ${rar}s this week (GIH win rate)`;
    lines = [head, ""];
    picCards = topBy(d, rar, 5);
    topBy(d, rar, 5).forEach((c, i) => lines.push(`~${i + 1}. ${cardLabel(ctx, lang, c.name)} ${pct(c.gih)}`));
    lines.push("", L ? `~GIH勝率＝そのカードが手札か戦場にあった試合の勝率（${d.provisional ? "17Landsのデータ" : "17Lands公開データ"}を集計）` : `~GIH = games-in-hand win rate, from ${d.provisional ? "17Lands data" : "17Lands public data"}`);
  }else if(theme === 2){
    const rows = (d.archetypes || []).filter(a => a.games >= 2000 && a.colors.length === 2).sort((a, b) => b.wr - a.wr).slice(0, 5);
    const head = L ? `【${nm} ドラフト】勝率の高い色の組み合わせ` : `${nm} Draft — best colour pairs by win rate`;
    lines = [head, ""];
    rows.forEach((a, i) => lines.push(`~${i + 1}. ${a.colors.split("").map(k => COLOR[lang][k]).join(L ? "" : "")} ${pct(a.wr)}`));
    lines.push("", L ? "~2,000試合以上の組み合わせから。全体平均は" + pct(d.overall_win_rate) : "~Pairs with 2,000+ games. Format average " + pct(d.overall_win_rate));
  }else{
    // 環境の速さは試合ごとのデータから作る。17Lands の毎日の集計で作った記事には無いので、その週は色の組み合わせにする
    if(!(d.speed || []).some(s => s.wr != null)) return weeklyPost(ctx, lang, 2, track);
    const best = (d.speed || []).filter(s => s.wr != null).sort((a, b) => b.wr - a.wr)[0];
    const label = { fast: L ? "速い（平均マナ総量2.9未満）" : "fast (avg. MV under 2.9)", mid: L ? "中速（3.2未満）" : "midrange (under 3.2)", slow: L ? "遅い（3.5未満）" : "slow (under 3.5)", slower: L ? "かなり遅い（3.5以上）" : "very slow (3.5+)" }[best?.key] || "";
    const head = L ? `【${nm} ドラフト】環境の速さ` : `${nm} Draft — format speed`;
    lines = [head, ""];
    if(best) lines.push(L ? `最も勝率の高いデッキは${label}で ${pct(best.wr)}` : `Best-performing decks are ${label} at ${pct(best.wr)}`);
    const rares = topBy(d, "rare", 10).concat(topBy(d, "mythic", 10)).sort((a, b) => b.gih - a.gih).slice(0, 3);
    picCards = rares;
    if(rares.length){ lines.push("", L ? "~レア・神話レアの勝率上位" : "~Top rares & mythics by win rate"); rares.forEach(c => lines.push(`~・${cardLabel(ctx, lang, c.name)} ${pct(c.gih)}`)); }
  }
  lines.push("", url, TAGS[lang]);
  return { text: fit(lines, track), cards: picCards };
}

function monthlyPost(ctx, lang, track){
  const nm = ctx.name[lang], url = ctx.url(lang) + `?from=${track}`;
  const L = lang === "ja";
  const games = (ctx.draft?.total_games || 0) + (ctx.sealed?.total_games || 0);
  const lines = [
    L ? `【データ更新】${nm} の勝率データを更新しました` : `Data update: ${nm} win rates refreshed`,
    "",
    L ? `ドラフト・シールドあわせて ${games.toLocaleString()}試合分（17Lands公開データ）。カード勝率一覧と環境レポート、ドラフトのデッキ構築補助に反映済みです。`
      : `${games.toLocaleString()} games across Draft and Sealed (17Lands public data). Card win rates, set reports and the draft assistant are all updated.`,
    "", url, TAGS[lang]
  ];
  return { text: fit(lines, track), cards: [] };
}

function announcePost(ctx, lang, track){
  const nm = ctx.name[lang], url = ctx.url(lang) + `?from=${track}`;
  const L = lang === "ja";
  const d = ctx.draft || ctx.sealed;
  const games = (ctx.draft?.total_games || 0) + (ctx.sealed?.total_games || 0);
  const top = d ? topBy(d, "rare", 10).concat(topBy(d, "mythic", 10)).sort((a, b) => b.gih - a.gih).slice(0, 3) : [];
  const lines = [
    L ? `【${nm}】リミテッドの勝率データを公開しました` : `${nm} Limited data is live`,
    "",
    L ? `${games.toLocaleString()}試合分の実戦データから、カード勝率・環境レポート・ドラフトのデッキ構築補助が使えます。` : `Card win rates, a format report and the draft deck assistant, built from ${games.toLocaleString()} games.`,
    ""
  ];
  if(top.length){ lines.push(L ? "~いまのレア・神話レアの上位：" : "~Top rares & mythics so far:"); top.forEach(c => lines.push(`~・${cardLabel(ctx, lang, c.name)} ${pct(c.gih)}`)); lines.push(""); }
  lines.push(url, TAGS[lang]);
  return { text: fit(lines, track), cards: top };
}

/* 動画を公開したときの案内。VIDEO_ID と VIDEO_LANG は環境変数で受け取る */
function videoPost(ctx, lang, track, withVideo = !!VIDEO_FILE){
  const id = process.env.VIDEO_ID; if(!id) return null;
  const vmode = ["sealed", "early", "trend"].includes(process.env.VIDEO_MODE) ? process.env.VIDEO_MODE : "draft";
  const nm = ctx.name[lang];
  const L = lang === "ja";
  if(vmode === "trend"){
    // 修正版：1週目 → 直近で、いちばん上がったカードと、いちばん伸びた組み合わせ（data/trends/<SET>_draft.json）
    let t = null; try{ t = JSON.parse(readFileSync(`data/trends/${ctx.code}_draft.json`, "utf8")); }catch(e){}
    const up = t && (t.risers || [])[0];
    const rise = t && (t.pairs || []).slice().sort((a, b) => b.delta - a.delta)[0];
    const CN = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
    const pairLabel = p => L ? [...p].map(k => COLOR.ja[k]).join("") : [...p].map(k => CN[k]).join("-");
    const sg = v => `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(1)}`;
    const url = ctx.url(lang) + `?from=${track}`;
    const lines = [
      L ? `【${nm}】ドラフト環境の変化を1分で${withVideo ? "" : "（動画）"}` : `${nm} Draft: what changed since week 1${withVideo ? "" : " (video)"}`,
      "",
      L ? `発売1週目と直近の1週間を比べて、勝率が上がったカード・下がったカードと、2色の組み合わせの変化をまとめました。` : `Week one vs the latest week: the cards that rose and fell the most, and how the colour pairs moved.`,
      up ? (L ? `~いちばん上がったカード：${cardLabel(ctx, lang, up.name)}（${sg(up.delta)}pt）` : `~Biggest riser: ${cardLabel(ctx, lang, up.name)} (${sg(up.delta)}pt)`) : null,
      rise ? (L ? `~いちばん伸びた組み合わせ：${pairLabel(rise.colors)}（${sg(rise.delta)}pt）` : `~Most improved pair: ${pairLabel(rise.colors)} (${sg(rise.delta)}pt)`) : null,
      "",
      withVideo ? null : `https://www.youtube.com/shorts/${id}`,
      L ? `全カードの勝率はこちら ${url}` : `Every card's win rate: ${url}`,
      TAGS[lang]
    ].filter(x => x !== null);
    const reply = withVideo ? (L ? `YouTube でも見られます → https://www.youtube.com/shorts/${id}` : `Also on YouTube → https://www.youtube.com/shorts/${id}`) : null;
    return { text: fit(lines, track), cards: [], reply };
  }
  if(vmode === "early"){
    // 先行版：サイトにはまだ載っていない（発売12日目から）ので、サイトのトップに誘導する
    const lines = [
      L ? `【${nm}】速報！発売直後のリミテッド環境を1分で${withVideo ? "" : "（動画）"}` : `${nm} Limited: early look in 60 seconds${withVideo ? "" : " (video)"}`,
      "",
      L ? `17Lands の発売直後のデータ（ドラフト＋シールド）から、強い色・2色の組み合わせ・コモン／アンコモンのトップを速報でまとめました。全カードの勝率は、アリーナ配信の12日目からサイトで見られます。` : `Strongest colours, best pairs and top commons/uncommons from the first days of 17Lands data. Every card's win rate goes up on the site on day 12 after the Arena release.`,
      "",
      withVideo ? null : `https://www.youtube.com/shorts/${id}`,
      L ? `シールド／ドラフトの構築練習 ${SITE}/?from=${track}` : `Sealed / Draft practice: ${SITE}/?from=${track}`,
      TAGS[lang]
    ].filter(x => x !== null);
    const reply = withVideo ? (L ? `YouTube でも見られます → https://www.youtube.com/shorts/${id}` : `Also on YouTube → https://www.youtube.com/shorts/${id}`) : null;
    return { text: fit(lines, track), cards: [], reply };
  }
  const url = ctx.url(lang) + `?from=${track}`;
  const d = ctx[vmode] || ctx.draft || ctx.sealed;
  const games = d ? (d.total_games || 0) : 0;
  const best = d && d.colors && d.colors.length ? d.colors[0] : null;
  const modeName = L ? (vmode === "sealed" ? "シールド" : "ドラフト") : (vmode === "sealed" ? "Sealed" : "Draft");
  const lines = [
    L ? `【${nm}】1分でわかる${modeName}環境${withVideo ? "" : "（動画）"}` : `${nm} ${modeName} in 60 seconds${withVideo ? "" : " (video)"}`,
    "",
    L ? `${modeName}${games.toLocaleString()}試合の実戦データから、環境の速さ・強い色・コモン／アンコモンのトップ3を1分にまとめました。` : `Format speed, the strongest colours and the top commons and uncommons, from ${games.toLocaleString()} ${modeName} games, in one minute.`,
    best ? (L ? `~いちばん勝っている色は${COLOR.ja[best.color] || best.color}（${pct(best.wr)}）。` : `~Best colour so far: ${({W:"White",U:"Blue",B:"Black",R:"Red",G:"Green"})[best.color] || best.color} (${pct(best.wr)}).`) : null,
    "",
    withVideo ? null : `https://www.youtube.com/shorts/${id}`,   // 動画そのものを添付するときは YouTube は返信に付ける
    L ? `全カードの勝率はこちら ${url}` : `Every card's win rate: ${url}`,   // サイトへの導線は落とさない（長いときは上の「色」の行から落ちる）
    TAGS[lang]
  ].filter(x => x !== null);
  const reply = withVideo ? (L ? `YouTube でも見られます → https://www.youtube.com/shorts/${id}` : `Also on YouTube → https://www.youtube.com/shorts/${id}`) : null;
  return { text: fit(lines, track), cards: [], reply };
}
/* 長尺（環境まとめ）が公開になったときの案内。v は data/long.json の <SET>.<lang> */
function longPost(ctx, lang, v, track){
  const nm = ctx.name[lang], L = lang === "ja", d = ctx.draft;
  const url = ctx.url(lang) + `?from=${track}`;
  const pairs = d ? (d.archetypes || []).filter(a => a.colors && a.colors.length === 2) : [];
  const total = pairs.reduce((n, a) => n + a.games, 0);
  const best = pairs.filter(a => a.games >= Math.max(1000, total * 0.01)).sort((a, b) => b.wr - a.wr)[0];
  const bomb = d ? topBy(d, "rare", 10).concat(topBy(d, "mythic", 10)).sort((a, b) => b.gih - a.gih)[0] : null;
  const CN = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
  const lines = [
    L ? `【${nm}】リミテッド環境まとめ動画を公開しました` : `${nm} Limited review is out`,
    "",
    L ? "~強い色・狙い目の色・ボム10枚・罠なレアまで、17Landsの実戦データで解説しました。" : "~Best colours, sleeper pairs, the top 10 bombs and trap rares, all from 17Lands data.",
    best ? (L ? `最強の組み合わせ：${best.colors.split("").map(k => COLOR.ja[k]).join("")}（${pct(best.wr)}）` : `Best pair: ${best.colors.split("").map(k => CN[k]).join("-")} (${pct(best.wr)})`) : null,
    bomb ? (L ? `ボム1位：${cardLabel(ctx, lang, bomb.name)}（${pct(bomb.gih)}）` : `Top bomb: ${cardLabel(ctx, lang, bomb.name)} (${pct(bomb.gih)})`) : null,
    "",
    `https://youtu.be/${v.id}`,
    L ? `全カードの勝率 ${url}` : `Every card's win rate: ${url}`,
    TAGS[lang]
  ].filter(x => x !== null);
  return { text: fit(lines, track), cards: [] };
}

/* 動画ファイル（VIDEO_FILE）。あれば X・Bluesky に動画そのものを添付する */
const VIDEO_FILE = process.env.VIDEO_FILE && existsSync(process.env.VIDEO_FILE) ? process.env.VIDEO_FILE : null;

/* ---------- 画像：上位3枚のカードを横に並べる ---------- */
async function composeImage(ctx, cards, lang){
  const bank = ctx.cardImg[lang] || ctx.cardImg.en || {};
  const urls = cards.map(c => bank[c.name] || bank[String(c.name).split(" // ")[0]]).filter(Boolean).slice(0, 5);
  if(!urls.length) return null;
  let sharp;
  try{ sharp = (await import("sharp")).default; }catch(e){ console.log("画像: sharp が無いので添付しません"); return null; }
  const W = 1600, pad = 24, maxH = 900;
  const n = urls.length;
  // 枚数に応じてカードの大きさを決め、画像の高さはカードに合わせる（余白が広くならないように）
  const cardW = Math.min(Math.round((maxH - pad * 2) * 488 / 680), Math.floor((W - pad * (n + 1)) / n));
  const cardH = Math.round(cardW * 680 / 488);
  const H = cardH + pad * 2;
  const gap = Math.round((W - cardW * n) / (n + 1));
  const top = pad;
  const layers = [];
  for(let i = 0; i < urls.length; i++){
    try{
      const r = await fetch(urls[i], { headers: SCRY_HEADERS });
      if(!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const img = await sharp(buf).resize(cardW, cardH, { fit: "cover" }).png().toBuffer();
      layers.push({ input: img, left: gap + i * (cardW + gap), top });
    }catch(e){}
    await sleep(120);
  }
  if(!layers.length) return null;
  return sharp({ create: { width: W, height: H, channels: 3, background: "#10304F" } })
    .composite(layers).jpeg({ quality: 88 }).toBuffer();
}

/* ---------- X ---------- */
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method, url, query = {}){
  const K = process.env.X_API_KEY, S = process.env.X_API_SECRET, T = process.env.X_ACCESS_TOKEN, TS = process.env.X_ACCESS_SECRET;
  const p = { oauth_consumer_key: K, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
              oauth_timestamp: Math.floor(Date.now() / 1000).toString(), oauth_token: T, oauth_version: "1.0" };
  const all = { ...p, ...query };   // クエリ（?command=STATUS など）も署名に入れる
  const norm = Object.keys(all).sort().map(k => `${enc(k)}=${enc(all[k])}`).join("&");
  const base = [method, enc(url), enc(norm)].join("&");
  p.oauth_signature = crypto.createHmac("sha1", `${enc(S)}&${enc(TS)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(p).sort().map(k => `${enc(k)}="${enc(p[k])}"`).join(", ");
}
/* 画像を X にアップロードして media_id を得る。v2 で失敗したら v1.1 も試す。失敗しても投稿は続ける */
async function uploadXImage(buf){
  const tryUpload = async (url, field) => {
    const form = new FormData();
    form.append(field, new Blob([buf], { type: "image/jpeg" }), "cards.jpg");
    form.append("media_category", "tweet_image");
    const r = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url) }, body: form });
    const body = await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
    const j = JSON.parse(body);
    return j.data?.id || j.media_id_string || null;
  };
  try{ return await tryUpload("https://api.x.com/2/media/upload", "media"); }
  catch(e){ console.log("X 画像(v2): " + e.message); }
  try{ return await tryUpload("https://upload.twitter.com/1.1/media/upload.json", "media"); }
  catch(e){ console.log("X 画像(v1.1): " + e.message); }
  return null;
}
/* 動画を X にアップロードして media_id を得る（分割アップロード → 処理待ち）。失敗したら null */
async function uploadXVideo(file){
  const buf = await readFile(file);
  const CHUNK = 4 * 1024 * 1024;
  const post = async (url, form, query) => {
    const r = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url, query) }, body: form });
    const body = await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
    return body ? JSON.parse(body) : {};
  };
  const idOf = j => j.data?.id || j.media_id_string || j.id || null;
  const info = j => j.data?.processing_info || j.processing_info || null;
  // 2通りの v2 の形を順に試す（X 側の仕様変更に備えて）
  const variants = [
    { name: "v2 path", init: async () => {
        const url = "https://api.x.com/2/media/upload/initialize";
        const r = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" },
          body: JSON.stringify({ media_type: "video/mp4", total_bytes: buf.length, media_category: "tweet_video" }) });
        const body = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`); return idOf(JSON.parse(body)); },
      append: async (id, i, part) => { const f = new FormData(); f.append("media", new Blob([part], { type: "application/octet-stream" }), "part"); f.append("segment_index", String(i)); return post(`https://api.x.com/2/media/upload/${id}/append`, f); },
      finalize: async id => post(`https://api.x.com/2/media/upload/${id}/finalize`, new FormData()),
      status: async id => { const url = "https://api.x.com/2/media/upload"; const q = { command: "STATUS", media_id: String(id) };
        const r = await fetch(`${url}?command=STATUS&media_id=${id}`, { headers: { Authorization: oauthHeader("GET", url, q) } }); const body = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`); return JSON.parse(body); } },
    { name: "v2 command", init: async () => { const f = new FormData(); f.append("command", "INIT"); f.append("media_type", "video/mp4"); f.append("total_bytes", String(buf.length)); f.append("media_category", "tweet_video"); return idOf(await post("https://api.x.com/2/media/upload", f)); },
      append: async (id, i, part) => { const f = new FormData(); f.append("command", "APPEND"); f.append("media_id", String(id)); f.append("segment_index", String(i)); f.append("media", new Blob([part], { type: "application/octet-stream" }), "part"); return post("https://api.x.com/2/media/upload", f); },
      finalize: async id => { const f = new FormData(); f.append("command", "FINALIZE"); f.append("media_id", String(id)); return post("https://api.x.com/2/media/upload", f); },
      status: async id => { const url = "https://api.x.com/2/media/upload"; const q = { command: "STATUS", media_id: String(id) };
        const r = await fetch(`${url}?command=STATUS&media_id=${id}`, { headers: { Authorization: oauthHeader("GET", url, q) } }); const body = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`); return JSON.parse(body); } }
  ];
  for(const v of variants){
    try{
      const id = await v.init();
      if(!id) throw new Error("media_id が返ってきません");
      for(let i = 0, off = 0; off < buf.length; i++, off += CHUNK) await v.append(id, i, buf.subarray(off, Math.min(buf.length, off + CHUNK)));
      let st = info(await v.finalize(id));
      // 処理待ち（最大 2分）
      for(let n = 0; st && st.state && !["succeeded", "failed"].includes(st.state) && n < 24; n++){
        await new Promise(r => setTimeout(r, Math.min(10, st.check_after_secs || 3) * 1000));
        st = info(await v.status(id));
      }
      if(st && st.state === "failed") throw new Error("X 側の処理に失敗: " + JSON.stringify(st.error || st).slice(0, 200));
      console.log(`X 動画: アップロードしました（${v.name}、${Math.round(buf.length / 1024 / 1024)}MB）`);
      return String(id);
    }catch(e){ console.log(`X 動画(${v.name}): ${e.message}`); }
  }
  return null;
}
async function postX(text, image, opts = {}){
  if(!process.env.X_API_KEY || !process.env.X_ACCESS_TOKEN) return "X: 鍵が無いので飛ばしました";
  const url = "https://api.x.com/2/tweets";
  const payload = { text };
  let attached = false;
  if(opts.video){
    const id = await uploadXVideo(opts.video);
    if(id){ payload.media = { media_ids: [id] }; attached = true; } else console.log("X: 動画は添付できなかったので、リンクで投稿します");
  }
  if(!attached && opts.video && opts.fallbackText) payload.text = opts.fallbackText;
  if(image && !attached){
    const id = await uploadXImage(image);
    if(id) payload.media = { media_ids: [String(id)] }; else console.log("X: 画像は添付せずに投稿します");
  }
  const r = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await r.text();
  if(!r.ok) throw new Error(`X HTTP ${r.status}: ${body}`);
  const id = JSON.parse(body)?.data?.id;
  // 動画を添付したときは、YouTube のリンクを返信に付ける
  if(attached && opts.reply && id){
    try{
      const r2 = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" }, body: JSON.stringify({ text: opts.reply, reply: { in_reply_to_tweet_id: String(id) } }) });
      if(!r2.ok) console.log(`X: 返信は付けられませんでした（HTTP ${r2.status}）`);
    }catch(e){ console.log("X 返信: " + e.message); }
  }
  return `X: 投稿しました${id ? " (id " + id + ")" : ""}${attached ? "（動画つき）" : ""}`;
}

/* ---------- Bluesky ---------- */
function bskyFacets(text){
  // URL をリンクとして認識させる（バイト位置で指定する）
  const facets = [];
  const enc8 = new TextEncoder();
  const re = /https?:\/\/\S+/g; let m;
  while((m = re.exec(text))){
    const start = enc8.encode(text.slice(0, m.index)).length, end = start + enc8.encode(m[0]).length;
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  const tagRe = /(?:^|\s)(#[^\s#]+)/g;
  while((m = tagRe.exec(text))){
    const s = m.index + m[0].indexOf("#");
    const start = enc8.encode(text.slice(0, s)).length, end = start + enc8.encode(m[1]).length;
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1].slice(1) }] });
  }
  return facets;
}
/* 動画を Bluesky の動画サービスに上げて blob を得る。失敗したら null */
async function uploadBskyVideo(base, session, file){
  const buf = await readFile(file);
  // 自分の PDS の DID（did:web:<ホスト>）宛ての短命トークンをもらう
  const ep = (session.didDoc && (session.didDoc.service || []).find(x => x.id === "#atproto_pds") || {}).serviceEndpoint || "https://bsky.social";
  const aud = "did:web:" + new URL(ep).host;
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const a = await fetch(`${base}/com.atproto.server.getServiceAuth?aud=${encodeURIComponent(aud)}&lxm=com.atproto.repo.uploadBlob&exp=${exp}`, { headers: { Authorization: `Bearer ${session.accessJwt}` } });
  if(!a.ok) throw new Error(`getServiceAuth HTTP ${a.status}: ${(await a.text()).slice(0, 200)}`);
  const token = (await a.json()).token;
  const name = file.split("/").pop();
  const up = await fetch(`https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(session.did)}&name=${encodeURIComponent(name)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(buf.length) }, body: buf });
  const body = await up.text();
  let job; try{ job = JSON.parse(body); }catch(e){ throw new Error(`uploadVideo HTTP ${up.status}: ${body.slice(0, 200)}`); }
  if(job.jobStatus) job = job.jobStatus;
  if(!up.ok && !job.jobId && !job.blob) throw new Error(`uploadVideo HTTP ${up.status}: ${body.slice(0, 200)}`);
  // 処理待ち（最大 3分）
  for(let n = 0; !job.blob && n < 36; n++){
    if(job.state === "JOB_STATE_FAILED") throw new Error("Bluesky 側の処理に失敗: " + (job.error || ""));
    await new Promise(r => setTimeout(r, 5000));
    const st = await fetch(`https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(job.jobId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if(st.ok) job = (await st.json()).jobStatus || job;
  }
  if(!job.blob) throw new Error("処理が終わりません（時間切れ）");
  console.log(`Bluesky 動画: アップロードしました（${Math.round(buf.length / 1024 / 1024)}MB）`);
  return job.blob;
}
async function postBsky(text, image, opts = {}){
  const H = process.env.BSKY_HANDLE, P = process.env.BSKY_APP_PASSWORD;
  if(!H || !P) return "Bluesky: 鍵が無いので飛ばしました";
  const base = "https://bsky.social/xrpc";
  const s = await fetch(`${base}/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: H, password: P }) });
  if(!s.ok) throw new Error(`Bluesky login HTTP ${s.status}: ${await s.text()}`);
  const session = await s.json();
  const record = { $type: "app.bsky.feed.post", text, facets: bskyFacets(text), createdAt: new Date().toISOString(), langs: [/[\u3040-\u30FF\u4E00-\u9FFF]/.test(text) ? "ja" : "en"] };
  let attached = false;
  if(opts.video){
    try{
      const blob = await uploadBskyVideo(base, session, opts.video);
      record.embed = { $type: "app.bsky.embed.video", video: blob, aspectRatio: { width: 1080, height: 1920 } };
      attached = true;
    }catch(e){ console.log("Bluesky 動画: " + e.message + " → リンクで投稿します"); }
    if(!attached && opts.fallbackText){ record.text = opts.fallbackText; record.facets = bskyFacets(record.text); }
  }
  if(image && !attached){
    try{
      const up = await fetch(`${base}/com.atproto.repo.uploadBlob`, { method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${session.accessJwt}` }, body: image });
      if(up.ok){ const blob = (await up.json()).blob; record.embed = { $type: "app.bsky.embed.images", images: [{ image: blob, alt: "Top cards" }] }; }
      else console.log("Bluesky: 画像は添付せずに投稿します");
    }catch(e){ console.log("Bluesky 画像: " + e.message); }
  }
  const r = await fetch(`${base}/com.atproto.repo.createRecord`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }) });
  if(!r.ok) throw new Error(`Bluesky HTTP ${r.status}: ${await r.text()}`);
  const made = await r.json().catch(() => ({}));
  // 動画を添付したときは、YouTube のリンクを返信に付ける
  if(attached && opts.reply && made.uri && made.cid){
    try{
      const ref = { uri: made.uri, cid: made.cid };
      const rep = { $type: "app.bsky.feed.post", text: opts.reply, facets: bskyFacets(opts.reply), createdAt: new Date().toISOString(), langs: record.langs, reply: { root: ref, parent: ref } };
      const r2 = await fetch(`${base}/com.atproto.repo.createRecord`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
        body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record: rep }) });
      if(!r2.ok) console.log(`Bluesky: 返信は付けられませんでした（HTTP ${r2.status}）`);
    }catch(e){ console.log("Bluesky 返信: " + e.message); }
  }
  return `Bluesky: 投稿しました${attached ? "（動画つき）" : ""}`;
}

/* ---------- 本体 ---------- */
async function send(label, textX, textBsky, image, lang, extra = {}){
  let ok = true;   // 投稿した先がすべて成功したか（長尺の案内の記録に使う）
  console.log(`\n--- ${label} ---`);
  console.log(textX);
  console.log(`（X換算 ${xLength(textX)} 文字／画像 ${image ? Math.round(image.length / 1024) + "KB" : "なし"}／動画 ${extra.video ? extra.video : "なし"}）`);
  if(extra.reply) console.log(`返信: ${extra.reply}`);
  if(DRY){
    if(image){ await writeFile(`social-preview-${label.replace(/\s+/g, "-")}.jpg`, image); console.log("画像を social-preview-*.jpg に保存しました"); }
    console.log("DRY_RUN のため投稿しません"); return false;
  }
  for(const [name, fn, text] of [["X", postX, textX], ["Bluesky", postBsky, textBsky]]){
    // Bluesky は BSKY_LANGS にある言語だけ（test は両方に出す）
    if(name === "Bluesky" && lang && !BSKY_LANGS.includes(lang)){ console.log(`Bluesky: ${lang} は出さない設定（BSKY_LANGS=${BSKY_LANGS.join(",")}）`); continue; }
    if(name === "X" && process.env.SKIP_X === "1") continue;
    if(name === "X" && !X_ENABLED){ console.log(await saveManual(label, text, image, extra)); continue; }
    const o = { video: extra.video || null, reply: extra.reply || null, fallbackText: name === "X" ? extra.fallbackX : extra.fallbackBsky };
    try{ const msg = await fn(text, image, o); console.log(msg); if(/飛ばしました/.test(String(msg))) ok = false; }   // 鍵が無くて飛ばしたときは「投稿した」と数えない
    catch(e){ console.error(`${name}: 失敗 — ${e.message}`); process.exitCode = 1; ok = false; }
  }
  return ok;
}

async function main(){
  if(mode === "test"){
    const text = "テスト投稿です。自動投稿の動作確認をしています。";
    await send("test", text, text);
    return;
  }
  if(mode === "long") return announceLongs();
  const sets = (mode === "announce" || mode === "video") ? (process.env.ANNOUNCE_SETS || "").split(/\s+/).filter(Boolean) : [await latestSet()].filter(Boolean);
  if(!sets.length){ console.log("対象のセットがありません。"); return; }
  // 週次の話題：THEME で指定があればそれ、無ければ週ごとに順番に回す
  const THEMES = { commons: 0, uncommons: 1, pairs: 2, speed: 3 };
  const week = process.env.WEEK ? parseInt(process.env.WEEK, 10) : Math.floor(Date.now() / (7 * 86400000));
  const theme = process.env.THEME && THEMES[process.env.THEME] !== undefined ? THEMES[process.env.THEME] : week % 4;
  for(const code of sets){
    const ctx = await setContext(code);
    for(const lang of LANGS){
      let px, pb;
      if(mode === "weekly"){ px = weeklyPost(ctx, lang, theme, "x"); pb = weeklyPost(ctx, lang, theme, "bsky"); }
      else if(mode === "monthly"){ px = monthlyPost(ctx, lang, "x"); pb = monthlyPost(ctx, lang, "bsky"); }
      else if(mode === "video"){ px = videoPost(ctx, lang, "x"); pb = videoPost(ctx, lang, "bsky"); }
      else { px = announcePost(ctx, lang, "x"); pb = announcePost(ctx, lang, "bsky"); }
      if(!px){ console.log(`${code}/${lang}: データが無いので飛ばしました`); continue; }
      // 画像は投稿の言語に合わせる（日本語版・英語版のカード画像）。枚数は本文のリストと同じ
      const image = (px.cards || []).length ? await composeImage(ctx, px.cards, lang) : null;
      const extra = {};
      if(mode === "video" && VIDEO_FILE){
        extra.video = VIDEO_FILE; extra.reply = px.reply;
        // 添付に失敗したときは、YouTube のリンク入りの本文（今まで通り）に戻す
        extra.fallbackX = videoPost(ctx, lang, "x", false).text;
        extra.fallbackBsky = videoPost(ctx, lang, "bsky", false).text;
      }
      await send(`${mode} ${code} ${lang}`, px.text, pb.text, image, lang, extra);
    }
  }
}

/* 長尺の案内：data/long.json に載った（＝YouTube で公開になった）長尺のうち、まだ案内していないものを出す。
   はじめて動かしたとき（記録 data/social/long-posted.json が無いとき）は、過去の動画をまとめて流さないよう、
   いま載っているものを「案内済み」として記録するだけで、投稿はしない */
async function announceLongs(){
  const longs = await readJson("data/long.json", {});
  const logPath = "data/social/long-posted.json";
  const first = !existsSync(logPath);
  const posted = await readJson(logPath, {});
  let n = 0, seeded = 0;
  for(const [code, byLang] of Object.entries(longs)){
    for(const lang of LANGS){
      const v = byLang && byLang[lang];
      if(!v || !v.id || posted[v.id]) continue;
      if(first){ posted[v.id] = { set: code, lang, at: new Date().toISOString(), seeded: true }; seeded++; continue; }
      const ctx = await setContext(code);
      const px = longPost(ctx, lang, v, "x"), pb = longPost(ctx, lang, v, "bsky");
      if(await send(`long ${code} ${lang}`, px.text, pb.text, null, lang)){
        posted[v.id] = { set: code, lang, at: new Date().toISOString() }; n++;
      }
    }
  }
  if((n || seeded) && !DRY){
    const { mkdir } = await import("node:fs/promises");
    await mkdir("data/social", { recursive: true });
    await writeFile(logPath, JSON.stringify(posted, null, 2) + "\n", "utf8");
  }
  if(first) console.log(`長尺の案内: はじめての実行なので、いま載っている ${seeded} 本を「案内済み」として記録しました（投稿はしていません）`);
  else console.log(n ? `長尺の案内: ${n} 件` : "長尺の案内: 新しく案内する動画はありません");
}

main().catch(e => { console.error(e); process.exit(1); });
