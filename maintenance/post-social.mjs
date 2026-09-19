#!/usr/bin/env node
/*
 * サイトのデータから投稿文を作り、X と Bluesky に投稿する。
 *
 *   node maintenance/post-social.mjs weekly    今週の定型投稿（週替わりで話題を回す）
 *   node maintenance/post-social.mjs monthly   月次のデータ更新の告知
 *   node maintenance/post-social.mjs announce  新セットの告知（ANNOUNCE_SETS="HOB MSH" のように渡す）
 *   node maintenance/post-social.mjs promo     ドラフト補助の紹介（動画つき・月1回を想定）
 *   node maintenance/post-social.mjs test      動作確認（短い文、URLなし）
 *
 * 環境変数
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET   … X に投稿する（無ければ X は飛ばす）
 *   BSKY_HANDLE, BSKY_APP_PASSWORD                              … Bluesky に投稿する（無ければ飛ばす）
 *   DRY_RUN=1                                                   … 投稿せず文面だけ表示する
 *   LANGS=ja,en                                                 … 投稿する言語（既定は両方）
 *   TARGETS=both / bsky / x / x-media                           … 投稿先（既定は両方）
 *        bsky    … Bluesky だけ（無料）
 *        x-media … X に動画を送るところまで試し、投稿はしない（投稿しなければ課金されない想定の確認用）
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
const TARGETS = (process.env.TARGETS || "both").trim();
const X_MEDIA_ONLY = TARGETS === "x-media";   // X は添付の送信だけ試して、投稿はしない

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
  // 英語版のカード画像が無い古い保存データは取り直す（英語の投稿に日本語版の画像が出てしまうため）
  if(!cur.names || !Object.keys(cur.names).length || cur.v !== 5 || !cur.imagesEn || !Object.keys(cur.imagesEn).length){
    const { names, images, imagesEn } = await fetchJaNames(code);
    cur.v = 5;
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
    cardImg: { ja: names.images || {}, en: names.imagesEn || {} },   // 英語は英語版の画像だけを使う（無ければ画像なしで投稿）
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
/* Bluesky は X より文字数に余裕があり、話題別のフィードがハッシュタグで投稿を拾うので、英語は #MTG も付ける */
const TAGS_BSKY = { ja: "#MTGアリーナ #MTGA", en: "#MTGArena #MTGLimited #MTG" };
const tagsFor = (lang, track) => (track === "bsky" ? TAGS_BSKY : TAGS)[lang];

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
  lines.push("", url, tagsFor(lang, track));
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
    "", url, tagsFor(lang, track)
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
  lines.push(url, tagsFor(lang, track));
  return { text: fit(lines), cards: top };
}

/* ---------- 紹介投稿（ドラフト補助の動画つき） ---------- */
const PROMO = {
  file: lang => `media/pick-support-${lang}.mp4`,
  size: { width: 1920, height: 1080 },
  text: {
    ja: [
      "MTGアリーナのドラフト中に、17Landsの勝率データから次のピックを理由つきで提案する「ドラフト補助」です。",
      "",
      "いま向かっている色、環境で強い2色、部族シナジーも見て選びます。無料・登録不要、ブラウザだけで動きます。",
      "",
      `${SITE}/assistant.html?from=promo`
    ],
    en: [
      "Draft pick support for MTG Arena: it suggests your next pick from 17Lands win-rate data, and tells you why.",
      "",
      "It weighs your current colours, the format's best pairs and tribal synergies. Free, no sign-up.",
      "",
      `${SITE}/assistant.html?from=promo`
    ]
  },
  alt: {
    ja: "MTGアリーナのドラフト画面の横に、次のピックのおすすめと勝率、選んだ理由が表示されている様子",
    en: "An MTG Arena draft screen with a side panel showing the recommended pick, its win rate and the reasoning behind it"
  }
};
async function promoPost(lang, track){
  const lines = [...PROMO.text[lang], tagsFor(lang, track)];
  return { text: fit(lines), cards: [] };
}
/* 毎月同じファイルを送ると「同じ動画がもう有る」と断られることがあるので、
   MP4 の末尾に「free」箱（読み飛ばされる余白）を足して、実行ごとに別のファイルにする。
   映像や音声には一切触れないので、見え方は変わらない。 */
function stampVideo(buf){
  const note = Buffer.from(`sealed-workbench ${new Date().toISOString()}`, "utf8");
  const box = Buffer.alloc(8 + note.length);
  box.writeUInt32BE(box.length, 0);
  box.write("free", 4, "ascii");
  note.copy(box, 8);
  return Buffer.concat([buf, box]);
}
/* 紹介用の動画を読み込む。無ければ null（文面だけの投稿はしない） */
async function loadPromoVideo(lang){
  const path = PROMO.file(lang);
  let raw;
  try{ raw = await readFile(path); }
  catch(e){ console.log(`動画 ${path} が見つかりません`); return null; }
  const buf = stampVideo(raw);
  buf.meta = { kind: "video", name: `pick-support-${lang}.mp4`, width: PROMO.size.width, height: PROMO.size.height, alt: PROMO.alt[lang] };
  return buf;
}

/* ---------- 画像：上位3枚のカードを横に並べる ---------- */
async function composeImage(ctx, cards, lang){
  const bank = ctx.cardImg[lang] || ctx.cardImg.en || {};
  const picked = cards.map(c => ({ card: c, url: bank[c.name] || bank[String(c.name).split(" // ")[0]] }))
                      .filter(x => x.url).slice(0, 5);
  const urls = picked.map(x => x.url);
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
  const layers = [], shown = [];
  for(let i = 0; i < urls.length; i++){
    try{
      const r = await fetch(urls[i], { headers: SCRY_HEADERS });
      if(!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const img = await sharp(buf).resize(cardW, cardH, { fit: "cover" }).png().toBuffer();
      layers.push({ input: img, left: gap + i * (cardW + gap), top });
      shown.push(picked[i].card);
    }catch(e){}
    await sleep(120);
  }
  if(!layers.length) return null;
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: "#23342E" } })
    .composite(layers).jpeg({ quality: 88 }).toBuffer();
  // Bluesky は縦横比を伝えないと、縦長の枠に収めようとして上下に大きな余白が付く。
  // 実際に並んだカードから画像の説明文（代替テキスト）も作る。
  out.meta = {
    kind: "image", width: W, height: H,
    alt: (lang === "ja" ? "カード：" : "Cards: ") + shown.map(c => cardName(ctx, lang, c.name)).join(lang === "ja" ? "／" : ", ")
  };
  return out;
}

/* ---------- X ---------- */
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method, url){
  const K = process.env.X_API_KEY, S = process.env.X_API_SECRET, T = process.env.X_ACCESS_TOKEN, TS = process.env.X_ACCESS_SECRET;
  const p = { oauth_consumer_key: K, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
              oauth_timestamp: Math.floor(Date.now() / 1000).toString(), oauth_token: T, oauth_version: "1.0" };
  // 署名は「クエリを外したURL」と「クエリ＋oauth項目をまとめて並べたもの」から作る決まり。
  // 見出しに入れるのは oauth 項目だけ。
  const u = new URL(url);
  const all = { ...p };
  u.searchParams.forEach((v, k) => { all[k] = v; });
  const norm = Object.keys(all).sort().map(k => `${enc(k)}=${enc(all[k])}`).join("&");
  const base = [method, enc(u.origin + u.pathname), enc(norm)].join("&");
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
/* 動画は一度に送れないので、初期化 → 分割送信 → 確定 → 変換待ち、の順で進める */
async function uploadXVideo(buf){
  const root = "https://api.x.com/2/media/upload";
  const call = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, headers: { Authorization: oauthHeader(opt.method || "GET", url), ...(opt.headers || {}) } });
    const body = await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : {};
  };
  // 初期化
  const init = await call(`${root}/initialize`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "video/mp4", total_bytes: buf.length, media_category: "tweet_video" })
  });
  const id = init.data?.id || init.data?.media_id_string || init.id || init.media_id_string;
  if(!id) throw new Error("media_id が返りませんでした: " + JSON.stringify(init).slice(0, 200));
  // 分割して送る（1片 4MB）
  const CHUNK = 4 * 1024 * 1024;
  for(let i = 0, off = 0; off < buf.length; i++, off += CHUNK){
    const part = buf.subarray(off, Math.min(off + CHUNK, buf.length));
    const form = new FormData();
    form.append("segment_index", String(i));
    form.append("media", new Blob([part], { type: "application/octet-stream" }), "chunk");
    await call(`${root}/${id}/append`, { method: "POST", body: form });
    console.log(`X 動画: ${Math.min(off + CHUNK, buf.length)} / ${buf.length} バイト送信`);
  }
  // 確定
  let info = (await call(`${root}/${id}/finalize`, { method: "POST" }));
  let st = info.data?.processing_info || info.processing_info;
  // 変換待ち
  for(let n = 0; st && st.state !== "succeeded" && n < 40; n++){
    if(st.state === "failed") throw new Error("変換に失敗しました: " + JSON.stringify(st).slice(0, 200));
    await sleep((st.check_after_secs || 3) * 1000);
    const s2 = await call(`${root}?command=STATUS&media_id=${encodeURIComponent(id)}`);
    st = s2.data?.processing_info || s2.processing_info;
    console.log(`X 動画: 変換 ${st ? st.state : "完了"}`);
  }
  if(st && st.state !== "succeeded") throw new Error("変換が終わりませんでした");
  return id;
}
async function postX(text, image){
  if(!process.env.X_API_KEY || !process.env.X_ACCESS_TOKEN) return "X: 鍵が無いので飛ばしました";
  const url = "https://api.x.com/2/tweets";
  const payload = { text };
  if(image){
    const isVideo = image.meta && image.meta.kind === "video";
    let id = null;
    if(isVideo){ id = await uploadXVideo(image); }   // 動画は失敗したら投稿ごと中止する（文面だけ出ても意味がないため）
    else id = await uploadXImage(image);
    if(id) payload.media = { media_ids: [String(id)] };
    else console.log("X: 画像は添付せずに投稿します");
    if(X_MEDIA_ONLY) return `X: 添付の送信まで成功しました（media_id ${id}）。投稿はしていません`;
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
/* Bluesky の動画は、専用の受け口に預けてから変換の完了を待つ */
async function uploadBskyVideo(session, buf, name){
  const base = "https://bsky.social/xrpc";
  // 預け先（自分のデータの置き場所）を調べる
  let pds = "bsky.social";
  try{
    const svc = (session.didDoc?.service || []).find(x => String(x.id).endsWith("atproto_pds"));
    if(svc?.serviceEndpoint) pds = new URL(svc.serviceEndpoint).hostname;
  }catch(e){}
  // 動画の受け口に渡すための、期限つきの合い鍵をもらう
  const exp = Math.floor(Date.now() / 1000) + 60 * 30;
  const sa = await fetch(`${base}/com.atproto.server.getServiceAuth?aud=${encodeURIComponent("did:web:" + pds)}&lxm=com.atproto.repo.uploadBlob&exp=${exp}`,
    { headers: { Authorization: `Bearer ${session.accessJwt}` } });
  if(!sa.ok) throw new Error(`合い鍵の取得 HTTP ${sa.status}: ${(await sa.text()).slice(0, 200)}`);
  const token = (await sa.json()).token;

  const vbase = "https://video.bsky.app/xrpc";
  const up = await fetch(`${vbase}/app.bsky.video.uploadVideo?did=${encodeURIComponent(session.did)}&name=${encodeURIComponent(name)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(buf.length) }, body: buf });
  const upBody = await up.text();
  if(!up.ok) throw new Error(`動画の送信 HTTP ${up.status}: ${upBody.slice(0, 300)}`);
  // 送信したときは中身がそのまま、確認したときは jobStatus に包まれて返ってくるので、どちらでも読めるようにする
  const readJob = (body) => { const j = JSON.parse(body); return j.jobStatus || j; };
  let job = readJob(upBody);
  if(job.error) throw new Error(`動画の受け付けで断られました: ${job.error}${job.message ? " — " + job.message : ""}`);
  if(!job.blob && !job.jobId) throw new Error("受け付け番号が取れませんでした: " + upBody.slice(0, 300));

  // 変換待ち
  for(let n = 0; !job.blob && n < 60; n++){
    if(job.state === "JOB_STATE_FAILED") throw new Error("変換に失敗しました: " + (job.error || JSON.stringify(job).slice(0, 200)));
    await sleep(2000);
    const r = await fetch(`${vbase}/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(job.jobId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.text();
    if(!r.ok) throw new Error(`変換の確認 HTTP ${r.status}: ${body.slice(0, 200)}`);
    const next = readJob(body);
    if(!next.jobId && job.jobId) next.jobId = job.jobId;   // 番号が省かれて返ることがあるので引き継ぐ
    job = next;
    console.log(`Bluesky 動画: ${job.state || "変換中"}${job.progress != null ? " " + job.progress + "%" : ""}`);
  }
  if(!job.blob) throw new Error("変換が終わりませんでした");
  return job.blob;
}
async function postBsky(text, image, lang){
  const H = process.env.BSKY_HANDLE, P = process.env.BSKY_APP_PASSWORD;
  if(!H || !P) return "Bluesky: 鍵が無いので飛ばしました";
  const base = "https://bsky.social/xrpc";
  const s = await fetch(`${base}/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: H, password: P }) });
  if(!s.ok) throw new Error(`Bluesky login HTTP ${s.status}: ${await s.text()}`);
  const session = await s.json();
  // 箇条書きの「・」は片仮名の記号なので、文面から言語を当てると英語の投稿まで日本語になってしまう。
  // 組み立てたときの言語を使い、渡されていないときだけ文面から判断する。
  const detected = /[\u3040-\u309F\u30A1-\u30FA\u4E00-\u9FFF]/.test(text) ? "ja" : "en";
  const record = { $type: "app.bsky.feed.post", text, facets: bskyFacets(text), createdAt: new Date().toISOString(), langs: [lang || detected] };
  const m = (image && image.meta) || {};
  if(image && m.kind === "video"){
    // 動画は添付できなければ投稿ごと中止する（文面だけ流れても宣伝にならないため）
    const blob = await uploadBskyVideo(session, image, m.name || "video.mp4");
    record.embed = { $type: "app.bsky.embed.video", video: blob, alt: m.alt || "" };
    if(m.width && m.height) record.embed.aspectRatio = { width: m.width, height: m.height };
  }else if(image){
    try{
      const up = await fetch(`${base}/com.atproto.repo.uploadBlob`, { method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${session.accessJwt}` }, body: image });
      if(up.ok){
        const blob = (await up.json()).blob;
        const img = { image: blob, alt: m.alt || "" };
        if(m.width && m.height) img.aspectRatio = { width: m.width, height: m.height };
        record.embed = { $type: "app.bsky.embed.images", images: [img] };
      }
      else console.log("Bluesky: 画像は添付せずに投稿します");
    }catch(e){ console.log("Bluesky 画像: " + e.message); }
  }
  const r = await fetch(`${base}/com.atproto.repo.createRecord`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }) });
  if(!r.ok) throw new Error(`Bluesky HTTP ${r.status}: ${await r.text()}`);
  return "Bluesky: 投稿しました";
}

/* ---------- 本体 ---------- */
async function send(label, textX, textBsky, image, lang){
  console.log(`\n--- ${label} ---`);
  console.log(textX);
  if(textBsky && textBsky !== textX) console.log(`（Bluesky 版）\n${textBsky}`);
  const kind = image && image.meta && image.meta.kind === "video" ? "動画" : "画像";
  console.log(`（X換算 ${xLength(textX)} 文字／${kind} ${image ? Math.round(image.length / 1024) + "KB" : "なし"}）`);
  if(DRY){
    if(image && kind === "画像"){ await writeFile(`social-preview-${label.replace(/\s+/g, "-")}.jpg`, image); console.log("画像を social-preview-*.jpg に保存しました"); }
    if(image && kind === "動画") console.log(`動画 ${image.meta.name} を添付します（説明文：${image.meta.alt}）`);
    console.log("DRY_RUN のため投稿しません"); return;
  }
  for(const [name, fn, text] of [["X", postX, textX], ["Bluesky", postBsky, textBsky]]){
    if(TARGETS === "bsky" && name === "X"){ console.log("X: 投稿先の指定により飛ばしました"); continue; }
    if((TARGETS === "x" || X_MEDIA_ONLY) && name === "Bluesky"){ console.log("Bluesky: 投稿先の指定により飛ばしました"); continue; }
    try{ console.log(await fn(text, image, lang)); }
    catch(e){ console.error(`${name}: 失敗 — ${e.message}`); process.exitCode = 1; }
  }
}

async function main(){
  if(mode === "promo"){
    for(const lang of LANGS){
      const video = await loadPromoVideo(lang);
      if(!video){ console.log(`${lang}: 動画が無いので飛ばしました`); continue; }
      const px = await promoPost(lang, "x"), pb = await promoPost(lang, "bsky");
      await send(`promo ${lang}`, px.text, pb.text, video, lang);
    }
    return;
  }
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
      await send(`${mode} ${code} ${lang}`, px.text, pb.text, image, lang);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
