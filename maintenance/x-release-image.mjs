/*
 * X の「新セットの告知」に添える画像（1200×675。X の横長の表示にそのまま収まる大きさ）を作る。
 *   左：セットのロゴ（assets/logo/<SET>.png があれば）とセット名、何ができるか。右：8人卓の図（友達とドラフトの共有画像と同じ）。
 *   ロゴがまだ無いセットは、色の丸を代わりに置く。
 * 役割はこれだけ。x-drafts.mjs から使う。sharp（画像の合成）が要る。
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PINE, GOLD, PAPER, MUTED, MANA, FONT_JA, FONT_EN, esc, tableSvg } from "./draw-parts.mjs";

const W = 1200, H = 675;
const LOGO_H = 96;

function svg(nameJa, hasLogo){
  const top = hasLogo ? 210 : 190;                 // ロゴがあるときは、その下から書く
  const nameSize = [...nameJa].length > 14 ? 30 : 34;
  const bullets = ["友達とドラフト（空いた席はCPU）", "CPU 7人とドラフト練習", "組んだデッキはアリーナにインポート"]
    .map((b, i) => `<g transform="translate(80 ${top + 236 + i * 44})">
      <circle cx="9" cy="-6" r="7" fill="${GOLD}"/>
      <text x="30" y="0" font-family="${FONT_JA}" font-size="24" fill="${PAPER}" opacity="0.92">${esc(b)}</text>
    </g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PINE}"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${GOLD}"/>
  ${hasLogo ? "" : `<g opacity="0.9">${MANA.map((c, i) => `<circle cx="${80 + i * 42}" cy="112" r="15" fill="${c}"/>`).join("")}</g>`}
  <text x="80" y="${top}" font-family="${FONT_JA}" font-size="${nameSize}" font-weight="700" fill="${MUTED}">【${esc(nameJa)}】</text>
  <text x="80" y="${top + 74}" font-family="${FONT_JA}" font-size="54" font-weight="800" fill="${PAPER}" letter-spacing="-1">ドラフト・シールドを</text>
  <text x="80" y="${top + 144}" font-family="${FONT_JA}" font-size="54" font-weight="800" fill="${PAPER}" letter-spacing="-1">無料で練習</text>
  <rect x="80" y="${top + 176}" width="120" height="4" rx="2" fill="${GOLD}"/>
  ${bullets}
  ${tableSvg({ cx: 970, cy: 360, R: 160, you: "あなた", cpu: "CPU", font: FONT_JA })}
  <text x="80" y="${H - 44}" font-family="${FONT_EN}" font-size="28" font-weight="700" fill="${GOLD}">sealed-workbench.com</text>
</svg>`;
}

/* set: セットコード、nameJa: 日本語のセット名、out: 書き出す場所（.png） */
export async function makeReleaseImage(set, nameJa, out){
  const sharp = (await import("sharp")).default;
  const logo = `assets/logo/${String(set).toUpperCase()}.png`;
  const hasLogo = existsSync(logo);
  let img = sharp(Buffer.from(svg(nameJa, hasLogo)), { density: 144 }).resize(W * 2, H * 2);
  if(hasLogo){
    const l = await sharp(logo).resize({ height: LOGO_H * 2 }).png().toBuffer();
    img = sharp(await img.png().toBuffer()).composite([{ input: l, left: 80 * 2, top: 48 * 2 }]);
  }
  await mkdir(dirname(out), { recursive: true });
  await img.png({ compressionLevel: 9 }).toFile(out);
  return out;
}
