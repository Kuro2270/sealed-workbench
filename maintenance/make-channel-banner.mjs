#!/usr/bin/env node
/*
 * YouTube・X・Bluesky の、バナーとアイコンの画像を作る。役割はこれだけ（各サービスへの設定は手作業）。
 * 日本語はずんだもん（フード付き）・紺、英語は四国めたん・緑（チャンネルのテーマカラー）。見た目は maintenance/channel-art.mjs。
 *
 *   node maintenance/make-channel-banner.mjs     … short/channel/ に、次の画像を日本語（ja）・英語（en）の両方作る
 *     youtube-banner-<ja|en>.png（2560×1440）  youtube-icon-<ja|en>.png（800×800）
 *     x-banner-<ja|en>.png（1500×500）         x-icon-<ja|en>.png（400×400）
 *     bluesky-banner-<ja|en>.png（3000×1000）  bluesky-icon-<ja|en>.png（1000×1000）
 *
 * バナーは、見る端末によって見える範囲が違う。文字・マナ・キャラクターは、どの端末でも見える範囲（下の SAFE）に収める。
 *   YouTube … スマートフォンでは中央の 1546×423 だけが見える
 *   X・Bluesky … 左下にアイコンが重なり、スマートフォンでは上下が少し切れるので、左の 28% と上下の 12% をあける
 * 必要なもの: sharp（npm install --no-save sharp）、日本語フォント（Noto Sans CJK JP）
 */
import { readFile, mkdir } from "node:fs/promises";
import { loadMana } from "./mana-symbols.mjs";
import { bannerSvg, iconSvg } from "./channel-art.mjs";

/* チャンネルごとの色（bg は背景のグラデーション（明→暗）、accent は光） */
const THEME = {
  ja: { bg: ["#17466F", "#10304F", "#0A2038"], accent: "#2F7DF6" },
  en: { bg: ["#1C6B47", "#124A32", "#0A2E1F"], accent: "#2FB67A" }
};
const TEXT = {
  ja: { character: "short/zunda-hoodie/thumb.png", title: "リミテッドワークベンチ", label: "リミテッド環境分析" },
  en: { character: "short/metan/open_open.png", title: "Limited Workbench", label: "Limited Format Analysis" }
};
/* サービスごとの大きさと、必ず見える範囲 */
const third = (W, H) => ({ x: Math.round(W * 0.28), y: Math.round(H * 0.12), w: Math.round(W * 0.7), h: Math.round(H * 0.76) });
const TARGETS = [
  { name: "youtube", banner: [2560, 1440], safe: (W, H) => ({ x: (W - 1546) / 2, y: (H - 423) / 2, w: 1546, h: 423 }), icon: 800 },
  { name: "x", banner: [1500, 500], safe: third, icon: 400, toBottom: true },
  { name: "bluesky", banner: [3000, 1000], safe: third, icon: 1000, toBottom: true }
];

const sharp = (await import("sharp")).default;
const mana = await loadMana();
const uri = buf => "data:image/png;base64," + buf.toString("base64");
const arenaLogo = uri(await readFile("short/logo/arena.png"));
await mkdir("short/channel", { recursive: true });

for(const lang of ["ja", "en"]){
  const t = TEXT[lang], theme = THEME[lang];
  const buf = await readFile(t.character), meta = await sharp(buf).metadata();
  const character = { href: uri(buf), w: meta.width, h: meta.height };
  for(const tg of TARGETS){
    const [W, H] = tg.banner;
    const b = `short/channel/${tg.name}-banner-${lang}.png`, i = `short/channel/${tg.name}-icon-${lang}.png`;
    await sharp(Buffer.from(bannerSvg({ W, H, safe: tg.safe(W, H), theme, text: t, mana, character, arenaLogo, charBottom: tg.toBottom ? H : undefined }))).png({ compressionLevel: 9 }).toFile(b);
    await sharp(Buffer.from(iconSvg({ S: tg.icon, theme, mana, character }))).png({ compressionLevel: 9 }).toFile(i);
    console.log(`${b}（${W}×${H}）／${i}（${tg.icon}×${tg.icon}）`);
  }
}
