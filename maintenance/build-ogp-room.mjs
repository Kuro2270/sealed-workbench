#!/usr/bin/env node
/*
 * 「友達とドラフト」の招待リンクを LINE・X・Discord などに貼ったときに出る画像（1200×630）を、日本語版・英語版で作る。
 *
 *   node maintenance/build-ogp-room.mjs
 *
 * 出力: ogp-room-ja.png / ogp-room-en.png
 *
 * サイト全体の画像（build-ogp.mjs）と同じ色・文字の組み方で、右側だけ「8人卓（人とCPU）」の図にしている。
 * 文言を変えたときに手で実行する（自動では動かさない）。
 */

import { writeFile, unlink } from "node:fs/promises";
import { PINE, GOLD, PAPER, MUTED, MANA, FONT_JA, FONT_EN, esc, tableSvg } from "./draw-parts.mjs";

const W = 1200, H = 630;

const TEXT = {
  ja: {
    title: "友達とドラフト",
    sub: "MTGアリーナのドラフトを、友達と8人卓で",
    bullets: ["リンクを開いて、名前を入れるだけ", "空いた席にはCPUが座ります", "組んだデッキはアリーナにインポート"],
    you: "あなた", cpu: "CPU",
    domain: "sealed-workbench.com"
  },
  en: {
    title: "Draft with friends",
    sub: "MTG Arena drafts with friends, 8 seats",
    bullets: ["Open the link and enter your name", "CPUs take the empty seats", "Import your deck into Arena"],
    you: "YOU", cpu: "CPU",
    domain: "sealed-workbench.com"
  }
};

function svgFor(lang){
  const t = TEXT[lang];
  const fontJa = FONT_JA, fontEn = FONT_EN;
  const font = lang === "ja" ? fontJa : fontEn;
  const titleSize = lang === "ja" ? 60 : 62;
  const subSize   = lang === "ja" ? 27 : 30;
  const bulletSize= lang === "ja" ? 23 : 25;

  /* 右側：8人卓（人とCPU）。図は draw-parts.mjs と共通 */
  const table = tableSvg({ cx: 960, cy: 330, R: 160, you: t.you, cpu: t.cpu, font });

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
  ${table}
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
    const svgPath = `ogp-room-${lang}.svg`;
    await writeFile(svgPath, svg, "utf8");
    if(sharp){
      await sharp(Buffer.from(svg), { density: 144 })
        .png({ compressionLevel: 9 })
        .toFile(`ogp-room-${lang}.png`);
      await unlink(svgPath).catch(() => {});
      process.stderr.write(`ogp-room-${lang}.png を生成（${W}×${H}）\n`);
    }else{
      process.stderr.write(`${svgPath} を生成\n`);
    }
  }
}

main().catch(e => {
  console.error("OGP画像の生成に失敗しました:", e.message);
  process.exit(1);
});
