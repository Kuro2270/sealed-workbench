#!/usr/bin/env node
/*
 * 新セットの「下見」ページを作る（勝率データが出る前の2週間用）。
 *
 *   node maintenance/build-set-profile.mjs FRA
 *
 * 出力: sets/<SET>.profile.html（日本語）／ sets/<SET>.profile.en.html（英語）／ data/profiles/<SET>.json
 *
 * 勝率が無くても数えられることだけを、セットの全カードから集計する：
 *   ・色ごとの枚数（コモン・アンコモン中心）、クリーチャーの割合
 *   ・飛行持ちの数、除去の数（オラクル文の型から判定）
 *   ・マナ総量の分布（色ごと）、クリーチャーの平均サイズ
 * 勝率データが出たら、セットページ側が「データが出ました」に切り替わる（このページは残す）。
 *
 * カード情報は Scryfall（SCRYFALL_FIXTURE=path を指定するとそのJSONを読む：テスト用）。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { shell, L, esc, readJson, setNamesJa, SCRY_HEADERS, SITE } from "./build-set-pages.mjs";

const ARG = (process.argv[2] || "").toUpperCase();
if(!ARG){ console.error("使い方: node maintenance/build-set-profile.mjs <SET>　または --auto（発売前後で下見が無いセットを探して作る）"); process.exit(1); }
const sleep0 = ms => new Promise(r => setTimeout(r, ms));
/* --auto：紙の発売日が 20日前〜7日後で、まだ環境レポートも下見も無いセットを探す */
if(ARG === "--AUTO"){
  const { execFileSync } = await import("node:child_process");
  const r = await fetch("https://api.scryfall.com/sets", { headers: SCRY_HEADERS });
  if(!r.ok){ console.error(`Scryfall HTTP ${r.status}`); process.exit(1); }
  const now = Date.now(), iso = t => new Date(t).toISOString().slice(0, 10);
  const from = iso(now - 20 * 86400000), to = iso(now + 7 * 86400000);
  const idx = await readJson("data/articles/index.json", { articles: [] });
  const have = new Set((idx.articles || []).map(a => String(a.set).toUpperCase()));
  const sets = (await r.json()).data.filter(s => ["expansion", "core"].includes(s.set_type) && s.released_at >= from && s.released_at <= to && s.card_count > 150).map(s => s.code.toUpperCase());
  let made = 0;
  for(const code of sets){
    if(have.has(code)) continue;
    const { existsSync } = await import("node:fs");
    if(existsSync(`data/profiles/${code}.json`)) continue;
    console.error(`下見を作る: ${code}`);
    execFileSync("node", [process.argv[1], code], { stdio: "inherit" }); made++;
    await sleep0(500);
  }
  console.error(made ? `${made} セットの下見を作りました` : "新しく作る下見はありません");
  process.exit(0);
}
const SET = ARG;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COLORS = ["W", "U", "B", "R", "G"];

/* ---------- カードを集める ---------- */
async function fetchCards(){
  if(process.env.SCRYFALL_FIXTURE) return JSON.parse(await readFile(process.env.SCRYFALL_FIXTURE, "utf8"));
  const out = [];
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${SET.toLowerCase()} unique:cards`)}&order=set`;
  while(url){
    const r = await fetch(url, { headers: SCRY_HEADERS });
    if(!r.ok) throw new Error(`Scryfall HTTP ${r.status}`);
    const j = await r.json();
    out.push(...(j.data || []));
    url = j.has_more ? j.next_page : null;
    await sleep(120);
  }
  return out;
}

/* ---------- 判定 ---------- */
const face = c => (c.card_faces && c.card_faces[0]) || c;
const oracle = c => (c.card_faces ? c.card_faces.map(f => f.oracle_text || "").join("\n") : (c.oracle_text || ""));
// トークン・紋章・アートカードを除く。booster フラグは発売前後で当てにならないので見ない
const isBooster = c => !["token", "double_faced_token", "emblem", "art_series", "reversible_card"].includes(c.layout || "")
                    && !/^(Token|Emblem|Card)\b/.test(face(c).type_line || "") && c.set_type !== "token"
                    && !(c.collector_number && /[a-z]$/i.test(String(c.collector_number)) && c.promo);
const isCreature = c => /Creature/.test(face(c).type_line || "");
const isLand = c => /^Land|— Land|Land —|^Basic Land/.test(face(c).type_line || "") && !/Creature/.test(face(c).type_line || "");
const hasFlying = c => /\bFlying\b/i.test((face(c).keywords || c.keywords || []).join(",")) || /^Flying\b|\nFlying\b|, Flying\b/i.test(oracle(c));
/* 除去：クリーチャー（やパーマネント）を直接どうにかする呪文・能力。だいたいの目安 */
const isRemoval = c => {
  const t = oracle(c).replace(/\([^)]*\)/g, "");
  if(isCreature(c) && !/\b(enters|when .* enters)/i.test(t)) return false;   // クリーチャーは ETB 除去だけ数える
  return /\b(destroy|exile) target (creature|permanent|nonland permanent|artifact or creature|creature or planeswalker)/i.test(t)
      || /deals? \d+ damage to (any target|target creature|target creature or planeswalker|target creature or player|each creature)/i.test(t)
      || /target creature gets [-−]\d+\/[-−]\d+/i.test(t)
      || /target creature .* (loses all abilities|can't attack or block)/i.test(t)
      || /(destroy|exile) all creatures/i.test(t)
      || /\bfight\b|\bbites?\b/i.test(t) && /target creature/i.test(t);
};
const isTrick = c => /Instant/.test(face(c).type_line || "") && /target creature (you control )?gets \+\d+\/\+\d+/i.test(oracle(c));
const isCardDraw = c => /\bdraw (a|two|three) cards?\b/i.test(oracle(c));

/* ---------- 集計 ---------- */
function profile(cards){
  const pool = cards.filter(isBooster);
  const commons = pool.filter(c => c.rarity === "common"), uncommons = pool.filter(c => c.rarity === "uncommon");
  const byColor = {};
  for(const col of COLORS){
    const colorsOf = c => (c.colors && c.colors.length ? c.colors : (face(c).colors || c.color_identity || []));
    const mono = pool.filter(c => colorsOf(c).length === 1 && colorsOf(c)[0] === col);
    const cu = mono.filter(c => ["common", "uncommon"].includes(c.rarity));
    const creatures = cu.filter(isCreature);
    const pt = creatures.map(c => [parseFloat(face(c).power), parseFloat(face(c).toughness)]).filter(([p, t]) => !isNaN(p) && !isNaN(t));
    const curve = {};
    for(const c of cu.filter(c => !isLand(c))){ const k = Math.min(7, Math.round(c.cmc ?? face(c).cmc ?? 0)); curve[k] = (curve[k] || 0) + 1; }
    byColor[col] = {
      total: mono.length, cu: cu.length,
      commons: cu.filter(c => c.rarity === "common").length,
      creatures: creatures.length, creatureShare: cu.length ? creatures.length / cu.length : 0,
      flyers: cu.filter(hasFlying).length,
      removal: cu.filter(isRemoval).length,
      tricks: cu.filter(isTrick).length,
      draw: cu.filter(isCardDraw).length,
      avgPower: pt.length ? pt.reduce((a, [p]) => a + p, 0) / pt.length : 0,
      avgToughness: pt.length ? pt.reduce((a, [, t]) => a + t, 0) / pt.length : 0,
      avgCmc: cu.length ? cu.filter(c => !isLand(c)).reduce((a, c) => a + (c.cmc ?? 0), 0) / Math.max(1, cu.filter(c => !isLand(c)).length) : 0,
      curve,
      removalCards: cu.filter(isRemoval).map(c => ({ name: c.name, rarity: c.rarity, cmc: c.cmc, id: c.id, img: (face(c).image_uris || c.image_uris || {}).normal || null })),
      flyerCards: cu.filter(hasFlying).map(c => ({ name: c.name, rarity: c.rarity, cmc: c.cmc, pt: `${face(c).power}/${face(c).toughness}` }))
    };
  }
  const colorsOf2 = c => (c.colors && c.colors.length ? c.colors : (face(c).colors || c.color_identity || []));
  const multi = pool.filter(c => colorsOf2(c).length >= 2);
  const pairs = {};
  for(const c of multi){ const k = colorsOf2(c).slice().sort().join(""); pairs[k] = (pairs[k] || 0) + 1; }
  // 2色の組み合わせ（WUBRG順の並びに）
  const order = ["WU", "UB", "BR", "RG", "GW", "WB", "UR", "BG", "RW", "GU"];
  const pairList = order.map(p => {
    const key = [...p].sort().join("");
    const cs = multi.filter(c => colorsOf2(c).slice().sort().join("") === key);
    return { pair: p, count: cs.length, uncommons: cs.filter(c => c.rarity === "uncommon").map(c => c.name) };
  });
  const allCu = pool.filter(c => ["common", "uncommon"].includes(c.rarity) && !isLand(c));
  const curveAll = {};
  for(const c of allCu){ const k = Math.min(7, Math.round(c.cmc ?? 0)); curveAll[k] = (curveAll[k] || 0) + 1; }
  const keywords = {};
  for(const c of pool) for(const k of (c.keywords || [])) keywords[k] = (keywords[k] || 0) + 1;
  const topKeywords = Object.entries(keywords).filter(([k]) => !["Flying"].includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    set: SET, setName: cards[0]?.set_name || SET, released_at: cards[0]?.released_at || null,
    counts: { total: pool.length, common: commons.length, uncommon: uncommons.length, rare: pool.filter(c => c.rarity === "rare").length, mythic: pool.filter(c => c.rarity === "mythic").length,
              creatures: pool.filter(isCreature).length, removal: allCu.filter(isRemoval).length, flyers: allCu.filter(hasFlying).length, multi: multi.length },
    byColor, pairs: pairList, curveAll, topKeywords,
    avgCmcAll: allCu.length ? allCu.reduce((a, c) => a + (c.cmc ?? 0), 0) / allCu.length : 0
  };
}

/* ---------- 文言 ---------- */
const P = {
  ja: {
    title: s => `${s} リミテッド下見｜勝率データが出る前に、セットの形を数字で見る`,
    desc: s => `マジック：ザ・ギャザリング アリーナ「${s}」のリミテッドを、勝率データが出る前にカードの枚数から読む。色ごとの除去・飛行・クリーチャーの数、マナ総量の分布。`,
    h1: s => `${s}｜リミテッド下見（データ前）`,
    lead: "勝率データは発売から2週間ほどで揃います。それまでは、セットの全カードを数えて「環境の形」を見ます。",
    when: d => `勝率データは ${d} ごろから。揃い次第、このセットの環境レポートが出ます。`,
    sumH: "ひと目でわかる",
    sum: p => `コモン・アンコモンの除去は ${p.counts.removal} 枚、飛行持ちは ${p.counts.flyers} 枚。コモン・アンコモンの平均マナ総量は ${p.avgCmcAll.toFixed(2)}。`,
    colorsH: "色ごとの中身（コモン・アンコモン）", colorsLead: "単色のコモン・アンコモンだけを数えています。除去と飛行が多い色は、序盤から主導権を取りやすい色です。",
    th: { color: "色", cards: "枚数", creatures: "クリーチャー", removal: "除去", flyers: "飛行", tricks: "コンバットトリック", draw: "ドロー", size: "平均サイズ", cmc: "平均マナ" },
    curveH: "マナ総量の分布", curveLead: "コモン・アンコモン（土地を除く）の枚数です。2〜3マナが厚い色は、序盤の展開が安定します。",
    pairsH: "2色の組み合わせ", pairsLead: "その2色の多色カード（主にアンコモン）の枚数です。多いほど、その組み合わせが「用意されている」アーキタイプです。",
    removalH: "除去の一覧（コモン・アンコモン）", removalLead: "オラクル文の型から機械的に拾っています。条件付きのものも含みます。",
    kwH: "よく出るキーワード", kwLead: "セット全体での登場回数（飛行を除く）。",
    noteH: "読み方の注意",
    note: "ここにあるのは枚数だけで、強さではありません。「除去が多い色が強い」とは限らず、環境の速さや相手の色との相性で変わります。勝率データが出たら、必ずそちらで答え合わせをしてください。",
    links: "関連ページ", linkSealed: "このセットでシールド練習", linkDraft: "このセットでドラフト練習", linkReport: "環境レポート（データが揃い次第）",
    colorName: { W: "白", U: "青", B: "黒", R: "赤", G: "緑" },
    source: "カード情報：Scryfall。集計は当サイト。",
    rarity: { common: "C", uncommon: "U", rare: "R", mythic: "M" }
  },
  en: {
    title: s => `${s} Limited preview — the shape of the set before win-rate data arrives`,
    desc: s => `A card-count look at Magic: The Gathering Arena Limited for ${s}, before win-rate data: removal, flyers and creatures by colour, and the mana-value curve.`,
    h1: s => `${s} — Limited preview (pre-data)`,
    lead: "Win-rate data lands about two weeks after release. Until then, we count every card in the set to see the shape of the format.",
    when: d => `Win-rate data from about ${d}. The full format report for this set appears as soon as it lands.`,
    sumH: "At a glance",
    sum: p => `${p.counts.removal} removal spells and ${p.counts.flyers} flyers at common and uncommon. Average mana value of commons and uncommons: ${p.avgCmcAll.toFixed(2)}.`,
    colorsH: "What each colour has (commons & uncommons)", colorsLead: "Mono-coloured commons and uncommons only. Colours with more removal and flyers tend to take the initiative early.",
    th: { color: "Colour", cards: "Cards", creatures: "Creatures", removal: "Removal", flyers: "Flyers", tricks: "Combat tricks", draw: "Card draw", size: "Avg size", cmc: "Avg MV" },
    curveH: "Mana-value curve", curveLead: "Commons and uncommons, lands excluded. A colour with a thick 2–3 drop slot curves out reliably.",
    pairsH: "Two-colour pairs", pairsLead: "Number of multicolour cards (mostly uncommons) for each pair. More cards means the pair is a supported archetype.",
    removalH: "Removal list (commons & uncommons)", removalLead: "Picked up mechanically from oracle text; conditional removal included.",
    kwH: "Frequent keywords", kwLead: "Occurrences across the whole set (flying excluded).",
    noteH: "How to read this",
    note: "These are counts, not power. A colour with the most removal is not automatically the best colour; format speed and matchups decide that. Once win-rate data lands, check it against the real numbers.",
    links: "Related pages", linkSealed: "Sealed practice with this set", linkDraft: "Draft practice with this set", linkReport: "Format report (when data lands)",
    colorName: { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" },
    source: "Card data: Scryfall. Counts by this site.",
    rarity: { common: "C", uncommon: "U", rare: "R", mythic: "M" }
  }
};
const COLOR_CSS = { W: "var(--w)", U: "var(--u)", B: "var(--b)", R: "var(--r)", G: "var(--g)" };

/* ---------- 図（インライン SVG） ---------- */
function curveSvg(byColor, lang){
  const W = 820, H = 230, L0 = 40, B = 36, top = 16;
  const xs = [0, 1, 2, 3, 4, 5, 6, 7];
  const max = Math.max(1, ...COLORS.map(c => Math.max(...xs.map(x => byColor[c].curve[x] || 0))));
  const gw = (W - L0 - 10) / xs.length, bw = (gw - 10) / COLORS.length;
  const y = v => top + (H - top - B) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${lang === "ja" ? "マナ総量ごとの枚数" : "Cards by mana value"}" style="font-family:inherit;font-size:11px">`;
  for(let v = 0; v <= max; v += Math.max(1, Math.ceil(max / 4))){ s += `<line x1="${L0}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#D3DFEB" stroke-width="1"/><text x="${L0 - 6}" y="${y(v) + 4}" text-anchor="end" fill="#5C7185">${v}</text>`; }
  xs.forEach((x, i) => {
    const gx = L0 + i * gw + 5;
    COLORS.forEach((c, j) => { const v = byColor[c].curve[x] || 0; s += `<rect x="${gx + j * bw}" y="${y(v)}" width="${bw - 1}" height="${y(0) - y(v)}" fill="${COLOR_CSS[c]}" stroke="rgba(15,28,23,.25)"/>`; });
    s += `<text x="${gx + (gw - 10) / 2}" y="${H - 12}" text-anchor="middle" fill="#5C7185">${x === 7 ? "7+" : x}</text>`;
  });
  return s + `</svg>`;
}

/* ---------- ページ ---------- */
function page(lang, p, nameJa, dataDate){
  const T = P[lang], B = L[lang];
  const name = lang === "ja" ? nameJa : p.setName;
  const canonical = `${SITE}/sets/${SET}.profile${lang === "en" ? ".en" : ""}.html`;
  const head = `<title>${esc(T.title(name))} — ${esc(B.site)}</title>
<meta name="description" content="${esc(T.desc(name))}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${SITE}/sets/${SET}.profile.html">
<link rel="alternate" hreflang="en" href="${SITE}/sets/${SET}.profile.en.html">
<meta property="og:title" content="${esc(T.title(name))}">
<meta property="og:url" content="${canonical}">`;
  const header = `    <h1>${esc(T.h1(name))}</h1>
    <p>${esc(T.lead)}</p>`;
  const row = c => { const b = p.byColor[c]; return `<tr><td><span class="dot" style="background:${COLOR_CSS[c]}"></span>${esc(T.colorName[c])}</td>
<td class="num">${b.cu}</td><td class="num">${b.creatures} <small>(${Math.round(b.creatureShare * 100)}%)</small></td><td class="num"><b>${b.removal}</b></td><td class="num"><b>${b.flyers}</b></td><td class="num">${b.tricks}</td><td class="num">${b.draw}</td><td class="num">${b.avgPower.toFixed(1)}/${b.avgToughness.toFixed(1)}</td><td class="num">${b.avgCmc.toFixed(2)}</td></tr>`; };
  const pairRows = p.pairs.map(x => `<tr><td>${[...x.pair].map(c => `<span class="dot" style="background:${COLOR_CSS[c]}"></span>`).join("")}${[...x.pair].map(c => esc(T.colorName[c])).join(lang === "ja" ? "" : "-")}</td><td class="num">${x.count}</td><td><small>${esc(x.uncommons.slice(0, 3).join(", "))}${x.uncommons.length > 3 ? "…" : ""}</small></td></tr>`).join("\n");
  const removalRows = COLORS.map(c => p.byColor[c].removalCards.map(r => `<tr><td><span class="dot" style="background:${COLOR_CSS[c]}"></span>${esc(T.colorName[c])}</td><td><span class="rar ${r.rarity}">${T.rarity[r.rarity]}</span>${esc(r.name)}</td><td class="num">${r.cmc ?? ""}</td></tr>`).join("\n")).join("\n");
  const main = `<article class="mode">
  <p class="verdict">${esc(T.when(dataDate))}</p>
  <section><h3>${esc(T.colorsH)}</h3><p class="lead">${esc(T.colorsLead)}</p>
  <div style="overflow-x:auto"><table><thead><tr><th>${esc(T.th.color)}</th><th class="num">${esc(T.th.cards)}</th><th class="num">${esc(T.th.creatures)}</th><th class="num">${esc(T.th.removal)}</th><th class="num">${esc(T.th.flyers)}</th><th class="num">${esc(T.th.tricks)}</th><th class="num">${esc(T.th.draw)}</th><th class="num">${esc(T.th.size)}</th><th class="num">${esc(T.th.cmc)}</th></tr></thead>
  <tbody>${COLORS.map(row).join("\n")}</tbody></table></div></section>
  <section><h3>${esc(T.curveH)}</h3><p class="lead">${esc(T.curveLead)}</p>${curveSvg(p.byColor, lang)}
  <p class="lead">${COLORS.map(c => `<span class="dot" style="background:${COLOR_CSS[c]}"></span>${esc(T.colorName[c])}`).join("　")}</p></section>
  <section><h3>${esc(T.removalH)}</h3><p class="lead">${esc(T.removalLead)}</p>
  <table><thead><tr><th>${esc(T.th.color)}</th><th></th><th class="num">${esc(T.th.cmc)}</th></tr></thead><tbody>${removalRows}</tbody></table></section>
  ${p.topKeywords.length ? `<section><h3>${esc(T.kwH)}</h3><p class="lead">${esc(T.kwLead)}</p><p>${p.topKeywords.map(([k, n]) => `${esc(k)} <b>${n}</b>`).join("　")}</p></section>` : ""}
  <section><h3>${esc(T.noteH)}</h3><p class="verdict">${esc(T.note)}</p></section>
</article>
<section class="links"><h3>${esc(T.links)}</h3><ul>
  <li><a href="../?set=${SET}">${esc(T.linkSealed)}</a>／<a href="../draft.html?set=${SET}">${esc(T.linkDraft)}</a></li>
  <li><a href="${SET}${lang === "en" ? ".en" : ""}.html">${esc(T.linkReport)}</a></li>
</ul></section>
<p class="source">${esc(T.source)}</p>`;
  return shell(lang, `${SET}.profile`, head, { header, main }).replace(`href="${B.otherHref(`${SET}.profile`)}"`, `href="${SET}.profile${lang === "ja" ? ".en" : ""}.html"`);
}

/* ---------- 実行 ---------- */
const cards = await fetchCards();
if(!cards.length){ console.error(`${SET}: Scryfall にカードがありません`); process.exit(1); }
const p = profile(cards);
console.error(`${SET}: Scryfall から ${cards.length} 枚（集計対象 ${p.counts.total}）。layout の内訳: ${JSON.stringify(cards.reduce((m, c) => (m[c.layout] = (m[c.layout] || 0) + 1, m), {}))}`);
if(p.counts.total < 50) console.error("::warning::集計できたカードが少なすぎます。Scryfall にまだカードが揃っていないか、絞り込みが強すぎます");
const ja = await setNamesJa();
const nameJa = ja[SET.toLowerCase()] || p.setName;
// 勝率データが出る日の目安：紙の発売日 + 12日
let dataDate = { ja: "発売2週間後", en: "two weeks after release" };
if(p.released_at){
  const d = new Date(p.released_at + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 12);
  dataDate = { ja: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`, en: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) };
}
await mkdir("data/profiles", { recursive: true });
await mkdir("sets", { recursive: true });
await writeFile(`data/profiles/${SET}.json`, JSON.stringify({ ...p, nameJa, generated_at: new Date().toISOString() }, null, 1), "utf8");
// 下見があるセットの一覧（環境レポートの選択肢に出すため）
{
  const { readdir } = await import("node:fs/promises");
  const list = [];
  for(const f of await readdir("data/profiles")){
    if(!f.endsWith(".json") || f === "index.json") continue;
    const j = await readJson(`data/profiles/${f}`, null);
    if(j) list.push({ set: f.replace(/\.json$/, ""), name: j.setName, nameJa: j.nameJa, released_at: j.released_at || null });
  }
  list.sort((a, b) => (b.released_at || "").localeCompare(a.released_at || ""));
  await writeFile("data/profiles/index.json", JSON.stringify({ profiles: list }), "utf8");
}
await writeFile(`sets/${SET}.profile.html`, page("ja", p, nameJa, dataDate.ja), "utf8");
await writeFile(`sets/${SET}.profile.en.html`, page("en", p, nameJa, dataDate.en), "utf8");
console.error(`${SET}: ${p.counts.total} 枚（C ${p.counts.common} / U ${p.counts.uncommon} / R ${p.counts.rare} / M ${p.counts.mythic}）、除去 ${p.counts.removal}、飛行 ${p.counts.flyers} → sets/${SET}.profile.html`);
