/*
 * 対戦卓の同期サーバー（Cloudflare Workers + Durable Objects）
 *
 * ・部屋（合言葉）ごとに Durable Object が1つでき、そこが盤面の正本を持つ。
 * ・ブラウザは「やりたいこと」だけを送り、山札のシャッフルや引く処理はここで行う。
 *   こうしないと、二人の画面で山札の順番がずれてしまう。
 * ・相手に見せてはいけないもの（手札の中身・山札の並び）は、送る直前に伏せる。
 *
 * 経路
 *   GET /ws?room=<合言葉>&seat=<席の合言葉>&name=<表示名>   … WebSocket でつなぐ
 *   GET /health                                          … 生存確認
 */

const MAX_LOG = 200;
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors() } });
const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname !== "/ws") return json({ error: "not found" }, 404);

    const room = (url.searchParams.get("room") || "").trim().toLowerCase();
    if (!/^[a-z0-9-]{3,32}$/.test(room)) return json({ error: "合言葉は英数字とハイフン 3〜32 文字にしてください" }, 400);

    const id = env.ROOM.idFromName(room);
    return env.ROOM.get(id).fetch(req);
  }
};

/* ============================ 部屋 ============================ */
export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /* 盤面を読む（休眠から起きた直後は記憶が消えているので保存先から読み直す） */
  async game() {
    if (!this.g) this.g = (await this.state.storage.get("game")) || freshGame();
    return this.g;
  }
  async save() {
    await this.state.storage.put("game", this.g);
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "websocket で接続してください" }, 426);
    const seat = (url.searchParams.get("seat") || "").trim();
    const name = (url.searchParams.get("name") || "").trim().slice(0, 20);
    if (!seat) return json({ error: "seat がありません" }, 400);

    const g = await this.game();
    // 席の割り当て。同じ seat で入り直したときは前の席に戻る（回線が切れても続きができる）
    let slot = Object.keys(g.players).find(k => g.players[k].seat === seat);
    if (!slot) {
      slot = ["a", "b"].find(k => !g.players[k]);
      if (!slot) return json({ error: "この部屋はすでに2人います" }, 409);
      g.players[slot] = newPlayer(seat, name || (slot === "a" ? "プレイヤー1" : "プレイヤー2"));
      log(g, `${g.players[slot].name} が入りました`);
    } else if (name) {
      g.players[slot].name = name;
    }
    await this.save();

    const pair = new WebSocketPair();
    // 休眠対応のつなぎ方。席の記号を覚えさせておき、起きたときに誰の回線か分かるようにする
    this.state.acceptWebSocket(pair[1], [slot]);
    this.broadcastSoon();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  seatOf(ws) {
    return (this.state.getTags(ws) || [])[0];
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const me = this.seatOf(ws);
    if (!me) return;
    const g = await this.game();
    if (!g.players[me]) return;

    try {
      apply(g, me, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", message: String(e.message || e) }));
      return;
    }
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws) {
    const me = this.seatOf(ws);
    const g = await this.game();
    if (g.players[me]) log(g, `${g.players[me].name} の接続が切れました`);
    await this.save();
    this.broadcast();
  }
  async webSocketError(ws) {
    this.broadcast();
  }

  broadcastSoon() {
    // 接続を返した直後はまだ相手側で受け取れないことがあるので、少しずらして送る
    setTimeout(() => this.broadcast(), 50);
  }

  broadcast() {
    const g = this.g;
    if (!g) return;
    const online = new Set();
    for (const ws of this.state.getWebSockets()) online.add(this.seatOf(ws));
    for (const ws of this.state.getWebSockets()) {
      const me = this.seatOf(ws);
      try { ws.send(JSON.stringify({ type: "state", view: viewFor(g, me, online) })); } catch (e) {}
    }
  }
}

/* ============================ 盤面 ============================ */
function freshGame() {
  return { players: {}, turn: 1, active: "a", log: [], nextId: 1 };
}
function newPlayer(seat, name) {
  return {
    seat, name, life: 20, poison: 0,
    library: [], hand: [], field: [], grave: [], exile: [],
    ready: false
  };
}
function log(g, text) {
  g.log.push({ t: Date.now(), text });
  if (g.log.length > MAX_LOG) g.log.splice(0, g.log.length - MAX_LOG);
}
const other = k => (k === "a" ? "b" : "a");

/* 相手に見せない部分を伏せてから渡す */
function viewFor(g, me, online) {
  const opp = other(me);
  const mine = g.players[me], theirs = g.players[opp];
  const pub = p => p && ({
    name: p.name, life: p.life, poison: p.poison,
    libraryCount: p.library.length, handCount: p.hand.length,
    field: p.field, grave: p.grave, exile: p.exile, ready: p.ready
  });
  // 裏向きにしたカード（両面カードではないもの）は、相手には中身を見せない
  const veil = c => (c.flipped && !c.back)
    ? { id: c.id, name: "", img: "", back: "", land: false, token: c.token,
        tapped: c.tapped, flipped: true, counters: c.counters, note: c.note,
        x: c.x, y: c.y, hidden: true }
    : c;
  return {
    me: mine && { ...pub(mine), hand: mine.hand, seat: me },
    opp: theirs && { ...pub(theirs), field: theirs.field.map(veil), seat: opp, online: online.has(opp) },
    // 相手の手札は枚数だけ。中身は送らない
    turn: g.turn, active: g.active, log: g.log.slice(-60), youAre: me
  };
}

/* ============================ 操作 ============================ */
function apply(g, me, m) {
  const p = g.players[me];
  const nm = p.name;
  const find = (zone, id) => {
    const i = p[zone].findIndex(c => c.id === id);
    if (i < 0) throw new Error("そのカードが見つかりません");
    return i;
  };
  const pull = (zone, id) => p[zone].splice(find(zone, id), 1)[0];
  const zoneName = { hand: "手札", field: "戦場", grave: "墓地", exile: "追放", library: "山札" };

  // 卓の上では相手の場のカードにも手を出せる（タップ・裏返し・カウンター・メモだけ）。
  // m.opp が付いているときは相手の戦場から探す。
  const onField = () => {
    const h = m.opp ? g.players[other(me)] : p;
    if (!h) throw new Error("相手がいません");
    const c = h.field.find(x => x.id === m.id);
    if (!c) throw new Error("そのカードが見つかりません");
    return c;
  };
  // 裏向きのカードは名前を記録に残さない（記録から中身が分かってしまうため）
  const shown = c => (c.flipped && !c.back) ? "裏向きのカード" : (c.name || "カード");
  const oppLog = text => { if (m.opp) log(g, `${nm} が${text}`); };

  switch (m.type) {
    /* ---- 準備 ---- */
    case "deck": {
      // 読み込んだデッキを山札にして混ぜる
      const cards = (m.cards || []).slice(0, 250).map(c => ({
        id: "c" + (g.nextId++),
        name: String(c.name || "").slice(0, 120),
        img: String(c.img || "").slice(0, 300),
        back: c.back ? String(c.back).slice(0, 300) : "",
        land: !!c.land,
        tapped: false, flipped: false, counters: 0, x: 0, y: 0, token: false, note: ""
      }));
      p.library = shuffle(cards);
      p.hand = []; p.field = []; p.grave = []; p.exile = [];
      p.life = m.life || 20; p.poison = 0; p.ready = true;
      log(g, `${nm} がデッキ（${cards.length}枚）を用意しました`);
      break;
    }
    case "name": {
      p.name = String(m.name || "").slice(0, 20) || p.name;
      break;
    }

    /* ---- 山札 ---- */
    case "draw": {
      const n = clamp(m.n || 1, 1, 20);
      const got = p.library.splice(0, n);
      p.hand.push(...got);
      log(g, `${nm} が ${got.length}枚 引きました`);
      break;
    }
    case "shuffle": {
      p.library = shuffle(p.library);
      log(g, `${nm} が山札を切りました`);
      break;
    }
    case "mill": {
      const n = clamp(m.n || 1, 1, 30);
      const got = p.library.splice(0, n);
      p.grave.unshift(...got);
      log(g, `${nm} が ${got.length}枚 墓地に置きました`);
      break;
    }
    case "mulligan": {
      // 手札を山札に戻して混ぜ、同じ枚数を引き直す（引く枚数は手元で決める）
      p.library.push(...p.hand);
      p.hand = [];
      p.library = shuffle(p.library);
      const n = clamp(m.n ?? 7, 0, 10);
      p.hand = p.library.splice(0, n);
      log(g, `${nm} がマリガンして ${n}枚 引き直しました`);
      break;
    }

    /* ---- カードを動かす ---- */
    case "move": {
      const from = m.from, to = m.to;
      if (!zoneName[from] || !zoneName[to]) throw new Error("行き先が不正です");
      let card;
      if (from === "library") {
        const i = clamp(m.index ?? 0, 0, Math.max(0, p.library.length - 1));
        if (!p.library.length) throw new Error("山札が空です");
        card = p.library.splice(i, 1)[0];
      } else {
        card = pull(from, m.id);
      }
      if (to === "field") {
        card.x = clamp(m.x ?? 20, 0, 2000); card.y = clamp(m.y ?? 20, 0, 1200);
        card.tapped = false;
        p.field.push(card);
      } else if (to === "library") {
        card.tapped = false; card.counters = 0;
        if (m.bottom) p.library.push(card); else p.library.unshift(card);
      } else {
        card.tapped = false; card.counters = 0; card.flipped = false;
        if (to === "hand") p.hand.push(card);
        else p[to].unshift(card);
      }
      // トークンは戦場から離れたら消える
      if (card.token && to !== "field") {
        const arr = to === "library" ? p.library : p[to];
        const i = arr.findIndex(c => c.id === card.id);
        if (i >= 0) arr.splice(i, 1);
        log(g, `${nm} のトークン「${card.name}」が消えました`);
        break;
      }
      if (!(from === "hand" && to === "field")) log(g, `${nm}：${card.name} を ${zoneName[from]} から ${zoneName[to]} へ`);
      else log(g, `${nm} が ${card.name} を出しました`);
      break;
    }
    case "pos": {
      const c = p.field[find("field", m.id)];
      c.x = clamp(m.x ?? c.x, 0, 2000); c.y = clamp(m.y ?? c.y, 0, 1200);
      break;
    }
    case "tap": {
      const c = onField();
      c.tapped = m.tapped ?? !c.tapped;
      oppLog(`相手の ${shown(c)} を${c.tapped ? "タップ" : "アンタップ"}しました`);
      break;
    }
    case "tapAll": {
      p.field.forEach(c => { c.tapped = !!m.tapped; });
      log(g, `${nm} が全部を${m.tapped ? "タップ" : "アンタップ"}しました`);
      break;
    }
    case "flip": {
      const c = onField();
      c.flipped = !c.flipped;
      oppLog(c.flipped ? "相手のカードを1枚 裏返しました" : `相手の ${shown(c)} を表に戻しました`);
      break;
    }
    case "counter": {
      const c = onField();
      c.counters = clamp((c.counters || 0) + (m.d || 0), -99, 99);
      oppLog(`相手の ${shown(c)} のカウンターを ${c.counters} にしました`);
      break;
    }
    case "note": {
      const c = onField();
      c.note = String(m.note || "").slice(0, 40);
      oppLog(`相手の ${shown(c)} にメモを付けました`);
      break;
    }
    case "token": {
      const c = {
        id: "c" + (g.nextId++),
        name: String(m.name || "トークン").slice(0, 60),
        img: String(m.img || "").slice(0, 300), back: "",
        land: false, token: true,
        tapped: false, flipped: false, counters: 0,
        x: clamp(m.x ?? 20, 0, 2000), y: clamp(m.y ?? 20, 0, 1200),
        note: String(m.note || "").slice(0, 40)
      };
      const n = clamp(m.n || 1, 1, 20);
      for (let i = 0; i < n; i++) p.field.push({ ...c, id: "c" + (g.nextId++), x: c.x + i * 18, y: c.y + i * 8 });
      log(g, `${nm} が ${c.name} を ${n}個 作りました`);
      break;
    }

    /* ---- ライフ・ダイス・ターン ---- */
    case "life": {
      p.life = clamp(p.life + (m.d || 0), -99, 999);
      log(g, `${nm} のライフ ${m.d > 0 ? "+" : ""}${m.d} → ${p.life}`);
      break;
    }
    case "lifeSet": {
      p.life = clamp(m.v ?? 20, -99, 999);
      log(g, `${nm} のライフを ${p.life} にしました`);
      break;
    }
    case "poison": {
      p.poison = clamp(p.poison + (m.d || 0), 0, 99);
      log(g, `${nm} の毒 → ${p.poison}`);
      break;
    }
    case "roll": {
      const faces = clamp(m.faces || 6, 2, 1000);
      const v = 1 + Math.floor(rnd() * faces);
      log(g, `${nm} が d${faces} を振って ${v}`);
      break;
    }
    case "coin": {
      log(g, `${nm} のコイン → ${rnd() < 0.5 ? "表" : "裏"}`);
      break;
    }
    case "turn": {
      g.active = other(g.active);
      if (g.active === "a") g.turn++;
      const np = g.players[g.active];
      if (np) np.field.forEach(c => { c.tapped = false; });
      log(g, `ターン ${g.turn}：${np ? np.name : ""} の番`);
      break;
    }
    case "say": {
      log(g, `${nm}：${String(m.text || "").slice(0, 120)}`);
      break;
    }
    case "reset": {
      const keep = { seat: p.seat, name: p.name };
      g.players[me] = { ...newPlayer(keep.seat, keep.name) };
      log(g, `${nm} が盤面を片付けました`);
      break;
    }
    default: throw new Error("知らない操作です: " + m.type);
  }
}

/* ============================ 道具 ============================ */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
/* 偏りのない乱数（暗号用の乱数を使う） */
function rnd() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 4294967296;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
