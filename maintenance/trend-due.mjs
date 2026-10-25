#!/usr/bin/env node
/*
 * 修正版ショートを自動で作る日が来たセットを選ぶ（「ショート｜修正版の自動作成の起動」用）。役割はこれだけ（集計も動画もしない・Issue も立てない）。
 *
 *   node maintenance/trend-due.mjs       … 「SET<TAB>次にやること（data|short）<TAB>紙の発売日」を1行ずつ出す
 *     data  … 修正版のデータ（data/trends/<SET>_draft.json）がまだ無い → 「データ｜修正版の集計」を起こす
 *     short … データはある・修正版の動画がまだ無い → 「ショート｜修正版ショートを作る」を起こす
 *
 * 決まり
 *   ・紙の発売から TREND_FROM_DAY（既定 28）〜 TREND_UNTIL_DAY（既定 60）日のセット。
 *     1週目と「直近の1週間」が離れて、変化が見えるころ（長尺は14日目なので、その2週間後）
 *   ・確定版（17Lands の公開データセットから作った記事データ。data/articles/index.json にある）が出ている。
 *     修正版は公開データセット（1試合ごとの記録）から作るため、確定版が出るまでは待つ
 *   ・修正版の動画がまだ無い（data/videos.json か、配信前の data/videos/<SET>-<lang>-trend.json）
 *   同じセットで2回動画を作らないための確認（Issue の題）は、呼ぶ側のワークフローでする
 *
 * 紙の発売日は data/articles/index.json から取る。通信はしない。
 * 環境変数 TREND_NOW（YYYY-MM-DD）… 確認用に今日の日付を差し替える
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const FROM = +(process.env.TREND_FROM_DAY || 28), UNTIL = +(process.env.TREND_UNTIL_DAY || 60);
const NOW = process.env.TREND_NOW ? Date.parse(process.env.TREND_NOW + "T00:00:00Z") : Date.now();
const DAY = 86400000;
const readJson = async p => { try{ return JSON.parse(await readFile(p, "utf8")); }catch(e){ return null; } };

const idx = (await readJson("data/articles/index.json")) || {};
const released = {};
for(const a of idx.articles || []) if(a.set && a.mode === "draft" && a.released_at) released[String(a.set).toUpperCase()] = a.released_at;

const videos = (await readJson("data/videos.json")) || {};
const pending = new Set((await readdir("data/videos").catch(() => [])).filter(f => /-(ja|en)-trend\.json$/.test(f)).map(f => f.replace(/-(ja|en)-trend\.json$/, "")));
const hasTrend = s => pending.has(s) || Object.values(videos[s] || {}).some(l => l && l.trend && l.trend.id);

const jstToday = Date.parse(new Date(NOW + 9 * 3600000).toISOString().slice(0, 10));
for(const set of Object.keys(released).sort()){
  const day = Math.floor((jstToday - Date.parse(released[set])) / DAY);
  if(!(day >= FROM && day <= UNTIL)){ if(day >= 0 && day < FROM) console.error(`${set}: 発売から${day}日目（${FROM}日目から）`); continue; }
  if(hasTrend(set)){ console.error(`${set}: 修正版の動画はもうある`); continue; }
  const step = existsSync(`data/trends/${set}_draft.json`) ? "short" : "data";
  console.error(`${set}: 発売から${day}日目。${step === "data" ? "修正版のデータを作る" : "修正版の動画を作る"}`);
  console.log(`${set}\t${step}\t${released[set]}`);
}
