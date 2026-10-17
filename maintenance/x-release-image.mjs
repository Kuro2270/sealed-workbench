/*
 * 新セットの告知に添える画像（1200×675。X・Bluesky の横長の表示にそのまま収まる大きさ）を作る。日本語版（X）と英語版（Bluesky）。
 *   背景：セットの絵（set-art.mjs。公式のキーアート、無ければカードの絵を3枚）。左側を暗くして、文字を読みやすくする。
 *         絵が取れなかったときは、いつもの紺の背景に、右側へ8人卓の図（友達とドラフトの共有画像と同じ）。
 *   左上にセットのロゴ（assets/logo/<SET>.png があれば）、その下にセット名と、何ができるか。
 * 役割はこれだけ。x-drafts.mjs（X）と release-post.mjs（Bluesky）から使う。sharp が要る。
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PINE, PINE_DEEP, GOLD, PAPER, MUTED, MANA, FONT_JA, FONT_EN, esc, tableSvg } from "./draw-parts.mjs";
import { setArt } from "./set-art.mjs";

const W = 1200, H = 675, S = 2;          // S倍の大きさで書き出す（細かい文字もにじまないように）
const LOGO_H = 96;

const TEXT = {
  ja: { name: n => `【${n}】`, l1: "ドラフト・シールドを", l2: "無料で練習", size: 54,
        bullets: ["友達とドラフト（空いた席はCPU）", "CPU 7人とドラフト練習", "組んだデッキはアリーナにインポート"], you: "あなた", font: FONT_JA },
  en: { name: n => n, l1: "Practise Draft & Sealed", l2: "for free", size: 52,
        bullets: ["Draft with friends (CPUs fill empty seats)", "Draft vs 7 CPUs", "Import your deck into MTG Arena"], you: "YOU", font: FONT_EN }
};

function svg(name, lang, hasLogo, hasArt){
  const t = TEXT[lang], font = t.font;
  const top = hasLogo ? 210 : 190;                 // ロゴがあるときは、その下から書く
  const nameSize = [...name].length > 14 ? 30 : 34;
  const shadow = hasArt ? ` filter="url(#sh)"` : "";
  const bullets = t.bullets.map((b, i) => `<g transform="translate(80 ${top + 236 + i * 44})">
      <circle cx="9" cy="-6" r="7" fill="${GOLD}"/>
      <text x="30" y="0" font-family="${font}" font-size="24" fill="${PAPER}"${shadow}>${esc(b)}</text>
    </g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${PINE_DEEP}" stop-opacity="0.94"/>
      <stop offset="0.45" stop-color="${PINE_DEEP}" stop-opacity="0.82"/>
      <stop offset="0.75" stop-color="${PINE_DEEP}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="${PINE_DEEP}" stop-opacity="0"/>
    </linearGradient>
    <filter id="sh" x="-5%" y="-30%" width="110%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.6"/></filter>
  </defs>
  ${hasArt ? `<rect width="${W}" height="${H}" fill="url(#fade)"/>` : `<rect width="${W}" height="${H}" fill="${PINE}"/>`}
  <rect x="0" y="0" width="${W}" height="10" fill="${GOLD}"/>
  ${hasLogo ? "" : `<g opacity="0.9">${MANA.map((c, i) => `<circle cx="${80 + i * 42}" cy="112" r="15" fill="${c}"/>`).join("")}</g>`}
  <text x="80" y="${top}" font-family="${font}" font-size="${nameSize}" font-weight="700" fill="${MUTED}"${shadow}>${esc(t.name(name))}</text>
  <text x="80" y="${top + 74}" font-family="${font}" font-size="${t.size}" font-weight="800" fill="${PAPER}" letter-spacing="-1"${shadow}>${esc(t.l1)}</text>
  <text x="80" y="${top + 144}" font-family="${font}" font-size="${t.size}" font-weight="800" fill="${PAPER}" letter-spacing="-1"${shadow}>${esc(t.l2)}</text>
  <rect x="80" y="${top + 176}" width="120" height="4" rx="2" fill="${GOLD}"/>
  ${bullets}
  ${hasArt ? "" : tableSvg({ cx: 970, cy: 360, R: 160, you: t.you, cpu: "CPU", font })}
  <text x="80" y="${H - 44}" font-family="${FONT_EN}" font-size="28" font-weight="700" fill="${GOLD}"${shadow}>sealed-workbench.com</text>
</svg>`;
}

/* set: セットコード、name: その言語のセット名、out: 書き出す場所（.jpg）、lang: ja | en
   small: true なら 1200×675（Bluesky のカード用。1MB までの決まりがあるため）、無ければ 2400×1350 */
export async function makeReleaseImage(set, name, out, lang = "ja", { small = false } = {}){
  const sharp = (await import("sharp")).default;
  const logo = `assets/logo/${String(set).toUpperCase()}.png`;
  const hasLogo = existsSync(logo);
  const art = await setArt(set, W * S, H * S);
  const layers = [{ input: await sharp(Buffer.from(svg(name, lang, hasLogo, !!art)), { density: 72 * S }).resize(W * S, H * S).png().toBuffer() }];
  if(hasLogo) layers.push({ input: await sharp(logo).resize({ height: LOGO_H * S }).png().toBuffer(), left: 80 * S, top: 48 * S });
  const base = art ? sharp(art.buf) : sharp({ create: { width: W * S, height: H * S, channels: 3, background: PINE } });
  await mkdir(dirname(out), { recursive: true });
  // 絵を使うので JPEG にする（PNG だと X の上限 5MB を超えることがある）
  const flat = await base.composite(layers).jpeg({ quality: 90 }).toBuffer();
  await (small ? sharp(flat).resize(W, H) : sharp(flat)).jpeg({ quality: small ? 85 : 88, mozjpeg: true }).toFile(out);
  return { out, art: art ? art.kind : "none" };
}
