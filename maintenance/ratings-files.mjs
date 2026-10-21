/*
 * 勝率データのファイルの置き場所を決める。役割はこれだけ（書く側・読む側の両方から使う）。
 *
 *   data/ratings/events/<SET>_<FORMAT>.json … イベントごとの集計（build-ratings.mjs が書く。PremierDraft・Sealed など）
 *   data/ratings/<SET>_<mode>.json          … ドラフト／シールドにまとめたもの（build-articles.mjs・build-provisional.mjs が書く。サイトが読む）
 *
 * 2026年10月：以前はイベントごとの集計も data/ratings/ の直下に置いていた。そのため <SET>_Sealed.json（イベント）と
 *   <SET>_sealed.json（まとめ）が、大文字・小文字の違いだけの同じ名前になり、Windows（大文字・小文字を区別しない）の
 *   フォルダを通ると片方の中身がもう片方に入ってしまった。イベントごとの集計は events/ に分けて、名前がぶつからないようにした。
 */
import { readFile, readdir, rename, unlink, mkdir } from "node:fs/promises";
import path from "node:path";

export const RATINGS_DIR = "data/ratings";
export const EVENTS_DIR = "data/ratings/events";
export const EVENT_FORMATS = ["PremierDraft", "TradDraft", "QuickDraft", "Sealed", "TradSealed", "PickTwoDraft"];

/* イベントごとの集計のファイル名 */
export const eventFile = (set, format) => path.join(EVENTS_DIR, `${String(set).toUpperCase()}_${format}.json`);
/* 以前の置き場所（直下）。移し終わるまでの読み込み用 */
const legacyFile = (set, format) => path.join(RATINGS_DIR, `${String(set).toUpperCase()}_${format}.json`);

const readJson = async p => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return null; } };

/* イベントごとの集計を読む。events/ に無ければ、以前の置き場所（直下）を読む。どちらにも無ければ null */
export async function readEventRatings(set, format){
  return (await readJson(eventFile(set, format))) || (await readJson(legacyFile(set, format)));
}

/* イベントごとの集計を全部読む（build-articles.mjs 用）。events/ を優先し、まだ移していないものは直下から読む。
   直下のファイルのうち、まとめたもの（mode がある）は入力にしない */
export async function readAllEventRatings(){
  const out = new Map();     // "SET_FORMAT" → データ
  const take = async (dir, fromLegacy) => {
    let files = [];
    try{ files = await readdir(dir); }catch(e){ return; }
    for(const f of files){
      const m = f.match(/^([A-Z0-9]+)_([A-Za-z]+)\.json$/);
      if(!m || !EVENT_FORMATS.includes(m[2]) || out.has(`${m[1]}_${m[2]}`)) continue;
      const d = await readJson(path.join(dir, f));
      if(!d || !Array.isArray(d.cards) || d.mode) continue;
      if(fromLegacy && d.event && d.event !== m[2]) continue;
      out.set(`${m[1]}_${m[2]}`, d);
    }
  };
  await take(EVENTS_DIR, false);
  await take(RATINGS_DIR, true);
  return [...out.values()];
}

/* 直下に残っている、以前の置き場所のイベントごとの集計を events/ に移す（build-ratings.mjs が最初に1回呼ぶ）。
   ・中身がイベントの集計（mode が無い）なら events/ に移す（events/ に同じものが既にあれば、直下のほうを消す）
   ・中身がまとめたもの（mode がある）なら、大文字・小文字の違いで上書きされてしまった写しなので消す
     （本物のまとめは <SET>_sealed.json などの小文字の名前で別にある） */
export async function moveLegacyEventFiles(log = () => {}){
  let files = [];
  try{ files = await readdir(RATINGS_DIR); }catch(e){ return; }
  await mkdir(EVENTS_DIR, { recursive: true });
  let moved = 0, removed = 0;
  for(const f of files){
    const m = f.match(/^([A-Z0-9]+)_([A-Za-z]+)\.json$/);
    if(!m || !EVENT_FORMATS.includes(m[2])) continue;
    const from = path.join(RATINGS_DIR, f), d = await readJson(from);
    if(!d) continue;
    const to = eventFile(m[1], m[2]);
    if(d.mode || await readJson(to)){ await unlink(from); removed++; continue; }
    await rename(from, to); moved++;
  }
  if(moved || removed) log(`以前の置き場所の勝率データ: ${moved} 件を events/ に移し、${removed} 件（重複・上書きされた写し）を消しました`);
}
