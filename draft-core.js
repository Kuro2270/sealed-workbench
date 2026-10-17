/* ドラフトの共通部分（ドラフト練習 draft.html と、友達とドラフト draftroom.html の両方で使う）
   ・カードの読み込み（Scryfall）、日本語名、勝率（data/ratings）
   ・パックの作り方（プレイ・ブースターに寄せた14枚）
   ・CPU のピックの考え方
   ・カード名と画像の取り出し
   画面のことはここでは扱わない（それぞれのページが持つ）。i18n.js の t() を使う */
const SCRY = "https://api.scryfall.com";
const PLAYERS = 8, PACKS = 3, PACK_SIZE = 14;
const COLORS = [
  {key:"W", var:"--w"}, {key:"U", var:"--u"}, {key:"B", var:"--b"},
  {key:"R", var:"--r"}, {key:"G", var:"--g"}, {key:"M", var:"--m"}, {key:"C", var:"--c"}
];
const colorLabel = k => t("color." + k);
const BASICS = ["Plains","Island","Swamp","Mountain","Forest"];
const landLabel = en => t("land." + en);
const SKIP_LAYOUTS = ["token","double_faced_token","art_series","emblem","scheme","planar","vanguard"];
const RAR_BASE = { common:52.0, uncommon:53.5, rare:55.0, mythic:56.0 };

let sets = [], setCode = "";
let boosterCards = [], basicCards = {}, jaMap = {}, wrMap = {}, wrAvg = null, wrSource = "";
/* ボム級＝そのセットの平均（土地を除く、試合数で重みづけ）より5ポイント以上高いGIH勝率。
   50%や60%の固定ではなく平均との差で見るのは、セットやシールド／ドラフトで平均が56〜60%ほど動くため。 */
const BOMB_PT = 0.05;
let wrBase = null;
function calcWrBase(){
  let g = 0, s = 0, n = 0;
  Object.values(wrMap).forEach(v => { if(!v.land && v.games >= 1000){ g += v.games; s += v.gih * v.games; n++; } });
  wrBase = (n >= 30 && g) ? s / g : null;
}
function isBomb(w){ return !!(w && wrBase != null && !w.land && w.gih >= wrBase + BOMB_PT); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ---------- カード取得 ---------- */
async function searchAll(query){
  let url = SCRY + "/cards/search?q=" + encodeURIComponent(query) + "&unique=cards&order=set";
  const all = [];
  while(url){
    const res = await fetch(url);
    if(res.status === 404) return [];
    if(!res.ok) throw new Error(t("err.scryfall", {s: res.status}));
    const d = await res.json();
    all.push(...d.data);
    url = d.has_more ? d.next_page : null;
    if(url) await sleep(120);
  }
  return all;
}

async function loadCards(code){
  const queries = [
    "set:" + code + " is:booster -is:extra",
    "set:" + code + " is:booster",
    "set:" + code + " -is:extra",
    "set:" + code
  ];
  let all = [];
  for(const q of queries){
    all = await searchAll(q);
    if(all.length) break;
    await sleep(120);
  }
  if(!all.length) throw new Error(t("err.cards"));
  all = all.filter(c => !SKIP_LAYOUTS.includes(c.layout));

  basicCards = {};
  all.filter(c => (c.type_line || "").startsWith("Basic Land"))
     .forEach(c => { if(!basicCards[c.name]) basicCards[c.name] = c; });
  boosterCards = all.filter(c => !(c.type_line || "").startsWith("Basic Land"));

  if(!new Set(boosterCards.map(c => c.rarity)).has("common"))
    throw new Error(t("err.commons"));
}

async function loadJapanese(code){
  jaMap = {};
  try{
    let url = SCRY + "/cards/search?q=" + encodeURIComponent("set:" + code + " lang:ja")
            + "&unique=prints&include_multilingual=true&order=set";
    while(url){
      const res = await fetch(url);
      if(!res.ok) return;
      const d = await res.json();
      d.data.forEach(c => {
        if(c.lang === "ja" && !jaMap[c.collector_number]) jaMap[c.collector_number] = c;
      });
      url = d.has_more ? d.next_page : null;
      if(url) await sleep(120);
    }
  }catch(e){ jaMap = {}; }
}

async function loadWinRates(code){
  wrMap = {}; wrSource = ""; wrAvg = null;
  const order = ["draft", "sealed"];

  for(const ev of order){
    try{
      const res = await fetch(`./data/ratings/${code.toUpperCase()}_${ev}.json`, {cache:"no-cache"});
      if(!res.ok) continue;
      const d = await res.json();
      if(!Array.isArray(d.cards)) continue;
      d.cards.forEach(c => { if(c.gih != null && c.games >= 200) wrMap[c.name] = {gih:c.gih, games:c.games, land:!!c.land}; });
      calcWrBase();
      const vals = Object.values(wrMap).map(v => v.gih);
      if(!vals.length) continue;
      wrAvg = vals.reduce((a,b) => a+b, 0) / vals.length;
      wrSource = t("mode." + ev);
      return;
    }catch(e){ /* 次へ */ }
  }
}

/* ---------- パック生成 ---------- */
/* プレイ・ブースターの構成に寄せています（14枚）。
   コモン7枚／アンコモン3枚／レアまたは神話レア1枚／土地1枚／特殊枠2枚。
   特殊枠はどのレアリティも出る枠で、ここがあるため1パックに複数のレアが入ります。
   WILD の確率は、ウィザーズ社が公表している「レア以上が1枚58%・2枚37%・3枚4%」に
   合うよう、特殊枠1つあたりレア以上を約24%として逆算した値です。
   コモンとアンコモンの内訳は非公表のため推定値で、ここを触れば調整できます。 */
const MYTHIC_RATE = 1 / 7;
const WILD_ODDS = [
  {rarity:"mythic",   p:0.035},
  {rarity:"rare",     p:0.205},
  {rarity:"uncommon", p:0.270},
  {rarity:"common",   p:0.490}
];

function rollWild(){
  let x = Math.random();
  for(const w of WILD_ODDS){ if((x -= w.p) < 0) return w.rarity; }
  return "common";
}

function buildPack(){
  const by = r => boosterCards.filter(c => c.rarity === r);
  const pools = {common: by("common"), uncommon: by("uncommon"), rare: by("rare"), mythic: by("mythic")};
  // 土地枠は、そのセットのコモン・アンコモンの土地から
  const landPool = boosterCards.filter(c => (c.type_line || "").includes("Land")
                                         && (c.rarity === "common" || c.rarity === "uncommon"));
  const out = [], used = new Set();

  /* 同じパックに同じカードが入らないように引く */
  const takeFrom = list => {
    if(!list || !list.length) return null;
    let c, guard = 0;
    do { c = pick(list); guard++; } while(used.has(c.id) && guard < 30);
    used.add(c.id);
    return c;
  };
  const take = rarity => takeFrom(pools[rarity] && pools[rarity].length ? pools[rarity] : pools.common);

  for(let i = 0; i < 7; i++) out.push(take("common"));          // コモン7枚
  for(let i = 0; i < 3; i++) out.push(take("uncommon"));        // アンコモン3枚
  out.push(take(Math.random() < MYTHIC_RATE ? "mythic" : "rare"));   // レア枠
  out.push(landPool.length ? takeFrom(landPool) : take("common"));   // 土地枠
  for(let i = 0; i < 2; i++) out.push(take(rollWild()));        // 特殊枠2枚

  return out.filter(Boolean);
}

/* ---------- 評価 ---------- */
function ratingOf(c){
  const e = wrEntry(c);
  if(e) return e.gih * 100;
  return RAR_BASE[c.rarity] ?? 52;
}

function cardColors(c){
  const front = (c.type_line || "").split("//")[0];
  if(front.includes("Land")) return [];
  return (c.color_identity || []).filter(x => "WUBRG".includes(x));
}

/* 自分が集めている色の順位から、色ごとの重みを出す */
function colorBonus(seat){
  const ranked = Object.entries(seat.colorScore).sort((a,b) => b[1] - a[1]);
  const W = [1, 0.9, 0.3, 0, 0];            // 1色目・2色目を強く、3色目は控えめに
  const b = {W:0,U:0,B:0,R:0,G:0};
  ranked.forEach(([k, v], i) => { b[k] = v > 0 ? W[i] : 0; });
  return b;
}

/* ボットのピック。カードの強さに、自分の色への寄りを加えて決める。 */
function botPick(seat, pack, pickIndex){
  const commit = Math.min(1, pickIndex / 6);   // 進むほど色を優先する
  const bonus = colorBonus(seat);
  let best = null, bestScore = -Infinity;

  for(const c of pack){
    const base = ratingOf(c);
    const cols = cardColors(c);
    let fit;
    if(!cols.length) fit = 0.5;                        // 無色・土地は中立
    else fit = cols.reduce((n, k) => n + bonus[k], 0) / cols.length;
    if(cols.length > 1) fit *= 0.9;                    // 多色はやや重い

    const score = base + commit * 4 * (fit - 0.4) + (Math.random() - 0.5) * 1.2;
    if(score > bestScore){ bestScore = score; best = c; }
  }

  const idx = pack.indexOf(best);
  pack.splice(idx, 1);
  seat.picked.push(best);
  const w = Math.max(0, ratingOf(best) - 50);
  cardColors(best).forEach(k => { seat.colorScore[k] += w; });
  return best;
}

function jaCard(c){
  return (I18N.isJa() && jaMap[c.collector_number]) || null;
}

function displayName(c){
  const src = jaCard(c) || c;
  if(src.printed_name) return src.printed_name;
  if(Array.isArray(src.card_faces)){
    const n = src.card_faces.map(f => f.printed_name).filter(Boolean);
    if(n.length) return n.join(" // ");
  }
  return c.name;
}

function imageUrls(c){
  const src = jaCard(c) || c;
  if(src.image_uris?.normal) return [src.image_uris.normal];
  if(Array.isArray(src.card_faces)){
    const u = src.card_faces.map(f => f.image_uris?.normal).filter(Boolean);
    if(u.length) return u;
  }
  if(src !== c){
    if(c.image_uris?.normal) return [c.image_uris.normal];
    if(Array.isArray(c.card_faces)) return c.card_faces.map(f => f.image_uris?.normal).filter(Boolean);
  }
  return [];
}

/* 出来事・両面・分割カードは、集計データ側が表面の名前だけを持っている。
   「A // B」のままでは引けないので、表面の名前でも探す。 */
function wrEntry(c){
  if(!c) return null;
  const cands = [c.name];
  if(c.name && c.name.includes(" // ")) cands.push(c.name.split(" // ")[0].trim());
  if(Array.isArray(c.card_faces)) c.card_faces.forEach(f => { if(f.name) cands.push(f.name); });
  for(const n of cands){ if(wrMap[n]) return wrMap[n]; }
  return null;
}

