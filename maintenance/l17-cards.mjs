/*
 * 17Lands から、1つのセット・形式のカード勝率（カードごとの行）を取る。役割はこれだけ。
 * 暫定版（build-provisional.mjs）と速報（build-early.mjs）から使う。
 *
 * 取り口は2つ試して、試合数の多いほうを使う。
 *   ・/api/card_data（17Lands のカード表の画面が使っているもの。全期間）… 画面と同じ数字
 *   ・/card_ratings/data（以前からのもの）… 2026年10月 FRA では、全体の4%ほどの試合しか返らなかった（期間の指定を変えても同じ）
 * どちらも項目の名前は同じ（game_count・ever_drawn_game_count・ever_drawn_win_rate など）。
 *
 *   const { rows, games, label } = await fetchCardRows({ set, fmt, released, getJson })
 *     set: セットコード、fmt: PremierDraft / Sealed、released: 紙の発売日（YYYY-MM-DD。以前からの取り口の期間に使う）
 *     getJson(url): 呼ぶ側の取り方（User-Agent などはそちらで）。extra を付けると、URL の後ろに足す（2色の絞り込み &colors=WU など）
 *   rows が取れなければ例外。通信は2回で、間を 1.5 秒あける。
 */
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const listOf = d => Array.isArray(d) ? d : (d && (d.data || d.cards)) || [];
export const sumGames = rows => (rows || []).reduce((n, r) => n + (+r.game_count || 0), 0);

export function cardVariants({ set, fmt, released, L17 = process.env.L17_API || "https://www.17lands.com", now = Date.now() }){
  const s = encodeURIComponent(set);
  return [
    { label: "カード表の画面と同じ（全期間）", url: (extra = "") => `${L17}/api/card_data?expansion=${s}&event_type=${fmt}&time_period=ALL_TIME${extra}` },
    { label: "以前からの取り口", url: (extra = "") => `${L17}/card_ratings/data?expansion=${s}&format=${fmt}&start_date=${iso(Date.parse(released) - 21 * DAY)}&end_date=${iso(now + DAY)}${extra}` }
  ];
}

export async function fetchCardRows({ set, fmt, released, getJson, L17, now, log = m => console.error(m), wait = 1500 }){
  let pick = null, rows = null, best = -1;
  for(const v of cardVariants({ set, fmt, released, L17, now })){
    try{
      const r = listOf(await getJson(v.url("")));
      const n = sumGames(r);
      log(`  ${set} ${fmt}: カード勝率（${v.label}）の試合数の合計 ${n.toLocaleString()}／カード ${r.length} 種`);
      if(n > best){ best = n; pick = v; rows = r; }
    }catch(e){ log(`  ${e.message}`); }
    if(wait) await sleep(wait);
  }
  if(!rows) throw new Error(`${set} ${fmt}: カード勝率を取れませんでした`);
  return { rows, games: best, label: pick.label, variant: pick };
}
