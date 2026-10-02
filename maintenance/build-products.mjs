#!/usr/bin/env node
/*
 * 日本の TCG サプライ（スリーブ・デッキケース・プレイマット）の紹介ページを作る。
 *
 *   node maintenance/build-products.mjs            … 楽天で商品を探して data/products/current.json を作り、goods/ のページを作り直す
 *   node maintenance/build-products.mjs --pages    … 探さずに、current.json からページだけ作り直す（リンクの形を変えたときなど）
 *
 * 商品の元データは楽天市場の商品検索 API。設定は data/products/config.json：
 *   fixed    … 定番（毎週同じ。検索語で楽天の商品を1つ引き当てる）
 *   rotating … 週替わりの枠（キャラスリ・デッキケース・プレイマット）。検索して候補を集め、直近 N 週に出したものを除いて選ぶ
 *   seed     … 最初に手で選んだ商品。まだ出していなければ優先して入れる
 * リンクの形は data/affiliate.json（Buyee のトラッキングリンク、Amazon のタグ）。
 *
 * 必要な環境変数（Secrets）: RAKUTEN_APP_ID, RAKUTEN_ACCESS_KEY, RAKUTEN_AFFILIATE_ID
 * 楽天の画像は、楽天アフィリエイトのリンクと一緒に表示する（楽天の規約）。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { shell, L, esc, readJson, SITE } from "./build-set-pages.mjs";

const PAGES_ONLY = process.argv.includes("--pages");
const APP = process.env.RAKUTEN_APP_ID, KEY = process.env.RAKUTEN_ACCESS_KEY, AFF = process.env.RAKUTEN_AFFILIATE_ID;
const cfg = await readJson("data/products/config.json", null);
if(!cfg){ console.error("data/products/config.json がありません"); process.exit(1); }
const aff = await readJson("data/affiliate.json", { buyee: {}, amazon: {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 楽天の検索 ---------- */
// 版は 2026 年の新基盤のもの（古い 20220601 は「API Configuration not found」で断られる）。1秒に1回までなので、間を空けて 429 なら待って試し直す
const RAKUTEN_VERSION = process.env.RAKUTEN_API_VERSION || "20260701";
let lastCall = 0;
async function rakutenSearch(keyword, extra = {}){
  for(let attempt = 0; attempt < 4; attempt++){
    const wait = 1100 - (Date.now() - lastCall);
    if(wait > 0) await sleep(wait);
    lastCall = Date.now();
    try{ return await rakutenSearchOnce(keyword, extra); }
    catch(e){
      if(/HTTP 429/.test(e.message) && attempt < 3){ await sleep(1500 * (attempt + 1)); continue; }
      throw e;
    }
  }
}
async function rakutenSearchOnce(keyword, extra = {}){
  const u = new URL(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/${RAKUTEN_VERSION}`);
  const p = { applicationId: APP, accessKey: KEY, affiliateId: AFF || "", keyword, format: "json", formatVersion: "2", hits: "30", imageFlag: "1", availability: "1", ...extra };
  for(const [k, v] of Object.entries(p)) if(v !== "" && v != null) u.searchParams.set(k, String(v));
  // Web アプリとして登録しているので、登録したサイトの名前で問い合わせる
  const r = await fetch(u, { headers: { Referer: `${SITE}/`, Origin: SITE, "User-Agent": "Mozilla/5.0 (sealed-workbench product builder)" } });
  const body = await r.text();
  if(!r.ok) throw new Error(`楽天 API HTTP ${r.status}: ${body.slice(0, 200)}`);
  const j = JSON.parse(body);
  return (j.Items || []).map(normalize);
}
function normalize(it){
  const img = (it.mediumImageUrls || [])[0] || "";
  return {
    code: it.itemCode, name: it.itemName, price: it.itemPrice, url: it.itemUrl, affiliateUrl: it.affiliateUrl || it.itemUrl,
    image: img ? img.replace(/_ex=\d+x\d+/, "_ex=400x400") : "",
    shop: it.shopName, shopCode: it.shopCode, availability: it.availability, reviewCount: it.reviewCount || 0, reviewAverage: it.reviewAverage || 0,
    caption: (it.itemCaption || "").slice(0, 300)
  };
}
const hasMaker = n => cfg.makers.some(m => n.toLowerCase().includes(m.toLowerCase()));
const excluded = n => cfg.exclude.some(w => n.includes(w));
const ok = it => it.availability === 1 && hasMaker(it.name) && !excluded(it.name) && it.image;

/* ---------- 選定 ---------- */
function isoWeek(d = new Date()){
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}
function seeded(str){ let h = 2166136261; for(const c of str){ h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; }

async function select(){
  const week = isoWeek();
  const history = await readJson("data/products/history.json", {});
  const recent = new Set(Object.entries(history).sort((a, b) => b[0].localeCompare(a[0])).slice(0, cfg.historyWeeks || 4).flatMap(([, codes]) => codes));
  const out = { generatedAt: new Date().toISOString(), week, fixed: [], rotating: {} };

  // 定番：検索語で1つ引き当てる（レビューの多い出品を優先）
  for(const f of cfg.fixed){
    try{
      const must = f.keyword.split(/\s+/)[0].toLowerCase();   // 検索語の先頭（メーカー名）が商品名に入っているものだけ
      const items = (await rakutenSearch(f.keyword, { sort: "-reviewCount" })).filter(ok).filter(it => it.name.toLowerCase().includes(must));
      const it = items[0];
      if(it) out.fixed.push({ ...it, id: f.id, group: f.group, label: f.name, note: f.note, amazon: f.amazon || "" });
      else console.error(`定番: 見つからず ${f.keyword}`);
      
    }catch(e){ console.error(`定番: ${f.keyword}: ${e.message}`); }
  }

  // 週替わり：候補を集めて、直近に出したものを除き、点数と週の乱数で選ぶ
  const rnd = seeded(week);
  for(const g of cfg.rotating){
    const cand = new Map();
    for(const q of g.queries){
      for(const sort of ["standard", "-reviewCount"]){
        try{ for(const it of (await rakutenSearch(q, { sort })).filter(ok)) if(!cand.has(it.code)) cand.set(it.code, it); }
        catch(e){ console.error(`週替わり: ${q} (${sort}): ${e.message}`); }
        
      }
    }
    // 最初に手で選んだ商品（seed）は、まだ出していなければ最優先
    const seeds = (cfg.seed || []).filter(s => s.group === g.group);
    const picked = [];
    for(const s of seeds){
      if(picked.length >= g.pick) break;
      try{
        const it = (await rakutenSearch(s.keyword, { sort: "-reviewCount" })).filter(ok)[0];
        
        if(it && !recent.has(it.code) && !picked.some(p => p.code === it.code)){ picked.push({ ...it, amazon: s.amazon || "" }); cand.delete(it.code); }
      }catch(e){}
    }
    const rest = [...cand.values()].filter(it => !recent.has(it.code))
      .map(it => ({ it, score: Math.log1p(it.reviewCount) * 2 + it.reviewAverage + rnd() * 3 }))
      .sort((a, b) => b.score - a.score);
    for(const { it } of rest){ if(picked.length >= g.pick) break; if(!picked.some(p => p.name === it.name)) picked.push(it); }
    out.rotating[g.group] = picked.map(it => ({ ...it, group: g.group }));
    console.error(`${g.group}: 候補 ${cand.size + picked.length} → ${picked.length} 件`);
  }

  decorate(out);
  history[week] = [...Object.values(out.rotating).flat().map(it => it.code)];
  await mkdir("data/products", { recursive: true });
  await writeFile("data/products/history.json", JSON.stringify(history, null, 1), "utf8");
  await writeFile("data/products/current.json", JSON.stringify(out, null, 1), "utf8");
  return out;
}

/* 各ページの小さな枠（goods-widget.js）が使う、言語別の見出しとリンクを商品に付ける */
function decorate(data){
  for(const it of [...data.fixed, ...Object.values(data.rotating).flat()]){
    it.labelJa = it.label ? it.label.ja : shortName(it.name);
    it.labelEn = it.label ? it.label.en : labelEn(it);
    it.links = { rakuten: it.affiliateUrl, buyee: buyeeLink(it), amazon: amazonLink(it.amazon) || "" };
  }
}

/* ---------- ページ ---------- */
const P = {
  ja: {
    title: "日本の TCG サプライ｜スリーブ・デッキケース・プレイマット",
    desc: "日本のプレイヤーが使っている定番スリーブと、今週の新作キャラクタースリーブ・デッキケース・プレイマット。楽天市場の商品を紹介します。",
    h1: "日本の TCG サプライ", lead: "日本のプレイヤーが使っている定番と、今週の新作キャラクタースリーブ・デッキケース。リンク先は楽天市場です。",
    fixedH: "定番", fixedLead: "大会でも普段使いでも定番の国産サプライ。",
    group: { "chara-sleeve": "今週のキャラクタースリーブ", "deck-case": "今週のデッキケース", "playmat": "今週のプレイマット" },
    groupLead: { "chara-sleeve": "毎週入れ替えています。キャラスリは生産数が少ないので、気になったものは早めに。", "deck-case": "キャラクターもの中心。", "playmat": "ラバー製の国産プレイマット。" },
    price: p => `¥${p.toLocaleString("ja-JP")}`, shop: s => `出品：${s}`,
    btnRakuten: "楽天市場で見る", btnBuyee: "Buyee（海外発送）", btnAmazon: "Amazon で見る",
    updated: w => `更新：${w}（毎週月曜に自動で入れ替え）`,
    disclosure: "PR：このページの商品リンクはアフィリエイトリンクです。",
    rakutenNote: "商品情報と画像は楽天市場の API から取得しています。"
  },
  en: {
    title: "Japanese TCG supplies — sleeves, deck boxes and playmats you can only get in Japan",
    desc: "The sleeves Japanese players actually use, plus this week's new character sleeves, deck boxes and playmats. Buy from Japan via Buyee.",
    h1: "Japanese TCG supplies", lead: "The staples Japanese players actually use, plus this week's new character sleeves and deck boxes. Every item ships worldwide through Buyee, a Japanese proxy-buying service.",
    fixedH: "The staples", fixedLead: "Made-in-Japan supplies you'll see at every Japanese tournament table.",
    group: { "chara-sleeve": "This week's character sleeves", "deck-case": "This week's deck boxes", "playmat": "This week's playmats" },
    groupLead: { "chara-sleeve": "Rotates weekly. Character sleeves are printed in small runs and sell out, so don't wait.", "deck-case": "Mostly character goods.", "playmat": "Rubber playmats, made in Japan." },
    price: p => `¥${p.toLocaleString("en-US")} (about $${(p / 150).toFixed(0)})`, shop: s => `Seller: ${s}`,
    btnRakuten: "Rakuten (Japan only)", btnBuyee: "Buy via Buyee (ships worldwide)", btnAmazon: "Amazon Japan",
    updated: w => `Updated: ${w} (rotates automatically every Monday)`,
    disclosure: "Contains affiliate links.",
    rakutenNote: "Product details and images come from the Rakuten Ichiba API. Rakuten shops generally ship within Japan only — use the Buyee button to order from overseas."
  }
};
/* 英語の見出し：種類 by メーカー — 作品名（商品名の英字部分、または対応表から） */
const MAKER_EN = [["ブロッコリー", "Broccoli"], ["BROCCOLI", "Broccoli"], ["ムービック", "movic"], ["movic", "movic"], ["ブシロード", "Bushiroad"], ["Bushiroad", "Bushiroad"],
  ["ポケモンセンター", "Pokémon Center"], ["ポケモン", "Pokémon"], ["KMC", "KMC"], ["ケイエムシー", "KMC"], ["やのまん", "Yanoman"], ["ホビーベース", "Hobby Base"], ["アンサー", "Answer"],
  ["エポック", "Epoch"], ["ウルトラプロ", "Ultra PRO"], ["Ultra PRO", "Ultra PRO"], ["河島製作所", "Kawashima"], ["ドラゴンシールド", "Dragon Shield"], ["Dragon Shield", "Dragon Shield"]];
const FRANCHISE_EN = [["エヴァンゲリオン", "Evangelion"], ["ダンジョンに出会いを求めるのは間違っているだろうか", "DanMachi"], ["勝利の女神", "NIKKE"], ["ウマ娘", "Umamusume"], ["ホロライブ", "hololive"],
  ["初音ミク", "Hatsune Miku"], ["鬼滅の刃", "Demon Slayer"], ["呪術廻戦", "Jujutsu Kaisen"], ["僕のヒーローアカデミア", "My Hero Academia"], ["ワンピース", "One Piece"], ["ドラゴンボール", "Dragon Ball"],
  ["アイドルマスター", "The Idolmaster"], ["ラブライブ", "Love Live!"], ["ガンダム", "Gundam"], ["艦隊これくしょん", "KanColle"], ["アズールレーン", "Azur Lane"], ["ブルーアーカイブ", "Blue Archive"],
  ["原神", "Genshin Impact"], ["崩壊", "Honkai"], ["東方", "Touhou"], ["リコリス・リコイル", "Lycoris Recoil"], ["ぼっち・ざ・ろっく", "Bocchi the Rock!"], ["葬送のフリーレン", "Frieren"],
  ["推しの子", "Oshi no Ko"], ["ポケモン", "Pokémon"], ["遊戯王", "Yu-Gi-Oh!"], ["デュエル・マスターズ", "Duel Masters"], ["マジック：ザ・ギャザリング", "Magic: The Gathering"]];
const GROUP_EN = { sleeve: "Sleeves", "chara-sleeve": "Character sleeves", "deck-case": "Deck box", playmat: "Playmat" };
function labelEn(it){
  const n = String(it.name);
  const maker = (MAKER_EN.find(([k]) => n.toLowerCase().includes(k.toLowerCase())) || [])[1];
  let fr = (FRANCHISE_EN.find(([k]) => n.includes(k)) || [])[1];
  if(!fr){
    // 英字の作品名（Shadowverse、Fate/Grand Order など）。メーカー名や型番は除く
    const skip = new Set(["No", "NEO", "MAX", "Vol", "KMC", "TCG", "DX", "mm", "ver", "Ver"]);
    const m = (n.match(/[A-Za-z][A-Za-z0-9&'!:.\/\- ]{2,}/g) || []).map(x => x.trim()).filter(x => x.length >= 4 && !skip.has(x) && !/^[A-Z]{1,3}\d+/.test(x) && !MAKER_EN.some(([k]) => x.toLowerCase() === k.toLowerCase()));
    fr = m[0] || "";
  }
  return `${GROUP_EN[it.group] || "Supplies"}${maker ? " by " + maker : ""}${fr ? " — " + fr : ""}`;
}
const buyeeLink = it => {
  const item = (aff.buyee.itemTemplate || "https://buyee.jp/rakuten/detail/{itemCodeEnc}?lang=en").replace("{itemCodeEnc}", encodeURIComponent(it.code));
  return aff.buyee.trackingTemplate ? aff.buyee.trackingTemplate.replace("{url}", encodeURIComponent(item)) : item;
};
const amazonLink = asin => asin && aff.amazon.tag ? `https://www.amazon.co.jp/dp/${asin}?tag=${encodeURIComponent(aff.amazon.tag)}` : "";
/* 商品名を見出し用に少し整える（英語ページでは日本語名をそのまま。海外の人が Buyee で探すときの手がかりになる） */
const shortName = n => String(n).replace(/【[^】]*】/g, "").replace(/\s{2,}/g, " ").trim();

function card(lang, it){
  const T = P[lang];
  const label = it.label ? it.label[lang] : (lang === "en" ? labelEn(it) : shortName(it.name));
  const note = it.note ? it.note[lang] : "";
  const az = amazonLink(it.amazon);
  const primary = lang === "en" ? `<a class="btn p" href="${esc(buyeeLink(it))}" target="_blank" rel="noopener sponsored">${esc(T.btnBuyee)}</a>` : `<a class="btn p" href="${esc(it.affiliateUrl)}" target="_blank" rel="noopener sponsored">${esc(T.btnRakuten)}</a>`;
  const secondary = lang === "en" ? `<a class="btn" href="${esc(it.affiliateUrl)}" target="_blank" rel="noopener sponsored">${esc(T.btnRakuten)}</a>` : `<a class="btn" href="${esc(buyeeLink(it))}" target="_blank" rel="noopener sponsored">${esc(T.btnBuyee)}</a>`;
  return `<li class="item">
  <a class="img" href="${esc(it.affiliateUrl)}" target="_blank" rel="noopener sponsored"><img src="${esc(it.image)}" alt="${esc(label)}" loading="lazy" width="200" height="200"></a>
  <div class="txt">
    <h3>${esc(label)}</h3>
    ${(it.label || lang === "en") ? `<p class="jp">${esc(shortName(it.name))}</p>` : ""}
    ${note ? `<p class="note">${esc(note)}</p>` : ""}
    <p class="price">${esc(T.price(it.price))} <small>${esc(T.shop(it.shop))}</small></p>
    <p class="btns">${primary}${secondary}${az ? `<a class="btn" href="${esc(az)}" target="_blank" rel="noopener sponsored">${esc(T.btnAmazon)}</a>` : ""}</p>
  </div>
</li>`;
}

function page(lang, data){
  const T = P[lang], B = L[lang];
  const canonical = `${SITE}/goods/index${lang === "en" ? ".en" : ""}.html`;
  const head = `<title>${esc(T.title)} — ${esc(B.site)}</title>
<meta name="description" content="${esc(T.desc)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${SITE}/goods/index.html">
<link rel="alternate" hreflang="en" href="${SITE}/goods/index.en.html">
<meta property="og:title" content="${esc(T.title)}">
<meta property="og:description" content="${esc(T.desc)}">
<meta property="og:url" content="${canonical}">
<style>
  .goods{list-style:none;margin:0 0 28px;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
  .item{display:flex;gap:12px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px}
  .item .img{flex:none;width:120px;height:120px;border-radius:8px;overflow:hidden;background:var(--paper-2)}
  .item .img img{width:100%;height:100%;object-fit:contain;display:block}
  .item h3{font-size:14.5px;margin:0 0 4px;line-height:1.4}
  .item .jp,.item .note{font-size:12.5px;color:var(--muted);margin:0 0 4px;line-height:1.5}
  .item .price{font-size:14px;font-weight:700;margin:6px 0}
  .item .price small{font-weight:400;color:var(--muted);margin-left:6px}
  .btns{display:flex;flex-wrap:wrap;gap:6px;margin:0}
  .btn{font-size:12.5px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--ink);background:#fff}
  .btn.p{background:var(--pine);color:#fff;border-color:var(--pine)}
  .disc{font-size:11.5px;color:var(--muted);margin:0 0 4px}
  .lead{color:var(--muted);font-size:13.5px;margin:0 0 12px}
  @media (max-width:640px){ .item .img{width:90px;height:90px} }
</style>`;
  const header = `    <h1>${esc(T.h1)}</h1>
    <p>${esc(T.lead)}</p>`;
  let main = `<p class="disc">${esc(T.disclosure)}</p>
<p class="built">${esc(T.updated(data.week))}</p>
<section><h2>${esc(T.fixedH)}</h2><p class="lead">${esc(T.fixedLead)}</p><ul class="goods">${data.fixed.map(it => card(lang, it)).join("\n")}</ul></section>`;
  for(const [g, items] of Object.entries(data.rotating)){
    if(!items.length) continue;
    main += `\n<section><h2>${esc(T.group[g] || g)}</h2><p class="lead">${esc(T.groupLead[g] || "")}</p><ul class="goods">${items.map(it => card(lang, it)).join("\n")}</ul></section>`;
  }
  main += `\n<p class="source">${esc(T.rakutenNote)}</p>`;
  return shell(lang, "index", head, { header, main, noGoods: true });
}

/* ---------- 実行 ---------- */
let data;
if(PAGES_ONLY){
  data = await readJson("data/products/current.json", null);
  if(!data){ console.error("data/products/current.json がありません。先に探してください"); process.exit(1); }
  decorate(data);
  await writeFile("data/products/current.json", JSON.stringify(data, null, 1), "utf8");
}else{
  if(!APP || !KEY){ console.error("RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY が要ります"); process.exit(1); }
  data = await select();
}
await mkdir("goods", { recursive: true });
await writeFile("goods/index.html", page("ja", data), "utf8");
await writeFile("goods/index.en.html", page("en", data), "utf8");
console.error(`goods/index.html, goods/index.en.html を作りました（定番 ${data.fixed.length}、週替わり ${Object.values(data.rotating).flat().length}）`);
