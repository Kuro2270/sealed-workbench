/*
 * 17Lands 公開データセット（game_data の CSV。gzip）を1行ずつ読むための道具。役割はこれだけ。
 * 勝率の集計（build-ratings.mjs）・全勝デッキの集計（build-trophies.mjs）・修正版の集計（build-trend.mjs）から使う。
 *
 *   for await (const cols of csvRows(url)) { … }   … 1行目（見出し）も含めて、列の配列を順に返す
 *   openLines(url)                                  … 展開した1行ずつの文字列を返す読み口（無いとき null）
 *   retryNetwork(fn, label)                         … 通信が途中で切れたときに、最初から読み直す
 *   csvUrl(set, format)                             … データセットの場所
 *
 * 通信が途中で切れたときは、読んでいる側（for await）にエラーとして届くようにしている（2026年11月）。
 * 以前は .pipe() でつないでいたため、切れたときのエラーがどこにも届かず、プログラムごと止まっていた。
 *
 * ファイルは数百MBになるため、展開しながら1行ずつ読む（全部をメモリに載せない）。
 * カード名にカンマが入るため、見出しの行は引用符を見て分ける。データの行は数字と短い文字だけなので、カンマで分ける。
 * 環境変数 L17_DATASET … データセットの置き場所を差し替える（確認用。file:// やローカルのパスも使える）
 */
import { createGunzip } from "node:zlib";
import { Readable, pipeline } from "node:stream";
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

/* 展開した1行ずつの読み口（for await (const line of …) で読む）。データセットが無ければ null。
   ・readline は使わない。readline は作った時点で読み始めるため、開いてから読み始めるまでに間があると（Scryfall を待つなど）
     見出しの行を取りこぼし、その間に通信が切れるとエラーの受け手がおらず、プログラムごと止まった（2026年11月）
   ・ここでは、読み始めるまで展開側で待たせておき、通信が切れたら、そのエラーを読む側（for await）に投げる（try/catch で受けられる） */
export async function openLines(url){
  const src = await openStream(url);
  if(!src) return null;
  const gz = createGunzip();
  let failed = null;
  pipeline(src, gz, e => { if(e) failed = e; });     // pipeline がどちらのエラーも受けるので、読み始める前に切れても止まらない
  return (async function* (){
    if(failed) throw failed;
    gz.setEncoding("utf8");
    let rest = "";
    const cut = t => t.endsWith("\r") ? t.slice(0, -1) : t;
    try{
      for await (const chunk of gz){
        const parts = (rest + chunk).split("\n");
        rest = parts.pop();
        for(const p of parts) yield cut(p);
      }
    }catch(e){ throw failed || e; }
    if(failed) throw failed;                          // 途中で切れて、展開側が黙って終わった場合も、失敗として扱う
    if(rest) yield cut(rest);
  })();
}

/* 通信の失敗かどうか（読み直せば直るもの）。データの中身の問題は読み直しても同じなので、ここには入れない */
export function isNetworkError(e){
  const codes = new Set(["UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
                         "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "Z_BUF_ERROR"]);
  for(let x = e; x; x = x.cause){
    if(codes.has(x.code)) return true;
    if(/terminated|fetch failed|other side closed|unexpected end of file/i.test(String(x.message || ""))) return true;
    if(/HTTP 5\d\d/.test(String(x.message || ""))) return true;
  }
  return false;
}

/* fn を実行し、通信の失敗なら少し待って最初からやり直す（全部で tries 回）。それ以外のエラーはそのまま投げる */
export async function retryNetwork(fn, label, { tries = 3, waitSec = 30 } = {}){
  for(let i = 1; ; i++){
    try{ return await fn(); }
    catch(e){
      if(i >= tries || !isNetworkError(e)) throw e;
      process.stderr.write(`  通信が途中で切れました（${label}：${e.message}）。${waitSec}秒後に読み直します（${i + 1}/${tries}回目）\n`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }
}

/* 1行ずつ列の配列を返す。データセットが無ければ何も返さずに終わる（呼ぶ側は見出しが来たかで判断する） */
export async function* csvRows(url){
  const rl = await openLines(url);
  if(!rl) return;
  let first = true;
  for await (const line of rl){
    if(!line) continue;
    if(first){ first = false; yield parseCsvLine(line); continue; }
    yield line.split(",");
  }
}
