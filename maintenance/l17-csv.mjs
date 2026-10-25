/*
 * 17Lands 公開データセット（game_data の CSV。gzip）を1行ずつ読むための道具。役割はこれだけ。
 * 修正版の集計（build-trend.mjs）から使う。
 *
 *   for await (const cols of csvRows(url)) { … }   … 1行目（見出し）も含めて、列の配列を順に返す
 *   csvUrl(set, format)                             … データセットの場所
 *
 * ファイルは数百MBになるため、展開しながら1行ずつ読む（全部をメモリに載せない）。
 * カード名にカンマが入るため、見出しの行は引用符を見て分ける。データの行は数字と短い文字だけなので、カンマで分ける。
 * 環境変数 L17_DATASET … データセットの置き場所を差し替える（確認用。file:// やローカルのパスも使える）
 */
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { createReadStream, existsSync } from "node:fs";

const BASE = process.env.L17_DATASET || "https://17lands-public.s3.amazonaws.com/analysis_data/game_data";
export const csvUrl = (set, format) => `${BASE}/game_data_public.${set}.${format}.csv.gz`;

/* 見出しの行（引用符の中のカンマは区切りにしない） */
export function parseCsvLine(line){
  const out = [];
  let cur = "", inQ = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(inQ){
      if(ch === '"'){ if(line[i + 1] === '"'){ cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    }else if(ch === '"') inQ = true;
    else if(ch === ","){ out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
export const isWin = s => s === "True" || s === "true" || s === "1";

/* 読み口。https なら取りに行き、それ以外（ローカルのファイル）はそのまま開く。無いとき（403・404）は null */
async function openStream(url){
  if(/^https?:/.test(url)){
    const res = await fetch(url);
    if(res.status === 403 || res.status === 404){ if(res.body) await res.body.cancel(); return null; }
    if(!res.ok) throw new Error(`ダウンロードに失敗しました（HTTP ${res.status}）: ${url}`);
    return Readable.fromWeb(res.body);
  }
  const p = url.replace(/^file:\/\//, "");
  return existsSync(p) ? createReadStream(p) : null;
}

/* 1行ずつ列の配列を返す。データセットが無ければ何も返さずに終わる（呼ぶ側は見出しが来たかで判断する） */
export async function* csvRows(url){
  const src = await openStream(url);
  if(!src) return;
  const rl = createInterface({ input: src.pipe(createGunzip()), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl){
    if(!line) continue;
    if(first){ first = false; yield parseCsvLine(line); continue; }
    yield line.split(",");
  }
}
