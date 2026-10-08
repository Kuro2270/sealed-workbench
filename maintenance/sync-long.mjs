#!/usr/bin/env node
/*
 * YouTube で「公開」になった長尺の環境まとめ動画を見つけて、data/long.json に自動で登録する（日本語・英語）。
 *
 *   node maintenance/sync-long.mjs                       … チャンネルの最近の動画から、公開になった長尺を探して登録
 *   LONG_SET=TMT LONG_VIDEO_ID=xxxx node maintenance/sync-long.mjs   … セットと動画IDを指定して登録
 *
 * 見つけ方: 公開（public）／題に「環境まとめ」を含む／2分以上／「#Shorts」でない。
 *           題の【…】の中身（セット名）を、サイトのセット名（日本語・短縮）と照らして、セットコードを決める。
 * 登録するもの: 動画ID・題・公開日・長さ・目次（概要欄の「0:00 はじめに」の行）。
 * 登録した動画には、「お気に入りのカードやコンボをコメントで教えてください」という呼びかけのコメントを1件付ける（ショートと同じ文面）。
 *   付けたら long.json の comment2 を true にして、2回目以降は付けない。コメントの権限（force-ssl）が無いときは、文面をログに出すだけで続ける。
 * すでに同じ動画IDが登録済みなら、登録は何もしない。同じセットに別の動画が登録済みなら、新しく公開されたほうに置き換える。
 * 非公開のままの動画は登録しない（サイトには出ない）。
 *
 * 英語版: 英語チャンネル（YT_REFRESH_TOKEN_EN）の最近の動画から、題に「Limited Review」を含む長尺を探す（題は「[MTG Arena] <セット名> Limited Review | …」）。
 *   登録先は data/long.json の <SET>.en。許可が無い言語は飛ばす（LONG_LANGS=ja や en で、片方だけにもできる）。
 *
 * 必要な環境変数: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN_JA（英語は YT_REFRESH_TOKEN_EN）
 * セット別ページの作り直しとコミットは、呼び出し側（workflow）で行う。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";

const API = process.env.YT_API || "https://www.googleapis.com";
const OAUTH = process.env.YT_OAUTH || "https://oauth2.googleapis.com/token";
const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET;
const ONLY_SET = (process.env.LONG_SET || "").trim().toUpperCase(), ONLY_ID = (process.env.LONG_VIDEO_ID || "").trim();
const ONLY_LANG = (process.env.LONG_LANG || "").trim().toLowerCase();       // 動画IDを指定するときの言語（省略は ja）
const LANGS = (process.env.LONG_LANGS || "ja,en").split(",").map(x => x.trim().toLowerCase()).filter(x => x === "ja" || x === "en");
const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch(e){ return f; } };

if(!ID || !SECRET){ console.error("YT_CLIENT_ID / YT_CLIENT_SECRET が設定されていません。"); process.exit(1); }
async function tokenFor(lang){
  let refresh = process.env[`YT_REFRESH_TOKEN_${lang.toUpperCase()}`];
  if(!refresh){ console.log(`${lang}: YT_REFRESH_TOKEN_${lang.toUpperCase()} が無いので飛ばします。`); return null; }
  /* 貼り付け時に混ざりやすい「REFRESH_TOKEN=」・引用符・空白・改行を取り除く */
  refresh = refresh.replace(/^\s*(?:YT_)?REFRESH_TOKEN\s*[:=]\s*/i, "").replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  const tr = await fetch(OAUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, refresh_token: refresh, grant_type: "refresh_token" }) });
  const j = await tr.json().catch(() => ({}));
  const token = j.access_token;
  if(!token){ console.error(`${lang}: YouTube のアクセストークンを取れませんでした（HTTP ${tr.status}: ${j.error || ""} ${j.error_description || ""}）。トークン${refresh.length}文字、先頭${refresh.slice(0, 6)}…`); return null; }
  /* 診断：このトークンが誰のどの許可か（トークン自体は表示しない） */
  console.log(`${lang}: 更新応答 HTTP ${tr.status} ／ 項目: ${Object.keys(j).join(",")} ／ トークン${token.length}文字（${token.slice(0, 4)}…）／ 更新用トークン${refresh.length}文字（${refresh.slice(0, 3)}…${refresh.slice(-2)}）`);
  try{
    const tir = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    const ti = await tir.json().catch(() => ({}));
    const sc = String(ti.scope || "").split(" ").map(x => x.replace("https://www.googleapis.com/auth/", "")).join(", ");
    console.log(`${lang}: tokeninfo HTTP ${tir.status} ／ 許可: ${sc || "不明"} ／ 残り${ti.expires_in || "?"}秒 ／ ${ti.error_description || "有効"}`);
  }catch(e){ console.log(`${lang}: 診断は取れませんでした（${e.message}）`); }
  return token;
}

/* セット名 → セットコード。日本語は（日本語・短縮）の名前、英語は data/names の英語名。publish-videos.mjs / build-long.mjs と同じ決め方 */
const shortName = n => { const m = String(n).replace(/^Magic:\s*The Gathering\s*[:|｜-]?\s*/i, "").split(/\s*[｜|]\s*/); return (m[m.length - 1] || "").trim() || String(n); };
const norm = s => String(s).replace(/[\s　・:：'’]/g, "").toLowerCase();
async function setNameMap(lang){
  const map = {};
  let ja = {};
  if(lang === "ja"){ try{ const m = (await readFile("i18n.js", "utf8")).match(/const SET_JA = (\{[\s\S]*?\});/); if(m) ja = new Function("return " + m[1])(); }catch(e){} }
  const codes = new Set(Object.keys(ja).map(c => c.toUpperCase()));
  for(const f of await readdir("data/names").catch(() => [])) if(f.endsWith(".json")) codes.add(f.replace(/\.json$/, "").toUpperCase());
  for(const c of codes){
    let n = lang === "ja" ? ja[c.toLowerCase()] : null;
    if(!n){ const nm = await readJson(`data/names/${c}.json`, null); n = nm && nm.set; }
    if(n) map[norm(shortName(n))] = c;
  }
  return map;
}

const isoSec = d => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ""); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const chaptersOf = desc => String(desc || "").split("\n").map(l => l.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/)).filter(Boolean)
  .map(m => ({ at: (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], title: m[4].trim() }));

/* 言語ごとの決まり */
const CFG = {
  ja: {
    isLong: t => /環境まとめ/.test(t),
    setOf: t => { const b = String(t).match(/【(.+?)】/); return b ? b[1] : ""; },
    callKey: "お気に入りのカードや、うまくいったコンボ",
    callText: name => `最後までご視聴いただき、ありがとうございました。\n${name ? name + "の" : ""}ドラフトやシールドで、お気に入りのカードや、うまくいったコンボはありますか？\n「このカードが思った以上に強かった」「この組み合わせで勝てた」など、一言だけでも大丈夫です。ぜひコメントで教えてください。`
  },
  en: {
    isLong: t => /Limited Review/i.test(t),
    setOf: t => { const b = String(t).match(/^\[MTG Arena\]\s*(.+?)\s+Limited Review/i); return b ? b[1] : ""; },
    callKey: "favorite card or a combo that worked well",
    callText: name => `Thanks for watching to the end!\nDo you have a favorite card or a combo that worked well in ${name ? name + " " : ""}Draft or Sealed?\nEven a short comment like "this card was way better than expected" or "this pair won me games" is welcome. Let us know in the comments!`
  }
};

const long = await readJson("data/long.json", {});
let changed = 0, anyLang = false;

async function syncLang(lang){
  const token = await tokenFor(lang);
  if(!token) return;
  anyLang = true;
  const cfg = CFG[lang];
  const yt = async path => {
    const r = await fetch(`${API}/youtube/v3/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(`HTTP ${r.status} ${path.split("?")[0]}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
    return j;
  };
  let ids;
  if(ONLY_ID) ids = [ONLY_ID];
  else{
    const ch = await yt("channels?part=contentDetails&mine=true");
    const up = ch.items && ch.items[0] && ch.items[0].contentDetails.relatedPlaylists.uploads;
    if(!up){ console.error(`${lang}: アップロード一覧を取れませんでした。`); return; }
    const pl = await yt(`playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(up)}`);
    ids = (pl.items || []).map(i => i.contentDetails.videoId);
  }
  if(!ids.length){ console.log(`${lang}: 動画がありません。`); return; }
  const vs = (await yt(`videos?part=snippet,status,contentDetails&id=${ids.slice(0, 50).map(encodeURIComponent).join(",")}`)).items || [];
  const names = await setNameMap(lang);

  for(const v of vs.sort((a, b) => String(a.snippet.publishedAt).localeCompare(String(b.snippet.publishedAt)))){
    const title = v.snippet.title || "";
    const manual = !!ONLY_ID;
    if(!manual && !(cfg.isLong(title) && !/#shorts/i.test(title) && isoSec(v.contentDetails.duration) >= 120)) continue;
    if(v.status.privacyStatus !== "public"){ console.log(`${lang}: まだ公開ではありません（${v.status.privacyStatus}）: ${title} [${v.id}]`); continue; }
    let set = ONLY_SET;
    if(!set){ const b = cfg.setOf(title); set = b ? names[norm(b)] : ""; }
    if(!set){ console.log(`${lang}: セットを決められませんでした: ${title}（LONG_SET で指定できます）`); continue; }
    const cur = long[set] && long[set][lang];
    if(cur && cur.id === v.id){ console.log(`登録済み: ${set} ${lang} ${v.id}`); continue; }
    if(cur && !manual && String(cur.uploadedAt) > String(v.snippet.publishedAt).slice(0, 10)){ console.log(`${set} (${lang}) は、より新しい動画が登録済みなので飛ばします: ${v.id}`); continue; }
    long[set] = { ...(long[set] || {}), [lang]: { id: v.id, title, uploadedAt: String(v.snippet.publishedAt).slice(0, 10), duration: v.contentDetails.duration, chapters: chaptersOf(v.snippet.description) } };
    console.log(`登録しました: ${set} ${lang} ${v.id}（目次 ${long[set][lang].chapters.length} 件）${title}`);
    changed++;
  }

  /* この動画に、呼びかけのコメントがすでにあるか。あれば true、無ければ false、一覧を読めなければ null。
     文面の決まった部分で判定するので、手で付けたものも見つかる */
  async function hasCall(videoId){
    try{
      let page = "";
      for(let i = 0; i < 3; i++){
        const j = await yt(`commentThreads?part=snippet&maxResults=100&order=time&textFormat=plainText&videoId=${encodeURIComponent(videoId)}${page}`);
        if((j.items || []).some(t => String(((t.snippet || {}).topLevelComment || {}).snippet && t.snippet.topLevelComment.snippet.textOriginal || "").includes(cfg.callKey))) return true;
        if(!j.nextPageToken) return false;
        page = `&pageToken=${encodeURIComponent(j.nextPageToken)}`;
      }
      return false;
    }catch(e){ return null; }
  }
  const titleName = t => { const b = cfg.setOf(t); return b ? b.trim() : ""; };

  /* 呼びかけのコメント（まだ付けていない登録済みの長尺すべて）。コメントが付けられなくても、登録そのものは続ける */
  let commentedAt = 0;
  for(const [S, ent] of Object.entries(long)){
    const v = ent && ent[lang];
    if(!v || !v.id || v.comment2) continue;
    if(ONLY_ID && v.id !== ONLY_ID) continue;
    const pub = vs.find(x => x.id === v.id);
    if(!pub) continue;                                                        // この言語のチャンネルの動画だけ（別チャンネルの動画には付けない）
    if(pub.status.privacyStatus !== "public") continue;                       // 公開になってから付ける
    const text = cfg.callText(titleName(v.title));
    // 記録（comment2）が残っていなくても、YouTube 上にすでに同じ呼びかけがあれば、付けない（再実行や記録の取りこぼしで重複しないように）
    const already = await hasCall(v.id);
    if(already === true){ v.comment2 = true; changed++; console.log(`呼びかけのコメントは、すでに付いています: ${S} ${lang} ${v.id}`); continue; }
    if(already === null) console.log(`::warning::${S} ${v.id} のコメント一覧を読めなかったので、記録（comment2）だけで判断します。`);
    // 公開した直後や、続けて何本も付けるときは、YouTube が一時的に断ることがある（動画の準備中・短時間に同じ文面が続くことへの制限など）。
    // 間をあけて3回まで試し、続けて付けるときは、前のコメントから少し間をあける
    let r = null, body = "";
    for(let n = 1; n <= 3; n++){
      if(commentedAt && Date.now() - commentedAt < 20000) await new Promise(res => setTimeout(res, 20000 - (Date.now() - commentedAt)));
      r = await fetch(`${API}/youtube/v3/commentThreads?part=snippet`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: { videoId: v.id, topLevelComment: { snippet: { textOriginal: text } } } }) });
      if(r.ok) break;
      body = await r.text();
      console.log(`コメントを付けられませんでした（${n}回目、HTTP ${r.status}）: ${S} ${lang} ${v.id} ${body.replace(/\s+/g, " ").slice(0, 300)}`);
      if(n < 3) await new Promise(res => setTimeout(res, 30000 * n));
    }
    if(r.ok){ commentedAt = Date.now(); v.comment2 = true; changed++; console.log(`呼びかけのコメントを付けました: ${S} ${lang} ${v.id}`); }
    else{
      console.log(`::warning::コメントを付けられませんでした: ${S} ${lang} ${v.id}（HTTP ${r.status}${/insufficientPermissions|insufficient authentication scopes/i.test(body) ? "、コメントの権限が足りません" : ""}）。あとでもう一度実行すれば、付いていない動画にだけ付けます。YouTube Studio で手で付ける場合の文面:\n${text}`);
    }
  }
}

const todo = ONLY_ID ? [ONLY_LANG === "en" ? "en" : "ja"] : LANGS;
for(const lang of todo){ try{ await syncLang(lang); }catch(e){ console.error(`${lang}: ${e.message}`); } }
if(!anyLang){ console.error("使える YouTube の許可がありません（YT_REFRESH_TOKEN_JA / _EN）。"); process.exit(1); }
if(changed) await writeFile("data/long.json", JSON.stringify(long, null, 2) + "\n", "utf8");
else console.log("新しく登録するものはありませんでした。");
