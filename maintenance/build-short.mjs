#!/usr/bin/env node
/*
 * 「1分でわかる〇〇環境」の縦動画（1080×1920）を、記事データから作る。
 *
 *   node maintenance/build-short.mjs HOB
 *
 * 出力: short/<SET>/ja.mp4 と、途中生成物（台本 script.json・場面ごとの png/wav）
 *
 * 流れ: 記事データ → 台本 → 場面の画像（SVG→PNG, sharp）→ 音声（VOICEVOX）→ ffmpeg で結合
 *
 * 必要なもの
 *   ・sharp（npm install --no-save sharp）
 *   ・ffmpeg
 *   ・VOICEVOX ENGINE が http://127.0.0.1:50021 で動いていること（VOICEVOX_URL で変更可）
 *     クレジット表記「VOICEVOX:ずんだもん」は動画の最後の場面に入れてある。外さないこと。
 *   ・カード画像は data/names/<SET>.json の URL から取る。取れなければ名前だけの札にする
 *   ・冒頭と締めの背景には、そのセットで一番強い神話レア／レアのカードアート（Scryfall の art_crop）を敷く。
 *     セットのロゴは Fan Content Policy で使えないので入れない（セット名は文字で出す）
 *   ・セット名のロゴ画像を使いたいときは short/logo/<SET>.png（背景透過）を置く。あれば冒頭でセット名の
 *     文字の代わりに載せる。無ければ文字。ロゴはこちらでは取得も生成もしない（置くかどうかは運用側の判断）
 *   ・背景に使うプレイ映像は short/bg.mp4 に置く（無ければ紺色の背景）。GitHub Actions では Releases の
 *     タグ assets にある bg.mp4 を落として使う（.github/workflows/build-short.yml）。横長のままでよく、
 *     縦に切り出して暗くぼかし、その上に文字や図を重ねる。音は使わない
 *
 * 投稿は手動。音声の読みは script.json の "kana" で確認できる。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const SET = process.argv[2];
if(!SET){ console.error("使い方: node maintenance/build-short.mjs <SET>"); process.exit(1); }
const LANG = "ja";
const VV = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
const SPEAKER = +(process.env.VOICEVOX_SPEAKER || 3);          // 3 = ずんだもん ノーマル
const SPEED = +(process.env.VOICEVOX_SPEED || 1.2);            // 1分に収めるため少し速め
const OUT = `short/${SET}`;
const SITE = "sealed-workbench.com";
const BG = process.env.SHORT_BG || "short/bg.mp4";        // 背景のプレイ映像

/* 画面 */
const W = 1080, H = 1920, SCALE = 2;                            // 2倍で描いて縮小すると字がきれい
const PINE = "#10304F", DEEP = "#0A2038", BLUE = "#2F7DF6", PAPER = "#F5F8FC", MUTED = "#A9C2DE";
const UP = "#5B9BFF", DOWN = "#F08A3E";
const COLOR = { W: "#F3EAC6", U: "#4A90E2", B: "#6B5E7A", R: "#E1553E", G: "#3E9B5B" };
const COLOR_JA = { W: "白", U: "青", B: "黒", R: "赤", G: "緑" };
const FONT = "'Noto Sans CJK JP','Noto Sans JP',sans-serif";

const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const pt = v => (v * 100).toFixed(1);
const man = n => n >= 10000 ? `${Math.round(n / 10000)}万` : n.toLocaleString("ja-JP");

/* ------------------------------------------------------------ 材料 */

async function setNameJa(code){
  try{
    const src = await readFile("i18n.js", "utf8");
    const m = src.match(/const SET_JA = (\{[\s\S]*?\});/);
    if(m) return new Function("return " + m[1])()[code.toLowerCase()];
  }catch(e){}
  return null;
}

function pairRows(d){
  const mono = Object.fromEntries((d.colors || []).map(c => [c.color, c.wr]));
  return (d.archetypes || [])
    .filter(a => a.colors && a.colors.length === 2 && a.wr != null)
    .map(a => { const [x, y] = a.colors; const exp = (mono[x] + mono[y]) / 2;
                return { pair: a.colors, wr: a.wr, exp, gap: a.wr - exp, games: a.games || 0 }; })
    .sort((a, b) => b.wr - a.wr);
}

/* 「意外な事実」をデータから1つ選ぶ */
function surprise(d, pairs){
  const totalPair = pairs.reduce((n, p) => n + p.games, 0) || 1;
  // 上位3位以内なのに、ほとんど使われていない組み合わせ
  const sleeper = pairs.slice(0, 3).find(p => p.games / totalPair < 0.05 && p.games >= 2000);
  if(sleeper){
    const rank = pairs.indexOf(sleeper) + 1;
    return {
      title: "誰も組んでいない",
      big: pairName(sleeper.pair), pair: sleeper.pair, sub: `勝率 ${pt(sleeper.wr)}%（${rank}位）`,
      note: `使われた試合は ${man(sleeper.games)}。全体の${(sleeper.games / totalPair * 100).toFixed(1)}%だけ`,
      say: `意外なのは、${pairName(sleeper.pair)}が勝率${pt(sleeper.wr)}パーセントで${rank}位なのに、使われた試合が${man(sleeper.games)}しかないこと。誰も組んでいません。`
    };
  }
  // 2色それぞれの平均から一番外れた組み合わせ
  const solid = pairs.filter(p => p.games >= 10000);
  const odd = solid.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if(odd){
    const up = odd.gap > 0;
    return {
      title: up ? "組むと強くなる" : "組むと弱くなる",
      big: pairName(odd.pair), pair: odd.pair, sub: `勝率 ${pt(odd.wr)}%`,
      note: `2色それぞれの平均より ${up ? "+" : "−"}${Math.abs(odd.gap * 100).toFixed(1)}pt`,
      say: `意外なのは${pairName(odd.pair)}。2色それぞれの平均より${Math.abs(odd.gap * 100).toFixed(1)}ポイント${up ? "高い" : "低い"}。組むと${up ? "強く" : "弱く"}なる色です。`
    };
  }
  return null;
}
const pairName = p => [...p].map(c => COLOR_JA[c] || c).join("");

/* ------------------------------------------------------------ 台本 */

function buildScript(d, nameJa, names){
  const pace = (d.speed || []).filter(s => s.wr != null && s.games);
  const fast = pace[0], slow = pace[pace.length - 1];
  const faster = fast && slow && fast.wr > slow.wr;
  const spread = fast && slow ? Math.abs(fast.wr - slow.wr) * 100 : 0;
  const colors = (d.colors || []).slice().sort((a, b) => b.wr - a.wr);
  const pairs = pairRows(d);
  const best = pairs[0];
  const worst = pairs.filter(p => p.games >= 10000).slice().sort((a, b) => a.gap - b.gap)[0];
  const top3 = list => (list || []).slice(0, 3)
    .map(c => ({ ...c, ja: (names.names || {})[c.name] || c.name, img: (names.images || {})[c.name] }));
  const commons = top3(d.top && d.top.common), uncommons = top3(d.top && d.top.uncommon);
  const sur = surprise(d, pairs);
  const games = man(d.total_games);

  const scenes = [];
  scenes.push({ kind: "hook", art: true,
    say: `MTGアリーナ、リミテッドの${nameJa}環境を、${games}試合のデータで1分で。`,
    title: nameJa, games });

  // お決まりの前置き：リミテッドとは何か、シールドとドラフトのどちらのデータか
  const isSealed = d.mode === "sealed";
  scenes.push({ kind: "intro", isSealed,
    say: `リミテッドは、その場で開けたパックだけでデッキを組む遊び方。シールドとドラフトがあります。`
       + `この動画は、${isSealed ? "シールド" : "ドラフト"}のデータです。`,
    tail: 0.8 });

  if(fast && slow){
    // 速さは一言だけ。数字は画面に任せる（読み上げるとくどい）
    const PACE_JA = { fast: "速い", mid: "普通", slow: "遅い", slower: "かなり遅い" };
    const paceWord = PACE_JA[(d.verdict || {}).key] || (spread < 2 ? "普通" : faster ? "速い" : "遅い");
    scenes.push({ kind: "pace",
      say: `環境の速さは、${paceWord}です。平均マナ総量${fast.wr >= slow.wr ? fast.max + "未満" : (slow.max ? slow.max + "未満" : pace[pace.length - 2].max + "以上")}のデッキが、`
         + `勝率${pt(Math.max(fast.wr, slow.wr))}パーセントで一番勝っています。`, paceWord, tail: 0.8,
      rows: pace.map((s, i) => ({ label: i === 0 ? `${s.max}未満` : s.max ? `${pace[i - 1].max}〜${s.max}` : `${pace[i - 1].max}以上`, wr: s.wr })),
      headline: spread < 2 ? "カーブで差がつかない" : faster ? `軽いデッキが${Math.round(spread)}pt有利` : `重いデッキが${Math.round(spread)}pt有利` });
  }

  if(colors.length && best){
    const top2 = colors.slice(0, 2).map(c => COLOR_JA[c.color]).join("と");
    let say = `強い色は${top2}。組み合わせなら${pairName(best.pair)}が${pt(best.wr)}パーセントで最強。`;
    if(worst && worst.gap < -0.005) say += `逆に${pairName(worst.pair)}は、色ごとの平均より${Math.abs(worst.gap * 100).toFixed(1)}ポイント低い。組むと弱くなる色です。`;
    scenes.push({ kind: "colors", say, colors, best, worst: worst && worst.gap < -0.005 ? worst : null });
  }

  // カード名は読まず画面に任せる。読むと忙しいので、どの色が強いかだけ言う
  const topScene = (cards, label) => {
    if(!cards.length) return;
    const lead = cards[0].color && cards.filter(c => c.color === cards[0].color).length >= 2
      ? `${COLOR_JA[cards[0].color]}が強いです。` : "色はばらけています。";
    scenes.push({ kind: "top", label, say: `${label}のトップ3はこちら。${lead}`, cards, tail: 1.0 });
  };
  topScene(commons, "コモン");
  topScene(uncommons, "アンコモン");

  if(sur) scenes.push({ kind: "surprise", say: sur.say, ...sur });

  scenes.push({ kind: "outro", art: true, say: `全カードの勝率は、${SITE.replace(/\./g, " ドット ")} で。データは17Landsです。`,
    site: SITE });
  return scenes;
}

/* ------------------------------------------------------------ 画面 */

const T = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 44}" fill="${o.fill || PAPER}" font-weight="${o.weight || 400}"` +
  `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.op != null ? ` opacity="${o.op}"` : ""}>${esc(s)}</text>`;

/* 字幕。句読点で折り返し、数字・英字のかたまりは途中で切らない */
function wrap(s, n = 22){
  // 「61.4%」「sealed-workbench.com」のような並びは1つの塊として扱う
  const toks = s.match(/[0-9０-９][0-9０-９.,%]*|[A-Za-z][A-Za-z0-9.\-]*|[^0-9０-９A-Za-z]/g) || [];
  const out = []; let cur = "";
  for(const t of toks){
    const punct = /^[、。]$/.test(t);
    if(!punct && cur.length + t.length > n && cur){ out.push(cur); cur = ""; }
    cur += t;
    if(punct && cur.length >= n * 0.45){ out.push(cur); cur = ""; }   // 句読点があれば早めに折る
  }
  if(cur) out.push(cur);
  return out.slice(0, 5);
}
/* YouTube Shorts は下 20% 弱にタイトルやボタンが重なるので、字幕はその上に置く */
const SAFE_BOTTOM = 300;
function caption(say){
  const lines = wrap(say.replace(/パーセント/g, "%"));
  const lh = 62, boxH = lines.length * lh + 56, y0 = H - SAFE_BOTTOM - 40 - boxH;
  return `<rect x="60" y="${y0}" width="${W - 120}" height="${boxH}" rx="22" fill="${DEEP}" opacity="0.92"/>` +
    lines.map((l, i) => T(W / 2, y0 + 62 + i * lh, l, { size: 42, anchor: "middle", weight: 700 })).join("");
}
let HAS_BG = false;
/* マナ・シンボル（Scryfall の SVG）。取れたものは SYM に入る。無い色は丸に文字で代用 */
const SYM = {};
function symbol(c, x, y, size){
  if(SYM[c]) return `<svg x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" viewBox="${SYM[c].viewBox}">${SYM[c].inner}</svg>`;
  return `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${COLOR[c] || MUTED}"/>` +
         T(x, y + size * 0.17, COLOR_JA[c] || c, { size: size * 0.42, weight: 900, anchor: "middle", fill: c === "W" ? DEEP : PAPER });
}
/* 2色の組み合わせをシンボル2つで */
function pairSymbols(pair, x, y, size){
  return [...pair].map((c, i) => symbol(c, x + i * (size + 12) + size / 2, y, size)).join("");
}
function frame(inner, say, opts = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PINE}"/><stop offset="1" stop-color="${DEEP}"/></linearGradient></defs>
  ${HAS_BG ? "" : `<rect width="${W}" height="${H}" fill="url(#bg)"/>`}
  ${HAS_BG ? `<rect x="${W / 2 - 330}" y="86" width="660" height="52" rx="26" fill="${DEEP}" opacity="0.8"/>` : ""}
  ${opts.brand === false ? "" : T(W / 2, 122, "MTGアリーナ リミテッド・ワークベンチ", { size: 30, fill: BLUE, weight: 700, anchor: "middle" })}
  ${inner}
  ${say ? caption(say) : ""}
  ${HAS_BG ? `<rect x="${W / 2 - 220}" y="${H - SAFE_BOTTOM - 18}" width="440" height="56" rx="28" fill="${DEEP}" opacity="0.8"/>` : ""}
  ${T(W / 2, H - SAFE_BOTTOM + 22, SITE, { size: 34, fill: BLUE, weight: 700, anchor: "middle" })}
</svg>`;
}

function sceneSvg(sc){
  switch(sc.kind){
    case "hook": {
      // 公式ロゴは Fan Content Policy で使えないので、文字で「MTGアリーナ リミテッド」と大きく出す
      const n = [...sc.title].length, size = n <= 5 ? 140 : n <= 8 ? 104 : 80;
      // ロゴ画像があれば、幅 900・高さ 300 の枠に収めて中央に。無ければセット名を文字で
      const title = sc.logo
        ? `<image href="${sc.logo}" x="${W / 2 - 450}" y="600" width="900" height="300" preserveAspectRatio="xMidYMid meet"/>`
        : T(W / 2, 730, sc.title, { size, weight: 900, anchor: "middle", fill: BLUE });
      return frame(
        T(W / 2, 430, "MTGアリーナ", { size: 84, weight: 900, anchor: "middle" }) +
        T(W / 2, 520, "リミテッド環境レポート", { size: 48, fill: MUTED, anchor: "middle" }) +
        `<rect x="${W / 2 - 200}" y="570" width="400" height="6" fill="${BLUE}"/>` +
        title +
        T(W / 2, sc.logo ? 1020 : 900, sc.games + "試合", { size: 92, weight: 900, anchor: "middle" }) +
        T(W / 2, sc.logo ? 1100 : 980, "のデータで、1分でわかる", { size: 44, fill: MUTED, anchor: "middle" }), sc.say);
    }
    case "intro": {
      const box = (x, label, on) =>
        `<rect x="${x}" y="640" width="440" height="300" rx="28" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${on ? BLUE : MUTED}" stroke-width="${on ? 6 : 3}"/>` +
        T(x + 220, 790, label, { size: 68, weight: 900, anchor: "middle", fill: on ? PAPER : MUTED }) +
        (on ? T(x + 220, 870, "この動画はこちら", { size: 32, anchor: "middle", fill: BLUE, weight: 700 }) : "");
      return frame(
        T(W / 2, 330, "リミテッドとは", { size: 44, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 430, "その場で開けたパックだけで", { size: 50, weight: 700, anchor: "middle" }) +
        T(W / 2, 500, "デッキを組む遊び方", { size: 50, weight: 700, anchor: "middle" }) +
        box(80, "シールド", sc.isSealed) + box(560, "ドラフト", !sc.isSealed), sc.say);
    }
    case "pace": {
      const wrs = sc.rows.map(r => r.wr * 100), lo = Math.floor(Math.min(...wrs) - 1), hi = Math.ceil(Math.max(...wrs) + 1);
      const X0 = 330, X1 = W - 120, sx = v => X0 + (v - lo) / (hi - lo) * (X1 - X0);
      let s = T(80, 300, "環境の速さ", { size: 40, fill: MUTED }) +
              T(80, 390, sc.paceWord, { size: 96, weight: 900, fill: BLUE }) +
              T(80 + [...sc.paceWord].length * 100 + 24, 388, sc.headline, { size: 40, fill: PAPER });
      s += T(80, 470, "平均マナ総量ごとの勝率", { size: 34, fill: MUTED });
      sc.rows.forEach((r, i) => {
        const y = 580 + i * 130;
        s += T(X0 - 30, y + 16, r.label, { size: 40, anchor: "end" });
        s += `<line x1="${X0}" x2="${X1}" y1="${y}" y2="${y}" stroke="${PAPER}" stroke-opacity="0.12" stroke-width="3"/>`;
        s += `<line x1="${X0}" x2="${sx(r.wr * 100)}" y1="${y}" y2="${y}" stroke="${BLUE}" stroke-width="10" stroke-linecap="round"/>`;
        s += `<circle cx="${sx(r.wr * 100)}" cy="${y}" r="22" fill="${BLUE}" stroke="${PAPER}" stroke-width="4"/>`;
        s += T(sx(r.wr * 100), y - 40, pt(r.wr) + "%", { size: 44, weight: 900, anchor: "middle" });
      });
      return frame(s, sc.say);
    }
    case "colors": {
      let s = T(80, 230, "色の強さ", { size: 40, fill: MUTED });
      sc.colors.forEach((c, i) => {
        const x = 130 + i * 205;
        s += symbol(c.color, x, 350, 132);
        s += T(x, 480, pt(c.wr) + "%", { size: 40, anchor: "middle", weight: i < 2 ? 900 : 400, fill: i < 2 ? PAPER : MUTED });
      });
      const card = (y, title, p, col) =>
        `<rect x="80" y="${y}" width="${W - 160}" height="210" rx="28" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${col}" stroke-width="4"/>` +
        T(120, y + 62, title, { size: 34, fill: col, weight: 700 }) +
        pairSymbols(p.pair, 120, y + 128, 96) +
        T(350, y + 160, pairName(p.pair), { size: 60, weight: 900 }) +
        T(W - 120, y + 148, pt(p.wr) + "%", { size: 80, weight: 900, anchor: "end", fill: col }) +
        T(W - 120, y + 190, `2色の平均より ${p.gap > 0 ? "+" : "−"}${Math.abs(p.gap * 100).toFixed(1)}pt`, { size: 30, anchor: "end", fill: MUTED });
      s += card(560, "一番強い組み合わせ", sc.best, UP);
      if(sc.worst) s += card(810, "組むと弱くなる", sc.worst, DOWN);
      return frame(s, sc.say);
    }
    case "top": {
      let s = T(80, 230, `${sc.label} 勝率トップ3`, { size: 40, fill: MUTED });
      sc.cards.forEach((c, i) => {
        const y = 280 + i * 280, col = COLOR[c.color] || MUTED;
        // カード画像が入る枠。取れたときは実画像、取れなければ色付きの札に名前
        if(c.imgPath){
          s += `<image href="${c.imgPath}" x="90" y="${y}" width="180" height="250" preserveAspectRatio="xMidYMid slice"/>`;
        }else{
          s += `<rect x="90" y="${y}" width="180" height="250" rx="14" fill="${col}" opacity="0.85"/>`;
          s += `<rect x="104" y="${y + 14}" width="162" height="120" rx="8" fill="${DEEP}" opacity="0.5"/>`;
        }
        s += T(310, y + 62, `${i + 1}位`, { size: 34, fill: MUTED });
        const n = [...c.ja].length;
        s += T(310, y + 140, c.ja, { size: n <= 8 ? 56 : n <= 12 ? 44 : 36, weight: 900 });
        s += T(310, y + 220, `GIH勝率 ${pt(c.gih)}%`, { size: 44, fill: BLUE, weight: 700 });
      });
      return frame(s, sc.say);
    }
    case "surprise": {
      return frame(
        T(W / 2, 420, "意外な事実", { size: 44, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 560, sc.title, { size: 72, weight: 900, anchor: "middle", fill: DOWN }) +
        `<rect x="120" y="640" width="${W - 240}" height="420" rx="32" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${BLUE}" stroke-width="4"/>` +
        (sc.pair ? pairSymbols(sc.pair, W / 2 - 132 - 6, 740, 132) + T(W / 2, 866, sc.big, { size: 60, weight: 900, anchor: "middle" })
                 : T(W / 2, 810, sc.big, { size: 140, weight: 900, anchor: "middle" })) +
        T(W / 2, 940, sc.sub, { size: 50, anchor: "middle", fill: BLUE, weight: 700 }) +
        T(W / 2, 1010, sc.note, { size: 34, anchor: "middle", fill: MUTED }), sc.say);
    }
    case "outro": {
      return frame(
        T(W / 2, 560, "全カードの勝率は", { size: 52, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 700, sc.site, { size: 78, weight: 900, anchor: "middle", fill: BLUE }) +
        T(W / 2, 800, "シールド／ドラフトの構築練習も無料", { size: 40, anchor: "middle" }) +
        T(W / 2, 930, "データ: 17Lands 公開データ（CC BY 4.0）", { size: 30, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 975, "音声: VOICEVOX:ずんだもん", { size: 30, fill: MUTED, anchor: "middle" }) +
        // Wizards の Fan Content Policy が求める表記。外さないこと
        T(W / 2, 1050, "Unofficial Fan Content permitted under the Fan Content Policy.", { size: 22, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 1082, "Not approved/endorsed by Wizards. Portions of the materials used", { size: 22, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 1114, "are property of Wizards of the Coast. ©Wizards of the Coast LLC.", { size: 22, fill: MUTED, anchor: "middle" }), sc.say);
    }
  }
  return frame("", sc.say);
}

/* ------------------------------------------------------------ 音声 */

/* カード名の読み違いを直す辞書。short/yomi.json に { "蛮刀": "バントウ" } の形で足していく */
async function loadYomi(){
  try{ await fetch(`${VV}/version`); }
  catch(e){ throw new Error(`VOICEVOX ENGINE に接続できません（${VV}）。起動してから実行してください`); }
  const dict = await readJson("short/yomi.json", {});
  let n = 0;
  for(const [surface, yomi] of Object.entries(dict)){
    const r = await fetch(`${VV}/user_dict_word?surface=${encodeURIComponent(surface)}&pronunciation=${encodeURIComponent(yomi)}&accent_type=0&priority=8`, { method: "POST" });
    if(r.ok) n++; else console.error(`読み辞書の登録に失敗: ${surface} (${r.status})`);
  }
  if(n) console.error(`読み辞書: ${n} 語`);
}

async function speak(text, wavPath){
  const q = await fetch(`${VV}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(text)}`, { method: "POST" });
  if(!q.ok) throw new Error(`audio_query ${q.status}`);
  const query = await q.json();
  query.speedScale = SPEED;
  query.postPhonemeLength = 0.25;                     // 文末に少し間を置く
  const r = await fetch(`${VV}/synthesis?speaker=${SPEAKER}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query)
  });
  if(!r.ok) throw new Error(`synthesis ${r.status}`);
  await writeFile(wavPath, Buffer.from(await r.arrayBuffer()));
  const kana = query.accent_phrases.map(p => p.moras.map(m => m.text).join("") + (p.pause_mora ? "、" : "")).join("");
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]).toString().trim();
  return { kana, dur };
}

/* ------------------------------------------------------------ 実行 */

async function main(){
  const d = await readJson(`data/articles/${SET}_draft.json`, null) || await readJson(`data/articles/${SET}_sealed.json`, null);
  if(!d){ console.error(`${SET}: 記事データがありません`); process.exit(1); }
  const names = await readJson(`data/names/${SET}.json`, { names: {}, images: {} });
  const nameJa = (await setNameJa(SET)) || names.set || SET;
  const sharp = (await import("sharp")).default;
  await mkdir(`${OUT}/${LANG}`, { recursive: true });

  for(const c of ["W", "U", "B", "R", "G"]){
    const p = `short/symbols/${c}.svg`;
    let svg = await readFile(p, "utf8").catch(() => null);
    if(!svg){
      try{
        const r = await fetch(`https://svgs.scryfall.io/card-symbols/${c}.svg`, { headers: { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" } });
        if(r.ok){ svg = await r.text(); await mkdir("short/symbols", { recursive: true }); await writeFile(p, svg, "utf8"); }
      }catch(e){}
    }
    // 外側の <svg> を外して中身だけ持つ（描画時に自前の <svg> で包む）
    if(svg){
      const m = svg.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
      const vb = m && m[1].match(/viewBox="([^"]+)"/);
      if(m) SYM[c] = { inner: m[2], viewBox: vb ? vb[1] : "0 0 100 100" };
    }
  }
  console.error(Object.keys(SYM).length ? `マナ・シンボル: ${Object.keys(SYM).join(" ")}` : "マナ・シンボル: 取得できず、丸に文字で代用");
  const scenes = buildScript(d, nameJa, names);

  // セット名のロゴ画像（置いてあれば使う）
  {
    const buf = await readFile(`short/logo/${SET}.png`).catch(() => null);
    const hook = scenes.find(sc => sc.kind === "hook");
    if(buf && hook){ hook.logo = "data:image/png;base64," + buf.toString("base64"); console.error(`ロゴ: short/logo/${SET}.png`); }
    else console.error("ロゴ: 無し（セット名を文字で出す）");
  }

  // セットの顔になるカードのアート（冒頭・締めの背景）。神話レア→レアの順に勝率上位から探す
  let artPath = null;
  {
    const cands = [...((d.top && d.top.mythic) || []), ...((d.top && d.top.rare) || [])]
      .sort((a, b) => b.gih - a.gih);
    for(const c of cands){
      const url = (names.images || {})[c.name] || (names.images || {})[String(c.name).split(" // ")[0]];
      if(!url) continue;
      try{
        const r = await fetch(url.replace("/normal/", "/art_crop/"), { headers: { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" } });
        if(!r.ok) continue;
        artPath = `${OUT}/${LANG}/art.jpg`;
        await writeFile(artPath, Buffer.from(await r.arrayBuffer()));
        console.error(`背景アート: ${c.name}`);
        break;
      }catch(e){}
    }
    if(!artPath && await readFile(`${OUT}/${LANG}/art.jpg`).then(() => true, () => false)){
      artPath = `${OUT}/${LANG}/art.jpg`; console.error("背景アート: 前回のものを再利用");
    }
    if(!artPath) console.error("背景アート: 取得できず");
  }

  // カード画像（取れなければ名前の札のまま）
  for(const sc of scenes) if(sc.kind === "top"){
    for(const [i, c] of sc.cards.entries()){
      if(!c.img) continue;
      try{
        const r = await fetch(c.img, { headers: { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" } });
        if(!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await writeFile(`${OUT}/${LANG}/card-${sc.label}-${i}.jpg`, buf);
        c.imgPath = "data:image/jpeg;base64," + buf.toString("base64");   // SVG に直接埋め込む
      }catch(e){}
    }
  }

  // 背景のプレイ映像。あれば長さを測っておき、場面をまたいで途切れずに流す
  let bgDur = 0;
  try{
    bgDur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", BG]).toString().trim();
  }catch(e){}
  HAS_BG = bgDur > 0;
  console.error(HAS_BG ? `背景: ${BG}（${bgDur.toFixed(1)}秒、足りなければ繰り返す）` : "背景: 紺色（short/bg.mp4 が無い）");

  // 1) 音声を先にまとめて作る（VOICEVOX が要るのはここだけ）。文面が前回と同じなら作り直さない
  const prev = await readJson(`${OUT}/${LANG}/script.json`, []);
  let yomiLoaded = false;
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/${LANG}/scene-${i}`;
    const old = prev[i];
    if(old && old.say === sc.say && old.dur && await readFile(base + ".wav").then(() => true, () => false)){
      sc.kana = old.kana; sc.dur = old.dur; continue;
    }
    if(!yomiLoaded){ await loadYomi(); yomiLoaded = true; }
    const { kana, dur } = await speak(sc.say, base + ".wav");
    sc.kana = kana; sc.dur = dur;
  }
  await writeFile(`${OUT}/${LANG}/script.json`, JSON.stringify(scenes.map(s => ({ kind: s.kind, say: s.say, kana: s.kana, dur: s.dur })), null, 2), "utf8");

  // 2) 場面ごとに画像を描いて動画にする
  const segs = [];
  let total = 0;
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/${LANG}/scene-${i}`;
    const { kana, dur } = sc;
    const svg = sceneSvg(sc);
    await sharp(Buffer.from(svg), { density: 72 }).png().toFile(base + ".png");
    // 読み終わってすぐ切り替えず少し置く。画面に見せたい場面は最低の長さを保つ
    const len = dur + (sc.tail || 0.35), pad = len - dur, N = Math.ceil(len * 30);   // 読み終わりに少し置く（カードを見せる場面は長め）
    const audio = `[${(sc.art && artPath) || HAS_BG ? 2 : 1}:a]apad=pad_dur=${pad.toFixed(2)},aformat=sample_rates=48000:channel_layouts=stereo[a]`;
    let args;
    if(sc.art && artPath){
      // カードアートを縦いっぱいに敷き、ゆっくり寄る。膜は薄めにして絵を見せる
      args = ["-loop", "1", "-framerate", "30", "-i", artPath,
              "-loop", "1", "-framerate", "30", "-i", base + ".png", "-i", base + ".wav",
              "-filter_complex",
                `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
                `zoompan=z='1+0.08*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=30,eq=saturation=0.9[bg0];` +
                `color=c=0x0A2038@0.45:s=${W}x${H}:r=30[tint];[bg0][tint]overlay=shortest=1[bg];` +
                `[1:v]scale=${W}:${H},format=rgba,fade=t=in:d=0.2:alpha=1[fg];` +
                `[bg][fg]overlay=shortest=1,format=yuv420p[v];${audio}`];
    }else if(HAS_BG){
      // 横長の映像を縦に切り出し、暗くぼかして下に敷く。開始位置は前の場面の続きから
      const ss = (total % bgDur).toFixed(2);
      args = ["-stream_loop", "-1", "-ss", ss, "-i", BG,
              "-loop", "1", "-framerate", "30", "-i", base + ".png", "-i", base + ".wav",
              "-filter_complex",
                `[0:v]fps=30,scale=iw*sar:ih,setsar=1,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +   // 縦長ピクセルの録画（1440×1080 など）も正しい比率に直す
                `eq=saturation=0.7,gblur=sigma=5,setsar=1[bg0];` +
                `color=c=0x0A2038@0.6:s=${W}x${H}:r=30[tint];[bg0][tint]overlay=shortest=1[bg];` +   // 紺の膜で暗くして文字を立たせる
                `[1:v]scale=${W}:${H},format=rgba,fade=t=in:d=0.2:alpha=1[fg];` +
                `[bg][fg]overlay=shortest=1,format=yuv420p[v];${audio}`];
    }else{
      args = ["-loop", "1", "-framerate", "30", "-i", base + ".png", "-i", base + ".wav",
              "-filter_complex",
                `[0:v]zoompan=z='1+0.05*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=30,` +
                `fade=t=in:d=0.15,format=yuv420p[v];${audio}`];
    }
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args,
      "-map", "[v]", "-map", "[a]", "-t", String(len), "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
      base + ".mp4"]);
    segs.push(`file 'scene-${i}.mp4'`);
    total += len;
    console.error(`${i} ${sc.kind.padEnd(8)} ${dur.toFixed(1)}s → ${len.toFixed(1)}s  ${sc.say}`);
    console.error(`   読み: ${kana}`);
  }
  await writeFile(`${OUT}/${LANG}/list.txt`, segs.join("\n"), "utf8");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${OUT}/${LANG}/list.txt`,
    "-c", "copy", "-movflags", "+faststart", `${OUT}/${LANG}.mp4`]);
  console.error(`\n${OUT}/${LANG}.mp4  合計 ${total.toFixed(1)} 秒`);
}

main().catch(e => { console.error("動画の作成に失敗しました:", e.message); process.exit(1); });
