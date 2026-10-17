/* 友達とドラフト（draftroom.html）の画面
 * ・部屋を作る／招待リンクで入る → 主催者が開始 → 全員同時にピック → 終わったら構築画面（draft.html?from=room。CPU戦とは保存場所が別）へ
 * ・ドラフトの正本はサーバー（worker-draft/）が持つ。この画面は「見せる」と「選んだカードを送る」だけ。
 * ・カードの読み込み・パック作り・名前と画像は draft-core.js（ドラフト練習と共通）を使う。
 */
(function(){
const SERVER = new URLSearchParams(location.search).get("server") || "wss://sealed-workbench-draft.kuro2270.workers.dev";
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const store = {
  get(k){ try{ return localStorage.getItem(k) || ""; }catch(e){ return ""; } },
  set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
};

const params = new URLSearchParams(location.search);
/* 動作確認ページ（draftroom-test.html）から開いたときは ?as=1,2,… が付く。
   席ごとに合言葉と名前の置き場所を分け、1つのブラウザで何人分でも入れるようにする */
const AS = (params.get("as") || "").toLowerCase();
const TEST = /^[a-z0-9]{1,8}$/.test(AS);
const KEY = k => "sw.room." + k + (TEST ? "." + AS : "");
if(TEST && params.get("embed") === "1") document.body.classList.add("embed");

/* この端末の合言葉（部屋に入り直したとき、同じ席に戻るため） */
let myId = store.get(KEY("id"));
if(!/^[a-z0-9]{8,40}$/.test(myId)){ myId = rid(16); store.set(KEY("id"), myId); }

let room = (params.get("room") || "").toLowerCase();
let ws = null, view = null, denied = false, retry = 0, loadedSet = "", loading = null, handedOff = false, iAmCreator = false;
let byId = {};
let sentAt = -1;           // ピックを送ったときの「取った枚数」。サーバーから返事が来るまで次は押せない

function setStatus(msg, isErr, busy){
  const el = $("status");
  el.removeAttribute("data-i18n");
  el.textContent = msg;
  el.className = "status" + (isErr ? " err" : "") + (busy ? " busy" : "");
}
const inviteUrl = () => location.origin + location.pathname + "?room=" + room;

/* ---------- 入口：部屋を作る／入る ---------- */
async function loadSetList(){
  try{
    const res = await fetch(SCRY + "/sets");
    const d = await res.json();
    const today = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);
    sets = d.data.filter(s => ["expansion","core"].includes(s.set_type) && s.released_at && s.released_at <= today && s.card_count > 100).slice(0, 30);
  }catch(e){ sets = []; }
  const sel = $("setSelect");
  sel.innerHTML = sets.map(s => `<option value="${s.code}">${esc(I18N.setLabel ? I18N.setLabel(s.code, s.name) : s.name)}</option>`).join("");
}
function setNameOf(code){ const s = sets.find(x => x.code === code); return s ? (I18N.setLabel ? I18N.setLabel(s.code, s.name) : s.name) : code.toUpperCase(); }

function showEntry(){
  $("nameInput").value = store.get(KEY("name"));
  $("entry").hidden = false;
  $("createBtn").hidden = !!room;
  $("joinBtn").hidden = !room;
  $("setWrap").hidden = !!room;
  setStatus(t(room ? "room.joinHint" : "room.createHint"));
}
function myName(){
  const n = $("nameInput").value.trim().slice(0, 20);
  if(n) store.set(KEY("name"), n);
  return n;
}
$("createBtn").onclick = () => {
  const n = myName(); if(!n){ setStatus(t("room.needName"), true); $("nameInput").focus(); return; }
  room = rid(10); iAmCreator = true;
  history.replaceState(null, "", "?room=" + room + (params.get("server") ? "&server=" + encodeURIComponent(SERVER) : ""));
  connect(n, true);
};
$("joinBtn").onclick = () => {
  const n = myName(); if(!n){ setStatus(t("room.needName"), true); $("nameInput").focus(); return; }
  connect(n, false);
};

/* ---------- 通信 ---------- */
function connect(name, host){
  $("entry").hidden = true;
  setStatus(t("room.connecting"), false, true);
  const u = SERVER + "/ws?room=" + room + "&id=" + myId + "&name=" + encodeURIComponent(name || store.get(KEY("name")) || "") + (host ? "&host=1" : "");
  ws = new WebSocket(u);
  ws.onopen = () => { retry = 0; sentAt = -1; };     // つなぎ直したら、届かなかったピックは押し直せるように
  ws.onmessage = ev => {
    let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
    if(m.type === "denied"){ denied = true; setStatus(m.message, true); return; }
    if(m.type === "error"){ sentAt = -1; render(); setStatus(m.message, true); return; }
    if(m.type === "state"){ view = m.view; onState(host); }
  };
  ws.onclose = () => {
    if(denied || handedOff) return;
    retry++;
    setStatus(t("room.reconnecting"), true, true);
    setTimeout(() => connect("", false), Math.min(8000, 1000 * retry));
  };
}
const send = o => { if(ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

/* ---------- 部屋の状態を描く ---------- */
async function onState(createdNow){
  /* 部屋を作った直後は、選んでいたセットを部屋に伝える */
  if(view.isHost && view.phase === "lobby" && !view.set && iAmCreator){
    const code = $("setSelect").value;
    if(code){ send({type: "config", set: code, setName: setNameOf(code)}); return; }
  }
  /* セットが決まったら、カードを先に読み込んでおく（開始やピックの表示を待たせないため） */
  if(view.set && loadedSet !== view.set && !loading) ensureCards(view.set);
  render();
  if(view.phase === "done") finish();
}
async function ensureCards(code){
  loading = (async () => {
    try{
      await loadCards(code);
      await loadJapanese(code);
      await loadWinRates(code);
      byId = {};
      boosterCards.forEach(c => { byId[c.id] = c; });
      loadedSet = code;
    }catch(e){ setStatus(e.message, true); }
    loading = null;
    render();
    if(view && view.phase === "done") finish();
  })();
  return loading;
}

function render(){
  if(!view) return;
  $("side").hidden = false;
  $("lobby").hidden = view.phase !== "lobby";
  $("drafting").hidden = view.phase === "lobby";
  document.querySelectorAll(".side .side-head, .side .side-body").forEach(e => { e.hidden = view.phase === "lobby"; });   // 始まる前は参加者だけ
  renderMembers();
  if(view.phase === "lobby") renderLobby();
  else renderDraft();
}

function renderMembers(){
  const box = $("people");
  if(view.phase === "lobby"){
    box.innerHTML = `<h4>${esc(t("room.members", {n: view.members.length}))}</h4>` + view.members.map(m =>
      `<div class="person${m.online ? "" : " off"}"><span class="dot"></span>${esc(m.name)}${m.host ? `<b class="tag">${esc(t("room.host"))}</b>` : ""}${m.me ? `<b class="tag me">${esc(t("room.you"))}</b>` : ""}</div>`).join("");
    return;
  }
  box.innerHTML = `<h4>${esc(t("room.table"))}</h4>` + view.seats.map((s, i) => {
    const state = s.cpu ? t("room.cpu") : s.auto ? t("room.auto") : !s.online ? t("room.offline") : s.waiting ? t("room.thinking") : t("room.waitingPack");
    const btn = view.isHost && view.phase === "drafting" && !s.cpu && !s.auto && !s.online ? `<button class="mini" data-hand="${i}">${esc(t("room.handover"))}</button>` : "";
    return `<div class="person${s.online ? "" : " off"}${s.me ? " mine" : ""}"><span class="dot"></span><span class="nm">${esc(s.name)}</span><span class="st">${esc(state)}</span>${btn}</div>`;
  }).join("");
  box.querySelectorAll("[data-hand]").forEach(b => b.onclick = () => send({type: "handover", seat: Number(b.dataset.hand)}));
}

function renderLobby(){
  $("inviteBox").value = inviteUrl();
  $("hostTools").hidden = !view.isHost;
  $("guestSet").hidden = view.isHost;
  if(view.isHost){
    const sel = $("lobbySet");
    if(!sel.options.length) sel.innerHTML = $("setSelect").innerHTML;
    if(view.set) sel.value = view.set;
    $("startBtn").disabled = !view.set || !!loading || loadedSet !== view.set;
    $("startBtn").textContent = loading ? t("room.loadingCards") : t("room.start", {n: 8 - view.members.length});
  }
  $("lobbySetName").textContent = view.setName || "—";
  setStatus(view.isHost ? t("room.hostHint") : t("room.guestHint"));
}
$("lobbySet").onchange = e => { const code = e.target.value; send({type: "config", set: code, setName: setNameOf(code)}); };
$("copyInvite").onclick = async () => {
  try{ await navigator.clipboard.writeText(inviteUrl()); $("copyInvite").textContent = t("room.copied"); setTimeout(() => $("copyInvite").textContent = t("room.copy"), 1500); }
  catch(e){ $("inviteBox").select(); }
};
/* 招待リンクを送る：メール・LINE・X。スマホなどでは、ほかのアプリ（端末の共有）も */
const enc = encodeURIComponent;
const shareMsg = () => view && view.setName ? t("room.shareText", {set: view.setName}) : t("room.shareSubject");
document.querySelectorAll("[data-share]").forEach(b => b.onclick = () => {
  const u = inviteUrl(), msg = shareMsg(), k = b.dataset.share;
  if(k === "mail"){
    const a = document.createElement("a");
    a.href = "mailto:?subject=" + enc(t("room.shareSubject")) + "&body=" + enc(msg + "\n" + u);
    a.click();
  }
  else if(k === "line") window.open("https://line.me/R/share?text=" + enc(msg + "\n" + u), "_blank", "noopener");
  else if(k === "x") window.open("https://x.com/intent/post?text=" + enc(msg) + "&url=" + enc(u), "_blank", "noopener");
  else if(navigator.share) navigator.share({title: t("room.shareSubject"), text: msg, url: u}).catch(() => {});
});
if(navigator.share) $("shareMore").hidden = false;

$("startBtn").onclick = async () => {
  if(loading) await loading;
  /* パックは主催者のブラウザで作る（ドラフト練習と同じ作り方）。送るのは ID・強さ・色だけ */
  const packs = [];
  for(let p = 0; p < PACKS; p++) packs.push(Array.from({length: PLAYERS}, () => buildPack().map(c => ({id: c.id, r: ratingOf(c), c: cardColors(c)}))));
  send({type: "start", packs});
};

const RANK = {mythic:0, special:0, bonus:0, rare:1, uncommon:2, common:3};
const sortCards = list => list.slice().sort((a, b) => (RANK[a.rarity] ?? 4) - (RANK[b.rarity] ?? 4) || ratingOf(b) - ratingOf(a));

function tile(c, onClick){
  const li = document.createElement("li");
  li.className = "tile r-" + c.rarity; li.tabIndex = 0;
  const name = displayName(c);
  li.title = name + (c.type_line ? "\n" + c.type_line : "");
  const urls = imageUrls(c);
  if(urls.length){ const img = document.createElement("img"); img.src = urls[0]; img.alt = name; img.loading = "lazy"; li.appendChild(img); }
  else { const d = document.createElement("div"); d.className = "noimg"; d.textContent = name; li.appendChild(d); }
  const w = $("wrToggle").checked ? wrEntry(c) : null;
  if(w){ const b = document.createElement("span"); b.className = "wrbadge" + (isBomb(w) ? " bomb" : ""); b.textContent = (w.gih * 100).toFixed(1) + "%"; li.appendChild(b); }
  li._card = c;                                    // 長押しで拡大するときに使う（cardzoom.js）
  li.onmouseenter = ev => showPreview(c, ev.clientX, ev.clientY);
  li.onmousemove  = ev => movePreview(ev.clientX, ev.clientY);
  li.onmouseleave = hidePreview;
  li.onclick = () => { hidePreview(); onClick(); };
  li.onkeydown = ev => { if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); onClick(); } };
  return li;
}
function row(c, latest){
  const li = document.createElement("li");
  li.className = "card-row r-" + c.rarity + (latest ? " latest" : "");
  li._card = c;
  const w = $("wrToggle").checked ? wrEntry(c) : null;
  li.innerHTML = `<span class="rar ${c.rarity}"></span><span class="name">${esc(displayName(c))}</span>${latest ? `<b class="now">${esc(t("room.justPicked"))}</b>` : ""}` +
    `<span class="wr${isBomb(w) ? " bomb" : ""}">${w ? (w.gih * 100).toFixed(1) + "%" : ""}</span>` +
    `<span style="font-size:12px;color:var(--muted)">${esc(c.mana_cost || "")}</span>`;
  li.onmouseenter = ev => showPreview(c, ev.clientX, ev.clientY);
  li.onmousemove  = ev => movePreview(ev.clientX, ev.clientY);
  li.onmouseleave = hidePreview;
  return li;
}
/* カードにマウスを乗せたときの拡大（ドラフト練習と同じ） */
function showPreview(c, x, y){
  const urls = imageUrls(c); if(!urls.length) return;
  const box = $("preview"); box.innerHTML = "";
  urls.forEach(u => { const img = document.createElement("img"); img.src = u; img.alt = displayName(c); box.appendChild(img); });
  box.style.display = "block"; movePreview(x, y);
}
function movePreview(x, y){
  const box = $("preview"); if(box.style.display !== "block") return;
  const w = 252, h = box.offsetHeight || 350;
  let left = x + 18, top = y - h/2;
  if(left + w > innerWidth - 8) left = x - w - 18;
  if(left < 8) left = 8;
  top = Math.min(Math.max(8, top), innerHeight - h - 8);
  box.style.left = left + "px"; box.style.top = top + "px";
}
function hidePreview(){ const box = $("preview"); box.style.display = "none"; box.innerHTML = ""; }
addEventListener("scroll", hidePreview, {passive: true});
$("wrToggle").onchange = () => { hidePreview(); render(); };

function renderDraft(){
  const board = $("board"); board.innerHTML = "";
  const cards = ids => ids.map(id => byId[id]).filter(Boolean);
  const total = PACKS * PACK_SIZE, done = view.picks.length;
  $("bar").firstElementChild.style.width = (done / total * 100) + "%";
  if(view.phase === "done"){ $("phaseTitle").textContent = t("room.doneTitle"); $("phaseSub").textContent = ""; }
  else if(!loadedSet){ setStatus(t("room.loadingCards"), false, true); }
  else if(view.pack){
    $("phaseTitle").textContent = t("draft.phase", {p: view.round + 1, i: view.pickNo + 1});
    $("phaseSub").textContent = t("draft.phaseSub", {n: view.pack.length, t: total, d: done + 1});
    const ul = document.createElement("ul"); ul.className = "grid";
    const waiting = sentAt === view.picks.length;
    if(waiting){ ul.dataset.sent = "1"; ul.style.opacity = .4; }
    sortCards(cards(view.pack)).forEach(c => ul.appendChild(tile(c, () => {
      if(ul.dataset.sent) return;
      ul.dataset.sent = "1"; ul.style.opacity = .4;
      sentAt = view.picks.length;
      send({type: "pick", id: c.id, n: sentAt});
    })));
    board.appendChild(ul);
    setStatus(t("room.pickNow"));
  }else{
    $("phaseTitle").textContent = t("draft.phase", {p: view.round + 1, i: view.pickNo + 1});
    $("phaseSub").textContent = "";
    /* 取ったあと、ほかの人を待っている間：選んだ1枚と残りを見せ、選び直せるようにする */
    if(view.chosen && byId[view.chosen.id]){
      const bar = document.createElement("div"); bar.className = "redo";
      const btn = document.createElement("button"); btn.type = "button"; btn.textContent = t("room.redo");
      btn.onclick = () => { btn.disabled = true; sentAt = -1; send({type: "undo", n: view.picks.length}); };
      bar.appendChild(btn); board.appendChild(bar);
      const ul = document.createElement("ul"); ul.className = "grid chosen-pack";
      const mineTile = tile(byId[view.chosen.id], () => {});
      mineTile.classList.add("chosen");
      const tag = document.createElement("span"); tag.className = "chosen-tag"; tag.textContent = t("room.chosen"); mineTile.appendChild(tag);
      ul.appendChild(mineTile);
      sortCards(cards(view.chosen.rest)).forEach(c => ul.appendChild(tile(c, () => {})));
      board.appendChild(ul);
    }
    const slow = view.seats.filter(s => !s.cpu && !s.me && s.waiting).map(s => s.name);
    setStatus(slow.length ? t("room.waitFor", {names: slow.join("・")}) : t("room.waitPass"), false, true);
  }
  /* 取ったカード */
  const mine = cards(view.picks);
  $("sideCount").textContent = mine.length;
  const sb = $("sideBody");
  if(!mine.length){ sb.innerHTML = `<div class="empty">${esc(t("draft.pickedEmpty"))}</div>`; return; }
  sb.innerHTML = "";
  const ul = document.createElement("ul");
  /* いま取った1枚に印を付ける（同じカードが複数あっても印は1つ） */
  let latestId = view.picks[view.picks.length - 1];
  mine.slice().sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || displayName(a).localeCompare(displayName(b), "ja")).forEach(c => {
    const latest = c.id === latestId; if(latest) latestId = null;
    ul.appendChild(row(c, latest));
  });
  sb.appendChild(ul);
}

/* ---------- 終わったら構築画面へ（ドラフト練習と同じ画面で、デッキを組んで書き出す） ---------- */
async function finish(){
  if(handedOff) return;
  if(loading) await loading;
  const pool = view.picks.map(id => byId[id]).filter(Boolean);
  if(pool.length !== view.picks.length) return;
  handedOff = true;
  if(TEST && AS !== "1"){ setStatus(t("room.doneTitle")); return; }   // 動作確認では、構築画面へ進むのは1人目（主催）だけ
  const prev = PoolSave.load("room");
  if(prev && prev.n) PoolSave.archive("room", prev);          // 前回の友達とドラフトのプールは「過去のプール」へ（CPU戦の保存とは別）
  const meta = {v:1, setCode: view.set, phase:"build", packNo:0, pickNo:0, target:"main", landCount:{}, ts:Date.now(), n:pool.length};
  PoolSave.save("room", PoolSave.pack(meta, {pool, deck:[], side:[], basic:Object.values(basicCards)}));
  setStatus(t("room.toBuild"), false, true);
  $("buildLink").hidden = false;
  try{ ws.close(); }catch(e){}
  setTimeout(() => { location.href = "./draft.html?from=room"; }, 1200);
}

/* ---------- はじめ ---------- */
(async () => {
  await loadSetList();
  const asHost = TEST && params.get("host") === "1";      // 動作確認ページの1人目は、主催者として部屋を作る
  if(asHost) iAmCreator = true;
  if(room && store.get(KEY("name"))) connect(store.get(KEY("name")), asHost);   // 名前が分かっていれば、そのまま入る
  else showEntry();
})();
I18N.onChange(() => { hidePreview(); render(); });
})();
