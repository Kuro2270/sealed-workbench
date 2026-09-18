#!/usr/bin/env node
/*
 * セット別ページ用の OGP 画像（1200×630）を日本語版・英語版で作る。
 *
 *   node maintenance/build-set-ogp.mjs
 *
 * 出力: sets/og/<SET>-ja.png / sets/og/<SET>-en.png
 *
 * ・data/articles/<SET>_draft.json（無ければ sealed）から数字を取り、
 *   data/names/<SET>.json のカード画像（日本語版／英語版）を右側に3枚並べる
 * ・文字は SVG で描き、カード画像と一緒に sharp で PNG にする
 * ・sharp が無い環境では SVG だけを残して終了する（Actions では sharp を入れてから実行する）
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SCRY_HEADERS = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" };
const W = 1200, H = 630;
const PINE = "#23342E", PINE_DEEP = "#18241F", GOLD = "#B8912F", PAPER = "#F3F5F1", MUTED = "#B9C7C0";
const ARTICLES = "data/articles", NAMES = "data/names", OUT = "sets/og";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJson(path, fallback){ try{ return JSON.parse(await readFile(path, "utf8")); }catch(e){ return fallback; } }
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));
const pct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";

const L = {
  ja: {
    brand: "MTGアリーナ リミテッド・ワークベンチ",
    sub: "リミテッド環境レポート（ドラフト・シールド）",
    games: n => `総試合数 ${n}`,
    speed: { fast:"速い", mid:"中速", slow:"遅い", slower:"かなり遅い" },
    bucket: { fast:"2.9未満", mid:"3.2未満", slow:"3.5未満", slower:"3.5以上" },
    best: (k, p) => `環境の速さ：${L.ja.speed[k] || k}（平均マナ総量${L.ja.bucket[k] || ""}のデッキが${p}）`,
    colors: rows => "強い色：" + rows.map(c => `${{W:"白",U:"青",B:"黒",R:"赤",G:"緑"}[c.color] || c.color} ${pct(c.wr)}`).join("／"),
    top: "神話レアの勝率トップ3"
  },
  en: {
    brand: "MTG Arena Limited Workbench",
    sub: "Limited format report (Draft & Sealed)",
    games: n => `${n} games`,
    speed: { fast:"fast", mid:"medium", slow:"slow", slower:"very slow" },
    bucket: { fast:"under 2.9", mid:"under 3.2", slow:"under 3.5", slower:"3.5+" },
    best: (k, p) => `Pace: ${L.en.speed[k] || k} (${L.en.bucket[k] || ""} avg. MV decks win ${p})`,
    colors: rows => "Top colours: " + rows.map(c => `${{W:"White",U:"Blue",B:"Black",R:"Red",G:"Green"}[c.color] || c.color} ${pct(c.wr)}`).join(" / "),
    top: "Top 3 mythics by win rate"
  }
};

async function setNamesJa(){
  try{
    const src = await readFile("i18n.js", "utf8");
    const m = src.match(/const SET_JA = (\{[\s\S]*?\});/);
    if(m) return new Function("return " + m[1])();
  }catch(e){}
  return {};
}

/* 文字の長さに応じて見出しの大きさを変える */
function titleSize(name, lang){
  const n = [...name].length;
  if(lang === "ja") return n <= 12 ? 56 : n <= 18 ? 44 : n <= 26 ? 34 : 28;
  return n <= 18 ? 60 : n <= 30 ? 46 : 36;
}

function svgFor(lang, name, d, topCards){
  const t = L[lang];
  const fontJa = "'Noto Sans CJK JP','Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic',sans-serif";
  const fontEn = "'DejaVu Sans','Noto Sans','Helvetica Neue',Arial,sans-serif";
  const font = lang === "ja" ? fontJa : fontEn;
  const best = (d.speed || []).filter(s => s.wr != null).sort((a, b) => b.wr - a.wr)[0];
  const colors = (d.colors || []).slice().sort((a, b) => b.wr - a.wr).slice(0, 2);
  const games = (d.total_games || 0).toLocaleString();
  const lines = [
    t.games(games),
    best ? t.best(best.key, pct(best.wr)) : "",
    colors.length ? t.colors(colors) : ""
  ].filter(Boolean);
  const tsize = titleSize(name, lang);
  const lineSize = lang === "ja" ? 21 : 22;
  const body = lines.map((s, i) => `<text x="70" y="${352 + i * 40}" font-family="${font}" font-size="${lineSize}" fill="${PAPER}" opacity="0.92">${esc(s)}</text>`).join("\n");
  const topLabel = topCards.length ? `<text x="740" y="118" font-family="${font}" font-size="18" fill="${MUTED}">${esc(t.top)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PINE}"/>
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="${GOLD}"/>
  <text x="70" y="96" font-family="${font}" font-size="22" font-weight="700" letter-spacing="1" fill="${GOLD}">${esc(t.brand)}</text>
  <text x="70" y="${170 + (56 - tsize) * 0.5}" font-family="${font}" font-size="${tsize}" font-weight="800" fill="${PAPER}">${esc(name)}</text>
  <text x="70" y="240" font-family="${font}" font-size="${lang === "ja" ? 24 : 26}" fill="${MUTED}">${esc(t.sub)}</text>
  <line x1="70" y1="290" x2="620" y2="290" stroke="${GOLD}" stroke-opacity="0.6" stroke-width="2"/>
  ${body}
  ${topLabel}
  <text x="70" y="${H - 44}" font-family="${fontEn}" font-size="24" font-weight="700" fill="${GOLD}" letter-spacing="0.5">sealed-workbench.com</text>
</svg>`;
}

async function cardLayers(sharp, urls){
  // 右側に3枚を少しずつ重ねて置く
  const layers = [];
  const cardW = 176, cardH = Math.round(cardW * 680 / 488);
  const xs = [736, 866, 996], rots = [-6, 0, 6], ys = [150, 132, 150];
  for(let i = 0; i < urls.length && i < 3; i++){
    try{
      const r = await fetch(urls[i], { headers: SCRY_HEADERS });
      if(!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const img = await sharp(buf).resize(cardW, cardH, { fit: "cover" })
        .rotate(rots[i], { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      layers.push({ input: img, left: xs[i] - (rots[i] ? 12 : 0), top: ys[i] });
    }catch(e){}
    await sleep(120);
  }
  return layers;
}

async function main(){
  const index = await readJson(`${ARTICLES}/index.json`, null);
  if(!index){ console.error("data/articles/index.json がありません"); return; }
  let sharp = null;
  try{ sharp = (await import("sharp")).default; }catch(e){ console.error("sharp が無いので SVG だけを出力します"); }
  const ja = await setNamesJa();
  await mkdir(OUT, { recursive: true });
  const codes = [...new Set(index.articles.map(a => a.set))];
  let made = 0;
  for(const code of codes){
    const d = await readJson(`${ARTICLES}/${code}_draft.json`, null) || await readJson(`${ARTICLES}/${code}_sealed.json`, null);
    if(!d) continue;
    const names = await readJson(`${NAMES}/${code}.json`, { names: {}, images: {}, imagesEn: {}, set: code });
    // 神話レアの勝率トップ3。3枚に満たないセットはレアで補う
    const mythics = ((d.top && d.top.mythic) || []).slice().sort((a, b) => b.gih - a.gih).slice(0, 3);
    const rares = ((d.top && d.top.rare) || []).slice().sort((a, b) => b.gih - a.gih);
    const top = mythics.concat(rares).slice(0, 3);
    for(const lang of ["ja", "en"]){
      const name = lang === "ja" ? (ja[code.toLowerCase()] || names.set || code) : (names.set || code);
      const bank = lang === "ja" ? (names.images || {}) : (names.imagesEn || {});   // 英語版に日本語版の画像を使わない
      const urls = top.map(c => bank[c.name] || bank[String(c.name).split(" // ")[0]]).filter(Boolean);
      const svg = svgFor(lang, name, d, urls);
      const out = `${OUT}/${code}-${lang}`;
      if(!sharp){ await writeFile(out + ".svg", svg, "utf8"); continue; }
      const layers = await cardLayers(sharp, urls);
      const png = await sharp(Buffer.from(svg)).composite(layers).png({ compressionLevel: 9 }).toBuffer();
      await writeFile(out + ".png", png);
      made++;
    }
  }
  console.error(`セット別 OGP 画像: ${made} 枚`);
}

main().catch(e => { console.error(e); process.exit(1); });
