#!/usr/bin/env node
/*
 * 「〇〇環境まとめ」の長尺動画（横長 1920×1080・3〜5分）を、記事データと勝率一覧から作る。試作版（日本語のみ）。
 *
 *   node maintenance/build-long.mjs TMT           … 日本語（VOICEVOX）
 *   LONG_STILLS=1 node maintenance/build-long.mjs TMT   … 場面の画像だけ作って終わる（音声・動画なし。レイアウト確認用）
 *
 * 出力: long/<SET>/ja.mp4 、 long/<SET>/chapters.txt（YouTube の概要欄に貼る目次）、 long/<SET>/description.txt、
 *       途中生成物（台本 script.json、場面ごとの png / wav）
 *
 * 中身: 環境の速さ → 色の強さ → 2色の組み合わせ（上位3つを深堀り＋最弱）→ ドラフトとシールドの違い
 *       → 神話レア・レアのボム上位10枚 → 罠カード → コモン・アンコモンの除去（平均より強いものだけ） → まとめ
 *       （色の組み合わせの深堀りでは、コモン・アンコモンだけで鍵カードを選ぶ。勝率がそこそこ高く使用率が低い色は「狙い目」として特設）
 *       ドラフトとシールドの両方のデータ（data/articles と data/ratings）を使う。
 *
 * 材料
 *   ・data/articles/<SET>_draft.json と <SET>_sealed.json（どちらも必要）
 *   ・data/ratings/<SET>_PremierDraft.json と <SET>_Sealed.json（カードごとの勝率）
 *   ・コモンの除去は、data/profiles/<SET>.json の除去一覧があればそれを、無ければ Scryfall からオラクル文を取って判定する。
 *     どちらも取れなければ、その場面は入れない
 *   ・ほかは build-short.mjs と同じ（VOICEVOX、背景 short/bg.mp4、BGM short/bgm/、読み辞書 short/yomi.json）
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const SET = process.argv[2];
if(!SET){ console.error("使い方: node maintenance/build-long.mjs <SET>"); process.exit(1); }
const VV = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
const SPEAKER = +(process.env.VOICEVOX_SPEAKER || 3);
const SPEED = +(process.env.VOICEVOX_SPEED || 1.2);              // 長尺は聞き取りやすさ優先で、ショートと同じ速さ（3〜5分に収めるため）
const OUT = `long/${SET}`;
const SITE = "sealed-workbench.com";
const BG = process.env.SHORT_BG || "short/bg.mp4";
const STILLS = !!process.env.LONG_STILLS;
const UA = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" };

const W = 1920, H = 1080, SCALE = 1.5;
const PINE = "#10304F", DEEP = "#0A2038", BLUE = "#2F7DF6", PAPER = "#F5F8FC", MUTED = "#A9C2DE";
const UP = "#5B9BFF", DOWN = "#F08A3E", GOLD = "#F2C94C", GREEN = "#4CC38A";
const COLOR = { W: "#F3EAC6", U: "#4A90E2", B: "#6B5E7A", R: "#E1553E", G: "#3E9B5B" };
const CJ = { W: "白", U: "青", B: "黒", R: "赤", G: "緑" };
const ORDER = "WUBRG";
const FONT = "'Noto Sans CJK JP','Noto Sans JP',sans-serif";
const CAP_Y = 900;                                   // 字幕を置く高さ（これより上に図を置く）

const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const pt = v => (v * 100).toFixed(1);
const sgn = v => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1);
const man = n => n >= 10000 ? `${Math.round(n / 10000)}万` : n.toLocaleString("ja-JP");
const pairName = p => [...p].map(c => CJ[c] || c).join("");
const norm = p => [...p].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join("");
const T = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 40}" fill="${o.fill || PAPER}" font-weight="${o.weight || 400}"` +
  `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.op != null ? ` opacity="${o.op}"` : ""}>${esc(s)}</text>`;
const TS = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 100}" fill="${o.fill || "#FFFFFF"}" font-weight="900"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}` +
  ` stroke="#06101C" stroke-width="${Math.round((o.size || 100) * 0.16)}" stroke-linejoin="round" paint-order="stroke">${esc(s)}</text>`;
function wrapName(name, n){
  const t = String(name), ch = [...t];
  if(ch.length <= n) return [t];
  const brk = Math.max(t.lastIndexOf("、", n), t.lastIndexOf("・", n), t.lastIndexOf("＆", n));
  if(brk >= 2 && ch.length - brk - 1 <= n) return [ch.slice(0, brk + 1).join(""), ch.slice(brk + 1).join("")];
  return [ch.slice(0, n).join(""), ch.slice(n, n * 2 - 1).join("") + (ch.length > n * 2 - 1 ? "…" : "")];
}
function shortName(n){
  const m = String(n).replace(/^Magic:\s*The Gathering\s*[:|｜-]?\s*/i, "").split(/\s*[｜|]\s*/);
  return (m[m.length - 1] || "").trim() || String(n);
}
async function setNameJa(code){
  try{
    const src = await readFile("i18n.js", "utf8");
    const m = src.match(/const SET_JA = (\{[\s\S]*?\});/);
    if(m) return new Function("return " + m[1])()[code.toLowerCase()];
  }catch(e){}
  return null;
}

/* ------------------------------------------------------------ 材料の集計 */

const SYM = {};
function symbol(c, x, y, size){
  if(SYM[c]) return `<svg x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" viewBox="${SYM[c].viewBox}">${SYM[c].inner}</svg>`;
  return `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${COLOR[c] || MUTED}"/>` +
         T(x, y + size * 0.17, CJ[c] || c, { size: size * 0.42, weight: 900, anchor: "middle", fill: c === "W" ? DEEP : PAPER });
}
const pairSymbols = (pair, x, y, size) => [...pair].map((c, i) => symbol(c, x + i * (size + 10) + size / 2, y, size)).join("");

function pairRows(d){
  const mono = Object.fromEntries((d.colors || []).map(c => [c.color, c.wr]));
  return (d.archetypes || [])
    .filter(a => a.colors && a.colors.length === 2 && a.wr != null)
    .map(a => ({ pair: norm(a.colors), wr: a.wr, games: a.games || 0, exp: (mono[a.colors[0]] + mono[a.colors[1]]) / 2 }))
    .sort((a, b) => b.wr - a.wr);
}

/* 除去の判定（build-set-profile.mjs と同じ。クリーチャーを直接どうにかする呪文・能力のだいたいの目安） */
const face = c => (c.card_faces && c.card_faces[0]) || c;
const oracle = c => (c.card_faces ? c.card_faces.map(f => f.oracle_text || "").join("\n") : (c.oracle_text || ""));
const isCreature = c => /Creature/.test(face(c).type_line || "");
const isRemoval = c => {
  const t = oracle(c).replace(/\([^)]*\)/g, "");
  if(isCreature(c) && !/\b(enters|when .* enters)/i.test(t)) return false;
  return /\b(destroy|exile) target (creature|permanent|nonland permanent|artifact or creature|creature or planeswalker)/i.test(t)
      || /deals? \d+ damage to (any target|target creature|target creature or planeswalker|target creature or player|each creature)/i.test(t)
      || /target creature gets [-−]\d+\/[-−]\d+/i.test(t)
      || /target creature .* (loses all abilities|can't attack or block)/i.test(t)
      || /(destroy|exile) all creatures/i.test(t)
      || /\bfight\b|\bbites?\b/i.test(t) && /target creature/i.test(t);
};
/* コモン・アンコモンの除去カード名の一覧を返す。取れなければ null */
async function loadRemovalNames(){
  const prof = await readJson(`data/profiles/${SET}.json`, null);
  const fromProf = prof && (prof.removalCards || (prof.counts && prof.counts.removalCards));
  if(Array.isArray(fromProf) && fromProf.length){
    const names = fromProf.map(c => c.name);        // レア度の絞り込みは、台本のほうでする（コモンとアンコモンの両方を使う）
    if(names.length) return { names, from: "プロフィールデータ" };
  }
  if(process.env.LONG_TEST_REMOVAL) return { names: process.env.LONG_TEST_REMOVAL.split("|"), from: "テスト用の仮データ" };
  try{
    const all = [];
    let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${SET.toLowerCase()} (r:common or r:uncommon)`)}&unique=cards`;
    while(url){
      const r = await fetch(url, { headers: { ...UA, Accept: "application/json" } });
      if(!r.ok) break;
      const j = await r.json();
      all.push(...j.data);
      url = j.has_more ? j.next_page : null;
      if(url) await new Promise(res => setTimeout(res, 120));
    }
    const names = all.filter(isRemoval).map(c => c.name);
    if(names.length) return { names, from: "Scryfall のオラクル文" };
  }catch(e){}
  return null;
}

/* ------------------------------------------------------------ 台本 */

function buildScript(ctx){
  const { dd, ds, rd, rs, nm, nameJa } = ctx;                       // dd/ds: 記事（ドラフト/シールド）、rd/rs: 勝率一覧
  const J = n => (nm.names || {})[n] || n;
  const scenes = [];
  const gamesD = dd.total_games, gamesS = ds.total_games;
  const avgD = rd.overall_win_rate, avgS = rs.overall_win_rate;
  const cardOf = (list, name) => list.find(c => c.name === name);

  // 試合数がごく少ない組み合わせ（全体の3%未満・1500試合未満）は、勝率がぶれるので順位に入れない
  const enough = rows => { const tot = rows.reduce((n, p) => n + p.games, 0) || 1; const f = rows.filter(p => p.games >= Math.max(1500, tot * 0.03)); return f.length >= 3 ? f : rows; };
  const pairsD = enough(pairRows(dd)), pairsS = enough(pairRows(ds));
  const bestD = pairsD[0];
  const totalPG = pairsD.reduce((n, p) => n + p.games, 0) || 1;
  const solid = pairsD.filter(p => p.games >= Math.max(2000, totalPG * 0.04));
  const worstD = (solid.length ? solid : pairsD).slice().sort((a, b) => a.wr - b.wr)[0];
  const rankS = Object.fromEntries(pairsS.map((p, i) => [p.pair, i + 1]));
  const rankD = Object.fromEntries(pairsD.map((p, i) => [p.pair, i + 1]));
  const monoD = (dd.colors || []).slice().sort((a, b) => b.wr - a.wr);
  const monoS = Object.fromEntries((ds.colors || []).map(c => [c.color, c.wr]));
  /* 狙い目の色：勝率がそこそこ高く（全体の平均付近以上）、使っている人が少なめ（平均の85%以下）。最大2つ */
  const avgShareP = 1 / pairsD.length;
  const sleepers = pairsD.filter(p => p !== bestD && p !== worstD && p.wr >= avgD - 0.005 && p.games / totalPG <= avgShareP * 0.85 && p.games >= 1500)
    .sort((a, b) => b.wr - a.wr).slice(0, 2);
  const sleepersTop = pairsD.slice(0, 3).filter(p => sleepers.includes(p));

  /* --- 冒頭 --- */
  scenes.push({ kind: "hook", art: true, chapter: "はじめに",
    say: `MTGアリーナ、リミテッドの${nameJa}環境を、${man(gamesD + gamesS)}試合のデータでまるごと解説します。最強の色の組み合わせ、迷わず取っていいボムのレア十枚、見た目に反して勝てない罠なレアカード、そして、コモンとアンコモンの強い除去まで。ドラフトとシールドの両方のデータで見ていきます。`,
    title: nameJa, gamesD, gamesS, tail: 0.6 });
  scenes.push({ kind: "agenda", say: `順番に、環境の速さ、色の組み合わせ、ボム、罠なレアカード、除去まで見ていきます。`,
    items: ["環境の速さ", "色の強さ", "色の組み合わせ", "狙い目の色", "ドラフトとシールドの違い", "ボムのレア10枚", "罠なレアカード", "除去（コモン・アンコモン）"], tail: 0.4 });

  /* --- 速さ --- */
  const paceRows = d => (d.speed || []).filter(s => s.wr != null && s.games).map((s, i, a) => ({
    label: i === 0 ? `${s.max}未満` : s.max ? `${a[i - 1].max}〜${s.max}` : `${a[i - 1].max}以上`, wr: s.wr }));
  const bestBand = rows => rows.reduce((m, r) => r.wr > m.wr ? r : m, rows[0]);
  const rowsD = paceRows(dd), rowsS = paceRows(ds);
  if(rowsD.length){
    const vk = (dd.verdict || {}).key, VW = { fast: "速い", "lean-fast": "やや速い", even: "普通", "lean-slow": "やや遅い", slow: "遅い" };
    const word = VW[vk] || "普通";
    const bD = bestBand(rowsD), bS = rowsS.length ? bestBand(rowsS) : null;
    const turns = dd.avg_turns ? `ゲームは平均${dd.avg_turns.toFixed(1)}ターンです。` : "";
    // 一番勝っている帯が、軽い側か重い側か（最初の帯＝軽い、最後の帯＝重い、それ以外＝まんなか）
    const dirOf = (rows, b) => { const i = rows.indexOf(b); return i === 0 ? "light" : i === rows.length - 1 ? "heavy" : "mid"; };
    const DIRJ = { light: "軽いデッキ", heavy: "重いデッキ", mid: "中くらいの重さのデッキ" };
    const dirD = dirOf(rowsD, bD), dirS = bS ? dirOf(rowsS, bS) : null;
    const spread = rows => Math.max(...rows.map(r => r.wr)) - Math.min(...rows.map(r => r.wr));
    const sameDir = !bS || dirS === dirD;
    const tagD = dirD === "light" ? "軽いほど有利" : dirD === "heavy" ? "重いほど有利" : "中くらいが有利";
    const tagS = bS ? (dirS === "light" ? "軽いほど有利" : dirS === "heavy" ? "重いほど有利" : "中くらいが有利") : "";
    let sealedSay = "";
    if(bS){
      sealedSay = sameDir
        ? `シールドでも傾向は同じで、勝率が最も高いのは平均マナ総量${bS.label}のデッキの${pt(bS.wr)}パーセントです。`
        : `ところがシールドでは逆で、勝率が最も高いのは平均マナ総量${bS.label}の${DIRJ[dirS]}の${pt(bS.wr)}パーセントです。` +
          (spread(rowsS) < 0.02 ? `ただ、帯ごとの差は小さいので、シールドでは速さをあまり気にしなくて大丈夫です。` : `シールドでは、${DIRJ[dirS]}のほうが勝ちやすいということです。`);
    }
    scenes.push({ kind: "pace", chapter: "環境の速さ", word, rowsD, rowsS, tagD, tagS,
      sub: vk === "fast" || vk === "lean-fast" ? "ドラフトは軽いデッキが勝ちやすい" : vk === "slow" || vk === "lean-slow" ? "ドラフトは重いデッキが勝ちやすい" : "ドラフトは速さで差がつきにくい",
      say: `まず環境の速さ。ドラフトのデータでは、${word}環境です。平均マナ総量が${bD.label}のデッキが、勝率${pt(bD.wr)}パーセントで一番勝っています。${turns}` + sealedSay,
      tail: 0.6 });
  }

  /* --- 色の強さ --- */
  if(monoD.length){
    const a = monoD[0], b = monoD[1], last = monoD[monoD.length - 1];
    scenes.push({ kind: "colors", chapter: "色の強さ", colors: monoD, monoS,
      say: `次に、単色の強さ。ドラフトで一番勝っているのは${CJ[a.color]}の${pt(a.wr)}パーセント、次が${CJ[b.color]}の${pt(b.wr)}パーセントです。一番低いのは${CJ[last.color]}で${pt(last.wr)}パーセント。ただ、色の差は小さいので、色よりも、これから見る色の組み合わせとカードの質を優先してください。`,
      tail: 0.6 });
  }

  /* --- 色の組み合わせ --- */
  if(pairsD.length){
    scenes.push({ kind: "pairs", chapter: "色の組み合わせ", pairsD, rankS, bestD, worstD,
      say: `色の組み合わせです。ドラフトで一番強いのは${pairName(bestD.pair)}、勝率${pt(bestD.wr)}パーセント。上位三つは、${pairsD.slice(0, 3).map(p => pairName(p.pair)).join("、")}です。` +
           (sleepersTop.length ? `このうち${sleepersTop.map(p => pairName(p.pair)).join("と")}は、使う人が少ない狙い目なので、あとで紹介します。` : "") +
           `青い棒がドラフト、黄色い棒がシールドの勝率です。` + (pairsD.slice(0, 3).every((p, i) => rankS[p.pair] === i + 1) ? `シールドでも、上位の顔ぶれは同じです。` : `シールドでは順位が入れ替わっているのが分かります。`),
      tail: 0.6 });
  }

  /* --- 上位3つ＋最弱の深堀り --- */
  // 鍵になるカード：レアは引きにくいので、コモンとアンコモンだけで選ぶ。2色のどちらのカードも入れる
  //   （各色の単色カードの最上位を1枚ずつ → 残りを、勝率の高い順に、2色の取り合わせで埋める。合計4枚）
  // コモンを最低1枚は入れる（アンコモンだけだと「それは強いだろう」と思われるため）。入っていなければ、勝率の最も高いコモンを入れ、いちばん勝率の低い1枚と入れ替える
  //   （2色の両方のカードを入れる決まりは保つ。コモンが1枚も無いときだけ、そのまま）
  const withCommon = (picked, list, n, keepColors = []) => {
    if(picked.some(c => c.rarity === "common")) return picked;
    const com = list.find(c => c.rarity === "common" && !picked.includes(c));
    if(!com) return picked;
    const out = picked.slice(0, n), cover = col => out.filter(c => c.color === col).length;
    const drop = [...out].sort((a, b) => a.pg - b.pg).find(c => !keepColors.includes(c.color) || cover(c.color) > 1) || out[out.length - 1];
    if(out.length < n){ out.push(com); return out; }
    out[out.indexOf(drop)] = com;
    return out;
  };
  const keyCards = (pair, n = 4) => {
    const [A, B] = [...pair];
    const inPair = c => !!c.color && [...c.color].every(ch => pair.includes(ch));   // 無色は入れない。相手の2色に入っていない色のカード（タッチで入る他の色）も除く
    const list = rd.cards.filter(c => !c.land && inPair(c) && (c.rarity === "common" || c.rarity === "uncommon") && c.by_pair && c.by_pair[pair] && c.by_pair[pair][1] >= 250)
      .map(c => ({ ...c, pg: c.by_pair[pair][0], pgames: c.by_pair[pair][1] })).sort((x, y) => y.pg - x.pg);
    const picked = [];
    for(const col of [A, B]){ const c = list.find(x => x.color === col && !picked.includes(x)); if(c) picked.push(c); }
    for(const c of list){ if(picked.length >= n) break; if(!picked.includes(c)) picked.push(c); }
    const cols = c => c.color === A ? A : c.color === B ? B : "";
    return withCommon(picked.slice(0, n), list, n, [A, B]).sort((x, y) => y.pg - x.pg).map(c => ({ ...c, label: J(c.name), side: cols(c) }));
  };
  // 勝ちにくい組み合わせでは、2色のうち「弱いほうの色」のカードから選ぶ（強い色のカードを紹介すると、勝てない理由と合わなくなる）
  //   弱い色の単色カードを勝率の高い順に。足りなければ、2色のカード（その弱い色を含む）で埋める
  const weakColorOf = pair => {
    const [A, B] = [...pair], w = col => (monoD.find(c => c.color === col) || {}).wr;
    return (w(A) ?? 1) <= (w(B) ?? 1) ? A : B;
  };
  const keyCardsWeak = (pair, weak, n = 4) => {
    const inPair = c => !!c.color && [...c.color].every(ch => pair.includes(ch)) && c.color.includes(weak);
    const list = rd.cards.filter(c => !c.land && inPair(c) && (c.rarity === "common" || c.rarity === "uncommon") && c.by_pair && c.by_pair[pair] && c.by_pair[pair][1] >= 250)
      .map(c => ({ ...c, pg: c.by_pair[pair][0], pgames: c.by_pair[pair][1] })).sort((x, y) => y.pg - x.pg);
    const picked = [...list.filter(c => c.color === weak).slice(0, n)];
    for(const c of list){ if(picked.length >= n) break; if(!picked.includes(c)) picked.push(c); }
    return withCommon(picked.slice(0, n), list, n, [weak]).sort((x, y) => y.pg - x.pg).map(c => ({ ...c, label: J(c.name), side: c.color === weak ? weak : "" }));
  };
  // 鍵になるカードを、色ごとに言い分けた一文にする
  // 鍵になるカードの言い方。コモン・アンコモンで集めやすい、という説明は最初の1回だけ丁寧に言い、2回目以降は言い回しを変えて、くり返しに聞こえないようにする
  let keyN = 0;
  const KEY_LEAD = ["鍵になるのは、", "注目は、", "押さえたいのは、", "この色の主役は、", "狙いたいのは、"];
  const KEY_MORE = ["ほかに、", "さらに、", "ほかにも、", "あわせて、", "そして、"];
  const KEY_TAIL = [
    "どれもコモンかアンコモンなので、集めやすいカードです。",
    "こちらも、コモンとアンコモンだけで揃います。",
    "",
    "今回も、手に入れやすいカードばかりです。",
    ""
  ];
  const keySay = (ks, pair) => {
    if(!ks.length) return "";
    const n = keyN++;
    const [A, B] = [...pair];
    const ofCol = col => ks.find(c => c.side === col);
    const a = ofCol(A), b = ofCol(B), rest = ks.filter(c => c !== a && c !== b);
    const q = c => `「${c.label}」`;
    const parts = [a && `${CJ[A]}は${q(a)}`, b && `${CJ[B]}は${q(b)}`].filter(Boolean);
    let t = KEY_LEAD[n % KEY_LEAD.length] + (parts.length ? parts.join("、") : ks.slice(0, 2).map(q).join("、")) + "。";
    if(parts.length && rest.length) t += `${KEY_MORE[n % KEY_MORE.length]}${rest.slice(0, 2).map(q).join("、")}もおすすめです。`;
    return t + KEY_TAIL[n % KEY_TAIL.length];
  };
  const deep = (p, i, kind) => {
    const share = p.games / totalPG, avgShare = 1 / pairsD.length;
    const weak = kind === "worst" ? weakColorOf(p.pair) : null;
    const ks = kind === "worst" ? keyCardsWeak(p.pair, weak) : keyCards(p.pair);
    const sealedWr = (pairsS.find(x => x.pair === p.pair) || {}).wr;
    const ordinal = ["一番", "二番目に", "三番目に"][i];
    const sleeperSay = () => {
      const rk = rankD[p.pair] <= 3 ? `ドラフト${rankD[p.pair]}位で、` : "";
      const rel = p.wr >= avgD ? `これは全体の平均${pt(avgD)}パーセントを上回っています。` : `これは全体の平均${pt(avgD)}パーセントと、ほぼ同じです。`;
      return `${pairName(p.pair)}は、${rk || "ドラフトの"}勝率は${pt(p.wr)}パーセント。${rel}それなのに、使っている人は全体の${Math.round(share * 100)}パーセントで、平均の${Math.round(avgShare * 100)}パーセントより少なめです。` +
        `カードの取り合いになりにくいので、強い色が流れてこないときの、狙い目です。` + keySay(ks, p.pair) + (sealedWr != null ? `シールドの勝率は${pt(sealedWr)}パーセントです。` : "");
    };
    const say = kind === "sleeper" ? sleeperSay() : kind === "worst"
      ? `反対に、一番勝ちにくいのは${pairName(p.pair)}で、勝率${pt(p.wr)}パーセント。` + (ks.length ? `それでも、${CJ[weak]}の「${ks[0].label}」のように、この組み合わせで光るカードはあります。` : "") + `カードが流れてきた、という理由がなければ、無理に目指さなくて大丈夫です。`
      : `${ordinal}強い${pairName(p.pair)}。ドラフトの勝率は${pt(p.wr)}パーセントで、使われているのは全体の${Math.round(share * 100)}パーセントです。` + keySay(ks, p.pair) + (sealedWr != null ? `シールドの勝率は${pt(sealedWr)}パーセントです。` : "");
    return { kind: "deep", chapter: null, variant: kind, weak, pair: p.pair, wr: p.wr, sealedWr, share, avgShare, rank: rankD[p.pair], cards: ks, say, tail: 0.5 };
  };
  // 上位3つの深堀り（狙い目に回るものは、そちらで紹介するので、ここでは飛ばす）。順位の言い方は、実際の順位から決める
  pairsD.slice(0, 3).forEach((p, i) => { if(!sleepers.includes(p)) scenes.push(deep(p, i, "top")); });
  if(worstD && worstD !== bestD) scenes.push(deep(worstD, 0, "worst"));

  /* --- 狙い目の色：勝率がそこそこ高く（全体の平均付近以上）、使っている人が少なめ（平均の85%以下）。最大2つ --- */
  sleepers.forEach((p, i) => {
    const sc = deep(p, 0, "sleeper");
    if(i === 0){ sc.chapter = "狙い目の色"; sc.say = `ここで、狙い目の色を紹介します。勝率がそこそこ高くて、使う人が少ない、つまりカードが取りやすい色の組み合わせです。` + sc.say; }
    else sc.say = `もう一つ。` + sc.say;
    scenes.push(sc);
  });

  /* --- ドラフトとシールドの違い --- */
  {
    const both = pairsD.filter(p => rankS[p.pair] && p.games >= 1500).map(p => ({ ...p, rd: rankD[p.pair], rs: rankS[p.pair], diff: rankD[p.pair] - rankS[p.pair] }));
    const upC = both.slice().sort((a, b) => b.diff - a.diff)[0], downC = both.slice().sort((a, b) => a.diff - b.diff)[0];
    const up = upC && upC.diff > 0 ? upC : null, down = downC && downC.diff < 0 ? downC : null;
    const cardsBoth = rd.cards.filter(c => !c.land && (c.rarity === "rare" || c.rarity === "mythic") && c.games >= 1500)
      .map(c => { const s = cardOf(rs.cards, c.name); return s && s.games >= 500 ? { name: c.name, label: J(c.name), d: c.gih, s: s.gih, diff: s.gih - c.gih } : null; }).filter(Boolean);
    const cUp = cardsBoth.slice().sort((a, b) => b.diff - a.diff).slice(0, 3), cDown = cardsBoth.slice().sort((a, b) => a.diff - b.diff).slice(0, 3);
    let say = `ドラフトとシールドの違いです。シールドは、配られた六パックから組むので、ドラフトのように色を選べません。`;
    if(up && up.diff > 0) say += `${pairName(up.pair)}は、ドラフトで${up.rd}位、シールドで${up.rs}位と、シールドのほうが強く出ています。`;
    if(down && down.diff < 0) say += `逆に${pairName(down.pair)}は、ドラフトで${down.rd}位、シールドでは${down.rs}位です。`;
    say += `カードで見ると、シールドで評価が上がるのは${cUp.slice(0, 2).map(c => c.label).join("、")}。下がるのは${cDown.slice(0, 2).map(c => c.label).join("、")}です。`;
    scenes.push({ kind: "dvs", chapter: "ドラフトとシールドの違い", up, down, cUp, cDown, avgD, avgS, say, tail: 0.6 });
  }

  /* --- ボム10枚 --- */
  const rareD = rd.cards.filter(c => !c.land && (c.rarity === "rare" || c.rarity === "mythic") && c.games >= 1500).sort((a, b) => b.gih - a.gih);
  const bombs = rareD.slice(0, 10).map((c, i) => {
    const s = cardOf(rs.cards, c.name);
    return { ...c, label: J(c.name), rank: i + 1, sGih: s && s.games >= 300 ? s.gih : null, sGames: s ? s.games : 0 };
  });
  if(bombs.length >= 10){
    scenes.push({ kind: "bombs", chapter: "ボムのレア10枚", cards: bombs.slice(0, 5), avgD, part: 1,
      say: `ここからがボム、十枚です。引いた試合の勝率、GIH勝率の高い順で、神話レアとレアから選びました。試合数が少ないカードは数字がぶれるので、千五百試合以上のカードに限っています。` +
           bombs.slice(0, 5).map(c => `${c.rank}位、${c.label}、${pt(c.gih)}パーセント。`).join(""), tail: 0.6 });
    scenes.push({ kind: "bombs", chapter: null, cards: bombs.slice(5, 10), avgD, part: 2,
      say: bombs.slice(5, 10).map(c => `${c.rank}位、${c.label}、${pt(c.gih)}パーセント。`).join("")
         + `これらは、引けたら、色が少し合わなくても、デッキの軸にして構わないカードです。全体の平均勝率は${pt(avgD)}パーセントなので、どれも大きく上回っています。`, tail: 0.6 });
  }

  if(bombs.length >= 3) scenes[0].cards = bombs.slice(0, 3);     // 冒頭の画面に並べるボム

  /* --- 罠カード --- */
  const rl = rd.cards.filter(c => !c.land && (c.rarity === "rare" || c.rarity === "mythic") && c.games >= 1500);
  const rareAvg = rl.reduce((n, c) => n + c.gih * c.games, 0) / (rl.reduce((n, c) => n + c.games, 0) || 1);
  const traps = rd.cards.filter(c => !c.land && (c.rarity === "rare" || c.rarity === "mythic") && c.games >= 2500 && c.gih <= rareAvg - 0.015)
    .sort((a, b) => a.gih - b.gih).slice(0, 5).map(c => {
      const s = cardOf(rs.cards, c.name);
      return { ...c, label: J(c.name), sGih: s && s.games >= 300 ? s.gih : null };
    });
  if(traps.length >= 3){
    scenes.push({ kind: "traps", chapter: "罠なレアカード", cards: traps, avgD, rareAvg,
      say: `次は、罠なレアカード。レアなのに、引いた試合の勝率がレア全体の平均より低いものです。レアの平均は${pt(rareAvg)}パーセント。` +
           traps.map((c, i) => `${c.label}は${pt(c.gih)}パーセント。`).join("") +
           `弱いカードという意味ではなく、デッキに入れて、うまく使えていないことが多い、ということです。ほかに強いカードがあるなら、無理に使わなくていいです。`, tail: 0.6 });
  }

  /* --- 除去（コモン・アンコモン）：そのレア度の平均より勝率が高いものだけ。無理に5枚にしない --- */
  const NUM = ["", "一", "二", "三", "四", "五"];
  const remScene = (rarity, jp, chapter) => {
    if(!ctx.removal) return null;
    const set = new Set(ctx.removal.names);
    const pool = rd.cards.filter(c => c.rarity === rarity && !c.land && c.games >= 1500);
    const avg = pool.reduce((n, c) => n + c.gih * c.games, 0) / (pool.reduce((n, c) => n + c.games, 0) || 1);
    const all = pool.filter(c => set.has(c.name)).sort((a, b) => b.gih - a.gih);
    const rem = all.filter(c => c.gih > avg).slice(0, 5).map((c, i) => ({ ...c, label: J(c.name), rank: i + 1 }));
    if(!rem.length) return null;
    const n = rem.length, dropped = all.length - all.filter(c => c.gih > avg).length;
    const intro = n === 5 ? `${jp}の除去を、強い順に五枚。` : `${jp}の除去で、平均より勝率が高いのは、${NUM[n]}枚だけでした。`;
    const why = rarity === "common" ? `コモンは、パックに一番多く入っているので、強い除去を知っておくと、デッキが安定します。` : `アンコモンは、コモンより数が少ないぶん、引けたときに頼りになります。`;
    const tail = dropped > 0 ? `平均を下回る除去は、あえて入れていません。` : "";
    return { kind: "removal", chapter, rarity, jp, cards: rem, avgD, commonAvg: avg,
      say: intro + why + rem.map(c => `${c.rank}位、${c.label}、${pt(c.gih)}パーセント。`).join("") + `${jp}全体の平均が${pt(avg)}パーセントです。` + tail, tail: 0.6 };
  };
  const remC = remScene("common", "コモン", "除去の強さ順"), remU = remScene("uncommon", "アンコモン", "除去の強さ順");
  // 章は1つにまとめる（目次には、最初のほうだけ出る）
  if(remC) scenes.push(remC);
  if(remU){ if(remC) remU.chapter = null; scenes.push(remU); }

  /* --- まとめ --- */
  {
    const paceSc = scenes.find(x => x.kind === "pace");
    const bestMono = monoD[0];
    const sealedBest = bestD ? (pairsS.find(x => x.pair === bestD.pair) || {}).wr : null;
    const b3 = bombs.slice(0, 3), t3 = traps.slice(0, 3);
    const remSc = scenes.find(x => x.kind === "removal"), r3 = remSc ? remSc.cards.slice(0, 3) : [];
    const sum = {
      kind: "summary", chapter: "まとめ",
      pace: paceSc ? { word: paceSc.word, sub: paceSc.sub } : null,
      mono: bestMono ? { color: bestMono.color, wr: bestMono.wr } : null,
      best: bestD ? { pair: bestD.pair, wr: bestD.wr, sWr: sealedBest } : null,
      worst: worstD && worstD !== bestD ? { pair: worstD.pair, wr: worstD.wr } : null,
      b3, t3, r3, cards: [...b3, ...t3, ...r3]
    };
    sum.say = `まとめです。` +
      (sum.pace ? `この環境は、${sum.pace.word}環境です。` : "") +
      (sum.mono ? `色では${pairName(sum.mono.color)}が最も強く、` : "") +
      (sum.best ? `組み合わせなら${pairName(sum.best.pair)}。ドラフトの勝率は${pt(sum.best.wr)}パーセントです。` : "") +
      (sum.worst ? `反対に${pairName(sum.worst.pair)}は${pt(sum.worst.wr)}パーセントで、無理に目指さなくて大丈夫です。` : "") +
      (b3.length ? `迷わず取るボムは、${b3.map(c => c.label).join("、")}。` : "") +
      (t3.length ? `罠になりやすいのは、${t3.slice(0, 2).map(c => c.label).join("、")}です。` : "") +
      (r3.length >= 2 ? `${remSc.jp}の除去では、${r3[0].label}と${r3[1].label}が頼れます。` : "") +
      `カードごとの勝率の一覧は、サイトで見られます。`;
    sum.tail = 0.8;
    scenes.push(sum);
  }

  scenes.push({ kind: "outro", art: true, chapter: null,
    say: `次のセットも出すので、MTGのリミテッドプレイヤーは、チャンネル登録をお願いします。`, tail: 9 });
  return scenes;
}

/* ------------------------------------------------------------ 画面 */

let HAS_BG = false;
const HEADER = { title: "" };
function header(sc){
  const band = `<rect x="40" y="24" width="${W - 80}" height="84" rx="20" fill="${DEEP}" opacity="${HAS_BG ? 0.6 : 0.35}"/>`;
  return band + T(76, 82, HEADER.title, { size: 42, fill: BLUE, weight: 900 }) +
    T(W - 76, 80, sc.crumb || "リミテッド環境分析", { size: 34, fill: MUTED, weight: 700, anchor: "end" });
}
/* 1990年代のRPG風の青いウィンドウ（青のグラデーション＋白い二重の枠）。accent を渡すと内側の細い線がその色になる */
const panel = (x, y, w, h, accent) =>
  `<rect x="${x + 5}" y="${y + 7}" width="${w}" height="${h}" rx="22" fill="#000" opacity="0.35"/>` +
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="url(#ffw)" fill-opacity="${HAS_BG ? 0.93 : 0.9}" stroke="#F4F7FF" stroke-width="5"/>` +
  `<rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" rx="14" fill="none" stroke="${accent || "#8FA8F0"}" stroke-width="2" opacity="0.8"/>`;
function frame(inner, sc, o = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PINE}"/><stop offset="1" stop-color="${DEEP}"/></linearGradient><linearGradient id="ffw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A4FC4"/><stop offset="1" stop-color="#0B1763"/></linearGradient></defs>
  ${HAS_BG ? "" : `<rect width="${W}" height="${H}" fill="url(#bg)"/>`}
  ${o.header === false ? "" : header(sc)}
  ${inner}
</svg>`;
}

/* カード画像（取れなければ色付きの札） */
function cardImg(c, x, y, w, h){
  const col = COLOR[(c.color || "")[0]] || MUTED;
  if(c.imgPath) return `<image href="${c.imgPath}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.05}" fill="${col}" opacity="0.85"/>` +
         `<rect x="${x + w * 0.06}" y="${y + w * 0.06}" width="${w * 0.88}" height="${h * 0.46}" rx="8" fill="${DEEP}" opacity="0.5"/>` +
         T(x + w / 2, y + h * 0.7, wrapName(c.label, 8)[0], { size: Math.max(16, w * 0.09), weight: 700, anchor: "middle", fill: DEEP });
}

/* カードを横に並べる場面（ボム・罠・除去）。stats は各カードの下に出す行 */
function cardRow(cards, stats, accent, y0 = 140){
  // 番号の丸は、カードの上の余白に置く（カードに重ねると、カード自身の名前の欄を隠してしまう）。y0 はカード上端
  const n = cards.length, CW = 270, CH = 376, gap = 54, total = n * CW + (n - 1) * gap, x0 = (W - total) / 2;
  let s = "";
  cards.forEach((c, i) => {
    const x = x0 + i * (CW + gap);
    s += `<circle cx="${x + 28}" cy="${y0 - 30}" r="26" fill="${DEEP}" stroke="${accent}" stroke-width="4"/>` + T(x + 28, y0 - 17, String(c.rank || i + 1), { size: 34, weight: 900, anchor: "middle", fill: accent });
    s += cardImg(c, x, y0, CW, CH);
    const lines = wrapName(c.label, 9);
    lines.forEach((l, j) => { s += T(x + CW / 2, y0 + CH + 46 + j * 36, l, { size: 30, weight: 900, anchor: "middle" }); });
    const base = y0 + CH + 46 + 36 + 62;   // 名前が1行でも2行でも、数字は同じ高さにそろえる
    stats(c).forEach((st, j) => { s += T(x + CW / 2, base + j * 48, st.t, { size: st.size || 34, weight: st.w || 700, anchor: "middle", fill: st.fill || PAPER }); });
  });
  return s;
}

/* 横長の棒グラフ1本分（勝率の範囲 lo〜hi に対する位置） */
const scaleX = (v, lo, hi, x0, x1) => x0 + (v - lo) / (hi - lo) * (x1 - x0);

function paceChart(x0, x1, title, rows, color, tag){
  const wrs = rows.map(r => r.wr * 100), lo = Math.floor(Math.min(...wrs) - 1), hi = Math.ceil(Math.max(...wrs) + 1);
  let s = T(x0, 440, title, { size: 38, weight: 700, fill: color });
  if(tag) s += T(x1 - 40, 440, tag, { size: 34, weight: 900, anchor: "end", fill: PAPER });
  rows.forEach((r, i) => {
    const y = 540 + i * 88, lx = x0 + 190, vx = (v) => scaleX(v, lo, hi, lx, x1 - 40);
    s += T(lx - 24, y + 14, r.label, { size: 36, anchor: "end" });
    s += `<line x1="${lx}" x2="${x1 - 40}" y1="${y}" y2="${y}" stroke="${PAPER}" stroke-opacity="0.14" stroke-width="3"/>`;
    s += `<line x1="${lx}" x2="${vx(r.wr * 100)}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="10" stroke-linecap="round"/>`;
    s += `<circle cx="${vx(r.wr * 100)}" cy="${y}" r="19" fill="${color}" stroke="${PAPER}" stroke-width="3"/>`;
    s += T(vx(r.wr * 100), y - 30, pt(r.wr) + "%", { size: 36, weight: 900, anchor: "middle" });
  });
  return s;
}

function sceneSvg(sc){
  switch(sc.kind){
    case "hook": {
      // サムネイルを兼ねる。上：ロゴとセット名を横いっぱいに1行で大きく／左下：リミテッド完全ガイド／右下：勝率の高いボム3枚を大きく。
      // 下の字幕（y=900〜）は動画のときだけ出る。画面の下端の説明文は入れない
      const title = String(sc.title).replace(/\s+/g, " ");
      const sz = Math.min(190, Math.floor(1800 / Math.max([...title].length, 6)));
      const cards = (sc.cards && sc.cards.length ? sc.cards.slice(0, 3) : []);
      const CW = 350, CH = 488, step = 320, cx0 = W - 80 - (CW + step * (cards.length - 1));
      return frame(
        `<defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#050B14" stop-opacity="${sc.artMode === "key" ? 0.72 : 0.84}"/><stop offset="0.55" stop-color="#050B14" stop-opacity="${sc.artMode === "key" ? 0.38 : 0.55}"/><stop offset="1" stop-color="#050B14" stop-opacity="0"/></linearGradient></defs>
         <rect x="0" y="0" width="${W}" height="${H}" fill="url(#gl)"/>` +
        (sc.arenaLogo ? `<image href="${sc.arenaLogo}" x="82" y="14" width="400" height="140" preserveAspectRatio="xMinYMid meet"/>` : T(90, 110, "MTGアリーナ", { size: 64, weight: 900, fill: "#FFFFFF" })) +
        (sc.setLogo ? `<image href="${sc.setLogo}" x="82" y="152" width="1100" height="248" preserveAspectRatio="xMinYMid meet"/>`
                    : TS(90, 340, title, { size: sz, fill: "#FFD23F" })) +
        TS(90, 590, "リミテッド", { size: 120 }) + TS(90, 718, "完全ガイド", { size: 120 }) +
        `<rect x="90" y="764" width="680" height="100" rx="50" fill="${BLUE}" stroke="#FFFFFF" stroke-width="6"/>` +
        T(430, 832, "ドラフト＋シールド環境", { size: 54, weight: 900, anchor: "middle", fill: "#06101C" }) +
        // 右下：勝率の高いボム。拡大した絵ではなく、カードそのものを少し傾けて並べる
        cards.map((c, i) => {
          const x = cx0 + i * step, yy = 395 + (i === 1 ? -26 : 0), rot = (i - (cards.length - 1) / 2) * 4;
          return `<g transform="rotate(${rot} ${x + CW / 2} ${yy + CH / 2})"><rect x="${x + 8}" y="${yy + 12}" width="${CW}" height="${CH}" rx="18" fill="#000" opacity="0.45"/>${cardImg(c, x, yy, CW, CH)}</g>`;
        }).join(""), sc, { header: false });
    }
    case "agenda": {
      let s = T(W / 2, 185, "この動画の流れ", { size: 52, weight: 900, anchor: "middle" });
      sc.items.forEach((t, i) => {
        const col = i % 2, row = Math.floor(i / 2), lastAlone = i === sc.items.length - 1 && sc.items.length % 2 === 1;
        const x = lastAlone ? (W - 720) / 2 : 220 + col * 760, y = 235 + row * 124;      // 5行でも、最後の行が字幕（y=900〜）に掛からない
        s += panel(x, y, 720, 100) + `<circle cx="${x + 56}" cy="${y + 52}" r="30" fill="${BLUE}"/>` + T(x + 56, y + 66, String(i + 1), { size: 36, weight: 900, anchor: "middle" }) + T(x + 112, y + 68, t, { size: 40, weight: 700 });
      });
      return frame(s, sc);
    }
    case "pace": {
      let s = T(80, 190, "環境の速さ", { size: 40, fill: MUTED }) + T(80, 290, sc.word, { size: 90, weight: 900, fill: BLUE }) +
              T(80 + [...sc.word].length * 94 + 30, 285, sc.sub, { size: 44 });
      s += T(80, 360, "デッキの平均マナ総量ごとの勝率", { size: 32, fill: MUTED });
      s += paceChart(80, 940, "ドラフト", sc.rowsD, UP, sc.tagD);
      if(sc.rowsS.length) s += paceChart(1000, 1840, "シールド", sc.rowsS, GOLD, sc.tagS);
      return frame(s, sc);
    }
    case "colors": {
      let s = T(80, 215, "単色の勝率", { size: 40, fill: MUTED });
      const lo = 52, hi = Math.max(...sc.colors.map(c => c.wr * 100)) + 2;
      sc.colors.forEach((c, i) => {
        const x = 150 + i * 360;
        s += symbol(c.color, x + 80, 330, 130);
        const h = 4 + (c.wr * 100 - lo) / (hi - lo) * 260;
        s += `<rect x="${x + 10}" y="${760 - h}" width="140" height="${h}" rx="10" fill="${i < 2 ? UP : "#46698F"}"/>`;
        s += T(x + 80, 760 - h - 18, pt(c.wr) + "%", { size: 44, weight: 900, anchor: "middle" });
        s += T(x + 80, 810, `シールド ${sc.monoS[c.color] != null ? pt(sc.monoS[c.color]) + "%" : "—"}`, { size: 32, anchor: "middle", fill: GOLD });
      });
      s += T(80, 850, "ドラフトの勝率（棒）と シールドの勝率（下の金色の数字）", { size: 28, fill: MUTED });
      return frame(s, sc);
    }
    case "pairs": {
      let s = T(80, 175, "2色の組み合わせ 勝率（高い順）", { size: 40, fill: MUTED }) + `<rect x="1380" y="140" width="22" height="22" rx="4" fill="${UP}"/>` + T(1412, 160, "ドラフト", { size: 28, fill: MUTED }) +
              `<rect x="1580" y="144" width="22" height="14" rx="4" fill="${GOLD}"/>` + T(1612, 160, "シールド", { size: 28, fill: MUTED });
      const rows = sc.pairsD, sm = sc.sealedMap || {};
      const all = [...rows.map(r => r.wr * 100), ...rows.map(r => sm[r.pair]).filter(v => v != null).map(v => v * 100)];
      const lo = Math.floor(Math.min(...all) - 1), hi = Math.max(...all) + 0.4;      // 最長の棒を右端ちかくまで伸ばす（右に余白が残らないように）
      const step = Math.min(120, 640 / rows.length);
      rows.forEach((r, i) => {
        const y = 215 + i * step, bx0 = 470, bx1 = 1720, xv = v => scaleX(v, lo, hi, bx0, bx1);
        const hot = r === sc.bestD, cold = r === sc.worstD && rows.length > 2;
        s += T(70, y + 50, String(i + 1), { size: 34, fill: MUTED });
        s += pairSymbols(r.pair, 120, y + 30, 50) + T(262, y + 52, pairName(r.pair), { size: 44, weight: 900 });
        s += `<rect x="${bx0}" y="${y + 6}" width="${xv(r.wr * 100) - bx0}" height="34" rx="8" fill="${hot ? UP : cold ? DOWN : "#46698F"}"/>`;
        s += T(xv(r.wr * 100) + 16, y + 36, pt(r.wr) + "%", { size: 36, weight: 900 });
        // 一番下の行は「勝ちにくい」のか、単に順位が低いだけなのか、見分けがつかないので、はっきり書く
        if(cold) s += `<rect x="${xv(r.wr * 100) + 140}" y="${y + 3}" width="180" height="36" rx="18" fill="${DOWN}"/>` + T(xv(r.wr * 100) + 230, y + 31, "勝ちにくい", { size: 26, weight: 900, anchor: "middle", fill: "#1A0E02" });
        const sw = sm[r.pair];
        if(sw != null){
          s += `<rect x="${bx0}" y="${y + 46}" width="${xv(sw * 100) - bx0}" height="20" rx="6" fill="${GOLD}" opacity="0.85"/>`;
          s += T(xv(sw * 100) + 14, y + 64, pt(sw) + "%", { size: 28, fill: GOLD, weight: 700 });
        }
      });
      return frame(s, sc);
    }
    case "deep": {
      const worst = sc.variant === "worst", sleeper = sc.variant === "sleeper", col = worst ? DOWN : sleeper ? GREEN : UP;
      let s = T(80, 175, worst ? "一番勝ちにくい組み合わせ" : sleeper ? "狙い目の組み合わせ" : `ドラフト ${sc.rank}位の組み合わせ`, { size: 40, fill: col, weight: 700 });
      s += pairSymbols(sc.pair, 90, 280, 120) + T(90, 440, pairName(sc.pair), { size: 100, weight: 900 });
      s += T(90, 580, pt(sc.wr) + "%", { size: 130, weight: 900, fill: col });
      s += T(90, 650, "ドラフトの勝率", { size: 32, fill: MUTED });
      s += T(90, 730, sc.sealedWr != null ? `シールド ${pt(sc.sealedWr)}%` : "シールド —", { size: 44, weight: 700, fill: GOLD });
      s += T(90, 800, `使用率 ${Math.round(sc.share * 100)}%（平均 ${Math.round(sc.avgShare * 100)}%）`, { size: 38, fill: sleeper ? GREEN : PAPER, weight: sleeper ? 900 : 400 });
      if(sc.cards.length){
        s += T(740, 175, sc.variant === "sleeper" ? "狙える、コモン・アンコモン" : worst && sc.weak ? `${CJ[sc.weak]}のカードで勝っている、コモン・アンコモン` : "この組み合わせで勝っている、コモン・アンコモン", { size: 38, fill: MUTED });
        const n = sc.cards.length, CW = 245, CH = 342, g = 28, x0 = 740;
        sc.cards.forEach((c, i) => {
          const x = x0 + i * (CW + g);
          s += cardImg(c, x, 215, CW, CH);
          const lines = wrapName(c.label, 8);
          lines.forEach((l, j) => { s += T(x + CW / 2, 215 + CH + 44 + j * 34, l, { size: 28, weight: 900, anchor: "middle" }); });
          s += T(x + CW / 2, 215 + CH + 44 + (lines.length - 1) * 34 + 46, `この色で ${pt(c.pg)}%`, { size: 30, weight: 700, anchor: "middle", fill: col });
        });
      }
      return frame(s, sc);
    }
    case "dvs": {
      let s = T(80, 175, "ドラフトとシールドで評価が変わるもの", { size: 40, fill: MUTED });
      s += panel(80, 210, 820, 590) + T(120, 275, "色の組み合わせ（順位）", { size: 36, fill: GOLD, weight: 700 });
      if(!sc.up && !sc.down) s += T(130, 400, "上位の組み合わせの順位は、", { size: 40 }) + T(130, 460, "ほとんど入れ替わりません", { size: 40, weight: 700 });
      [sc.up, sc.down].filter(Boolean).forEach((r, i) => {
        const y = 340 + i * 220, up = r.diff > 0;
        s += pairSymbols(r.pair, 130, y + 20, 70) + T(330, y + 60, pairName(r.pair), { size: 64, weight: 900 });
        s += T(130, y + 140, `ドラフト ${r.rd}位  →  シールド ${r.rs}位`, { size: 44, weight: 700, fill: up ? GREEN : DOWN });
        s += T(780, y + 60, up ? "▲" : "▼", { size: 60, anchor: "end", fill: up ? GREEN : DOWN });
      });
      s += panel(940, 210, 900, 590) + T(980, 275, "レア・神話レア（GIH勝率）", { size: 36, fill: GOLD, weight: 700 });
      const list = [...sc.cUp.slice(0, 2).map(c => ({ ...c, up: true })), ...sc.cDown.slice(0, 2).map(c => ({ ...c, up: false }))];
      list.forEach((c, i) => {
        const y = 335 + i * 110;
        s += T(980, y + 30, [...c.label].length > 17 ? [...c.label].slice(0, 16).join("") + "…" : c.label, { size: [...c.label].length > 12 ? 32 : 36, weight: 900 });
        s += T(980, y + 78, `ドラフト ${pt(c.d)}%  →  シールド ${pt(c.s)}%`, { size: 32, fill: c.up ? GREEN : DOWN, weight: 700 });
        s += T(1800, y + 54, c.up ? "▲" : "▼", { size: 48, anchor: "end", fill: c.up ? GREEN : DOWN });
      });
      return frame(s, sc);
    }
    case "bombs": {
      let s = T(80, 175, `ボム ${sc.part === 1 ? "1〜5位" : "6〜10位"}（神話レア・レア、GIH勝率）`, { size: 38, fill: MUTED });
      s += cardRow(sc.cards, c => [
        { t: `ドラフト ${pt(c.gih)}%`, size: 40, w: 900, fill: UP },
        { t: c.sGih != null ? `シールド ${pt(c.sGih)}%` : "シールド —", size: 32, fill: GOLD },
        { t: `引くと ${sgn(c.iwd)}pt`, size: 28, fill: MUTED, w: 400 }
      ], GOLD, 250);
      return frame(s, sc);
    }
    case "traps": {
      let s = T(80, 175, `罠なレアカード（レア全体の平均 ${pt(sc.rareAvg)}% より低いレア）`, { size: 38, fill: MUTED });
      s += cardRow(sc.cards.map((c, i) => ({ ...c, rank: i + 1 })), c => [
        { t: `ドラフト ${pt(c.gih)}%`, size: 40, w: 900, fill: DOWN },
        { t: `レア平均より ${sgn(c.gih - sc.rareAvg)}pt`, size: 30, fill: DOWN },
        { t: c.sGih != null ? `シールド ${pt(c.sGih)}%` : "シールド —", size: 30, fill: GOLD, w: 400 }
      ], DOWN, 250);
      return frame(s, sc);
    }
    case "removal": {
      let s = T(80, 175, `${sc.jp}の除去 強さ順（${sc.jp}全体の平均 ${pt(sc.commonAvg)}% より高いもの）`, { size: 38, fill: MUTED });
      s += cardRow(sc.cards, c => [
        { t: `GIH ${pt(c.gih)}%`, size: 40, w: 900, fill: GREEN },
        { t: `平均より ${sgn(c.gih - sc.commonAvg)}pt`, size: 30, fill: PAPER },
        { t: `マナ総量 ${c.cmc ?? "—"}`, size: 28, fill: MUTED, w: 400 }
      ], GREEN, 250);
      return frame(s, sc);
    }
    case "deck": {
      let s = T(80, 175, "デッキの組み方（40枚）", { size: 40, fill: MUTED });
      const parts = [["土地", 17, UP], ["クリーチャー", 17, GREEN], ["それ以外", 6, GOLD]], tot = 40;
      let x = 100;
      parts.forEach(([name, n, col]) => {
        const w = n / tot * 1720;
        s += `<rect x="${x}" y="215" width="${w - 6}" height="100" rx="14" fill="${col}"/>` + T(x + (w - 6) / 2, 280, `${name} ${n}`, { size: n < 10 ? 36 : 44, weight: 900, anchor: "middle", fill: DEEP });
        x += w;
      });
      s += T(100, 385, "呪文23枚のマナカーブの目安", { size: 34, fill: MUTED });
      [["1〜2マナ", 8], ["3マナ", 5], ["4マナ", 4], ["5マナ以上", 6]].forEach(([l, n], i) => {
        const bx = 100 + i * 440;
        s += panel(bx, 410, 410, 120, BLUE) + T(bx + 40, 482, l, { size: 38 }) + T(bx + 370, 488, `${n}枚`, { size: 60, weight: 900, anchor: "end", fill: GOLD });
      });
      s += T(100, 590, "そのマナ総量のカードを引いた試合の勝率（ドラフト）", { size: 32, fill: MUTED });
      const rows = sc.curve, lo = Math.floor(Math.min(...rows.map(r => r.wr * 100)) - 1), hi = Math.ceil(Math.max(...rows.map(r => r.wr * 100)) + 1);
      rows.forEach((r, i) => {
        const x0 = 140 + i * 240, h = 20 + (r.wr * 100 - lo) / (hi - lo) * 150;
        s += `<rect x="${x0}" y="${815 - h}" width="150" height="${h}" rx="10" fill="${UP}"/>` + T(x0 + 75, 815 - h - 14, pt(r.wr) + "%", { size: 34, weight: 900, anchor: "middle" });
        s += T(x0 + 75, 860, `${r.cmc}マナ${r.cmc >= 7 ? "以上" : ""}`, { size: 30, anchor: "middle", fill: MUTED });
      });
      return frame(s, sc);
    }
    case "summary": {
      // 上段：環境の速さ・最強の色・組むなら・避けるなら。下段：ボム／罠／コモン除去を、カード画像つきで3枚ずつ
      let s = "";
      const PX = 50, PW = 440, PG = 20, PY = 125, PH = 235;
      const box = (i, label, inner) => { const x = PX + i * (PW + PG); return panel(x, PY, PW, PH, BLUE) + T(x + PW / 2, PY + 46, label, { size: 30, fill: MUTED, anchor: "middle" }) + inner(x + PW / 2); };
      if(sc.pace) s += box(0, "環境の速さ", cx => T(cx, PY + 140, sc.pace.word, { size: 84, weight: 900, anchor: "middle", fill: GOLD }) + T(cx, PY + 198, sc.pace.sub || "", { size: 28, anchor: "middle", fill: PAPER }));
      if(sc.mono) s += box(1, "一番強い色", cx => symbol(sc.mono.color, cx - 70, PY + 125, 84) + T(cx - 10, PY + 150, pairName(sc.mono.color), { size: 76, weight: 900, fill: GOLD }) + T(cx, PY + 205, `勝率 ${pt(sc.mono.wr)}%`, { size: 32, anchor: "middle", fill: UP, weight: 700 }));
      if(sc.best) s += box(2, "組むなら", cx => pairSymbols(sc.best.pair, cx - 175, PY + 108, 70) + T(cx - 20, PY + 130, pairName(sc.best.pair), { size: 64, weight: 900, fill: GOLD }) +
        T(cx, PY + 182, `ドラフト ${pt(sc.best.wr)}%`, { size: 28, anchor: "middle", fill: UP, weight: 700 }) +
        (sc.best.sWr != null ? T(cx, PY + 218, `シールド ${pt(sc.best.sWr)}%`, { size: 28, anchor: "middle", fill: GOLD, weight: 700 }) : ""));
      if(sc.worst) s += box(3, "無理に目指さない", cx => pairSymbols(sc.worst.pair, cx - 175, PY + 120, 70) + T(cx - 20, PY + 142, pairName(sc.worst.pair), { size: 64, weight: 900, fill: PAPER }) +
        T(cx, PY + 205, `ドラフト ${pt(sc.worst.wr)}%`, { size: 30, anchor: "middle", fill: DOWN, weight: 700 }));
      const colsDef = [["迷わず取るボム", sc.b3, UP, GOLD], ["罠になりやすいレア", sc.t3, DOWN, DOWN], ["強いコモン除去", sc.r3, GREEN, GREEN]].filter(d => d[1] && d[1].length);
      const CG = 25, CX = 50, CWd = Math.floor((1820 - CG * (colsDef.length - 1)) / colsDef.length), CY = 375, ROWH = 150;
      const col = (i, label, cards, fill, accent, rate) => {
        const x = CX + i * (CWd + CG);
        let o = panel(x, CY, CWd, 515, accent) + T(x + 24, CY + 46, label, { size: 34, weight: 900, fill: accent });
        cards.forEach((c, j) => {
          const ry = CY + 62 + j * ROWH;
          o += cardImg(c, x + 24, ry, 92, 128);
          const lines = wrapName(c.label, 11);
          lines.forEach((l, k) => { o += T(x + 132, ry + 36 + k * 36, l, { size: 31, weight: 900 }); });
          o += T(x + 132, ry + 118, rate(c), { size: 31, weight: 700, fill });
        });
        return o;
      };
      colsDef.forEach((d, i) => { s += col(i, d[0], d[1], d[2], d[3], c => `GIH勝率 ${pt(c.gih)}%`); });
      return frame(s, sc);
    }
    case "outro": {
      // 締めは「チャンネル登録をお願いします」だけ。画面の下半分は、YouTube Studio の「終了画面」で
      // 登録ボタンと次の動画を重ねるために、あえて空けてある（動画の絵としての登録ボタンは描かない）
      return frame(TS(W / 2, 230, "MTGのリミテッドプレイヤーは", { size: 84, anchor: "middle" }) + TS(W / 2, 370, "チャンネル登録をお願いします", { size: 100, anchor: "middle" }), sc, { header: false });
    }
  }
  return frame("", sc);
}

/* 字幕：読み上げの文を、2行に収まるページに分ける。ページごとに読み上げの長さ（文字数）の割合で出す時間を決める */
function capPages(text){
  const max = 70;
  const sents = text.replace(/パーセント/g, "%").split(/(?<=。)/).map(s => s.trim()).filter(Boolean);
  const pieces = [];
  for(const s of sents){
    if([...s].length <= max){ pieces.push(s); continue; }
    let cur = "";
    for(const part of s.split(/(?<=、)/)){ if([...cur].length + [...part].length > max && cur){ pieces.push(cur); cur = part; } else cur += part; }
    if(cur) pieces.push(cur);
  }
  const pages = []; let cur = "";
  for(const p of pieces){ if(cur && [...cur].length + [...p].length > max){ pages.push(cur); cur = p; } else cur += p; }
  if(cur) pages.push(cur);
  return pages;
}
let CAPBOX = { x0: 120, bw: W - 240, size: 42 };      // ずんだもんを出すときは、右をあけるために字幕の箱を細くする
function capSvg(page){
  const chars = [...page], half = Math.ceil(chars.length / 2);
  let lines = [page];
  if(chars.length > 36){
    // 2行に割る。読点があればその近くで
    const idx = [...page].map((c, i) => (c === "、" || c === "。") ? i + 1 : -1).filter(i => i > 0).sort((a, b) => Math.abs(a - half) - Math.abs(b - half))[0] || half;
    lines = [chars.slice(0, idx).join(""), chars.slice(idx).join("")];
  }
  const lh = 56, boxH = lines.length * lh + 44, x0 = CAPBOX.x0, bw = CAPBOX.bw, cx = x0 + bw / 2, fs = CAPBOX.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H - CAP_Y}" viewBox="0 0 ${W} ${H - CAP_Y}" font-family="${FONT}">
  <defs><linearGradient id="ffw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A4FC4"/><stop offset="1" stop-color="#0B1763"/></linearGradient></defs>
  <rect x="${x0 + 5}" y="8" width="${bw}" height="${boxH}" rx="18" fill="#000" opacity="0.4"/>
  <rect x="${x0}" y="3" width="${bw}" height="${boxH}" rx="18" fill="url(#ffw)" stroke="#F4F7FF" stroke-width="5"/>
  <rect x="${x0 + 10}" y="13" width="${bw - 20}" height="${boxH - 20}" rx="10" fill="none" stroke="#8FA8F0" stroke-width="2" opacity="0.8"/>
  ${lines.map((l, i) => `<text x="${cx + 2}" y="${52 + i * lh + 2}" font-size="${fs}" fill="#050B33" font-weight="700" text-anchor="middle">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>` + T(cx, 52 + i * lh, l, { size: fs, anchor: "middle", weight: 700 })).join("")}
  <polygon points="${x0 + bw - 54},${boxH - 26} ${x0 + bw - 30},${boxH - 26} ${x0 + bw - 42},${boxH - 10}" fill="#F4F7FF"/>
</svg>`;
}

/* ------------------------------------------------------------ 音声 */

async function loadYomi(){
  try{ await fetch(`${VV}/version`); }
  catch(e){ throw new Error(`VOICEVOX ENGINE に接続できません（${VV}）。起動してから実行してください`); }
  const dict = await readJson("short/yomi.json", {});
  let n = 0;
  for(const [surface, yomi] of Object.entries(dict)){
    const r = await fetch(`${VV}/user_dict_word?surface=${encodeURIComponent(surface)}&pronunciation=${encodeURIComponent(yomi)}&accent_type=0&priority=8`, { method: "POST" });
    if(r.ok) n++;
  }
  if(n) console.error(`読み辞書: ${n} 語`);
}

/* ------------------------------------------------------------ ずんだもん（口パク・まばたき）
   short/zunda/{open,closed}_{closed,half,open}.png があれば、右下に出す。
   （目：open/closed、口：closed/half/open）  LONG_ZUNDA=0 で出さない */
// short/zunda-hoodie/（水色のパーカー版）があれば、そちらを使う。いつもの姿に戻すときは、そのフォルダを消すか LONG_ZUNDA_STYLE=normal
const ZDIR = (process.env.LONG_ZUNDA_STYLE !== "normal" && existsSync("short/zunda-hoodie/open_open.png")) ? "short/zunda-hoodie" : "short/zunda", ZW = 245, ZH = 250;      // 画面での大きさ（素材は 372×380）。画面の下のすみ（字幕の右どなり）に置く
async function zundaReady(){
  if(process.env.LONG_ZUNDA === "0") return false;
  for(const e of ["open", "closed"]) for(const m of ["closed", "half", "open"])
    if(!(await readFile(`${ZDIR}/${e}_${m}.png`).then(() => true, () => false))) return false;
  return true;
}
// 音声の大きさから、1/15 秒ごとの口の形を決める
function mouthStates(wavPath, len){
  const FPS = 15, n = Math.max(1, Math.ceil(len * FPS));
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", wavPath, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], { maxBuffer: 1 << 29 });
  const x = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2)), win = Math.floor(16000 / FPS);
  const rms = [];
  for(let f = 0; f < n; f++){ let a = 0, c = 0; for(let i = f * win; i < Math.min(x.length, (f + 1) * win); i++){ a += x[i] * x[i]; c++; } rms.push(c ? Math.sqrt(a / c) : 0); }
  const sorted = [...rms].sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.9)] || 1;
  let st = rms.map(v => { const r = v / ref; return r < 0.16 ? "closed" : r < 0.5 ? "half" : "open"; });
  st = st.map((v, i) => { const a = st[i - 1] || v, b = st[i + 1] || v; return a === b ? a : v; });   // 1コマだけの揺れをならす
  return { FPS, st };
}
// 場面ごとの口パク動画の素材（連番の一覧）を作る
async function zundaList(i, wavPath, len, dir){
  const { FPS, st } = mouthStates(wavPath, len), lines = [];
  let last = null;
  st.forEach((m, f) => {
    const t = f / FPS, ph = (t + i * 0.9) % 3.6, eye = ph > 3.45 ? "closed" : "open";      // 3.6 秒おきに、0.15 秒のまばたき
    last = `${ZDIR}/${eye}_${m}.png`;
    lines.push(`file '${resolve(last)}'`, `duration ${(1 / FPS).toFixed(4)}`);
  });
  lines.push(`file '${resolve(last)}'`);
  const list = `${dir}/zunda-${i}.txt`; await writeFile(list, lines.join("\n"), "utf8");
  return list;
}
async function speak(text, wavPath){
  // 動作確認用（LONG_FAKE_AUDIO=1）：無音の音声を、文字数に応じた長さで作る。VOICEVOX が無い環境で、動画の組み立てだけ試すときに使う
  if(process.env.LONG_FAKE_AUDIO){
    const dur = Math.max(2, [...text].length / 7.5);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=0.3*sin(2*PI*220*t)*gt(sin(2*PI*2.7*t)\\,-0.2):s=24000`, "-t", dur.toFixed(2), wavPath]);
    return { kana: text, dur };
  }
  const q = await fetch(`${VV}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(text)}`, { method: "POST" });
  if(!q.ok) throw new Error(`audio_query ${q.status}`);
  const query = await q.json();
  query.speedScale = SPEED; query.postPhonemeLength = 0.25;
  const r = await fetch(`${VV}/synthesis?speaker=${SPEAKER}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
  if(!r.ok) throw new Error(`synthesis ${r.status}`);
  await writeFile(wavPath, Buffer.from(await r.arrayBuffer()));
  const kana = query.accent_phrases.map(p => p.moras.map(m => m.text).join("") + (p.pause_mora ? "、" : "")).join("");
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]).toString().trim();
  return { kana, dur };
}

/* ------------------------------------------------------------ 実行 */

async function main(){
  const dd = await readJson(`data/articles/${SET}_draft.json`, null), ds = await readJson(`data/articles/${SET}_sealed.json`, null);
  const rd = await readJson(`data/ratings/${SET}_PremierDraft.json`, null), rs = await readJson(`data/ratings/${SET}_Sealed.json`, null);
  if(!dd || !ds || !rd || !rs){ console.error(`${SET}: ドラフトとシールドの記事データ・勝率一覧が両方そろっていません（articles ${!!dd}/${!!ds}, ratings ${!!rd}/${!!rs}）`); process.exit(1); }
  const nm = await readJson(`data/names/${SET}.json`, { names: {}, images: {} });
  const nameJa = shortName((await setNameJa(SET)) || nm.set || SET);
  const sharp = (await import("sharp")).default;
  await mkdir(OUT, { recursive: true });
  const arenaBuf = await readFile("short/logo/arena.png").catch(() => null);      // ショートと同じ MTGアリーナのロゴ
  console.error(arenaBuf ? "アリーナのロゴ: short/logo/arena.png" : "アリーナのロゴ: short/logo/arena.png が無いので、文字で代用");

  for(const c of ["W", "U", "B", "R", "G"]){
    const p = `short/symbols/${c}.svg`;
    let svg = await readFile(p, "utf8").catch(() => null);
    if(!svg){
      try{
        const r = await fetch(`https://svgs.scryfall.io/card-symbols/${c}.svg`, { headers: UA });
        if(r.ok){ svg = await r.text(); await mkdir("short/symbols", { recursive: true }); await writeFile(p, svg, "utf8"); }
      }catch(e){}
    }
    if(svg){ const m = svg.match(/<svg([^>]*)>([\s\S]*)<\/svg>/); const vb = m && m[1].match(/viewBox="([^"]+)"/); if(m) SYM[c] = { inner: m[2], viewBox: vb ? vb[1] : "0 0 100 100" }; }
  }
  console.error(Object.keys(SYM).length ? `マナ・シンボル: ${Object.keys(SYM).join(" ")}` : "マナ・シンボル: 取得できず、丸に文字で代用");

  const removal = await loadRemovalNames();
  console.error(removal ? `除去の判定: ${removal.names.length} 枚（${removal.from}）` : "除去の判定: 取れなかったので、除去の場面は入れない");
  const commonRem = removal ? rd.cards.filter(c => c.rarity === "common" && removal.names.includes(c.name) && c.games >= 1500).sort((a, b) => b.gih - a.gih)[0] : null;
  const ctx = { dd, ds, rd, rs, nm, nameJa, removal, topRemoval: commonRem ? { ...commonRem, label: (nm.names || {})[commonRem.name] || commonRem.name } : null };
  const scenes = buildScript(ctx);
  {  // セット名のロゴ（ショートと同じ short/logo/<SET>.png。置いてあれば、セット名の文字の代わりに使う）
    const lb = await readFile(`short/logo/${SET}.png`).catch(() => null);
    if(lb && scenes[0] && scenes[0].kind === "hook"){ scenes[0].setLogo = "data:image/png;base64," + lb.toString("base64"); console.error(`セットのロゴ: short/logo/${SET}.png`); }
    else console.error(`セットのロゴ: 無し（short/logo/${SET}.png を置けば使います。今回は文字で出す）`);
  }
  if(arenaBuf && scenes[0] && scenes[0].kind === "hook") scenes[0].arenaLogo = "data:image/png;base64," + arenaBuf.toString("base64");
  // 図に使う追加情報
  const pairsS = pairRows(ds), sealedMap = Object.fromEntries(pairsS.map(p => [p.pair, p.wr]));
  scenes.forEach(sc => { if(sc.kind === "pairs") sc.sealedMap = sealedMap; });
  HEADER.title = nameJa;

  // BGM
  let bgm = null, bgmCredit = "";
  try{
    const { readdir } = await import("node:fs/promises");
    const isAudio = f => /\.(mp3|m4a|wav|ogg)$/i.test(f);
    // 長尺は long/bgm/ の曲（フィールド曲）を優先。無ければ short/bgm/ を使う
    let dir = "long/bgm", files = []; try{ files = (await readdir(dir)).filter(isAudio).sort(); }catch(e){}
    if(!files.length){ dir = "short/bgm"; files = (await readdir(dir)).filter(isAudio).sort(); }
    if(files.length){ const pick = files[[...SET].reduce((n, ch) => n + ch.charCodeAt(0), 0) % files.length]; bgm = `${dir}/${pick}`; bgmCredit = (await readJson(`${dir}/credits.json`, {}))[pick] || ""; console.error(`BGM: ${pick}`); }
  }catch(e){}
  const outro = scenes.find(sc => sc.kind === "outro"); if(outro && bgmCredit) outro.bgmCredit = bgmCredit;

  // 背景アート（冒頭・締め）：勝率上位のレア3枚の絵を縦に並べて、1枚の背景にする（取れた枚数だけ）
  let artPath = null, artMode = "blur";
  {
    const bufs = [];
    if(process.env.LONG_TEST_ARTS){ for(const f of process.env.LONG_TEST_ARTS.split(",")) bufs.push(await readFile(f)); }   // レイアウト確認用
    else{
      const cands = rd.cards.filter(c => c.rarity === "mythic" || c.rarity === "rare").sort((a, b) => b.gih - a.gih);
      for(const c of cands){
        if(bufs.length >= 3) break;
        const url = (nm.images || {})[c.name]; if(!url) continue;
        try{
          const r = await fetch(url.replace("/normal/", "/art_crop/"), { headers: UA }); if(!r.ok) continue;
          bufs.push(Buffer.from(await r.arrayBuffer())); console.error(`背景アート: ${c.name}`);
        }catch(e){}
      }
    }
    if(bufs.length){
      const n = bufs.length, pw = Math.ceil(W / n);
      const panels = await Promise.all(bufs.map(b => sharp(b).resize(pw, H, { fit: "cover", position: "attention" }).modulate({ saturation: 1.15 }).toBuffer()));
      artPath = `${OUT}/art.jpg`;
      await sharp({ create: { width: W, height: H, channels: 3, background: "#0A2038" } })
        .composite(panels.map((input, i) => ({ input, left: i * pw, top: 0 }))).jpeg({ quality: 92 }).toFile(artPath);
      artMode = "collage";
    }else if(await readFile(`${OUT}/art.jpg`).then(() => true, () => false)){ artPath = `${OUT}/art.jpg`; artMode = "collage"; }
    else console.error("背景アート: 取得できず");
  }
  // 公式のキーアート（置いてあれば、冒頭・締めの背景にぼかさず大きく使う）：short/bg/<セットコード>.jpg（png・webp も可）
  let keyArt = false;     // 公式の絵を置いたとき true
  for(const ext of ["jpg", "jpeg", "png", "webp"]){
    const f = `short/bg/${SET}.${ext}`;
    if(await readFile(f).then(() => true, () => false)){ artPath = f; keyArt = true; console.error(`背景：公式のキーアート ${f}`); break; }
  }
  if(keyArt) artMode = "key";
  if(scenes[0]) scenes[0].artMode = artMode;
  if(!keyArt) console.error(`背景：勝率上位のカードの絵を並べて使う（公式の絵に替えるなら short/bg/${SET}.jpg を置く）`);

  // カード画像：全場面で使うカードを一度だけ取って使い回す
  const imgCache = new Map();
  const getImg = async c => {
    const key = c.name; if(imgCache.has(key)) return imgCache.get(key);
    let out = null;
    const url = (nm.images || {})[c.name] || (nm.images || {})[String(c.name).split(" // ")[0]];
    if(url){
      try{
        const r = await fetch(url, { headers: UA });
        if(r.ok){ const buf = Buffer.from(await r.arrayBuffer()); out = "data:image/jpeg;base64," + buf.toString("base64"); }
      }catch(e){}
    }
    imgCache.set(key, out); return out;
  };
  for(const sc of scenes) for(const c of (sc.cards || [])) c.imgPath = await getImg(c);
  console.error(`カード画像: ${[...imgCache.values()].filter(Boolean).length}/${imgCache.size} 枚`);

  let bgDur = 0;
  try{ bgDur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", BG]).toString().trim(); }catch(e){}
  HAS_BG = bgDur > 0;
  console.error(HAS_BG ? `背景: ${BG}（${bgDur.toFixed(1)}秒）` : "背景: 紺色（short/bg.mp4 が無い）");

  // 音声
  const prev = await readJson(`${OUT}/script.json`, []);
  let yomiLoaded = false;
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/scene-${i}`, old = prev[i];
    if(old && old.say === sc.say && old.dur && await readFile(base + ".wav").then(() => true, () => false)){ sc.kana = old.kana; sc.dur = old.dur; continue; }
    if(STILLS){ sc.kana = sc.say; sc.dur = Math.max(4, [...sc.say].length / 7); continue; }
    if(!yomiLoaded && !process.env.LONG_FAKE_AUDIO){ await loadYomi(); yomiLoaded = true; }
    const { kana, dur } = await speak(sc.say, base + ".wav");
    sc.kana = kana; sc.dur = dur;
  }
  await writeFile(`${OUT}/script.json`, JSON.stringify(scenes.map(s => ({ kind: s.kind, chapter: s.chapter, say: s.say, kana: s.kana, dur: s.dur })), null, 2), "utf8");

  const ZUNDA = !STILLS && await zundaReady();
  if(ZUNDA) CAPBOX = { x0: 50, bw: W - 50 - ZW - 70, size: 40 };      // 字幕の箱は左に寄せて、右下はずんだもんの場所
  console.error(ZUNDA ? `ずんだもん: 右下に出す（${ZDIR}/）` : "ずんだもん: 出さない（short/zunda/ に素材が無い）");
  // 画像と動画
  const segs = []; let total = 0; const chapters = [];
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/scene-${i}`;
    const len = sc.dur + (sc.tail || 0.4), pad = len - sc.dur, N = Math.ceil(len * 30);
    await sharp(Buffer.from(sceneSvg(sc)), { density: 72 }).resize(W, H).png().toFile(base + ".png");
    // 字幕ページ（読み上げの文字数の割合で時間を割り振る）
    const pages = sc.cap ? capPages(sc.cap) : capPages(sc.say), nChars = pages.reduce((n, p) => n + [...p].length, 0) || 1;
    let t = 0; const caps = [];
    for(const [k, pg] of pages.entries()){
      const d = sc.dur * [...pg].length / nChars, f = `${base}-cap${k}.png`;
      await sharp(Buffer.from(capSvg(pg)), { density: 72 }).resize(W, H - CAP_Y).png().toFile(f);
      caps.push({ f, a: t, b: k === pages.length - 1 ? len : t + d }); t += d;
    }
    if(sc.chapter) chapters.push({ at: total, title: sc.chapter });
    if(STILLS){ console.error(`${i} ${sc.kind} → ${base}.png`); total += len; continue; }

    const useArt = sc.art && artPath;
    const first = useArt ? ["-loop", "1", "-framerate", "30", "-i", artPath] : HAS_BG ? ["-stream_loop", "-1", "-ss", (total % bgDur).toFixed(2), "-i", BG] : ["-f", "lavfi", "-i", `color=c=0x0A2038:s=${W}x${H}:r=30`];
    const bgFilter = useArt
      ? `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='1+0.04*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=30,eq=saturation=${sc.kind === "hook" ? 1.05 : 0.9},gblur=sigma=${sc.kind === "hook" ? (artMode === "key" ? 0.6 : 1.5) : 7}[b0];color=c=0x0A2038@${sc.kind === "hook" ? (artMode === "key" ? 0.12 : 0.18) : 0.5}:s=${W}x${H}:r=30[tint];[b0][tint]overlay=shortest=1[bg]`
      : HAS_BG
        ? `[0:v]fps=30,scale=iw*sar:ih,setsar=1,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=saturation=0.7,gblur=sigma=5,setsar=1[b0];color=c=0x0A2038@0.6:s=${W}x${H}:r=30[tint];[b0][tint]overlay=shortest=1[bg]`
        : `[0:v]null[bg]`;
    const zIn = ZUNDA ? ["-f", "concat", "-safe", "0", "-i", await zundaList(i, base + ".wav", len, OUT)] : [];
    const inputs = [...first, "-loop", "1", "-framerate", "30", "-i", base + ".png", "-i", base + ".wav", ...caps.flatMap(c => ["-loop", "1", "-framerate", "30", "-i", c.f]), ...zIn];
    // ずんだもんは、画面の右下のすみ（字幕の右どなり）に置く。図や字幕と重ならないよう、小さめにして、上下には揺らさない
    const zx = W - 24 - ZW, zy = H - ZH;      // 画面の右下のすみ。上下には揺らさない
    let fc = `${bgFilter};[1:v]format=rgba${sc.kind === "hook" ? "" : ",fade=t=in:d=0.2:alpha=1"}[fg];[bg][fg]overlay=shortest=1[${ZUNDA ? "vz" : "v0"}]` +
      (ZUNDA ? `;[${3 + caps.length}:v]fps=30,scale=${ZW}:${ZH},format=rgba[zz];[vz][zz]overlay=x=${zx}:y=${zy}:shortest=1[v0]` : "");
    caps.forEach((c, k) => { fc += `;[v${k}][${3 + k}:v]overlay=0:${CAP_Y}:enable='between(t,${c.a.toFixed(2)},${c.b.toFixed(2)})':shortest=1[v${k + 1}]`; });
    fc += `;[v${caps.length}]format=yuv420p[v];[2:a]apad=pad_dur=${pad.toFixed(2)},afade=t=in:d=0.012,afade=t=out:st=${(len - 0.03).toFixed(3)}:d=0.03,aformat=sample_rates=48000:channel_layouts=stereo[a]`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", String(len),
      "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-c:a", "aac", "-b:a", "160k", base + ".mp4"]);
    segs.push(`file 'scene-${i}.mp4'`); total += len;
    console.error(`${i} ${sc.kind.padEnd(8)} ${sc.dur.toFixed(1)}s → ${len.toFixed(1)}s`);
  }

  // 目次（YouTube の概要欄に貼る）と概要欄の下書き
  const ts = s => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };
  await writeFile(`${OUT}/chapters.txt`, chapters.map(c => `${ts(c.at)} ${c.title}`).join("\n") + "\n", "utf8");
  const gD = man(dd.total_games), gS = man(ds.total_games);
  await writeFile(`${OUT}/title.txt`, `【${nameJa}】環境まとめ｜強い色・狙い目の色・ボム10枚・罠なレアカード・除去【MTGアリーナ リミテッド】`, "utf8");   // YouTube に上げるときの題
  await writeFile(`${OUT}/description.txt`,
`MTGアリーナ、リミテッドの${nameJa}環境を、17Landsの実戦データ（ドラフト${gD}試合・シールド${gS}試合）でまるごと解説します。
最強の色の組み合わせ、狙い目の色、ボムのレア10枚、罠なレアカード、コモンとアンコモンの強い除去まで。

▼ 目次
${chapters.map(c => `${ts(c.at)} ${c.title}`).join("\n")}

▼ 全カードの勝率・環境レポート・シールド／ドラフトの練習（無料）
https://${SITE}/

データ: 17Lands Public Data (CC BY 4.0)
音声: VOICEVOX:ずんだもん
${ZUNDA ? "立ち絵: 坂本アヒル（https://twitter.com/sakamoto_ahr）\n" : ""}${bgmCredit ? `BGM: ${bgmCredit}\n` : ""}Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

#MTGアリーナ #MTGA #リミテッド #${String(nameJa).replace(/[\s・]/g, "")}
`, "utf8");
  console.error(`目次:\n${chapters.map(c => `  ${ts(c.at)} ${c.title}`).join("\n")}`);
  if(STILLS){ console.error(`画像だけ作りました。合計の目安 ${ts(total)}`); return; }

  await writeFile(`${OUT}/list.txt`, segs.join("\n"), "utf8");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${OUT}/list.txt`, "-c", "copy", "-movflags", "+faststart", bgm ? `${OUT}/nobgm.mp4` : `${OUT}/ja.mp4`]);
  if(bgm){
    const vol = process.env.BGM_VOLUME || "0.08";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/nobgm.mp4`, "-stream_loop", "-1", "-i", bgm, "-filter_complex",
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 2).toFixed(2)}:d=2[bg];` +
      `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(total), "-movflags", "+faststart", `${OUT}/ja.mp4`]);
  }
  // サムネイル（冒頭の場面。字幕の入る前の画面を、カードの絵に重ねる）
  try{
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...(artPath ? ["-loop", "1", "-i", artPath] : ["-ss", "2.0", "-i", `${OUT}/ja.mp4`]), "-i", `${OUT}/scene-0.png`, "-filter_complex",
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,gblur=sigma=${artMode === "key" ? 0.6 : 1.5},eq=brightness=0[b];[1:v]scale=${W}:${H},format=rgba[f];[b][f]overlay=shortest=1`, "-frames:v", "1", "-q:v", "2", `${OUT}/thumbnail.jpg`]);
  }catch(e){}
  console.error(`\n${OUT}/ja.mp4  合計 ${ts(total)}（${total.toFixed(0)} 秒）`);
}

main().catch(e => { console.error("動画の作成に失敗しました:", e.message); process.exit(1); });
