/*
 * 友達とドラフトの同期サーバー（Cloudflare Workers + Durable Objects）
 *
 * ・部屋ごとに Durable Object が1つでき、そこがドラフトの正本（席・パック・取ったカード）を持つ。
 * ・進め方そのものは draft-logic.mjs。ここは通信と保存だけ。
 * ・対戦卓のサーバー（worker/）とは別もの。片方を直しても、もう片方には影響しない。
 *
 * 経路
 *   GET /ws?room=<部屋ID>&id=<その人の合言葉>&name=<表示名>[&host=1]   … WebSocket でつなぐ
 *   GET /health                                                      … 生存確認
 *
 * 送るもの（ブラウザ → ここ）
 *   {type:"config", set, setName}   主催者がセットを決める
 *   {type:"start", packs}           主催者が開始（パックは主催者のブラウザが作る）
 *   {type:"pick", id, n}            ピック（n は送った時点で取っていた枚数。行き違いの二度押しを捨てるため）
 *   {type:"undo", n}                選び直し（ほかの人を待っている間だけ。いま取った1枚をパックに戻す）
 *   {type:"handover", seat}         主催者が、切れた人の席を CPU に任せる
 *   {type:"leave"}                  始まる前に抜ける
 */
import { newRoom, join, leave, setConfig, start, pick, undo, handOver, viewFor, VERSION } from "./draft-logic.mjs";

const KEEP_MS = 3 * 24 * 3600 * 1000;      // 最後の操作から3日たった部屋は消す

const cors = () => ({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors() } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname !== "/ws") return json({ error: "not found" }, 404);
    const room = (url.searchParams.get("room") || "").trim().toLowerCase();
    if (!/^[a-z0-9]{6,16}$/.test(room)) return json({ error: "部屋のIDが正しくありません" }, 400);
    return env.DRAFT.get(env.DRAFT.idFromName(room)).fetch(req);
  }
};

export class DraftRoom {
  constructor(state, env) { this.state = state; this.env = env; }

  async room() {
    if (!this.r) {
      const saved = await this.state.storage.get("room");
      /* 進め方を変える前に始まっていたドラフトは続けられないので、部屋を作り直す */
      this.r = saved && (saved.v === VERSION || saved.phase === "lobby") ? saved : newRoom();
      this.r.v = VERSION;
    }
    return this.r;
  }
  async save() {
    this.r.updated = Date.now();
    await this.state.storage.put("room", this.r);
    await this.state.storage.setAlarm(Date.now() + KEEP_MS);
  }
  async alarm() {
    await this.state.storage.deleteAll();
    this.r = null;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "websocket で接続してください" }, 426);
    const id = (url.searchParams.get("id") || "").trim();
    if (!/^[a-z0-9]{8,40}$/.test(id)) return json({ error: "id が正しくありません" }, 400);
    const r = await this.room();

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [id]);
    try {
      join(r, id, url.searchParams.get("name"), url.searchParams.get("host") === "1");
      await this.save();
      this.broadcastSoon();
    } catch (e) {
      /* 入れないときも、いったんつないで理由を伝えてから閉じる（ブラウザ側で表示できるように） */
      setTimeout(() => { try { pair[1].send(JSON.stringify({ type: "denied", message: e.message })); pair[1].close(4001, "denied"); } catch (x) {} }, 50);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  idOf(ws) { return (this.state.getTags(ws) || [])[0]; }
  online() { const s = new Set(); for (const ws of this.state.getWebSockets()) s.add(this.idOf(ws)); return s; }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const me = this.idOf(ws);
    const r = await this.room();
    if (!r.members.some(x => x.id === me)) return;
    try {
      if (m.type === "config") setConfig(r, me, m);
      else if (m.type === "start") start(r, me, m.packs);
      else if (m.type === "pick") { if (!pick(r, me, m.id, Math.random, m.n)) return; }
      else if (m.type === "undo") { if (!undo(r, me, m.n)) return; }
      else if (m.type === "handover") handOver(r, me, Number(m.seat), this.online());
      else if (m.type === "leave") leave(r, me);
      else return;
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", message: e.userError ? e.message : "うまく処理できませんでした" }));
      return;
    }
    await this.save();
    this.broadcast();
  }
  async webSocketClose() { await this.room(); this.broadcastSoon(); }   // 休眠から起きた直後でも部屋を読み直してから知らせる
  async webSocketError() { await this.room(); this.broadcastSoon(); }

  broadcastSoon() { setTimeout(() => this.broadcast(), 50); }
  broadcast() {
    const r = this.r; if (!r) return;
    const online = this.online();
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: "state", view: viewFor(r, this.idOf(ws), online) })); } catch (e) {}
    }
  }
}
