#!/usr/bin/env node
/*
 * short/logo/ にある公式ロゴを、サイト用に軽くして assets/logo/ に書き出す。
 *   short/logo/arena.png … MTGアリーナのロゴ（ヘッダー用に、高さ80pxに）
 *   short/logo/<SET>.png … セットのロゴ（トップページ用に、幅480px以内に）
 * 元の画像は動画づくりでそのまま使うので、変えない。軽くしたものだけを、サイトの表示に使う。
 *
 * jpg / webp で置かれたときの扱い（2026年10月〜）：
 *   jpg には透明が無いので、白い背景（ほぼ白）を透明にした png を short/logo/<SET>.png として書き出す（元の jpg は残す）。
 *   動画づくり（build-short / build-long）もサイトも png を読むので、以降は png があるものとして動く。
 *   すでに png があるときは、jpg は無視する（png が正）。
 *   node maintenance/build-logos.mjs
 */
import { readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import sharp from "sharp";

const SRC = "short/logo", OUT = "assets/logo";
await mkdir(OUT, { recursive: true });

/* jpg / webp → 白背景を透明にした png（short/logo/<stem>.png） */
async function toTransparentPng(src, dst){
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = new Uint8ClampedArray(data);
  for(let i = 0; i < px.length; i += 4){
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const minc = Math.min(r, g, b);
    // ほぼ白（3 色とも 235 以上）は透明に。白に近い縁は、白さに応じて半透明にして、ふちがギザギザにならないようにする
    if(minc >= 250) px[i + 3] = 0;
    else if(minc >= 225) px[i + 3] = Math.round(255 * (250 - minc) / 25);
  }
  await sharp(Buffer.from(px.buffer), { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(dst);
}

const files = await readdir(SRC).catch(() => []);
let made = 0;
for(const f of files){
  if(!/\.(jpe?g|webp)$/i.test(f)) continue;
  const stem = f.replace(/\.(jpe?g|webp)$/i, "");
  const png = `${SRC}/${stem}.png`;
  if(existsSync(png)) continue;                       // png があればそちらが正
  await toTransparentPng(`${SRC}/${f}`, png);
  console.log(`${f} → ${stem}.png（白い背景を透明にした）`);
  made++;
}

let n = 0;
for(const f of (await readdir(SRC).catch(() => []))){
  if(!/\.png$/i.test(f)) continue;
  const isArena = /^arena\.png$/i.test(f);
  const img = sharp(`${SRC}/${f}`).trim({ threshold: 1 });    // まわりの透明な余白を詰める
  const out = isArena ? img.resize({ height: 80, fit: "inside" }) : img.resize({ width: 480, height: 200, fit: "inside", withoutEnlargement: true });
  const stem = f.replace(/\.png$/i, "");
  await out.png({ compressionLevel: 9, palette: true, quality: 92 }).toFile(`${OUT}/${isArena ? "arena" : stem.toUpperCase()}.png`);
  n++;
}
console.log(`ロゴ ${n} 枚を ${OUT}/ に書きました。${made ? `（jpg/webp から png を ${made} 枚作りました）` : ""}`);
