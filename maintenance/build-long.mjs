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
const LANG = (process.argv[3] || process.env.LONG_LANG || "ja").toLowerCase();      // ja（日本語・VOICEVOX）／ en（英語・Kokoro）
if(!SET || !["ja", "en"].includes(LANG)){ console.error("使い方: node maintenance/build-long.mjs <SET> [ja|en]"); process.exit(1); }
const EN = LANG === "en";
const L = (ja, en) => EN ? en : ja;                       // 言語ごとの文言の切り替え
const andList = a => a.length <= 1 ? (a[0] || "") : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
const VV = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
const SPEAKER = +(process.env.VOICEVOX_SPEAKER || 3);
const SPEED = +(process.env.VOICEVOX_SPEED || 1.2);              // 長尺は聞き取りやすさ優先で、ショートと同じ速さ（3〜5分に収めるため）
const OUT = EN ? `long/${SET}/en` : `long/${SET}`;          // 英語版は long/<SET>/en/ に出す（日本語版と混ざらない）
const KOKORO_DIR = process.env.KOKORO_DIR || "short/kokoro";    // 英語の読み上げ（Kokoro）のモデル置き場（ショートと同じ）
const KOKORO_PY = process.env.KOKORO_PY || "python3";
const SITE = "sealed-workbench.com";
const BG = process.env.SHORT_BG || "short/bg.mp4";
const STILLS = !!process.env.LONG_STILLS;
const UA = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" };

const W = 1920, H = 1080, SCALE = 1.5;
const PINE = "#10304F", DEEP = "#0A2038", BLUE = "#2F7DF6", PAPER = "#F5F8FC", MUTED = "#A9C2DE";
const UP = "#5B9BFF", DOWN = "#F08A3E", GOLD = "#F2C94C", GREEN = "#4CC38A";
const COLOR = { W: "#F3EAC6", U: "#4A90E2", B: "#6B5E7A", R: "#E1553E", G: "#3E9B5B" };
const WITH_REMOVAL = false;   // コモン・アンコモンの除去一覧の章。いったん割愛中（戻すときは true）
const CJ = EN ? { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } : { W: "白", U: "青", B: "黒", R: "赤", G: "緑" };
const ZONES = EN ? ["2 mana or less", "3 mana", "4 mana", "5+ mana"] : ["2マナ以下", "3マナ", "4マナ", "5マナ以上"];     // マナカーブの区切り（組み合わせ別のマナ域）
const ORDER = "WUBRG";
const FONT = "'Noto Sans CJK JP','Noto Sans JP',sans-serif";
const CAP_Y = 900;                                   // 字幕を置く高さ（これより上に図を置く）

const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const pt = v => (v * 100).toFixed(1);
const sgn = v => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1);
const man = n => EN ? (n >= 10000 ? (Math.round(n / 1000) * 1000).toLocaleString("en-US") : n.toLocaleString("en-US")) : (n >= 10000 ? `${Math.round(n / 10000)}万` : n.toLocaleString("ja-JP"));
const pairName = p => [...p].map(c => CJ[c] || c).join(EN ? "-" : "");
const pairShort = p => EN ? [...p].join("") : pairName(p);       // 画面の狭いところ用（英語は WU のような略号）
const fitSize = (text, maxW, size) => EN ? Math.min(size, Math.floor(maxW / (Math.max([...String(text)].length, 1) * 0.58))) : size;   // 英語は長いので、枠に収まる大きさにする
const norm = p => [...p].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join("");
const T = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 40}" fill="${o.fill || PAPER}" font-weight="${o.weight || 400}"` +
  `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.op != null ? ` opacity="${o.op}"` : ""}>${esc(s)}</text>`;
const TS = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 100}" fill="${o.fill || "#FFFFFF"}" font-weight="900"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}` +
  ` stroke="#06101C" stroke-width="${Math.round((o.size || 100) * 0.16)}" stroke-linejoin="round" paint-order="stroke">${esc(s)}</text>`;
function wrapName(name, n){
  const t = String(name), ch = [...t];
  if(EN){      // 英語は単語で折り返す（半角は幅が約半分なので、日本語の n 字ぶんより多く入る）
    const m = Math.round(n * 1.9);
    if(ch.length <= m) return [t];
    const w = t.split(" "); let a = "", i = 0;
    for(; i < w.length; i++){ const nx = (a ? a + " " : "") + w[i]; if(nx.length > m) break; a = nx; }
    if(!a){ a = t.slice(0, m); return [a, t.slice(m).length > m ? t.slice(m, m * 2 - 1) + "…" : t.slice(m)]; }
    const b = w.slice(i).join(" ");
    return [a, b.length > m ? b.slice(0, m - 1) + "…" : b];
  }
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
         T(x, y + size * 0.17, EN ? c : (CJ[c] || c), { size: size * 0.42, weight: 900, anchor: "middle", fill: c === "W" ? DEEP : PAPER });
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
  const J = n => EN ? String(n).split(" // ")[0] : ((nm.names || {})[n] || n);
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
  scenes.push({ kind: "hook", art: true, chapter: L("はじめに", "Intro"),
    say: EN ? `Here's the complete ${nameJa} Limited format for MTG Arena, based on ${man(gamesD + gamesS)} games of data. The strongest colour pairs, ten bomb rares you can pick without hesitation, trap rares that look great but win less than you'd expect, and the best commons and uncommons for every colour. We'll look at both Draft and Sealed data.` : `MTGアリーナ、リミテッドの${nameJa}環境を、${man(gamesD + gamesS)}試合のデータでまるごと解説します。最強の色の組み合わせ、迷わず取っていいボムのレア十枚、見た目に反して勝てない罠なレアカード、そして、色別のおすすめのコモンとアンコモンまで。ドラフトとシールドの両方のデータで見ていきます。`,
    title: nameJa, gamesD, gamesS, tail: 0.6 });
  scenes.push({ kind: "agenda", say: EN ? `Here's the plan: format speed, colour pairs and deck speed, sleeper pairs, bombs, trap rares, and the best cards for each colour.` : `順番に、環境の速さ、色の組み合わせとデッキの速さ、ボム、罠なレアカード、色別のおすすめ${WITH_REMOVAL ? "、除去" : ""}まで見ていきます。`,
    items: (EN ? ["Format speed", "Colour strength", "Pair speed & mana curve", "Sleeper pairs", "Draft vs Sealed", "Top 10 bomb rares", "Trap rares", "Top commons & uncommons"] : ["環境の速さ", "色の強さ", "色の組み合わせと速さ", "狙い目の色", "ドラフトとシールドの違い", "ボムのレア10枚", "罠なレアカード", "色別のコモン・アンコモン"]).concat(WITH_REMOVAL ? ["除去（コモン・アンコモン）"] : []), tail: 0.4 });

  /* --- 速さ --- */
  const paceRows = d => (d.speed || []).filter(s => s.wr != null && s.games).map((s, i, a) => ({
    label: i === 0 ? L(`${s.max}未満`, `under ${s.max}`) : s.max ? L(`${a[i - 1].max}〜${s.max}`, `${a[i - 1].max}–${s.max}`) : L(`${a[i - 1].max}以上`, `${a[i - 1].max}+`), wr: s.wr }));
  const bestBand = rows => rows.reduce((m, r) => r.wr > m.wr ? r : m, rows[0]);
  const rowsD = paceRows(dd), rowsS = paceRows(ds);
  if(rowsD.length){
    const vk = (dd.verdict || {}).key, VW = EN ? { fast: "fast", "lean-fast": "slightly fast", even: "average", "lean-slow": "slightly slow", slow: "slow" } : { fast: "速い", "lean-fast": "やや速い", even: "普通", "lean-slow": "やや遅い", slow: "遅い" };
    const word = VW[vk] || L("普通", "average");
    const bD = bestBand(rowsD), bS = rowsS.length ? bestBand(rowsS) : null;
    const turns = dd.avg_turns ? L(`ゲームは平均${dd.avg_turns.toFixed(1)}ターンです。`, `Games last ${dd.avg_turns.toFixed(1)} turns on average.`) : "";
    // 一番勝っている帯が、軽い側か重い側か（最初の帯＝軽い、最後の帯＝重い、それ以外＝まんなか）
    const dirOf = (rows, b) => { const i = rows.indexOf(b); return i === 0 ? "light" : i === rows.length - 1 ? "heavy" : "mid"; };
    const DIRJ = EN ? { light: "light decks", heavy: "heavy decks", mid: "medium-weight decks" } : { light: "軽いデッキ", heavy: "重いデッキ", mid: "中くらいの重さのデッキ" };
    const dirD = dirOf(rowsD, bD), dirS = bS ? dirOf(rowsS, bS) : null;
    const spread = rows => Math.max(...rows.map(r => r.wr)) - Math.min(...rows.map(r => r.wr));
    const sameDir = !bS || dirS === dirD;
    const tagOf = d => d === "light" ? L("軽いほど有利", "Lighter is better") : d === "heavy" ? L("重いほど有利", "Heavier is better") : L("中くらいが有利", "Medium is best");
    const tagD = tagOf(dirD);
    const tagS = bS ? tagOf(dirS) : "";
    let sealedSay = "";
    if(bS){
      sealedSay = EN ? (sameDir
        ? `Sealed shows the same trend: the best win rate is ${pt(bS.wr)} percent, for decks with an average mana value of ${bS.label}.`
        : `In Sealed, it's the opposite: the best win rate is ${pt(bS.wr)} percent, for ${DIRJ[dirS]} at ${bS.label}. ` +
          (spread(rowsS) < 0.02 ? `But the gaps are small, so speed doesn't matter much in Sealed.` : `So in Sealed, ${DIRJ[dirS]} win more.`))
      : sameDir
        ? `シールドでも傾向は同じで、勝率が最も高いのは平均マナ総量${bS.label}のデッキの${pt(bS.wr)}パーセントです。`
        : `ところがシールドでは逆で、勝率が最も高いのは平均マナ総量${bS.label}の${DIRJ[dirS]}の${pt(bS.wr)}パーセントです。` +
          (spread(rowsS) < 0.02 ? `ただ、帯ごとの差は小さいので、シールドでは速さをあまり気にしなくて大丈夫です。` : `シールドでは、${DIRJ[dirS]}のほうが勝ちやすいということです。`);
    }
    scenes.push({ kind: "pace", chapter: L("環境の速さ", "Format speed"), word, rowsD, rowsS, tagD, tagS,
      sub: vk === "fast" || vk === "lean-fast" ? L("ドラフトは軽いデッキが勝ちやすい", "Lighter decks win more in Draft") : vk === "slow" || vk === "lean-slow" ? L("ドラフトは重いデッキが勝ちやすい", "Heavier decks win more in Draft") : L("ドラフトは速さで差がつきにくい", "Speed barely matters in Draft"),
      say: EN ? `First, format speed. In the Draft data, this is a ${word} format. Decks with an average mana value of ${bD.label} win the most, at ${pt(bD.wr)} percent. ${turns} ` + sealedSay : `まず環境の速さ。ドラフトのデータでは、${word}環境です。平均マナ総量が${bD.label}のデッキが、勝率${pt(bD.wr)}パーセントで一番勝っています。${turns}` + sealedSay,
      tail: 0.6 });
  }

  /* --- 色の強さ --- */
  if(monoD.length){
    const a = monoD[0], b = monoD[1], last = monoD[monoD.length - 1];
    scenes.push({ kind: "colors", chapter: L("色の強さ", "Colour strength"), colors: monoD, monoS,
      say: EN ? `Next, single colours. In Draft, ${CJ[a.color]} wins the most at ${pt(a.wr)} percent, followed by ${CJ[b.color]} at ${pt(b.wr)} percent. ${CJ[last.color]} is the lowest at ${pt(last.wr)} percent. But the gaps between colours are small, so prioritize the colour pairs and card quality we're about to see.` : `次に、単色の強さ。ドラフトで一番勝っているのは${CJ[a.color]}の${pt(a.wr)}パーセント、次が${CJ[b.color]}の${pt(b.wr)}パーセントです。一番低いのは${CJ[last.color]}で${pt(last.wr)}パーセント。ただ、色の差は小さいので、色よりも、これから見る色の組み合わせとカードの質を優先してください。`,
      tail: 0.6 });
  }

  /* --- 色の組み合わせ --- */
  if(pairsD.length){
    scenes.push({ kind: "pairs", chapter: L("色の組み合わせ", "Colour pairs"), pairsD, rankS, bestD, worstD,
      say: EN ? `Now, colour pairs. The strongest in Draft is ${pairName(bestD.pair)}, with a ${pt(bestD.wr)} percent win rate. The top three are ${andList(pairsD.slice(0, 3).map(p => pairName(p.pair)))}. ` +
           (sleepersTop.length ? `Of these, ${andList(sleepersTop.map(p => pairName(p.pair)))} ${sleepersTop.length > 1 ? "are" : "is"} under-drafted, so I'll cover ${sleepersTop.length > 1 ? "them" : "it"} later as a sleeper pair. ` : "") +
           `Blue bars are Draft win rates, and yellow bars are Sealed. ` + (pairsD.slice(0, 3).every((p, i) => rankS[p.pair] === i + 1) ? `The top of the Sealed ranking is the same.` : `You can see the Sealed ranking is shuffled.`) : `色の組み合わせです。ドラフトで一番強いのは${pairName(bestD.pair)}、勝率${pt(bestD.wr)}パーセント。上位三つは、${pairsD.slice(0, 3).map(p => pairName(p.pair)).join("、")}です。` +
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
    const isGold = c => c.color.length === 2;
    // まず、この2色のマルチカラー（コモン・アンコモン）を最大2枚。次に、各色の単色カードの最上位を1枚ずつ。残りは勝率の高い順
    const picked = list.filter(isGold).slice(0, 2);
    for(const col of [A, B]){ const c = list.find(x => x.color === col && !picked.includes(x)); if(c) picked.push(c); }
    for(const c of list){ if(picked.length >= n) break; if(!picked.includes(c)) picked.push(c); }
    const side = c => isGold(c) ? "2" : c.color === A ? A : c.color === B ? B : "";
    return withCommon(picked.slice(0, n), list, n, [A, B, A + B, B + A]).sort((x, y) => y.pg - x.pg).map(c => ({ ...c, label: J(c.name), side: side(c) }));
  };
  // 勝ちにくい組み合わせでは、2色のうち「弱いほうの色」のカードから選ぶ（強い色のカードを紹介すると、勝てない理由と合わなくなる）
  //   弱い色の単色カードを勝率の高い順に。足りなければ、2色のカード（その弱い色を含む）で埋める
  const weakColorOf = pair => {
    const [A, B] = [...pair], w = col => (monoD.find(c => c.color === col) || {}).wr;
    return (w(A) ?? 1) <= (w(B) ?? 1) ? A : B;
  };
  const keyCardsWeak = (pair, weak, n = 4) => {
    const strong = [...pair].find(c => c !== weak);
    const inPair = c => !!c.color && [...c.color].every(ch => pair.includes(ch));
    const list = rd.cards.filter(c => !c.land && inPair(c) && (c.rarity === "common" || c.rarity === "uncommon") && c.by_pair && c.by_pair[pair] && c.by_pair[pair][1] >= 250)
      .map(c => ({ ...c, pg: c.by_pair[pair][0], pgames: c.by_pair[pair][1] })).sort((x, y) => y.pg - x.pg);
    const isGold = c => c.color.length === 2;
    // この2色のマルチカラーを1枚 → 弱いほうの色の単色カードを2枚 → 強いほうの色の単色カードを1枚（両方の色を見せる）。足りなければ、勝率の高い順
    const picked = list.filter(isGold).slice(0, 1);
    picked.push(...list.filter(c => c.color === weak && !picked.includes(c)).slice(0, 2));
    const sc1 = list.find(c => c.color === strong && !picked.includes(c)); if(sc1) picked.push(sc1);
    for(const c of list){ if(picked.length >= n) break; if(!picked.includes(c)) picked.push(c); }
    const side = c => isGold(c) ? "2" : c.color === weak ? weak : c.color === strong ? strong : "";
    return withCommon(picked.slice(0, n), list, n, [weak, strong, pair, [...pair].reverse().join("")]).sort((x, y) => y.pg - x.pg).map(c => ({ ...c, label: J(c.name), side: side(c) }));
  };
  // 鍵になるカードを、色ごとに言い分けた一文にする
  // 鍵になるカードの言い方。コモン・アンコモンで集めやすい、という説明は最初の1回だけ丁寧に言い、2回目以降は言い回しを変えて、くり返しに聞こえないようにする
  let keyN = 0;
  const KEY_LEAD = EN ? ["The key cards are ", "Look out for ", "Make sure to pick up ", "The stars here are ", "Aim for "] : ["鍵になるのは、", "注目は、", "押さえたいのは、", "この色の主役は、", "狙いたいのは、"];
  const KEY_MORE = EN ? ["Also, ", "On top of that, ", "Another good pick: ", "Plus, ", "And "] : ["ほかに、", "さらに、", "ほかにも、", "あわせて、", "そして、"];
  const KEY_TAIL = EN ? [
    "They're all commons or uncommons, so they're easy to collect. ",
    "These are also all commons and uncommons. ",
    "",
    "Again, all easy-to-get cards. ",
    ""
  ] : [
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
    const a = ofCol(A), b = ofCol(B), gold = ks.filter(c => c.side === "2"), rest = ks.filter(c => c !== a && c !== b && c.side !== "2");
    const q = c => EN ? `“${c.label}”` : `「${c.label}」`;
    if(EN){
      const partsE = [a && `${CJ[A]}'s ${q(a)}`, b && `${CJ[B]}'s ${q(b)}`, gold.length && `the two-colour ${andList(gold.slice(0, 2).map(q))}`].filter(Boolean);
      let te = KEY_LEAD[n % KEY_LEAD.length] + (partsE.length ? andList(partsE) : andList(ks.slice(0, 2).map(q))) + ". ";
      if(partsE.length && rest.length) te += `${KEY_MORE[n % KEY_MORE.length]}${andList(rest.slice(0, 2).map(q))} ${rest.slice(0, 2).length > 1 ? "are" : "is"} worth picking up too. `;
      return te + KEY_TAIL[n % KEY_TAIL.length];
    }
    const parts = [a && `${CJ[A]}は${q(a)}`, b && `${CJ[B]}は${q(b)}`, gold.length && `二色のカードは${gold.slice(0, 2).map(q).join("、")}`].filter(Boolean);
    let t = KEY_LEAD[n % KEY_LEAD.length] + (parts.length ? parts.join("、") : ks.slice(0, 2).map(q).join("、")) + "。";
    if(parts.length && rest.length) t += `${KEY_MORE[n % KEY_MORE.length]}${rest.slice(0, 2).map(q).join("、")}もおすすめです。`;
    return t + KEY_TAIL[n % KEY_TAIL.length];
  };
  /* --- 組み合わせごとの「速いデッキを組むか、遅めのデッキを組むか」。勝率データ（pair_speed）があるときだけ --- */
  const SP_LABEL = EN ? { fast: "under 2.9", mid: "2.9–3.2", slow: "3.2–3.5", slower: "3.5+" } : { fast: "2.9未満", mid: "2.9〜3.2", slow: "3.2〜3.5", slower: "3.5以上" };
  const DIR_WORD = EN ? { light: "light decks", mid: "medium-weight decks", heavy: "heavy decks" } : { light: "軽いデッキ", mid: "中くらいの重さのデッキ", heavy: "重いデッキ" };
  const dirIn = (rows, b) => { const i = rows.indexOf(b); return i === 0 ? "light" : i === rows.length - 1 ? "heavy" : "mid"; };
  const envDir = rowsD.length >= 3 ? dirIn(rowsD, bestBand(rowsD)) : null;
  /* 組み合わせごとの「マナ域」の傾向。
     ・カード単位（いつでも出せる）：コモン・アンコモンの、2マナ以下／3／4／5以上ごとの勝率（その2色のデッキでの GIH 勝率の試合数つき平均）
     ・デッキ単位（pair_curve があるとき）：そのマナ域のカードを何枚入れたデッキが勝っているか。「N枚以上入れると勝率が上がる」目安を出す */
  const curveInfo = pair => {
    const zoneOf = c => c.cmc <= 2 ? 0 : c.cmc === 3 ? 1 : c.cmc === 4 ? 2 : 3;
    const agg = [0, 1, 2, 3].map(() => ({ g: 0, w: 0 }));
    for(const c of rd.cards){
      if(c.land || c.cmc == null || !(c.rarity === "common" || c.rarity === "uncommon") || !c.by_pair || !c.by_pair[pair] || c.by_pair[pair][1] < 100) continue;
      const a = agg[zoneOf(c)]; a.g += c.by_pair[pair][1]; a.w += c.by_pair[pair][0] * c.by_pair[pair][1];
    }
    const tg = agg.reduce((n, a) => n + a.g, 0);
    if(tg < 3000) return null;
    const avg = agg.reduce((n, a) => n + a.w, 0) / tg;
    const zones = agg.map((a, z) => ({ label: ZONES[z], games: a.g, wr: a.g >= tg * 0.05 ? a.w / a.g : null }));
    const ok = zones.map((z, i) => ({ ...z, i })).filter(z => z.wr != null);
    if(ok.length < 3) return null;
    const bestZ = ok.reduce((m, z) => z.wr > m.wr ? z : m, ok[0]);
    // デッキ単位：枚数のしきい値 t ごとに「t枚以上のデッキ」と「t枚未満のデッキ」の勝率を比べる
    let more = null, less = null;
    const pc = (rd.pair_curve || {})[pair];
    if(pc){
      for(let z = 0; z < 4; z++){
        const arr = pc[z], G = arr.reduce((n, e) => n + e[0], 0);
        if(G < 3000) continue;
        for(let t = 1; t <= 12; t++){
          let hg = 0, hw = 0, lg = 0, lw = 0;
          arr.forEach((e, c) => { if(c >= t){ hg += e[0]; hw += e[1]; } else { lg += e[0]; lw += e[1]; } });
          if(hg < G * 0.15 || lg < G * 0.10) continue;
          const hi = hw / hg, lo = lw / lg, lift = hi - lo;
          if(lift >= 0.01 && (!more || lift > more.lift)) more = { z, t, hi, lo, lift };
          if(lift <= -0.01 && (!less || lift < less.lift)) less = { z, t, hi, lo, lift };
        }
      }
    }
    return { zones, avg, bestZ, more, less };
  };
  const curveSay = (ci, nm) => {
    if(!ci) return "";
    let t = "";
    if(EN){
      if(ci.more){
        const m = ci.more;
        t += ` On the mana curve, decks with ${m.t} or more cards at ${ZONES[m.z]} win ${pt(m.hi)} percent, versus ${pt(m.lo)} percent for decks with fewer. That's ${pt(m.lift)} points higher, so aim for at least ${m.t} cards at ${ZONES[m.z]} for a stable deck.`;
      }else{
        t += ` On the mana curve, the best commons and uncommons are at ${ci.bestZ.label}, winning ${pt(ci.bestZ.wr)} percent. Try to pick more cards from this range.`;
      }
      if(ci.less && (!ci.more || ci.less.z !== ci.more.z)) t += ` On the other hand, decks with ${ci.less.t} or more cards at ${ZONES[ci.less.z]} win less, so keep it to ${ci.less.t - 1} or fewer.`;
      return t;
    }
    if(ci.more){
      const m = ci.more;
      t += `マナカーブでは、${ZONES[m.z]}のカードを${m.t}枚以上入れたデッキの勝率が${pt(m.hi)}パーセントで、それ未満の${pt(m.lo)}パーセントより${pt(m.lift)}ポイント高くなっています。${ZONES[m.z]}は、${m.t}枚以上を目安にすると安定します。`;
    }else{
      t += `マナカーブでは、コモンとアンコモンの勝率が一番高いのは${ci.bestZ.label}のカードで、${pt(ci.bestZ.wr)}パーセントです。このマナ域を、意識して多めに取りましょう。`;
    }
    if(ci.less && (!ci.more || ci.less.z !== ci.more.z)){
      t += `逆に、${ZONES[ci.less.z]}のカードは、${ci.less.t}枚以上入れると勝率が下がるので、${ci.less.t - 1}枚までにしておきましょう。`;
    }
    return t;
  };
  const pairSpeedScene = p => {
    const raw = (rd.pair_speed || {})[p.pair];
    const tot = raw ? raw.reduce((n, r) => n + r.games, 0) : 0;
    const rows = raw ? raw.filter(r => r.wr != null && r.games >= Math.max(300, tot * 0.04)).map(r => ({ ...r, label: SP_LABEL[r.key] || "" })) : [];
    const hasSpeed = tot >= 3000 && rows.length >= 3;
    const ci = curveInfo(p.pair);
    if(!hasSpeed && !ci) return null;
    const nm = pairName(p.pair);
    let say = "", best = null, low = null, dir = null;
    if(hasSpeed){
      best = bestBand(rows); low = rows.reduce((m, r) => r.wr < m.wr ? r : m, rows[0]);
      const spread = best.wr - low.wr;
      dir = spread < 0.012 ? "even" : dirIn(rows, best);
      if(EN){
        if(dir === "even") say = `${nm}: deck speed. The gap between the best and worst mana value brackets is ${spread < 0.005 ? "almost nothing" : `only ${pt(spread)} points`}. So don't worry about speed with this pair; build around what you're given.`;
        else{
          const core = `Decks with an average mana value of ${best.label} win the most, at ${pt(best.wr)} percent. The lowest, ${low.label}, wins ${pt(low.wr)} percent, a gap of ${pt(spread)} points.`;
          const adv = dir === "light" ? `Build a light, fast deck with this pair.` : dir === "heavy" ? `With this pair, a slower, heavier deck is fine.` : `Too fast or too heavy loses win rate, so build a balanced, medium-weight deck.`;
          const diff = envDir && envDir !== dir ? ` Across the whole format, ${DIR_WORD[envDir]} do better, so this pair is a little different.` : "";
          say = `${nm}: deck speed. ` + core + " " + adv + diff;
        }
      }else if(dir === "even"){
        say = `${nm}の、デッキの速さです。平均マナ総量ごとの勝率は、一番高い帯と低い帯で、${spread < 0.005 ? "ほとんど差がありません" : `差が${pt(spread)}ポイントしかありません`}。この組み合わせは、速さをあまり気にせず、配られたカードで組んで大丈夫です。`;
      }else{
        const core = `平均マナ総量が${best.label}のデッキが、勝率${pt(best.wr)}パーセントで一番勝っています。一番低い${low.label}のデッキは${pt(low.wr)}パーセントで、${pt(spread)}ポイントの差です。`;
        const adv = dir === "light" ? `この組み合わせは、軽くて速いデッキを組みましょう。` : dir === "heavy" ? `この組み合わせは、遅めでゆったりした、重いデッキを組んで大丈夫です。` : `速すぎても重すぎても勝率が下がるので、中くらいの重さで、バランスよく組みましょう。`;
        const diff = envDir && envDir !== dir ? `環境全体では${DIR_WORD[envDir]}が有利なので、この組み合わせは少し傾向が違います。` : "";
        say = `${nm}の、デッキの速さです。` + core + adv + diff;
      }
    }else say = L(`${nm}の、マナカーブです。`, `${nm}: mana curve.`);
    say += curveSay(ci, nm);
    return { kind: "pairspeed", chapter: null, pair: p.pair, rows, best, low, dir, wrPair: p.wr, envDir, curve: ci, say, tail: 0.5 };
  };
  const pushSpeed = p => { const sp = pairSpeedScene(p); if(sp) scenes.push(sp); };

  const deep = (p, i, kind) => {
    const share = p.games / totalPG, avgShare = 1 / pairsD.length;
    const weak = kind === "worst" ? weakColorOf(p.pair) : null;
    const ks = kind === "worst" ? keyCardsWeak(p.pair, weak) : keyCards(p.pair);
    const sealedWr = (pairsS.find(x => x.pair === p.pair) || {}).wr;
    const ordinal = ["一番", "二番目に", "三番目に"][i];
    const ordinalE = ["The strongest pair is", "Second is", "Third is"][i];
    const sleeperSayE = () => {
      const rel = p.wr >= avgD ? `That's above the format average of ${pt(avgD)} percent.` : `That's about the same as the format average of ${pt(avgD)} percent.`;
      return `${pairName(p.pair)} wins ${pt(p.wr)} percent in Draft${rankD[p.pair] <= 3 ? `, ranking number ${rankD[p.pair]}` : ""}. ${rel} Yet only ${Math.round(share * 100)} percent of decks play it, below the average of ${Math.round(avgShare * 100)} percent. ` +
        `Fewer players compete for its cards, so it's a great target when the strong colours aren't flowing. ` + keySay(ks, p.pair) + (sealedWr != null ? `The Sealed win rate is ${pt(sealedWr)} percent.` : "");
    };
    const sleeperSay = () => {
      const rk = rankD[p.pair] <= 3 ? `ドラフト${rankD[p.pair]}位で、` : "";
      const rel = p.wr >= avgD ? `これは全体の平均${pt(avgD)}パーセントを上回っています。` : `これは全体の平均${pt(avgD)}パーセントと、ほぼ同じです。`;
      return `${pairName(p.pair)}は、${rk || "ドラフトの"}勝率は${pt(p.wr)}パーセント。${rel}それなのに、使っている人は全体の${Math.round(share * 100)}パーセントで、平均の${Math.round(avgShare * 100)}パーセントより少なめです。` +
        `カードの取り合いになりにくいので、強い色が流れてこないときの、狙い目です。` + keySay(ks, p.pair) + (sealedWr != null ? `シールドの勝率は${pt(sealedWr)}パーセントです。` : "");
    };
    const sayE = kind === "sleeper" ? sleeperSayE() : kind === "worst"
      ? `On the other end, the hardest pair to win with is ${pairName(p.pair)}, at ${pt(p.wr)} percent. ` + (ks.length ? `Still, cards like “${(ks.find(c => c.side === weak) || ks[0]).label}” shine in this pair. ` : "") + `Unless the cards just happen to flow your way, there's no need to force it.`
      : `${ordinalE} ${pairName(p.pair)}. Its Draft win rate is ${pt(p.wr)} percent, and ${Math.round(share * 100)} percent of all decks use it. ` + keySay(ks, p.pair) + (sealedWr != null ? `The Sealed win rate is ${pt(sealedWr)} percent.` : "");
    const say = EN ? sayE : kind === "sleeper" ? sleeperSay() : kind === "worst"
      ? `反対に、一番勝ちにくいのは${pairName(p.pair)}で、勝率${pt(p.wr)}パーセント。` + (ks.length ? `それでも、「${(ks.find(c => c.side === weak) || ks[0]).label}」のように、この組み合わせで光るカードはあります。` : "") + `カードが流れてきた、という理由がなければ、無理に目指さなくて大丈夫です。`
      : `${ordinal}強い${pairName(p.pair)}。ドラフトの勝率は${pt(p.wr)}パーセントで、使われているのは全体の${Math.round(share * 100)}パーセントです。` + keySay(ks, p.pair) + (sealedWr != null ? `シールドの勝率は${pt(sealedWr)}パーセントです。` : "");
    return { kind: "deep", chapter: null, variant: kind, weak, pair: p.pair, wr: p.wr, sealedWr, share, avgShare, rank: rankD[p.pair], cards: ks, say, tail: 0.5 };
  };
  // 上位3つの深堀り（狙い目に回るものは、そちらで紹介するので、ここでは飛ばす）。順位の言い方は、実際の順位から決める
  pairsD.slice(0, 3).forEach((p, i) => { if(!sleepers.includes(p)){ scenes.push(deep(p, i, "top")); pushSpeed(p); } });
  if(worstD && worstD !== bestD){ scenes.push(deep(worstD, 0, "worst")); pushSpeed(worstD); }

  /* --- 狙い目の色：勝率がそこそこ高く（全体の平均付近以上）、使っている人が少なめ（平均の85%以下）。最大2つ --- */
  sleepers.forEach((p, i) => {
    const sc = deep(p, 0, "sleeper");
    if(i === 0){ sc.chapter = L("狙い目の色", "Sleeper pairs"); sc.say = L(`ここで、狙い目の色を紹介します。勝率がそこそこ高くて、使う人が少ない、つまりカードが取りやすい色の組み合わせです。`, `Now for the sleeper pairs. These have a decent win rate but few players, which means their cards are easy to get. `) + sc.say; }
    else sc.say = L(`もう一つ。`, `One more. `) + sc.say;
    scenes.push(sc);
    pushSpeed(p);
  });

  /* --- ドラフトとシールドの違い --- */
  {
    const both = pairsD.filter(p => rankS[p.pair] && p.games >= 1500).map(p => ({ ...p, rd: rankD[p.pair], rs: rankS[p.pair], diff: rankD[p.pair] - rankS[p.pair] }));
    const upC = both.slice().sort((a, b) => b.diff - a.diff)[0], downC = both.slice().sort((a, b) => a.diff - b.diff)[0];
    const up = upC && upC.diff > 0 ? upC : null, down = downC && downC.diff < 0 ? downC : null;
    const cardsBoth = rd.cards.filter(c => !c.land && (c.rarity === "rare" || c.rarity === "mythic") && c.games >= 1500)
      .map(c => { const s = cardOf(rs.cards, c.name); return s && s.games >= 500 ? { name: c.name, label: J(c.name), d: c.gih, s: s.gih, diff: s.gih - c.gih } : null; }).filter(Boolean);
    const cUp = cardsBoth.slice().sort((a, b) => b.diff - a.diff).slice(0, 3), cDown = cardsBoth.slice().sort((a, b) => a.diff - b.diff).slice(0, 3);
    let say = EN ? `Draft versus Sealed. In Sealed, you build from the six packs you're given, so you can't choose your colours like in Draft. ` : `ドラフトとシールドの違いです。シールドは、配られた六パックから組むので、ドラフトのように色を選べません。`;
    if(EN){
      if(up && up.diff > 0) say += `${pairName(up.pair)} ranks number ${up.rd} in Draft but number ${up.rs} in Sealed, so it's stronger in Sealed. `;
      if(down && down.diff < 0) say += `On the other hand, ${pairName(down.pair)} is number ${down.rd} in Draft and number ${down.rs} in Sealed. `;
      say += `By card, ratings go up in Sealed for ${andList(cUp.slice(0, 2).map(c => c.label))}, and down for ${andList(cDown.slice(0, 2).map(c => c.label))}.`;
    }else{
    if(up && up.diff > 0) say += `${pairName(up.pair)}は、ドラフトで${up.rd}位、シールドで${up.rs}位と、シールドのほうが強く出ています。`;
    if(down && down.diff < 0) say += `逆に${pairName(down.pair)}は、ドラフトで${down.rd}位、シールドでは${down.rs}位です。`;
    say += `カードで見ると、シールドで評価が上がるのは${cUp.slice(0, 2).map(c => c.label).join("、")}。下がるのは${cDown.slice(0, 2).map(c => c.label).join("、")}です。`;
    }
    scenes.push({ kind: "dvs", chapter: L("ドラフトとシールドの違い", "Draft vs Sealed"), up, down, cUp, cDown, cards: [...cUp.slice(0, 2), ...cDown.slice(0, 2)], avgD, avgS, say, tail: 0.6 });
  }

  /* --- ボム10枚 --- */
  const rareD = rd.cards.filter(c => !c.land && (c.rarity === "rare" || c.rarity === "mythic") && c.games >= 1500).sort((a, b) => b.gih - a.gih);
  const bombs = rareD.slice(0, 10).map((c, i) => {
    const s = cardOf(rs.cards, c.name);
    return { ...c, label: J(c.name), rank: i + 1, sGih: s && s.games >= 300 ? s.gih : null, sGames: s ? s.games : 0 };
  });
  if(bombs.length >= 10){
    scenes.push({ kind: "bombs", chapter: L("ボムのレア10枚", "Top 10 bomb rares"), cards: bombs.slice(0, 5), avgD, part: 1,
      say: EN ? `Now the bombs: the top ten. They're ranked by win rate when drawn, the GIH win rate, among mythics and rares, counting only cards with at least 1,500 games. ` + bombs.slice(0, 5).map(c => `Number ${c.rank}, ${c.label}, ${pt(c.gih)} percent. `).join("") : `ここからがボム、十枚です。引いた試合の勝率、GIH勝率の高い順で、神話レアとレアから選びました。試合数が少ないカードは数字がぶれるので、千五百試合以上のカードに限っています。` +
           bombs.slice(0, 5).map(c => `${c.rank}位、${c.label}、${pt(c.gih)}パーセント。`).join(""), tail: 0.6 });
    scenes.push({ kind: "bombs", chapter: null, cards: bombs.slice(5, 10), avgD, part: 2,
      say: EN ? bombs.slice(5, 10).map(c => `Number ${c.rank}, ${c.label}, ${pt(c.gih)} percent. `).join("") + `If you draw any of these, build your deck around it, even if the colours don't quite fit. The format average is ${pt(avgD)} percent, and every one of these is well above it.`
         : bombs.slice(5, 10).map(c => `${c.rank}位、${c.label}、${pt(c.gih)}パーセント。`).join("")
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
    scenes.push({ kind: "traps", chapter: L("罠なレアカード", "Trap rares"), cards: traps, avgD, rareAvg,
      say: EN ? `Next, trap rares. These are rares that win less than the average rare when drawn. The rare average is ${pt(rareAvg)} percent. ` + traps.map(c => `${c.label} wins ${pt(c.gih)} percent. `).join("") +
           `That doesn't mean they're weak cards, just that they often don't work well in decks. If you have better options, don't force them in.` : `次は、罠なレアカード。レアなのに、引いた試合の勝率がレア全体の平均より低いものです。レアの平均は${pt(rareAvg)}パーセント。` +
           traps.map((c, i) => `${c.label}は${pt(c.gih)}パーセント。`).join("") +
           `弱いカードという意味ではなく、デッキに入れて、うまく使えていないことが多い、ということです。ほかに強いカードがあるなら、無理に使わなくていいです。`, tail: 0.6 });
  }

  /* --- 色別のおすすめ：その色（単色）のコモンとアンコモンを、引いた試合の勝率が高い順に5枚ずつ --- */
  {
    const avgOf = rarity => { const pool = rd.cards.filter(c => c.rarity === rarity && !c.land && c.games >= 1500); return pool.reduce((n, c) => n + c.gih * c.games, 0) / (pool.reduce((n, c) => n + c.games, 0) || 1); };
    const comAvg = avgOf("common"), uncAvg = avgOf("uncommon");
    // 単色は色ごと。"M" はマルチカラー（2色以上）、"C" は無色（土地は除く）
    const inKey = (key, c) => key === "M" ? (c.color || "").length >= 2 : key === "C" ? !c.color : c.color === key;
    const topIn = (col, rarity) => rd.cards.filter(c => !c.land && inKey(col, c) && c.rarity === rarity && c.games >= 1500)
      .sort((a, b) => b.gih - a.gih).slice(0, 5).map((c, i) => ({ ...c, label: J(c.name), rank: i + 1 }));
    const order = [...(monoD.length ? monoD.map(c => c.color).filter(c => "WUBRG".includes(c)) : ["W", "U", "B", "R", "G"]), "M", "C"];
    const KJ = { ...CJ, M: L("マルチカラー", "Multicolour"), C: L("無色", "Colourless") };
    const list = [];
    for(const col of order){ const com = topIn(col, "common"), unc = topIn(col, "uncommon"); if((col === "M" || col === "C") ? com.length + unc.length >= 3 : (com.length >= 3 && unc.length >= 3)) list.push({ col, com, unc }); }   // 多色・無色は、枚数が少ない（コモンが無い）環境もあるので、合わせて3枚以上あれば出す
    list.forEach((e, i) => {
      const rep3E = (en, arr) => arr.length
        ? `The top ${en} is ${arr[0].label}, at ${pt(arr[0].gih)} percent. ${arr.length > 1 ? "Also good: " + andList(arr.slice(1, 3).map(c => c.label)) + ". " : ""}`
        : `There are no ${en}s in ${KJ[e.col]} in this format. `;
      const rep3 = (jp, arr) => arr.length
        ? `${jp}の代表は、${arr[0].label}、${pt(arr[0].gih)}パーセント。${arr.length > 1 ? "ほかに、" + arr.slice(1, 3).map(c => c.label).join("、") + "。" : ""}`
        : `${jp}の${KJ[e.col]}は、この環境にありません。`;
      scenes.push({ kind: "colortop", chapter: i === 0 ? L("色別のコモン・アンコモン", "Top commons & uncommons") : null, color: e.col, com: e.com, unc: e.unc, comAvg, uncAvg, cards: [...e.com.slice(0, 3), ...e.unc.slice(0, 3)],
        say: EN ? (i === 0 ? `Next, the best cards by colour. Besides the five colours, I'll also cover multicolour and colourless cards. Commons and uncommons are ranked by win rate when drawn, five each. ` : "") +
                  `${KJ[e.col]}. ` + rep3E("common", e.com) + rep3E("uncommon", e.unc) + `The rest are shown here.`
        : (i === 0 ? `次は、色別のおすすめです。五色に加えて、マルチカラーと無色も紹介します。コモンとアンコモンを、引いた試合の勝率が高い順に、五枚ずつ並べました。` : "") +
             `${KJ[e.col]}です。` + rep3("コモン", e.com) + rep3("アンコモン", e.unc) + `そのほかは、こちらになっています。`, tail: 0.5 });
    });
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
  if(WITH_REMOVAL){
    if(remC) scenes.push(remC);
    if(remU){ if(remC) remU.chapter = null; scenes.push(remU); }
  }


  /* --- まとめ --- */
  {
    const paceSc = scenes.find(x => x.kind === "pace");
    const bestMono = monoD[0];
    const sealedBest = bestD ? (pairsS.find(x => x.pair === bestD.pair) || {}).wr : null;
    const b3 = bombs.slice(0, 3), t3 = traps.slice(0, 3);
    const remSc = WITH_REMOVAL ? scenes.find(x => x.kind === "removal") : null, r3 = remSc ? remSc.cards.slice(0, 3) : [];
    const sum = {
      kind: "summary", chapter: L("まとめ", "Summary"),
      pace: paceSc ? { word: paceSc.word, sub: paceSc.sub } : null,
      mono: bestMono ? { color: bestMono.color, wr: bestMono.wr } : null,
      best: bestD ? { pair: bestD.pair, wr: bestD.wr, sWr: sealedBest } : null,
      worst: worstD && worstD !== bestD ? { pair: worstD.pair, wr: worstD.wr } : null,
      b3, t3, r3, cards: [...b3, ...t3, ...r3]
    };
    sum.say = EN ? `To sum up. ` +
      (sum.pace ? `This is a ${sum.pace.word} format. ` : "") +
      (sum.mono ? `${pairName(sum.mono.color)} is the strongest colour. ` : "") +
      (sum.best ? `The best pair is ${pairName(sum.best.pair)}, winning ${pt(sum.best.wr)} percent in Draft. ` : "") +
      (sum.worst ? `On the other hand, ${pairName(sum.worst.pair)} wins only ${pt(sum.worst.wr)} percent, so don't force it. ` : "") +
      (b3.length ? `The bombs to take without hesitation are ${andList(b3.map(c => c.label))}. ` : "") +
      (t3.length ? `Watch out for the traps: ${andList(t3.slice(0, 2).map(c => c.label))}. ` : "") +
      `You can find every card's win rate on our site.`
    : `まとめです。` +
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
    say: EN ? `Thanks for watching to the end. We'll have the next set soon, so if you're an MTG Limited player, please subscribe.` : `最後まで、ご視聴ありがとうございました。次のセットも出すので、MTGのリミテッドプレイヤーは、チャンネル登録をお願いします。`, tail: 9 });
  return scenes;
}

/* ------------------------------------------------------------ 画面 */

let HAS_BG = false;
const HEADER = { title: "" };
function header(sc){
  const band = `<rect x="40" y="24" width="${W - 80}" height="84" rx="20" fill="${DEEP}" opacity="${HAS_BG ? 0.6 : 0.35}"/>`;
  return band + T(76, 82, HEADER.title, { size: 42, fill: BLUE, weight: 900 }) +
    T(W - 76, 80, sc.crumb || L("リミテッド環境分析", "Limited format analysis"), { size: 34, fill: MUTED, weight: 700, anchor: "end" });
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
    s += T(lx - 24, y + 14, r.label, { size: L(36, 30), anchor: "end" });
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
        (sc.arenaLogo ? `<image href="${sc.arenaLogo}" x="82" y="14" width="400" height="140" preserveAspectRatio="xMinYMid meet"/>` : T(90, 110, L("MTGアリーナ", "MTG Arena"), { size: 64, weight: 900, fill: "#FFFFFF" })) +
        (sc.setLogo ? `<image href="${sc.setLogo}" x="82" y="152" width="1100" height="248" preserveAspectRatio="xMinYMid meet"/>`
                    : TS(90, 340, title, { size: sz, fill: "#FFD23F" })) +
        TS(90, 590, L("リミテッド", "Limited"), { size: 120 }) + TS(90, 718, L("完全ガイド", "Full Guide"), { size: 120 }) +
        `<rect x="90" y="764" width="680" height="100" rx="50" fill="${BLUE}" stroke="#FFFFFF" stroke-width="6"/>` +
        T(430, 832, L("ドラフト＋シールド環境", "Draft + Sealed"), { size: 54, weight: 900, anchor: "middle", fill: "#06101C" }) +
        // 右下：勝率の高いボム。拡大した絵ではなく、カードそのものを少し傾けて並べる
        cards.map((c, i) => {
          const x = cx0 + i * step, yy = 395 + (i === 1 ? -26 : 0), rot = (i - (cards.length - 1) / 2) * 4;
          return `<g transform="rotate(${rot} ${x + CW / 2} ${yy + CH / 2})"><rect x="${x + 8}" y="${yy + 12}" width="${CW}" height="${CH}" rx="18" fill="#000" opacity="0.45"/>${cardImg(c, x, yy, CW, CH)}</g>`;
        }).join(""), sc, { header: false });
    }
    case "agenda": {
      let s = T(W / 2, 185, L("この動画の流れ", "In this video"), { size: 52, weight: 900, anchor: "middle" });
      sc.items.forEach((t, i) => {
        const col = i % 2, row = Math.floor(i / 2), lastAlone = i === sc.items.length - 1 && sc.items.length % 2 === 1;
        const x = lastAlone ? (W - 720) / 2 : 220 + col * 760, y = 235 + row * 124;      // 5行でも、最後の行が字幕（y=900〜）に掛からない
        s += panel(x, y, 720, 100) + `<circle cx="${x + 56}" cy="${y + 52}" r="30" fill="${BLUE}"/>` + T(x + 56, y + 66, String(i + 1), { size: 36, weight: 900, anchor: "middle" }) + T(x + 112, y + 68, t, { size: fitSize(t, 580, 40), weight: 700 });
      });
      return frame(s, sc);
    }
    case "pace": {
      const wordSize = EN ? 90 : 90, wordW = EN ? [...sc.word].length * 50 : [...sc.word].length * 94;
      let s = T(80, 190, L("環境の速さ", "Format speed"), { size: 40, fill: MUTED }) + T(80, 290, EN ? sc.word.charAt(0).toUpperCase() + sc.word.slice(1) : sc.word, { size: wordSize, weight: 900, fill: BLUE }) +
              T(80 + wordW + 30, 285, sc.sub, { size: EN ? 40 : 44 });
      s += T(80, 360, L("デッキの平均マナ総量ごとの勝率", "Win rate by deck's average mana value"), { size: 32, fill: MUTED });
      s += paceChart(80, 940, L("ドラフト", "Draft"), sc.rowsD, UP, sc.tagD);
      if(sc.rowsS.length) s += paceChart(1000, 1840, L("シールド", "Sealed"), sc.rowsS, GOLD, sc.tagS);
      return frame(s, sc);
    }
    case "colors": {
      let s = T(80, 215, L("単色の勝率", "Single-colour win rates"), { size: 40, fill: MUTED });
      const lo = 52, hi = Math.max(...sc.colors.map(c => c.wr * 100)) + 2;
      sc.colors.forEach((c, i) => {
        const x = 150 + i * 360;
        s += symbol(c.color, x + 80, 330, 130);
        const h = 4 + (c.wr * 100 - lo) / (hi - lo) * 260;
        s += `<rect x="${x + 10}" y="${760 - h}" width="140" height="${h}" rx="10" fill="${i < 2 ? UP : "#46698F"}"/>`;
        s += T(x + 80, 760 - h - 18, pt(c.wr) + "%", { size: 44, weight: 900, anchor: "middle" });
        s += T(x + 80, 810, `${L("シールド", "Sealed")} ${sc.monoS[c.color] != null ? pt(sc.monoS[c.color]) + "%" : "—"}`, { size: 32, anchor: "middle", fill: GOLD });
      });
      s += T(80, 850, L("ドラフトの勝率（棒）と シールドの勝率（下の金色の数字）", "Draft win rate (bars) and Sealed win rate (gold numbers below)"), { size: 28, fill: MUTED });
      return frame(s, sc);
    }
    case "pairs": {
      let s = T(80, 175, L("2色の組み合わせ 勝率（高い順）", "Two-colour pairs: win rate (best first)"), { size: L(40, 36), fill: MUTED }) + `<rect x="1380" y="140" width="22" height="22" rx="4" fill="${UP}"/>` + T(1412, 160, L("ドラフト", "Draft"), { size: 28, fill: MUTED }) +
              `<rect x="1580" y="144" width="22" height="14" rx="4" fill="${GOLD}"/>` + T(1612, 160, L("シールド", "Sealed"), { size: 28, fill: MUTED });
      const rows = sc.pairsD, sm = sc.sealedMap || {};
      const all = [...rows.map(r => r.wr * 100), ...rows.map(r => sm[r.pair]).filter(v => v != null).map(v => v * 100)];
      const lo = Math.floor(Math.min(...all) - 1), hi = Math.max(...all) + 0.4;      // 最長の棒を右端ちかくまで伸ばす（右に余白が残らないように）
      const step = Math.min(120, 640 / rows.length);
      rows.forEach((r, i) => {
        const y = 215 + i * step, bx0 = 470, bx1 = 1720, xv = v => scaleX(v, lo, hi, bx0, bx1);
        const hot = r === sc.bestD, cold = r === sc.worstD && rows.length > 2;
        s += T(70, y + 50, String(i + 1), { size: 34, fill: MUTED });
        s += pairSymbols(r.pair, 120, y + 30, 50) + T(262, y + 52, pairShort(r.pair), { size: 44, weight: 900 });
        s += `<rect x="${bx0}" y="${y + 6}" width="${xv(r.wr * 100) - bx0}" height="34" rx="8" fill="${hot ? UP : cold ? DOWN : "#46698F"}"/>`;
        s += T(xv(r.wr * 100) + 16, y + 36, pt(r.wr) + "%", { size: 36, weight: 900 });
        // 一番下の行は「勝ちにくい」のか、単に順位が低いだけなのか、見分けがつかないので、はっきり書く
        if(cold) s += `<rect x="${xv(r.wr * 100) + 140}" y="${y + 3}" width="180" height="36" rx="18" fill="${DOWN}"/>` + T(xv(r.wr * 100) + 230, y + 31, L("勝ちにくい", "Weakest"), { size: 26, weight: 900, anchor: "middle", fill: "#1A0E02" });
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
      let s = T(80, 175, worst ? L("一番勝ちにくい組み合わせ", "Hardest pair to win with") : sleeper ? L("狙い目の組み合わせ", "Sleeper pair") : L(`ドラフト ${sc.rank}位の組み合わせ`, `#${sc.rank} pair in Draft`), { size: 40, fill: col, weight: 700 });
      s += pairSymbols(sc.pair, 90, 280, 120) + T(90, 440, pairName(sc.pair), { size: fitSize(pairName(sc.pair), 600, 100), weight: 900 });
      s += T(90, 580, pt(sc.wr) + "%", { size: 130, weight: 900, fill: col });
      s += T(90, 650, L("ドラフトの勝率", "Draft win rate"), { size: 32, fill: MUTED });
      s += T(90, 730, sc.sealedWr != null ? `${L("シールド", "Sealed")} ${pt(sc.sealedWr)}%` : `${L("シールド", "Sealed")} —`, { size: 44, weight: 700, fill: GOLD });
      s += T(90, 800, L(`使用率 ${Math.round(sc.share * 100)}%（平均 ${Math.round(sc.avgShare * 100)}%）`, `Played in ${Math.round(sc.share * 100)}% of decks (avg ${Math.round(sc.avgShare * 100)}%)`), { size: 38, fill: sleeper ? GREEN : PAPER, weight: sleeper ? 900 : 400 });
      if(sc.cards.length){
        s += T(740, 175, sc.variant === "sleeper" ? L("狙える、コモン・アンコモン", "Commons & uncommons to target") : worst && sc.weak ? L(`この組み合わせで光る、コモン・アンコモン`, "Commons & uncommons that shine here") : L("この組み合わせで勝っている、コモン・アンコモン", "Commons & uncommons winning in this pair"), { size: 38, fill: MUTED });
        const n = sc.cards.length, CW = 245, CH = 342, g = 28, x0 = 740;
        sc.cards.forEach((c, i) => {
          const x = x0 + i * (CW + g);
          s += cardImg(c, x, 215, CW, CH);
          const lines = wrapName(c.label, 8);
          lines.forEach((l, j) => { s += T(x + CW / 2, 215 + CH + 44 + j * 34, l, { size: 28, weight: 900, anchor: "middle" }); });
          s += T(x + CW / 2, 215 + CH + 44 + (lines.length - 1) * 34 + 46, `${c.side === "2" ? L("この2色で", "This pair") : L("この色で", "This colour")} ${pt(c.pg)}%`, { size: L(30, 25), weight: 700, anchor: "middle", fill: col });
        });
      }
      return frame(s, sc);
    }
    case "dvs": {
      let s = T(80, 175, L("ドラフトとシールドで評価が変わるもの", "What changes between Draft and Sealed"), { size: 40, fill: MUTED });
      s += panel(80, 210, 820, 590) + T(120, 275, L("色の組み合わせ（順位）", "Colour pairs (rank)"), { size: 36, fill: GOLD, weight: 700 });
      if(!sc.up && !sc.down) s += T(130, 400, L("上位の組み合わせの順位は、", "The top pairs' ranking"), { size: 40 }) + T(130, 460, L("ほとんど入れ替わりません", "barely changes"), { size: 40, weight: 700 });
      [sc.up, sc.down].filter(Boolean).forEach((r, i) => {
        const y = 340 + i * 220, up = r.diff > 0;
        s += pairSymbols(r.pair, 130, y + 20, 70) + T(330, y + 60, pairName(r.pair), { size: 64, weight: 900 });
        s += T(130, y + 140, L(`ドラフト ${r.rd}位  →  シールド ${r.rs}位`, `Draft #${r.rd}  →  Sealed #${r.rs}`), { size: 44, weight: 700, fill: up ? GREEN : DOWN });
        s += T(780, y + 60, up ? "▲" : "▼", { size: 60, anchor: "end", fill: up ? GREEN : DOWN });
      });
      s += panel(940, 210, 900, 590) + T(980, 275, L("レア・神話レア（GIH勝率）", "Rares & mythics (GIH win rate)"), { size: 36, fill: GOLD, weight: 700 });
      const list = [...sc.cUp.slice(0, 2).map(c => ({ ...c, up: true })), ...sc.cDown.slice(0, 2).map(c => ({ ...c, up: false }))];
      list.forEach((c, i) => {
        const y = 335 + i * 110;
        s += cardImg(c, 980, y - 6, 74, 103);
        s += T(1080, y + 30, [...c.label].length > L(15, 28) ? [...c.label].slice(0, L(14, 27)).join("") + "…" : c.label, { size: [...c.label].length > L(11, 20) ? 30 : 34, weight: 900 });
        s += T(1080, y + 78, L(`ドラフト ${pt(c.d)}%  →  シールド ${pt(c.s)}%`, `Draft ${pt(c.d)}%  →  Sealed ${pt(c.s)}%`), { size: 30, fill: c.up ? GREEN : DOWN, weight: 700 });
        s += T(1800, y + 54, c.up ? "▲" : "▼", { size: 48, anchor: "end", fill: c.up ? GREEN : DOWN });
      });
      return frame(s, sc);
    }
    case "bombs": {
      let s = T(80, 175, L(`ボム ${sc.part === 1 ? "1〜5位" : "6〜10位"}（神話レア・レア、GIH勝率）`, `Bombs ${sc.part === 1 ? "#1–5" : "#6–10"} (mythic & rare, GIH win rate)`), { size: 38, fill: MUTED });
      s += cardRow(sc.cards, c => [
        { t: `${L("ドラフト", "Draft")} ${pt(c.gih)}%`, size: 40, w: 900, fill: UP },
        { t: c.sGih != null ? `${L("シールド", "Sealed")} ${pt(c.sGih)}%` : `${L("シールド", "Sealed")} —`, size: 32, fill: GOLD },
        { t: L(`引くと ${sgn(c.iwd)}pt`, `${sgn(c.iwd)}pt when drawn`), size: 28, fill: MUTED, w: 400 }
      ], GOLD, 250);
      return frame(s, sc);
    }
    case "traps": {
      let s = T(80, 175, L(`罠なレアカード（レア全体の平均 ${pt(sc.rareAvg)}% より低いレア）`, `Trap rares (below the rare average of ${pt(sc.rareAvg)}%)`), { size: 38, fill: MUTED });
      s += cardRow(sc.cards.map((c, i) => ({ ...c, rank: i + 1 })), c => [
        { t: `${L("ドラフト", "Draft")} ${pt(c.gih)}%`, size: 40, w: 900, fill: DOWN },
        { t: L(`レア平均より ${sgn(c.gih - sc.rareAvg)}pt`, `${sgn(c.gih - sc.rareAvg)}pt vs rare avg`), size: 30, fill: DOWN },
        { t: c.sGih != null ? `${L("シールド", "Sealed")} ${pt(c.sGih)}%` : `${L("シールド", "Sealed")} —`, size: 30, fill: GOLD, w: 400 }
      ], DOWN, 250);
      return frame(s, sc);
    }
    case "pairspeed": {
      const hasSpeed = sc.rows.length >= 3, ci = sc.curve;
      const col = sc.dir === "light" ? UP : sc.dir === "heavy" ? GOLD : sc.dir === "mid" ? GREEN : MUTED;
      const verdict = sc.dir === "light" ? L("速いデッキ", "Fast deck") : sc.dir === "heavy" ? L("遅めのデッキ", "Slower deck") : sc.dir === "mid" ? L("中くらいのデッキ", "Medium deck") : L("どちらでもOK", "Either works");
      const tip = sc.dir === "light" ? L("2マナ以下を多めに、早く攻める", "More cheap cards, attack early") : sc.dir === "heavy" ? L("強い重いカードで、じっくり戦う", "Play powerful heavy cards, go long") : sc.dir === "mid" ? L("3〜4マナを中心に、バランスよく", "Focus on 3–4 mana, stay balanced") : L("配られたカードで、自由に組んでOK", "Build freely with what you're given");
      let s = pairSymbols(sc.pair, 90, 190, 80) + T(90 + 2 * 90 + 20, 218, L(`${pairName(sc.pair)}の、${hasSpeed ? "デッキの速さとマナカーブ" : "マナカーブ"}`, `${pairName(sc.pair)}: ${hasSpeed ? "deck speed & mana curve" : "mana curve"}`), { size: L(56, 52), weight: 900 });
      if(hasSpeed){
        s += T(80, 320, L("デッキの平均マナ総量ごとの勝率（ドラフト）", "Win rate by deck's average mana value (Draft)"), { size: 32, fill: MUTED });
        const x0 = 80, x1 = 1130, lo = Math.floor(Math.min(...sc.rows.map(r => r.wr * 100)) - 1), hi = Math.ceil(Math.max(...sc.rows.map(r => r.wr * 100)) + 1);
        sc.rows.forEach((r, i) => {
          const y = 410 + i * 78, lx = x0 + 200, vx = v => scaleX(v, lo, hi, lx, x1 - 40), isBest = r === sc.best;
          s += T(lx - 24, y + 14, r.label, { size: 34, anchor: "end", weight: isBest ? 900 : 400 });
          s += `<line x1="${lx}" x2="${x1 - 40}" y1="${y}" y2="${y}" stroke="${PAPER}" stroke-opacity="0.14" stroke-width="3"/>`;
          s += `<line x1="${lx}" x2="${vx(r.wr * 100)}" y1="${y}" y2="${y}" stroke="${isBest ? col : MUTED}" stroke-width="${isBest ? 14 : 8}" stroke-linecap="round"/>`;
          s += `<circle cx="${vx(r.wr * 100)}" cy="${y}" r="${isBest ? 21 : 15}" fill="${isBest ? col : MUTED}" stroke="${PAPER}" stroke-width="3"/>`;
          s += T(vx(r.wr * 100), y - 28, pt(r.wr) + "%", { size: isBest ? 38 : 32, weight: 900, anchor: "middle", fill: isBest ? PAPER : MUTED });
        });
      }
      if(ci){
        const yT = hasSpeed ? 735 : 340, bh = hasSpeed ? 112 : 150;
        s += T(80, yT, L("マナ域ごとのカード勝率（コモン・アンコモン）", "Card win rate by mana range (commons & uncommons)"), { size: hasSpeed ? 28 : 32, fill: MUTED });
        ci.zones.forEach((z, i) => {
          const x = 80 + i * 280, isBest = z.wr != null && z === ci.zones[ci.bestZ.i];
          s += `<rect x="${x}" y="${yT + 20}" width="262" height="${bh}" rx="16" fill="${DEEP}" fill-opacity="0.6" stroke="${isBest ? GOLD : MUTED}" stroke-opacity="${isBest ? 1 : 0.5}" stroke-width="${isBest ? 5 : 2}"/>`;
          s += T(x + 131, yT + 20 + bh * 0.36, z.label, { size: hasSpeed ? 28 : 32, anchor: "middle", weight: isBest ? 900 : 400 });
          s += z.wr != null ? T(x + 131, yT + 20 + bh * 0.76, `${pt(z.wr)}%`, { size: hasSpeed ? 40 : 48, weight: 900, anchor: "middle", fill: isBest ? GOLD : PAPER }) : T(x + 131, yT + 20 + bh * 0.76, "—", { size: 40, anchor: "middle", fill: MUTED });
        });
      }
      // 右の枠：デッキの速さのおすすめ ＋ マナ域の目安
      let py = 330;
      s += panel(1220, 250, 620, 560, hasSpeed ? col : GOLD);
      if(hasSpeed){
        s += T(1530, py, L("デッキのおすすめは", "Recommended deck"), { size: 30, anchor: "middle", fill: MUTED }) + T(1530, py + 70, verdict, { size: fitSize(verdict, 500, 56), weight: 900, anchor: "middle", fill: col });
        s += T(1530, py + 125, sc.dir === "even" ? (sc.best.wr - sc.low.wr < 0.005 ? L("差はほとんどなし", "Almost no difference") : L(`差は ${pt(sc.best.wr - sc.low.wr)}pt だけ`, `Only ${pt(sc.best.wr - sc.low.wr)}pt difference`)) : L(`平均マナ総量 ${sc.best.label}（勝率 ${pt(sc.best.wr)}%）`, `Avg mana value ${sc.best.label} (${pt(sc.best.wr)}%)`), { size: L(30, 26), weight: 700, anchor: "middle" });
        s += T(1530, py + 170, tip, { size: L(26, 24), anchor: "middle", fill: PAPER });
        s += `<line x1="1270" x2="1790" y1="${py + 205}" y2="${py + 205}" stroke="${PAPER}" stroke-opacity="0.3" stroke-width="2"/>`;
        py += 250;
      }
      if(ci){
        s += T(1530, py, L("マナ域の目安", "Mana range guide"), { size: 30, anchor: "middle", fill: MUTED });
        if(ci.more){
          s += T(1530, py + 62, L(`${ZONES[ci.more.z]}は ${ci.more.t}枚以上`, `${ci.more.t}+ cards at ${ZONES[ci.more.z]}`), { size: L(42, 34), weight: 900, anchor: "middle", fill: GOLD }) +
               T(1530, py + 106, L(`入れたデッキは 勝率 ${sgn(ci.more.lift)}pt`, `Decks that do: ${sgn(ci.more.lift)}pt win rate`), { size: 28, anchor: "middle" });
        }else{
          s += T(1530, py + 62, L(`${ci.bestZ.label}を 多めに`, `More at ${ci.bestZ.label}`), { size: L(42, 38), weight: 900, anchor: "middle", fill: GOLD }) +
               T(1530, py + 106, L("カード勝率が一番高いマナ域", "Best card win rate range"), { size: 28, anchor: "middle" });
        }
        if(ci.less && (!ci.more || ci.less.z !== ci.more.z)) s += T(1530, py + 160, L(`${ZONES[ci.less.z]}は ${ci.less.t - 1}枚まで`, `Max ${ci.less.t - 1} cards at ${ZONES[ci.less.z]}`), { size: L(34, 28), weight: 900, anchor: "middle", fill: DOWN });
      }
      return frame(s, sc);
    }
    case "colortop": {
      const badge = sc.color === "M" ? { t: L("多", "M"), f: "#C9A227" } : sc.color === "C" ? { t: L("無", "C"), f: "#8D97A3" } : null;
      const kname = sc.color === "M" ? L("マルチカラー", "Multicolour") : sc.color === "C" ? L("無色", "Colourless") : CJ[sc.color];
      let s = (badge ? `<circle cx="120" cy="180" r="40" fill="${badge.f}" stroke="${PAPER}" stroke-width="3"/>` + T(120, 196, badge.t, { size: 44, weight: 900, anchor: "middle", fill: DEEP }) : symbol(sc.color, 120, 180, 80)) +
              T(190, 196, L(`${kname}のおすすめ コモン・アンコモン`, `${kname} commons & uncommons`), { size: 50, weight: 900 }) +
              T(W - 80, 196, L("引いた試合の勝率（GIH）の高い順", "Ranked by win rate when drawn (GIH)"), { size: L(30, 28), fill: MUTED, anchor: "end" });
      const panelFor = (x, title, list, avg, accent) => {
        let t = panel(x, 235, 860, 585, accent) + T(x + 50, 300, title, { size: 46, weight: 900, fill: accent }) + T(x + 810, 300, L(`全体の平均 ${pt(avg)}%`, `Avg ${pt(avg)}%`), { size: 28, fill: MUTED, anchor: "end" });
        if(!list.length) return t + T(x + 430, 560, L("この環境には、ありません", "None in this format"), { size: 38, anchor: "middle", fill: MUTED });
        // 上位3枚はカード画像つき。4位・5位は文字の行
        const top = list.slice(0, 3), CW = 172, CH = 240, gap = 36, x0 = x + (860 - (top.length * CW + (top.length - 1) * gap)) / 2;
        top.forEach((c, i) => {
          const cx = x0 + i * (CW + gap);
          t += cardImg(c, cx, 322, CW, CH) + T(cx + CW / 2, 590, L(`${c.rank}位`, `#${c.rank}`), { size: 28, weight: 900, anchor: "middle", fill: accent });
          wrapName(c.label, 8).slice(0, 2).forEach((l, j) => { t += T(cx + CW / 2, 618 + j * 25, l, { size: 21, weight: 900, anchor: "middle" }); });
          t += T(cx + CW / 2, 690, pt(c.gih) + "%", { size: 36, weight: 900, anchor: "middle", fill: c.gih > avg ? UP : PAPER });
        });
        list.slice(3).forEach((c, i) => {
          const y = 745 + i * 47;
          t += `<circle cx="${x + 70}" cy="${y - 10}" r="20" fill="${DEEP}" stroke="${accent}" stroke-width="3"/>` + T(x + 70, y, String(c.rank), { size: 24, weight: 900, anchor: "middle", fill: accent });
          t += T(x + 112, y, c.label, { size: Math.min(30, Math.floor(520 / (Math.max([...c.label].length, 1) * L(1, 0.58)))), weight: 700 }) + T(x + 810, y + 2, pt(c.gih) + "%", { size: 32, weight: 900, anchor: "end", fill: c.gih > avg ? UP : PAPER });
        });
        return t;
      };
      s += panelFor(60, L("コモン", "Common"), sc.com, sc.comAvg, GOLD) + panelFor(980, L("アンコモン", "Uncommon"), sc.unc, sc.uncAvg, GREEN);
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
      if(sc.pace) s += box(0, L("環境の速さ", "Format speed"), cx => T(cx, PY + 140, EN ? sc.pace.word.charAt(0).toUpperCase() + sc.pace.word.slice(1) : sc.pace.word, { size: fitSize(sc.pace.word, 400, 84), weight: 900, anchor: "middle", fill: GOLD }) + T(cx, PY + 198, sc.pace.sub || "", { size: L(28, 22), anchor: "middle", fill: PAPER }));
      if(sc.mono) s += box(1, L("一番強い色", "Strongest colour"), cx => symbol(sc.mono.color, cx - 70, PY + 125, 84) + T(cx - 10, PY + 150, pairName(sc.mono.color), { size: L(76, 64), weight: 900, fill: GOLD }) + T(cx, PY + 205, L(`勝率 ${pt(sc.mono.wr)}%`, `${pt(sc.mono.wr)}% win rate`), { size: 32, anchor: "middle", fill: UP, weight: 700 }));
      if(sc.best) s += box(2, L("組むなら", "Best pair"), cx => pairSymbols(sc.best.pair, cx - 175, PY + 108, 70) + T(cx - 20 + L(0, 30), PY + 130, pairShort(sc.best.pair), { size: 64, weight: 900, fill: GOLD }) +
        T(cx, PY + 182, `${L("ドラフト", "Draft")} ${pt(sc.best.wr)}%`, { size: 28, anchor: "middle", fill: UP, weight: 700 }) +
        (sc.best.sWr != null ? T(cx, PY + 218, `${L("シールド", "Sealed")} ${pt(sc.best.sWr)}%`, { size: 28, anchor: "middle", fill: GOLD, weight: 700 }) : ""));
      if(sc.worst) s += box(3, L("無理に目指さない", "Don't force it"), cx => pairSymbols(sc.worst.pair, cx - 175, PY + 120, 70) + T(cx - 20 + L(0, 30), PY + 142, pairShort(sc.worst.pair), { size: 64, weight: 900, fill: PAPER }) +
        T(cx, PY + 205, `${L("ドラフト", "Draft")} ${pt(sc.worst.wr)}%`, { size: 30, anchor: "middle", fill: DOWN, weight: 700 }));
      const colsDef = [[L("迷わず取るボム", "Bombs to take"), sc.b3, UP, GOLD], [L("罠になりやすいレア", "Trap rares"), sc.t3, DOWN, DOWN], [L("強いコモン除去", "Strong common removal"), sc.r3, GREEN, GREEN]].filter(d => d[1] && d[1].length);
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
      colsDef.forEach((d, i) => { s += col(i, d[0], d[1], d[2], d[3], c => L(`GIH勝率 ${pt(c.gih)}%`, `GIH win rate ${pt(c.gih)}%`)); });
      return frame(s, sc);
    }
    case "outro": {
      // 締めは「チャンネル登録をお願いします」だけ。画面の下半分は、YouTube Studio の「終了画面」で
      // 登録ボタンと次の動画を重ねるために、あえて空けてある（動画の絵としての登録ボタンは描かない）
      return frame(TS(W / 2, 230, L("MTGのリミテッドプレイヤーは", "MTG Limited players,"), { size: 84, anchor: "middle" }) + TS(W / 2, 370, L("チャンネル登録をお願いします", "please subscribe!"), { size: 100, anchor: "middle" }), sc, { header: false });
    }
  }
  return frame("", sc);
}

/* 字幕：読み上げの文を、2行に収まるページに分ける。ページごとに読み上げの長さ（文字数）の割合で出す時間を決める */
function capPages(text){
  if(EN){      // 英語：文ごとに区切り、長いものはカンマで割る。1ページは2行（約120字）まで
    const maxE = 120, sentsE = text.replace(/ percent/g, "%").split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean), piecesE = [];
    for(const x of sentsE){
      if(x.length <= maxE){ piecesE.push(x); continue; }
      let cur = "";
      for(const part of x.split(/(?<=,)\s+/)){ if(cur && cur.length + part.length + 1 > maxE){ piecesE.push(cur); cur = part; } else cur += (cur ? " " : "") + part; }
      if(cur) piecesE.push(cur);
    }
    const pagesE = []; let curE = "";
    for(const x of piecesE){ if(curE && curE.length + x.length + 1 > maxE){ pagesE.push(curE); curE = x; } else curE += (curE ? " " : "") + x; }
    if(curE) pagesE.push(curE);
    return pagesE;
  }
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
  if(EN){
    if(chars.length > 62){      // 2行に割る。真ん中に近い空白で
      const sp = chars.map((c, i) => c === " " ? i : -1).filter(i => i > 0).sort((a, b) => Math.abs(a - half) - Math.abs(b - half))[0] || half;
      lines = [chars.slice(0, sp).join("").trim(), chars.slice(sp).join("").trim()];
    }
  }else if(chars.length > 36){
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
/* 英語の読み上げ（Kokoro）。ショートと同じ。モデルは KOKORO_DIR（kokoro-v1.0.onnx と voices-v1.0.bin） */
async function speakEn(text, wavPath){
  const py = `
import sys, json, os, soundfile as sf
from kokoro_onnx import Kokoro
D = os.environ["KOKORO_DIR"]
k = Kokoro(os.path.join(D, "kokoro-v1.0.onnx"), os.path.join(D, "voices-v1.0.bin"))
job = json.load(sys.stdin)
samples, sr = k.create(job["text"], voice=os.environ.get("KOKORO_VOICE", "af_heart"), speed=float(os.environ.get("KOKORO_SPEED", "1.05")), lang="en-us")
sf.write(job["out"], samples, sr)
`;
  execFileSync(KOKORO_PY, ["-c", py], { input: JSON.stringify({ text, out: wavPath }), env: { ...process.env, KOKORO_DIR }, stdio: ["pipe", "inherit", "inherit"] });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-af", "apad=pad_dur=0.25", wavPath + ".tmp.wav"]);
  execFileSync("mv", [wavPath + ".tmp.wav", wavPath]);
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]).toString().trim();
  return { kana: text, dur };
}
async function speak(text, wavPath){
  // 動作確認用（LONG_FAKE_AUDIO=1）：無音の音声を、文字数に応じた長さで作る。VOICEVOX が無い環境で、動画の組み立てだけ試すときに使う
  if(process.env.LONG_FAKE_AUDIO){
    const dur = Math.max(2, [...text].length / L(7.5, 14));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=0.3*sin(2*PI*220*t)*gt(sin(2*PI*2.7*t)\\,-0.2):s=24000`, "-t", dur.toFixed(2), wavPath]);
    return { kana: text, dur };
  }
  if(EN) return speakEn(text, wavPath);
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
  const nameJa = EN ? shortName(nm.set || SET) : shortName((await setNameJa(SET)) || nm.set || SET);      // 英語版は、英語のセット名（ここでは変数名はそのまま）
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
  const ctx = { dd, ds, rd, rs, nm, nameJa, removal, topRemoval: commonRem ? { ...commonRem, label: EN ? String(commonRem.name).split(" // ")[0] : ((nm.names || {})[commonRem.name] || commonRem.name) } : null };
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
    if(STILLS){ sc.kana = sc.say; sc.dur = Math.max(4, [...sc.say].length / L(7, 14)); continue; }
    if(!EN && !yomiLoaded && !process.env.LONG_FAKE_AUDIO){ await loadYomi(); yomiLoaded = true; }
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
  await writeFile(`${OUT}/title.txt`, EN ? `[MTG Arena] ${nameJa} Limited Review | Best Colours, Sleeper Pairs, Top 10 Bombs & Trap Rares` : `【${nameJa}】リミテッド環境まとめ｜強い色・狙い目の色・ボム10枚・罠なレアカード・色別おすすめ【MTGアリーナ】`, "utf8");   // YouTube に上げるときの題
  const credit = EN ? `Data: 17Lands Public Data (CC BY 4.0)
Voice: Kokoro TTS
${ZUNDA ? "Character art: Sakamoto Ahiru (https://twitter.com/sakamoto_ahr)\n" : ""}${bgmCredit ? `BGM: ${bgmCredit}\n` : ""}Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.` : "";
  if(EN) await writeFile(`${OUT}/description.txt`,
`A complete MTG Arena Limited review of ${nameJa}, based on 17Lands data (${gD} Draft games and ${gS} Sealed games).
The strongest colour pairs and deck speed, sleeper pairs, the top 10 bomb rares, trap rares, and the best commons and uncommons for every colour.

▼ Chapters
${chapters.map(c => `${ts(c.at)} ${c.title}`).join("\n")}

▼ Win rates for every card, format reports, and free Sealed / Draft practice
https://${SITE}/sets/${SET}.en

${credit}

#MTGArena #MTGA #MTGLimited #${String(nameJa).replace(/[^A-Za-z0-9]/g, "")}
`, "utf8");
  else await writeFile(`${OUT}/description.txt`,
`MTGアリーナ、リミテッドの${nameJa}環境を、17Landsの実戦データ（ドラフト${gD}試合・シールド${gS}試合）でまるごと解説します。
最強の色の組み合わせとデッキの速さ、狙い目の色、ボムのレア10枚、罠なレアカード、色別のおすすめコモン・アンコモンまで。

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
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${OUT}/list.txt`, "-c", "copy", "-movflags", "+faststart", bgm ? `${OUT}/nobgm.mp4` : `${OUT}/${LANG}.mp4`]);
  if(bgm){
    const vol = process.env.BGM_VOLUME || "0.08";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/nobgm.mp4`, "-stream_loop", "-1", "-i", bgm, "-filter_complex",
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 2).toFixed(2)}:d=2[bg];` +
      `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(total), "-movflags", "+faststart", `${OUT}/${LANG}.mp4`]);
  }
  // サムネイル（冒頭の場面。字幕の入る前の画面を、カードの絵に重ねる）。右下に、フード付きのずんだもん（口を開けた笑顔）を載せる
  //   出さないとき：LONG_THUMB_ZUNDA=0 ／ 素材は short/zunda-hoodie/open_open.png（無ければ short/zunda/open_open.png）
  try{
    const zt = process.env.LONG_THUMB_ZUNDA === "0" ? null : ["short/zunda-hoodie/open_open.png", "short/zunda/open_open.png"].find(f => existsSync(f));
    const TZW = 400, TZH = Math.round(400 * 380 / 372);      // 素材は 372×380
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...(artPath ? ["-loop", "1", "-i", artPath] : ["-f", "lavfi", "-i", `color=c=0x0A2038:s=${W}x${H}:r=30`]), "-loop", "1", "-i", `${OUT}/scene-0.png`, ...(zt ? ["-loop", "1", "-i", zt] : []), "-filter_complex",
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,gblur=sigma=${artMode === "key" ? 0.6 : 1.5},eq=brightness=0[b];[1:v]scale=${W}:${H},format=rgba[f];[b][f]overlay=shortest=1` +
      (zt ? `[t];[2:v]scale=${TZW}:${TZH},format=rgba[z];[t][z]overlay=x=${W - TZW - 16}:y=${H - TZH + 6}:shortest=1` : ""), "-frames:v", "1", "-q:v", "2", `${OUT}/thumbnail.jpg`]);
  }catch(e){ console.error("サムネイルが作れませんでした:", String(e.message).slice(0, 300)); }
  console.error(`\n${OUT}/${LANG}.mp4  合計 ${ts(total)}（${total.toFixed(0)} 秒）`);
}

main().catch(e => { console.error("動画の作成に失敗しました:", e.message); process.exit(1); });
