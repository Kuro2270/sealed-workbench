#!/usr/bin/env node
/*
 * short/logo/ にある公式ロゴを、サイト用に軽くして assets/logo/ に書き出す。
 *   short/logo/arena.png … MTGアリーナのロゴ（ヘッダー用に、高さ80pxに）
 *   short/logo/<SET>.png … セットのロゴ（トップページ用に、幅480px以内に）
 * 元の画像は動画づくりでそのまま使うので、変えない。軽くしたものだけを、サイトの表示に使う。
 *   node maintenance/build-logos.mjs
 */
import { readdir, mkdir } from "node:fs/promises";
import sharp from "sharp";

const SRC = "short/logo", OUT = "assets/logo";
await mkdir(OUT, { recursive: true });
let n = 0;
for(const f of (await readdir(SRC).catch(() => []))){
  if(!/\.png$/i.test(f)) continue;
  const isArena = /^arena\.png$/i.test(f);
  const img = sharp(`${SRC}/${f}`).trim({ threshold: 1 });    // まわりの透明な余白を詰める
  const out = isArena ? img.resize({ height: 80, fit: "inside" }) : img.resize({ width: 480, height: 200, fit: "inside", withoutEnlargement: true });
  await out.png({ compressionLevel: 9, palette: true, quality: 92 }).toFile(`${OUT}/${f.replace(/\.png$/i, "").replace(/^arena$/i, "arena").toUpperCase() === "ARENA" ? "arena" : f.replace(/\.png$/i, "").toUpperCase()}.png`);
  n++;
}
console.log(`ロゴ ${n} 枚を ${OUT}/ に書きました。`);
