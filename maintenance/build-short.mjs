#!/usr/bin/env node
/*
 * 「1分でわかる〇〇環境」の縦動画（1080×1920）を、記事データから作る。
 *
 *   node maintenance/build-short.mjs HOB        … 日本語（VOICEVOX）
 *   node maintenance/build-short.mjs HOB en     … 英語（Kokoro。KOKORO_DIR にモデルを置く）
 *   node maintenance/build-short.mjs HOB ja sealed … シールドのデータで（既定は draft）
 *   node maintenance/build-short.mjs FRA ja trend  … 修正版（確定版のあと。ドラフトの発売直後（最初の1週間）と最近1週間の変化。data/trends/<SET>_draft.json から。台本は short-trend.mjs）
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
 * SHORT_STILLS=1 を付けると場面の画像だけ作って終わる（レイアウト確認用）。SHORT_FAKE_AUDIO=1 は VOICEVOX 無しで仮の音で動画まで組み立てる（動画の組み立ての確認用）。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { splitSay } from "./highlight-split.mjs";
import { lookupOutside } from "./outside-cards.mjs";
import { loadReport } from "./report-data.mjs";
import { rarityAverages, isBombLevel } from "./card-level.mjs";
import { trendScript } from "./short-trend.mjs";
import { TREND_FORMAT } from "./trend-format.mjs";

const SET = process.argv[2];
const LANG = (process.argv[3] || "ja").toLowerCase();
const MODE = (process.argv[4] || "draft").toLowerCase();        // draft | sealed | early | trend（どのデータで作るか。early = 発売直後の先行版。build-early.mjs が作る。trend = 修正版。build-trend.mjs が作る）
if(!SET || !["ja", "en"].includes(LANG) || !["draft", "sealed", "early", "trend"].includes(MODE)){ console.error("使い方: node maintenance/build-short.mjs <SET> [ja|en] [draft|sealed|early|trend]"); process.exit(1); }
const EARLY = MODE === "early";
const TREND = MODE === "trend";
const MINP = EARLY ? 0.2 : 1;                                      // 先行版は試合数が少ないので、組み合わせを選ぶ最低試合数を下げる
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
const UP = "#5B9BFF", DOWN = "#F08A3E", GOLD = "#F2C94C";
const COLOR = { W: "#F3EAC6", U: "#4A90E2", B: "#6B5E7A", R: "#E1553E", G: "#3E9B5B" };
const COLOR_JA = { W: "白", U: "青", B: "黒", R: "赤", G: "緑" };
const COLOR_EN = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const CN = JA ? COLOR_JA : COLOR_EN;                 // この言語での色の名前
/* 画面とナレーションの決まり文句。言語ごとにここだけ変える */
const UI = JA ? {
  analysis: "リミテッド環境分析", arena: "MTGアリーナ", report: "リミテッド環境レポート", games: g => `${g}試合`, inOneMinute: "のデータが1分でわかる", hookA: "1分でわかる", hookC: m => m ? "シールド環境" : "ドラフト環境", hookD1: g => `${g}試合を分析`, hookD2: "強い色とカードを紹介",
  tierH: "色の組み合わせ ティア表", targetTag: "狙い目", bombsH: (a, b) => `レア・神話レアのボム トップ6（${a}〜${b}位）`, bombsTag: { mythic: "神話レア", rare: "レア" },
  speedH: "環境の速さ", speedSub: "平均マナ総量ごとの勝率", under: m => `${m}未満`, between: (a, b) => `${a}〜${b}`, over: m => `${m}以上`,
  pace: { fast: "速い", "lean-fast": "やや速い", mid: "普通", even: "普通", "lean-slow": "やや遅い", slow: "遅い", slower: "かなり遅い" },
  noCurve: "カーブで差がつかない", light: n => `軽いデッキが${n}pt有利`, heavy: n => `重いデッキが${n}pt有利`, lighter: "軽いほど勝つ", heavier: "重いほど勝つ",
  colorsH: "色の強さ", bestPair: "一番強い組み合わせ", targetPair: "狙い目（強いのに空いている）", worsePair: "一番弱い組み合わせ", vsAvg: (sign, n) => `2色の平均より ${sign}${n}pt`,
  share: (s, a, r) => `勝率${r}位・使用率 ${s}%（平均 ${a}%）`, targetH: "ドラフトの狙い目", targetT: "強いのに空いている", shareNote: (s, a) => `使っている人は ${s}%（平均 ${a}%）`,
  topH: label => `${label} 勝率トップ3`, common: "コモン", uncommon: "アンコモン", rank: i => `${i}位`, gih: v => `引けた試合の勝率 ${v}%`, gihL: "引けた試合の勝率",
  subscribe: "▶ チャンネル登録",
  surpriseH: "意外な事実", nobody: "誰も組んでいない", strongerTogether: "組むと強くなる", weakerTogether: "組むと弱くなる",
  wrRank: (v, r) => `勝率 ${v}%（${r}位）`, wr: v => `勝率 ${v}%`, usedOnly: (g, p) => `使われた試合は ${g}。全体の${p}%だけ`, vsAvg2: (sign, n) => `2色それぞれの平均より ${sign}${n}pt`,
  outroA: "チャンネル登録を", outroB: "お願いします", subscribed: "✓ 登録済み", ctaA: "チャンネル登録と", ctaB: "高評価もぜひ！", data: "データ: 17Lands 公開データ（CC BY 4.0）", voice: "音声: VOICEVOX:ずんだもん",
  earlyBadge: "速報", earlyHookC: "リミテッド速報", earlyHookD3: "勝てる色と勝率が高いカードを解説",
  cardCh: { bombs: "レア・神話レア", uncommon: "アンコモン", common: "コモン" }, cardH: { bombs: "勝率トップ3", other: "勝率トップ3" },
  bye: "楽しいリミテッドライフを！",
  bombLevel: "ボム級", vsAvgOf: (label, g) => `${label}の平均より +${g}pt`, anyCopies: "何枚でもOK",
  verdict: { pick: "迷わずピック", move: "色を合わせる価値あり", take: "色が合えば優先" }, rareLabel: "レア・神話レア",
  trendBadge: "修正版", trendHookC: "ドラフト環境の変化", trendHookD2: "勝率が上がったカード", trendHookD3: "勝てる色と勝率が上がったカードを解説",
  trendUpH: "発売直後から上がったカード", trendDownH: "発売直後から下がったカード", trendPairsH: "2色の組み合わせ（発売直後 → 最近）",
  trendFirst: "発売直後", trendLast: "最近", trendRise: "一番伸びた", trendFall: "一番落ちた", trendTop: "今の1位", trendTopKeep: "ずっと1位"
} : {
  analysis: "Limited format analysis", arena: "MTG Arena", report: "Limited format report", games: g => `${g} games`, inOneMinute: "of data, in one minute", hookA: "Limited in 1 minute", hookC: m => m ? "SEALED" : "DRAFT", hookD1: g => `${g} games analyzed`, hookD2: "Best colors & cards",
  tierH: "Colour-pair tier list", targetTag: "AIM FOR", bombsH: (a, b) => `Top 6 rare & mythic bombs (#${a}–${b})`, bombsTag: { mythic: "Mythic", rare: "Rare" },
  speedH: "Format speed", speedSub: "Win rate by average mana value", under: m => `under ${m}`, between: (a, b) => `${a}–${b}`, over: m => `${m}+`,
  pace: { fast: "Fast", "lean-fast": "Leans fast", mid: "Average", even: "Average", "lean-slow": "Leans slow", slow: "Slow", slower: "Very slow" },
  noCurve: "Curve barely matters", light: n => `Light decks +${n}pt`, heavy: n => `Heavy decks +${n}pt`, lighter: "Lighter wins", heavier: "Heavier wins",
  colorsH: "Colour strength", bestPair: "Best pair", targetPair: "Aim for this (strong, under-drafted)", worsePair: "Weakest pair", vsAvg: (sign, n) => `vs 2-colour avg ${sign}${n}pt`,
  share: (s, a, r) => `#${r} · drafted ${s}% (avg ${a}%)`, targetH: "Draft pick to aim for", targetT: "Strong, but under-drafted", shareNote: (s, a) => `Drafted by ${s}% (average ${a}%)`,
  topH: label => `Top 3 ${label}s by win rate`, common: "common", uncommon: "uncommon", rank: i => `#${i}`, gih: v => `Win rate when drawn ${v}%`, gihL: "Win rate when drawn",
  subscribe: "▶ Subscribe",
  surpriseH: "One surprise", nobody: "Nobody plays it", strongerTogether: "Better together", weakerTogether: "Worse together",
  wrRank: (v, r) => `${v}% win rate (#${r})`, wr: v => `${v}% win rate`, usedOnly: (g, p) => `Only ${g} games — ${p}% of all decks`, vsAvg2: (sign, n) => `${sign}${n}pt vs each colour's average`,
  outroA: "Please subscribe", outroB: "", subscribed: "✓ Subscribed", ctaA: "Like &", ctaB: "subscribe!", data: "Data: 17Lands Public Data (CC BY 4.0)", voice: "Voice: Kokoro TTS",
  earlyBadge: "EARLY LOOK", earlyHookC: "LIMITED · WEEK 1", earlyHookD3: "Winning pairs & top cards by win rate",
  cardCh: { bombs: "RARES & MYTHICS", uncommon: "UNCOMMONS", common: "COMMONS" }, cardH: { bombs: "Top 3 by win rate", other: "Top 3 by win rate" },
  bye: "Have fun in Limited!",
  bombLevel: "Bomb-level", vsAvgOf: (label, g) => `+${g}pt vs average ${label}`, anyCopies: "Any number OK",
  verdict: { pick: "Easy first pick", move: "Worth moving in", take: "Take it in colour" }, rareLabel: "rare & mythic",
  trendBadge: "UPDATE", trendHookC: "DRAFT · WHAT CHANGED", trendHookD2: "Cards rising in win rate", trendHookD3: "Winning pairs & cards rising in win rate",
  trendUpH: "Rising since launch", trendDownH: "Falling since launch", trendPairsH: "Colour pairs (launch → recent)",
  trendFirst: "Launch", trendLast: "Recent", trendRise: "Rose most", trendFall: "Fell most", trendTop: "No. 1 now", trendTopKeep: "No. 1 all along"
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
/* 「意外な事実」をデータから1つ選ぶ。最強・最弱の組み合わせは「色」の場面で言うので、ここでは出さない。
   候補が無ければ null（場面ごと割愛） */
function surprise(d, pairs, best, worst, target){
  const totalPair = pairs.reduce((n, p) => n + p.games, 0) || 1;
  const skip = p => (best && p.pair === best.pair) || (worst && p.pair === worst.pair) || (target && p.pair === target.pair);
  // 1) 上位3位以内なのに、ほとんど使われていない組み合わせ（狙い目）
  const sleeper = pairs.slice(0, 3).find(p => !skip(p) && p.games / totalPair < 0.05 && p.games >= 2000 * MINP);
  if(sleeper){
    const rank = pairs.indexOf(sleeper) + 1;
    return {
      title: UI.nobody,
      big: pairName(sleeper.pair), pair: sleeper.pair, sub: UI.wrRank(pt(sleeper.wr), rank),
      note: UI.usedOnly(man(sleeper.games), (sleeper.games / totalPair * 100).toFixed(1)),
      say: JA ? `意外なのは、${pairName(sleeper.pair)}が勝率${pt(sleeper.wr)}パーセントで${rank}位なのに、使われた試合が${man(sleeper.games)}しかないこと。誰も組んでいない狙い目です。`
              : `Here's the surprise: ${pairName(sleeper.pair)} wins ${pt(sleeper.wr)} percent, number ${rank} overall, yet it showed up in only ${manSay(sleeper.games)} games. Nobody is playing it.`
    };
  }
  // 2) 最強・最弱以外で、2色それぞれの平均から 1pt 以上はっきり外れている組み合わせ（組むと強い／弱い）
  const solid = pairs.filter(p => !skip(p) && p.games >= Math.max(5000 * MINP, totalPair * 0.04));
  const odd = solid.filter(p => Math.abs(p.gap) >= 0.01).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if(odd){
    const up = odd.gap > 0;
    const rank = pairs.indexOf(odd) + 1;
    return {
      title: up ? UI.strongerTogether : UI.weakerTogether,
      big: pairName(odd.pair), pair: odd.pair, sub: UI.wrRank(pt(odd.wr), rank),
      note: UI.vsAvg2(up ? "+" : "−", Math.abs(odd.gap * 100).toFixed(1)),
      say: JA ? (up ? `意外と強いのが${pairName(odd.pair)}。最強ではありませんが、2色それぞれの平均より${Math.abs(odd.gap * 100).toFixed(1)}ポイント高く、組むと強くなる色です。`
                    : `意外と弱いのが${pairName(odd.pair)}。色だけ見ると悪くないのに、2色それぞれの平均より${Math.abs(odd.gap * 100).toFixed(1)}ポイント低い。組むと弱くなる色です。`)
              : (up ? `A quiet overperformer: ${pairName(odd.pair)}. Not the best pair, but ${Math.abs(odd.gap * 100).toFixed(1)} points above what its two colours average on their own. These colours are better together.`
                    : `A quiet underperformer: ${pairName(odd.pair)}. The colours look fine alone, but the pair is ${Math.abs(odd.gap * 100).toFixed(1)} points below their average. These colours are worse together.`)
    };
  }
  return null;   // 意外なことが無ければ、この場面は入れない
}
const pairName = p => [...p].map(c => CN[c] || c).join(JA ? "" : "-");

/* ------------------------------------------------------------ 台本 */

/* 各レアリティの1位の「どれくらい強いか」（2026年11月）。同じレアリティの平均との差で言い方を決める
   ・PICK_GAP 以上 … 迷わずピック　・MOVE_GAP 以上 … 色を合わせにいく価値あり　・それ未満 … 色が合えば優先
   コモン・アンコモンで伝説でないカードは「色が合うなら何枚でも」と添える（伝説は場に1枚しか置けないので言わない）。
   伝説かどうかは data/profiles/<SET>.json（下見ページのデータ）のタイプ行。分からないカードには添えない */
const PICK_GAP = 0.05, MOVE_GAP = 0.03;
function cardVerdict(c, avg, { rarity, legend, rareAvg }){
  if(avg == null) return null;
  const gap = c.gih - avg;
  const key = gap >= PICK_GAP ? "pick" : gap >= MOVE_GAP ? "move" : "take";
  const bomb = rarity !== "rare" && isBombLevel(c.gih, rareAvg);
  const any = rarity !== "rare" && legend && legend.get(c.name) === false;
  return { gap: (gap * 100).toFixed(1), key, bomb, any };
}
function verdictSay(v, label){
  if(!v) return "";
  if(JA){
    const tail = { pick: "迷わずピックの一枚です！", move: "色を合わせにいく価値ありです！", take: "色が合えば優先したい一枚です。" }[v.key];
    return `${label}の平均を${v.gap}ポイント${v.bomb ? "上回るボム級で" : "上回り"}、${tail}` + (v.any ? "色が合うなら何枚でもOK。" : "");
  }
  const tail = { pick: " An easy first pick!", move: " Worth moving into its colour!", take: " Take it early in its colour." }[v.key];
  return ` That's ${v.gap} points above the average ${label}${v.bomb ? " — bomb-level" : ""}.` + tail + (v.any ? " Play as many as you get." : "");
}
function buildScript(d, nameJa, names, avgs = {}, legend = null){
  const rareAvg = avgs.rare || null;
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
  const solidPairs = pairs.filter(p => p.games >= Math.max(2000 * MINP, totalPairGames * 0.04));
  const worst = (solidPairs.length ? solidPairs : pairs).slice().sort((a, b) => a.wr - b.wr)[0];
  // 狙い目（ドラフトだけ）：最強ではないが勝率が最強に近く（−1.5pt 以内）、使う人が平均より少ない組み合わせ。
  // 人気の色はカードの取り合いになるので、勝率が高くて空いている色を勧める
  //   まず「最強に近い（−1.5pt 以内）かつ使用率が平均の 80% 以下」を探し、無ければ長尺と同じゆるい決まり
  //  （全体の平均勝率 −0.5pt 以上、使用率が平均の 85% 以下、最強・最弱以外）で探す。それでも無ければ出さない
  let target = null;
  if((MODE === "draft" || EARLY) && best && pairs.length >= 4){
    const avgShare = 1 / pairs.length;
    const avgWr = pairs.reduce((n, p) => n + p.wr * p.games, 0) / (totalPairGames || 1);
    const pick = cand => { if(!cand.length) return; const c = cand.sort((a, b) => b.wr - a.wr || a.games - b.games)[0]; target = { ...c, share: c.games / totalPairGames, rank: pairs.indexOf(c) + 1, avgShare }; };
    pick(pairs.filter(p => p !== best && p.games >= 2000 * MINP && p.wr >= best.wr - 0.015 && p.games / totalPairGames <= avgShare * 0.8));
    if(!target) pick(pairs.filter(p => p !== best && p !== worst && p.games >= 1500 * MINP && p.wr >= avgWr - 0.005 && p.games / totalPairGames <= avgShare * 0.85));
    //   それも無く、最強そのものが平均より使われていなければ、最強を「狙い目でもある」として言う
    if(!target && best.games / totalPairGames <= avgShare * 0.9){ pick([best]); target.isBest = true; }
    //   最後の手：平均より使われていない組み合わせのうち、いちばん勝率が高いもの（最弱は除く）
    if(!target) pick(pairs.filter(p => p !== best && p !== worst && p.games >= 1500 * MINP && p.games / totalPairGames < avgShare));
  }
  const top3 = list => (list || []).slice(0, 3)
    .map(c => ({ ...c, label: JA ? ((names.names || {})[c.name] || c.name) : c.name, img: JA ? (names.images || {})[c.name] : (c.imgEn || null), outside: (names.outside || {})[c.name] || null }));
  const commons = top3(d.top && d.top.common), uncommons = top3(d.top && d.top.uncommon);
  // ティア表：試合数が少なすぎる組み合わせ（全体の 1% 未満）は除き、最強〜最弱の幅のどこにいるかで S/A/B/C に分ける
  //（上から 15% 以内が S、45% 以内が A、75% 以内が B、残りが C。幅が 2pt 未満の環境では 2pt として見る）
  const tierPairs = pairs.filter(p => p.games >= Math.max(1000 * MINP, totalPairGames * 0.01));
  const tiers = { S: [], A: [], B: [], C: [] };
  if(tierPairs.length){
    const topWr = tierPairs[0].wr, range = Math.max(0.02, topWr - tierPairs[tierPairs.length - 1].wr);
    for(const p of tierPairs){ const f = (topWr - p.wr) / range; (f <= 0.15 ? tiers.S : f <= 0.45 ? tiers.A : f <= 0.75 ? tiers.B : tiers.C).push(p); }
  }
  // ボム：レアと神話レアを合わせて勝率順に 6 枚（3 枚ずつ 2 画面。5 枚ずつだと画像が小さくて見にくいため、2026年10月に変更）
  const bombs = [...(d.top && d.top.rare || []), ...(d.top && d.top.mythic || [])]
    .map(c => ({ ...c, rarity: c.rarity || ((d.top.mythic || []).some(m => m.name === c.name) ? "mythic" : "rare") }))
    .sort((a, b) => b.gih - a.gih).slice(0, 6)
    .map(c => ({ ...c, label: JA ? ((names.names || {})[c.name] || c.name) : c.name, img: JA ? (names.images || {})[c.name] : (c.imgEn || null), outside: (names.outside || {})[c.name] || null }));
  // 「意外な事実」（surprise）は 2026年10月から使っていない
  const games = man(d.total_games);
  // セットの外から入る特別枠（スペシャルゲストなど）のカードが画面に出るときは、一言添える（めったに出ないカードなので）
  const outsideNote = (cards, from = 1) => {
    const o = cards.map((c, i) => ({ ...c, rank: from + i })).filter(c => c.outside);
    if(!o.length) return "";
    const spg = o.every(c => c.outside === "spg");
    return JA ? `${o.map(c => `${c.rank}位の${c.label}`).join("と")}は、${spg ? "スペシャルゲストという" : "セットの外から入る"}特別枠のカードで、パックからはめったに出ません。`
              : ` ${o.map(c => `No. ${c.rank}, ${c.name},`).join(" and ")} ${o.length > 1 ? "are" : "is"} ${spg ? (o.length > 1 ? "Special Guests" : "a Special Guest") : "from a bonus slot outside the main set"}, so you'll rarely open ${o.length > 1 ? "them" : "it"}.`;
  };

  const scenes = [];
  const gamesEn = d.total_games >= 10000 ? Math.round(d.total_games / 1000) + " thousand" : manSay(d.total_games);
  scenes.push({ kind: "hook", art: true,
    // 最初の一言で「誰のための、何の動画か」を短く言う（2026年10月：「マジック：ザ・ギャザリングの〜」から始めると長く、冒頭がもたつくため短くした）
    // 何試合のデータかも、セリフで言う（数字の裏付けが伝わるように）
    // 速報は、サムネイルで言い切った答え（最強の組み合わせと勝率）を、冒頭のセリフでもそのまま言う（2026年10月：動画に入ると情報が減って見えるため）
    // 2026年11月：速報も修正版と同じく、冒頭は「何の動画か」だけにした（いきなり答えを言うと、初めて見る人が置いていかれるため）。
    //   答え（最強の組み合わせと勝率）は、色の組み合わせの場面で言う
    say: EARLY
      ? (JA ? `MTGアリーナ、${nameJa}のリミテッド速報。${games}試合を分析して、勝てる色の組み合わせと、引けた試合の勝率が高いカードを解説します。`
            : `${nameJa} Limited on MTG Arena, an early look. We analyzed ${gamesEn} games: the colour pairs that win, and the cards with the best win rate when drawn.`)
      : JA ? `MTGアリーナ、${nameJa}の${EARLY ? "リミテッド" : d.mode === "sealed" ? "シールド" : "ドラフト"}環境を知りたい方に。${games}試合のデータを1分でまとめました。`
            : `Want to know ${/^the /i.test(nameJa) ? nameJa : "the " + nameJa} ${EARLY ? "Limited" : d.mode === "sealed" ? "Sealed" : "Draft"} format on MTG Arena? ${gamesEn} games of data in one minute.`,
    title: nameJa, games, isSealed: d.mode === "sealed", early: EARLY,
    ...(EARLY ? { gamesLabel: games, ribbon: UI.earlyHookC, d3: UI.earlyHookD3 } : {}),   // 速報の冒頭の画面（trendHookInner）
    // YouTube 用サムネイルの見出し（thumbSvg）。最強の組み合わせを言い切る形。狙い目は差し替え用（thumbnail-alt.jpg）に
    thumb: best ? { l1: JA ? `${pairName(best.pair)}が` : pairName(best.pair), l2: JA ? "最強！" : "is the best!",
                    sub: JA ? `${games}試合で勝率${pt(best.wr)}%` : `${pt(best.wr)}% win rate over ${d.total_games >= 10000 ? Math.round(d.total_games / 10000) * 10 + "K" : manSay(d.total_games)} games` } : null,
    thumbAlt: target && !target.isBest ? { l1: JA ? `${pairName(target.pair)}が` : pairName(target.pair), l2: JA ? "狙い目！" : "is the sleeper!",
                    sub: JA ? `勝率${target.rank}位なのに使う人が少ない` : `#${target.rank} by win rate, yet under-drafted` } : null });

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
      // 2026年10月：ショートが1分を超えたので、読み点を減らして短く
      say: JA ? `環境は${paceWord}です。平均マナ総量${bestBand}のデッキが一番勝っています。`
              : `The format is ${paceWord.toLowerCase()}. Decks averaging ${bestBand} mana win the most.`,
      paceWord, tail: 0.6,
      rows: pace.map((s, i) => ({ label: i === 0 ? UI.under(s.max) : s.max ? UI.between(pace[i - 1].max, s.max) : UI.over(pace[i - 1].max), wr: s.wr })),
      headline: paceKey === "lean-fast" ? UI.lighter : paceKey === "lean-slow" ? UI.heavier
              : (paceKey === "fast" || paceKey === "slow") && spread >= 1 ? (faster ? UI.light(spread.toFixed(1).replace(/\.0$/, "")) : UI.heavy(spread.toFixed(1).replace(/\.0$/, "")))
              : UI.noCurve });
  }


  // 「リミテッドとは」の前置きは入れない（見にくる人は知っているので、ここで離れてしまう。2026年10月の視聴データから）
  // 速さ → 色の組み合わせのティア表（＋狙い目）→（速報：登録と高評価のお願い）→ レア・神話レアのボム → コモン・アンコモン →（旧版だけ：登録のお願い）
  if(colors.length && best){
    const top2 = colors.slice(0, 2).map(c => CN[c.color]).join(JA ? "と" : " and ");
    const sNames = tiers.S.slice(0, 3).map(p => pairName(p.pair));   // 読むのは 3 つまで
    // 「ティア表です」は画面の見出しで分かるので言わない（2026年10月：ショートが1分を超えたため短く）
    // 最強の組み合わせと勝率は、ここで言う（2026年11月から。速報の冒頭では言わなくなったため。サムネイルの答えもここで回収する）
    const others = sNames.filter(n => n !== pairName(best.pair));
    let say = JA ? `色の組み合わせは、${pairName(best.pair)}が最強で、勝率${pt(best.wr)}パーセント。${others.length ? `Sティアはほかに${others.join("と")}。` : ""}`
                 : `Colour pairs: ${pairName(best.pair)} is the best, at ${pt(best.wr)} percent.${others.length ? ` Also S tier: ${others.join(" and ")}.` : ""}`;
    say += worst && worst !== best ? (JA ? `最弱は${pairName(worst.pair)}です。` : ` The weakest is ${pairName(worst.pair)}.`) : "";
    const worstShown = worst && worst !== best ? worst : null;
    scenes.push({ kind: "tier", say, colors, tiers, best, worst: worstShown, tail: 0.6 });
    // 狙い目（ドラフトだけ）：同じティア表の上で、その組み合わせを光らせて言う（場面は続きなので、画面は切り替えない）
    if(target){
      const sh = Math.round(target.share * 100), av = Math.round(target.avgShare * 100);
      scenes.push({ kind: "tier", colors, tiers, best, worst: worstShown, nofade: true, tail: 0.6,
        pick: { pair: target.pair, note: UI.share(sh, av, target.rank) },
        say: target.isBest
          ? (JA ? `狙い目は、最強の${pairName(target.pair)}そのもの。勝率1位なのに使う人が少ない、穴場の色です。`
                : `The pick to aim for is the best pair itself, ${pairName(target.pair)}. Number one, yet under-drafted.`)
          : (JA ? `狙い目は${pairName(target.pair)}。勝率${target.rank}位なのに使う人が少ない、穴場の色です。`
                : `The pick to aim for: ${pairName(target.pair)}. Number ${target.rank} by win rate, yet under-drafted.`) });
    }
  }
  // 途中で一度だけ、登録と高評価のお願い（速報）。色の組み合わせのあと、カードの話の前に挟む。締めのお願いはやめた
  //   （2026年11月：締めの数秒で見るのをやめる人が多く、登録のお願いの無いタルコフの動画でも登録が付いていたため）
  if(EARLY) scenes.push(ctaScene(JA ? "カード評価を見る前に、" : "Before the cards, "));
  // レア・神話レアはトップ3だけ（2026年11月から、画面・セリフとも「ボム」ではなくレアリティの名前で呼ぶ）。1位を大きく映す場面と、2・3位の2枚の場面に分ける（2026年11月：3枚並びはスマホで読めず、4〜6位は割愛）
  if(bombs.length){
    const three = bombs.slice(0, 3).map((c, i) => ({ ...c, rank: i + 1 })), c0 = three[0], rest = three.slice(1);
    const base = { kind: "cardPick", metric: "wr", cards: three, label: "bombs", rare: true, chapter: UI.cardCh.bombs, heading: UI.cardH.bombs };
    c0.verdict = cardVerdict(c0, rareAvg, { rarity: "rare", legend, rareAvg }); c0.avgLabel = UI.rareLabel;
    scenes.push({ ...base, part: "focus", tail: rest.length ? 0.3 : 0.8, minDur: 4,
      say: (JA ? `${EARLY ? "さて、" : ""}レア・神話レアのトップ3。引けた試合の勝率の1位は${c0.label}、${pt(c0.gih)}パーセント。`
               : `${EARLY ? "Now, the" : "The"} top three rares and mythics. Number one in win rate when drawn: ${c0.name}, at ${pt(c0.gih)} percent.`)
           + verdictSay(c0.verdict, UI.rareLabel) + outsideNote([c0], 1) });
    if(rest.length) scenes.push({ ...base, part: "rest", tail: 0.8, minDur: 3,
      say: (JA ? `${rest.map(c => c.label).join("と")}も迷わずピックです。` : `${rest.map(c => c.name).join(" and ")} ${rest.length > 1 ? "are" : "is a"} first-pick${rest.length > 1 ? "s" : ""} too.`) + outsideNote(rest, 2) });
  }

  // アンコモン・コモンのトップ3も、1位を大きく映す場面と、2・3位の2枚の場面に分ける（2026年11月）。
  //   1位は、同じレアリティの平均より何ポイント高いか・どう扱うカードか（cardVerdict）まで言う。2・3位は名前だけ（ボム級なら一言）
  const topScene = (list, label, opt = {}) => {
    if(!list.length) return;
    const cards = list.map((c, i) => ({ ...c, rank: i + 1 })), c0 = cards[0], rest = cards.slice(1);
    cards.forEach(c => { if(isBombLevel(c.gih, rareAvg)) c.bomb = true; });
    c0.verdict = cardVerdict(c0, avgs[opt.rarity], { rarity: opt.rarity, legend, rareAvg }); c0.avgLabel = label;
    const base = { kind: "cardPick", metric: "wr", cards, label: `top-${opt.rarity}`, chapter: UI.cardCh[opt.rarity], heading: UI.cardH.other };
    scenes.push({ ...base, part: "focus", tail: rest.length ? 0.3 : (opt.tail || 1.0), minDur: 4,
      say: (JA ? `${label}のトップ3。引けた試合の勝率の1位は${c0.label}、${pt(c0.gih)}パーセント${c0.verdict ? "。" : "です。"}`
               : `Top three ${label}s. Number one in win rate when drawn: ${c0.name}, at ${pt(c0.gih)} percent.`) + verdictSay(c0.verdict, label) + outsideNote([c0], 1) });
    if(!rest.length) return;
    const rb = rest.filter(c => c.bomb);
    scenes.push({ ...base, part: "rest", tail: opt.tail || 1.0, minDur: 3,
      say: (JA ? (rb.length === rest.length
                 ? `${rest.map(c => `${c.rank}位の${c.label}`).join("、")}も、レアの平均を超えるボム級です。`
                 : `2位は${rest[0].label}${rest[1] ? `、3位は${rest[1].label}` : ""}です。${rb.length ? `${rb.map(c => c.label).join("と")}もボム級です。` : ""}`)
               : (rb.length === rest.length ? `${rest.map(c => c.name).join(" and ")} are bomb-level too.`
                 : `Then ${rest.map(c => c.name).join(" and ")}.${rb.length ? ` ${rb.map(c => c.name).join(" and ")} ${rb.length > 1 ? "are" : "is"} bomb-level too.` : ""}`)) + outsideNote(rest, 2) });
  };
  // ボム（レア・神話レア）→ アンコモン → コモンの順（レアリティの高い順。2026年10月に入れ替え）
  topScene(uncommons, UI.uncommon, { rarity: "uncommon" });
  topScene(commons, UI.common, { rarity: "common" });   // 2026年10月：コモンにも一言が入ってセリフが長くなったので、読み終わりの間を 3 秒 → ふつう（1 秒）に戻した

  // 「意外な事実」の場面は入れない（2026年10月。狙い目はティア表で言う）

  // 締め：登録のお願いは、離脱されないよう一言だけ・短く（2026年10月。以前の「序盤のデータなので順位は動きます」の断り書きと、
  //   長めの登録のお願いで、FRA の速報ショートの終盤に離脱が集中した）。登録する理由は一言だけ
  if(EARLY) scenes.push(byeScene());   // 速報の締めは、登録のお願いではなく一言だけ（2026年11月）
  if(!EARLY) scenes.push({ kind: "outro", art: true,   // 速報は締めのお願いをしない（途中の ctaScene で言う）。旧版のショートだけ締めで言う
    // 登録する理由を一言だけ添える（速報は「詳しい解説」、通常版は「次のセット」）
    // 2026年11月：締めの4秒で見るのをやめる人が多かったので、セリフは一言だけにし、登録ボタンを押す動き（popLayer）で2秒ほどに収める
    say: JA ? `チャンネル登録もぜひ！` : `Subscribe!`,
    site: SITE, tail: 0.2, minDur: 1.9 });
  return scenes;
}

/* ------------------------------------------------------------ 画面 */

const T = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 44}" fill="${o.fill || PAPER}" font-weight="${o.weight || 400}"` +
  `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.op != null ? ` opacity="${o.op}"` : ""}>${esc(s)}</text>`;

/* 縁取り付きの大きな文字（背景の絵と混ざらないように、黒い縁を付ける） */
const TS = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 100}" fill="${o.fill || "#FFFFFF"}" font-weight="900" text-anchor="middle"` +
  ` stroke="${o.stroke || "#06101C"}" stroke-width="${o.sw || Math.round((o.size || 100) * 0.16)}" stroke-linejoin="round" paint-order="stroke">${esc(s)}</text>`;

/* 字幕。句読点で折り返し、数字・英字のかたまりは途中で切らない */
/* カード名を最大2行に折る（英語は単語で、日本語は文字数で） */
function wrapName(name, n){
  const t = String(name);
  if(!JA){
    const words = t.split(/\s+/), out = []; let cur = "";
    for(const w of words){ if(cur && (cur + " " + w).length > n){ out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    if(cur) out.push(cur);
    if(out.length > 2){ out[1] = out.slice(1).join(" "); out.length = 2; }
    return out;
  }
  const ch = [...t];
  if(ch.length <= n) return [t];
  // 「、」「・」があればそこで折る（「だんまり忍び足、ゴラム」→「だんまり忍び足、」「ゴラム」）
  const brk = Math.max(t.lastIndexOf("、", n), t.lastIndexOf("・", n));
  if(brk >= 2 && ch.length - brk - 1 <= n) return [ch.slice(0, brk + 1).join(""), ch.slice(brk + 1).join("")];
  return [ch.slice(0, n).join(""), ch.slice(n).join("")];
}
function wrap(s, n = 18, all = false){   // all: 5 行で切らずに全部の行を返す（入りきるかを調べるため）
  if(!JA){
    // 英語は単語で折り返す（1行 38 文字ほど）
    const words = s.split(/\s+/).filter(Boolean);
    const fit = n => { const out = []; let cur = ""; for(const w of words){ if(cur && (cur + " " + w).length > n){ out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; } if(cur) out.push(cur); return out; };
    let out = fit(32);
    if(out.length > 5) out = fit(38);        // 5 行に入らないときは 1 行を長くする（5 行のときは字も小さくなる）
    return all ? out : out.slice(0, 5);
  }
  // 日本語は「、」「。」で区切った句を単位にして行に詰める（カード名や数字が行の途中で切れないように）。
  // 1 句が長すぎるときだけ、数字・英字のかたまりを壊さない位置で切る
  const clauses = s.split(/(?<=[、。])/).filter(Boolean)
    .reduce((acc, cl) => { if(acc.length && /^[0-9０-９][0-9０-９.,]*%/.test(cl)) acc[acc.length - 1] += cl; else acc.push(cl); return acc; }, []);   // 「〜、66.4%。」は前の句とつなげる（名前と数字を離さない）
  const splitLong = (cl, m) => {
    // 助詞（より・と・で・は・が・を・に・も）の前で切れる位置があればそこで（「の」は名詞の途中になりやすいので使わない）、無ければ数字・英字を壊さない位置で切る
    const toks = cl.match(/[0-9０-９][0-9０-９.,%]*|[A-Za-z][A-Za-z0-9.\-]*|[^0-9０-９A-Za-z]/g) || [];
    const out = []; let cur = "";
    const flush = () => { if(cur){ out.push(cur); cur = ""; } };
    let i = 0;
    while(i < toks.length){
      const t = toks[i];
      if(cur && [...cur].length + [...t].length > m){
        // 行の後半（40% 以降）にある助詞の前まで戻って切る
        const chars = [...cur]; let cut = -1;
        for(let k = chars.length - 1; k >= Math.floor(m * 0.4); k--){
          const rest = chars.slice(k).join("");
          if(/^(より|と|で|は|が|を|に|も)/.test(rest)){ cut = k; break; }
        }
        if(cut > 0){ out.push(chars.slice(0, cut).join("")); cur = chars.slice(cut).join(""); } else flush();
      }
      cur += t; i++;
    }
    flush();
    return out;
  };
  const fit = m => {
    const out = []; let cur = "";
    for(const cl of clauses){
      const L = [...cl].length;
      if(L > m){ if(cur){ out.push(cur); cur = ""; } const parts = splitLong(cl, m); out.push(...parts.slice(0, -1)); cur = parts[parts.length - 1]; continue; }
      if(cur && [...cur].length + L > m){ out.push(cur); cur = cl; } else cur += cl;
    }
    if(cur) out.push(cur);
    return out;
  };
  let out = fit(n);
  if(out.length > 5) out = fit(n + 2);        // 5 行に入らないときは 1 行を少し長く（5 行のときは字も小さくなる）
  return all ? out : out.slice(0, 5);
}
/* 字幕が 5 行に入らないセリフは、文の切れ目で場面を2つ以上に分ける（画面は同じまま、字幕だけ送る。字幕が途中で切れないように）。
   見せる時間（minDur）と読み終わりの間（tail）は、最後の場面に残す */
function splitLongScenes(scenes){
  const capText = t => String(t).replace(/パーセント/g, "%").replace(/ percent/g, "%");
  const fits = t => wrap(capText(t), 18, true).length <= 5;
  const out = [];
  for(const sc of scenes){
    if(!sc.say || sc.kind === "hook" || fits(sc.say)){ out.push(sc); continue; }
    const sents = sc.say.split(JA ? /(?<=。)/ : /(?<=[.!?])\s+/).filter(Boolean);
    const parts = []; let cur = "";
    for(const s of sents){ const t = cur ? cur + (JA ? "" : " ") + s : s; if(cur && !fits(t)){ parts.push(cur); cur = s; } else cur = t; }
    if(cur) parts.push(cur);
    // 画面の配置（行の高さ）は字幕の高さで決まるので、いちばん長い字幕に合わせてそろえる（分けた場面のあいだで、カードが動かないように）
    const layoutSay = parts.slice().sort((a, b) => wrap(capText(b), 18, true).length - wrap(capText(a), 18, true).length)[0];
    parts.forEach((p, i) => out.push({ ...sc, say: p, layoutSay, minDur: 0, ...(i ? { nofade: true } : {}), ...(i < parts.length - 1 ? { tail: 0.15 } : {}) }));   // 分けたら、読み上げの合計で十分見せられるので最低の長さは付けない
  }
  return out;
}
/* YouTube Shorts は下 20% 弱にタイトルやボタンが重なるので、字幕はその上に置く */
const SAFE_BOTTOM = 230;   // 2026年10月：270 → 230 に下げて、上の情報を大きくした（下 12% ほどは題名の帯に重なりうる）
const BOMB_CAP_BOTTOM = 170;   // ボムの場面だけ、字幕の枠をここまで下げる（カードを大きく見せるため。YouTube の題名の帯に少しかかる）
/* 登録ボタン（動きを付けて重ねる層）。幅 640・高さ 130。右はしのキャラクターにかからない位置（x=100）に置く */
function subscribeButton(){
  return `<rect x="0" y="0" width="640" height="130" rx="65" fill="#E53935" stroke="#FFFFFF" stroke-width="6"/>` +
         T(320, 86, UI.subscribe, { size: 60, weight: 900, anchor: "middle", fill: "#FFFFFF" });
}
function popSvg(inner, w, h){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SCALE}" height="${h * SCALE}" viewBox="0 0 ${w} ${h}" font-family="${FONT}"><g>${inner}</g></svg>`;
}
/* 途中に挟む「登録と高評価のお願い」の場面（速報・修正版）。セリフは一言、登録ボタンを押す動き（popLayer）つきで3秒弱 */
/* 締めの一言（速報・修正版）。登録のお願いは途中で言っているので、ここは見てくれた人への一言だけ・2秒ほど（2026年11月） */
function byeScene(){
  return { kind: "bye", art: true, say: UI.bye, tail: 0.3, minDur: 1.8 };   // 「MTGアリーナで」は言わず、画面のロゴで見せる（2秒ほどに収めるため）
}
/* lead … 前置き（例：「レアリティ別のカード評価を見る前に、」）。いきなりお願いすると唐突なので、次の話の前の一息として言う */
function ctaScene(lead = ""){
  return { kind: "cta", art: true, lead, say: lead + (JA ? "チャンネル登録と高評価もぜひ！" : "like and subscribe!"), tail: 0.2, minDur: 1.9 };
}
/* 場面に重ねる「動く層」の並び。{ svg, w, h, x, y, enable? }。x・y は ffmpeg の式（t は場面の頭からの秒。式の中のカンマは \, と書く）、
   enable は出しておく時間（ffmpeg の式。省くとずっと）
   締め（outro）：登録ボタンが下から浮き上がる → 指が来て押す → 「登録済み」に変わり、ベルが揺れる（2秒ほど。2026年11月：
   締めの4秒で見るのをやめる人が多かったので、セリフを短くし、押すところを見せて短い時間で伝える） */
const PRESS = 0.7;   // 動きが始まってから、指がボタンを押すまでの秒
function popLayer(sc){
  if(sc.kind !== "outro" && sc.kind !== "cta") return null;
  // 前置き（「〜を見る前に」）があるときは、「チャンネル登録」と言い始めるころに動きを始める（文字数の割合で見積もる）
  const D = sc.lead && sc.dur ? Math.max(0, sc.dur * sc.lead.length / sc.say.length - 0.15) : 0;
  const t = `(t-${D.toFixed(2)})`;                                                    // 動きの時計（ffmpeg の式の t を D 秒ずらす）
  const bx = W / 2 - 320, by = 900;
  const done = `<rect x="0" y="0" width="640" height="130" rx="65" fill="#3A4450" stroke="#FFFFFF" stroke-width="6"/>` +
               T(320, 86, UI.subscribed, { size: 58, weight: 900, anchor: "middle", fill: "#FFFFFF" });
  const hand = `<path d="M30 6 C36 6 40 10 40 16 L40 52 L46 48 C52 44 60 46 62 52 L66 62 C70 60 78 62 80 68 L82 74 C86 72 94 74 96 82 L104 124 C108 142 98 160 80 164 L58 168 C42 170 28 162 20 148 L4 110 C0 102 6 94 14 96 L22 98 L20 16 C20 10 24 6 30 6 Z" fill="#FFFFFF" stroke="#06101C" stroke-width="7" stroke-linejoin="round"/>`;
  const bell = `<path d="M50 10 C30 10 20 26 20 46 L20 70 L10 84 L90 84 L80 70 L80 46 C80 26 70 10 50 10 Z" fill="#FFD23F" stroke="#06101C" stroke-width="6" stroke-linejoin="round"/>` +
               `<circle cx="50" cy="94" r="10" fill="#FFD23F" stroke="#06101C" stroke-width="6"/>`;
  const hx0 = bx + 760, hy0 = by + 520, hx1 = bx + 430, hy1 = by + 60;            // 指は右下から来て、ボタンの右寄りを押す
  const move = `min(1\\,max(0\\,(${t}-0.25)/${(PRESS - 0.25).toFixed(2)}))`;
  const P = PRESS, Q = PRESS + 0.12, B = PRESS + 0.15;
  return [
    { svg: popSvg(subscribeButton(), 640, 130), w: 640, h: 130, x: `${bx}`, y: `${by}+60*max(0\\,1-${t}*4)+8*between(${t}\\,${P}\\,${Q})`, enable: `gte(${t},0)*lt(${t},${Q})` },
    { svg: popSvg(done, 640, 130), w: 640, h: 130, x: `${bx}`, y: `${by}`, enable: `gte(${t},${Q})` },
    { svg: popSvg(bell, 100, 110), w: 100, h: 110, x: `${bx + 660}`, y: `${by + 10}-10*abs(sin(14*(${t}-${B})))*max(0\\,1-(${t}-${B})*1.6)`, enable: `gte(${t},${B})` },
    { svg: popSvg(hand, 110, 175), w: 110, h: 175, x: `${hx0}+(${hx1 - hx0})*${move}`, y: `${hy0}+(${hy1 - hy0})*${move}+10*between(${t}\\,${P}\\,${Q})`, enable: `between(${t},0.2,${P + 0.55})` }
  ];
}

/* 字幕の枠の上端（場面の図をその上に収めるため） */
function captionTop(say, bottom = SAFE_BOTTOM){
  const lines = wrap(say.replace(/パーセント/g, "%").replace(/ percent/g, "%"));
  const lh = lines.length >= 5 ? 60 : 70;
  return H - bottom - 40 - (lines.length * lh + 64);
}
function caption(say, bottom = SAFE_BOTTOM){
  const lines = wrap(say.replace(/パーセント/g, "%").replace(/ percent/g, "%"));
  // 5 行のとき、または 1 行が長いとき（5 行に収めるため 1 行を長くしたとき）は少し小さくして、枠からはみ出さないようにする
  const wide = Math.max(...lines.map(l => units(l))) > 18;
  const fs = lines.length >= 5 || wide ? 44 : 50, lh = lines.length >= 5 ? 60 : 70;   // 5 行のときは少し詰めて、上のキャラクターに枠がかからないようにする
  const boxH = lines.length * lh + 64, y0 = H - bottom - 40 - boxH, x0 = 56, bw = W - 112;
  /* 1990年代のRPG風の青いメッセージウィンドウ（青のグラデーション＋白い二重の枠＋右下の送りカーソル）。ロゴや既存ゲームの素材は使わない */
  return `<defs><linearGradient id="ffw" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#2A4FC4"/><stop offset="1" stop-color="#0B1763"/></linearGradient></defs>` +
    `<rect x="${x0 + 6}" y="${y0 + 8}" width="${bw}" height="${boxH}" rx="18" fill="#000" opacity="0.45"/>` +
    `<rect x="${x0}" y="${y0}" width="${bw}" height="${boxH}" rx="18" fill="url(#ffw)" stroke="#F4F7FF" stroke-width="6"/>` +
    `<rect x="${x0 + 12}" y="${y0 + 12}" width="${bw - 24}" height="${boxH - 24}" rx="10" fill="none" stroke="#8FA8F0" stroke-width="2" opacity="0.8"/>` +
    lines.map((l, i) => `<text x="${W / 2 + 3}" y="${y0 + 66 + i * lh + 3}" font-size="${fs}" fill="#050B33" font-weight="700" text-anchor="middle">${esc(l)}</text>` +
                        T(W / 2, y0 + 66 + i * lh, l, { size: fs, anchor: "middle", weight: 700 })).join("") +
    `<polygon points="${x0 + bw - 52},${y0 + boxH - 38} ${x0 + bw - 28},${y0 + boxH - 38} ${x0 + bw - 40},${y0 + boxH - 22}" fill="#F4F7FF"/>`;
}

/* 字幕の枠の右上に立たせるキャラクター。情報の表示に重ならないよう、画面の右はしの空いたところに小さく置く。
   日本語：ずんだもん（フード付き。short/zunda-hoodie/）。英語：四国めたん（赤い服・炎。short/metan/）。
   口（閉じ・半開き・開き）× 目（開き・閉じ）の6枚（<eye>_<mouth>.png）がそろっているときだけ出す。SHORT_ZUNDA=0 で出さない */
const ZDIR = JA
  ? ((process.env.SHORT_ZUNDA_STYLE !== "normal" && existsSync("short/zunda-hoodie/open_open.png")) ? "short/zunda-hoodie" : "short/zunda")
  : "short/metan";
const ZW = 240, ZH = 246;
const MASCOT_NAME = JA ? "ずんだもん" : "四国めたん";
async function zundaReady(){
  if(process.env.SHORT_ZUNDA === "0") return false;
  for(const e of ["open", "closed"]) for(const m of ["closed", "half", "open"])
    if(!(await readFile(`${ZDIR}/${e}_${m}.png`).then(() => true, () => false))) return false;
  return true;
}
/* 位置は全場面で同じ（右はしの、字幕の枠のすぐ上）。場面ごとに動くと落ち着かないため。
   この高さは、どの場面でも情報（色の一覧・カードの並び）より下で、いちばん行数の多い字幕の枠の上にほぼ収まる */
/* 文字を幅 w に収める大きさ（日本語は1字＝1、英数字は約0.58として数える）。最大 max */
const ZX = W - 24 - ZW;   // 右はしのキャラクターの左端。情報の文字はこれより左に収める
/* 文字の幅のめやす（全角 1、半角 0.58。フォントの大きさを掛けると px） */
function units(str){ return [...String(str)].reduce((n, ch) => n + (/[\x00-\x7F]/.test(ch) ? 0.58 : 1), 0); }
/* カードの勝率の札：紺の地に青い縁、「引けた試合の勝率」は小さく、数字は大きく金色で。背景の絵に埋もれないようにする。
   top は札の上端、maxW は使ってよい幅。返り値は SVG */
function gihBadge(x, top, v, maxW, size){
  const label = UI.gihL, num = `${v}%`, pad = 18, gap = 14;
  let ns = size, ls = Math.round(size * 0.6);
  const w0 = units(label) * ls + gap + units(num) * ns + pad * 2;
  if(w0 > maxW){ const f = maxW / w0; ns = Math.floor(ns * f); ls = Math.floor(ls * f); }
  const w = Math.round(units(label) * ls + gap + units(num) * ns + pad * 2), h = Math.round(ns * 1.4), base = top + Math.round(h * 0.72);
  return `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${Math.round(h / 2)}" fill="${DEEP}" fill-opacity="0.9" stroke="${BLUE}" stroke-width="4"/>` +
         T(x + pad, base, label, { size: ls, fill: "#CFE0F5", weight: 700 }) +
         T(x + pad + Math.round(units(label) * ls) + gap, base, num, { size: ns, fill: GOLD, weight: 900 });
}
function fitSize(str, w, max){
  const units = [...String(str)].reduce((n, ch) => n + (/[\x00-\x7F]/.test(ch) ? 0.58 : 1), 0);
  return Math.max(24, Math.min(max, Math.floor(w / Math.max(units, 1))));
}
function zundaPos(sc){
  if(sc && sc.kind === "hook" && (sc.trend || sc.early) && sc.thumb) return { x: 40, y: 1600 };   // 修正版・速報の冒頭：左下   // 修正版・速報の冒頭（サムネイルと同じ配置）：左下。見出しの文字と重ねない
  return { x: W - 24 - ZW, y: 1030 };   // 足もとが字幕の枠（最大 5 行）の上端にほぼ付く高さ
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
/* 修正版の章の札（「コモン編」など）と、その右の見出し。章が一目で分かるように大きく */
function chapterHead(chapter, heading, color = GOLD){
  const cs = JA ? 46 : 38, cw = Math.round([...String(chapter)].reduce((n, ch) => n + (/[A-Z]/.test(ch) ? 0.74 : units(ch)), 0) * cs) + 44;   // 英語の大文字（COMMONS など）は幅が広いので多めに見る
  const hs = Math.min(JA ? 34 : 28, Math.floor((ZX - 110 - cw) / Math.max(units(heading), 1)));
  return `<rect x="70" y="186" width="${cw}" height="66" rx="16" fill="${color}"/>` +
    T(70 + cw / 2, 186 + 33 + Math.round(cs * 0.36), chapter, { size: cs, weight: 900, anchor: "middle", fill: "#06101C" }) +
    T(70 + cw + 18, 186 + 33 + Math.round(hs * 0.36), heading, { size: hs, weight: 900, fill: PAPER });
}
const CH_Y0 = 272;   // 章の札があるときの、カードの並びの上端

/* 修正版のレアリティ別の場面（2026年11月から）。3枚並びでは、スマホでカードの絵も文字も読めなかったので、2つの場面に分けた
   ・focus：いちばん上がった1枚を大きく。下に名前と「▲ +1.3pt」、発売直後 → 最近 の勝率
   ・rest ：残りの2枚を左右に並べる（それぞれの下に名前と差）
   右下のキャラクター（x ${"$"}{ZX} より右、y 1030 より下）にかからないよう、文字は ZX より左に収める */
function cardImg(c, x, y, w, h){
  const cc = COLOR[(c.color || "")[0]] || MUTED;
  return `<rect x="${x + 6}" y="${y + 10}" width="${w}" height="${h}" rx="${Math.round(w * 0.045)}" fill="#000" opacity="0.45"/>` +
    (c.imgPath ? `<image href="${c.imgPath}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
               : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${cc}" opacity="0.85"/>`);
}
function trendHead(sc){
  return chapterHead(sc.chapter, sc.heading || (sc.dir === "up" ? UI.trendUpH : UI.trendDownH), sc.rare ? "#E0B13A" : GOLD);
}
const deltaText = c => `${c.delta >= 0 ? "▲ +" : "▼ −"}${(Math.abs(c.delta) * 100).toFixed(1)}pt`;
/* 勝率（速報・旧版の「トップ3」）の版：数字は引けた試合の勝率。順位を名前の前に、ボム級・平均との差を数字の右に */
function rankName(c){ return `${UI.rank(c.rank)} ${c.label}`; }
function pill(x, y, text, bg, fg, size){
  const w = Math.round(units(text) * size) + 36, h = Math.round(size * 1.55);
  return { w, svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${bg}"/>` + T(x + w / 2, y + Math.round(h / 2 + size * 0.36), text, { size, weight: 900, anchor: "middle", fill: fg }) };
}
function wrFocusInfo(c, L, R, ny, dy){
  let s = T(L, ny, UI.rank(c.rank), { size: JA ? 50 : 44, weight: 900, fill: GOLD });
  const rx = L + Math.round(units(UI.rank(c.rank)) * (JA ? 50 : 44)) + 18;
  s += T(rx, ny, c.label, { size: fitSize(c.label, R - rx, JA ? 58 : 50), weight: 900 });
  const wr = `${pt(c.gih)}%`, dz = 84, ax = L + Math.round(units(wr) * dz) + 30;
  s += T(L, dy, wr, { size: dz, weight: 900, fill: GOLD });
  const v = c.verdict;
  s += T(ax, dy - 10, UI.gihL, { size: fitSize(UI.gihL, R - ax, 40), fill: MUTED });
  if(!v) return s;
  // 同じレアリティの平均との差（1行）と、どう扱うカードか（迷わずピック／色を合わせる価値あり／色が合えば優先）・ボム級・何枚でもOK の札
  const note = UI.vsAvgOf(c.avgLabel, v.gap);
  s += T(L, dy + 64, note, { size: fitSize(note, R - L, JA ? 44 : 38), weight: 900, fill: UP });
  let px = L; const py = dy + 92, ps = JA ? 38 : 32;
  for(const [t, bg, fg] of [[UI.verdict[v.key], GOLD, DEEP], ...(v.bomb ? [[UI.bombLevel, DOWN, "#FFFFFF"]] : []), ...(v.any ? [[UI.anyCopies, UP, "#FFFFFF"]] : [])]){
    const p = pill(px, py, t, bg, fg, ps);
    if(px + p.w > R) break;
    s += p.svg; px += p.w + 14;
  }
  return s;
}
function trendFocusSvg(sc){
  // 余白：カードの下端 → 名前 84px、名前 → 差 108px、差 → 字幕の枠 56px 以上。カードはその範囲で最大 752px（幅 540px）
  const GAP_NAME = 84, GAP_DELTA = 108, GAP_CAP = 56;
  const c = sc.cards[0], col = c.delta >= 0 ? UP : DOWN, L = 80, R = ZX - 16, y = 292;
  const PILLS = sc.metric === "wr" && c.verdict ? 150 : (c.tags || []).length ? 84 : 0;   // 修正版は、上がり方の札（tags）を出すときに1行ぶん   // 勝率の版で、どう扱うかの札を出すときは、その1行ぶんカードを小さくする
  const h = Math.min(752, captionTop(sc.layoutSay || sc.say, BOMB_CAP_BOTTOM) - GAP_CAP - GAP_DELTA - GAP_NAME - PILLS - y), w = Math.round(h * 672 / 936), x = Math.round((W - w) / 2);
  let s = trendHead(sc) + cardImg(c, x, y, w, h);
  if(sc.metric === "wr") return s + wrFocusInfo(c, L, R, y + h + GAP_NAME, y + h + GAP_NAME + GAP_DELTA);
  // 名前（1行。長ければ小さく）
  const ny = y + h + GAP_NAME;
  s += T(L, ny, c.label, { size: fitSize(c.label, R - L, JA ? 58 : 50), weight: 900 });
  // 差（大きく）と、その右に 発売直後 / 最近 の2行
  const dt = deltaText(c), dz = 84, dw = Math.round(units(dt) * dz), dy = ny + GAP_DELTA;
  s += T(L, dy, dt, { size: dz, weight: 900, fill: col });
  const a1 = `${UI.trendFirst} ${pt(c.first.gih)}%`, a2 = `${UI.trendLast} ${pt(c.last.gih)}%`, ax = L + dw + 30;
  const as = fitSize(units(a1) > units(a2) ? a1 : a2, R - ax, 40);
  s += T(ax, dy - as - 8, a1, { size: as, fill: MUTED }) + T(ax, dy + 4, a2, { size: as, weight: 900, fill: GOLD });
  // どういう上がり方か（さらに評価アップ・評価が逆転など。short-trend.mjs の noteOf）の札
  let px = L;
  for(const [i, t] of (c.tags || []).entries()){
    const p = pill(px, dy + 30, t, i === 0 ? GOLD : UP, i === 0 ? DEEP : "#FFFFFF", JA ? 38 : 32);
    if(px + p.w > R) break;
    s += p.svg; px += p.w + 14;
  }
  // 比べた平均（「最近のコモンの平均 56.4%」）。札の右に
  if(c.avgLine && px < R - 120) s += T(px + 6, dy + 30 + Math.round((JA ? 38 : 32) * 1.1), c.avgLine, { size: fitSize(c.avgLine, R - px - 6, 36), fill: "#C9D7E6" });
  return s;
}
/* 残りの2枚の位置（sceneSvg と highlightsOf で同じにする） */
function restCols(sc){
  const n = sc.cards.length - 1, cw = 400, gap = 40, ch = Math.round(cw * 936 / 672), y = 300;
  return sc.cards.slice(1).map((c, i) => ({ c, x: n === 1 ? Math.round((W - cw) / 2) : 80 + i * (cw + gap), y, w: cw, h: ch }));
}
function trendRestSvg(sc){
  let s = trendHead(sc);
  // 名前は、1行で 36px 以上に収まれば1行、収まらなければ2行に折る（勝率の版は順位を前に付ける）。
  // 数字の高さは、2枚のうち名前の行が多いほうに合わせてそろえる（左右で数字の高さがずれないように）
  const cols = restCols(sc).map(k => {
    const nm = sc.metric === "wr" ? rankName(k.c) : k.c.label;
    const one = fitSize(nm, k.w, JA ? 44 : 38);
    const lines = one >= 36 ? [nm] : wrapName(nm, JA ? 9 : 18).slice(0, 2);
    const size = lines.length === 1 ? one : Math.min(...lines.map(l => fitSize(l, k.w, JA ? 44 : 38)));
    return { ...k, lines, size };
  });
  const nameH = Math.max(...cols.map(k => (k.lines.length - 1) * (k.size + 6)));
  for(const { c, x, y, w, h, lines, size } of cols){
    s += cardImg(c, x, y, w, h);
    lines.forEach((l, j) => { s += T(x, y + h + 58 + j * (size + 6), l, { size, weight: 900 }); });
    const dy = y + h + 58 + nameH + 84;
    if(sc.metric === "wr"){
      s += T(x, dy, `${pt(c.gih)}%`, { size: 66, weight: 900, fill: GOLD });
      s += T(x, dy + 52, UI.gihL, { size: fitSize(UI.gihL, w, 30), weight: 700, fill: MUTED });
      if(c.bomb) s += pill(x, dy + 76, UI.bombLevel, DOWN, "#FFFFFF", JA ? 32 : 28).svg;
      continue;
    }
    s += T(x, dy, deltaText(c), { size: 66, weight: 900, fill: c.delta >= 0 ? UP : DOWN });
    const a = `${pt(c.first.gih)}% → ${pt(c.last.gih)}%`;
    s += T(x, dy + 52, a, { size: fitSize(a, w, 34), weight: 700, fill: MUTED });
  }
  return s;
}
/* 修正版の組み合わせの場面の行（sceneSvg と highlightsOf で同じ位置にするため） */
const PAIR_Y0 = 318;
const pairRow = sc => Math.min(96, Math.floor((captionTop(sc.layoutSay || sc.say) - 24 - PAIR_Y0) / sc.pairs.length));
/* 画面の枠。サイト名やドメインは常時表示しない（締めの場面で音声つきで案内するので、それ以外はうるさくなる）。
   代わりに、冒頭以外の場面では上部にセットのロゴ（無ければセット名）と「リミテッド環境分析」を常に出し、
   途中から見た人にも何のセットの話か分かるようにする */
/* 長いセット名（例「マジック：ザ・ギャザリング｜マーベル スーパー・ヒーローズ」）は「｜」や「:」の後ろだけにする */
function shortName(n){
  const m = String(n).replace(/^Magic:\s*The Gathering\s*[:|｜-]?\s*/i, "").split(/\s*[｜|]\s*/);
  return (m[m.length - 1] || "").trim() || String(n);
}
const HEADER = { logo: null, title: "", arena: null };   // arena：MTGアリーナのロゴ（締めの一言の場面で使う）
function header(){
  const band = HAS_BG ? `<rect x="40" y="30" width="${W - 80}" height="146" rx="24" fill="${DEEP}" opacity="0.6"/>` : "";
  if(HEADER.logo){
    return band +
      `<image href="${HEADER.logo}" x="64" y="44" width="330" height="118" preserveAspectRatio="xMinYMid meet"/>` +
      T(424, 122, UI.analysis, { size: 40, fill: MUTED, weight: 700 });
  }
  const n = [...HEADER.title].length;
  return band +
    T(64, 122, HEADER.title, { size: Math.max(26, Math.min(56, Math.floor(520 / Math.max(1, n * (JA ? 1 : 0.6))))), fill: BLUE, weight: 900 }) +
    T(W - 64, 122, UI.analysis, { size: 36, fill: MUTED, weight: 700, anchor: "end" });
}
function frame(inner, say, opts = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PINE}"/><stop offset="1" stop-color="${DEEP}"/></linearGradient></defs>
  ${HAS_BG ? "" : `<rect width="${W}" height="${H}" fill="url(#bg)"/>`}
  ${opts.header === false ? "" : header()}
  ${inner}
  ${say ? caption(say, opts.capBottom) : ""}
</svg>`;
}

/* YouTube 用のサムネイル（冒頭の場面とは別に作る）。
   ショートの一覧（グリッド）では上下が切れ、下部に題名が重なるので、大事なものは縦 18%〜72% の帯に収める。
   セットのロゴ（short/logo/<SET>.png）があればそれを主役に、無ければセット名の文字。 */
function thumbSvg(hook, alt = false){ return frame(thumbInner(hook, alt), null, { header: false }); }
/* サムネイルの中身。修正版では、動画の冒頭の場面にも同じものを使う（サムネイルと冒頭で情報をそろえる。char: false でキャラクターを描かない） */
/* 修正版の冒頭：アリーナとセットのロゴを上に、赤い帯「ドラフト環境の変化」、その下に「〇万試合を分析」と何を解説するか（セリフと同じ中身）。
   2026年11月：ロゴと帯だけでは画面がさっぱりしすぎていたので、情報を足し、アリーナのロゴを大きくした */
function trendHookInner(hook){
  let s = `<defs><linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050B14" stop-opacity="0"/><stop offset="0.08" stop-color="#050B14" stop-opacity="0.8"/><stop offset="0.92" stop-color="#050B14" stop-opacity="0.8"/><stop offset="1" stop-color="#050B14" stop-opacity="0"/></linearGradient></defs>` +
          `<rect x="0" y="250" width="${W}" height="1150" fill="url(#gh)"/>`;
  s += hook.arenaLogo ? `<image href="${hook.arenaLogo}" x="${W / 2 - 330}" y="300" width="660" height="232" preserveAspectRatio="xMidYMid meet"/>`
                      : T(W / 2, 450, UI.arena, { size: 96, weight: 900, anchor: "middle", fill: "#FFFFFF" });
  if(hook.logo) s += `<image href="${hook.logo}" x="110" y="550" width="860" height="280" preserveAspectRatio="xMidYMid meet"/>`;
  else{ const sz = Math.min(130, Math.floor(940 / (Math.max([...String(hook.title)].length, 4) * (JA ? 1 : 0.6)))); s += TS(W / 2, 730, hook.title, { size: sz, fill: "#FFFFFF" }); }
  const ribbon = hook.ribbon || (hook.thumb && hook.thumb.ribbon) || UI.trendHookC;
  const rs = Math.min(JA ? 100 : 78, Math.floor(940 / ([...ribbon].length * (JA ? 1 : 0.62)))), rw = Math.round([...ribbon].length * rs * (JA ? 1 : 0.62) + 90), rh = Math.round(rs * 1.7);
  const ry = 880;
  s += `<rect x="${(W - rw) / 2}" y="${ry}" width="${rw}" height="${rh}" rx="24" fill="#D9412B" stroke="#FFFFFF" stroke-width="7"/>` +
       T(W / 2, ry + Math.round(rh / 2 + rs * 0.36), ribbon, { size: rs, weight: 900, anchor: "middle", fill: "#FFFFFF" });
  // 「〇万試合を分析」（金色・大きく）と、何を解説するか（白）
  let y = ry + rh + 40;
  if(hook.gamesLabel){
    const g = UI.hookD1(hook.gamesLabel), gs = Math.min(120, Math.floor(960 / Math.max(units(g), 1)));
    y += gs; s += TS(W / 2, y, g, { size: gs, fill: "#FFD23F" }); y += 28;
  }
  const d2 = hook.d3 || UI.trendHookD3, ds = Math.min(66, Math.floor(980 / Math.max(units(d2), 1)));
  y += ds; s += TS(W / 2, y, d2, { size: ds, fill: "#FFFFFF" });
  // 下：このあと出る、上がったカード（サムネイルと同じ3枚を少し扇形に）。左下のキャラクターにはかけない
  const cards = (hook.thumbCards || []).filter(Boolean).slice(0, 3), CW = 280, CH = Math.round(CW * 936 / 672);
  cards.forEach((src, i) => {
    const x = 400 + i * 150, cy = 1440 + (i === 1 ? -14 : 16), rot = [-10, 0, 10][i];
    s += `<g transform="rotate(${rot} ${x + CW / 2} ${cy + CH / 2})"><rect x="${x + 6}" y="${cy + 10}" width="${CW}" height="${CH}" rx="14" fill="#000" opacity="0.45"/><image href="${src}" x="${x}" y="${cy}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid slice"/></g>`;
  });
  return s;
}
function thumbInner(hook, alt = false, { char = true } = {}){
  // 2026年10月：長尺のサムネイルと同じ考え方で作り直した（何の動画かを上に／答えを1つ、大きく言い切る／キャラクターとボムのカードは下に）
  //   大事なもの（ロゴ・帯・見出し・数字）は縦 340〜1380px（18%〜72%）の帯に収める。上下は一覧で切れる・題名が重なる前提で、絵だけを置く
  const TOP = 340, BOTTOM = 1380, th = (alt && hook.thumbAlt) || hook.thumb;
  let inner = `<defs><linearGradient id="gz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050B14" stop-opacity="0"/><stop offset="0.08" stop-color="#050B14" stop-opacity="0.82"/><stop offset="0.92" stop-color="#050B14" stop-opacity="0.82"/><stop offset="1" stop-color="#050B14" stop-opacity="0"/></linearGradient></defs>` +
    `<rect x="0" y="${TOP - 60}" width="${W}" height="${BOTTOM - TOP + 120}" fill="url(#gz)"/>`;
  // 下：ボムのカード（少し扇形）とキャラクター。帯の外なので、切れても困らない飾り
  const cards = (hook.thumbCards || []).filter(Boolean).slice(0, 3), CW = 300, CH = Math.round(CW * 680 / 488);
  cards.forEach((src, i) => {
    const x = 420 + i * 150, y = BOTTOM + 20 + (i === 1 ? -14 : 16), rot = [-10, 0, 10][i];
    inner += `<g transform="rotate(${rot} ${x + CW / 2} ${y + CH / 2})"><rect x="${x + 6}" y="${y + 10}" width="${CW}" height="${CH}" rx="14" fill="#000" opacity="0.45"/><image href="${src}" x="${x}" y="${y}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid slice"/></g>`;
  });
  if(char && hook.thumbChar) inner += `<image href="${hook.thumbChar.src}" x="-20" y="${H - Math.round(600 * hook.thumbChar.h / hook.thumbChar.w)}" width="600" height="${Math.round(600 * hook.thumbChar.h / hook.thumbChar.w)}"/>`;
  let y = TOP;
  // アリーナのロゴ
  inner += hook.arenaLogo ? `<image href="${hook.arenaLogo}" x="${W / 2 - 170}" y="${y}" width="340" height="110" preserveAspectRatio="xMidYMid meet"/>`
                          : T(W / 2, y + 80, UI.arena, { size: 56, weight: 900, anchor: "middle", fill: "#FFFFFF" });
  y += 118;
  // セットのロゴ、または名前
  if(hook.logo){ inner += `<image href="${hook.logo}" x="150" y="${y}" width="780" height="220" preserveAspectRatio="xMidYMid meet"/>`; y += 232; }
  else{ const sz = Math.min(120, Math.floor(940 / (Math.max([...String(hook.title)].length, 4) * (JA ? 1 : 0.6)))); inner += TS(W / 2, y + sz, hook.title, { size: sz, fill: "#FFFFFF" }); y += sz + 50; }
  // 何の動画かの帯（赤）：「1分でわかる ドラフト環境」など
  const ribbon = hook.trend ? ((hook.thumb && hook.thumb.ribbon) || (JA ? `1分でわかる ${UI.trendHookC}` : UI.trendHookC))
               : hook.early ? UI.earlyHookC :   // 速報は1分を超えるので「1分でわかる」は付けない（2026年11月）
                 (JA ? `1分でわかる ${UI.hookC(hook.isSealed)}` : `${UI.hookC(hook.isSealed)} IN 1 MINUTE`);
  const rs = Math.min(hook.thumb && hook.thumb.bigRibbon ? 96 : 64, Math.floor(900 / ([...ribbon].length * (JA ? 1 : 0.62)))), rw = Math.round([...ribbon].length * rs * (JA ? 1 : 0.62) + 80);
  inner += `<rect x="${(W - rw) / 2}" y="${y}" width="${rw}" height="${Math.round(rs * 1.6)}" rx="20" fill="#D9412B" stroke="#FFFFFF" stroke-width="6"/>` +
    T(W / 2, y + Math.round(rs * 0.8 + rs * 0.36), ribbon, { size: rs, weight: 900, anchor: "middle", fill: "#FFFFFF" });
  y += Math.round(rs * 1.6) + 24;
  if(!th) return inner;
  // 見出し（2行・黄色）と、下の一行（白）。全角の「！」は右に空きがあるので、その分だけ右へずらして真ん中に見せる
  const wide = JA ? 1 : 0.56, room = BOTTOM - y;
  if(th.sub2){
    // 修正版：見出しは1行（カード名を「」で）。下に白い行（何週間で・何のカードか）と、黄色の行（発売直後 → 最近の勝率）
    const u = t => JA ? units(t) : [...t].length * wide;   // 日本語の行は、半角（数字や%）を細めに数える
    const subs = th.subs || [th.sub];
    const subS = Math.min(76, ...subs.map(t => Math.floor(980 / u(t)))), sub2S = Math.min(88, Math.floor(980 / u(th.sub2)));
    const mainS = Math.min(150, Math.floor(1000 / u(th.l1)));
    let yy = y + mainS + 10;
    inner += TS(W / 2, yy, th.l1, { size: mainS, fill: "#FFD23F" });
    yy += 26;
    for(const t of subs){ yy += subS + 16; inner += TS(W / 2, yy, t, { size: subS }); }
    yy += sub2S + 30;
    inner += TS(W / 2, yy, th.sub2, { size: sub2S, fill: "#FFD23F" });
    return inner;
  }
  const subS = Math.min(74, Math.floor(980 / ([...th.sub].length * wide)));
  const mainS = Math.min(200, Math.floor(980 / (Math.max([...th.l1].length, [...th.l2].length) * wide)), Math.floor((room - subS - 60) / 2.08));
  const nudge = t => /！$/.test(t) ? Math.round(mainS * 0.19) : 0;
  const y1 = y + mainS, y2 = y1 + Math.round(mainS * 1.04);
  inner += TS(W / 2 + nudge(th.l1), y1, th.l1, { size: mainS, fill: "#FFD23F" }) + TS(W / 2 + nudge(th.l2), y2, th.l2, { size: mainS, fill: "#FFD23F" }) +
           TS(W / 2, y2 + subS + 40, th.sub, { size: subS });
  return inner;
}

function sceneSvg(sc){
  switch(sc.kind){
    case "hook": {
      // 修正版：サムネイルと同じ中身を冒頭に出す（サムネイルで見た答えを、そのまま動画でも見せる）。左上に「修正版」の札
      // 修正版：答え（カード名と数字）はそのカードの章で出すので、冒頭はロゴと、大きな「ドラフト環境の変化」の帯だけ。帯は真ん中より少し下に
      if(sc.trend) return frame(trendHookInner(sc) +
        `<g transform="rotate(-8 140 120)"><rect x="20" y="84" width="240" height="74" rx="37" fill="#E53935" stroke="#FFFFFF" stroke-width="5"/>` +
        T(140, 136, UI.trendBadge, { size: JA ? 48 : 32, weight: 900, anchor: "middle", fill: "#FFFFFF" }) + `</g>`, null, { header: false });
      // 速報：修正版と同じ形（ロゴ・帯・「〇万試合を分析」・何を解説するか・カード）。2026年11月：答えまで出すと、初めて見る人が置いていかれるため
      if(sc.early) return frame(trendHookInner(sc) +
        `<g transform="rotate(-8 140 120)"><rect x="20" y="84" width="240" height="74" rx="37" fill="#E53935" stroke="#FFFFFF" stroke-width="5"/>` +
        T(140, 136, sc.trend ? UI.trendBadge : UI.earlyBadge, { size: JA ? 48 : 32, weight: 900, anchor: "middle", fill: "#FFFFFF" }) + `</g>`, null, { header: false });
      // 一目で「何の動画か」が分かるように：大きな縁取り文字を、上下の暗い帯の上に置く。絵は真ん中に見せる
      const parts = String(sc.title).includes(" ") && JA ? String(sc.title).split(/\s+/) : [sc.title];
      const longest = Math.max(...parts.map(p => [...p].length));
      const fit = JA ? Math.min(150, Math.floor(980 / Math.max(longest, 4))) : Math.min(170, Math.floor(1000 / Math.max(longest * 0.62, 4)));
      const lines = parts.length > 1 ? parts : (JA && longest > 9 ? [[...sc.title].slice(0, Math.ceil(longest / 2)).join(""), [...sc.title].slice(Math.ceil(longest / 2)).join("")] : parts);
      const sz = JA ? Math.min(150, Math.floor(980 / Math.max(...lines.map(l => [...l].length), 4))) : fit;
      let y = 520;
      let titleSvg = "";
      if(sc.logo){
        // 公式のセットのロゴ（short/logo/<SET>.png）があれば、文字の代わりにそれを主役にする（サムネイルと同じ）
        titleSvg = `<image href="${sc.logo}" x="90" y="400" width="900" height="330" preserveAspectRatio="xMidYMid meet"/>`;
        y = 840;   // ロゴの下端（730）から離して、種類のピルを置く
      }else{
        for(const l of lines){ titleSvg += TS(W / 2, y, l, { size: sz, fill: "#FFD23F" }); y += Math.round(sz * 1.06); }
      }
      const modeY = y - 58 + 44;   // タイトルとの間に余裕を持たせる（+44）。動画ページでは中央に再生ボタンが載るので、真ん中（縦960付近）には文字を置かない
      return frame(
        `<defs>
           <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050B14" stop-opacity="0.92"/><stop offset="0.75" stop-color="#050B14" stop-opacity="0.8"/><stop offset="1" stop-color="#050B14" stop-opacity="0"/></linearGradient>
           <linearGradient id="gb" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#050B14" stop-opacity="0.92"/><stop offset="0.7" stop-color="#050B14" stop-opacity="0.78"/><stop offset="1" stop-color="#050B14" stop-opacity="0"/></linearGradient>
         </defs>
         <rect x="0" y="0" width="${W}" height="${modeY + 190}" fill="url(#gt)"/>
         <rect x="0" y="1330" width="${W}" height="590" fill="url(#gb)"/>` +
        (sc.arenaLogo ? `<image href="${sc.arenaLogo}" x="${W / 2 - 290}" y="50" width="580" height="204" preserveAspectRatio="xMidYMid meet"/>` : T(W / 2, 190, UI.arena, { size: 70, weight: 900, anchor: "middle", fill: "#FFFFFF" })) +
        TS(W / 2, 372, UI.hookA, { size: 96, fill: "#FFFFFF" }) +
        titleSvg +
        `<rect x="${W / 2 - 280}" y="${modeY - 62}" width="560" height="100" rx="50" fill="${BLUE}" stroke="#FFFFFF" stroke-width="6"/>` +
        T(W / 2, modeY + 8, sc.trend ? UI.trendHookC : sc.early ? UI.earlyHookC : UI.hookC(sc.isSealed), { size: sc.trend ? (JA ? 58 : 44) : sc.early && !JA ? 56 : 66, weight: 900, anchor: "middle", fill: "#06101C" }) +
        (sc.early || sc.trend ? `<g transform="rotate(-8 140 120)"><rect x="20" y="84" width="240" height="74" rx="37" fill="#E53935" stroke="#FFFFFF" stroke-width="5"/>` +
                    T(140, 136, sc.trend ? UI.trendBadge : UI.earlyBadge, { size: JA ? 48 : 32, weight: 900, anchor: "middle", fill: "#FFFFFF" }) + `</g>` : "") +
        (() => {
          const D2 = sc.trend ? UI.trendHookD2 : UI.hookD2;
          const g = UI.hookD1(sc.games), n1 = String(sc.games), l1 = [...g].length, l2 = [...D2].length;
          const s1 = JA ? Math.min(150, Math.floor(1000 / l1)) : Math.min(116, Math.floor(1000 / (l1 * 0.58)));
          const s2 = JA ? Math.min(120, Math.floor(1000 / l2)) : Math.min(104, Math.floor(1000 / (l2 * 0.58)));
          const i = g.indexOf(n1), head = i >= 0 ? g.slice(0, i) : "", tail = i >= 0 ? g.slice(i + n1.length) : g;
          return `<text x="${W / 2}" y="1420" font-size="${s1}" fill="#FFFFFF" font-weight="900" text-anchor="middle" stroke="#06101C" stroke-width="${Math.round(s1 * 0.16)}" stroke-linejoin="round" paint-order="stroke">${esc(head)}<tspan fill="#FFD23F">${esc(n1)}</tspan>${esc(tail)}</text>` +
                 TS(W / 2, 1420 + Math.round(s2 * 1.35), D2, { size: s2 });
        })(), null, { header: false });
    }
    case "tier": {
      // 上：単色の強さ（小さく）。下：2色の組み合わせのティア表（S/A/B/C）。右はしのキャラクターにかからないよう y=1000 までに収める
      let s = T(80, 222, UI.colorsH, { size: 36, fill: MUTED });
      sc.colors.forEach((c, i) => {
        const x = 130 + i * 205;
        s += symbol(c.color, x, 300, 92);
        s += T(x, 392, pt(c.wr) + "%", { size: 34, anchor: "middle", weight: i < 2 ? 900 : 400, fill: i < 2 ? PAPER : MUTED });
      });
      s += T(80, 472, UI.tierH, { size: 36, fill: MUTED });
      const TCOL = { S: GOLD, A: UP, B: BLUE, C: MUTED };
      ["S", "A", "B", "C"].forEach((t, i) => {
        const y = 500 + i * 128, list = sc.tiers[t] || [];
        s += `<rect x="80" y="${y}" width="${W - 160}" height="116" rx="20" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${TCOL[t]}" stroke-width="3"/>` +
             `<rect x="80" y="${y}" width="104" height="116" rx="20" fill="${TCOL[t]}"/>` +
             T(132, y + 82, t, { size: 72, weight: 900, anchor: "middle", fill: "#06101C" });
        const cw = Math.min(164, Math.floor(810 / Math.max(list.length, 1)));
        let pickedAt = null;
        list.forEach((p, j) => {
          const x = 210 + j * cw, sz = Math.min(54, cw - 70);
          const picked = sc.pick && p.pair === sc.pick.pair;
          let chip = pairSymbols(p.pair, x, y + 40, sz) +
                     T(x + sz + 6, y + 104, pt(p.wr) + "%", { size: 26, anchor: "middle", weight: picked || p === sc.best ? 900 : 400, fill: picked ? GOLD : p === sc.best ? GOLD : p === sc.worst ? DOWN : PAPER });
          // 狙い目を言うときは、その組み合わせだけ残して、ほかは薄くする（どれを勧めているか一目で分かるように）
          if(sc.pick && !picked) chip = `<g opacity="0.3">${chip}</g>`;
          if(picked) pickedAt = { x: x - 14, y: y + 6, w: cw - 4, h: 104 };
          s += chip;
        });
        if(pickedAt){
          const { x, y: py, w, h } = pickedAt;
          s += `<rect x="${x - 4}" y="${py - 4}" width="${w + 8}" height="${h + 8}" rx="22" fill="none" stroke="${GOLD}" stroke-width="14" stroke-opacity="0.35"/>` +
               `<rect x="${x}" y="${py}" width="${w}" height="${h}" rx="18" fill="${GOLD}" fill-opacity="0.22" stroke="${GOLD}" stroke-width="6"/>` +
               // 「狙い目」の札を、枠の上にかぶせる
               `<rect x="${x + w / 2 - 70}" y="${py - 30}" width="140" height="44" rx="22" fill="${GOLD}"/>` +
               T(x + w / 2, py + 1, UI.targetTag, { size: 28, weight: 900, anchor: "middle", fill: "#06101C" });
          sc._pickBox = pickedAt;
        }
      });
      if(sc.pick){
        // 狙い目の説明（表の下）。光らせた枠から線でつなぐ
        const y = 1030, pb = sc._pickBox;
        if(pb) s += `<line x1="${pb.x + pb.w / 2}" y1="${pb.y + pb.h + 4}" x2="${pb.x + pb.w / 2}" y2="${y}" stroke="${GOLD}" stroke-width="5" stroke-dasharray="10 8"/>`;
        s += `<rect x="80" y="${y}" width="720" height="130" rx="24" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.85 : 0.6}" stroke="${GOLD}" stroke-width="5"/>` +
             T(110, y + 56, UI.targetPair, { size: 34, fill: GOLD, weight: 900 }) +
             pairSymbols(sc.pick.pair, 110, y + 96, 44) + T(228, y + 110, pairName(sc.pick.pair), { size: JA ? 40 : 34, weight: 900 }) +
             T(780, y + 108, sc.pick.note, { size: 24, anchor: "end", fill: MUTED });
      }
      return frame(s, sc.say);
    }
    case "bombs": {
      // 3 枚を縦に並べる（カード画像＋順位・レアリティ・名前・勝率）。2 画面で 6 枚。
      // カードを大きく見せるため、この場面だけ字幕の枠を下げる（BOMB_CAP_BOTTOM）。右はしのキャラクターには名前がかからない幅（520px）にする
      // 字幕の枠の高さは読み上げの長さで変わるので、枠の上端より上に 3 枚が収まるように、行の高さをその場で決める
      const capTop = captionTop(sc.say, BOMB_CAP_BOTTOM), Y0 = 244;
      const ROW = Math.min(372, Math.floor((capTop - 16 - Y0) / 3)), f = ROW / 236;
      const CH = Math.round(224 * f), CW = Math.round(160 * f), TX = 120 + CW;
      const sz = v => Math.round(v * Math.min(1.25, Math.max(0.8, f)));                       // 文字は縮めすぎず、大きくしすぎない
      let s = T(80, 222, UI.bombsH(sc.from, sc.to), { size: 36, fill: MUTED });
      sc.cards.forEach((c, i) => {
        const y = Y0 + i * ROW, col = COLOR[c.color] || MUTED, rank = sc.from + i;
        if(c.imgPath) s += `<image href="${c.imgPath}" x="80" y="${y}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid slice"/>`;
        else s += `<rect x="80" y="${y}" width="${CW}" height="${CH}" rx="12" fill="${col}" opacity="0.85"/>`;
        s += T(TX, y + sz(50), UI.rank(rank), { size: sz(38), fill: rank === 1 ? GOLD : MUTED, weight: rank === 1 ? 900 : 400 });
        s += T(TX + (JA ? sz(100) : sz(86)), y + sz(50), UI.bombsTag[c.rarity] || "", { size: sz(28), fill: c.rarity === "mythic" ? DOWN : GOLD, weight: 700 });
        const lines = wrapName(c.label, JA ? 11 : 20).slice(0, 2);
        let size = lines.length > 1 ? sz(JA ? 42 : 36) : sz(JA ? 50 : 44);
        size = Math.min(size, Math.floor((1040 - 240 - TX) / Math.max(...lines.map(l => JA ? [...l].length : l.length * 0.58), 1)));   // 右はしのキャラクターにかからない幅
        lines.forEach((l, j) => { s += T(TX, y + (lines.length > 1 ? sz(104) : sz(124)) + j * (size + 4), l, { size, weight: 900 }); });
        // 勝率の札は、名前のすぐ下に置く（カードの下端まで離さない）
        const nameBottom = y + (lines.length > 1 ? sz(104) : sz(124)) + (lines.length - 1) * (size + 4), bs = sz(40);
        s += gihBadge(TX, Math.min(nameBottom + sz(24), y + CH - Math.round(bs * 1.4)), pt(c.gih), ZX - 20 - TX, bs);
      });
      return frame(s, sc.say, { capBottom: BOMB_CAP_BOTTOM });
    }
    case "top": {
      // 3枚を縦に並べ、左にカード、右に順位・名前・勝率。字幕の枠（下から 300+40+箱）にかからない範囲でカードをできるだけ大きく
      // 字幕の枠の上端までを3行で使い切る（字幕が短いほどカードが大きくなる）。文字は右はしのキャラクターの手前（ZX）までに収める
      const capTop = captionTop(sc.say), Y0 = 236;
      const ROW = Math.min(420, Math.floor((capTop - 16 - Y0) / 3)), k = ROW / 358;
      const CH = ROW - 9, CW = Math.round(CH * 250 / 349), TX = 80 + CW + 42, TW = ZX - 20 - TX;
      let s = T(80, 216, UI.topH(sc.label), { size: 36, fill: MUTED });
      sc.cards.forEach((c, i) => {
        const y = Y0 + i * ROW, col = COLOR[c.color] || MUTED;
        // カード画像が入る枠。取れたときは実画像、取れなければ色付きの札
        if(c.imgPath){
          s += `<image href="${c.imgPath}" x="80" y="${y}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid slice"/>`;
        }else{
          s += `<rect x="80" y="${y}" width="${CW}" height="${CH}" rx="16" fill="${col}" opacity="0.85"/>`;
          s += `<rect x="96" y="${y + 16}" width="${CW - 32}" height="176" rx="10" fill="${DEEP}" opacity="0.5"/>`;
        }
        s += T(TX, y + Math.round(92 * k), UI.rank(i + 1), { size: 36, fill: i === 0 ? GOLD : MUTED, weight: i === 0 ? 900 : 400 });
        // ボム級の札（順位の右）
        if(c.bomb) s += `<rect x="${TX + 92}" y="${y + Math.round(92 * k) - 36}" width="${JA ? 128 : 170}" height="46" rx="23" fill="${GOLD}"/>` +
                        T(TX + 92 + (JA ? 64 : 85), y + Math.round(92 * k) - 2, JA ? "ボム級" : "Bomb-level", { size: JA ? 30 : 26, weight: 900, anchor: "middle", fill: DEEP });
        // 名前は長ければ2行。右はしのキャラクターにかからない幅（TW）に収める
        const lines = wrapName(c.label, JA ? 10 : 20).slice(0, 2);
        let size = lines.length > 1 ? (JA ? 46 : 40) : (JA ? ([...c.label].length <= 8 ? 60 : 50) : (c.label.length <= 14 ? 50 : 42));
        size = Math.min(size, Math.floor(TW / Math.max(...lines.map(l => JA ? [...l].length : l.length * 0.58), 1)));
        lines.forEach((l, j) => { s += T(TX, y + Math.round((lines.length > 1 ? 168 : 196) * k) + j * (size + 8), l, { size, weight: 900 }); });
        // 勝率の札は、名前のすぐ下に置く
        const nameBottom = y + Math.round((lines.length > 1 ? 168 : 196) * k) + (lines.length - 1) * (size + 8), bs = Math.round(46 * Math.min(1, Math.max(0.8, k)));
        s += gihBadge(TX, Math.min(nameBottom + Math.round(26 * k), y + CH - Math.round(bs * 1.4)), pt(c.gih), TW, bs);
      });
      return frame(s, sc.say);
    }
    case "cardPick":
    case "trendCards": {
      // 1枚・2枚の場面は、ボムの場面と同じく字幕の枠を下げる（カードの下の名前・数字に余白をとるため。章の中で枠の高さはそろえる）
      if(sc.part === "focus") return frame(trendFocusSvg(sc), sc.say, { capBottom: BOMB_CAP_BOTTOM });
      if(sc.part === "rest") return frame(trendRestSvg(sc), sc.say, { capBottom: BOMB_CAP_BOTTOM });
      // 修正版：発売直後から上がった（下がった）カード 3 枚。左にカード、右に名前と「発売直後 → 最近」の勝率、大きく差
      const capTop = captionTop(sc.layoutSay || sc.say), Y0 = sc.chapter ? CH_Y0 : 236, up = sc.dir === "up", col = up ? UP : DOWN;
      const ROW = Math.min(420, Math.floor((capTop - 16 - Y0) / 3)), k = ROW / 358;
      const CH = ROW - 9, CW = Math.round(CH * 250 / 349), TX = 80 + CW + 42, TW = ZX - 40 - TX;   // 文字は、光らせる枠（右端 ZX-10）の内側に余白を残す
      // 見出し：どのレアリティの、何の数字（引けた試合の勝率）が上がった／下がったか、をはっきり見せる
      const hd = sc.heading || (up ? UI.trendUpH : UI.trendDownH);
      let s = sc.chapter ? chapterHead(sc.chapter, hd, sc.rare ? "#E0B13A" : GOLD)
                         : T(80, 218, hd, { size: Math.min(JA ? 42 : 34, Math.floor((ZX - 100) / Math.max(units(hd), 1))), weight: 900, fill: sc.rare ? GOLD : PAPER });
      sc.cards.forEach((c, i) => {
        const y = Y0 + i * ROW, cc = COLOR[(c.color || "")[0]] || MUTED;
        if(c.imgPath) s += `<image href="${c.imgPath}" x="80" y="${y}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid slice"/>`;
        else s += `<rect x="80" y="${y}" width="${CW}" height="${CH}" rx="16" fill="${cc}" opacity="0.85"/>`;
        // 差（いちばん大きく）
        const dz = Math.round(78 * Math.min(1, Math.max(0.75, k)));
        s += T(TX, y + Math.round(88 * k), `${up ? "▲ +" : "▼ −"}${(Math.abs(c.delta) * 100).toFixed(1)}pt`, { size: dz, weight: 900, fill: col });
        // 名前（長ければ 2 行）
        const lines = wrapName(c.label, JA ? 10 : 20).slice(0, 2);
        let size = lines.length > 1 ? (JA ? 42 : 36) : (JA ? 50 : 44);
        size = Math.min(size, Math.floor(TW / Math.max(...lines.map(l => JA ? [...l].length : l.length * 0.58), 1)));
        const ny = y + Math.round(150 * k);
        lines.forEach((l, j) => { s += T(TX, ny + j * (size + 6), l, { size, weight: 900 }); });
        // 発売直後 → 最近 の勝率
        // 行は、光らせる枠（右端 ZX-10）の内側に余白を残して収める（枠の線が数字にかからないように）
        const a1 = `${UI.trendFirst} ${pt(c.first.gih)}%`, a2 = `${UI.trendLast} ${pt(c.last.gih)}%`, avail = ZX - 40 - TX;
        const by = ny + (lines.length - 1) * (size + 6) + Math.round(58 * k);
        const bs = Math.min(Math.round(34 * Math.min(1, Math.max(0.8, k))), Math.floor((avail - 16) / (units(a1) + units(a2) + 1.3)));
        s += T(TX, by, a1, { size: bs, fill: MUTED }) +
             T(TX + Math.round(units(a1) * bs) + 16, by, "→", { size: bs, fill: MUTED }) +
             T(TX + Math.round(units(a1) * bs) + 16 + Math.round(bs * 1.3), by, a2, { size: bs, weight: 900, fill: GOLD });
      });
      return frame(s, sc.say);
    }
    case "trendPairs": {
      // 修正版：2色の組み合わせ 10 通りを最近の勝率の順に。発売直後 → 最近 と差。
      // いちばん伸びた・落ちた・今の1位は、行の枠と差の札の色で示し、見出しの下に色の見方を出す（行の中に文字の札を足すと、英語で重なるため）
      const capTop = captionTop(sc.say), Y0 = PAIR_Y0, n = sc.pairs.length;
      const ROW = pairRow(sc);
      const ph = sc.heading || UI.trendPairsH;
      let s = sc.chapter ? chapterHead(sc.chapter, ph) : T(80, 216, ph, { size: Math.min(JA ? 40 : 34, Math.floor((ZX - 100) / Math.max(units(ph), 1))), weight: 900, fill: PAPER });
      let lx = 80;
      // 狙い目を言う場面：見方の代わりに、狙い目の理由（勝率の順位・使用率）を金色で出す
      if(sc.pick) s += T(80, 296, sc.pick.note, { size: Math.min(32, Math.floor((ZX - 100) / Math.max(units(sc.pick.note), 1))), weight: 900, fill: GOLD });
      else for(const [label, col] of [[UI.trendRise, UP], [UI.trendFall, DOWN], [sc.keepTop ? UI.trendTopKeep : UI.trendTop, GOLD]]){
        s += `<rect x="${lx}" y="272" width="26" height="26" rx="6" fill="${col}"/>` + T(lx + 36, 295, label, { size: 28, weight: 700, fill: PAPER });
        lx += 36 + Math.round(units(label) * 28) + 34;
      }
      sc.pairs.forEach((p, i) => {
        const y = Y0 + i * ROW, cy = y + ROW / 2, sz = Math.round(ROW * 0.46), up = p.delta >= 0;
        const picked = sc.pick && sc.pick.pair === p;
        const markCol = sc.pick ? (picked ? GOLD : "") : p === sc.rise ? UP : p === sc.fall ? DOWN : p === sc.top ? GOLD : "";
        if(sc.pick && !picked) s += `<g opacity="0.3">`;   // 狙い目のときは、その行だけ残してほかは薄く
        s += `<rect x="70" y="${y + 4}" width="${ZX - 90}" height="${ROW - 8}" rx="14" fill="${picked ? GOLD : DEEP}" fill-opacity="${picked ? 0.22 : HAS_BG ? 0.72 : 0.3}"${markCol ? ` stroke="${markCol}" stroke-width="${picked ? 6 : 4}"` : ""}/>`;
        s += pairSymbols(p.colors, 88, cy, sz);
        const nm = pairName(p.colors), ns = Math.min(JA ? 38 : 30, Math.floor(196 / Math.max(units(nm), 1)));
        s += T(200, cy + Math.round(ns * 0.36), nm, { size: ns, weight: 900 });
        s += T(520, cy + 11, `${pt(p.first.wr)}%`, { size: 30, fill: MUTED, anchor: "end" }) + T(548, cy + 11, "→", { size: 28, fill: MUTED, anchor: "middle" }) +
             T(672, cy + 12, `${pt(p.last.wr)}%`, { size: 36, weight: 900, anchor: "end", fill: p === sc.top ? GOLD : PAPER });
        const dt = `${up ? "+" : "−"}${(Math.abs(p.delta) * 100).toFixed(1)}`, dcol = up ? UP : DOWN;
        if(!sc.pick && (p === sc.rise || p === sc.fall))
          s += `<rect x="690" y="${cy - 24}" width="96" height="48" rx="24" fill="${dcol}"/>` + T(738, cy + 11, dt, { size: 32, weight: 900, anchor: "middle", fill: "#06101C" });
        else s += T(770, cy + 11, dt, { size: 32, weight: 900, anchor: "end", fill: dcol });
        if(sc.pick && !picked) s += `</g>`;
      });
      return frame(s, sc.say);
    }
    case "surprise":
    case "target": {
      return frame(
        T(W / 2, 420, sc.heading || UI.surpriseH, { size: 44, fill: MUTED, anchor: "middle" }) +
        T(W / 2, 560, sc.title, { size: JA ? 72 : 64, weight: 900, anchor: "middle", fill: sc.kind === "target" ? GOLD : DOWN }) +
        `<rect x="120" y="640" width="${W - 240}" height="420" rx="32" fill="${DEEP}" fill-opacity="${HAS_BG ? 0.72 : 0.25}" stroke="${BLUE}" stroke-width="4"/>` +
        (sc.pair ? pairSymbols(sc.pair, W / 2 - 132 - 6, 740, 132) + T(W / 2, 866, sc.big, { size: JA ? 60 : 50, weight: 900, anchor: "middle" })
                 : T(W / 2, 810, sc.big, { size: 140, weight: 900, anchor: "middle" })) +
        T(W / 2, 940, sc.sub, { size: 50, anchor: "middle", fill: BLUE, weight: 700 }) +
        T(W / 2, 1010, sc.note, { size: JA ? 34 : 30, anchor: "middle", fill: MUTED }), sc.say);
    }
    case "cta": {
      // 途中の登録と高評価のお願い。大きな文字だけ（登録ボタン・指・ベルは popLayer、高評価の手は下に描く）
      const thumb = `<g transform="translate(${W / 2 - 95},1085)"><path d="M0 70 L0 170 L40 170 L40 70 Z M52 170 L150 170 C166 170 176 160 178 146 L190 92 C194 74 182 60 164 60 L120 60 L128 22 C132 4 118 -6 106 2 L52 70 Z" fill="#FFFFFF" stroke="#06101C" stroke-width="7" stroke-linejoin="round"/></g>`;
      const lead = String(sc.lead || "").replace(/[、,]\s*$/, "");
      return frame(
        (lead ? TS(W / 2, 470, lead, { size: JA ? 56 : 60, fill: "#C9D7E6" }) : "") +   // 前置きは小さく
        TS(W / 2, 640, UI.ctaA, { size: JA ? 104 : 120 }) +
        TS(W / 2, 780, UI.ctaB, { size: JA ? 104 : 120, fill: "#FFD23F" }) + thumb, null, { header: false });
    }
    case "bye": {
      // MTGアリーナのロゴ（無ければ文字）と、締めの一言
      const size = Math.min(JA ? 96 : 110, Math.floor(980 / Math.max(units(UI.bye), 1)));
      return frame((HEADER.arena ? `<image href="${HEADER.arena}" x="${W / 2 - 330}" y="470" width="660" height="232" preserveAspectRatio="xMidYMid meet"/>`
                                 : TS(W / 2, 640, UI.arena, { size: 96 })) +
                   TS(W / 2, 860, UI.bye, { size, fill: "#FFD23F" }), null, { header: false });
    }
    case "outro": {
      // 締めは「チャンネル登録をお願いします」だけ。クレジットや表記は概要欄に置く
      // 登録ボタン・指・ベルは動く層（popLayer）で重ねる
      return frame(
        TS(W / 2, 640, UI.outroA, { size: 112 }) +
        (UI.outroB ? TS(W / 2, 780, UI.outroB, { size: 112 }) : ""), null, { header: false });
    }
  }
  return frame("", sc.say);
}

/* 説明しているところを光らせる枠（ピックアップ）。長尺と同じ見た目で、読み上げに合わせて出す。
   光らせるのは、セリフが特定の項目（1位のカード、最弱の組み合わせ、強い色のカードなど）を指しているときだけ。
   「4位から6位も」「トップ3はこちら」のように全体を指すときは光らせない。
   位置は sceneSvg の描き方と合わせる。返り値は [{ label, boxes }]（label はセリフの中で光らせ始める言葉） */
function highlightsOf(sc){
  const rowW = ZX - 10 - 66;   // 行の枠は、右はしのキャラクターの手前まで
  if(sc.kind === "tier" && !sc.pick){
    const out = [];
    if((sc.tiers.S || []).length) out.push({ label: JA ? "Sティア" : "S tier", boxes: [{ x: 80, y: 500, w: W - 160, h: 116 }] });
    if(sc.worst){
      ["S", "A", "B", "C"].forEach((t, i) => {
        const list = sc.tiers[t] || [], j = list.indexOf(sc.worst);
        if(j < 0) return;
        const y = 500 + i * 128, cw = Math.min(164, Math.floor(810 / Math.max(list.length, 1))), x = 210 + j * cw;
        out.push({ label: JA ? "最弱" : "weakest", boxes: [{ x: x - 14, y: y + 6, w: cw - 4, h: 104 }] });
      });
    }
    return out;
  }
  if(sc.kind === "bombs"){
    const capTop = captionTop(sc.say, BOMB_CAP_BOTTOM), Y0 = 244;
    const ROW = Math.min(372, Math.floor((capTop - 16 - Y0) / 3)), CH = Math.round(224 * ROW / 236);
    const row = i => ({ x: 66, y: Y0 + i * ROW - 10, w: rowW, h: CH + 20 });
    // 2 画面目は、特別枠のカードの話をするときだけ、そのカードを光らせる
    return sc.page === 0 ? sc.cards.slice(0, 3).map((c, i) => ({ label: JA ? c.label : c.name, boxes: [row(i)] }))
                         : sc.cards.map((c, i) => c.outside ? { label: JA ? c.label : c.name, boxes: [row(i)] } : null).filter(Boolean);
  }
  if((sc.kind === "trendCards" || sc.kind === "cardPick") && sc.part === "focus") return [];   // 1枚だけなので光らせない
  if((sc.kind === "trendCards" || sc.kind === "cardPick") && sc.part === "rest"){
    // 名前を言っているカードを、そのあいだだけ光らせる（下の名前・差まで囲む）
    const cols = restCols(sc);
    return cols.length > 1 ? cols.filter(k => String(sc.say).includes(k.c.label)).map(k => ({ label: k.c.label, boxes: [{ x: k.x - 14, y: k.y - 14, w: k.w + 28, h: k.h + 320 }] })) : [];
  }
  if(sc.kind === "trendCards"){
    // 名前を言っているカードを、そのあいだだけ光らせる（言った順に移る。字幕を分けた場面では、その字幕で言うカードだけ）
    const capTop = captionTop(sc.layoutSay || sc.say), Y0 = sc.chapter ? CH_Y0 : 236;
    const ROW = Math.min(420, Math.floor((capTop - 16 - Y0) / 3)), CH = ROW - 9;
    const said = sc.cards.map((c, i) => ({ c, i, at: String(sc.say).indexOf(c.label) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at);
    return sc.cards.length > 1 ? said.map(({ c, i }) => ({ label: c.label, boxes: [{ x: 66, y: Y0 + i * ROW - 10, w: rowW, h: CH + 20 }] })) : [];
  }
  if(sc.kind === "trendPairs" && sc.pick) return [];   // 狙い目の場面は、行そのものを金色にしてあるので光らせない
  if(sc.kind === "trendPairs"){
    // いちばん伸びた・いちばん落ちた組み合わせを、名前を言うあいだ光らせる（行の位置は sceneSvg と同じ計算）
    const ROW = pairRow(sc), row = p => ({ x: 62, y: PAIR_Y0 + sc.pairs.indexOf(p) * ROW - 2, w: ZX - 74, h: ROW + 4 });
    return [{ label: pairName(sc.rise.colors), boxes: [row(sc.rise)] }, { label: pairName(sc.fall.colors), boxes: [row(sc.fall)] }];
  }
  if(sc.kind === "top"){
    const capTop = captionTop(sc.say), Y0 = 236;
    const ROW = Math.min(420, Math.floor((capTop - 16 - Y0) / 3)), CH = ROW - 9;
    const row = i => ({ x: 66, y: Y0 + i * ROW - 10, w: rowW, h: CH + 20 });
    // 「〇が強いです」と言う場面だけ、その色のカードをまとめて光らせる
    const out = sc.strong ? [{ label: CN[sc.strong], boxes: sc.cards.map((c, i) => c.color === sc.strong ? row(i) : null).filter(Boolean) }] : [];
    // ボム級の一言のあいだは、そのカードを光らせる
    if(sc.bombHl) out.push({ label: sc.bombHl.label, boxes: sc.bombHl.idx.map(row) });
    // 画面の全部のカードを指すとき（3枚とも同じ色、3枚ともボム級など）は光らせない。全部光ると、かえってどこを見ればいいか分からない
    return out.filter(h => h.boxes.length < sc.cards.length);
  }
  return [];
}
function highlightSvg(boxes){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` + boxes.map(h =>
    `<rect x="${h.x - 6}" y="${h.y - 6}" width="${h.w + 12}" height="${h.h + 12}" rx="22" fill="none" stroke="${GOLD}" stroke-width="18" stroke-opacity="0.35"/>` +
    `<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="18" fill="${GOLD}" fill-opacity="0.12" stroke="${GOLD}" stroke-width="7"/>`).join("") + `</svg>`;
}
/* 光らせる時間（場面の頭からの秒）。区切りごとの実際の音声の長さ（chunkDurs）から決める。
   最後に光らせるものは、場面の終わりまで残す */
function highlightTimes(sc, len){
  const out = [], voiced = sc.hl || [];
  if(voiced.length && sc.spans && sc.chunkDurs){
    const t0 = [0]; sc.chunkDurs.forEach(d => t0.push(t0[t0.length - 1] + d));
    voiced.forEach((h, k) => {
      const sp = sc.spans[k]; if(!sp) return;
      out.push({ boxes: h.boxes, a: Math.max(0, t0[sp[0]] - 0.05), b: k === voiced.length - 1 ? len : t0[sp[1] + 1] });
    });
  }
  return out;
}

/* ------------------------------------------------------------ 音声 */

/* カード名の読み違いを直す辞書。short/yomi.json に { "蛮刀": "バントウ" } の形で足していく */
/* 読み上げに渡す直前に、辞書の語を読みに置き換える。VOICEVOX の利用者辞書は「黒緑」のような色の並びに当たらないことがある
   （形態素解析が「黒」「緑」に分けて「りょく」と読む）ので、辞書登録に頼らず文面そのものを読みにしておく。字幕には使わない */
let YOMI = [];
function toSpeech(text){
  let t = String(text);
  for(const [surface, yomi] of YOMI) t = t.split(surface).join(yomi);
  return t;
}
async function loadYomi(){
  try{ await fetch(`${VV}/version`); }
  catch(e){ throw new Error(`VOICEVOX ENGINE に接続できません（${VV}）。起動してから実行してください`); }
  const dict = await readJson("short/yomi.json", {});
  YOMI = Object.entries(dict).sort((a, b) => [...b[0]].length - [...a[0]].length);   // 長い語から置き換える（「白青黒」が「白青」に先に当たらないように）
  let n = 0;
  for(const [surface, yomi] of Object.entries(dict)){
    const r = await fetch(`${VV}/user_dict_word?surface=${encodeURIComponent(surface)}&pronunciation=${encodeURIComponent(yomi)}&accent_type=0&priority=8`, { method: "POST" });
    if(r.ok) n++; else console.error(`読み辞書の登録に失敗: ${surface} (${r.status})`);
  }
  if(n) console.error(`読み辞書: ${n} 語`);
}

/* 英語の読み上げ（Kokoro）。短い Python を呼ぶ。モデルは KOKORO_DIR（kokoro-v1.0.onnx と voices-v1.0.bin） */
async function speakEn(text, wavPath, opt = {}){
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
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-af", `apad=pad_dur=${opt.post ?? 0.25}`, wavPath + ".tmp.wav"]);
  execFileSync("mv", [wavPath + ".tmp.wav", wavPath]);
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]).toString().trim();
  return { kana: text, dur };
}

/* opt.post・opt.pre：文の後ろ・前の無音（秒）。区切って読むときは、つなぎ目を短くする */
async function speak(text, wavPath, opt = {}){
  if(process.env.SHORT_FAKE_AUDIO){   // 動画の組み立てだけを確かめるとき：VOICEVOX を使わず、文字数ぶんの長さの仮の音を入れる
    const dur = Math.max(1.5, [...text].length / (JA ? 6 : 14));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=0.3*sin(2*PI*220*t)*gt(sin(2*PI*2.7*t)\\,-0.2):s=24000`, "-t", dur.toFixed(2), wavPath]);
    return { kana: text, dur };
  }
  if(!JA) return speakEn(text, wavPath, opt);
  const q = await fetch(`${VV}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(toSpeech(text))}`, { method: "POST" });
  if(!q.ok) throw new Error(`audio_query ${q.status}`);
  const query = await q.json();
  query.speedScale = SPEED;
  query.postPhonemeLength = opt.post ?? 0.25;         // 文末に少し間を置く
  if(opt.pre != null) query.prePhonemeLength = opt.pre;
  const r = await fetch(`${VV}/synthesis?speaker=${SPEAKER}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query)
  });
  if(!r.ok) throw new Error(`synthesis ${r.status}`);
  await writeFile(wavPath, Buffer.from(await r.arrayBuffer()));
  const kana = query.accent_phrases.map(p => p.moras.map(m => m.text).join("") + (p.pause_mora ? "、" : "")).join("");
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]).toString().trim();
  return { kana, dur };
}

/* ------------------------------------------------------------ 特別枠のカード */

/* 記事データの上位カードのうち、セットのカード一覧（data/names）に無いもの＝セットの外から入る特別枠のカード。
   日本語名・画像を Scryfall で引いて names に足し、names.outside に枠の種類（"spg" | "other"）を入れる（このファイルは保存しない） */
async function addOutsideCards(d, names){
  names.names = names.names || {}; names.images = names.images || {}; names.outside = {};
  const front = n => String(n).split(" // ")[0];
  const cards = Object.values(d.top || {}).flat().filter(Boolean);
  const miss = [...new Set(cards.map(c => c.name).filter(n => !names.images[n] && !names.images[front(n)]))];
  if(!miss.length) return;
  const info = await lookupOutside(miss, SET).catch(() => ({}));
  for(const n of miss){
    const o = info[front(n)];
    if(!o) continue;
    if(o.ja && !names.names[n]) names.names[n] = o.ja;
    if(o.img) names.images[n] = o.img;
    if(o.slot) names.outside[n] = o.slot;
    for(const c of cards) if(c.name === n && !c.imgEn) c.imgEn = o.imgEn;
  }
  console.error(`特別枠のカード: ${miss.map(n => `${n}（${info[front(n)] ? (names.outside[n] || "セット内") : "引けず"}）`).join("、")}`);
}

/* ------------------------------------------------------------ 実行 */

async function main(){
  const dataFile = TREND ? `data/trends/${SET}_draft.json` : `data/articles/${SET}_${MODE}.json`;
  const d = await readJson(dataFile, null);
  if(!d){ console.error(`${SET}: ${MODE} のデータ（${dataFile}）がありません`); process.exit(1); }
  if(TREND && d.format !== TREND_FORMAT){
    console.error(`${process.env.GITHUB_ACTIONS ? "::error::" : ""}${SET}: 修正版のデータ（${dataFile}）が古い形です（${d.format || 1} → ${TREND_FORMAT} が必要）。「データ｜修正版の集計」をやり直してから作ってください`);
    process.exit(1);
  }
  const names = await readJson(`data/names/${SET}.json`, { names: {}, images: {} });
  const nameJa = shortName(JA ? ((await setNameJa(SET)) || names.set || SET) : (names.set || SET));   // 英語のときは英語のセット名
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
  await addOutsideCards(d, names);
  // レア度ごとの平均勝率（ボム級や「平均より何ポイント高いか」を言うため）。速報は記事データ（build-early.mjs の rarity_avg）、
  // ドラフト・シールドは勝率一覧から出す
  const rep = EARLY || TREND ? null : await loadReport(SET, MODE);
  const avgs = d.rarity_avg || (rep ? rarityAverages(rep.ratings.cards, MODE === "sealed" ? 300 : 1500) : {});
  // 伝説のカード（「色が合うなら何枚でも」と言わないため）。下見ページのデータ（data/profiles/<SET>.json）のタイプ行から。無ければ null（何枚でも、は言わない）
  const prof = await readJson(`data/profiles/${SET}.json`, null);
  const legend = prof && Array.isArray(prof.cards) ? new Map(prof.cards.map(c => [c.name, /Legendary/.test(c.type || "")])) : null;
  console.error(`レア度ごとの平均: ${["common", "uncommon", "rare"].map(r => `${r} ${avgs[r] ? pt(avgs[r]) + "%" : "なし"}`).join(" / ")}`);
  const scenes = TREND ? splitLongScenes(trendScript(d, { JA, nameJa, names, pairName, cta: ctaScene(JA ? "レアリティ別のカード評価を見る前に、" : "Before the cards by rarity, "), bye: byeScene() })) : splitLongScenes(buildScript(d, nameJa, names, avgs, legend));

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
    if(ab && hook){ hook.arenaLogo = HEADER.arena = "data:image/png;base64," + ab.toString("base64"); console.error("アリーナのロゴ: short/logo/arena.png"); }
  }

  // BGM（short/bgm/*.mp3 を置いておくと、薄く流す。short/bgm/credits.json に { "ファイル名": "表記" } があれば締めにクレジットを出す）
  let bgm = null, bgmCredit = "";
  try{
    const { readdir } = await import("node:fs/promises");
    // 英語版は short/bgm-en/ を使う（無ければ short/bgm/）。チャンネルごとに曲の雰囲気を分けるため
    // 修正版は日英とも short/bgm-trend/、速報は日英とも short/bgm-early/（どちらも少しポップな別の曲。クレジットの英語は credits.en.json）
    const isAudio = f => /\.(mp3|m4a|wav|ogg)$/i.test(f);
    const own = TREND ? "short/bgm-trend" : EARLY ? "short/bgm-early" : null;
    let dir = own && existsSync(own) ? own : !JA ? "short/bgm-en" : "short/bgm", files = (await readdir(dir).catch(() => [])).filter(isAudio).sort();
    if(!files.length && dir !== "short/bgm"){ dir = "short/bgm"; files = (await readdir(dir)).filter(isAudio).sort(); }
    if(files.length){
      // セットコードから決まる1曲（同じセット・同じ言語なら、形式が違っても同じ曲になる）
      const pick = files[[...SET].reduce((n, ch) => n + ch.charCodeAt(0), 0) % files.length];
      bgm = `${dir}/${pick}`;
      const credits = (!JA && await readJson(`${dir}/credits.en.json`, null)) || await readJson(`${dir}/credits.json`, {});
      bgmCredit = credits[pick] || "";
      console.error(`BGM: ${pick}${bgmCredit ? `（${bgmCredit}）` : ""}`);
    }else console.error("BGM: 無し（short/bgm/ に曲が無い）");
  }catch(e){ console.error("BGM: 無し"); }
  const outro = scenes.find(sc => sc.kind === "outro");
  if(outro && bgmCredit) outro.bgmCredit = bgmCredit;
  await mkdir(`${OUT}/${TAG}`, { recursive: true }); await writeFile(`${OUT}/${TAG}/bgm.txt`, bgmCredit, "utf8");   // 概要欄に載せる

  // セットの顔になるカードのアート（冒頭・締めの背景）。神話レア→レアの順に勝率上位から探す
  let artPath = null;
  {
    const cands = TREND
      ? [...(d.risers || []), ...(d.cards || []).slice().sort((a, b) => b.last.gih - a.last.gih)]   // 修正版：いちばん上がったカード（冒頭・サムネイルの答え）のアート
      : [...((d.top && d.top.mythic) || []), ...((d.top && d.top.rare) || [])].sort((a, b) => b.gih - a.gih);
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
  for(const sc of scenes) if(sc.kind === "top" || sc.kind === "bombs" || sc.kind === "trendCards" || sc.kind === "cardPick"){
    for(const [i, c] of sc.cards.entries()){
      if(c.imgPath) continue;   // 修正版は1章を2つの場面に分けていて、カードは同じものなので2度取らない
      if(!JA && !c.img){
        try{
          const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(String(c.name).split(" // ")[0])}&set=${SET.toLowerCase()}`, { headers: { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" } });
          if(r.ok){ const j = await r.json(); c.img = (j.image_uris || (j.card_faces && j.card_faces[0].image_uris) || {}).normal || null; }
          await new Promise(res => setTimeout(res, 120));
        }catch(e){}
      }
      if(!c.img) continue;
      try{
        // 修正版は1枚を大きく映すので、大きい画像（large、672×936）を使う
        const url = sc.kind === "trendCards" || sc.kind === "cardPick" ? String(c.img).replace("/normal/", "/large/") : c.img;
        const r = await fetch(url, { headers: { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" } });
        if(!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await writeFile(`${OUT}/${TAG}/card-${sc.label}-${i}.jpg`, buf);
        c.imgPath = "data:image/jpeg;base64," + buf.toString("base64");   // SVG に直接埋め込む
      }catch(e){}
    }
  }

  // 修正版・速報：冒頭の場面はサムネイルと同じ中身なので、サムネイルに並べるカードの画像を冒頭にも渡しておく
  if(TREND || EARLY){
    // 修正版は、サムネイルの答えのカード（いちばん上がったカード）の章から取り、そのカードを真ん中に、同じ章の上がったカードを左右に
    const hk = scenes[0];
    const src = TREND ? scenes.find(sc => sc.kind === "trendCards" && sc.dir === "up" && sc.cards[0].name === hk.topName)
                      : scenes.find(sc => sc.kind === "cardPick" && sc.label === "bombs");
    const imgs = src ? src.cards.slice(0, 3).map(c => c.imgPath) : [];
    hk.thumbCards = TREND ? [imgs[1], imgs[0], imgs[2]].filter(Boolean) : imgs;
  }

  // 背景のプレイ映像。あれば長さを測っておき、場面をまたいで途切れずに流す
  let bgDur = 0;
  try{
    bgDur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", BG]).toString().trim();
  }catch(e){}
  HAS_BG = bgDur > 0;
  console.error(HAS_BG ? `背景: ${BG}（${bgDur.toFixed(1)}秒、足りなければ繰り返す）` : "背景: 紺色（short/bg.mp4 が無い）");

  // 場面の PNG を背景（カードアートかプレイ映像）に重ねて 1 枚の JPG にする（サイト用サムネイルと YouTube 用サムネイルで共用）
  const composeStill = (png, out, outW, outH, q) => {
    const args = (artPath || HAS_BG)
      ? (artPath ? ["-loop", "1", "-i", artPath] : ["-ss", "1.0", "-i", BG]).concat(["-i", png, "-filter_complex",
         `[0:v]scale=iw*sar:ih,setsar=1,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=saturation=${artPath ? 1.0 : 0.7}${artPath ? "" : ",gblur=sigma=5"},setsar=1[bg0];` +
         `color=c=0x0A2038@${artPath ? 0.12 : 0.6}:s=${W}x${H}[tint];[bg0][tint]overlay=shortest=1[bg];[1:v]scale=${W}:${H},format=rgba[fg];[bg][fg]overlay=shortest=1,scale=${outW}:${outH}[v]`])
      : ["-f", "lavfi", "-i", `color=c=0x0A2038:s=${W}x${H}`, "-i", png, "-filter_complex", `[1:v]scale=${W}:${H},format=rgba[fg];[0:v][fg]overlay=shortest=1,scale=${outW}:${outH}[v]`];
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args, "-map", "[v]", "-frames:v", "1", "-q:v", String(q), out]);
  };
  // YouTube 用のサムネイル（1080×1920。一覧で切れない配置）。動画と一緒に作り、youtube-upload.mjs が使う
  //   狙い目の組み合わせがあるときは、差し替え用に「〇〇が狙い目！」の版も作る（short/<SET>/<TAG>.thumbnail-alt.jpg。公開するときに Studio で選ぶ）
  //   キャラクター：日本語はフード付きのずんだもん（short/zunda-hoodie/thumb.png）、英語は四国めたん。出さないとき：SHORT_THUMB_CHAR=0
  const makeThumbnail = async () => {
    const hook = scenes[0];
    if(!hook.thumbCards){   // 修正版・速報は、冒頭の場面を描く前に決めてある（冒頭とサムネイルで同じカードにする）
      const bombs = scenes.find(sc => (sc.kind === "cardPick" && sc.label === "bombs") || (sc.kind === "trendCards" && sc.dir === "up"));
      hook.thumbCards = bombs ? bombs.cards.slice(0, 3).map(c => c.imgPath) : [];
    }
    const cf = process.env.SHORT_THUMB_CHAR === "0" ? null : (JA ? ["short/zunda-hoodie/thumb.png", "short/zunda-hoodie/open_open.png", "short/zunda/open_open.png"] : ["short/metan/open_open.png"]).find(f => existsSync(f));
    if(cf){ const buf = await readFile(cf), m = await sharp(buf).metadata(); hook.thumbChar = { src: "data:image/png;base64," + buf.toString("base64"), w: m.width, h: m.height }; }
    for(const [alt, name] of [[false, "thumbnail"], [true, "thumbnail-alt"]]){
      if(alt && !hook.thumbAlt) continue;
      const png = `${OUT}/${TAG}/${name}.png`;
      await sharp(Buffer.from(thumbSvg(hook, alt)), { density: 72 }).png().toFile(png);
      composeStill(png, `${OUT}/${TAG}.${name}.jpg`, W, H, 2);
      console.error(`YouTube 用サムネイル${alt ? "（差し替え用・狙い目）" : ""}: ${OUT}/${TAG}.${name}.jpg`);
    }
  };

  // サムネイルだけ作る（SHORT_POSTER=1）。冒頭のタイトル場面を背景に重ねて assets/video/<SET>-<TAG>.jpg に。読み上げは要らない
  if(process.env.SHORT_POSTER){
    const png = `${OUT}/${TAG}/poster.png`;
    await sharp(Buffer.from(sceneSvg(scenes[0])), { density: 72 }).png().toFile(png);
    await mkdir("assets/video", { recursive: true });
    composeStill(png, `assets/video/${SET}-${TAG}.jpg`, 540, 960, 4);
    console.error(`サムネイルを作りました: assets/video/${SET}-${TAG}.jpg`);
    return;
  }
  // 画像だけ確認するとき（SHORT_STILLS=1）も、YouTube 用サムネイルは作って見られるようにする
  if(process.env.SHORT_STILLS) await makeThumbnail().catch(e => console.error("YouTube 用サムネイルを作れませんでした: " + e.message));

  // 1) 音声を先にまとめて作る（VOICEVOX が要るのはここだけ）。文面が前回と同じなら作り直さない
  const prev = await readJson(`${OUT}/${TAG}/script.json`, []);
  let yomiLoaded = false;
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/${TAG}/scene-${i}`;
    const old = prev[i];
    // 光らせる枠があり、読み上げに合わせる場面は、光らせる言葉ごとに区切って読み上げ、区切りの長さで時間を決める（長尺と同じ）
    sc.hl = highlightsOf(sc);
    const voiced = sc.hl.filter(h => h.label);
    const split = voiced.length ? splitSay(sc.say, voiced, !JA) : null;
    if(split) sc.spans = split.spans;
    if(old && old.say === sc.say && old.dur && (!split || old.chunkDurs) && await readFile(base + ".wav").then(() => true, () => false)){
      sc.kana = old.kana; sc.dur = old.dur; if(split) sc.chunkDurs = old.chunkDurs; continue;
    }
    if(process.env.SHORT_STILLS){ sc.kana = sc.say; sc.dur = 3; continue; }   // 画像だけなら音声は要らない（VOICEVOX 無しでも確認できる）
    if(JA && !yomiLoaded && !process.env.SHORT_FAKE_AUDIO){ await loadYomi(); yomiLoaded = true; }
    if(split){
      const durs = [], kanas = [];
      for(const [k, c] of split.chunks.entries()){
        const last = k === split.chunks.length - 1;
        const r = await speak(c.text, `${base}-c${k}.wav`, { post: last ? 0.25 : 0.06, pre: k === 0 ? undefined : 0.04 });
        durs.push(r.dur); kanas.push(r.kana);
      }
      const ins = split.chunks.flatMap((c, k) => ["-i", `${base}-c${k}.wav`]);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...ins, "-filter_complex",
        `${split.chunks.map((c, k) => `[${k}:a]aformat=sample_rates=24000:channel_layouts=mono[a${k}]`).join(";")};${split.chunks.map((c, k) => `[a${k}]`).join("")}concat=n=${split.chunks.length}:v=0:a=1[o]`,
        "-map", "[o]", base + ".wav"]);
      sc.chunkDurs = durs; sc.kana = kanas.join(""); sc.dur = durs.reduce((n, d) => n + d, 0);
      continue;
    }
    const { kana, dur } = await speak(sc.say, base + ".wav");
    sc.kana = kana; sc.dur = dur;
  }
  await writeFile(`${OUT}/${TAG}/script.json`, JSON.stringify(scenes.map(s => ({ kind: s.kind, say: s.say, kana: s.kana, dur: s.dur, ...(s.chunkDurs ? { chunkDurs: s.chunkDurs } : {}) })), null, 2), "utf8");

  // （2026年10月まで、アンコモンとコモンの場面を同じ長さにそろえていた。短いほうに不自然な間ができるのでやめた）

  const ZUNDA = !process.env.SHORT_STILLS && await zundaReady();
  console.error(ZUNDA ? `${MASCOT_NAME}: 字幕の枠の上（右はし）に出す（${ZDIR}/）` : `${MASCOT_NAME}: 出さない（${process.env.SHORT_STILLS ? "画像だけの確認のため" : process.env.SHORT_ZUNDA === "0" ? "SHORT_ZUNDA=0" : ZDIR + "/ に6枚がそろっていない"}）`);

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
    // 効果音（short/sfx/*.wav）。場面の頭に、ナレーションより小さく重ねる。無ければ何もしない
    const seName = { hook: "start", outro: "fanfare", top: "appear", colors: "appear" }[sc.kind];   // それ以外の場面の切り替えでは鳴らさない（ノイズに聞こえるため）
    const sePath = seName && process.env.SE_ON === "1" ? `short/sfx/${seName}.wav` : "";   // 効果音は初期状態ではオフ（SE_ON=1 で有効）。エコーが「ぼふふ」というノイズに聞こえたため
    const wavIn = sePath && await readFile(sePath).then(() => true, () => false) ? base + ".mix.wav" : base + ".wav";
    if(wavIn !== base + ".wav"){
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", base + ".wav", "-i", sePath, "-filter_complex",
        `[1:a]volume=${process.env.SE_VOLUME || "0.31"},aformat=sample_rates=24000:channel_layouts=mono[se];[0:a]aformat=sample_rates=24000:channel_layouts=mono[n];` +
        `[n][se]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[o]`, "-map", "[o]", wavIn]);
    }
    const len = Math.max(dur + (sc.tail || 0.35), sc.minDur || 0), pad = len - dur, N = Math.ceil(len * 30);   // minDur: 読み終わっても最低この長さは見せる   // 読み終わりに少し置く（カードを見せる場面は長め）
    const audio = `[${(sc.art && artPath) || HAS_BG ? 2 : 1}:a]apad=pad_dur=${pad.toFixed(2)},afade=t=in:d=0.012,afade=t=out:st=${(len - 0.03).toFixed(3)}:d=0.03,aformat=sample_rates=48000:channel_layouts=stereo[a]`;   // 頭と終わりを短くなだらかに（つなぎ目のプチ音対策）
    const audioIdx = (sc.art && artPath) || HAS_BG ? 2 : 1;
    const zp = zundaPos(sc);
    const ZF = ZUNDA ? `[${audioIdx + 1}:v]fps=30,scale=${ZW}:${ZH},format=rgba[zz];[vz][zz]overlay=x=${zp.x}:y=${zp.y}:shortest=1,format=yuv420p[v];` : `[vz]format=yuv420p[v];`;
    // ずんだもんは背景と情報の画面のあいだに入れる（情報や字幕が前に出るので、万一かさなっても文字は隠れない）
    const ZPRE = ZUNDA ? `[${audioIdx + 1}:v]fps=30,scale=${ZW}:${ZH},format=rgba[zz];[bg][zz]overlay=x=${zp.x}:y=${zp.y}:shortest=1[bgz];` : `[bg]null[bgz];`;
    let args;
    if(sc.art && artPath){
      // カードアートを縦いっぱいに敷き、ゆっくり寄る。膜は薄めにして絵を見せる
      args = ["-loop", "1", "-framerate", "30", "-i", artPath,
              "-loop", "1", "-framerate", "30", "-i", base + ".png", "-i", wavIn,
              "-filter_complex",
                `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
                `zoompan=z='1+0.08*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=30,eq=saturation=0.9[bg0];` +
                `color=c=0x0A2038@${sc.kind === "hook" ? 0.12 : 0.45}:s=${W}x${H}:r=30[tint];[bg0][tint]overlay=shortest=1[bg];` +
                `[1:v]scale=${W}:${H},format=rgba${sc.kind === "hook" ? "" : ",fade=t=in:d=0.2:alpha=1"}[fg];` +
                `${ZPRE}[bgz][fg]overlay=shortest=1,format=yuv420p[v];${audio}`];
    }else if(HAS_BG){
      // 横長の映像を縦に切り出し、暗くぼかして下に敷く。開始位置は前の場面の続きから
      const ss = (total % bgDur).toFixed(2);
      args = ["-stream_loop", "-1", "-ss", ss, "-i", BG,
              "-loop", "1", "-framerate", "30", "-i", base + ".png", "-i", wavIn,
              "-filter_complex",
                `[0:v]fps=30,scale=iw*sar:ih,setsar=1,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +   // 縦長ピクセルの録画（1440×1080 など）も正しい比率に直す
                `eq=saturation=0.7,gblur=sigma=5,setsar=1[bg0];` +
                `color=c=0x0A2038@0.6:s=${W}x${H}:r=30[tint];[bg0][tint]overlay=shortest=1[bg];` +   // 紺の膜で暗くして文字を立たせる
                `[1:v]scale=${W}:${H},format=rgba${sc.nofade ? "" : ",fade=t=in:d=0.2:alpha=1"}[fg];` +   // nofade: 前の場面と同じ画面が続くとき（ちらつかせない）
                `${ZPRE}[bgz][fg]overlay=shortest=1,format=yuv420p[v];${audio}`];
    }else{
      args = ["-loop", "1", "-framerate", "30", "-i", base + ".png", "-i", wavIn,
              "-filter_complex",
                `[0:v]zoompan=z='1+0.05*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=30,` +
                `${sc.nofade ? "null" : "fade=t=in:d=0.15"}[vz];${ZF}${audio}`];
    }
    if(ZUNDA){   // 口パクの動画を、最後の入力として足す
      const zi = args.indexOf("-filter_complex");
      args.splice(zi, 0, "-f", "concat", "-safe", "0", "-i", await zundaList(i, wavIn, len, `${OUT}/${TAG}`));
    }
    // 説明しているところを光らせる枠：1枚ずつ別の入力にして、その時間だけ重ねる
    const hl = highlightTimes(sc, len);
    if(hl.length){
      let idx = args.filter(a => a === "-i").length, chain = "";
      for(const [k, h] of hl.entries()){
        await sharp(Buffer.from(highlightSvg(h.boxes)), { density: 72 }).png().toFile(`${base}-hl${k}.png`);
        args.splice(args.indexOf("-filter_complex"), 0, "-loop", "1", "-framerate", "30", "-i", `${base}-hl${k}.png`);
        chain += `[${idx + k}:v]format=rgba[hh${k}];[hv${k}][hh${k}]overlay=0:0:enable='between(t,${h.a.toFixed(2)},${h.b.toFixed(2)})':shortest=1[hv${k + 1}];`;
      }
      const fi = args.indexOf("-filter_complex");
      args[fi + 1] = args[fi + 1].replace(/format=yuv420p\[v\];/, `null[hv0];${chain}[hv${hl.length}]format=yuv420p[v];`);
    }
    const pops = popLayer(sc);
    if(pops && pops.length){   // 動く層（登録ボタン・指など）：1枚ずつ最後の入力として足し、式の位置に、決めた時間だけ重ねる
      let idx = args.filter(a => a === "-i").length, chain = "";
      for(const [k, pop] of pops.entries()){
        await sharp(Buffer.from(pop.svg), { density: 72 }).png().toFile(`${base}.pop${k}.png`);
        args.splice(args.indexOf("-filter_complex"), 0, "-loop", "1", "-framerate", "30", "-i", `${base}.pop${k}.png`);
        chain += `[${idx + k}:v]scale=${pop.w}:${pop.h},format=rgba[pp${k}];[pv${k}][pp${k}]overlay=x='${pop.x}':y='${pop.y}'${pop.enable ? `:enable='${pop.enable}'` : ""}:shortest=1[pv${k + 1}];`;
      }
      const fi = args.indexOf("-filter_complex");   // 入力を足したあとの位置
      args[fi + 1] = args[fi + 1].replace(/format=yuv420p\[v\];/, `null[pv0];${chain}[pv${pops.length}]format=yuv420p[v];`);
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
    // BGM を薄く敷く。音量は一定にする（ナレーションに合わせて上げ下げすると、場面の切れ目で「ぼふっ」と膨らむため）。最後の2秒でフェードアウト
    const vol = process.env.BGM_VOLUME || "0.07";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/${TAG}/nobgm.mp4`, "-stream_loop", "-1", "-i", bgm,
      "-filter_complex",
        `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 2).toFixed(2)}:d=2[bg];` +
        `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(total), "-movflags", "+faststart", `${OUT}/${TAG}.mp4`]);
  }
  await makeThumbnail().catch(e => console.error("YouTube 用サムネイルを作れませんでした: " + e.message));
  // サイトの埋め込み用のサムネイル（冒頭のタイトル場面）。assets/video/<SET>-<TAG>.jpg に置き、ページはこれを使う
  try{
    await mkdir("assets/video", { recursive: true });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "1.0", "-i", `${OUT}/${TAG}.mp4`, "-frames:v", "1", "-vf", "scale=540:960", "-q:v", "4", `assets/video/${SET}-${TAG}.jpg`]);
    console.error(`サムネイル: assets/video/${SET}-${TAG}.jpg`);
  }catch(e){ console.error("サムネイルを作れませんでした: " + e.message); }
  console.error(`\n${OUT}/${TAG}.mp4  合計 ${total.toFixed(1)} 秒${bgm ? "（BGM あり）" : ""}`);
}

main().catch(e => { console.error("動画の作成に失敗しました:", e.message); process.exit(1); });
