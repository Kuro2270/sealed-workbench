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
  const debug = url.searchParams.get("debug") === "1";

  if (!/^[a-z0-9]{3,6}$/.test(set)) {
    return json({ error: "セットコードが不正です。" }, 400);
  }
  if (!EVENTS.includes(event)) {
    return json({ error: "イベント種別が不正です。" }, 400);
  }

  // ---- キャッシュ確認 ----
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.sealed-workbench/ratings/${set}/${event}`);
  if (!debug) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

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
  // 期間が長すぎると無言で0件相当の結果が返るため、
  // 期間指定の方法と長さを変えて試し、最も試合数の多い結果を採用する。
  const q = `expansion=${set.toUpperCase()}&format=${event}`;
  const day = 86400000;
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const now = Date.now();
  const today = iso(now);
  const rel = info.released_at;

  const dated = (from, to) =>
    `https://www.17lands.com/card_ratings/data?${q}&start_date=${from}&end_date=${to}`;

  const attempts = [
    `https://www.17lands.com/card_ratings/data?${q}&time_period=ALL_TIME`,
    `https://www.17lands.com/card_data?${q}&time_period=ALL_TIME`,
    dated(rel, today),                        // 発売日から今日まで
    dated(iso(now - 365 * day), today),       // 直近1年
    dated(iso(now - 180 * day), today),       // 直近半年
    dated(iso(now - 90 * day), today),        // 直近3か月
    dated(iso(now - 30 * day), today),        // 直近1か月
    dated(rel, iso(Date.parse(rel + "T00:00:00Z") + 60 * day))  // 発売直後の2か月
  ];

  const totalGames = arr =>
    arr.reduce((n, r) => n + (r.ever_drawn_game_count || r.game_count || 0), 0);

  let rows = null, used = "", best = -1;
  const diag = [];

  for (const src of attempts) {
    let got;
    try {
      const res = await fetch(src, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          Referer: "https://www.17lands.com/card_data"
        }
      });
      if (res.status === 429) {
        return json({ error: "17Lands へのアクセスが制限されています。しばらく待って再度お試しください。" }, 429);
      }
      if (!res.ok) { diag.push({ src, status: res.status }); continue; }
      const text = await res.text();
      try {
        got = JSON.parse(text);
      } catch (pe) {
        diag.push({ src, note: "JSONでない応答", head: text.slice(0, 120) });
        continue;
      }
    } catch (e) {
      diag.push({ src, error: String(e) });
      continue;
    }
    if (!Array.isArray(got) || !got.length) {
      diag.push({ src, note: "配列でない、または空", sample: JSON.stringify(got).slice(0, 300) });
      continue;
    }

    const g = totalGames(got);
    diag.push({ src, rows: got.length, total_games: g });
    if (g > best) { best = g; rows = got; used = src; }
    if (!debug && g >= 20000) break;        // 十分な量が取れたら打ち切る
  }

  // ---- 診断モード：生データをそのまま返す ----
  if (debug) {
    return json({
      set: set.toUpperCase(),
      event,
      released_at: info.released_at,
      attempts: diag,
      chosen: used,
      best_total_games: best,
      field_names: rows ? Object.keys(rows[0]) : [],
      first_row: rows ? rows[0] : null,
      max_row: rows
        ? rows.reduce((a, b) =>
            ((b.ever_drawn_game_count || b.game_count || 0) > (a.ever_drawn_game_count || a.game_count || 0) ? b : a))
        : null
    });
  }

  if (!rows) {
    return json({ error: "17Lands からデータを取得できませんでした。" }, 502);
  }

  if (best <= 0) {
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

  const period = (() => {
    const m = used.match(/start_date=([\d-]+)&end_date=([\d-]+)/);
    if (m) return `${m[1]} 〜 ${m[2]}`;
    if (used.includes("ALL_TIME")) return "全期間";
    return "不明";
  })();

  const payload = {
    set: set.toUpperCase(),
    event,
    released_at: info.released_at,
    set_name: info.name,
    fetched_at: new Date().toISOString(),
    count: cards.length,
    total_games: best,
    period,
    cards
  };

  const out = json(payload, 200, { "cache-control": `public, max-age=${CACHE_SECONDS}` });
  await cache.put(cacheKey, out.clone());
  return out;
}
