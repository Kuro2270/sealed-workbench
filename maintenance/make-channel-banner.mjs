#!/usr/bin/env node
/*
 * YouTube チャンネルのバナー画像（2560×1440）を作る。日本語チャンネルはずんだもん（フード付き）・紺、英語チャンネルは四国めたん・緑（チャンネルのテーマカラー）。
 *
 *   node maintenance/make-channel-banner.mjs        … short/channel/banner-ja.png と banner-en.png を作る
 *
 * YouTube のバナーは、見る端末によって見える範囲が違う。スマートフォンでは中央の 1546×423 だけが見えるので、
 * 文字・アイコン・キャラクターはすべてこの範囲（下の SAFE）に収める。外側は、パソコンやテレビで見えるときのための背景だけ。
 * 必要なもの: sharp（npm install --no-save sharp）、日本語フォント（Noto Sans CJK JP）
 * 役割はこれだけ（YouTube へのアップロードは Studio で手作業）。
 */
import { readFile, mkdir } from "node:fs/promises";

const W = 2560, H = 1440;
const SAFE = { x: (W - 1546) / 2, y: (H - 423) / 2, w: 1546, h: 423 };   // スマートフォンでも必ず見える範囲
const FONT = "'Noto Sans CJK JP','Noto Sans JP',sans-serif";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/* チャンネルごとの色。bg は背景のグラデーション（明→暗）、accent はカードと光、sub は縁取りと背景の柄 */
const THEME = {
  ja: { bg: ["#17466F", "#10304F", "#0A2038"], accent: "#2F7DF6", accent2: "#4A93FF", side: "#3B4D66", edge: "#9FB3CC", sub: "#CFE0F5" },
  en: { bg: ["#1C6B47", "#124A32", "#0A2E1F"], accent: "#2FB67A", accent2: "#4CD394", side: "#35564A", edge: "#A6CDBB", sub: "#D3F0E2" }
};
const TEXT = {
  ja: { mascot: "short/zunda-hoodie/open_open.png", title: ["MTGアリーナ", "リミテッド・ワークベンチ"] },
  en: { mascot: "short/metan/open_open.png", title: ["MTG Arena", "Limited Workbench"] }
};

/* 文字の幅のめやす（全角 1、半角 0.56。フォントの大きさを掛けると px） */
const units = s => [...String(s)].reduce((n, ch) => n + (/[\x00-\x7F]/.test(ch) ? 0.56 : 1), 0);
const fitSize = (lines, w, max) => Math.min(max, Math.floor(w / Math.max(...lines.map(units))));

/* チャンネルのアイコンと同じ、3枚のカード */
function cards(x, y, h, c){
  const k = h / 300, cw = 150 * k, ch = 210 * k;
  return `<g transform="translate(${x} ${y})">
    <rect x="${20 * k}" y="${50 * k}" width="${cw}" height="${ch}" rx="${18 * k}" fill="${c.side}" stroke="${c.edge}" stroke-width="${5 * k}" transform="rotate(-12 ${95 * k} ${155 * k})"/>
    <rect x="${130 * k}" y="${50 * k}" width="${cw}" height="${ch}" rx="${18 * k}" fill="${c.side}" stroke="${c.edge}" stroke-width="${5 * k}" transform="rotate(12 ${205 * k} ${155 * k})"/>
    <rect x="${75 * k}" y="${30 * k}" width="${cw}" height="${ch + 20 * k}" rx="${18 * k}" fill="${c.accent}" stroke="${c.sub}" stroke-width="${6 * k}"/>
    <rect x="${95 * k}" y="${52 * k}" width="${cw - 40 * k}" height="${ch - 30 * k}" rx="${10 * k}" fill="${c.accent2}"/>
  </g>`;
}

async function make(lang, sharp){
  const t = TEXT[lang], c = THEME[lang];
  const mascot = await readFile(t.mascot);
  const MH = 405, MW = Math.round(MH * 372 / 380);
  const mx = SAFE.x + SAFE.w - MW - 10, my = SAFE.y + SAFE.h - MH + 6;   // キャラクターは右端。足もと側は範囲の下端に合わせる
  const iconH = 300, ix = SAFE.x + 30, iy = SAFE.y + (SAFE.h - iconH) / 2;
  const tx = ix + 300, tw = mx - 30 - tx;                                // 文字はアイコンとキャラクターのあいだ
  // 文字はチャンネル名だけ（説明やサイトのアドレスは載せない）。2行を、範囲の縦の真ん中に置く
  const ts = fitSize(t.title, tw, 112);
  const top = SAFE.y + (SAFE.h - ts * 2.15) / 2 + ts * 0.88;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg[0]}"/><stop offset=".55" stop-color="${c.bg[1]}"/><stop offset="1" stop-color="${c.bg[2]}"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${c.accent}" stop-opacity=".28"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="1100" ry="420" fill="url(#glow)"/>
  <g opacity=".07" fill="${c.sub}">${[...Array(9)].map((_, i) => `<rect x="${80 + i * 300}" y="${i % 2 ? 140 : 1040}" width="170" height="240" rx="18" transform="rotate(${i % 2 ? -10 : 10} ${165 + i * 300} ${i % 2 ? 260 : 1160})"/>`).join("")}</g>
  ${cards(ix, iy, iconH, c)}
  <text x="${tx}" y="${top}" font-size="${ts}" font-weight="900" fill="#FFFFFF">${esc(t.title[0])}</text>
  <text x="${tx}" y="${top + ts * 1.15}" font-size="${ts}" font-weight="900" fill="#FFFFFF">${esc(t.title[1])}</text>
</svg>`;
  await mkdir("short/channel", { recursive: true });
  const out = `short/channel/banner-${lang}.png`;
  const m = await sharp(mascot).resize(MW, MH).png().toBuffer();
  await sharp(Buffer.from(svg)).composite([{ input: m, left: Math.round(mx), top: Math.round(my) }]).png({ compressionLevel: 9 }).toFile(out);
  console.log(`${out}（文字の大きさ ${ts}px）`);
}

const sharp = (await import("sharp")).default;
for(const lang of ["ja", "en"]) await make(lang, sharp);
