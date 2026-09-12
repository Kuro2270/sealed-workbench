/*
 * 17Lands のカード勝率データを中継する。
 *
 *   /api/ratings?set=msh&event=PremierDraft
 *
 * ・発売から12日間は 17Lands の規約によりデータを返さない
 * ・Cloudflare のキャッシュに12時間保持し、17Lands への負荷を抑える
 * ・出典表記は表示側（ratings.html）で行う
 */

const EMBARGO_DAYS = 12;                 // 17Lands 規約：発売後12日間は利用不可
const CACHE_SECONDS = 60 * 60 * 12;      // 12時間
const EVENTS = ["PremierDraft", "TradDraft", "QuickDraft", "Sealed", "TradSealed"];
const UA = "SealedWorkbench/1.0 (https://sealed-workbench.pages.dev)";

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extra
    }
  });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const set = (url.searchParams.get("set") || "").toLowerCase();
  const event = url.searchParams.get("event") || "PremierDraft";

  if (!/^[a-z0-9]{3,6}$/.test(set)) {
    return json({ error: "セットコードが不正です。" }, 400);
  }
  if (!EVENTS.includes(event)) {
    return json({ error: "イベント種別が不正です。" }, 400);
  }

  // ---- キャッシュ確認 ----
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.sealed-workbench/ratings/${set}/${event}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // ---- 発売日を確認して禁止期間を判定 ----
  let info;
  try {
    const res = await fetch(`https://api.scryfall.com/sets/${set}`, {
      headers: { "User-Agent": UA, Accept: "application/json" }
    });
    if (!res.ok) return json({ error: "セット情報を取得できませんでした。" }, 404);
    info = await res.json();
  } catch (e) {
    return json({ error: "セット情報の取得に失敗しました。" }, 502);
  }

  if (!info.released_at) {
    return json({ error: "発売日が不明なセットです。" }, 409);
  }

  const days = Math.floor((Date.now() - Date.parse(info.released_at + "T00:00:00Z")) / 86400000);
  if (days < EMBARGO_DAYS) {
    return json({
      error: "embargo",
      message: `17Lands の規約により、発売から${EMBARGO_DAYS}日間はデータを表示できません。`,
      released_at: info.released_at,
      days_remaining: EMBARGO_DAYS - days
    }, 403);
  }

  // ---- 17Lands から取得 ----
  // 日付を指定すると取得できる範囲が極端に狭まる場合があるため、
  // まず指定なしで試し、データが乏しいときだけ日付付きで再試行する。
  const today = new Date().toISOString().slice(0, 10);
  const base = "https://www.17lands.com/card_ratings/data"
             + `?expansion=${set.toUpperCase()}&format=${event}`;
  const attempts = [
    base,
    base + `&start_date=${info.released_at}&end_date=${today}`,
    base + `&start_date=2020-01-01&end_date=${today}`
  ];

  const totalGames = arr =>
    arr.reduce((n, r) => n + (r.ever_drawn_game_count || r.game_count || 0), 0);

  let rows = null, used = "", best = -1;

  for (const src of attempts) {
    let got;
    try {
      const res = await fetch(src, {
        headers: { "User-Agent": UA, Accept: "application/json" }
      });
      if (res.status === 429) {
        return json({ error: "17Lands へのアクセスが制限されています。しばらく待って再度お試しください。" }, 429);
      }
      if (!res.ok) continue;
      got = await res.json();
    } catch (e) {
      continue;
    }
    if (!Array.isArray(got) || !got.length) continue;

    const g = totalGames(got);
    if (g > best) { best = g; rows = got; used = src; }
    if (g > 0) break;                       // データが取れたら以降は試さない
  }

  if (!rows) {
    return json({ error: "17Lands からデータを取得できませんでした。" }, 502);
  }

  if (best === 0) {
    return json({
      error: "no_data",
      message: "このセットとイベント種別の組み合わせには、まだ試合データがありません。別のイベント種別をお試しください。",
      set: set.toUpperCase(),
      event
    }, 404);
  }

  // ---- 必要な項目だけに絞る ----
  const cards = rows.map(r => ({
    name:    r.name,
    color:   r.color || "",
    rarity:  r.rarity || "",
    gih:     r.ever_drawn_win_rate,          // 手札・戦場にあったときの勝率
    oh:      r.opening_hand_win_rate,        // 初手にあったときの勝率
    iwd:     r.drawn_improvement_win_rate,   // 引いたときの勝率上昇
    alsa:    r.avg_seen,                     // 平均見かけ順目
    ata:     r.avg_pick,                     // 平均ピック順目
    games:   r.ever_drawn_game_count ?? r.game_count ?? 0,
    picks:   r.pick_count ?? 0
  })).filter(c => c.name);

  const payload = {
    set: set.toUpperCase(),
    event,
    released_at: info.released_at,
    set_name: info.name,
    fetched_at: new Date().toISOString(),
    count: cards.length,
    total_games: best,
    dated: used.includes("start_date"),
    cards
  };

  const out = json(payload, 200, { "cache-control": `public, max-age=${CACHE_SECONDS}` });
  await cache.put(cacheKey, out.clone());
  return out;
}
