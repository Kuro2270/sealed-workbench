#!/usr/bin/env node
/*
 * YouTube で「公開」になった長尺の環境まとめ動画を見つけて、data/long.json に自動で登録する（日本語のみ）。
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
 * 必要な環境変数: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN_JA
 * セット別ページの作り直しとコミットは、呼び出し側（workflow）で行う。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";

const API = process.env.YT_API || "https://www.googleapis.com";
const OAUTH = process.env.YT_OAUTH || "https://oauth2.googleapis.com/token";
const ID = process.env.YT_CLIENT_ID, SECRET = process.env.YT_CLIENT_SECRET, REFRESH = process.env.YT_REFRESH_TOKEN_JA;
const ONLY_SET = (process.env.LONG_SET || "").trim().toUpperCase(), ONLY_ID = (process.env.LONG_VIDEO_ID || "").trim();
const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch(e){ return f; } };

if(!ID || !SECRET || !REFRESH){ console.error("YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN_JA が設定されていません。"); process.exit(1); }
const tr = await fetch(OAUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: ID, client_secret: SECRET, refresh_token: REFRESH, grant_type: "refresh_token" }) });
const token = (await tr.json().catch(() => ({}))).access_token;
if(!token){ console.error("YouTube のアクセストークンを取れませんでした。"); process.exit(1); }
const yt = async path => {
  const r = await fetch(`${API}/youtube/v3/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(`HTTP ${r.status} ${path.split("?")[0]}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return j;
};

/* セット名（日本語・短縮）→ セットコード。publish-videos.mjs / build-long.mjs と同じ決め方 */
const shortName = n => { const m = String(n).replace(/^Magic:\s*The Gathering\s*[:|｜-]?\s*/i, "").split(/\s*[｜|]\s*/); return (m[m.length - 1] || "").trim() || String(n); };
const norm = s => String(s).replace(/[\s　・:：]/g, "");
async function setNameMap(){
  const map = {};
  let ja = {};
  try{ const m = (await readFile("i18n.js", "utf8")).match(/const SET_JA = (\{[\s\S]*?\});/); if(m) ja = new Function("return " + m[1])(); }catch(e){}
  const codes = new Set(Object.keys(ja).map(c => c.toUpperCase()));
  for(const f of await readdir("data/names").catch(() => [])) if(f.endsWith(".json")) codes.add(f.replace(/\.json$/, "").toUpperCase());
  for(const c of codes){
    let n = ja[c.toLowerCase()];
    if(!n){ const nm = await readJson(`data/names/${c}.json`, null); n = nm && nm.set; }
    if(n) map[norm(shortName(n))] = c;
  }
  return map;
}

const isoSec = d => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ""); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const chaptersOf = desc => String(desc || "").split("\n").map(l => l.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/)).filter(Boolean)
  .map(m => ({ at: (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], title: m[4].trim() }));

const long = await readJson("data/long.json", {});
let ids;
if(ONLY_ID) ids = [ONLY_ID];
else{
  const ch = await yt("channels?part=contentDetails&mine=true");
  const up = ch.items && ch.items[0] && ch.items[0].contentDetails.relatedPlaylists.uploads;
  if(!up){ console.error("アップロード一覧を取れませんでした。"); process.exit(1); }
  const pl = await yt(`playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(up)}`);
  ids = (pl.items || []).map(i => i.contentDetails.videoId);
}
if(!ids.length){ console.log("動画がありません。"); process.exit(0); }
const vs = (await yt(`videos?part=snippet,status,contentDetails&id=${ids.slice(0, 50).map(encodeURIComponent).join(",")}`)).items || [];
const names = await setNameMap();

let changed = 0;
const titleName = t => { const b = String(t).match(/【(.+?)】/); return b ? b[1].trim() : ""; };
for(const v of vs.sort((a, b) => String(a.snippet.publishedAt).localeCompare(String(b.snippet.publishedAt)))){
  const title = v.snippet.title || "";
  const manual = !!ONLY_ID;
  if(!manual && !(/環境まとめ/.test(title) && !/#shorts/i.test(title) && isoSec(v.contentDetails.duration) >= 120)) continue;
  if(v.status.privacyStatus !== "public"){ console.log(`まだ公開ではありません（${v.status.privacyStatus}）: ${title} [${v.id}]`); continue; }
  let set = ONLY_SET;
  if(!set){ const b = title.match(/【(.+?)】/); set = b ? names[norm(b[1])] : ""; }
  if(!set){ console.log(`セットを決められませんでした: ${title}（LONG_SET で指定できます）`); continue; }
  const cur = long[set] && long[set].ja;
  if(cur && cur.id === v.id){ console.log(`登録済み: ${set} ${v.id}`); continue; }
  if(cur && !manual && String(cur.uploadedAt) > String(v.snippet.publishedAt).slice(0, 10)){ console.log(`${set} は、より新しい動画が登録済みなので飛ばします: ${v.id}`); continue; }
  long[set] = { ...(long[set] || {}), ja: { id: v.id, title, uploadedAt: String(v.snippet.publishedAt).slice(0, 10), duration: v.contentDetails.duration, chapters: chaptersOf(v.snippet.description) } };
  console.log(`登録しました: ${set} ${v.id}（目次 ${long[set].ja.chapters.length} 件）${title}`);
  changed++;
}
/* この動画に、呼びかけのコメントがすでにあるか。あれば true、無ければ false、一覧を読めなければ null。
   文面の決まった部分（「お気に入りのカードや、うまくいったコンボ」）で判定するので、手で付けたものも見つかる */
const CALL_KEY = "お気に入りのカードや、うまくいったコンボ";
async function hasCall(videoId){
  try{
    let page = "";
    for(let i = 0; i < 3; i++){
      const j = await yt(`commentThreads?part=snippet&maxResults=100&order=time&textFormat=plainText&videoId=${encodeURIComponent(videoId)}${page}`);
      if((j.items || []).some(t => String(((t.snippet || {}).topLevelComment || {}).snippet && t.snippet.topLevelComment.snippet.textOriginal || "").includes(CALL_KEY))) return true;
      if(!j.nextPageToken) return false;
      page = `&pageToken=${encodeURIComponent(j.nextPageToken)}`;
    }
    return false;
  }catch(e){ return null; }
}

/* 呼びかけのコメント（まだ付けていない登録済みの長尺すべて）。コメントが付けられなくても、登録そのものは続ける */
const callText = name => `${name ? name + "の" : ""}ドラフトやシールドで、お気に入りのカードや、うまくいったコンボはありますか？\n「このカードが思った以上に強かった」「この組み合わせで勝てた」など、一言だけでも大丈夫です。ぜひコメントで教えてください。`;
for(const [S, ent] of Object.entries(long)){
  const v = ent && ent.ja;
  if(!v || !v.id || v.comment2) continue;
  if(ONLY_ID && v.id !== ONLY_ID) continue;
  const pub = vs.find(x => x.id === v.id);
  if(pub && pub.status.privacyStatus !== "public") continue;                  // 公開になってから付ける
  const text = callText(titleName(v.title));
  // 記録（comment2）が残っていなくても、YouTube 上にすでに同じ呼びかけがあれば、付けない（再実行や記録の取りこぼしで重複しないように）
  const already = await hasCall(v.id);
  if(already === true){ v.comment2 = true; changed++; console.log(`呼びかけのコメントは、すでに付いています: ${S} ${v.id}`); continue; }
  if(already === null) console.log(`::warning::${S} ${v.id} のコメント一覧を読めなかったので、記録（comment2）だけで判断します。`);
  const r = await fetch(`${API}/youtube/v3/commentThreads?part=snippet`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { videoId: v.id, topLevelComment: { snippet: { textOriginal: text } } } }) });
  if(r.ok){ v.comment2 = true; changed++; console.log(`呼びかけのコメントを付けました: ${S} ${v.id}`); }
  else{
    const body = await r.text();
    console.log(`::warning::コメントを付けられませんでした: ${S} ${v.id}（HTTP ${r.status}${/insufficient|scope|forbidden/i.test(body) ? "、コメントの権限が足りません" : ""}）。YouTube Studio で手で付ける場合の文面:\n${text}`);
  }
}
if(changed) await writeFile("data/long.json", JSON.stringify(long, null, 2) + "\n", "utf8");
else console.log("新しく登録するものはありませんでした。");
