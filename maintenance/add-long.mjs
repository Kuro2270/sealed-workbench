#!/usr/bin/env node
/*
 * 長尺の環境まとめ動画を、サイト（セット別ページ・環境レポート）に載せる登録をする。日本語のみ。
 *
 *   node maintenance/add-long.mjs TMT              … long/TMT/youtube.json（アップロード時の記録）と chapters.txt から登録
 *   node maintenance/add-long.mjs TMT <動画ID>      … 動画IDを指定して登録（youtube.json が無いとき）
 *   node maintenance/add-long.mjs TMT --remove      … 載せるのをやめる
 *
 * 結果は data/long.json に書く。ここに載せた時点でサイトに出るので、YouTube Studio で「公開」にしてから実行すること。
 * そのあと「セット別ページ」を作り直す workflow（または build-set-pages.mjs）を動かすと、sets/<SET>.html に反映される。
 * 環境レポート（reports.html）は data/long.json を直接読むので、ファイルを上げるだけで反映される。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const SET = (process.argv[2] || "").toUpperCase();
const arg = process.argv[3];
if(!SET){ console.error("使い方: node maintenance/add-long.mjs <SET> [動画ID | --remove]"); process.exit(1); }
const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch(e){ return f; } };
const all = await readJson("data/long.json", {});

if(arg === "--remove"){
  if(all[SET]) delete all[SET];
  await writeFile("data/long.json", JSON.stringify(all, null, 2) + "\n", "utf8");
  console.log(`${SET}: 長尺の登録を外しました`); process.exit(0);
}

const yt = await readJson(`long/${SET}/youtube.json`, {});
const id = arg || yt.videoId;
if(!id){ console.error(`動画IDが分かりません。long/${SET}/youtube.json が無いので、動画IDを指定してください。`); process.exit(1); }

const chText = await readFile(`long/${SET}/chapters.txt`, "utf8").catch(() => "");
const chapters = chText.split("\n").map(l => l.match(/^(\d+):(\d{2})\s+(.+)$/)).filter(Boolean).map(m => ({ at: +m[1] * 60 + +m[2], title: m[3].trim() }));
let duration;
try{
  const sec = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `long/${SET}/ja.mp4`]).toString().trim();
  if(sec > 0) duration = `PT${Math.floor(sec / 60)}M${Math.round(sec % 60)}S`;
}catch(e){}
const title = (await readFile(`long/${SET}/title.txt`, "utf8").catch(() => "")).trim() || yt.title || "";

all[SET] = { ...(all[SET] || {}), ja: { id, title, uploadedAt: (yt.uploadedAt || new Date().toISOString()).slice(0, 10), duration, chapters } };
await writeFile("data/long.json", JSON.stringify(all, null, 2) + "\n", "utf8");
console.log(`${SET}: 長尺を登録しました（動画 ${id}、目次 ${chapters.length} 件${duration ? "、" + duration : ""}）`);
if(!chapters.length) console.log("目次（long/" + SET + "/chapters.txt）が見つからなかったので、目次なしで載せます。");
console.log("YouTube で「公開」になっていることを確認してから、data/long.json をコミットしてください。");
