/*
 * セットの「背景の絵」を1枚にして返す（YouTube のサムネイルと同じ考え方）。
 *   1. 公式のキーアートが置いてあれば、それ：short/bg/<SET>.jpg（png・webp も可）
 *   2. 無ければ、カードの絵（アート部分）を3枚、横に並べる
 *      ・勝率のデータ（data/articles/<SET>_draft.json）があれば、勝率上位のレア・神話レア3枚
 *      ・まだ無ければ（発売直後）、Scryfall の神話レアから3枚
 *   どれも取れなければ null（呼ぶ側で、いつもの紺の背景にする）。
 * 役割はこれだけ。X・Bluesky の告知の画像（x-release-image.mjs）から使う。sharp が要る。
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const UA = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" };
const readJson = async (p, f) => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return f; } };

async function keyArt(SET){
  for(const ext of ["jpg", "jpeg", "png", "webp"]){
    const f = `short/bg/${SET}.${ext}`;
    if(existsSync(f)) return readFile(f);
  }
  return null;
}

/* 背景に並べるカードの画像 URL（normal の大きさ。アート部分は art_crop に読み替える） */
async function cardImageUrls(SET){
  const d = await readJson(`data/articles/${SET}_draft.json`, null);
  const names = (await readJson(`data/names/${SET}.json`, {})).images || {};
  if(d && d.top){
    const top = [...(d.top.mythic || []), ...(d.top.rare || [])].sort((a, b) => b.gih - a.gih);
    const urls = top.map(c => names[c.name] || names[String(c.name).split(" // ")[0]]).filter(Boolean);
    if(urls.length >= 3) return urls.slice(0, 3);
  }
  try{
    const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${SET.toLowerCase()} r:mythic is:booster -t:land`)}&order=edhrec`, { headers: UA });
    if(!r.ok) return [];
    const j = await r.json();
    return j.data.map(c => (c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {}).normal).filter(Boolean).slice(0, 3);
  }catch(e){ return []; }
}

/* w×h の背景（JPEG の Buffer）。kind は "key"（公式の絵）か "cards"（カードの絵を並べたもの） */
export async function setArt(set, w, h){
  const sharp = (await import("sharp")).default;
  const SET = String(set).toUpperCase();
  const key = await keyArt(SET);
  if(key) return { kind: "key", buf: await sharp(key).resize(w, h, { fit: "cover", position: "attention" }).jpeg({ quality: 92 }).toBuffer() };
  const bufs = [];
  if(process.env.SET_ART_TEST){ for(const f of process.env.SET_ART_TEST.split(",")) bufs.push(await readFile(f)); }   // 見た目の確認用
  else for(const url of await cardImageUrls(SET)){
    try{
      const r = await fetch(url.replace("/normal/", "/art_crop/"), { headers: { "User-Agent": UA["User-Agent"] } });
      if(r.ok) bufs.push(Buffer.from(await r.arrayBuffer()));
    }catch(e){}
  }
  if(!bufs.length) return null;
  const pw = Math.ceil(w / bufs.length);
  const panels = await Promise.all(bufs.map(b => sharp(b).resize(pw, h, { fit: "cover", position: "attention" }).modulate({ saturation: 1.15 }).toBuffer()));
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: "#0A2038" } })
    .composite(panels.map((input, i) => ({ input, left: i * pw, top: 0 }))).jpeg({ quality: 92 }).toBuffer();
  return { kind: "cards", buf };
}
