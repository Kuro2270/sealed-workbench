#!/usr/bin/env node
/*
 * セットごとの固定ページを作る（検索エンジン向け）。
 *
 *   node maintenance/build-set-pages.mjs
 *
 * 出力:
 *   sets/<SET>.html      日本語（例: sets/HOB.html）
 *   sets/<SET>.en.html   英語
 *   sets/index.html      一覧（日本語）／ sets/index.en.html（英語）
 *   data/names/<SET>.json  カードの日本語名（Scryfall から一度だけ取得して保存）
 *
 * ・data/articles/<SET>_<mode>.json（環境レポートと同じデータ）から本文を組み立てる
 * ・環境レポートのページは1つのURLでセットを切り替える作りなので、検索エンジンには
 *   1ページにしか見えない。ここではセットごとに別のURLを用意して、
 *   「<セット名> ドラフト 勝率」のような検索に1セットずつ引っかかるようにする
 * ・中身は静的なHTMLで完結させ、JSに頼らない（クローラーがそのまま読める）
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

// Scryfall は送信元を名乗らないアクセスを拒否するので、必ずこのヘッダーを付ける
const SCRY_HEADERS = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" };

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const pretty = u => u.replace(/\/index\.html$/, "/").replace(/\.html$/, "");   // Cloudflare Pages は .html なしの形に転送するので、正規URL・サイトマップもその形にそろえる
const ARTICLES = "data/articles";
const NAMES = "data/names";
const OUT = "sets";
const SCRY = "https://api.scryfall.com";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJson(path, fallback){
  try{ return JSON.parse(await readFile(path, "utf8")); }catch(e){ return fallback; }
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const pct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";

/* ---------- 文言（日本語・英語） ---------- */
const L = {
  ja: {
    site: "MTGアリーナ リミテッド・ワークベンチ",
    title: (s, c) => `${s}（${c}）リミテッド カード点数ランキング・評価｜勝率で見る強いカード`,
    desc: (s, g, c) => `MTGアリーナ「${s}（${c}）」のリミテッド（ドラフト・シールド）で強いカードを、17Landsの実戦データ（${g}試合）の勝率で採点。コモン・アンコモン・レア別のカード点数ランキングに加えて、環境の速さ、強い色、勝率の高い2色の組み合わせも分かります。`,
    h1: s => `${s}｜リミテッド カード点数ランキングと環境レポート`,
    lead: "マジック：ザ・ギャザリング アリーナのドラフトとシールドについて、17Landsの公開データを集計した実戦の勝率です。カードの点数（評価）は、この勝率で見られます。",
    mode: { draft: "ドラフト", sealed: "シールド" },
    games: (n, d) => `総試合数 ${n}／全体勝率 ${d}`,
    built: d => `集計 ${d}`,
    speedH: "環境の速さ",
    speedBest: (lab, p) => `${lab}が最も勝率が高く、${p}です。`,
    speedn: { fast:"平均マナ総量2.9未満の速いデッキ", mid:"平均マナ総量3.2未満の中速デッキ", slow:"平均マナ総量3.5未満の遅いデッキ", slower:"平均マナ総量3.5以上の重いデッキ" },
    pace: { fast: (c, n) => `ゲームは平均${n}ターンで、直近${c}セットの中では短めです。`, same: (c, n) => `ゲームは平均${n}ターンで、直近${c}セットと同じくらいの長さです。`, slow: (c, n) => `ゲームは平均${n}ターンで、直近${c}セットの中では長めです。` },
    verdict: { fast: "速い環境です。低マナ域を厚くしたデッキが勝ちやすい傾向がはっきり出ています。", slow: "遅い環境です。重いカードを支えられるデッキが勝ちやすい傾向が出ています。",
               "lean-fast": "やや速い環境です。差は小さいものの、軽いデッキほど勝率が高い並びになっています。", "lean-slow": "やや遅い環境です。差は小さいものの、重いデッキほど勝率が高い並びになっています。",
               even: "速さによる有利不利がはっきりしない環境です。デッキの中身で決まる部分が大きそうです。" },
    colorsH: "色の強さ", colorsLead: "その色のカードをデッキに入れた試合の勝率です。",
    archeH: "色の組み合わせ", archeLead: "2色の組み合わせごとの勝率です。試合数の多い順に並べています。",
    curveH: "マナ総量ごとの勝率", curveLead: "そのマナ総量のカードが手札か戦場にあった試合の勝率です。",
    tipGih: "GIH勝率（Games In Hand）：そのカードが手札か戦場にあった試合の勝率です。カードの強さを見る基本の指標で、17Landsの公開データを集計しています。",
    cardsH: "カード点数ランキング（レアリティ別）", cardsLead: "カードの「点数」は、実際の勝率（GIH勝率：そのカードが手札か戦場にあった試合の勝率）で見ます。高いほど強いカードです。レアリティごとに高い順に並べています。",
    faqH: "リミテッドのカードの点数について",
    faq: [
      ["リミテッドのカードの点数（評価）とは？", "そのカードがどれだけ強いかを数字で表したものを、点数や評価と呼びます。人が付ける点数には好みが入りますが、このページでは実際の対戦結果の勝率で見ています。"],
      ["点数（GIH勝率）はどう読めばいいですか？", "そのセット全体の勝率より高いカードは、入れたデッキが勝ちやすかったカードです。ただし、試合数が少ないカードは数字がぶれやすく、強いデッキに入りやすいカードは高く出る傾向があります。色や相性とあわせて、目安として使ってください。"],
      ["点数はいつ更新されますか？", "毎週月曜日に、17Landsの最新データで更新します。"]
    ],
    rarity: { mythic:"神話レア", rare:"レア", uncommon:"アンコモン", common:"コモン" },
    col: { color:"色", pair:"色の組み合わせ", cmc:"マナ総量", wr:"勝率", score:"点数（GIH勝率）", games:"試合数", card:"カード", cards:"種類数" },
    colorName: { W:"白", U:"青", B:"黒", R:"赤", G:"緑" },
    longH: "リミテッド環境まとめ（長尺動画）", longLead: "ドラフトとシールドの両方のデータで、強い色・狙い目の色・ボム・罠・色別のおすすめカードまでまとめました。目次を押すと、その場面から再生します。",
    videoH: "1分でわかる環境（動画）", videoLead: "この環境の要点を1分のショート動画にまとめました。再生ボタンで YouTube の動画を読み込みます。", videoPlay: "再生", videoOpen: "YouTube で見る",
    links: "関連ページ",
    linkRatings: "このセットの全カードの勝率一覧",
    linkReports: "環境レポート（他のセットに切り替え）",
    linkSealed: "シールド構築の練習", linkDraft: "ドラフト構築の練習", linkAssist: "ドラフト補助（PC・Chrome/Edge）",
    linkIndex: "セット一覧",
    indexH1: "セット別のリミテッド カード点数ランキングと環境レポート",
    indexLead: "セットを選ぶと、そのセットのカード点数ランキングと、ドラフト・シールドの環境レポートが開きます。発売日の新しい順です。",
    source: "出典：17Lands Public Data（CC BY 4.0）を当サイトが集計。カード情報はScryfall。",
    none: "このセットのデータはまだありません。",
    nav: { start:"MTGとは", limited:"リミテッドとは", guide:"サイトの機能", sealed:"シールド練習", draft:"ドラフト練習", ratings:"カード勝率一覧", reports:"環境レポート", swiss:"スイスドロー", assist:"ドラフト補助", sassist:"シールド補助", table:"対戦卓", privacy:"プライバシー", goods:"日本のサプライ" },
    navgrp: { start:"はじめに", build:"練習する", assist:"MTGアリーナで使う", data:"データを見る", play:"対戦する", shop:"買う" },
    navsub: { start:"MTGの基本と、このサイトの使い方", build:"仮想パックで練習", assist:"実戦のログを読んで助ける・PC専用", data:"セットごとの強さ・速さを確認", play:"友達との対戦・大会の進行", shop:"日本で買えるMTG用品" },
    pc: "PC",
    foot: 'データの出典・権利表示、および当サイトの内容を引用する際のお願いは<a href="../privacy.html">プライバシーポリシー</a>にまとめています。<br><a href="../faq.html">よくある質問</a>・<a href="../contact.html">お問い合わせ</a><br><a href="../goods/index.html">日本の TCG サプライ（スリーブ・デッキケース）</a>',
    otherLang: "English", otherHref: c => `${c}.en.html`
  },
  en: {
    site: "MTG Arena Limited Workbench",
    title: (s, c) => `${s} (${c}) Limited card ratings — best cards ranked by win rate (MTG Arena)`,
    desc: (s, g, c) => `Which cards are best in ${s} (${c}) Limited on MTG Arena? Card ratings by win rate from ${g} games of 17Lands data, ranked by rarity — plus format speed, the strongest colours and the best two-colour pairs.`,
    h1: s => `${s} | Limited card ratings and format report`,
    lead: "Real win rates for Magic: The Gathering Arena Draft and Sealed, aggregated from 17Lands public data. Use them as card ratings: the higher the win rate, the stronger the card.",
    mode: { draft: "Draft", sealed: "Sealed" },
    games: (n, d) => `${n} games · overall win rate ${d}`,
    built: d => `Built ${d}`,
    speedH: "Format speed",
    speedBest: (lab, p) => `${lab} have the highest win rate, at ${p}.`,
    speedn: { fast:"Decks averaging under 2.9 mana value", mid:"Decks averaging under 3.2 mana value", slow:"Decks averaging under 3.5 mana value", slower:"Decks averaging 3.5 mana value or more" },
    pace: { fast: (c, n) => `Games last ${n} turns on average, on the short side of the last ${c} sets.`, same: (c, n) => `Games last ${n} turns on average, about the same as the last ${c} sets.`, slow: (c, n) => `Games last ${n} turns on average, on the long side of the last ${c} sets.` },
    verdict: { fast: "A fast format. Decks weighted toward cheap spells clearly win more.", slow: "A slow format. Decks that can support expensive cards win more.",
               "lean-fast": "Leans fast. The gap is small, but lighter decks win a little more at every step.", "lean-slow": "Leans slow. The gap is small, but heavier decks win a little more at every step.",
               even: "Speed does not decide much here. What goes in the deck matters more." },
    colorsH: "Colour strength", colorsLead: "Win rate of games where the deck included cards of that colour.",
    archeH: "Colour pairs", archeLead: "Win rate by two-colour pair, sorted by number of games.",
    curveH: "Win rate by mana value", curveLead: "Win rate of games where a card of that mana value was in hand or on the battlefield.",
    tipGih: "GIH win rate (Games In Hand): the win rate of games where this card was in hand or on the battlefield — the basic measure of card strength, aggregated from 17Lands public data.",
    cardsH: "Card ratings by rarity", cardsLead: "A card's rating is its real win rate (GIH win rate: games where the card was in hand or on the battlefield). Higher is stronger. Sorted from the top within each rarity.",
    faqH: "About Limited card ratings",
    faq: [
      ["What is a Limited card rating?", "A number that says how strong a card is. Ratings given by people include personal taste, so this page uses win rates from real games instead."],
      ["How should I read the GIH win rate?", "A card above the set's overall win rate was in decks that won more often. Cards with few games swing a lot, and cards that go into strong decks tend to look better than they are, so treat it as a guide and read it together with colours and synergy."],
      ["When are the ratings updated?", "Every Monday (Japan time), from the latest 17Lands data."]
    ],
    rarity: { mythic:"Mythic", rare:"Rare", uncommon:"Uncommon", common:"Common" },
    col: { color:"Colour", pair:"Pair", cmc:"Mana value", wr:"Win rate", score:"Rating (GIH WR)", games:"Games", card:"Card", cards:"Cards" },
    colorName: { W:"White", U:"Blue", B:"Black", R:"Red", G:"Green" },
    longH: "Format overview (long video)", longLead: "We covered the strongest colour pairs, sleeper pairs, the best bombs, trap rares and the top commons and uncommons for each colour, using both Draft and Sealed data. Press a chapter to jump to that part of the video.",
    videoH: "The format in 60 seconds (video)", videoLead: "The key points of this format in a one-minute Short. Pressing play loads the video from YouTube.", videoPlay: "Play", videoOpen: "Watch on YouTube",
    links: "Related pages",
    linkRatings: "All card win rates for this set",
    linkReports: "Set reports (switch sets)",
    linkSealed: "Sealed practice", linkDraft: "Draft practice", linkAssist: "Draft assistant (PC, Chrome/Edge)",
    linkIndex: "All sets",
    indexH1: "Limited card ratings and format reports by set",
    indexLead: "Pick a set to open its card ratings and its Draft and Sealed report. Newest first.",
    source: "Source: 17Lands Public Data (CC BY 4.0), aggregated by this site. Card data via Scryfall.",
    none: "No data for this set yet.",
    nav: { start:"What is MTG?", limited:"What is Limited?", guide:"Site features", sealed:"Sealed practice", draft:"Draft practice", ratings:"Card win rates", reports:"Set reports", swiss:"Swiss pairings", assist:"Draft assistant", sassist:"Sealed assistant", table:"Play table", privacy:"Privacy", goods:"Japanese supplies" },
    navgrp: { start:"Start", build:"Practice", assist:"Use with MTG Arena", data:"Data", play:"Play", shop:"Shop" },
    navsub: { start:"MTG basics & how to use this site", build:"Virtual packs", assist:"Reads your log in real play · PC only", data:"How strong and fast each set is", play:"Play friends or run a tournament", shop:"MTG supplies sold in Japan" },
    pc: "PC",
    foot: 'Data sources, legal notices and how to credit this site are all on the <a href="../privacy.html">privacy page</a>.<br><a href="../faq.html">FAQ</a> · <a href="../contact.html">Contact</a><br><a href="../goods/index.en.html">Japanese TCG supplies — sleeves and deck boxes you can only get in Japan</a>',
    otherLang: "日本語", otherHref: c => `${c}.html`
  }
};

/* ---------- セット名 ---------- */
async function setNamesJa(){
  // i18n.js の SET_JA をそのまま使う
  try{
    const src = await readFile("i18n.js", "utf8");
    const m = src.match(/const SET_JA = (\{[\s\S]*?\});/);
    if(m) return new Function("return " + m[1])();
  }catch(e){}
  return {};
}
async function setInfo(code, cache){
  // 英語名と発売日は Scryfall から。取れたら data/names に残す
  if(cache.set && cache.set !== code && cache.released_at) return cache;   // コードのまま保存されたものは取り直す
  try{
    const r = await fetch(`${SCRY}/sets/${code.toLowerCase()}`, { headers: SCRY_HEADERS });
    if(r.ok){ const j = await r.json(); return { set: j.name, released_at: j.released_at }; }
  }catch(e){}
  return { set: cache.set || code, released_at: cache.released_at || "" };
}

/* Scryfall の検索結果を全ページ集める */
async function scryAll(q){
  const out = [];
  let url = `${SCRY}/cards/search?q=${encodeURIComponent(q)}`;
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
  const jaOf = c => (c.card_faces && c.card_faces[0] && c.card_faces[0].printed_name) || front(c.printed_name);
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

/* カードの日本語名（セットごとに一度だけ取得して保存） */
async function cardNamesJa(code){
  const path = `${NAMES}/${code}.json`;
  const cached = await readJson(path, null);
  if(cached && cached.names && Object.keys(cached.names).length && cached.v === 4) return cached;   // 空や古い形式のものは取り直す
  const { names, images } = await fetchJaNames(code);
  const out = { v: 4, set: (cached && cached.set) || "", released_at: (cached && cached.released_at) || "", names, images, fetched_at: new Date().toISOString() };
  await mkdir(NAMES, { recursive: true });
  await writeFile(path, JSON.stringify(out), "utf8");
  return out;
}

/* ---------- 「日本のサプライ」の小さな枠（セット別ページの下に）---------- */
let GOODS = null;
try{ GOODS = JSON.parse(readFileSync("data/products/current.json", "utf8")); }catch(e){}
function goodsStrip(lang){
  if(!GOODS) return "";
  const rot = Object.values(GOODS.rotating || {}).flat(), fixed = GOODS.fixed || [];
  const items = [...fixed.slice(0, 1), ...rot.slice(0, 3)];
  if(!items.length) return "";
  const en = lang === "en";
  const T = en ? { h: "Japanese TCG supplies", lead: "Sleeves and deck boxes you can only get in Japan — ships worldwide via Buyee.", buy: "Buy via Buyee", more: "See all →", pr: "Contains affiliate links" }
               : { h: "日本の TCG サプライ", lead: "日本のプレイヤーが使っている定番と、今週のキャラクタースリーブ。", buy: "楽天市場で見る", more: "もっと見る →", pr: "PR" };
  const href = en ? "../goods/index.en.html" : "../goods/index.html";
  const li = items.map(it => {
    const name = en ? (it.labelEn || it.name) : (it.labelJa || it.name);
    const link = en ? ((it.links && it.links.buyee) || it.affiliateUrl) : ((it.links && it.links.rakuten) || it.affiliateUrl);
    const price = en ? `about $${Math.round(it.price * (GOODS.usdRate || 1 / 150))}` : "¥" + Number(it.price).toLocaleString("ja-JP");
    return `<li><a class="gi" href="${esc(it.affiliateUrl)}" target="_blank" rel="noopener sponsored"><img src="${esc(it.image)}" alt="" loading="lazy"></a><div class="gt"><p class="gn">${esc(name)}</p><p class="gp">${esc(price)}</p><a class="gb" href="${esc(link)}" target="_blank" rel="noopener sponsored">${esc(T.buy)}</a></div></li>`;
  }).join("");
  return `<section class="gstrip"><div class="gh"><h2>${esc(T.h)}</h2><span class="gpr">${esc(T.pr)}</span><a class="gmore" href="${href}">${esc(T.more)}</a></div><p class="glead">${esc(T.lead)}</p><ul>${li}</ul></section>`;
}
const GOODS_CSS = `
  .gstrip{margin:28px 0 0;padding:16px 0 0;border-top:1px solid var(--line)}
  .gstrip .gh{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 4px}.gstrip h2{font-size:15px;margin:0}.gstrip .gpr{font-size:10.5px;color:var(--muted);border:1px solid var(--line);border-radius:3px;padding:0 5px}
  .gstrip .gmore{margin-left:auto;font-size:12.5px}.gstrip .glead{font-size:12.5px;color:var(--muted);margin:0 0 10px}
  .gstrip ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
  .gstrip li{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;display:flex;gap:8px;align-items:flex-start}
  .gstrip .gi{flex:none;width:64px;height:64px;border-radius:6px;overflow:hidden;background:var(--paper-2)}.gstrip .gi img{width:100%;height:100%;object-fit:contain;display:block}
  .gstrip .gt{min-width:0}.gstrip .gn{font-size:12px;font-weight:700;line-height:1.35;margin:0 0 2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .gstrip .gp{font-size:12px;margin:0 0 5px}.gstrip .gb{display:inline-block;font-size:11.5px;padding:4px 9px;border-radius:999px;background:var(--pine);color:#fff;text-decoration:none}`;

/* ---------- HTML ---------- */
function shell(lang, code, head, body, ogImage){
  const T = L[lang];
  const other = T.otherHref(code);
  const self = lang === "ja" ? `${code}.html` : `${code}.en.html`;
  const og = ogImage || `${SITE}/ogp-${lang}.png`;
  // ナビはカテゴリごとにまとめる（本体のページと同じ並び）
  const HREF = { start: lang === "en" ? "../start/index.en.html" : "../start/index.html", limited: lang === "en" ? "../start/limited.en.html" : "../start/limited.html", guide:"../guide.html", sealed:"../", draft:"../draft.html", ratings:"../ratings.html", reports:"../reports.html", swiss:"../swiss.html", assist:"../assistant.html", sassist:"../sealed-assist.html", table:"../table.html",
                 goods: lang === "en" ? "../goods/index.en.html" : "../goods/index.html" };
  const PC = new Set(["assist", "sassist"]);   // ログを読む機能はスマホでは使えないので「PC」の札を付ける
  const navGroup = (label, keys) =>
    `<div class="ng"><span class="ngl">${esc(T.navgrp[label])}</span>` +
    (T.navsub[label] ? `<span class="ngs">${esc(T.navsub[label])}</span>` : "") +
    keys.map(k => `<a href="${HREF[k]}">${esc(T.nav[k])}${PC.has(k) ? `<b class="pcb">${esc(T.pc)}</b>` : ""}</a>`).join("") + `</div>`;
  const nav = [
    navGroup("start", ["start", "limited", "guide"]),
    navGroup("build", ["sealed", "draft"]),
    navGroup("assist", ["sassist", "assist"]),
    navGroup("data", ["reports"]),
    navGroup("play", ["table", "swiss"]),
    navGroup("shop", ["goods"])
  ].join("\n      ");
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<meta property="og:type" content="article">
<meta property="og:site_name" content="MTG Arena Limited Workbench">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:image" content="${og}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/mana/mana.min.css">
<script src="../analytics.js"></script>
<script src="/navmenu.js" defer></script>
<script src="/tip.js" defer></script>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#10304F">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Workbench">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script>if("serviceWorker"in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})</script>
<style>
  :root{--pine:#10304F;--pine-deep:#0A2038;--paper:#F5F8FC;--paper-2:#E8EEF6;--ink:#0D1B2A;--muted:#5C7185;--gold:#2F7DF6;--line:#D3DFEB;
        --w:#FAF4E2;--u:#7FB4D8;--b:#7A7480;--r:#DB8068;--g:#79A87F;--m:#C3A03B;--c:#9AA3A0;--radius:8px}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  html{overflow-y:scroll;scrollbar-gutter:stable}
  body{background:var(--paper);color:var(--ink);font-family:"Zen Kaku Gothic New",system-ui,sans-serif;font-size:15px;line-height:1.7}
  h1,h2,h3{font-family:"Bricolage Grotesque","Zen Kaku Gothic New",sans-serif;font-weight:800;letter-spacing:-.01em;line-height:1.2}
  header{background:linear-gradient(135deg,var(--pine-deep) 0%,var(--pine) 55%,#17466F 100%);color:var(--paper);padding:24px 24px 16px;border-bottom:3px solid var(--gold);box-shadow:0 10px 30px -18px rgba(8,26,48,.9)}
  .wrap{max-width:1180px;margin:0 auto}
  .brand{font-family:"Bricolage Grotesque","Zen Kaku Gothic New",sans-serif;font-size:17px;font-weight:700;letter-spacing:.04em;color:#9CC8FF;line-height:24px;margin:0 0 12px}
  .brand a{color:inherit;text-decoration:none}
  nav{margin:0 0 18px;display:flex;flex-wrap:wrap;gap:8px}
  nav a{display:inline-flex;align-items:center;padding:7px 13px;border-radius:999px;font-size:13px;font-weight:500;line-height:1;white-space:nowrap;color:#C6D9EE;text-decoration:none;background:rgba(255,255,255,.05);border:1px solid #2C4D74}
  nav a:hover{background:#1A4A79;color:var(--paper)}
  nav{gap:10px 16px;align-items:flex-end}
  .ng{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding-left:16px;border-left:1px solid rgba(255,255,255,.16)}
  .ng:first-of-type{padding-left:0;border-left:none}
  .ng{position:relative;padding-top:17px}
  .ng:has(.ngs){padding-top:35px}
  .ngl{position:absolute;left:16px;top:0;white-space:nowrap;font-size:10.5px;font-weight:700;letter-spacing:.1em;color:#8FA9C6}
  .ng:first-of-type .ngl,.ng:first-of-type .ngs{left:0}
  .ngs{position:absolute;left:16px;top:17px;white-space:nowrap;font-size:11px;color:#8FA9C6;line-height:1.3}
  nav a .pcb{display:inline-block;margin-left:6px;padding:0 5px;border-radius:6px;font-size:9.5px;font-weight:700;letter-spacing:.06em;line-height:16px;vertical-align:1px;background:rgba(255,255,255,.14);color:#CFE3FA}
  nav a.on .pcb{background:rgba(255,255,255,.28);color:#fff}
  @media (max-width:760px){ .ng{padding-left:0;border-left:none;width:100%} .ngl,.ngs{left:0} }
  /* ナビ: 見出し→補足→ボタンの順に縦に並べ、ボタンは文字と見分けやすい立体的な見た目にする */
  .ng{display:grid;grid-auto-flow:column;grid-template-rows:auto auto auto;column-gap:7px;row-gap:5px;justify-content:start;align-items:center;padding-top:0}
  .ng:has(.ngs){padding-top:0}
  .ngl,.ngs{position:static;grid-column:1/-1;white-space:nowrap}
  .ngl{grid-row:1;left:auto}
  .ngs{grid-row:2;left:auto;top:auto;font-size:11.5px;color:#A9BFD8;margin-top:-2px}
  nav a{grid-row:3;padding:8px 16px;border-radius:10px;font-weight:700;background:linear-gradient(180deg,#2A5F96,#1C4A7C);border:1px solid #4A83BF;color:#FFFFFF;box-shadow:0 2px 0 #12365C,0 4px 10px rgba(0,0,0,.28);-webkit-font-smoothing:auto;text-shadow:none;letter-spacing:.02em}
  nav a:not(.on):hover{background:linear-gradient(180deg,#3573B3,#25609F);border-color:#6FA3DA}
  nav a:active{box-shadow:0 1px 0 #12365C}
  nav a.on{box-shadow:0 2px 0 rgba(0,0,0,.35),0 4px 10px rgba(0,0,0,.28)}
  @media (max-width:760px){
    .ng{display:flex;flex-wrap:wrap;gap:6px;width:100%}
    .ngl,.ngs{flex:0 0 100%}
  }
  header h1{font-size:24px;margin:0}
  header p{margin:6px 0 0;color:#A9C2DE;font-size:13px;line-height:1.55;max-width:80ch;min-height:41px}
  .lang{margin-top:12px;font-size:13px}
  .lang a{color:#C6D9EE}
  main{max-width:900px;margin:0 auto;padding:22px 24px 70px}
  .mode{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;margin-bottom:22px}
  .mode > h2{font-size:22px;margin:0 0 4px;display:flex;align-items:baseline;gap:12px}
  .mode > h2 small{font-size:13px;color:var(--muted);font-weight:500}
  .built{color:var(--muted);font-size:12.5px;margin:0 0 6px}
  section{margin-top:18px}
  .video{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
  .longvideo{margin:0 0 26px;padding:16px;border:1px solid var(--line,#d9e2ee);border-radius:16px}
  .longvideo h2{margin:0 0 4px;font-size:18px}
  .longvideo .lead{margin:0 0 12px;font-size:13px;opacity:.8}
  .longvideo .lv{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
  .longvideo .yt{position:relative;flex:1 1 440px;min-width:0;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#0A2038}
  .longvideo .yt img{width:100%;height:100%;object-fit:cover;display:block}
  .longvideo .yt button{position:absolute;inset:0;width:100%;height:100%;border:0;background:rgba(10,32,56,.25);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .longvideo .yt button span{width:68px;height:68px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.35)}
  .longvideo .yt button span::after{content:"";border-left:23px solid #0B1E33;border-top:14px solid transparent;border-bottom:14px solid transparent;margin-left:6px}
  .longvideo .yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .longvideo .chap{flex:1 1 220px;min-width:0;margin:0;padding:0;list-style:none;font-size:14px}
  .longvideo .chap li{margin:0 0 2px}
  .longvideo .chap a{display:flex;gap:10px;padding:5px 8px;border-radius:8px;text-decoration:none;color:inherit}
  .longvideo .chap a:hover{background:rgba(47,125,246,.12)}
  .longvideo .chap time{flex:none;width:3.2em;color:#2F7DF6;font-variant-numeric:tabular-nums;font-weight:700}
  .video .yt{position:relative;width:min(270px,100%);aspect-ratio:9/16;border-radius:14px;overflow:hidden;background:#0A2038;flex:none}
  .video .yt img{width:100%;height:100%;object-fit:cover;display:block}
  .video .yt button{position:absolute;inset:0;width:100%;height:100%;border:0;background:rgba(10,32,56,.25);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .video .yt button span{width:64px;height:64px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.35)}
  .video .yt button span::after{content:"";border-left:22px solid #0B1E33;border-top:13px solid transparent;border-bottom:13px solid transparent;margin-left:5px}
  .video .yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .video .vtext{flex:1 1 240px;min-width:0}
  .video .vtext p{margin:0 0 8px}
  .video .vtext a{font-size:13px}
  section h3{font-size:16px;margin:0 0 4px}
  .lead{color:var(--muted);font-size:13px;margin:0 0 8px}
  .verdict{background:var(--paper-2);border-left:4px solid var(--pine);padding:10px 14px;font-size:14.5px}
  .verdict .gap{display:block;font-size:12.5px;color:var(--muted);margin-top:5px;font-weight:400}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{font-size:11.5px;color:var(--muted);font-weight:500;text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}
  td{padding:6px 8px;border-bottom:1px solid var(--paper-2)}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .dot{width:10px;height:10px;border-radius:50%;display:inline-block;box-shadow:inset 0 0 0 1px rgba(15,28,23,.22);margin-right:6px;vertical-align:-1px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
  .rar{font-size:11px;border-radius:2px;padding:1px 5px;font-weight:700;color:#fff;background:#2A3B4C;margin-right:6px}
  .rar.uncommon{background:#8496A0}.rar.rare{background:var(--gold);color:#FFFFFF}.rar.mythic{background:#C4552C}
  .links ul{margin:6px 0 0;padding-left:1.2em}
  .links a{color:var(--pine)}
  .source{color:var(--muted);font-size:12px;margin-top:20px}
  .setlist{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
  .setlist li a{display:block;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;text-decoration:none;color:var(--ink)}
  .setlist li a:hover{border-color:var(--gold)}
  .setlist small{display:block;color:var(--muted);font-size:12px}
  .brandrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .langsel{background:#0F2A44;color:var(--paper);border:1px solid #2E5A86;border-radius:8px;padding:6px 10px;font-family:inherit;font-size:13px}
  .summary{font-size:14.5px;line-height:1.8;margin:0 0 16px;padding:12px 16px;background:var(--paper-2);border-radius:8px}
  header h1 .code{font-size:14px;font-weight:600;color:#A9C2DE;margin-left:8px;letter-spacing:.06em}
  footer{max-width:900px;margin:0 auto;padding:0 24px 50px;color:var(--muted);font-size:11.5px;line-height:1.9}
${GOODS_CSS}
  footer a{color:var(--muted)}
  .faq details{border-bottom:1px solid var(--line,#D7E2EE);padding:10px 2px}
  .faq summary{cursor:pointer;font-weight:700;font-size:14.5px}
  .faq p{margin:8px 0 2px;font-size:14px;line-height:1.8}
  @media (max-width:720px){ header{padding:16px 14px 12px} main{padding:16px 12px 50px} header p{min-height:0} nav{gap:6px;font-size:12px} .mode{padding:14px 12px} }
</style>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4578393433821297" crossorigin="anonymous"></script>
</head>
<body>
<header>
  <div class="wrap">
    <div class="brandrow"><div class="brand"><a href="../">${esc(T.site)}</a></div>
      <select class="langsel" aria-label="Language" onchange="location.href=this.value">
        <option value="${esc(lang === "ja" ? self : other)}"${lang === "ja" ? " selected" : ""}>日本語</option>
        <option value="${esc(lang === "en" ? self : other)}"${lang === "en" ? " selected" : ""}>English</option>
      </select></div>
    <nav>
      ${nav}
    </nav>
${body.header}
    <link rel="alternate" hreflang="${lang === "ja" ? "en" : "ja"}" href="${other}">
  </div>
</header>
<main>
${body.main}
${body.noGoods ? "" : `<div id="goodsStrip"></div>
<script src="../goods-widget.js?v=6" defer></script>`}
</main>
<footer>${T.foot}</footer>
</body>
</html>
`;
}

/* 冒頭の要約。数字の表だけだと検索に拾われにくいので、データから3〜5文の文章を作る */
function summaryText(lang, mode, d, setDisplay, cn, pairLabel, colorLabel){
  const ja = lang === "ja";
  const modeName = ja ? (mode === "sealed" ? "シールド" : "ドラフト") : (mode === "sealed" ? "Sealed" : "Draft");
  const games = (d.total_games || 0).toLocaleString();
  const colors = (d.colors || []).slice().sort((a, b) => b.wr - a.wr);
  const pairsAll = (d.archetypes || []).filter(a => a.colors && a.colors.length === 2);
  const totalPair = pairsAll.reduce((n, p) => n + p.games, 0) || 1;
  const pairs = pairsAll.filter(p => p.games >= Math.max(2000, totalPair * 0.04)).sort((a, b) => b.wr - a.wr);
  const best = pairs[0], worst = pairs[pairs.length - 1];
  const speed = (d.speed || []).filter(x => x.wr != null);
  const fastest = speed.length ? speed.reduce((m, x) => x.wr > m.wr ? x : m) : null;
  const vk = (d.verdict && d.verdict.key) || "even";
  const paceWord = ja ? ({ fast: "速く、軽いデッキが勝ちやすい", "lean-fast": "やや速く、軽いデッキのほうが勝ちやすい", even: "速さでは差がつきにくい", "lean-slow": "やや遅く、重いデッキのほうが勝ちやすい", slow: "遅く、重いデッキが勝ちやすい" })[vk]
                      : ({ fast: "fast decks clearly win more", "lean-fast": "it leans fast — lighter decks win a little more", even: "speed makes little difference", "lean-slow": "it leans slow — heavier decks win a little more", slow: "slow, heavier decks clearly win more" })[vk];
  const top = r => ((d.top && d.top[r]) || [])[0];
  const c1 = top("common"), u1 = top("uncommon"), r1 = top("rare");
  const parts = [];
  if(ja){
    parts.push(`${setDisplay}の${modeName}は${games}試合のデータで、全体勝率は${pct(d.overall_win_rate)}。`);
    if(paceWord) parts.push(`環境は${paceWord}です。`);
    if(colors.length >= 2) parts.push(`色は${colorLabel(colors[0].color)}（${pct(colors[0].wr)}）と${colorLabel(colors[1].color)}（${pct(colors[1].wr)}）が強く、`);
    if(best) parts.push(`2色の組み合わせでは${pairLabel(best.colors)}が${pct(best.wr)}で最強${worst && worst !== best ? `、${pairLabel(worst.colors)}が${pct(worst.wr)}で最弱` : ""}です。`);
    const cards = [c1 && `コモンは「${cn(c1.name)}」`, u1 && `アンコモンは「${cn(u1.name)}」`, r1 && `レアは「${cn(r1.name)}」`].filter(Boolean);
    if(cards.length) parts.push(`カード単位では${cards.join("、")}が最も勝率が高いカードです。`);
  }else{
    parts.push(`${setDisplay} ${modeName} on MTG Arena: ${games} games, ${pct(d.overall_win_rate)} overall win rate.`);
    if(paceWord) parts.push(`On speed, ${paceWord}.`);
    if(colors.length >= 2) parts.push(`${colorLabel(colors[0].color)} (${pct(colors[0].wr)}) and ${colorLabel(colors[1].color)} (${pct(colors[1].wr)}) are the strongest colours;`);
    if(best) parts.push(`the best two-colour pair is ${pairLabel(best.colors)} at ${pct(best.wr)}${worst && worst !== best ? `, and the weakest is ${pairLabel(worst.colors)} at ${pct(worst.wr)}` : ""}.`);
    const cards = [c1 && `the top common is ${c1.name}`, u1 && `the top uncommon is ${u1.name}`, r1 && `the top rare is ${r1.name}`].filter(Boolean);
    if(cards.length) parts.push(`By card, ${cards.join(", ")} (game-in-hand win rate).`);
  }
  return parts.join(ja ? "" : " ").replace(/、$/, "。");
}

function modeSection(lang, code, mode, d, speedIndex, names, setDisplay, videos){
  const T = L[lang];
  const cn = n => (lang === "ja" && names[n]) ? names[n] : n;
  /* 色のマークは、色つきの丸ではなくマナシンボル（assets/mana/ の mana-font）で出す。1色は各色、2色以上は多色、無色は無色のシンボル */
  const manaOf = c => { const k = !c ? "C" : c.length > 1 ? "M" : c.toUpperCase(); return `<i class="ms ms-cost ${k === "M" ? "ms-multicolor mfi-m" : "ms-" + k.toLowerCase()} mfi" aria-hidden="true"></i>`; };
  const colorLabel = k => T.colorName[k] || k;
  const pairLabel = p => p.split("").map(colorLabel).join(lang === "ja" ? "" : "/");

  let out = `<article class="mode">
  <h2>${esc(T.mode[mode])} <small>${esc(T.games((d.total_games || 0).toLocaleString(), pct(d.overall_win_rate)))}</small></h2>
  <p class="built">${esc(T.built((d.data_generated_at || d.generated_at || "").slice(0, 10)))}</p>
  <p class="summary">${esc(summaryText(lang, mode, d, setDisplay, cn, pairLabel, colorLabel))}</p>
${videoSection(lang, code, mode, setDisplay, videos)}`;

  // 環境の速さ
  const best = (d.speed || []).filter(s => s.wr != null).sort((a, b) => b.wr - a.wr)[0];
  if(best){
    let paceTxt = "";
    const grp = speedIndex && speedIndex[mode];
    if(grp && grp.average != null){
      const mine = (grp.sets || []).find(x => x.set === code)?.avg_turns ?? d.avg_turns;
      if(mine != null){
        const diff = mine - grp.average;
        const key = Math.abs(diff) < 0.15 ? "same" : (diff < 0 ? "fast" : "slow");
        paceTxt = " " + T.pace[key](grp.count || (grp.sets || []).length, mine.toFixed(1));
      }
    }
    // 「環境の速さ」は勝っているデッキの重さ（verdict）で決める。ゲームの長さは「速い／遅い」と言わず、短め／長めの補足にする
    const vtxt = T.verdict[(d.verdict && d.verdict.key) || "even"];
    out += `
  <section><h3>${esc(T.speedH)}</h3>
    <div class="verdict"><b>${esc(vtxt)}</b><span class="gap">${esc(T.speedBest(T.speedn[best.key] || best.key, pct(best.wr)))}${esc(paceTxt)}</span></div>
  </section>`;
  }
  // 色の強さ
  if(d.colors && d.colors.length){
    out += `
  <section><h3>${esc(T.colorsH)}</h3><p class="lead">${esc(T.colorsLead)}</p>
    <table><thead><tr><th>${esc(T.col.color)}</th><th class="num">${esc(T.col.wr)}</th><th class="num">${esc(T.col.games)}</th></tr></thead><tbody>
    ${d.colors.slice().sort((a, b) => b.wr - a.wr).map(c => `<tr><td>${manaOf(c.color)}${esc(colorLabel(c.color))}</td><td class="num"><b>${pct(c.wr)}</b></td><td class="num">${(c.games || 0).toLocaleString()}</td></tr>`).join("\n    ")}
    </tbody></table>
  </section>`;
  }
  // 色の組み合わせ
  if(d.archetypes && d.archetypes.length){
    const rows = d.archetypes.filter(a => a.games >= 500).sort((a, b) => b.games - a.games).slice(0, 10);
    out += `
  <section><h3>${esc(T.archeH)}</h3><p class="lead">${esc(T.archeLead)}</p>
    <table><thead><tr><th>${esc(T.col.pair)}</th><th class="num">${esc(T.col.wr)}</th><th class="num">${esc(T.col.games)}</th></tr></thead><tbody>
    ${rows.map(a => `<tr><td>${esc(pairLabel(a.colors))}</td><td class="num"><b>${pct(a.wr)}</b></td><td class="num">${(a.games || 0).toLocaleString()}</td></tr>`).join("\n    ")}
    </tbody></table>
  </section>`;
  }
  // マナカーブ
  if(d.curve && d.curve.length){
    out += `
  <section><h3>${esc(T.curveH)}</h3><p class="lead">${esc(T.curveLead)}</p>
    <table><thead><tr><th>${esc(T.col.cmc)}</th><th class="num">${esc(T.col.wr)}</th><th class="num">${esc(T.col.cards)}</th><th class="num">${esc(T.col.games)}</th></tr></thead><tbody>
    ${d.curve.map(c => `<tr><td>${c.cmc}${c.cmc >= 7 ? "+" : ""}</td><td class="num"><b>${pct(c.wr)}</b></td><td class="num">${c.cards ?? ""}</td><td class="num">${(c.games || 0).toLocaleString()}</td></tr>`).join("\n    ")}
    </tbody></table>
  </section>`;
  }
  // レアリティ別
  if(d.top){
    const blocks = ["mythic","rare","uncommon","common"].filter(r => (d.top[r] || []).length).map(r => `
      <div><h3><span class="rar ${r}">${esc(T.rarity[r])}</span></h3>
      <table><thead><tr><th>${esc(T.col.card)}</th><th class="num"><span data-tip="${esc(T.tipGih)}" tabindex="0">${esc(T.col.score)}</span></th><th class="num">${esc(T.col.games)}</th></tr></thead><tbody>
      ${d.top[r].map(c => `<tr><td>${manaOf(c.color || "")}${esc(cn(c.name))}</td><td class="num"><b>${pct(c.gih)}</b></td><td class="num">${(c.games || 0).toLocaleString()}</td></tr>`).join("\n      ")}
      </tbody></table></div>`).join("");
    out += `
  <section><h3>${esc(T.cardsH)}</h3><p class="lead">${esc(T.cardsLead)}</p>
    <div class="grid">${blocks}
    </div>
  </section>`;
  }
  out += `
</article>`;
  return out;
}

function setPage(lang, code, setDisplay, info, arts, speedIndex, names, videos, long){
  const T = L[lang];
  const modes = ["draft","sealed"].filter(m => arts[m]);
  const totalGames = modes.reduce((a, m) => a + (arts[m].total_games || 0), 0).toLocaleString();
  const canonical = pretty(`${SITE}/${OUT}/${code}${lang === "en" ? ".en" : ""}.html`);
  const altJa = pretty(`${SITE}/${OUT}/${code}.html`), altEn = pretty(`${SITE}/${OUT}/${code}.en.html`);
  const title = T.title(setDisplay, code);
  const head = `<title>${esc(title)} — ${esc(T.site)}</title>
<meta name="description" content="${esc(T.desc(setDisplay, totalGames, code))}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${altJa}">
<link rel="alternate" hreflang="en" href="${altEn}">
<link rel="alternate" hreflang="x-default" href="${altJa}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(T.desc(setDisplay, totalGames, code))}">
<meta property="og:url" content="${canonical}">`;
  const header = `    <h1>${esc(T.h1(setDisplay))} <small class="code">${esc(code)}</small></h1>
    <p>${esc(T.lead)}${info.released_at ? `　${lang === "ja" ? "発売" : "Released"} ${esc(info.released_at)}` : ""}</p>`;
  const body = (modes.length ? longSection(lang, code, setDisplay, long) : "") + (modes.length
    ? modes.map(m => modeSection(lang, code, m, arts[m], speedIndex, names, setDisplay, videos)).join("\n")
    : `<p>${esc(T.none)}</p>`);
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", inLanguage: lang,
    mainEntity: T.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const faq = modes.length ? `<section class="faq"><h3>${esc(T.faqH)}</h3>
${T.faq.map(([q, a]) => `  <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
  <script type="application/ld+json">${JSON.stringify(faqLd)}</script>
</section>` : "";
  const links = `<section class="links"><h3>${esc(T.links)}</h3><ul>
  <li><a href="../reports.html?set=${code}">${esc(T.linkReports)}</a></li>
  <li><a href="../">${esc(T.linkSealed)}</a>／<a href="../draft.html">${esc(T.linkDraft)}</a>／<a href="../assistant.html">${esc(T.linkAssist)}</a></li>
  <li><a href="index${lang === "en" ? ".en" : ""}.html">${esc(T.linkIndex)}</a></li>
</ul></section>
<p class="source">${esc(T.source)}</p>`;
  return shell(lang, code, head, { header, main: body + "\n" + faq + "\n" + links }, `${SITE}/${OUT}/og/${code}-${lang}.png`);
}

/* 長尺の環境まとめ動画（横長・日本語／英語）。data/long.json に載せたものだけ出す。目次のリンクを押すと、その時刻から再生する */
function longSection(lang, code, setDisplay, long){
  const v = long && long[code] && long[code][lang];
  if(!v || !v.id) return "";
  const id = String(v.id), T = L[lang];
  const title = v.title || (lang === "en" ? `${setDisplay} Limited Review` : `${setDisplay} リミテッド環境まとめ`);
  const posterFile = `assets/video/${code}-${lang}-long.jpg`;
  const thumbSrc = existsSync(posterFile) ? `/${posterFile}` : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const thumb = existsSync(posterFile) ? `${SITE}/${posterFile}` : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const ts = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
  const chap = (v.chapters || []).map(c => `<li><a href="https://youtu.be/${esc(id)}?t=${Math.floor(c.at)}" data-t="${Math.floor(c.at)}" target="_blank" rel="noopener"><time>${ts(c.at)}</time><span>${esc(c.title)}</span></a></li>`).join("");
  const ld = { "@context": "https://schema.org", "@type": "VideoObject", name: title, description: T.longLead, thumbnailUrl: [thumb],
    uploadDate: v.uploadedAt || "", duration: v.duration || undefined, contentUrl: `https://www.youtube.com/watch?v=${id}`, embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, inLanguage: lang };
  return `<section class="longvideo"><h2>${esc(T.longH)}</h2><p class="lead">${esc(T.longLead)}</p>
  <div class="lv"><div class="yt" data-id="${esc(id)}">
    <img src="${thumbSrc}" alt="${esc(title)}" loading="lazy" width="640" height="360">
    <button type="button" aria-label="${esc(T.videoPlay)}"><span></span></button>
  </div>${chap ? `<ul class="chap">${chap}</ul>` : ""}</div>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  <script>(function(){var box=document.querySelector(".longvideo .yt");if(!box)return;function play(t){var f=document.createElement("iframe");f.src="https://www.youtube-nocookie.com/embed/"+box.dataset.id+"?autoplay=1&playsinline=1"+(t?"&start="+t:"");f.allow="autoplay; encrypted-media; picture-in-picture";f.allowFullscreen=true;f.title=${JSON.stringify(title)};box.innerHTML="";box.appendChild(f);}box.querySelector("button").addEventListener("click",function(){play(0);});document.querySelectorAll(".longvideo .chap a").forEach(function(a){a.addEventListener("click",function(e){e.preventDefault();play(+a.dataset.t);box.scrollIntoView({block:"nearest",behavior:"smooth"});});});})();</script>
</section>
`;
}

/* 環境まとめ動画（YouTube ショート）。押すまで YouTube を読み込まない軽い埋め込みと、検索向けの VideoObject */
function videoSection(lang, code, mode, setDisplay, videos){
  let v = videos && videos[code] && videos[code][lang];
  if(v && v.id) v = { draft: v };          // 昔の形（言語の直下に id）はドラフト
  v = v && v[mode];
  if(!v || !v.id || v.public === false) return "";
  const T = L[lang];
  const id = String(v.id);
  // 自前のサムネイル（冒頭のタイトル場面）があればそれを。無ければ YouTube の自動サムネイル
  const posterFile = `assets/video/${code}-${mode === "draft" ? lang : lang + "-" + mode}.jpg`;
  const poster = existsSync(posterFile) ? posterFile : null;
  const thumb = poster ? `${SITE}/${poster}` : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const thumbSrc = poster ? `/${poster}` : thumb;
  const watch = `https://www.youtube.com/shorts/${id}`;
  const ld = {
    "@context": "https://schema.org", "@type": "VideoObject",
    name: v.title || `${setDisplay} ${T.mode[mode]} — ${T.videoH}`,
    description: T.videoLead,
    thumbnailUrl: [thumb],
    uploadDate: v.uploadedAt || "",
    duration: v.duration || "PT1M",
    contentUrl: watch,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    inLanguage: lang
  };
  return `<section class="video"><div class="yt" data-id="${esc(id)}">
    <img src="${thumbSrc}" alt="${esc(v.title || T.videoH)}" loading="lazy" width="270" height="480">
    <button type="button" aria-label="${esc(T.videoPlay)}"><span></span></button>
  </div>
  <div class="vtext"><h3>${esc(T.videoH)}</h3><p class="lead">${esc(T.videoLead)}</p>
    <p><a href="${watch}" target="_blank" rel="noopener">${esc(T.videoOpen)}</a></p>
  </div>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  <script>document.querySelectorAll(".video .yt button").forEach(function(btn){ if(btn.dataset.wired) return; btn.dataset.wired="1"; btn.addEventListener("click",function(){var b=this.parentNode,f=document.createElement("iframe");f.src="https://www.youtube-nocookie.com/embed/"+b.dataset.id+"?autoplay=1&playsinline=1";f.allow="autoplay; encrypted-media; picture-in-picture";f.allowFullscreen=true;f.title=this.getAttribute("aria-label");b.innerHTML="";b.appendChild(f);});});</script>
</section>
`;
}

function indexPage(lang, rows, profileOnly = []){
  const T = L[lang];
  const canonical = pretty(`${SITE}/${OUT}/index${lang === "en" ? ".en" : ""}.html`);
  const head = `<title>${esc(T.indexH1)} — ${esc(T.site)}</title>
<meta name="description" content="${esc(T.indexLead)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${pretty(`${SITE}/${OUT}/index.html`)}">
<link rel="alternate" hreflang="en" href="${pretty(`${SITE}/${OUT}/index.en.html`)}">
<link rel="alternate" hreflang="x-default" href="${pretty(`${SITE}/${OUT}/index.html`)}">
<meta property="og:title" content="${esc(T.indexH1)}">
<meta property="og:url" content="${canonical}">`;
  const header = `    <h1>${esc(T.indexH1)}</h1>
    <p>${esc(T.lead)}</p>`;
  const main = `<p class="lead">${esc(T.indexLead)}</p>
${profileOnly.length ? `<ul class="setlist" style="margin-bottom:14px">
${profileOnly.map(r => `  <li><a href="${r.code}.profile${lang === "en" ? ".en" : ""}.html">${esc(r.name[lang])}<small>${esc(r.code)}${r.released_at ? "　" + esc(r.released_at) : ""}　${lang === "ja" ? "下見（勝率データ待ち）" : "Preview (awaiting win-rate data)"}</small></a></li>`).join("\n")}
</ul>` : ""}
<ul class="setlist">
${rows.map(r => `  <li><a href="${r.code}${lang === "en" ? ".en" : ""}.html">${esc(r.name[lang])}<small>${esc(r.code)}${r.released_at ? "　" + esc(r.released_at) : ""}　${esc((r.games || 0).toLocaleString())} ${lang === "ja" ? "試合" : "games"}</small></a></li>`).join("\n")}
</ul>`;
  const other = lang === "ja" ? "index.en.html" : "index.html";
  return shell(lang, "index", head, { header, main }).replace(`href="${L[lang].otherHref("index")}"`, `href="${other}"`);
}

/* ---------- 本体 ---------- */
async function main(){
  const index = await readJson(`${ARTICLES}/index.json`, null);
  if(!index || !Array.isArray(index.articles)){ console.error("data/articles/index.json がありません"); return; }
  const speedIndex = index.speed || null;
  const long = await readJson("data/long.json", {});       // 長尺の環境まとめ動画（日本語のみ。YouTube で公開にしてから add-long.mjs で登録したものだけ載せる）
  const videos = await readJson("data/videos.json", {});   // セットごとの YouTube 動画（「動画を配信」で public になったものだけ載せる）
  const ja = await setNamesJa();
  await mkdir(OUT, { recursive: true });

  const codes = [...new Set(index.articles.map(a => a.set))];
  const rows = [];
  for(const code of codes){
    const arts = {};
    for(const m of ["draft","sealed"]){
      const d = await readJson(`${ARTICLES}/${code}_${m}.json`, null);
      if(d) arts[m] = d;
    }
    const cache = await cardNamesJa(code);
    const info = await setInfo(code, cache);
    if(info.set !== cache.set || info.released_at !== cache.released_at){
      await writeFile(`${NAMES}/${code}.json`, JSON.stringify({ ...cache, set: info.set, released_at: info.released_at }), "utf8");
    }
    const name = { ja: ja[code.toLowerCase()] || info.set || code, en: info.set || code };
    const games = Object.values(arts).reduce((a, d) => a + (d.total_games || 0), 0);
    rows.push({ code, name, released_at: info.released_at || (index.articles.find(a => a.set === code) || {}).released_at || "", games });
    for(const lang of ["ja","en"]){
      const html = setPage(lang, code, name[lang], info, arts, speedIndex, cache.names || {}, videos, long);
      await writeFile(`${OUT}/${code}${lang === "en" ? ".en" : ""}.html`, html, "utf8");
    }
    await sleep(120);
  }
  rows.sort((a, b) => (b.released_at || "").localeCompare(a.released_at || "") || a.code.localeCompare(b.code));
  // 下見だけあって、まだ環境レポートが無いセット
  const profileOnly = [];
  try{
    const { readdir } = await import("node:fs/promises");
    for(const f of await readdir("data/profiles")){
      if(!f.endsWith(".json") || f === "index.json") continue;
      const code = f.replace(/\.json$/, "");
      if(codes.includes(code)) continue;
      const pr = await readJson(`data/profiles/${f}`, null);
      if(pr) profileOnly.push({ code, name: { ja: pr.nameJa || pr.setName || code, en: pr.setName || code }, released_at: pr.released_at || "" });
    }
  }catch(e){}
  profileOnly.sort((a, b) => (b.released_at || "").localeCompare(a.released_at || ""));
  await writeFile(`${OUT}/index.html`, indexPage("ja", rows, profileOnly), "utf8");
  await writeFile(`${OUT}/index.en.html`, indexPage("en", rows, profileOnly), "utf8");
  console.error(`セット別ページを生成: ${rows.length}セット × 2言語`);
}

export { shell, L, esc, readJson, setNamesJa, fetchJaNames, SCRY_HEADERS, SITE, pretty };
// 直接実行したときだけ動かす（build-set-profile.mjs から shell を借りるため）
import { pathToFileURL } from "node:url";
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  main().catch(e => { console.error(e); process.exit(1); });
}
