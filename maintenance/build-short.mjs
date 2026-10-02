#!/usr/bin/env node
/*
 * 「1分でわかる〇〇環境」の縦動画（1080×1920）を、記事データから作る。
 *
 *   node maintenance/build-short.mjs HOB        … 日本語（VOICEVOX）
 *   node maintenance/build-short.mjs HOB en     … 英語（Kokoro。KOKORO_DIR にモデルを置く）
 *   node maintenance/build-short.mjs HOB ja sealed … シールドのデータで（既定は draft）
 *
 * 出力: short/<SET>/<lang>.mp4（シールドは <lang>-sealed.mp4）と、途中生成物（台本 script.json・場面ごとの png/wav）
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
 *   ・セット名のロゴ画像を使いたいときは short/logo/<SET>.png（背景透過）を置く。MTGアリーナのロゴは short/logo/arena.png。あれば冒頭でセット名の
 *     文字の代わりに載せる。無ければ文字。ロゴはこちらでは取得も生成もしない（置くかどうかは運用側の判断）
 *   ・BGM は short/bgm/ に mp3 を置くと薄く流れる（無ければ無音）。商用利用可・YouTube/TikTok で使える曲だけ置くこと。
 *     short/bgm/credits.json に { "曲のファイル名": "表記" } を書くと締めの場面にクレジットが出る。BGM_VOLUME で音量（既定 0.10）
 *   ・背景に使うプレイ映像は short/bg.mp4 に置く（無ければ紺色の背景）。GitHub Actions では Releases の
 *     タグ assets にある bg.mp4 を落として使う（.github/workflows/build-short.yml）。横長のままでよく、
 *     縦に切り出して暗くぼかし、その上に文字や図を重ねる。音は使わない
 *
 * 投稿は手動。音声の読みは script.json の "kana" で確認できる。
 * SHORT_STILLS=1 を付けると場面の画像だけ作って終わる（レイアウト確認用）。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const SET = process.argv[2];
const LANG = (process.argv[3] || "ja").toLowerCase();
const MODE = (process.argv[4] || "draft").toLowerCase();        // draft | sealed（どちらのデータで作るか）
if(!SET || !["ja", "en"].includes(LANG) || !["draft", "sealed"].includes(MODE)){ console.error("使い方: node maintenance/build-short.mjs <SET> [ja|en] [draft|sealed]"); process.exit(1); }
const TAG = MODE === "draft" ? LANG : `${LANG}-${MODE}`;         // 出力名: short/<SET>/ja.mp4, short/<SET>/en-sealed.mp4 など
const JA = LANG === "ja";
const KOKORO_DIR = process.env.KOKORO_DIR || "short/kokoro";    // 英語の読み上げ（Kokoro）のモデル置き場
const KOKORO_PY = process.env.KOKORO_PY || "python3";
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
const COLOR_EN = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const CN = JA ? COLOR_JA : COLOR_EN;                 // この言語での色の名前
/* 画面とナレーションの決まり文句。言語ごとにここだけ変える */
const UI = JA ? {
  analysis: "リミテッド環境分析", arena: "MTGアリーナ", report: "リミテッド環境レポート", games: g => `${g}試合`, inOneMinute: "のデータが1分でわかる",
  whatIs: "リミテッドとは", whatIs1: "その場で開けたパックだけで", whatIs2: "デッキを組む遊び方", sealed: "シールド", draft: "ドラフト", thisVideo: "この動画はこちら",
  speedH: "環境の速さ", speedSub: "平均マナ総量ごとの勝率", under: m => `${m}未満`, between: (a, b) => `${a}〜${b}`, over: m => `${m}以上`,
  pace: { fast: "速い", mid: "普通", slow: "遅い", slower: "かなり遅い" },
  noCurve: "カーブで差がつかない", light: n => `軽いデッキが${n}pt有利`, heavy: n => `重いデッキが${n}pt有利`,
  colorsH: "色の強さ", bestPair: "一番強い組み合わせ", worsePair: "一番弱い組み合わせ", vsAvg: (sign, n) => `2色の平均より ${sign}${n}pt`,
  topH: label => `${label} 勝率トップ3`, common: "コモン", uncommon: "アンコモン", rank: i => `${i}位`, gih: v => `GIH勝率 ${v}%`,
  surpriseH: "意外な事実", nobody: "誰も組んでいない", strongerTogether: "組むと強くなる", weakerTogether: "組むと弱くなる",
  wrRank: (v, r) => `勝率 ${v}%（${r}位）`, wr: v => `勝率 ${v}%`, usedOnly: (g, p) => `使われた試合は ${g}。全体の${p}%だけ`, vsAvg2: (sign, n) => `2色それぞれの平均より ${sign}${n}pt`,
  outro1: "全カードの勝率は", outro2: "シールド／ドラフトの構築練習も無料", data: "データ: 17Lands 公開データ（CC BY 4.0）", voice: "音声: VOICEVOX:ずんだもん"
} : {
  analysis: "Limited format analysis", arena: "MTG Arena", report: "Limited format report", games: g => `${g} games`, inOneMinute: "of data, in one minute",
  whatIs: "What is Limited?", whatIs1: "Build a deck only from", whatIs2: "packs you just opened", sealed: "Sealed", draft: "Draft", thisVideo: "This video",
  speedH: "Format speed", speedSub: "Win rate by average mana value", under: m => `under ${m}`, between: (a, b) => `${a}–${b}`, over: m => `${m}+`,
  pace: { fast: "Fast", mid: "Average", slow: "Slow", slower: "Very slow" },
  noCurve: "Curve barely matters", light: n => `Light decks +${n}pt`, heavy: n => `Heavy decks +${n}pt`,
  colorsH: "Colour strength", bestPair: "Best pair", worsePair: "Weakest pair", vsAvg: (sign, n) => `vs 2-colour avg ${sign}${n}pt`,
  topH: label => `Top 3 ${label}s by win rate`, common: "common", uncommon: "uncommon", rank: i => `#${i}`, gih: v => `GIH WR ${v}%`,
  surpriseH: "One surprise", nobody: "Nobody plays it", strongerTogether: "Better together", weakerTogether: "Worse together",
  wrRank: (v, r) => `${v}% win rate (#${r})`, wr: v => `${v}% win rate`, usedOnly: (g, p) => `Only ${g} games — ${p}% of all decks`, vsAvg2: (sign, n) => `${sign}${n}pt vs each colour's average`,
  outro1: "Every card's win rate at", outro2: "Free Sealed / Draft practice too", data: "Data: 17Lands Public Data (CC BY 4.0)", voice: "Voice: Kokoro TTS"
};
const FONT = "'Noto Sans CJK JP','Noto Sans JP',sans-serif";

const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const pt = v => (v * 100).toFixed(1);
const man = n => JA ? (n >= 10000 ? `${Math.round(n / 10000)}万` : n.toLocaleString("ja-JP"))
                    : (n >= 10000 ? `${Math.round(n / 1000)}K` : n.toLocaleString("en-US"));
const manSay = n => JA ? man(n) : n.toLocaleString("en-US");     // 読み上げ用（英語は K と読ませない）

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
      title: UI.nobody,
      big: pairName(sleeper.pair), pair: sleeper.pair, sub: UI.wrRank(pt(sleeper.wr), rank),
      note: UI.usedOnly(man(sleeper.games), (sleeper.games / totalPair * 100).toFixed(1)),
      say: JA ? `意外なのは、${pairName(sleeper.pair)}が勝率${pt(sleeper.wr)}パーセントで${rank}位なのに、使われた試合が${man(sleeper.games)}しかないこと。誰も組んでいません。`
              : `Here's the surprise: ${pairName(sleeper.pair)} wins ${pt(sleeper.wr)} percent, number ${rank} overall, yet it showed up in only ${manSay(sleeper.games)} games. Nobody is playing it.`
    };
  }
  // 2色それぞれの平均から一番外れた組み合わせ
  const solid = pairs.filter(p => p.games >= 10000);
  const odd = solid.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if(odd){
    const up = odd.gap > 0;
    return {
      title: up ? UI.strongerTogether : UI.weakerTogether,
      big: pairName(odd.pair), pair: odd.pair, sub: UI.wr(pt(odd.wr)),
      note: UI.vsAvg2(up ? "+" : "−", Math.abs(odd.gap * 100).toFixed(1)),
      say: JA ? `意外なのは${pairName(odd.pair)}。2色それぞれの平均より${Math.abs(odd.gap * 100).toFixed(1)}ポイント${up ? "高い" : "低い"}。組むと${up ? "強く" : "弱く"}なる色です。`
              : `The surprise is ${pairName(odd.pair)}: ${Math.abs(odd.gap * 100).toFixed(1)} points ${up ? "above" : "below"} what its two colours average on their own. These colours are ${up ? "better" : "worse"} together.`
    };
  }
  return null;
}
const pairName = p => [...p].map(c => CN[c] || c).join(JA ? "" : "-");

/* ------------------------------------------------------------ 台本 */

function buildScript(d, nameJa, names){
  const pace = (d.speed || []).filter(s => s.wr != null && s.games);
  const fast = pace[0], slow = pace[pace.length - 1];
  const faster = fast && slow && fast.wr > slow.wr;
  const spread = fast && slow ? Math.abs(fast.wr - slow.wr) * 100 : 0;
  const colors = (d.colors || []).slice().sort((a, b) => b.wr - a.wr);
  const pairs = pairRows(d);
  const best = pairs[0];
  // 一番弱い組み合わせ（勝率が最も低いもの。試合数が少なすぎる組み合わせは除く）
  //（全体の 4% 以上、かつ 2,000 試合以上使われている組み合わせから選ぶ。シールドは試合数が少ないので割合で見る）
  const totalPairGames = pairs.reduce((n, p) => n + p.games, 0);
  const solidPairs = pairs.filter(p => p.games >= Math.max(2000, totalPairGames * 0.04));
  const worst = (solidPairs.length ? solidPairs : pairs).slice().sort((a, b) => a.wr - b.wr)[0];
  const top3 = list => (list || []).slice(0, 3)
    .map(c => ({ ...c, label: JA ? ((names.names || {})[c.name] || c.name) : c.name, img: JA ? (names.images || {})[c.name] : null }));
  const commons = top3(d.top && d.top.common), uncommons = top3(d.top && d.top.uncommon);
  const sur = surprise(d, pairs);
  const games = man(d.total_games);

  const scenes = [];
  scenes.push({ kind: "hook", art: true,
    say: JA ? `MTGアリーナ、リミテッドの${nameJa}環境。${games}試合のデータが、1分でわかります。`
            : `MTG Arena Limited: ${/^the /i.test(nameJa) ? nameJa : "the " + nameJa} format. ${d.total_games >= 10000 ? Math.round(d.total_games / 1000) + " thousand" : manSay(d.total_games)} games of data, in one minute.`,
    title: nameJa, games });

  // お決まりの前置き：リミテッドとは何か、シールドとドラフトのどちらのデータか
  const isSealed = d.mode === "sealed";
  scenes.push({ kind: "intro", isSealed,
    say: JA ? `リミテッドは、その場で開けたパックだけでデッキを組む遊び方。シールドとドラフトがあります。`
            + `この動画は、${isSealed ? "シールド" : "ドラフト"}のデータです。`
            : `Limited means building a deck only from packs you just opened. There are two formats, Sealed and Draft. This video covers ${isSealed ? "Sealed" : "Draft"} data.`,
    tail: 0.8 });

  if(fast && slow){
    // 速さは一言だけ。数字は画面に任せる（読み上げるとくどい）
    const paceKey = UI.pace[(d.verdict || {}).key] ? (d.verdict || {}).key : (spread < 2 ? "mid" : faster ? "fast" : "slow");
    const paceWord = UI.pace[paceKey];
    // 一番勝っている区分（端だけでなく全部の区分から選ぶ）。読み上げ用は「2.9から3.2」のように言葉で
    const bi = pace.reduce((m, r, i) => r.wr > pace[m].wr ? i : m, 0), br = pace[bi];
    const bestBand = bi === 0 ? (JA ? `${br.max}未満` : `under ${br.max}`)
                   : br.max ? (JA ? `${pace[bi - 1].max}から${br.max}` : `between ${pace[bi - 1].max} and ${br.max}`)
                   : (JA ? `${pace[bi - 1].max}以上` : `${pace[bi - 1].max} or more`);
    scenes.push({ kind: "pace",
      say: JA ? `環境の速さは、${paceWord}です。平均マナ総量${bestBand}のデッキが、勝率${pt(br.wr)}パーセントで一番勝っています。`
              : `The format is ${paceWord.toLowerCase()}. Decks with an average mana value ${bestBand} win the most, at ${pt(br.wr)} percent.`,
      paceWord, tail: 0.8,
      rows: pace.map((s, i) => ({ label: i === 0 ? UI.under(s.max) : s.max ? UI.between(pace[i - 1].max, s.max) : UI.over(pace[i - 1].max), wr: s.wr })),
      headline: spread < 2 ? UI.noCurve : faster ? UI.light(Math.round(spread)) : UI.heavy(Math.round(spread)) });
  }

  if(colors.length && best){
    const top2 = colors.slice(0, 2).map(c => CN[c.color]).join(JA ? "と" : " and ");
    let say = JA ? `強い色は${top2}。組み合わせなら${pairName(best.pair)}が${pt(best.wr)}パーセントで最強。`
                 : `The strongest colours are ${top2}. The best pair is ${pairName(best.pair)}, at ${pt(best.wr)} percent.`;
    if(worst && worst !== best) say += JA ? `逆に一番弱いのは${pairName(worst.pair)}で、${pt(worst.wr)}パーセントです。`
                                         : ` The weakest pair is ${pairName(worst.pair)}, at ${pt(worst.wr)} percent.`;
    scenes.push({ kind: "colors", say, colors, best, worst: worst && worst !== best ? worst : null });
  }

  // カード名は読まず画面に任せる。読むと忙しいので、どの色が強いかだけ言う
  const topScene = (cards, label) => {
    if(!cards.length) return;
    const same = cards[0].color && cards.filter(c => c.color === cards[0].color).length >= 2;
    const lead = JA ? (same ? `${CN[cards[0].color]}が強いです。` : "色はばらけています。")
                    : (same ? `${CN[cards[0].color]} is strong here.` : "The colours are spread out.");
    scenes.push({ kind: "top", label, say: JA ? `${label}のトップ3はこちら。${lead}` : `Here are the top three ${label}s. ${lead}`, cards, tail: 1.0 });
  };
  topScene(commons, UI.common);
  topScene(uncommons, UI.uncommon);

  if(sur) scenes.push({ kind: "surprise", say: sur.say, ...sur });

  scenes.push({ kind: "outro", art: true, say: JA ? `全カードの勝率は、${SITE.replace(/\./g, " ドット ")} で。` : `Every card's win rate is at ${SITE.replace(/\./g, " dot ").replace("-", " ")}.`,
    cap: JA ? `全カードの勝率は、${SITE} で。` : `Every card's win rate is at ${SITE}`,   // 字幕は読み上げ用の「ドット」ではなく本来の表記で   // 17Lands の出典は画面の文字で示す（音声では言わない）
    site: SITE });
  return scenes;
}

/* ------------------------------------------------------------ 画面 */

const T = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 44}" fill="${o.fill || PAPER}" font-weight="${o.weight || 400}"` +
  `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.op != null ? ` opacity="${o.op}"` : ""}>${esc(s)}</text>`;

/* 字幕。句読点で折り返し、数字・英字のかたまりは途中で切らない */
function wrap(s, n = 22){
  if(!JA){
    // 英語は単語で折り返す（1行 38 文字ほど）
    const words = s.split(/\s+/).filter(Boolean), out = []; let cur = "";
    for(const w of words){
      if(cur && (cur + " " + w).length > 38){ out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
    }
    if(cur) out.push(cur);
    return out.slice(0, 5);
  }
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
  const lines = wrap(say.replace(/パーセント/g, "%").replace(/ percent/g, "%"));
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
         T(x, y + size * 0.17, JA ? (COLOR_JA[c] || c) : c, { size: size * 0.42, weight: 900, anchor: "middle", fill: c === "W" ? DEEP : PAPER });
}
/* 2色の組み合わせをシンボル2つで */
function pairSymbols(pair, x, y, size){
  return [...pair].map((c, i) => symbol(c, x + i * (size + 12) + size / 2, y, size)).join("");
}
/* 画面の枠。サイト名やドメインは常時表示しない（締めの場面で音声つきで案内するので、それ以外はうるさくなる）。
   代わりに、冒頭以外の場面では上部にセットのロゴ（無ければセット名）と「リミテッド環境分析」を常に出し、
   途中から見た人にも何のセットの話か分かるようにする */
const HEADER = { logo: null, title: "" };
function header(){
  const band = HAS_BG ? `<rect x="40" y="30" width="${W - 80}" height="146" rx="24" fill="${DEEP}" opacity="0.6"/>` : "";
  if(HEADER.logo){
    return band +
      `<image href="${HEADER.logo}" x="64" y="44" width="330" height="118" preserveAspectRatio="xMinYMid meet"/>` +
      T(424, 122, UI.analysis, { size: 40, fill: MUTED, weight: 700 });
  }
  const n = [...HEADER.title].length;
  return band +
    T(64, 122, HEADER.title, { size: n <= 6 ? 56 : n <= 9 ? 46 : 38, fill: BLUE, weight: 900 }) +
    T(W - 64, 122, UI.analysis, { size: 36, fill: MUTED, weight: 700, anchor: "end" });
}
function frame(inner, say, opts = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PINE}"/><stop offset="1" stop-color="${DEEP}"/></linearGradient></defs>
  ${HAS_BG ? "" : `<rect width="${W}" height="${H}" fill="url(#bg)"/>`}
  ${opts.header === false ? "" : header()}
  ${inner}
  ${say ? caption(say) : ""}
</svg>`;
}

function sceneSvg(sc){
  switch(sc.kind){
    case "hook": {
      const n = [...sc.title].length, size = JA ? (n <= 5 ? 140 : n <= 8 ? 104 : 80) : (n <= 10 ? 120 : n <= 16 ? 90 : 68);
      // MTGアリーナのロゴ画像（short/logo/arena.png）があれば文字の代わりに。無ければ文字
      const arena = sc.arenaLogo
        ? `<image href="${sc.arenaLogo}" x="${W / 2 - 320}" y="250" width="640" height="225" preserveAspectRatio="xMidYMid meet"/>`
        : T(W / 2, 400, UI.arena, { size: 84, weight: 900, anchor: "middle" });
      // セットのロゴ画像があれば、幅 900・高さ 300 の枠に収めて中央に。無ければセット名を文字で
      const title = sc.logo
        ? `<image href="${sc.logo}" x="${W / 2 - 450}" y="760" width="900" height="300" preserveAspectRatio="xMidYMid meet"/>`
        : T(W / 2, 890, sc.title, { size, weight: 900, anchor: "middle", fill: BLUE });
      return frame(
        arena +
        T(W / 2, 590, UI.report, { size: 48, fill: MUTED, anchor: "middle" }) +
        `<rect x="${W / 2 - 200}" y="640" width="400" height="6" fill="${BLUE}"/>` +
        title +
        T(W / 2, sc.logo ? 1210 : 1090, UI.games(sc.games), { size: 92, weight: 900, anchor: "middle" }) +
        T(W / 2, sc.logo ? 1290 : 1170, UI.inOneMinute, { size: 44, fill: MUTED, anchor: "middle" }), null, { header: false });   // 冒頭は字幕なし（画面と同じ内容を読むだけなので）
    }
    case "intro": {
      const box = (x, label, on) =>
        `<rect x="${x}" y="640" width="440" height="300" rx="28" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${on ? BLUE : MUTED}" stroke-width="${on ? 6 : 3}"/>` +
        T(x + 220, 790, label, { size: 68, weight: 900, anchor: "middle", fill: on ? PAPER : MUTED }) +
        (on ? T(x + 220, 870, UI.thisVideo, { size: 32, anchor: "middle", fill: BLUE, weight: 700 }) : "");
      return frame(
        T(W / 2, 330, UI.whatIs, { size: 44, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 430, UI.whatIs1, { size: 50, weight: 700, anchor: "middle" }) +
        T(W / 2, 500, UI.whatIs2, { size: 50, weight: 700, anchor: "middle" }) +
        box(80, UI.sealed, sc.isSealed) + box(560, UI.draft, !sc.isSealed), sc.say);
    }
    case "pace": {
      const wrs = sc.rows.map(r => r.wr * 100), lo = Math.floor(Math.min(...wrs) - 1), hi = Math.ceil(Math.max(...wrs) + 1);
      const X0 = 330, X1 = W - 120, sx = v => X0 + (v - lo) / (hi - lo) * (X1 - X0);
      let s = T(80, 300, UI.speedH, { size: 40, fill: MUTED }) +
              T(80, 390, sc.paceWord, { size: 96, weight: 900, fill: BLUE }) +
              T(80 + [...sc.paceWord].length * (JA ? 100 : 56) + 24, 388, sc.headline, { size: 40, fill: PAPER });
      s += T(80, 470, UI.speedSub, { size: 34, fill: MUTED });
      sc.rows.forEach((r, i) => {
        const y = 580 + i * 130;
        s += T(X0 - 30, y + 16, r.label, { size: JA ? 40 : 34, anchor: "end" });
        s += `<line x1="${X0}" x2="${X1}" y1="${y}" y2="${y}" stroke="${PAPER}" stroke-opacity="0.12" stroke-width="3"/>`;
        s += `<line x1="${X0}" x2="${sx(r.wr * 100)}" y1="${y}" y2="${y}" stroke="${BLUE}" stroke-width="10" stroke-linecap="round"/>`;
        s += `<circle cx="${sx(r.wr * 100)}" cy="${y}" r="22" fill="${BLUE}" stroke="${PAPER}" stroke-width="4"/>`;
        s += T(sx(r.wr * 100), y - 40, pt(r.wr) + "%", { size: 44, weight: 900, anchor: "middle" });
      });
      return frame(s, sc.say);
    }
    case "colors": {
      let s = T(80, 230, UI.colorsH, { size: 40, fill: MUTED });
      sc.colors.forEach((c, i) => {
        const x = 130 + i * 205;
        s += symbol(c.color, x, 350, 132);
        s += T(x, 480, pt(c.wr) + "%", { size: 40, anchor: "middle", weight: i < 2 ? 900 : 400, fill: i < 2 ? PAPER : MUTED });
      });
      const card = (y, title, p, col) =>
        `<rect x="80" y="${y}" width="${W - 160}" height="210" rx="28" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${col}" stroke-width="4"/>` +
        T(120, y + 62, title, { size: 34, fill: col, weight: 700 }) +
        pairSymbols(p.pair, 120, y + 128, 96) +
        T(350, y + 160, pairName(p.pair), { size: JA ? 60 : 48, weight: 900 }) +
        T(W - 120, y + 148, pt(p.wr) + "%", { size: 80, weight: 900, anchor: "end", fill: col }) +
        T(W - 120, y + 190, UI.vsAvg(p.gap > 0 ? "+" : "−", Math.abs(p.gap * 100).toFixed(1)), { size: 30, anchor: "end", fill: MUTED });
      s += card(560, UI.bestPair, sc.best, UP);
      if(sc.worst) s += card(810, UI.worsePair, sc.worst, DOWN);
      return frame(s, sc.say);
    }
    case "top": {
      // カードを大きく見せる。字幕の枠（下から 300+40+118）にかからない範囲で、3枚を縦に並べる
      const CW = 266, CH = 372, ROW = 380, Y0 = 250, TX = 390;
      let s = T(80, 222, UI.topH(sc.label), { size: 40, fill: MUTED });
      sc.cards.forEach((c, i) => {
        const y = Y0 + i * ROW, col = COLOR[c.color] || MUTED;
        // カード画像が入る枠。取れたときは実画像、取れなければ色付きの札に名前
        if(c.imgPath){
          s += `<image href="${c.imgPath}" x="80" y="${y}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid slice"/>`;
        }else{
          s += `<rect x="80" y="${y}" width="${CW}" height="${CH}" rx="16" fill="${col}" opacity="0.85"/>`;
          s += `<rect x="96" y="${y + 16}" width="${CW - 32}" height="170" rx="10" fill="${DEEP}" opacity="0.5"/>`;
        }
        s += T(TX, y + 90, UI.rank(i + 1), { size: 36, fill: MUTED });
        const n = [...c.label].length;
        const size = JA ? (n <= 8 ? 60 : n <= 12 ? 48 : 38) : (n <= 16 ? 50 : n <= 24 ? 40 : 32);
        s += T(TX, y + 190, c.label, { size, weight: 900 });
        s += T(TX, y + 290, UI.gih(pt(c.gih)), { size: 46, fill: BLUE, weight: 700 });
      });
      return frame(s, sc.say);
    }
    case "surprise": {
      return frame(
        T(W / 2, 420, UI.surpriseH, { size: 44, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 560, sc.title, { size: JA ? 72 : 64, weight: 900, anchor: "middle", fill: DOWN }) +
        `<rect x="120" y="640" width="${W - 240}" height="420" rx="32" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${BLUE}" stroke-width="4"/>` +
        (sc.pair ? pairSymbols(sc.pair, W / 2 - 132 - 6, 740, 132) + T(W / 2, 866, sc.big, { size: JA ? 60 : 50, weight: 900, anchor: "middle" })
                 : T(W / 2, 810, sc.big, { size: 140, weight: 900, anchor: "middle" })) +
        T(W / 2, 940, sc.sub, { size: 50, anchor: "middle", fill: BLUE, weight: 700 }) +
        T(W / 2, 1010, sc.note, { size: JA ? 34 : 30, anchor: "middle", fill: MUTED }), sc.say);
    }
    case "outro": {
      return frame(
        T(W / 2, 560, UI.outro1, { size: 52, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 700, sc.site, { size: 78, weight: 900, anchor: "middle", fill: BLUE }) +
        T(W / 2, 800, UI.outro2, { size: 40, anchor: "middle" }) +
        T(W / 2, 930, UI.data, { size: 30, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 975, UI.voice + (sc.bgmCredit ? `　BGM: ${sc.bgmCredit}` : ""), { size: 30, fill: MUTED, anchor: "middle" }) +
        // Wizards の Fan Content Policy が求める表記。外さないこと
        T(W / 2, 1050, "Unofficial Fan Content permitted under the Fan Content Policy.", { size: 22, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 1082, "Not approved/endorsed by Wizards. Portions of the materials used", { size: 22, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 1114, "are property of Wizards of the Coast. ©Wizards of the Coast LLC.", { size: 22, fill: MUTED, anchor: "middle" }), sc.cap || sc.say);
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

/* 英語の読み上げ（Kokoro）。短い Python を呼ぶ。モデルは KOKORO_DIR（kokoro-v1.0.onnx と voices-v1.0.bin） */
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
  // 文末に少し間を置く（0.25秒の無音を足す）
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-af", "apad=pad_dur=0.25", wavPath + ".tmp.wav"]);
  execFileSync("mv", [wavPath + ".tmp.wav", wavPath]);
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]).toString().trim();
  return { kana: text, dur };
}

async function speak(text, wavPath){
  if(!JA) return speakEn(text, wavPath);
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
  const d = await readJson(`data/articles/${SET}_${MODE}.json`, null);
  if(!d){ console.error(`${SET}: ${MODE} の記事データ（data/articles/${SET}_${MODE}.json）がありません`); process.exit(1); }
  const names = await readJson(`data/names/${SET}.json`, { names: {}, images: {} });
  const nameJa = JA ? ((await setNameJa(SET)) || names.set || SET) : (names.set || SET);   // 英語のときは英語のセット名
  const sharp = (await import("sharp")).default;
  await mkdir(`${OUT}/${TAG}`, { recursive: true });

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
    // MTGアリーナのロゴ画像（short/logo/arena.png）。あれば冒頭の「MTGアリーナ」の文字の代わりに
    HEADER.logo = hook && hook.logo || null;
    HEADER.title = nameJa;
    const ab = await readFile("short/logo/arena.png").catch(() => null);
    if(ab && hook){ hook.arenaLogo = "data:image/png;base64," + ab.toString("base64"); console.error("アリーナのロゴ: short/logo/arena.png"); }
  }

  // BGM（short/bgm/*.mp3 を置いておくと、薄く流す。short/bgm/credits.json に { "ファイル名": "表記" } があれば締めにクレジットを出す）
  let bgm = null, bgmCredit = "";
  try{
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir("short/bgm")).filter(f => /\.(mp3|m4a|wav|ogg)$/i.test(f)).sort();
    if(files.length){
      // セットコードから決まる1曲（同じセットなら日英・形式で同じ曲になる）
      const pick = files[[...SET].reduce((n, ch) => n + ch.charCodeAt(0), 0) % files.length];
      bgm = `short/bgm/${pick}`;
      const credits = await readJson("short/bgm/credits.json", {});
      bgmCredit = credits[pick] || "";
      console.error(`BGM: ${pick}${bgmCredit ? `（${bgmCredit}）` : ""}`);
    }else console.error("BGM: 無し（short/bgm/ に曲が無い）");
  }catch(e){ console.error("BGM: 無し"); }
  const outro = scenes.find(sc => sc.kind === "outro");
  if(outro && bgmCredit) outro.bgmCredit = bgmCredit;

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
        artPath = `${OUT}/${TAG}/art.jpg`;
        await writeFile(artPath, Buffer.from(await r.arrayBuffer()));
        console.error(`背景アート: ${c.name}`);
        break;
      }catch(e){}
    }
    if(!artPath && await readFile(`${OUT}/${TAG}/art.jpg`).then(() => true, () => false)){
      artPath = `${OUT}/${TAG}/art.jpg`; console.error("背景アート: 前回のものを再利用");
    }
    if(!artPath) console.error("背景アート: 取得できず");
  }

  // カード画像（取れなければ名前の札のまま）。英語は Scryfall から英語版を引く
  for(const sc of scenes) if(sc.kind === "top"){
    for(const [i, c] of sc.cards.entries()){
      if(!JA && !c.img){
        try{
          const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(String(c.name).split(" // ")[0])}&set=${SET.toLowerCase()}`, { headers: { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" } });
          if(r.ok){ const j = await r.json(); c.img = (j.image_uris || (j.card_faces && j.card_faces[0].image_uris) || {}).normal || null; }
          await new Promise(res => setTimeout(res, 120));
        }catch(e){}
      }
      if(!c.img) continue;
      try{
        const r = await fetch(c.img, { headers: { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" } });
        if(!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await writeFile(`${OUT}/${TAG}/card-${sc.label}-${i}.jpg`, buf);
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
  const prev = await readJson(`${OUT}/${TAG}/script.json`, []);
  let yomiLoaded = false;
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/${TAG}/scene-${i}`;
    const old = prev[i];
    if(old && old.say === sc.say && old.dur && await readFile(base + ".wav").then(() => true, () => false)){
      sc.kana = old.kana; sc.dur = old.dur; continue;
    }
    if(JA && !yomiLoaded){ await loadYomi(); yomiLoaded = true; }
    const { kana, dur } = await speak(sc.say, base + ".wav");
    sc.kana = kana; sc.dur = dur;
  }
  await writeFile(`${OUT}/${TAG}/script.json`, JSON.stringify(scenes.map(s => ({ kind: s.kind, say: s.say, kana: s.kana, dur: s.dur })), null, 2), "utf8");

  // 2) 場面ごとに画像を描いて動画にする
  const segs = [];
  let total = 0;
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/${TAG}/scene-${i}`;
    const { kana, dur } = sc;
    const svg = sceneSvg(sc);
    await sharp(Buffer.from(svg), { density: 72 }).png().toFile(base + ".png");
    if(process.env.SHORT_STILLS){ console.error(`${i} ${sc.kind} → ${base}.png（画像だけ）`); continue; }   // 見た目の確認用。動画は作らない
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
  if(process.env.SHORT_STILLS){ console.error("画像だけ作りました。"); return; }
  await writeFile(`${OUT}/${TAG}/list.txt`, segs.join("\n"), "utf8");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${OUT}/${TAG}/list.txt`,
    "-c", "copy", "-movflags", "+faststart", bgm ? `${OUT}/${TAG}/nobgm.mp4` : `${OUT}/${TAG}.mp4`]);
  if(bgm){
    // BGM を薄く敷く。ナレーションが鳴っている間は自動で少し下げ（ダッキング）、最後の2秒でフェードアウト
    const vol = process.env.BGM_VOLUME || "0.10";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/${TAG}/nobgm.mp4`, "-stream_loop", "-1", "-i", bgm,
      "-filter_complex",
        `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 2).toFixed(2)}:d=2[bg];` +
        `[0:a]asplit[v1][v2];[bg][v2]sidechaincompress=threshold=0.05:ratio=6:attack=40:release=400[duck];` +
        `[v1][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(total), "-movflags", "+faststart", `${OUT}/${TAG}.mp4`]);
  }
  console.error(`\n${OUT}/${TAG}.mp4  合計 ${total.toFixed(1)} 秒${bgm ? "（BGM あり）" : ""}`);
}

main().catch(e => { console.error("動画の作成に失敗しました:", e.message); process.exit(1); });
