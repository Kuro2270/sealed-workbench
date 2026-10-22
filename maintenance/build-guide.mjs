#!/usr/bin/env node
/*
 * 解説動画（横長 1920×1080）を、台本のファイルから作る。役割はこれだけ。
 * 定期的に作るものではないので、ワークフロー「解説動画を作る（手動）」から、必要なときに1回ずつ動かす。
 *
 *   node maintenance/build-guide.mjs beginner        … 日本語（VOICEVOX・ずんだもん）
 *   node maintenance/build-guide.mjs beginner en     … 英語（Kokoro・四国めたん）
 *   GUIDE_STILLS=1 …      場面の画像だけ作って終わる（音声・動画なし。レイアウトの確認用。VOICEVOX が無くても動く）
 *   GUIDE_FAKE_AUDIO=1 …  VOICEVOX・Kokoro の代わりに仮の音で動画まで組み立てる（組み立ての確認用）
 *
 * 台本: guide-video/<名前>/ja.json ・ en.json
 *   scenes … 場面の並び。{ chapter（目次の見出し。無ければ前の章の続き）, layout（画面の型）, view（画面の中身）, say（字幕と読み上げ）,
 *            speak（読み上げだけ別の文にしたいとき。数字の読みなど。字幕は say のまま）, nofade（前の場面と同じ画面のまま続ける）, tail（読み終わりから次までの秒） }
 *            nofade の場面で layout が前と同じなら、view は前の場面の view に上書きで足される（同じ表を何度も書かなくてよい）
 *   ui     … 画面に出す固定の文言（言語ごと）。title・description は YouTube に上げるときの題と概要欄（{chapters}・{bgm} は作るときに埋める）
 *   thumbnail … YouTube のサムネイルの文言 { tag（ロゴの下）, label（赤い帯）, main（大きな見出し）, sub（その下の一言。{min} は動画の長さ（分）を入れる）, bgAt（背景に使うプレイ映像の秒） }
 *
 * 出力: guide-video/<名前>/out/<ja|en>/ に <ja|en>.mp4、chapters.txt、description.txt、title.txt、thumbnail.jpg、script.json
 *       （途中生成物も同じ場所。commit はしない。ワークフローの Artifacts から落とす）
 *
 * 使うもの（長尺と同じ）: VOICEVOX（日本語）、Kokoro（英語。KOKORO_DIR にモデル）、ffmpeg、sharp、
 *   背景のプレイ映像 short/bg.mp4（無ければ紺色）、BGM long/bgm/（英語は long/bgm-en/）、立ち絵 short/zunda-hoodie/・short/metan/、
 *   読み辞書 short/yomi.json、カード画像は Scryfall（日本語版は日本語の印刷を探す）
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { execFileSync, execFile } from "node:child_process";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { makeLongThumbnail } from "./long-thumbnail.mjs";

const NAME = process.argv[2];
const LANG = (process.argv[3] || "ja").toLowerCase();
if(!NAME || !["ja", "en"].includes(LANG)){ console.error("使い方: node maintenance/build-guide.mjs <名前> [ja|en]"); process.exit(1); }
const EN = LANG === "en";
const L = (ja, en) => EN ? en : ja;
const DIR = `guide-video/${NAME}`, OUT = `${DIR}/out/${LANG}`;
const STILLS = !!process.env.GUIDE_STILLS, FAKE = !!process.env.GUIDE_FAKE_AUDIO;
const VV = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
const SPEAKER = +(process.env.VOICEVOX_SPEAKER || 3);
const SPEED = +(process.env.VOICEVOX_SPEED || 1.15);          // 解説なので、長尺（1.2）より少しゆっくり
const KOKORO_DIR = process.env.KOKORO_DIR || "short/kokoro", KOKORO_PY = process.env.KOKORO_PY || "python3";
const BG = process.env.SHORT_BG || "short/bg.mp4";
const UA = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)" };

const W = 1920, H = 1080, SCALE = 1.5, CAP_Y = 900;
const PINE = "#10304F", DEEP = "#0A2038", BLUE = "#2F7DF6", PAPER = "#F5F8FC", MUTED = "#A9C2DE";
const GOLD = "#F2C94C", GREEN = "#4CC38A", ORANGE = "#F08A3E";
const COLOR = { W: "#F3EAC6", U: "#4A90E2", B: "#6B5E7A", R: "#E1553E", G: "#3E9B5B" };
const FONT = "'Noto Sans CJK JP','Noto Sans JP',sans-serif";
let HAS_BG = false;

const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const T = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 40}" fill="${o.fill || PAPER}" font-weight="${o.weight || 400}"` +
  `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.op != null ? ` opacity="${o.op}"` : ""}>${esc(s)}</text>`;
const TS = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 100}" fill="${o.fill || "#FFFFFF"}" font-weight="900"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}` +
  ` stroke="#06101C" stroke-width="${Math.round((o.size || 100) * 0.16)}" stroke-linejoin="round" paint-order="stroke">${esc(s)}</text>`;
/* 文字の幅のおおよそ（全角 1、半角 0.55）。枠に収まる大きさを決めるのに使う */
const textW = (s, size) => [...String(s)].reduce((n, ch) => n + (/[\x20-\x7E]/.test(ch) ? 0.55 : 1), 0) * size;
const fit = (s, maxW, size) => Math.min(size, Math.floor(maxW / Math.max(textW(s, 1), 1)));

/* ------------------------------------------------------------ 部品 */

const SYM = {};
function symbol(c, x, y, size){
  if(SYM[c]) return `<svg x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" viewBox="${SYM[c].viewBox}">${SYM[c].inner}</svg>`;
  return `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${COLOR[c] || MUTED}"/>` + T(x, y + size * 0.17, c, { size: size * 0.42, weight: 900, anchor: "middle", fill: DEEP });
}
/* 1990年代のRPG風の青いウィンドウ（長尺と同じ見た目）。dim のときは薄くする（いま話していない所） */
const panel = (x, y, w, h, accent, dim) =>
  `<g opacity="${dim ? 0.38 : 1}"><rect x="${x + 5}" y="${y + 7}" width="${w}" height="${h}" rx="22" fill="#000" opacity="0.35"/>` +
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="url(#ffw)" fill-opacity="${HAS_BG ? 0.93 : 0.9}" stroke="#F4F7FF" stroke-width="5"/>` +
  `<rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" rx="14" fill="none" stroke="${accent || "#8FA8F0"}" stroke-width="${accent ? 4 : 2}" opacity="0.85"/></g>`;
const dimG = (on, inner) => `<g opacity="${on ? 1 : 0.38}">${inner}</g>`;
let HEADER = "";
function header(sc){
  const band = `<rect x="40" y="24" width="${W - 80}" height="84" rx="20" fill="${DEEP}" opacity="${HAS_BG ? 0.6 : 0.35}"/>`;
  return band + T(76, 82, HEADER, { size: 42, fill: BLUE, weight: 900 }) + T(W - 76, 80, sc.crumb || "", { size: 34, fill: MUTED, weight: 700, anchor: "end" });
}
function frame(inner, sc, o = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PINE}"/><stop offset="1" stop-color="${DEEP}"/></linearGradient><linearGradient id="ffw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A4FC4"/><stop offset="1" stop-color="#0B1763"/></linearGradient><linearGradient id="pack" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B8DEF"/><stop offset="1" stop-color="#1B2F8A"/></linearGradient></defs>
  ${HAS_BG ? "" : `<rect width="${W}" height="${H}" fill="url(#bg)"/>`}
  ${o.header === false ? "" : header(sc)}
  ${inner}
</svg>`;
}
/* カード画像（取れなければ名前の札） */
const CARD = {};
function cardImg(name, x, y, w, label){
  const h = Math.round(w * 680 / 488), c = CARD[name];
  if(c) return `<rect x="${x + 4}" y="${y + 6}" width="${w}" height="${h}" rx="${w * 0.045}" fill="#000" opacity="0.4"/><image href="${c}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.05}" fill="#44516B" stroke="${PAPER}" stroke-width="3"/>` + T(x + w / 2, y + h / 2, label || name, { size: Math.max(18, w * 0.07), weight: 700, anchor: "middle" });
}
/* 丸数字の札 */
const badge = (x, y, n, col = GOLD, r = 26) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="${DEEP}" stroke-width="4"/>` + T(x, y + r * 0.36, String(n), { size: r * 1.1, weight: 900, anchor: "middle", fill: DEEP });

/* ------------------------------------------------------------ 画面の型（layout） */

function sceneSvg(sc, ui){
  const v = sc.view || {};
  switch(sc.layout){
    case "title": {
      return frame(
        (sc.arenaLogo ? `<image href="${sc.arenaLogo}" x="${W / 2 - 330}" y="150" width="660" height="232" preserveAspectRatio="xMidYMid meet"/>` : TS(W / 2, 300, L("MTGアリーナ", "MTG Arena"), { size: 90, anchor: "middle" })) +
        TS(W / 2, 560, v.big, { size: fit(v.big, 1700, 170), anchor: "middle", fill: "#FFD23F" }) +
        TS(W / 2, 700, v.sub, { size: fit(v.sub, 1600, 70), anchor: "middle" }), sc, { header: false });
    }
    case "arena": {
      // 左：パソコンとスマホの絵。右：名前・説明・3つの札
      const dev = `<g transform="translate(150 260)">
        <rect x="0" y="0" width="460" height="290" rx="18" fill="${DEEP}" stroke="${PAPER}" stroke-width="8"/><rect x="24" y="24" width="412" height="242" rx="8" fill="url(#pack)"/>
        <rect x="170" y="290" width="120" height="50" fill="${PAPER}"/><rect x="110" y="338" width="240" height="16" rx="8" fill="${PAPER}"/>
        <rect x="520" y="90" width="150" height="270" rx="22" fill="${DEEP}" stroke="${PAPER}" stroke-width="8"/><rect x="536" y="118" width="118" height="214" rx="6" fill="url(#pack)"/></g>` +
        T(380, 680, v.devices[0], { size: 40, weight: 700, anchor: "middle" }) + T(745, 680, v.devices[1], { size: 40, weight: 700, anchor: "middle" });
      let s = dev + TS(1340, 330, v.name, { size: fit(v.name, 900, 110), anchor: "middle", fill: "#FFD23F" }) + T(1340, 410, v.tag, { size: fit(v.tag, 900, 40), anchor: "middle", weight: 700 });
      v.chips.forEach((c, i) => {
        const y = 470 + i * 110;
        s += `<rect x="960" y="${y}" width="760" height="86" rx="43" fill="${DEEP}" fill-opacity="0.85" stroke="${GREEN}" stroke-width="4"/>` +
             `<circle cx="1010" cy="${y + 43}" r="22" fill="${GREEN}"/><path d="M999 ${y + 43} l8 9 l15 -18" stroke="${DEEP}" stroke-width="6" fill="none" stroke-linecap="round"/>` +
             T(1060, y + 57, c, { size: fit(c, 640, 42), weight: 700 });
      });
      return frame(s, sc);
    }
    case "basics": {
      const u = ui.basics, f = v.focus;
      let s = panel(80, 140, 1760, 250, f === "life" ? GOLD : null, f !== "life");
      s += dimG(f === "life",
        // 2人のプレイヤーと、それぞれのライフ 20
        [0, 1].map(k => { const cx = k ? 1440 : 480; return `<circle cx="${cx - 250}" cy="265" r="62" fill="${k ? ORANGE : BLUE}" stroke="${PAPER}" stroke-width="6"/><circle cx="${cx - 250}" cy="248" r="22" fill="${PAPER}"/><path d="M${cx - 288} 305 q38 -48 76 0" fill="${PAPER}"/>` +
          TS(cx + 40, 300, u.life, { size: 80, anchor: "middle", fill: "#FFD23F" }); }).join("") +
        TS(W / 2, 290, u.vs, { size: 76, anchor: "middle" }) + T(W / 2, 360, u.lifeNote, { size: 36, anchor: "middle", weight: 700, fill: MUTED }));
      s += panel(80, 420, 1760, 230, f === "flow" ? GOLD : null, f !== "flow");
      // 段階の箱は数に合わせて幅を決める（メインが2回あるので6つ）。main に入っている番号の箱を金色の枠に
      const n = u.steps.length, gap = 44, bw = Math.floor((1660 - gap * (n - 1)) / n), mains = u.main || [];
      s += dimG(f === "flow", u.steps.map(([a, b], i) => {
        const x = 130 + i * (bw + gap), cxm = x + bw / 2;
        return `<rect x="${x}" y="460" width="${bw}" height="150" rx="18" fill="${DEEP}" fill-opacity="0.85" stroke="${mains.includes(i) ? GOLD : MUTED}" stroke-width="4"/>` +
          badge(x + 30, 460, i + 1) + T(cxm, 530, a, { size: fit(a, bw - 30, 48), weight: 900, anchor: "middle" }) + T(cxm, 580, b, { size: fit(b, bw - 20, 26), anchor: "middle", fill: MUTED }) +
          (i < n - 1 ? `<path d="M${x + bw + 6} 535 l${gap - 12} 0 m-12 -12 l12 12 l-12 12" stroke="${PAPER}" stroke-width="6" fill="none"/>` : "");
      }).join(""));
      s += panel(80, 680, 1760, 200, f === "mana" ? GOLD : null, f !== "mana");
      s += dimG(f === "mana",
        `<rect x="160" y="715" width="110" height="140" rx="10" fill="${COLOR.G}" stroke="${PAPER}" stroke-width="5"/><path d="M215 745 l-30 50 h60 z M215 770 l-25 45 h50 z" fill="#1F5A33"/>` +
        TS(330, 800, u.mana, { size: 60 }) + `<path d="M${330 + textW(u.mana, 60) + 30} 780 l80 0 m-24 -24 l24 24 l-24 24" stroke="${GOLD}" stroke-width="10" fill="none"/>` +
        `<circle cx="${330 + textW(u.mana, 60) + 170}" cy="780" r="40" fill="${GOLD}" stroke="${PAPER}" stroke-width="4"/>` +
        TS(330 + textW(u.mana, 60) + 230, 800, u.manaTo, { size: 60, fill: "#FFD23F" }) +
        T(1820, 800, u.manaNote, { size: fit(u.manaNote, 1820 - (330 + textW(u.mana, 60) + 240 + textW(u.manaTo, 60) + 60), 36), weight: 700, anchor: "end" }));
      return frame(s, sc);
    }
    case "colors": {
      let s = "";
      ui.colors.forEach(([c, name, tag, desc], i) => {
        const x = 70 + i * 360;
        s += panel(x, 150, 340, 560, null) + symbol(c, x + 170, 270, 150) +
          TS(x + 170, 440, name, { size: fit(name, 300, 72), anchor: "middle" }) + T(x + 170, 520, tag, { size: fit(tag, 300, 48), weight: 900, anchor: "middle", fill: "#FFD23F" }) +
          T(x + 170, 600, desc, { size: fit(desc, 300, 30), anchor: "middle", fill: MUTED, weight: 700 });
      });
      if(v.note) s += `<rect x="360" y="745" width="1200" height="110" rx="55" fill="${GOLD}" stroke="${PAPER}" stroke-width="5"/>` + T(W / 2, 818, ui.colorsNote, { size: fit(ui.colorsNote, 1100, 54), weight: 900, anchor: "middle", fill: DEEP });
      return frame(s, sc);
    }
    case "anatomy": {
      const u = ui.anatomy, cw = 500, ch = Math.round(cw * 680 / 488), cx = 230, cy = 140;   // 番号を外に置くので、左右に余白を取ってある
      // 番号はカードの外に置き、細い線で指す（カードの名前や数字に重ならないように）
      //   [指す場所（カードの中の割合）, 番号を置く側（-1 左 / 1 右）]：名前・マナコスト・イラスト・タイプ・テキスト・パワー／タフネス
      const spots = [[[0.04, 0.055], -1], [[0.94, 0.055], 1], [[0.7, 0.3], 1], [[0.04, 0.565], -1], [[0.04, 0.75], -1], [[0.96, 0.935], 1]];
      let s = cardImg(u.card, cx, cy, cw, u.jaName || u.card) + spots.map(([[fx, fy], side], i) => {
        const px = cx + fx * cw, py = cy + fy * ch, bx = side < 0 ? cx - 46 : cx + cw + 46, col = i === 5 && v.focus === "pt" ? ORANGE : GOLD;
        return `<line x1="${bx}" y1="${py}" x2="${px}" y2="${py}" stroke="${col}" stroke-width="4"/><circle cx="${px}" cy="${py}" r="7" fill="${col}" stroke="${DEEP}" stroke-width="2"/>` + badge(bx, py, i + 1, col, 28);
      }).join("");
      s += panel(850, 140, 990, 740, null);
      u.parts.forEach((p, i) => {
        const y = 215 + i * 78, on = !v.focus || (v.focus === "pt" ? i === 5 : true);
        s += dimG(on, badge(910, y - 14, i + 1, i === 5 && v.focus === "pt" ? ORANGE : GOLD, 26) + T(960, y, p, { size: 40, weight: 700 }));
      });
      s += dimG(v.focus !== "pt", T(890, 735, u.cost, { size: fit(u.cost, 920, 40), weight: 900, fill: "#FFD23F" }));
      s += dimG(v.focus === "pt", T(890, 815, u.pt, { size: fit(u.pt, 920, 40), weight: 900, fill: v.focus === "pt" ? "#FFB27A" : MUTED }));
      return frame(s, sc);
    }
    case "about": {
      // MTG とはどんなゲームか：数字の札を並べる（2×2）
      let s = TS(W / 2, 220, v.title, { size: fit(v.title, 1700, 80), anchor: "middle", fill: "#FFD23F" }) + T(W / 2, 290, v.tag, { size: fit(v.tag, 1600, 40), weight: 700, anchor: "middle" });
      v.stats.forEach(([big, small], i) => {
        const x = 150 + (i % 2) * 830, y = 340 + Math.floor(i / 2) * 260, on = v.focus == null || v.focus.includes(i);
        s += panel(x, y, 790, 230, on && v.focus ? GOLD : null, !on) + dimG(on, TS(x + 395, y + 125, big, { size: fit(big, 720, 90), anchor: "middle", fill: "#FFD23F" }) + T(x + 395, y + 190, small, { size: fit(small, 720, 36), weight: 700, anchor: "middle" }));
      });
      return frame(s, sc);
    }
    case "types": {
      // 呪文の種類：カードを横に並べ、話している種類だけ明るくする
      const list = ui.types.cards, n = list.length, cw = 340, gap = Math.floor((1760 - n * cw) / (n - 1)), x0 = 80;
      let s = "";
      list.forEach(([name, kind, desc, label], i) => {
        const x = x0 + i * (cw + gap), on = !v.focus || v.focus.includes(i);
        s += dimG(on, cardImg(name, x, 150, cw, label || name) + `<rect x="${x - 10}" y="${150 + Math.round(cw * 680 / 488) + 18}" width="${cw + 20}" height="72" rx="36" fill="${on && v.focus ? GOLD : BLUE}"/>` +
          T(x + cw / 2, 150 + Math.round(cw * 680 / 488) + 66, kind, { size: fit(kind, cw - 10, 38), weight: 900, anchor: "middle", fill: on && v.focus ? DEEP : PAPER }) +
          T(x + cw / 2, 150 + Math.round(cw * 680 / 488) + 140, desc, { size: fit(desc, cw + 30, 30), weight: 700, anchor: "middle" }));
      });
      return frame(s, sc);
    }
    case "cycle": {
      // セットの発売の周期：時間の矢印の上に、発売の印を3つ。間に「約〇か月」。下に小さく補足
      const x0 = 260, x1 = 1500, y = 520, n = v.sets.length, step = (x1 - x0) / (n - 1), xEnd = W - 150;
      let s = T(W / 2, 205, v.title, { size: 52, weight: 900, anchor: "middle", fill: "#FFD23F" }) + panel(80, 240, W - 160, 600, null) +
        `<line x1="${x0 - 100}" x2="${xEnd}" y1="${y}" y2="${y}" stroke="${PAPER}" stroke-width="6"/><path d="M${xEnd - 20} ${y - 16} l20 16 l-20 16" stroke="${PAPER}" stroke-width="6" fill="none"/>`;
      v.sets.forEach((name, i) => {
        const x = x0 + i * step;
        s += `<g transform="translate(${x - 60} ${y - 230})"><rect width="120" height="170" rx="12" fill="url(#pack)" stroke="${PAPER}" stroke-width="5"/><rect y="16" width="120" height="10" fill="${PAPER}" opacity="0.6"/><circle cx="60" cy="96" r="28" fill="${i === 0 ? GOLD : "#9CC4FF"}"/></g>` +
             `<circle cx="${x}" cy="${y}" r="16" fill="${GOLD}" stroke="${DEEP}" stroke-width="4"/>` + T(x, y + 70, name, { size: fit(name, step - 40, 40), weight: 900, anchor: "middle" }) +
             `<rect x="${x}" y="${y + 110}" width="${Math.min(step - 30, xEnd - 20 - x)}" height="70" rx="14" fill="${GOLD}" opacity="${i === 0 ? 1 : 0.75}"/>` + (i === n - 1 ? "" : T(x + 20, y + 158, v.events, { size: fit(v.events, Math.min(step - 70, xEnd - 60 - x), 30), weight: 900, fill: DEEP }));   // 最後の帯は「続く」だけなので文字は入れない
        if(i < n - 1) s += T(x + step / 2, y - 30, v.gap, { size: 40, weight: 900, anchor: "middle", fill: "#FFD23F" });
      });
      if(v.note) s += T(W / 2, 815, v.note, { size: 30, weight: 700, anchor: "middle", fill: MUTED });
      return frame(s, sc);
    }
    case "compare": {
      // 2つを左右に並べた表。focus の列を金色の枠で囲み、もう片方を薄くする。pick があれば、その列の上に札
      const x0 = 80, lw = 420, cwid = (W - 160 - lw) / 2, y0 = v.pick ? 200 : 170, rh = Math.min(118, Math.floor((870 - y0 - 100) / v.rows.length));
      let s = panel(x0, y0, W - 160, 100 + v.rows.length * rh + 20, null);
      v.cols.forEach((c, k) => {
        const x = x0 + lw + k * cwid, on = v.focus == null || v.focus === k;
        if(v.focus === k) s += `<rect x="${x + 8}" y="${y0 + 14}" width="${cwid - 16}" height="${100 + v.rows.length * rh - 8}" rx="16" fill="${GOLD}" fill-opacity="0.12" stroke="${GOLD}" stroke-width="7"/>`;
        s += dimG(on, T(x + cwid / 2, y0 + 75, c, { size: fit(c, cwid - 40, 52), weight: 900, anchor: "middle", fill: k ? "#9CC4FF" : "#FFD23F" }));
        if(v.pick && v.focus === k) s += `<rect x="${x + cwid / 2 - 170}" y="${y0 - 52}" width="340" height="70" rx="35" fill="#E53935" stroke="${PAPER}" stroke-width="5"/>` + T(x + cwid / 2, y0 - 5, v.pick, { size: 38, weight: 900, anchor: "middle" });
      });
      v.rows.forEach(([lab, a, b], r) => {
        const y = y0 + 100 + r * rh;
        s += `<line x1="${x0 + 30}" x2="${W - x0 - 30}" y1="${y}" y2="${y}" stroke="${PAPER}" stroke-opacity="0.25" stroke-width="2"/>` +
          T(x0 + 40, y + rh / 2 + 14, lab, { size: fit(lab, lw - 60, 36), weight: 700, fill: MUTED });
        [a, b].forEach((t, k) => { const x = x0 + lw + k * cwid; s += dimG(v.focus == null || v.focus === k, T(x + cwid / 2, y + rh / 2 + 15, t, { size: fit(t, cwid - 50, 42), weight: 700, anchor: "middle" })); });
      });
      return frame(s, sc);
    }
    case "schedule": {
      // 段の高さは段の数で決める（3段でも枠に収まるように）
      const x0 = 520, x1 = 1780, y0 = 270, lh = v.lanes.length > 2 ? 150 : 200;
      const X = p => x0 + (x1 - x0) * p / 100;
      let s = T(W / 2, 205, v.title, { size: 52, weight: 900, anchor: "middle", fill: "#FFD23F" }) + panel(80, 240, W - 160, v.lanes.length * lh + 160, null);
      v.lanes.forEach((ln, i) => {
        const y = y0 + i * lh + 30;
        s += T(x0 - 40, y + 62, ln.name, { size: fit(ln.name, 380, 42), weight: 900, anchor: "end" });
        ln.bars.forEach(([a, b, lab, kind]) => {
          const col = kind === "new" ? GOLD : "#6F8FC8";
          s += `<rect x="${X(a)}" y="${y}" width="${X(b) - X(a)}" height="100" rx="18" fill="${col}" stroke="${PAPER}" stroke-width="4"/>` +
               T((X(a) + X(b)) / 2, y + 64, lab, { size: fit(lab, X(b) - X(a) - 30, 36), weight: 900, anchor: "middle", fill: DEEP });
        });
      });
      const ya = y0 + v.lanes.length * lh + 30;
      s += `<line x1="${x0}" x2="${x1}" y1="${ya}" y2="${ya}" stroke="${PAPER}" stroke-width="4"/><path d="M${x1 - 20} ${ya - 14} l20 14 l-20 14" stroke="${PAPER}" stroke-width="4" fill="none"/>` +
        `<line x1="${x0}" x2="${x0}" y1="${y0 + 10}" y2="${ya + 14}" stroke="${GOLD}" stroke-width="4" stroke-dasharray="10 8"/>` +
        T(x0, ya + 55, v.axis[0], { size: 34, weight: 700, anchor: "middle", fill: "#FFD23F" }) + T(x1, ya + 55, v.axis[1], { size: 34, weight: 700, anchor: "end", fill: MUTED });
      return frame(s, sc);
    }
    case "sealed": {
      const u = ui.sealed;
      let s = T(W / 2, 200, u.title, { size: 60, weight: 900, anchor: "middle", fill: "#FFD23F" });
      for(let i = 0; i < v.packs; i++){
        const x = 170 + (i % 3) * 210, y = 270 + Math.floor(i / 3) * 290;
        s += `<g transform="rotate(${(i % 2 ? 4 : -4)} ${x + 85} ${y + 125})"><rect x="${x}" y="${y}" width="170" height="250" rx="14" fill="url(#pack)" stroke="${PAPER}" stroke-width="5"/>` +
             `<rect x="${x}" y="${y + 20}" width="170" height="14" fill="${PAPER}" opacity="0.6"/><circle cx="${x + 85}" cy="${y + 140}" r="40" fill="${GOLD}" opacity="0.9"/></g>`;
      }
      s += T(485, 860, u.packs, { size: 44, weight: 900, anchor: "middle" });
      s += `<path d="M860 540 l220 0 m-50 -50 l50 50 l-50 50" stroke="${GOLD}" stroke-width="16" fill="none" stroke-linecap="round"/>` + T(970, 480, u.arrow, { size: 36, weight: 700, anchor: "middle", fill: MUTED });
      for(let i = 0; i < 6; i++) s += `<rect x="${1250 + i * 12}" y="${300 + i * 10}" width="300" height="420" rx="18" fill="${i === 5 ? "#2A4FC4" : DEEP}" stroke="${PAPER}" stroke-width="5"/>`;
      s += TS(1460, 560, "40", { size: 150, anchor: "middle", fill: "#FFD23F" }) + T(1460, 820, v.result, { size: fit(v.result, 520, 48), weight: 900, anchor: "middle" }) +
           T(1460, 875, v.note, { size: 34, weight: 700, anchor: "middle", fill: MUTED });
      return frame(s, sc);
    }
    case "draft": {
      const u = ui.draft, cx = 560, cy = 540, R = 260;
      let s = T(1450, 200, u.title, { size: 60, weight: 900, anchor: "middle", fill: "#FFD23F" }) +
        `<circle cx="${cx}" cy="${cy}" r="${R - 70}" fill="${DEEP}" fill-opacity="0.85" stroke="${MUTED}" stroke-width="4"/>` +
        `<path d="M${cx + 120} ${cy - 120} A170 170 0 0 1 ${cx + 150} ${cy + 80}" stroke="${GOLD}" stroke-width="10" fill="none"/><path d="M${cx + 132} ${cy + 66} l18 14 l12 -20" stroke="${GOLD}" stroke-width="10" fill="none"/>`;
      for(let i = 0; i < v.seats; i++){
        const a = -Math.PI / 2 + i * 2 * Math.PI / v.seats, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a), me = i === 4;
        s += `<circle cx="${x}" cy="${y}" r="56" fill="${me ? ORANGE : "#4A6FA5"}" stroke="${PAPER}" stroke-width="5"/><circle cx="${x}" cy="${y - 12}" r="18" fill="${PAPER}"/><path d="M${x - 28} ${y + 30} q28 -36 56 0" fill="${PAPER}"/>`;
        if(me) s += T(x, y + 100, u.you, { size: 36, weight: 900, anchor: "middle", fill: "#FFB27A" });
      }
      s += panel(1060, 240, 780, 560, null);
      v.steps.forEach((t, i) => { const y = 340 + i * 120; s += badge(1130, y - 14, i + 1) + T(1180, y, t, { size: fit(t, 620, 48), weight: 900 }); });
      s += `<line x1="1110" x2="1790" y1="680" y2="680" stroke="${PAPER}" stroke-opacity="0.4" stroke-width="3"/>` + T(1450, 760, v.total, { size: fit(v.total, 700, 54), weight: 900, anchor: "middle", fill: "#FFD23F" });
      return frame(s, sc);
    }
    case "deck": {
      const u = ui.deck, f = v.focus;
      let s = panel(80, 140, 1760, 260, f === "split" ? GOLD : null, f !== "split") + dimG(f === "split", T(130, 215, u.title, { size: 44, weight: 900 }));
      const cols = [GREEN, BLUE, GOLD], tot = u.split.reduce((n, x) => n + x[1], 0);
      let x = 130;
      s += dimG(f === "split", u.split.map(([name, n], i) => { const w = n / tot * 1660, r = `<rect x="${x}" y="245" width="${w - 8}" height="120" rx="16" fill="${cols[i]}"/>` + T(x + (w - 8) / 2, 325, `${name} ${n}`, { size: fit(`${name} ${n}`, w - 30, 52), weight: 900, anchor: "middle", fill: DEEP }); x += w; return r; }).join(""));
      // マナカーブ（左下）
      s += panel(80, 430, 1060, 450, f === "curve" ? GOLD : null, f !== "curve");
      const mx = Math.max(...u.curve), bw = 130;
      s += dimG(f === "curve", T(130, 495, u.curveTitle, { size: fit(u.curveTitle, 960, 38), weight: 900 }) + u.curve.map((n, i) => {
        const h = n / mx * 210, bx = 150 + i * 160;
        return `<rect x="${bx}" y="${790 - h}" width="${bw}" height="${h}" rx="10" fill="${i === 1 ? GOLD : BLUE}"/>` + T(bx + bw / 2, 780 - h, String(n), { size: 44, weight: 900, anchor: "middle", fill: i === 1 ? "#FFD23F" : PAPER }) +
          T(bx + bw / 2, 845, u.curveLabels[i], { size: fit(u.curveLabels[i], bw + 20, 32), weight: 700, anchor: "middle", fill: MUTED });
      }).join(""));
      // 色（右下）
      s += panel(1170, 430, 670, 450, f === "colors" ? GOLD : null, f !== "colors");
      s += dimG(f === "colors", T(1505, 500, u.colorTitle, { size: 44, weight: 900, anchor: "middle" }) +
        // 土地のカード画像（平地・島など）と枚数。色の記号だと、その色の呪文と見分けにくいため
        u.colorLands.map(([name, n, label], i) => cardImg(name, 1215 + i * 315, 530, 130, label) + TS(1360 + i * 315, 680, `×${n}`, { size: 68, fill: "#FFD23F" })).join("") +
        T(1505, 845, u.colorNote, { size: fit(u.colorNote, 620, 30), weight: 700, anchor: "middle", fill: MUTED }));
      return frame(s, sc);
    }
    case "removal": {
      const u = ui.removal, f = v.focus;
      let s = panel(80, 140, 900, 740, f === "what" ? GOLD : null) +
        T(530, 220, u.title, { size: 64, weight: 900, anchor: "middle", fill: "#FFD23F" }) + T(530, 280, u.def, { size: fit(u.def, 820, 34), weight: 700, anchor: "middle" });
      u.cards.forEach(([en, ja, what], i) => {
        const x = 150 + i * 400;
        s += cardImg(en, x, 320, 340, ja || en) + T(x + 170, 830, what, { size: fit(what, 380, 32), weight: 900, anchor: "middle", fill: "#FFD23F" });
      });
      s += panel(1010, 140, 830, 740, f === "why" ? GOLD : null, f !== "why");
      s += dimG(f === "why", u.reasons.map((r, i) => { const y = 300 + i * 200; return badge(1090, y - 16, i + 1, GOLD, 36) + T(1150, y, r, { size: fit(r, 660, 44), weight: 900 }); }).join(""));
      return frame(s, sc);
    }
    case "rarity": {
      const u = ui.rarity, f = v.focus;
      let s = panel(80, 140, 880, 740, f === "rarity" ? GOLD : null, f !== "rarity");
      s += dimG(f === "rarity", u.tiers.map(([n, d, col], i) => { const y = 250 + i * 135;
        return `<path d="M150 ${y - 40} l36 -24 l36 24 l-36 52 z" fill="${col}" stroke="${PAPER}" stroke-width="3"/>` + T(250, y, n, { size: 46, weight: 900 }) + T(250, y + 46, d, { size: fit(d, 680, 30), fill: MUTED, weight: 700 }); }).join("") +
        T(520, 830, u.note, { size: 50, weight: 900, anchor: "middle", fill: "#FFD23F" }));
      s += panel(990, 140, 850, 740, f === "rate" ? GOLD : null, f !== "rate");
      // 勝率の目安：平均の棒と、+3ポイントの棒
      s += dimG(f === "rate", T(1415, 230, u.rateTitle, { size: fit(u.rateTitle, 780, 42), weight: 900, anchor: "middle" }) +
        `<rect x="1120" y="400" width="200" height="240" rx="12" fill="#6F8FC8"/><rect x="1500" y="320" width="200" height="320" rx="12" fill="${GOLD}"/>` +
        `<line x1="1080" x2="1760" y1="400" y2="400" stroke="${PAPER}" stroke-width="3" stroke-dasharray="12 8"/>` +
        T(1220, 690, L("平均", "Average"), { size: 38, weight: 900, anchor: "middle" }) + T(1600, 690, L("強いカード", "Strong card"), { size: 38, weight: 900, anchor: "middle", fill: "#FFD23F" }) +
        TS(1600, 300, "+3", { size: 64, anchor: "middle", fill: "#FFD23F" }) +
        T(1415, 770, u.rateRule, { size: fit(u.rateRule, 780, 32), weight: 900, anchor: "middle" }) + T(1415, 830, u.where, { size: fit(u.where, 780, 26), weight: 700, anchor: "middle", fill: MUTED }));
      return frame(s, sc);
    }
    case "practice": {
      const u = ui.practice;
      let s = TS(W / 2, 220, u.title, { size: fit(u.title, 1700, 72), anchor: "middle" }) + T(W / 2, 290, u.url + (u.where ? `　${u.where}` : ""), { size: 44, weight: 900, anchor: "middle", fill: "#FFD23F" });
      u.tools.forEach(([n, d, tag], i) => {
        const x = 110 + (i % 2) * 860, y = 340 + Math.floor(i / 2) * 270;
        s += panel(x, y, 820, 240, tag === "PC" ? null : GREEN) + T(x + 50, y + 100, n, { size: fit(n, 560, 56), weight: 900 }) + T(x + 50, y + 170, d, { size: fit(d, 720, 32), weight: 700, fill: MUTED }) +
             `<rect x="${x + 620}" y="${y + 50}" width="160" height="66" rx="33" fill="${tag === "PC" ? BLUE : GREEN}"/>` + T(x + 700, y + 96, tag, { size: 36, weight: 900, anchor: "middle", fill: tag === "PC" ? PAPER : DEEP });
      });
      return frame(s, sc);
    }
    case "summary": {
      const u = ui.summary;
      let s = TS(W / 2, 230, u.title, { size: 96, anchor: "middle", fill: "#FFD23F" }) + panel(220, 290, 1480, 580, null);
      u.points.forEach((p, i) => { const y = 400 + i * 125;
        s += `<circle cx="310" cy="${y - 16}" r="30" fill="${GREEN}"/><path d="M296 ${y - 16} l10 12 l20 -24" stroke="${DEEP}" stroke-width="7" fill="none" stroke-linecap="round"/>` + T(370, y, p, { size: fit(p, 1280, 52), weight: 900 }); });
      return frame(s, sc);
    }
    case "outro": {
      const u = ui.outro;
      return frame(TS(W / 2, 260, u.l1, { size: fit(u.l1, 1700, 84), anchor: "middle" }) + TS(W / 2, 400, u.l2, { size: fit(u.l2, 1700, 100), anchor: "middle", fill: "#FFD23F" }) +
        (STILLS ? `<g transform="translate(${W / 2 - 320} 450)"><rect x="3" y="3" width="634" height="124" rx="62" fill="#E53935" stroke="#FFFFFF" stroke-width="6"/>` + T(320, 86, u.button, { size: 56, weight: 900, anchor: "middle", fill: "#FFFFFF" }) + `</g>` : ""), sc, { header: false });
    }
  }
  return frame("", sc);
}
/* 締めの登録ボタン（動く層）。セリフのあいだに下から浮き上がり、小さく跳ね続ける（長尺と同じ） */
function popLayer(sc, ui){
  if(sc.layout !== "outro" || !sc.subscribe) return null;
  const w = 640, h = 130;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SCALE}" height="${h * SCALE}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">` +
    `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="62" fill="#E53935" stroke="#FFFFFF" stroke-width="6"/>` +
    T(w / 2, 86, ui.outro.button, { size: 56, weight: 900, anchor: "middle", fill: "#FFFFFF" }) + `</svg>`;
  return { svg, w, h, x: W / 2 - w / 2, y: 450 };
}

/* ------------------------------------------------------------ 字幕（長尺と同じ作り） */

let CAPBOX = { x0: 120, bw: W - 240, size: 42 };
function capLineMax(){ return Math.floor((CAPBOX.bw - 70) / (CAPBOX.size * (EN ? 0.55 : 1))); }
function capPages(text){
  if(EN){
    const maxE = capLineMax() * 2 - 6, sentsE = text.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean), piecesE = [];
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
  const lineMax = capLineMax();
  const okPage = pg => { const ch = [...pg]; if(ch.length <= lineMax) return true;
    return ch.some((c, i) => (c === "、" || c === "。") && i + 1 <= lineMax && ch.length - (i + 1) <= lineMax && i + 1 < ch.length); };
  const sents = text.split(/(?<=。)/).map(s => s.trim()).filter(Boolean), pieces = [];
  for(const s of sents){
    if(okPage(s)){ pieces.push(s); continue; }
    let cur = "";
    for(const part of s.split(/(?<=、)/)){ if(cur && !okPage(cur + part)){ pieces.push(cur); cur = part; } else cur += part; }
    if(cur) pieces.push(cur);
  }
  const pages = []; let cur = "";
  for(const p of pieces){ if(cur && !okPage(cur + p)){ pages.push(cur); cur = p; } else cur += p; }
  if(cur) pages.push(cur);
  return pages;
}
function capSvg(page){
  const chars = [...page], half = Math.ceil(chars.length / 2), lineMax = capLineMax();
  let lines = [page];
  if(chars.length > lineMax){
    const cands = chars.map((c, i) => (EN ? c === " " : (c === "、" || c === "。")) ? (EN ? i : i + 1) : -1).filter(i => i > 0 && i < chars.length);
    const fits = cands.filter(i => i <= lineMax && chars.length - i <= lineMax).sort((a, b) => Math.abs(a - half) - Math.abs(b - half));
    const idx = fits[0] ?? (cands.sort((a, b) => Math.abs(a - half) - Math.abs(b - half))[0] ?? half);
    lines = [chars.slice(0, idx).join("").trim(), chars.slice(idx).join("").trim()];
  }
  const longest = Math.max(...lines.map(l => [...l].length)), fs = Math.min(CAPBOX.size, Math.floor((CAPBOX.bw - 70) / (longest * (EN ? 0.55 : 1))));
  const lh = 56, boxH = lines.length * lh + 44, x0 = CAPBOX.x0, bw = CAPBOX.bw, cx = x0 + bw / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H - CAP_Y}" viewBox="0 0 ${W} ${H - CAP_Y}" font-family="${FONT}">
  <defs><linearGradient id="ffw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A4FC4"/><stop offset="1" stop-color="#0B1763"/></linearGradient></defs>
  <rect x="${x0 + 5}" y="8" width="${bw}" height="${boxH}" rx="18" fill="#000" opacity="0.4"/>
  <rect x="${x0}" y="3" width="${bw}" height="${boxH}" rx="18" fill="url(#ffw)" stroke="#F4F7FF" stroke-width="5"/>
  <rect x="${x0 + 10}" y="13" width="${bw - 20}" height="${boxH - 20}" rx="10" fill="none" stroke="#8FA8F0" stroke-width="2" opacity="0.8"/>
  ${lines.map((l, i) => `<text x="${cx + 2}" y="${52 + i * lh + 2}" font-size="${fs}" fill="#050B33" font-weight="700" text-anchor="middle">${esc(l)}</text>` + T(cx, 52 + i * lh, l, { size: fs, anchor: "middle", weight: 700 })).join("")}
  <polygon points="${x0 + bw - 54},${boxH - 26} ${x0 + bw - 30},${boxH - 26} ${x0 + bw - 42},${boxH - 10}" fill="#F4F7FF"/>
</svg>`;
}

/* ------------------------------------------------------------ 音声 */

let YOMI = [];
const toSpeech = text => { let t = String(text); for(const [s, y] of YOMI) t = t.split(s).join(y); return t; };
async function loadYomi(){
  try{ await fetch(`${VV}/version`); }
  catch(e){ throw new Error(`VOICEVOX ENGINE に接続できません（${VV}）。起動してから実行してください`); }
  const dict = await readJson("short/yomi.json", {});
  YOMI = Object.entries(dict).sort((a, b) => [...b[0]].length - [...a[0]].length);
}
/* 字幕のページを出す時刻の見積もりに使う「読む長さ」。日本語は VOICEVOX の audio_query のモーラの長さ、英語は文字数 */
const estCache = new Map();
async function speechLen(text){
  const t = String(text || "").trim();
  if(!t) return 0;
  if(estCache.has(t)) return estCache.get(t);
  let v = 0;
  if(EN || STILLS || FAKE){ for(const ch of t) v += /[0-9]/.test(ch) ? 4 : /[,.;:!?、。]/.test(ch) ? 3 : /\s/.test(ch) ? 0.6 : 1; }
  else{
    try{
      const q = await fetch(`${VV}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(toSpeech(t))}`, { method: "POST" });
      if(!q.ok) throw new Error(String(q.status));
      for(const ap of (await q.json()).accent_phrases || []){
        for(const m of ap.moras || []) v += (m.consonant_length || 0) + (m.vowel_length || 0);
        if(ap.pause_mora) v += (ap.pause_mora.consonant_length || 0) + (ap.pause_mora.vowel_length || 0);
      }
    }catch(e){ v = [...t].length * 0.12; }
  }
  estCache.set(t, v);
  return v;
}
/* 字幕のページが、say の何文字目から始まるか（空白は読み飛ばして突き合わせる）。合わなければ null */
function capStarts(pages, say){
  const out = []; let i = 0;
  const skipWs = () => { while(i < say.length && /\s/.test(say[i])) i++; };
  for(const pg of pages){
    skipWs(); out.push(i);
    for(const ch of pg){ if(/\s/.test(ch)) continue; skipWs(); if(say[i] !== ch) return null; i++; }
  }
  return out;
}
async function speak(text, wavPath){
  if(FAKE){
    const dur = Math.max(2, [...text].length / L(7.5, 14));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=0.3*sin(2*PI*220*t)*gt(sin(2*PI*2.7*t)\\,-0.2):s=24000`, "-t", dur.toFixed(2), wavPath]);
    return { kana: text, dur };
  }
  const q = await fetch(`${VV}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(toSpeech(text))}`, { method: "POST" });
  if(!q.ok) throw new Error(`audio_query ${q.status}`);
  const query = await q.json();
  query.speedScale = SPEED; query.postPhonemeLength = 0.25;
  const r = await fetch(`${VV}/synthesis?speaker=${SPEAKER}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
  if(!r.ok) throw new Error(`synthesis ${r.status}`);
  await writeFile(wavPath, Buffer.from(await r.arrayBuffer()));
  const kana = query.accent_phrases.map(p => p.moras.map(m => m.text).join("") + (p.pause_mora ? "、" : "")).join("");
  return { kana, dur: +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]).toString().trim() };
}
/* 英語の読み上げ（Kokoro）。モデルを1回だけ読み込んで、まとめて作る */
async function speakEnBatch(jobs){
  const py = `
import sys, json, os, soundfile as sf
from kokoro_onnx import Kokoro
D = os.environ["KOKORO_DIR"]
k = Kokoro(os.path.join(D, "kokoro-v1.0.onnx"), os.path.join(D, "voices-v1.0.bin"))
for job in json.load(sys.stdin):
    samples, sr = k.create(job["text"], voice=os.environ.get("KOKORO_VOICE", "af_heart"), speed=float(os.environ.get("KOKORO_SPEED", "1.0")), lang="en-us")
    sf.write(job["out"], samples, sr)
`;
  execFileSync(KOKORO_PY, ["-c", py], { input: JSON.stringify(jobs), env: { ...process.env, KOKORO_DIR }, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 26 });
  const durs = new Map();
  for(const j of jobs){
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", j.out, "-af", "apad=pad_dur=0.25", j.out + ".tmp.wav"]);
    execFileSync("mv", [j.out + ".tmp.wav", j.out]);
    durs.set(j.out, +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", j.out]).toString().trim());
  }
  return durs;
}

/* ------------------------------------------------------------ 右下のキャラクター（口パク・まばたき。長尺と同じ） */

const ZDIR = EN ? "short/metan" : (existsSync("short/zunda-hoodie/open_open.png") ? "short/zunda-hoodie" : "short/zunda");
const ZW = 245, ZH = 250;
async function zundaReady(){
  for(const e of ["open", "closed"]) for(const m of ["closed", "half", "open"]) if(!existsSync(`${ZDIR}/${e}_${m}.png`)) return false;
  return true;
}
function mouthStates(wavPath, len){
  const FPS = 15, n = Math.max(1, Math.ceil(len * FPS));
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", wavPath, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], { maxBuffer: 1 << 29 });
  const x = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2)), win = Math.floor(16000 / FPS), rms = [];
  for(let f = 0; f < n; f++){ let a = 0, c = 0; for(let i = f * win; i < Math.min(x.length, (f + 1) * win); i++){ a += x[i] * x[i]; c++; } rms.push(c ? Math.sqrt(a / c) : 0); }
  const sorted = [...rms].sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.9)] || 1;
  let st = rms.map(v => { const r = v / ref; return r < 0.16 ? "closed" : r < 0.5 ? "half" : "open"; });
  st = st.map((v, i) => { const a = st[i - 1] || v, b = st[i + 1] || v; return a === b ? a : v; });
  return { FPS, st };
}
async function zundaList(i, wavPath, len){
  const { FPS, st } = mouthStates(wavPath, len), lines = [];
  let last = null;
  st.forEach((m, f) => { const t = f / FPS, ph = (t + i * 0.9) % 3.6; last = `${ZDIR}/${ph > 3.45 ? "closed" : "open"}_${m}.png`; lines.push(`file '${resolve(last)}'`, `duration ${(1 / FPS).toFixed(4)}`); });
  lines.push(`file '${resolve(last)}'`);
  const list = `${OUT}/zunda-${i}.txt`; await writeFile(list, lines.join("\n"), "utf8");
  return list;
}

/* ------------------------------------------------------------ 材料（カード画像・マナシンボル・ロゴ） */

async function loadCard(name){
  const path = `${OUT}/card-${name.replace(/[^A-Za-z0-9]+/g, "_")}.jpg`;
  if(!existsSync(path)){
    let url = null;
    try{
      if(!EN){   // 日本語版は、日本語の印刷があればその画像（サイトの「MTGとは」のページと同じ探し方）
        const r = await fetch(`https://api.scryfall.com/cards/search?unique=prints&order=released&dir=desc&q=${encodeURIComponent(`!"${name}" lang:ja`)}`, { headers: { ...UA, Accept: "application/json" } });
        if(r.ok) for(const c of (await r.json()).data || []){ url = (c.image_uris || (c.card_faces && c.card_faces[0].image_uris) || {}).normal; if(url) break; }
      }
      if(!url){
        const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, { headers: { ...UA, Accept: "application/json" } });
        if(r.ok){ const c = await r.json(); url = (c.image_uris || (c.card_faces && c.card_faces[0].image_uris) || {}).normal; }
      }
      if(url){ const r = await fetch(url, { headers: UA }); if(r.ok) await writeFile(path, Buffer.from(await r.arrayBuffer())); }
    }catch(e){}
    await new Promise(res => setTimeout(res, 120));
  }
  if(existsSync(path)) CARD[name] = "data:image/jpeg;base64," + (await readFile(path)).toString("base64");
  console.error(`カード画像: ${name} … ${CARD[name] ? "あり" : "取れず（名前の札で代用）"}`);
}
async function loadSymbols(){
  for(const c of ["W", "U", "B", "R", "G"]){
    const p = `short/symbols/${c}.svg`;
    let svg = await readFile(p, "utf8").catch(() => null);
    if(!svg){
      try{ const r = await fetch(`https://svgs.scryfall.io/card-symbols/${c}.svg`, { headers: UA }); if(r.ok){ svg = await r.text(); await mkdir("short/symbols", { recursive: true }); await writeFile(p, svg, "utf8"); } }catch(e){}
    }
    if(svg){ const m = svg.match(/<svg([^>]*)>([\s\S]*)<\/svg>/); const vb = m && m[1].match(/viewBox="([^"]+)"/); if(m) SYM[c] = { inner: m[2], viewBox: vb ? vb[1] : "0 0 100 100" }; }
  }
}

/* ------------------------------------------------------------ 実行 */

async function main(){
  const book = await readJson(`${DIR}/${LANG}.json`, null);
  if(!book){ console.error(`${DIR}/${LANG}.json が読めません`); process.exit(1); }
  const ui = book.ui || {};
  HEADER = book.header || "";
  await mkdir(OUT, { recursive: true });
  const sharp = (await import("sharp")).default;

  // YouTube 用のサムネイル（maintenance/long-thumbnail.mjs。長尺と同じ形）。画像だけ確認するとき（GUIDE_STILLS=1）も作る
  //   背景：プレイ映像（short/bg.mp4）の1コマ（thumbnail.bgAt 秒。無ければ紺色）。セットに関係ない動画なので、セットの絵は使わない
  //   キャラクター：日本語はフード付きのずんだもん（いつもの顔。short/zunda-hoodie/thumb.png）、英語は四国めたん
  const makeThumbnail = async (book, total) => {
    try{
      const t = book.thumbnail || {}, min = String(Math.max(1, Math.round(total / 60)));
      let bg = null;
      if(HAS_BG){
        bg = `${OUT}/thumbnail-bg.jpg`;
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(Math.max(0, Math.min(+t.bgAt || 60, bgDur - 1))), "-i", BG, "-frames:v", "1", "-q:v", "2", bg]);
      }
      const character = (EN ? ["short/metan/open_open.png"] : ["short/zunda-hoodie/thumb.png", "short/zunda-hoodie/open_open.png", "short/zunda/open_open.png"]).find(f => existsSync(f)) || null;
      const sub = String(t.sub || "").replace("{min}", min);
      await makeLongThumbnail({ out: `${OUT}/thumbnail.jpg`, sharp, font: FONT, en: EN, bg, arenaLogo: existsSync("short/logo/arena.png") ? "short/logo/arena.png" : null,
        setLogo: null, setName: t.tag || "", label: t.label || L("リミテッド入門", "Limited Guide"), main: t.main || book.header || "", sub, cards: [], character });
      console.error(`サムネイル: ${OUT}/thumbnail.jpg（${t.main || ""}／${sub}）`);
    }catch(e){ console.error("サムネイルが作れませんでした:", String(e.message).slice(0, 300)); }
  };

  // 台本を場面にする：見出し（crumb）は直前の章を引き継ぐ。nofade で layout が同じなら、view は前の場面に上書きで足す
  const scenes = []; let chapter = "";
  for(const raw of book.scenes){
    const prev = scenes[scenes.length - 1];
    const sc = { ...raw };
    if(sc.chapter) chapter = sc.chapter;
    sc.crumb = chapter;
    if(prev && sc.nofade && prev.layout === sc.layout) sc.view = { ...(prev.view || {}), ...(sc.view || {}) };
    scenes.push(sc);
  }

  await loadSymbols();
  const cardNames = new Set();
  if(ui.anatomy && ui.anatomy.card) cardNames.add(ui.anatomy.card);
  for(const c of ((ui.removal && ui.removal.cards) || [])) cardNames.add(c[0]);
  for(const c of ((ui.types && ui.types.cards) || [])) cardNames.add(c[0]);
  for(const c of ((ui.deck && ui.deck.colorLands) || [])) cardNames.add(c[0]);
  for(const n of cardNames) await loadCard(n);
  const arenaBuf = await readFile("short/logo/arena.png").catch(() => null);
  if(arenaBuf) scenes.filter(sc => sc.layout === "title").forEach(sc => { sc.arenaLogo = "data:image/png;base64," + arenaBuf.toString("base64"); });

  // 背景のプレイ映像（長尺と同じ）
  let bgDur = 0;
  try{ bgDur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", BG]).toString().trim(); }catch(e){}
  HAS_BG = bgDur > 0;
  console.error(HAS_BG ? `背景: ${BG}` : "背景: 紺色（short/bg.mp4 が無い）");

  // BGM（長尺と同じ曲を使う。英語は long/bgm-en/ を先に）
  let bgm = null, bgmCredit = "";
  {
    const isAudio = f => /\.(mp3|m4a|wav|ogg)$/i.test(f);
    for(const dir of EN ? ["long/bgm-en", "long/bgm", "short/bgm"] : ["long/bgm", "short/bgm"]){
      const files = (await readdir(dir).catch(() => [])).filter(isAudio).sort();
      if(files.length){ bgm = `${dir}/${files[0]}`; bgmCredit = (await readJson(`${dir}/credits.json`, {}))[files[0]] || ""; break; }
    }
    console.error(bgm ? `BGM: ${bgm}` : "BGM: 無し");
  }

  // 音声
  const prev = await readJson(`${OUT}/script.json`, []);
  let enDurs = new Map();
  const spoken = sc => (EN ? sc.say : (sc.speak || sc.say));
  if(EN && !STILLS && !FAKE){
    const todo = [];
    for(const [i, sc] of scenes.entries()){
      const base = `${OUT}/scene-${i}`, old = prev[i];
      if(old && old.say === sc.say && old.dur && existsSync(base + ".wav")) continue;
      todo.push({ text: spoken(sc), out: base + ".wav" });
    }
    if(todo.length){ console.error(`英語の読み上げ: ${todo.length} 場面をまとめて作る`); enDurs = await speakEnBatch(todo); }
  }
  let yomiLoaded = false;
  for(const [i, sc] of scenes.entries()){
    const base = `${OUT}/scene-${i}`, old = prev[i];
    if(old && old.say === sc.say && old.speak === sc.speak && old.dur && existsSync(base + ".wav")){ sc.kana = old.kana; sc.dur = old.dur; continue; }
    if(STILLS){ sc.kana = sc.say; sc.dur = Math.max(3, [...sc.say].length / L(7, 14)); continue; }
    if(enDurs.has(base + ".wav")){ sc.kana = sc.say; sc.dur = enDurs.get(base + ".wav"); continue; }
    if(!EN && !FAKE && !yomiLoaded){ await loadYomi(); yomiLoaded = true; }
    const r = await speak(spoken(sc), base + ".wav");
    sc.kana = r.kana; sc.dur = r.dur;
  }
  await writeFile(`${OUT}/script.json`, JSON.stringify(scenes.map(s => ({ layout: s.layout, chapter: s.chapter, say: s.say, speak: s.speak, kana: s.kana, dur: s.dur })), null, 2), "utf8");

  const ZUNDA = !STILLS && await zundaReady();
  if(ZUNDA) CAPBOX = { x0: 50, bw: W - 50 - ZW - 70, size: 40 };
  console.error(ZUNDA ? `キャラクター: ${ZDIR}/` : "キャラクター: 出さない");

  const segs = [], chapters = []; let total = 0;
  const JOBS = Math.max(1, +process.env.GUIDE_JOBS || Math.min(4, Math.max(2, cpus().length + 1)));
  const running = new Set(); let jobErr = null;
  const runFfmpeg = args => new Promise((res, rej) => execFile("ffmpeg", args, { maxBuffer: 1 << 26 }, (e, so, se) => e ? rej(new Error(String(se || e.message).slice(-1500))) : res()));
  const launch = async (args, label) => {
    while(running.size >= JOBS){ await Promise.race(running); if(jobErr) throw jobErr; }
    const pr = runFfmpeg(args).then(() => console.error(label), e => { jobErr = jobErr || e; }).finally(() => running.delete(pr));
    running.add(pr);
  };
  for(const [i, sc] of scenes.entries()){
    if(jobErr) throw jobErr;
    const base = `${OUT}/scene-${i}`;
    const len = sc.dur + (sc.tail ?? 0.6);
    await sharp(Buffer.from(sceneSvg(sc, ui)), { density: 72 }).resize(W, H).png().toFile(base + ".png");
    // 字幕：ページが本文のどこから始まるかを探し、読む長さの見積もりの割合で時刻にする（長尺と同じ）
    const pages = capPages(sc.say), starts = capStarts(pages, sc.say);
    const whole = await speechLen(sc.say), LEAD = EN ? 0.05 : 0.1, TAIL = 0.25;
    const at = async pos => LEAD + (whole ? Math.min(1, (await speechLen(sc.say.slice(0, pos))) / whole) : 0) * Math.max(0, sc.dur - LEAD - TAIL);
    const nChars = pages.reduce((n, p) => n + [...p].length, 0) || 1;
    const caps = []; let t = 0, done = 0;
    for(const [k, pg] of pages.entries()){
      const n0 = done; done += [...pg].length;
      const a = k === 0 ? 0 : starts ? await at(starts[k]) : t;
      const b = k === pages.length - 1 ? len : starts ? await at(starts[k + 1]) : sc.dur * done / nChars;
      const f = `${base}-cap${k}.png`;
      await sharp(Buffer.from(capSvg(pg)), { density: 72 }).resize(W, H - CAP_Y).png().toFile(f);
      caps.push({ f, a, b: Math.max(b, a + 0.3) }); t = b;
      void n0;
    }
    if(sc.chapter) chapters.push({ at: total, title: sc.chapter });
    if(STILLS){ console.error(`${i} ${sc.layout} → ${base}.png`); total += len; continue; }

    const first = HAS_BG ? ["-stream_loop", "-1", "-ss", (total % bgDur).toFixed(2), "-i", BG] : ["-f", "lavfi", "-i", `color=c=0x0A2038:s=${W}x${H}:r=30`];
    const bgFilter = HAS_BG
      ? `[0:v]fps=30,scale=iw*sar:ih,setsar=1,scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},eq=saturation=0.7,gblur=sigma=1.25,setsar=1[b0];color=c=0x0A2038@0.6:s=${W / 4}x${H / 4}:r=30[tint];[b0][tint]overlay=shortest=1,scale=${W}:${H}:flags=bicubic[bg]`
      : `[0:v]null[bg]`;
    const zIn = ZUNDA ? ["-f", "concat", "-safe", "0", "-i", await zundaList(i, base + ".wav", len)] : [];
    const pop = popLayer(sc, ui);
    if(pop) await sharp(Buffer.from(pop.svg), { density: 72 }).png().toFile(base + ".pop.png");
    const inputs = [...first, "-framerate", "30", "-i", base + ".png", "-i", base + ".wav", ...caps.flatMap(c => ["-framerate", "30", "-i", c.f]), ...zIn, ...(pop ? ["-framerate", "30", "-i", base + ".pop.png"] : [])];
    const still = "format=yuva420p,loop=loop=-1:size=1:start=0,setpts=N/(30*TB)";
    const zx = W - 24 - ZW, zy = H - ZH;
    let fc = `${bgFilter};[1:v]${still}${sc.nofade || i === 0 ? "" : ",fade=t=in:d=0.2:alpha=1"}[fg];[bg][fg]overlay=shortest=1[${ZUNDA ? "vz" : "v0"}]` +
      (ZUNDA ? `;[${3 + caps.length}:v]fps=30,scale=${ZW}:${ZH},format=rgba[zz];[vz][zz]overlay=x=${zx}:y=${zy}:shortest=1[v0]` : "");
    caps.forEach((c, k) => { fc += `;[${3 + k}:v]${still}[c${k}];[v${k}][c${k}]overlay=0:${CAP_Y}:enable='between(t,${c.a.toFixed(2)},${c.b.toFixed(2)})':shortest=1[v${k + 1}]`; });
    let vlast = caps.length;
    if(pop){
      const pi = inputs.filter(a => a === "-i").length - 1;
      fc += `;[${pi}:v]${still},scale=${pop.w}:${pop.h},format=rgba,fade=t=in:d=0.25:alpha=1[pp];[v${vlast}][pp]overlay=x=${pop.x}:y='${pop.y}+60*max(0\\,1-t*4)-12*abs(sin(2.6*t))*min(1\\,t*4)':shortest=1[v${vlast + 1}]`;
      vlast++;
    }
    fc += `;[v${vlast}]format=yuv420p[v];[2:a]apad=pad_dur=${(len - sc.dur).toFixed(2)},afade=t=in:d=0.012,afade=t=out:st=${(len - 0.03).toFixed(3)}:d=0.03,aformat=sample_rates=48000:channel_layouts=stereo[a]`;
    await launch(["-y", "-loglevel", "error", ...inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", String(len),
      "-c:v", "libx264", "-preset", process.env.GUIDE_PRESET || "veryfast", "-crf", "22", "-threads", "0", "-c:a", "aac", "-b:a", "160k", base + ".mp4"], `${i} ${sc.layout.padEnd(9)} ${sc.dur.toFixed(1)}s → ${len.toFixed(1)}s`);
    segs.push(`file 'scene-${i}.mp4'`); total += len;
  }
  await Promise.all(running);
  if(jobErr) throw jobErr;

  // 目次・概要欄・題
  const ts = s => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };
  const chapterText = chapters.map(c => `${ts(c.at)} ${c.title}`).join("\n");
  await writeFile(`${OUT}/chapters.txt`, chapterText + "\n", "utf8");
  await writeFile(`${OUT}/title.txt`, book.title || "", "utf8");
  await writeFile(`${OUT}/description.txt`, String(book.description || "").replace("{chapters}", chapterText).replace("{bgm}", bgmCredit ? `BGM: ${bgmCredit}\n` : "") + "\n", "utf8");
  console.error(`目次:\n${chapterText.split("\n").map(x => "  " + x).join("\n")}`);
  await makeThumbnail(book, total);
  if(STILLS){ console.error(`画像だけ作りました。合計の目安 ${ts(total)}`); return; }

  await writeFile(`${OUT}/list.txt`, segs.join("\n"), "utf8");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${OUT}/list.txt`, "-c", "copy", "-movflags", "+faststart", bgm ? `${OUT}/nobgm.mp4` : `${OUT}/${LANG}.mp4`]);
  if(bgm){
    const vol = process.env.BGM_VOLUME || "0.08";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/nobgm.mp4`, "-stream_loop", "-1", "-i", bgm, "-filter_complex",
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 2).toFixed(2)}:d=2[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(total), "-movflags", "+faststart", `${OUT}/${LANG}.mp4`]);
  }
  console.error(`\n${OUT}/${LANG}.mp4  合計 ${ts(total)}（${total.toFixed(0)} 秒）`);
}

main().catch(e => { console.error("解説動画の作成に失敗しました:", e.message); process.exit(1); });
