/*
 * 友達とドラフトの進行（部屋の中身だけを扱う。通信のことは知らない）
 *
 * ・8人卓。参加した人が席に座り、空いた席は CPU が埋める。
 * ・パックは主催者のブラウザが作って送る（カードの情報は ID・強さ・色だけ）。
 *   ここでは「誰の前にどのパックがあるか」と「誰が何を取ったか」を管理する。
 * ・ピックは全員そろって1手ずつ進む。全員（CPU を含む）が1枚取り終えたら、
 *   残りを一斉に隣へ回す（1・3パック目は左、2パック目は右）。先に取った人は、ほかの人を待つ。
 * ・時間制限は無い。通信が切れた人がいたら全員で待つ。主催者はその席を CPU に任せられる。
 *   本人が戻ってきたら、その席は本人に戻る。
 */

export const SEATS = 8, ROUNDS = 3, PACK_SIZE = 14, MAX_LOG = 50;

export const VERSION = 2;      // 1 は「回ってきたパックを積んでおき、先に進める」方式だった

export function newRoom() {
  return { v: VERSION, phase: "lobby", set: "", setName: "", wr: true, hostId: null, members: [], seats: null, round: 0, log: [], updated: Date.now() };
}

const err = msg => { const e = new Error(msg); e.userError = true; return e; };
const memberOf = (room, id) => room.members.find(m => m.id === id);
const seatOf = (room, id) => room.seats ? room.seats.findIndex(s => s.memberId === id) : -1;
function log(room, text) { room.log.push({ t: Date.now(), text }); if (room.log.length > MAX_LOG) room.log.splice(0, room.log.length - MAX_LOG); }

/* 部屋に入る（入り直しも同じ）。最初に「主催者として」入った人が主催者になる */
export function join(room, id, name, wantHost) {
  name = String(name || "").trim().slice(0, 20);
  let m = memberOf(room, id);
  if (!m) {
    if (room.phase !== "lobby") throw err("このドラフトはもう始まっています");
    if (room.members.length >= SEATS) throw err("この部屋は満員です（8人まで）");
    m = { id, name: name || `プレイヤー${room.members.length + 1}` };
    room.members.push(m);
    if (!room.hostId && wantHost) room.hostId = id;
    log(room, `${m.name} が入りました`);
  } else if (name) {
    m.name = name;
  }
  /* 戻ってきた人の席は、CPU に任せていても本人に戻す */
  const si = seatOf(room, id);
  if (si >= 0 && room.seats[si].auto) { room.seats[si].auto = false; log(room, `${m.name} が戻りました`); }
  return m;
}

/* 部屋を出る（始まる前だけ。始まったあとは席が残る） */
export function leave(room, id) {
  if (room.phase !== "lobby") return;
  const i = room.members.findIndex(m => m.id === id);
  if (i < 0) return;
  const [m] = room.members.splice(i, 1);
  log(room, `${m.name} が抜けました`);
  if (room.hostId === id) room.hostId = room.members[0] ? room.members[0].id : null;
}

/* 主催者がセットと、カードの勝率を全員に見せるかを決める（始まる前だけ） */
export function setConfig(room, by, cfg) {
  if (room.hostId !== by) throw err("主催者だけが決められます");
  if (room.phase !== "lobby") throw err("もう始まっています");
  if (cfg.set === undefined && typeof cfg.wr !== "boolean") throw err("設定が正しくありません");
  if (cfg.set !== undefined) {
    const set = String(cfg.set || "").toLowerCase();
    if (!/^[a-z0-9]{2,6}$/.test(set)) throw err("セットが正しくありません");
    room.set = set;
    room.setName = String(cfg.setName || set.toUpperCase()).slice(0, 60);
  }
  if (typeof cfg.wr === "boolean") room.wr = cfg.wr;
}

/* 開始。packs は [3パック目まで][8席][14枚] で、1枚は {id, r（強さ）, c（色の配列）} */
export function start(room, by, packs, rnd = Math.random) {
  if (room.hostId !== by) throw err("主催者だけが開始できます");
  if (room.phase !== "lobby") throw err("もう始まっています");
  if (!room.set) throw err("セットを選んでください");
  if (!Array.isArray(packs) || packs.length !== ROUNDS || packs.some(r => !Array.isArray(r) || r.length !== SEATS || r.some(p => !Array.isArray(p) || !p.length || p.length > 20 || p.length !== r[0].length)))
    throw err("パックの形が正しくありません");      // 一斉に回すので、同じ周のパックは同じ枚数
  const clean = c => ({ id: String(c.id).slice(0, 64), r: Number(c.r) || 50, c: (Array.isArray(c.c) ? c.c : []).filter(x => "WUBRG".includes(x)).slice(0, 5) });
  room.packs = packs.map(r => r.map(p => p.map(clean)));
  /* 席順はくじ。人とCPUが混ざって座る */
  const order = room.members.map(m => m.id).concat(Array(SEATS - room.members.length).fill(null));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let cpuNo = 0;
  room.seats = order.map(id => ({
    memberId: id, name: id ? memberOf(room, id).name : `CPU ${++cpuNo}`,
    cpu: !id, auto: false, hand: null, passing: null, picks: [], colorScore: { W: 0, U: 0, B: 0, R: 0, G: 0 }
  }));
  room.phase = "drafting";
  room.round = 0;
  room.pick = 0;
  log(room, "ドラフトを始めました");
  deal(room);
  advance(room, rnd);
}

/* その周のパックを配る。hand＝いま前にあるパック（取り終えたら null）、passing＝取った残り（全員そろったら隣へ） */
function deal(room) {
  room.seats.forEach((s, i) => { s.hand = room.packs[room.round][i]; s.passing = null; });
  room.packs[room.round] = null;      // 配り終えたものは持たない
  room.pick = 0;
}

const direction = round => (round % 2 === 0 ? 1 : -1);

/* 席 si が、いま前にあるパックから cardId を取る（まだ回さない） */
function take(room, si, cardId) {
  const s = room.seats[si];
  const i = s.hand ? s.hand.findIndex(c => c.id === cardId) : -1;
  if (i < 0) throw err("そのカードは、いまのパックにありません");
  const [card] = s.hand.splice(i, 1);
  s.picks.push(card);
  const w = Math.max(0, card.r - 50);
  card.c.forEach(k => { s.colorScore[k] += w; });
  s.passing = s.hand;
  s.hand = null;
}

/* 人のピック。expect は「送った時点で取っていた枚数」。
   画面の更新と行き違って同じパックに2回押した場合、2回目は次のパックで取ったことにならないよう黙って捨てる */
export function pick(room, by, cardId, rnd = Math.random, expect = null) {
  if (room.phase !== "drafting") throw err("いまはピックできません");
  const si = seatOf(room, by);
  if (si < 0) throw err("席がありません");
  if (expect != null && room.seats[si].picks.length !== Number(expect)) return false;
  if (!room.seats[si].hand) throw err("ほかの人が選び終えるのを待っています");
  take(room, si, String(cardId));
  advance(room, rnd);
  return true;
}

/* 選び直し。ほかの人がまだ選んでいて、パックが回る前なら、いま取った1枚をパックに戻せる。
   expect は「送った時点で取っていた枚数」（二度押しで2枚戻らないように） */
export function undo(room, by, expect = null) {
  if (room.phase !== "drafting") throw err("いまは選び直せません");
  const si = seatOf(room, by);
  if (si < 0) throw err("席がありません");
  const s = room.seats[si];
  if (expect != null && s.picks.length !== Number(expect)) return false;
  if (s.hand || !s.passing || s.cpu || s.auto) throw err("ほかの人も選び終えたので、選び直せませんでした");
  const card = s.picks.pop();
  const w = Math.max(0, card.r - 50);
  card.c.forEach(k => { s.colorScore[k] -= w; });
  s.passing.push(card);
  s.hand = s.passing;
  s.passing = null;
  return true;
}

/* 主催者が、通信が切れた人の席を CPU に任せる（本人が戻れば本人に戻る） */
export function handOver(room, by, si, online, rnd = Math.random) {
  if (room.hostId !== by) throw err("主催者だけが操作できます");
  if (room.phase !== "drafting") return;
  const s = room.seats[si];
  if (!s || s.cpu) return;
  if (online.has(s.memberId)) throw err("つながっている人の席は任せられません");
  s.auto = true;
  log(room, `${s.name} の席を CPU に任せました`);
  advance(room, rnd);
}

/* CPU（と、CPU に任せた席）は前にパックがあればすぐ取る。
   全員が取り終えたら一斉に隣へ回し、パックが空になったら次の周へ */
function advance(room, rnd) {
  for (;;) {
    room.seats.forEach((s, si) => {
      if ((s.cpu || s.auto) && s.hand) take(room, si, botChoice(s, s.hand, rnd, room.pick).id);
    });
    if (room.seats.some(s => s.hand)) return;          // まだ選んでいる人がいる
    room.pick++;
    if (room.seats.every(s => !s.passing || !s.passing.length)) {
      room.round++;
      if (room.round >= ROUNDS) { room.phase = "done"; room.seats.forEach(s => { s.passing = null; }); log(room, "ドラフトが終わりました"); return; }
      deal(room);
      continue;
    }
    const dir = direction(room.round), passed = room.seats.map(s => s.passing);
    room.seats.forEach((s, si) => { s.hand = passed[(si - dir + SEATS) % SEATS]; s.passing = null; });
  }
}

/* CPU の選び方（ドラフト練習の CPU と同じ考え方）：強さに、集めている色への寄りを足す。進むほど色を優先する */
export function botChoice(seat, pack, rnd = Math.random, pickInRound = 0) {
  const ranked = Object.entries(seat.colorScore).sort((a, b) => b[1] - a[1]);
  const W = [1, 0.9, 0.3, 0, 0];
  const bonus = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  ranked.forEach(([k, v], i) => { bonus[k] = v > 0 ? W[i] : 0; });
  const commit = Math.min(1, pickInRound / 6);
  let best = null, bestScore = -Infinity;
  for (const c of pack) {
    let fit = c.c.length ? c.c.reduce((n, k) => n + bonus[k], 0) / c.c.length : 0.5;
    if (c.c.length > 1) fit *= 0.9;
    const score = c.r + commit * 4 * (fit - 0.4) + (rnd() - 0.5) * 1.2;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/* その人に見せる内容。ほかの人が取ったカードは見せない */
export function viewFor(room, me, online) {
  const si = seatOf(room, me);
  const mine = si >= 0 ? room.seats[si] : null;
  return {
    phase: room.phase, set: room.set, setName: room.setName, round: room.round,
    wr: room.wr !== false,                       // カードの勝率を見せるか（主催者が決め、全員に効く）
    isHost: room.hostId === me,
    members: room.members.map(m => ({ name: m.name, host: m.id === room.hostId, me: m.id === me, online: online.has(m.id) })),
    seats: room.seats ? room.seats.map((s, i) => ({
      name: s.name, cpu: s.cpu, auto: s.auto, me: i === si,
      online: s.cpu || online.has(s.memberId), picks: s.picks.length, waiting: !!s.hand
    })) : null,
    pack: mine && mine.hand ? mine.hand.map(c => c.id) : null,
    /* 取ったあと、パックが回るまでの間：選んだ1枚と残りのパック（選び直せる） */
    chosen: mine && !mine.hand && mine.passing && room.phase === "drafting"
      ? { id: mine.picks[mine.picks.length - 1].id, rest: mine.passing.map(c => c.id) } : null,
    picks: mine ? mine.picks.map(c => c.id) : [],
    pickNo: room.pick || 0,
    log: room.log.slice(-8).map(l => l.text)
  };
}
