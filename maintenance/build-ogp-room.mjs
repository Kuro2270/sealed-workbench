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

const W = 1200, H = 630;

const PINE = "#10304F", PINE_DEEP = "#0A2038", GOLD = "#2F7DF6", PAPER = "#F5F8FC", MUTED = "#A9C2DE";
const MANA = ["#E7CF86", "#7FB4D8", "#7A7480", "#DB8068", "#79A87F"];

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

const esc = s => s.replace(/[&<>]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));

function svgFor(lang){
  const t = TEXT[lang];
  const fontJa = "'Noto Sans CJK JP','Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic',sans-serif";
  const fontEn = "'DejaVu Sans','Noto Sans','Helvetica Neue',Arial,sans-serif";
  const font = lang === "ja" ? fontJa : fontEn;
  const titleSize = lang === "ja" ? 60 : 62;
  const subSize   = lang === "ja" ? 27 : 30;
  const bulletSize= lang === "ja" ? 23 : 25;

  /* 右側：8人卓。人の席（3つ）は明るく、CPU の席は暗く。真ん中にパック、周りに回す向きの矢印 */
  const cx = 960, cy = 330, R = 160;
  const humans = new Set([0, 3, 5]);
  const seats = Array.from({ length: 8 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 4;
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    if(humans.has(i)){
      const me = i === 0;
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <circle r="36" fill="${me ? GOLD : MANA[i % 5]}" stroke="${PAPER}" stroke-width="${me ? 4 : 0}"/>
        <circle cy="-9" r="10" fill="${PINE_DEEP}" opacity="0.85"/>
        <path d="M -17 18 Q 0 -4 17 18 Z" fill="${PINE_DEEP}" opacity="0.85"/>
        ${me ? `<text y="-48" text-anchor="middle" font-family="${font}" font-size="20" font-weight="700" fill="${PAPER}">${esc(t.you)}</text>` : ""}
      </g>`;
    }
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle r="31" fill="${PINE_DEEP}" stroke="${MUTED}" stroke-width="2" opacity="0.95"/>
      <text y="7" text-anchor="middle" font-family="${fontEn}" font-size="17" font-weight="700" fill="${MUTED}">${t.cpu}</text>
    </g>`;
  }).join("\n");
  const ring = R - 66;
  const arrow = `<g fill="none" stroke="${GOLD}" stroke-width="5" stroke-linecap="round" opacity="0.9">
      <path d="M ${cx + ring} ${cy} A ${ring} ${ring} 0 0 1 ${cx} ${cy + ring}"/>
      <path d="M ${cx - ring} ${cy} A ${ring} ${ring} 0 0 1 ${cx} ${cy - ring}"/>
    </g>
    <path d="M ${cx - 2} ${cy + ring - 11} L ${cx - 18} ${cy + ring} L ${cx - 2} ${cy + ring + 11} Z" fill="${GOLD}"/>
    <path d="M ${cx + 2} ${cy - ring - 11} L ${cx + 18} ${cy - ring} L ${cx + 2} ${cy - ring + 11} Z" fill="${GOLD}"/>`;
  const pack = `<g transform="translate(${cx} ${cy}) rotate(-8)">
      <rect x="-30" y="-42" width="60" height="84" rx="7" fill="${PINE_DEEP}" stroke="${GOLD}" stroke-width="3"/>
      <rect x="-21" y="-33" width="42" height="30" rx="4" fill="${MANA[3]}" opacity="0.55"/>
      <rect x="-21" y="6" width="42" height="5" rx="2.5" fill="${MUTED}" opacity="0.5"/>
      <rect x="-21" y="16" width="30" height="5" rx="2.5" fill="${MUTED}" opacity="0.4"/>
    </g>`;

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
  ${arrow}
  ${pack}
  ${seats}
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
