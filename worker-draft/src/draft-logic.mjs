/*
 * 友達とドラフトの進行（部屋の中身だけを扱う。通信のことは知らない）
 *
 * ・8人卓。参加した人が席に座り、空いた席は CPU が埋める。
 * ・パックは主催者のブラウザが作って送る（カードの情報は ID・強さ・色だけ）。
 *   ここでは「誰の前にどのパックがあるか」と「誰が何を取ったか」を管理する。
 * ・ピックは全員同時。取ったら残りを隣へ回す（1・3パック目は左、2パック目は右）。
 *   回ってきたパックは席ごとの待ち行列に積まれ、先頭から順に取る。
 * ・時間制限は無い。通信が切れた人がいたら全員で待つ。主催者はその席を CPU に任せられる。
 *   本人が戻ってきたら、その席は本人に戻る。
 */

export const SEATS = 8, ROUNDS = 3, PACK_SIZE = 14, MAX_LOG = 50;

export function newRoom() {
  return { phase: "lobby", set: "", setName: "", hostId: null, members: [], seats: null, round: 0, log: [], updated: Date.now() };
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

/* 主催者がセットを決める（始まる前だけ） */
export function setConfig(room, by, cfg) {
  if (room.hostId !== by) throw err("主催者だけが決められます");
  if (room.phase !== "lobby") throw err("もう始まっています");
  const set = String(cfg.set || "").toLowerCase();
  if (!/^[a-z0-9]{2,6}$/.test(set)) throw err("セットが正しくありません");
  room.set = set;
  room.setName = String(cfg.setName || set.toUpperCase()).slice(0, 60);
}

/* 開始。packs は [3パック目まで][8席][14枚] で、1枚は {id, r（強さ）, c（色の配列）} */
export function start(room, by, packs, rnd = Math.random) {
  if (room.hostId !== by) throw err("主催者だけが開始できます");
  if (room.phase !== "lobby") throw err("もう始まっています");
  if (!room.set) throw err("セットを選んでください");
  if (!Array.isArray(packs) || packs.length !== ROUNDS || packs.some(r => !Array.isArray(r) || r.length !== SEATS || r.some(p => !Array.isArray(p) || !p.length || p.length > 20)))
    throw err("パックの形が正しくありません");
  const clean = c => ({ id: String(c.id).slice(0, 64), r: Number(c.r) || 50, c: (Array.isArray(c.c) ? c.c : []).filter(x => "WUBRG".includes(x)).slice(0, 5) });
  room.packs = packs.map(r => r.map(p => p.map(clean)));
  /* 席順はくじ。人とCPUが混ざって座る */
  const order = room.members.map(m => m.id).concat(Array(SEATS - room.members.length).fill(null));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let cpuNo = 0;
  room.seats = order.map(id => ({
    memberId: id, name: id ? memberOf(room, id).name : `CPU ${++cpuNo}`,
    cpu: !id, auto: false, queue: [], picks: [], colorScore: { W: 0, U: 0, B: 0, R: 0, G: 0 }, pickInRound: 0
  }));
  room.phase = "drafting";
  room.round = 0;
  log(room, "ドラフトを始めました");
  deal(room);
  runCpus(room, rnd);
}

function deal(room) {
  room.seats.forEach((s, i) => { s.queue = [room.packs[room.round][i]]; s.pickInRound = 0; });
  room.packs[room.round] = null;      // 配り終えたものは持たない
}

const direction = round => (round % 2 === 0 ? 1 : -1);

/* 席 si が、いま前にあるパックから cardId を取る */
function take(room, si, cardId) {
  const s = room.seats[si];
  const pack = s.queue[0];
  const i = pack ? pack.findIndex(c => c.id === cardId) : -1;
  if (i < 0) throw err("そのカードは、いまのパックにありません");
  const [card] = pack.splice(i, 1);
  s.picks.push(card);
  s.pickInRound++;
  const w = Math.max(0, card.r - 50);
  card.c.forEach(k => { s.colorScore[k] += w; });
  s.queue.shift();
  if (pack.length) room.seats[(si + direction(room.round) + SEATS) % SEATS].queue.push(pack);
}

/* 人のピック。expect は「送った時点で取っていた枚数」。
   画面の更新と行き違って同じパックに2回押した場合、2回目は次のパックで取ったことにならないよう黙って捨てる */
export function pick(room, by, cardId, rnd = Math.random, expect = null) {
  if (room.phase !== "drafting") throw err("いまはピックできません");
  const si = seatOf(room, by);
  if (si < 0) throw err("席がありません");
  if (expect != null && room.seats[si].picks.length !== Number(expect)) return false;
  if (!room.seats[si].queue.length) throw err("パックが回ってくるのを待っています");
  take(room, si, String(cardId));
  runCpus(room, rnd);
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
  runCpus(room, rnd);
}

/* CPU（と、CPU に任せた席）は、パックが前にある限りすぐ取る。全部のパックが空になったら次のパックへ */
function runCpus(room, rnd) {
  for (;;) {
    let moved = false;
    room.seats.forEach((s, si) => {
      if ((s.cpu || s.auto) && s.queue.length) { take(room, si, botChoice(s, s.queue[0], rnd).id); moved = true; }
    });
    if (moved) continue;
    if (room.seats.every(s => !s.queue.length)) {
      room.round++;
      if (room.round >= ROUNDS) { room.phase = "done"; log(room, "ドラフトが終わりました"); return; }
      deal(room);
      continue;
    }
    return;
  }
}

/* CPU の選び方（ドラフト練習の CPU と同じ考え方）：強さに、集めている色への寄りを足す。進むほど色を優先する */
export function botChoice(seat, pack, rnd = Math.random) {
  const ranked = Object.entries(seat.colorScore).sort((a, b) => b[1] - a[1]);
  const W = [1, 0.9, 0.3, 0, 0];
  const bonus = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  ranked.forEach(([k, v], i) => { bonus[k] = v > 0 ? W[i] : 0; });
  const commit = Math.min(1, seat.pickInRound / 6);
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
    isHost: room.hostId === me,
    members: room.members.map(m => ({ name: m.name, host: m.id === room.hostId, me: m.id === me, online: online.has(m.id) })),
    seats: room.seats ? room.seats.map((s, i) => ({
      name: s.name, cpu: s.cpu, auto: s.auto, me: i === si,
      online: s.cpu || online.has(s.memberId), picks: s.picks.length, waiting: s.queue.length
    })) : null,
    pack: mine && mine.queue.length ? mine.queue[0].map(c => c.id) : null,
    queued: mine ? mine.queue.length : 0,
    picks: mine ? mine.picks.map(c => c.id) : [],
    pickNo: mine ? mine.pickInRound : 0,
    log: room.log.slice(-8).map(l => l.text)
  };
}
