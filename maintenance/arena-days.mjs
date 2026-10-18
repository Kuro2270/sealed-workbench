/*
 * MTGアリーナの配信から何日たったかを、17Lands の試合データで確かめる。役割はこれだけ。
 * アリーナの配信日は Scryfall に無い（紙の発売日だけ）ので、「n 日前（日本時間）までの試合が 17Lands にあるか」で決める。
 *   ・速報ショート（3日目）・速報メモの更新（7日目）… check-new-data.mjs
 *   ・勝率の公開（12日目。17Lands の利用ガイドラインで、サイトへの掲載は12日目から）… build-provisional.mjs
 *
 *   await arenaDays(code, 12)        … 配信から12日以上たっていれば true
 *   await gamesBetween(code, a, b)   … a〜b（YYYY-MM-DD）の PremierDraft の試合数
 *
 * 通信は 17Lands の色別勝率を1回。環境変数 L17_API（確認用に差し替えられる）、ARENA_NOW（確認用。今の時刻）
 */
const UA = "sealed-workbench/1.0 (https://sealed-workbench.com)";
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const now = () => process.env.ARENA_NOW ? Date.parse(process.env.ARENA_NOW) : Date.now();

/* 日本時間の日付（off 日前） */
export const jstDay = (off = 0, t = now()) => iso(t + 9 * 3600000 - off * DAY);

export async function gamesBetween(code, start, end){
  const L17 = process.env.L17_API || "https://www.17lands.com";
  const r = await fetch(`${L17}/color_ratings/data?expansion=${encodeURIComponent(code)}&event_type=PremierDraft&start_date=${start}&end_date=${end}&combine_splash=true`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if(!r.ok) throw new Error(`17Lands HTTP ${r.status}`);
  const rows = await r.json();
  const all = (rows || []).find(x => x.is_summary && /^All/i.test(x.color_name || ""));
  return all ? +all.games || 0 : (rows || []).filter(x => !x.is_summary).reduce((n, x) => n + (+x.games || 0), 0);
}

/* 配信から n 日以上たったか：n 日前（日本時間）までの試合があれば、たっている */
export async function arenaDays(code, n){
  return (await gamesBetween(code, iso(now() - 60 * DAY), jstDay(n))) > 0;
}
