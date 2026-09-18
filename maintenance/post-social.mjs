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
 *   LANGS=ja,en                                                 … 投稿する言語（既定は両方）
 *
 * 投稿の考え方
 *   ・自分のアカウントに、自分のデータから作った内容を、決まった頻度で出すだけ。返信や他人への働きかけはしない。
 *   ・X は文字数に上限があり、日本語は1文字が2文字分に数えられる。URL は一律 23 文字分。
 *   ・URL を含む投稿は X の従量課金で高め（1件 $0.20）なので、1回の実行で言語ごとに1件ずつに抑える。
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import crypto from "node:crypto";

// Scryfall は送信元を名乗らないアクセスを拒否するので、必ずこのヘッダーを付ける
const SCRY_HEADERS = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" };

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const DRY = process.env.DRY_RUN === "1";
const LANGS = (process.env.LANGS || "ja,en").split(",").map(s => s.trim()).filter(Boolean);
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

async function ensureNames(code){
  const path = `data/names/${code}.json`;
  let cur = await readJson(path, null) || { names: {}, set: "", released_at: "" };
  let changed = false;
  if(!cur.set || cur.set === code){
    try{ const r = await fetch(`https://api.scryfall.com/sets/${code.toLowerCase()}`, { headers: SCRY_HEADERS }); if(r.ok){ const j = await r.json(); cur.set = j.name; cur.released_at = j.released_at; changed = true; } }catch(e){}
  }
  if(!cur.names || !Object.keys(cur.names).length || cur.v !== 4){
    const { names, images, imagesEn } = await fetchJaNames(code);
    cur.v = 4;
    if(Object.keys(names).length){ cur.names = names; cur.images = images; cur.imagesEn = imagesEn; changed = true; }
  }
  if(changed){ try{ await (await import("node:fs/promises")).mkdir("data/names", { recursive: true }); await writeFile(path, JSON.stringify(cur), "utf8"); }catch(e){} }
  console.log(`${code}: 日本語名 ${Object.keys(cur.names || {}).length}件 / セット名 ${cur.set || "(不明)"}`);
  return cur;
}

async function setContext(code){
  const ja = await setNamesJa();
  const names = await ensureNames(code);
  const draft = await readJson(`data/articles/${code}_draft.json`, null);
  const sealed = await readJson(`data/articles/${code}_sealed.json`, null);
  return {
    code,
    name: { ja: ja[code.toLowerCase()] || names.set || code, en: names.set || code },
    cardJa: names.names || {},
    cardImg: { ja: names.images || {}, en: names.imagesEn || names.images || {} },
    draft, sealed,
    url: lang => `${SITE}/sets/${code}${lang === "en" ? ".en" : ""}.html`
  };
}

/* ---------- 文字数（X の数え方） ---------- */
function xLength(text){
  // URL は 23、全角（CJK など）は 2、それ以外は 1
  let n = 0;
  const parts = text.split(/(https?:\/\/\S+)/);
  for(const p of parts){
    if(/^https?:\/\//.test(p)) n += 23;
    else for(const ch of p) n += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return n;
}
/* 上限に収まるまで、印のついた行から順に落とす */
function fit(lines, limit = 280){
  let out = lines.slice();
  const join = arr => arr.filter(l => l != null).map(l => l.replace(/^~/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  while(xLength(join(out)) > limit){
    const i = out.map((l, k) => [l, k]).reverse().find(([l]) => typeof l === "string" && l.startsWith("~"));
    if(!i) break;
    out.splice(i[1], 1);
  }
  return join(out);
}
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
    lines.push("", L ? "~GIH勝率＝そのカードが手札か戦場にあった試合の勝率（17Lands公開データを集計）" : "~GIH = games-in-hand win rate, from 17Lands public data");
  }else if(theme === 2){
    const rows = (d.archetypes || []).filter(a => a.games >= 2000 && a.colors.length === 2).sort((a, b) => b.wr - a.wr).slice(0, 5);
    const head = L ? `【${nm} ドラフト】勝率の高い色の組み合わせ` : `${nm} Draft — best colour pairs by win rate`;
    lines = [head, ""];
    rows.forEach((a, i) => lines.push(`~${i + 1}. ${a.colors.split("").map(k => COLOR[lang][k]).join(L ? "" : "")} ${pct(a.wr)}`));
    lines.push("", L ? "~2,000試合以上の組み合わせから。全体平均は" + pct(d.overall_win_rate) : "~Pairs with 2,000+ games. Format average " + pct(d.overall_win_rate));
  }else{
    const best = (d.speed || []).filter(s => s.wr != null).sort((a, b) => b.wr - a.wr)[0];
    const label = { fast: L ? "速い（平均マナ総量2.9未満）" : "fast (avg. MV under 2.9)", mid: L ? "中速（3.2未満）" : "midrange (under 3.2)", slow: L ? "遅い（3.5未満）" : "slow (under 3.5)", slower: L ? "かなり遅い（3.5以上）" : "very slow (3.5+)" }[best?.key] || "";
    const head = L ? `【${nm} ドラフト】環境の速さ` : `${nm} Draft — format speed`;
    lines = [head, ""];
    if(best) lines.push(L ? `最も勝率の高いデッキは${label}で ${pct(best.wr)}` : `Best-performing decks are ${label} at ${pct(best.wr)}`);
    const rares = topBy(d, "rare", 10).concat(topBy(d, "mythic", 10)).sort((a, b) => b.gih - a.gih).slice(0, 3);
    picCards = rares;
    if(rares.length){ lines.push("", L ? "~レア・神話レアの勝率トップ3" : "~Top 3 rares & mythics by win rate"); rares.forEach(c => lines.push(`~・${cardLabel(ctx, lang, c.name)} ${pct(c.gih)}`)); }
  }
  lines.push("", url, TAGS[lang]);
  return { text: fit(lines), cards: picCards };
}

function monthlyPost(ctx, lang, track){
  const nm = ctx.name[lang], url = ctx.url(lang) + `?from=${track}`;
  const L = lang === "ja";
  const games = (ctx.draft?.total_games || 0) + (ctx.sealed?.total_games || 0);
  const lines = [
    L ? `【データ更新】${nm} の勝率データを更新しました` : `Data update: ${nm} win rates refreshed`,
    "",
    L ? `ドラフト・シールドあわせて ${games.toLocaleString()}試合分（17Lands公開データ）。カード勝率一覧と環境レポート、ドラフト補助に反映済みです。`
      : `${games.toLocaleString()} games across Draft and Sealed (17Lands public data). Card win rates, set reports and the draft assistant are all updated.`,
    "", url, TAGS[lang]
  ];
  return { text: fit(lines), cards: [] };
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
    L ? `${games.toLocaleString()}試合分の実戦データから、カード勝率・環境レポート・ドラフト補助が使えます。` : `Card win rates, a format report and the draft assistant, built from ${games.toLocaleString()} games.`,
    ""
  ];
  if(top.length){ lines.push(L ? "~いまのレア・神話レアのトップ3：" : "~Top rares & mythics so far:"); top.forEach(c => lines.push(`~・${cardLabel(ctx, lang, c.name)} ${pct(c.gih)}`)); lines.push(""); }
  lines.push(url, TAGS[lang]);
  return { text: fit(lines), cards: top };
}

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
  return sharp({ create: { width: W, height: H, channels: 3, background: "#23342E" } })
    .composite(layers).jpeg({ quality: 88 }).toBuffer();
}

/* ---------- X ---------- */
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method, url){
  const K = process.env.X_API_KEY, S = process.env.X_API_SECRET, T = process.env.X_ACCESS_TOKEN, TS = process.env.X_ACCESS_SECRET;
  const p = { oauth_consumer_key: K, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
              oauth_timestamp: Math.floor(Date.now() / 1000).toString(), oauth_token: T, oauth_version: "1.0" };
  const norm = Object.keys(p).sort().map(k => `${enc(k)}=${enc(p[k])}`).join("&");
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
async function postX(text, image){
  if(!process.env.X_API_KEY || !process.env.X_ACCESS_TOKEN) return "X: 鍵が無いので飛ばしました";
  const url = "https://api.x.com/2/tweets";
  const payload = { text };
  if(image){
    const id = await uploadXImage(image);
    if(id) payload.media = { media_ids: [String(id)] }; else console.log("X: 画像は添付せずに投稿します");
  }
  const r = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await r.text();
  if(!r.ok) throw new Error(`X HTTP ${r.status}: ${body}`);
  const id = JSON.parse(body)?.data?.id;
  return `X: 投稿しました${id ? " (id " + id + ")" : ""}`;
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
async function postBsky(text, image){
  const H = process.env.BSKY_HANDLE, P = process.env.BSKY_APP_PASSWORD;
  if(!H || !P) return "Bluesky: 鍵が無いので飛ばしました";
  const base = "https://bsky.social/xrpc";
  const s = await fetch(`${base}/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: H, password: P }) });
  if(!s.ok) throw new Error(`Bluesky login HTTP ${s.status}: ${await s.text()}`);
  const session = await s.json();
  const record = { $type: "app.bsky.feed.post", text, facets: bskyFacets(text), createdAt: new Date().toISOString(), langs: [/[\u3040-\u30FF\u4E00-\u9FFF]/.test(text) ? "ja" : "en"] };
  if(image){
    try{
      const up = await fetch(`${base}/com.atproto.repo.uploadBlob`, { method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${session.accessJwt}` }, body: image });
      if(up.ok){ const blob = (await up.json()).blob; record.embed = { $type: "app.bsky.embed.images", images: [{ image: blob, alt: "Top cards" }] }; }
      else console.log("Bluesky: 画像は添付せずに投稿します");
    }catch(e){ console.log("Bluesky 画像: " + e.message); }
  }
  const r = await fetch(`${base}/com.atproto.repo.createRecord`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }) });
  if(!r.ok) throw new Error(`Bluesky HTTP ${r.status}: ${await r.text()}`);
  return "Bluesky: 投稿しました";
}

/* ---------- 本体 ---------- */
async function send(label, textX, textBsky, image){
  console.log(`\n--- ${label} ---`);
  console.log(textX);
  console.log(`（X換算 ${xLength(textX)} 文字／画像 ${image ? Math.round(image.length / 1024) + "KB" : "なし"}）`);
  if(DRY){
    if(image){ await writeFile(`social-preview-${label.replace(/\s+/g, "-")}.jpg`, image); console.log("画像を social-preview-*.jpg に保存しました"); }
    console.log("DRY_RUN のため投稿しません"); return;
  }
  for(const [name, fn, text] of [["X", postX, textX], ["Bluesky", postBsky, textBsky]]){
    try{ console.log(await fn(text, image)); }
    catch(e){ console.error(`${name}: 失敗 — ${e.message}`); process.exitCode = 1; }
  }
}

async function main(){
  if(mode === "test"){
    const text = "テスト投稿です。自動投稿の動作確認をしています。";
    await send("test", text, text);
    return;
  }
  const sets = mode === "announce" ? (process.env.ANNOUNCE_SETS || "").split(/\s+/).filter(Boolean) : [await latestSet()].filter(Boolean);
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
      else { px = announcePost(ctx, lang, "x"); pb = announcePost(ctx, lang, "bsky"); }
      if(!px){ console.log(`${code}/${lang}: データが無いので飛ばしました`); continue; }
      // 画像は投稿の言語に合わせる（日本語版・英語版のカード画像）。枚数は本文のリストと同じ
      const image = (px.cards || []).length ? await composeImage(ctx, px.cards, lang) : null;
      await send(`${mode} ${code} ${lang}`, px.text, pb.text, image);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
