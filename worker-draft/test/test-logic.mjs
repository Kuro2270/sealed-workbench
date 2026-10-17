/* ドラフトの進行（draft-logic.mjs）だけを確かめる。通信は使わない */
import { newRoom, join, leave, setConfig, start, pick, handOver, viewFor, SEATS, ROUNDS, PACK_SIZE } from "../src/draft-logic.mjs";
let fail = 0; const ok = (c, m) => { console.log((c ? "  ok " : "  NG ") + m); if (!c) fail++; };
const COLS = ["W","U","B","R","G"];
let n = 0;
const packs = () => Array.from({ length: ROUNDS }, () => Array.from({ length: SEATS }, () => Array.from({ length: PACK_SIZE }, () => ({ id: "c" + (++n), r: 50 + (n % 9), c: [COLS[n % 5]] }))));
const on = new Set(["aaaaaaaa", "bbbbbbbb", "cccccccc"]);

console.log("部屋に入る");
const r = newRoom();
join(r, "aaaaaaaa", "主催", true);
join(r, "bbbbbbbb", "Bさん", true);
join(r, "cccccccc", "Cさん", false);
ok(r.hostId === "aaaaaaaa" && r.members.length === 3, "最初に主催者として入った人が主催者 / 3人");
let threw = ""; try { setConfig(r, "bbbbbbbb", { set: "fra" }); } catch (e) { threw = e.message; }
ok(/主催者だけ/.test(threw), "主催者以外はセットを決められない");
setConfig(r, "aaaaaaaa", { set: "fra", setName: "Final Fantasy" });
threw = ""; try { const bad = packs(); bad[0][3].pop(); start(r, "aaaaaaaa", bad); } catch (e) { threw = e.message; }
ok(/パックの形/.test(threw), "同じ周でパックの枚数がそろっていないと始まらない");
threw = ""; try { start(r, "aaaaaaaa", [[]]); } catch (e) { threw = e.message; }
ok(/パックの形/.test(threw), "形のおかしいパックでは始まらない");

console.log("開始");
start(r, "aaaaaaaa", packs());
ok(r.phase === "drafting" && r.seats.filter(s => s.cpu).length === 5, "空いた5席は CPU");
const humans = r.seats.map((s, i) => [s, i]).filter(([s]) => !s.cpu);
ok(humans.every(([s]) => s.hand && s.hand.length === PACK_SIZE && s.picks.length === 0), "人の前には14枚のパックが1つだけ");
ok(r.seats.filter(s => s.cpu).every(s => s.picks.length === 1 && !s.hand), "CPU はすぐ1枚取って、人を待つ");
threw = ""; try { join(r, "dddddddd", "遅刻", false); } catch (e) { threw = e.message; }
ok(/始まっています/.test(threw), "始まったあとは新しい人は入れない");
const v = viewFor(r, "bbbbbbbb", on);
ok(v.pack && v.pack.length === PACK_SIZE && v.picks.length === 0 && v.seats.length === SEATS, "自分のパック（14枚）が見える");
ok(!JSON.stringify(v).includes('"r":') && v.seats.every(s => typeof s.picks === "number"), "ほかの人が取ったカードは見えない（枚数だけ）");

console.log("1パック目を回す（左へ）。全員がそろうまで進まない");
const firstPackB = viewFor(r, "bbbbbbbb", on).pack.slice();
const bSeat = r.seats.findIndex(s => s.memberId === "bbbbbbbb");
pick(r, "bbbbbbbb", firstPackB[0]);
threw = ""; try { pick(r, "bbbbbbbb", firstPackB[1]); } catch (e) { threw = e.message; }
ok(/待って/.test(threw), "取ったあとは、ほかの人が取り終えるまで取れない");
pick(r, "aaaaaaaa", viewFor(r, "aaaaaaaa", on).pack[0]);
ok(!viewFor(r, "aaaaaaaa", on).pack && !viewFor(r, "bbbbbbbb", on).pack && r.pick === 0, "Cさんが選ぶまで、主催もBさんも次のパックは来ない");
ok(viewFor(r, "aaaaaaaa", on).seats.filter(s => s.waiting).map(s => s.name).join() === "Cさん", "待っている相手（Cさん）が分かる");
pick(r, "cccccccc", viewFor(r, "cccccccc", on).pack[0]);
const nextSeat = r.seats[(bSeat + 1) % SEATS];
const gotB = nextSeat.cpu ? nextSeat.picks.some(c => firstPackB.includes(c.id)) : nextSeat.hand.every(c => firstPackB.includes(c.id));
ok(r.pick === 1 && gotB, "全員そろったら一斉に回り、Bさんの残りは左隣へ");
ok(["aaaaaaaa", "bbbbbbbb", "cccccccc"].every(id => viewFor(r, id, on).pack.length === PACK_SIZE - 1), "3人とも13枚のパックを受け取る");

console.log("切断と CPU に任せる");
const off = new Set(["aaaaaaaa", "bbbbbbbb"]);      // C さんが切れた
threw = ""; try { handOver(r, "aaaaaaaa", bSeat, off); } catch (e) { threw = e.message; }
ok(/つながっている/.test(threw), "つながっている人の席は任せられない");
const cSeat = r.seats.findIndex(s => s.memberId === "cccccccc");
pick(r, "aaaaaaaa", viewFor(r, "aaaaaaaa", on).pack[0]); pick(r, "bbbbbbbb", viewFor(r, "bbbbbbbb", on).pack[0]);
ok(r.pick === 1, "Cさんが切れている間は、全員で待つ");
handOver(r, "aaaaaaaa", cSeat, off);
ok(r.seats[cSeat].auto && r.pick === 2 && r.seats[cSeat].picks.length === 3 && !r.seats[cSeat].hand, "切れた人の席を CPU に任せると、代わりに取って先へ進む（次の手もすぐ取る）");
join(r, "cccccccc", "Cさん", false);
ok(!r.seats[cSeat].auto, "本人が戻れば、その席は本人に戻る");

console.log("最後まで");
let guard = 0;
while (r.phase === "drafting" && guard++ < 2000) {
  for (const id of ["aaaaaaaa", "bbbbbbbb", "cccccccc"]) {
    const vv = viewFor(r, id, on);
    if (vv.pack) pick(r, id, vv.pack[Math.floor(Math.random() * vv.pack.length)]);
  }
}
ok(r.phase === "done", "3パック終わると done / " + r.phase);
ok(r.seats.every(s => s.picks.length === ROUNDS * PACK_SIZE), "全員42枚ずつ / " + r.seats.map(s => s.picks.length).join(","));
const all = r.seats.flatMap(s => s.picks.map(c => c.id));
ok(new Set(all).size === all.length && all.length === SEATS * ROUNDS * PACK_SIZE, "同じカードを2人が取ることはない（336枚）");
ok(viewFor(r, "aaaaaaaa", on).picks.length === 42, "自分が取った42枚を受け取れる");

console.log("始まる前に抜ける");
const r2 = newRoom(); join(r2, "aaaaaaaa", "主催", true); join(r2, "bbbbbbbb", "B", false); leave(r2, "aaaaaaaa");
ok(r2.hostId === "bbbbbbbb" && r2.members.length === 1, "主催者が抜けたら、次の人が主催者になる");
const r3 = newRoom(); for (let i = 0; i < 8; i++) join(r3, "p" + String(i).padStart(7, "0"), "P" + i, i === 0);
threw = ""; try { join(r3, "zzzzzzzz", "9人目", false); } catch (e) { threw = e.message; }
ok(/満員/.test(threw), "9人目は入れない");
console.log("二度押し");
{
  const q = newRoom(); join(q, "aaaaaaaa", "主催", true); setConfig(q, "aaaaaaaa", { set: "fra" }); start(q, "aaaaaaaa", packs());
  const me = q.seats.find(s => !s.cpu); const first = me.hand.map(c => c.id);
  ok(pick(q, "aaaaaaaa", first[0], Math.random, 0) === true && me.picks.length === 1, "1回目は取れる");
  ok(pick(q, "aaaaaaaa", first[1], Math.random, 0) === false && me.picks.length === 1, "同じパックへの2回目（行き違い）は捨てる");
  ok(q.pick === 1 && me.hand.length === PACK_SIZE - 1, "1人なら、CPU と一緒にすぐ次へ進む");
}
console.log(fail ? `\n${fail} 件失敗` : "\nすべて通過"); process.exit(fail ? 1 : 0);
