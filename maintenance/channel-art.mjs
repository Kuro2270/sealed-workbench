/*
 * チャンネル・アカウントのバナーとアイコン（YouTube・X・Bluesky 共通の見た目）を、SVG で描く。役割はこれだけ（画像にするのは make-channel-banner.mjs）。
 *
 *   bannerSvg({ W, H, safe, theme, text, mana, character, arenaLogo, charBottom })
 *     safe … どの端末でも必ず見える範囲 { x, y, w, h }。文字・マナ・キャラクターはすべてこの中に置く（外側は背景だけ）
 *     text … { title（チャンネル名）, label（赤い帯。動画のサムネイルと同じ） }
 *     character … { href（data URI）, w, h（元の画像の大きさ） }
 *     charBottom … キャラクターの下端（無ければ範囲の下端。X・Bluesky はバナーの下端まで伸ばす。胸から上の絵の切れ目が見えないように）
 *   iconSvg({ S, theme, mana, character }) … 丸く切り抜かれる前提のアイコン（キャラクターのまわりに5色のマナ）
 *
 * 見た目（2026年10月に作り直し）：
 *   バナー … 左に MTGアリーナのロゴ・チャンネル名・5色のマナと「リミテッド環境分析」の帯、右にキャラクター
 *   アイコン … キャラクター（フードのずんだもん／めたん）のまわりに、5色のマナを円く並べる
 */
import { MANA_ORDER } from "./mana-symbols.mjs";

export const FONT = "'Noto Sans CJK JP','Noto Sans JP',sans-serif";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
/* 文字の幅のめやす（全角 1、半角 0.56。フォントの大きさを掛けると px） */
const units = s => [...String(s)].reduce((n, ch) => n + (/[\x00-\x7F]/.test(ch) ? 0.56 : 1), 0);
const stroke = s => `stroke="#06101C" stroke-width="${Math.round(s * 0.14)}" stroke-linejoin="round" paint-order="stroke"`;

const defs = (t, W, H) => `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg[0]}"/><stop offset=".55" stop-color="${t.bg[1]}"/><stop offset="1" stop-color="${t.bg[2]}"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${t.accent}" stop-opacity=".35"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>
  </defs><rect width="${W}" height="${H}" fill="url(#bg)"/>`;

export function bannerSvg({ W, H, safe, theme, text, mana, character, arenaLogo, charBottom }){
  // 大きさの基準：YouTube のスマートフォンで見える範囲（1546×423）。範囲の縦横比が違うときは、収まるほうに合わせて縮め、縦の真ん中に置く
  const k = Math.min(safe.h / 423, safe.w / 1546), w = safe.w, h = 423 * k, x = safe.x, y = safe.y + (safe.h - h) / 2;
  // キャラクター：範囲の右端に。下端は charBottom（無ければ範囲の下端）
  const ch = (charBottom ?? y + h) - y, cw = Math.round(ch * character.w / character.h), cx = x + w - cw - 10 * k;
  // 文字：範囲の左から、キャラクターの手前まで
  const lx = x + 30 * k, tw = cx - 30 * k - lx;
  const ts = Math.min(104 * k, tw / units(text.title));
  const md = 76 * k, gap = 14 * k, my = y + 350 * k, rowW = 5 * md + 4 * gap;
  const ls = Math.min(52 * k, (tw - rowW - 30 * k - 60 * k) / units(text.label)), bw = units(text.label) * ls + 60 * k, bh = Math.max(84 * k, ls * 1.6), bx = lx + rowW + 30 * k;
  // 背景の柄：範囲の外側に、うすく大きなマナ（パソコン・テレビで見える部分のため）
  const pat = [[0.09, 0.2, "W"], [0.91, 0.8, "U"], [0.1, 0.8, "B"], [0.91, 0.2, "R"], [0.5, 0.12, "G"], [0.5, 0.9, "W"]]
    .map(([px, py, c]) => `<g opacity=".10">${mana(c, W * px, H * py, Math.min(W, H) * 0.18, { shadow: false })}</g>`).join("");
  const AH = 130 * k, AW = AH * 530 / 186;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="${FONT}">${defs(theme, W, H)}${pat}
  <ellipse cx="${cx + cw / 2}" cy="${y + h / 2}" rx="${420 * k}" ry="${300 * k}" fill="url(#glow)"/>
  ${arenaLogo ? `<image href="${arenaLogo}" x="${lx - 6 * k}" y="${y + 12 * k}" width="${AW}" height="${AH}"/>` : ""}
  <text x="${lx}" y="${y + 262 * k}" font-size="${ts}" font-weight="900" fill="#FFFFFF" ${stroke(ts)}>${esc(text.title)}</text>
  ${MANA_ORDER.map((c, i) => mana(c, lx + md / 2 + i * (md + gap), my, md)).join("")}
  <rect x="${bx}" y="${my - bh / 2}" width="${bw}" height="${bh}" rx="${20 * k}" fill="#D9412B" stroke="#FFFFFF" stroke-width="${5 * k}"/>
  <text x="${bx + bw / 2}" y="${my + ls * 0.36}" font-size="${ls}" font-weight="900" fill="#FFFFFF" text-anchor="middle">${esc(text.label)}</text>
  <image href="${character.href}" x="${cx}" y="${y}" width="${cw}" height="${ch}"/>
</svg>`;
}

export function iconSvg({ S, theme, mana, character }){
  const c = S / 2, k = S / 800;
  // キャラクター：顔が真ん中より少し上に来るように、胸から上を大きく
  //   下端がアイコンの下まで届くように（届かないと、絵の切れ目が見えるため）
  const top = c - 250 * k, ih = Math.max(580 * k * character.h / character.w, S - top + 4 * k), iw = ih * character.w / character.h;
  const ring = MANA_ORDER.map((m, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return mana(m, c + 318 * k * Math.cos(a), c + 318 * k * Math.sin(a), 110 * k); }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${defs(theme, S, S)}
  <clipPath id="cl"><circle cx="${c}" cy="${c}" r="${c}"/></clipPath>
  <g clip-path="url(#cl)"><ellipse cx="${c}" cy="${c}" rx="${330 * k}" ry="${330 * k}" fill="url(#glow)"/>
    <image href="${character.href}" x="${c - iw / 2}" y="${top}" width="${iw}" height="${ih}"/>${ring}</g>
</svg>`;
}
