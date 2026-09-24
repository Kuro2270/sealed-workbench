#!/usr/bin/env node
/*
 * SNS共有用のOGP画像（1200×630）を日本語版・英語版で作る。
 *
 *   node maintenance/build-ogp.mjs
 *
 * 出力: ogp-ja.png / ogp-en.png
 *
 * SVGを組み立てて PNG に変換する。変換には sharp を使い、
 * 入っていない環境では SVG のまま残して終了する（致命的ではない）。
 */

import { writeFile, unlink } from "node:fs/promises";

const W = 1200, H = 630;

const PINE = "#10304F", PINE_DEEP = "#0A2038", GOLD = "#2F7DF6", PAPER = "#F5F8FC", MUTED = "#A9C2DE";
const MANA = ["#E7CF86", "#7FB4D8", "#7A7480", "#DB8068", "#79A87F"];

const TEXT = {
  ja: {
    title: "リミテッド・ワークベンチ",
    sub: "MTGアリーナのリミテッドを無料で練習",
    bullets: ["シールド戦・ドラフトを何度でも", "17Landsの実戦データで勝率表示", "アリーナにそのままインポート"],
    domain: "sealed-workbench.com"
  },
  en: {
    title: "Limited Workbench",
    sub: "Free MTG Arena Limited practice",
    bullets: ["Sealed and draft, unlimited runs", "Real win rates from 17Lands data", "Export straight into Arena"],
    domain: "sealed-workbench.com"
  }
};

const esc = s => s.replace(/[&<>]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));

function svgFor(lang){
  const t = TEXT[lang];
  // 環境によって名前が違うので、候補を並べて最初に見つかったものを使わせる
  const fontJa = "'Noto Sans CJK JP','Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic',sans-serif";
  const fontEn = "'DejaVu Sans','Noto Sans','Helvetica Neue',Arial,sans-serif";
  const font = lang === "ja" ? fontJa : fontEn;
  const titleSize = lang === "ja" ? 52 : 68;
  const subSize   = lang === "ja" ? 27 : 32;
  const bulletSize= lang === "ja" ? 23 : 26;

  // 右側に置くカードの模式図
  const cards = [0, 1, 2].map((i) => {
    const x = 880 + i * 32, y = 168 + i * 24, rot = -8 + i * 8;
    return `<g transform="translate(${x} ${y}) rotate(${rot})">
      <rect width="190" height="266" rx="13" fill="${PINE_DEEP}" stroke="${GOLD}" stroke-width="3"/>
      <rect x="14" y="14" width="162" height="108" rx="8" fill="${MANA[i + 1]}" opacity="0.5"/>
      <rect x="14" y="138" width="162" height="8" rx="4" fill="${MUTED}" opacity="0.55"/>
      <rect x="14" y="156" width="126" height="8" rx="4" fill="${MUTED}" opacity="0.4"/>
      <rect x="14" y="174" width="144" height="8" rx="4" fill="${MUTED}" opacity="0.4"/>
      <rect x="45" y="214" width="100" height="32" rx="16" fill="${GOLD}"/>
      <text x="95" y="236" text-anchor="middle" font-family="${fontEn}" font-size="18"
            font-weight="700" fill="#1A1405">${[62, 58, 55][i]}.${[4, 1, 8][i]}%</text>
    </g>`;
  }).join("\n");

  const bullets = t.bullets.map((b, i) => `
    <g transform="translate(80 ${396 + i * 46})">
      <circle cx="9" cy="-6" r="7" fill="${GOLD}"/>
      <text x="30" y="0" font-family="${font}" font-size="${bulletSize}" fill="${PAPER}" opacity="0.92">${esc(b)}</text>
    </g>`).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PINE}"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${GOLD}"/>
  <g opacity="0.9">
    ${MANA.map((c, i) => `<circle cx="${80 + i * 42}" cy="112" r="15" fill="${c}"/>`).join("")}
  </g>
  <text x="80" y="232" font-family="${font}" font-size="${titleSize}" font-weight="800"
        fill="${PAPER}" letter-spacing="-1">${esc(t.title)}</text>
  <text x="80" y="296" font-family="${font}" font-size="${subSize}" fill="${MUTED}">${esc(t.sub)}</text>
  <rect x="80" y="330" width="120" height="4" rx="2" fill="${GOLD}"/>
  ${bullets}
  ${cards}
  <text x="80" y="566" font-family="${fontEn}" font-size="28" font-weight="700"
        fill="${GOLD}">${esc(t.domain)}</text>
</svg>`;
}

async function main(){
  let sharp = null;
  try{ sharp = (await import("sharp")).default; }
  catch(e){ process.stderr.write("sharp が無いため SVG のまま出力します\n"); }

  for(const lang of ["ja", "en"]){
    const svg = svgFor(lang);
    const svgPath = `ogp-${lang}.svg`;
    await writeFile(svgPath, svg, "utf8");

    if(sharp){
      await sharp(Buffer.from(svg), { density: 144 })
        .png({ compressionLevel: 9 })
        .toFile(`ogp-${lang}.png`);
      await unlink(svgPath).catch(() => {});
      process.stderr.write(`ogp-${lang}.png を生成（${W}×${H}）\n`);
    }else{
      process.stderr.write(`${svgPath} を生成\n`);
    }
  }
}

main().catch(e => {
  console.error("OGP画像の生成に失敗しました:", e.message);
  process.exit(1);
});
