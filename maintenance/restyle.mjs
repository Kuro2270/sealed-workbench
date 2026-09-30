/*
 * 全ページの配色を青基調に入れ替え、ナビをカテゴリ別に組み直す。
 * 1回だけ流す道具。リポジトリ直下の .html と maintenance/build-set-pages.mjs が対象。
 *
 *   node maintenance/restyle.mjs [--check]
 *
 * --check を付けると、書き換えずに何件当たるかだけ出す。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";

/* 色の置き換え。マナ・シンボルの色（--w/--u/--b/--r/--g/--m/--c）は意味があるので触らない */
const COLORS = [
  ["#23342E", "#10304F"],   // 見出しの地の色（深い緑 → 濃い青）
  ["#18241F", "#0A2038"],   // その一段暗い色
  ["#F3F5F1", "#F5F8FC"],   // 紙の色
  ["#E6EAE3", "#E8EEF6"],   // 紙の一段濃い色
  ["#0F1C17", "#0D1B2A"],   // 文字
  ["#63736C", "#5C7185"],   // 補助の文字
  ["#B8912F", "#2F7DF6"],   // 差し色（金 → 青）
  ["#CBD3CA", "#D3DFEB"],   // 罫線
  ["#B9C7C0", "#A9C2DE"],   // 見出しの中の説明文
  ["#CBD8D2", "#C6D9EE"],   // ナビの文字
  ["#3D544B", "#2C4D74"],   // 見出しの中の枠線
  ["#1A1405", "#FFFFFF"],   // 差し色の上に乗る文字
  ["#31473E", "#1A4A79"],   // ナビのホバー
  ["#547064", "#2F5E8F"],   // ナビのホバーの枠線
  ["#CBA33B", "#1F6AE0"],   // ボタンのホバー
  ["#6E7772", "#8FA3B5"],   // 押せないボタンの地
  ["#C3CAC6", "#CFDAE5"],   // 押せないボタンの文字
  ["#2B3833", "#2A3B4C"],   // レアリティ（コモン）
  ["#AEBDC4", "#9FB3C4"],   // レアリティ（アンコモン）
  ["#2F6B47", "#1E7A52"],   // 足りている数
  ["#3F7A4A", "#1E7A52"],   // 同上（別ページ）
  ["#E7EFEA", "#EAF1F9"],   // 濃い地の上の薄い文字
  ["#DCE6E0", "#DDE8F4"],
  ["#5E7469", "#6C8398"],
  ["#2E3D37", "#1F3346"],
  ["#3B4A44", "#33506B"],
  ["#384C42", "#215party"],  // 使わない（下で消す）
];
COLORS.pop();

/* 盤面（対戦卓）の毛氈の色。緑の卓は残したいので、青みのある落ち着いた色に寄せる */
const FELT = [
  ["#1C2B24", "#152A3D"],
  ["#16221D", "#101F2E"],
  ["#2F4239", "#25405A"],
  ["#2B3C34", "#1E3852"],
  ["#384C42", "#264566"],
  ["#0D1512", "#0A151F"]
];

/* 角の丸みと影。板のような見た目から、今どきの柔らかい面に変える */
const SHAPE = [
  ["--radius:3px", "--radius:8px"],
  ["border-bottom:4px solid var(--gold)", "border-bottom:3px solid var(--gold);box-shadow:0 10px 30px -18px rgba(8,26,48,.9)"],
  ["header{background:var(--pine);", "header{background:linear-gradient(135deg,var(--pine-deep) 0%,var(--pine) 55%,#17466F 100%);"],
  // サイト名は濃い青の上に乗るので、差し色より明るい水色にする
  ["letter-spacing:.04em;color:var(--gold)", "letter-spacing:.04em;color:#9CC8FF"],
  // ナビは数が増えたので、少し詰めて1行に収まりやすくする
  ["padding:8px 15px;border-radius:999px", "padding:7px 13px;border-radius:999px"],
  ["display:inline-flex;align-items:center;padding:8px 15px", "display:inline-flex;align-items:center;padding:7px 13px"]
];

export function restyle(text) {
  let out = text, n = 0;
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // マナ・シンボルの色を並べている行だけは触らない
    if (/--w:#|--u:#|--b:#/.test(lines[i])) continue;
    for (const [from, to] of [...COLORS, ...FELT]) {
      const re = new RegExp(from, "gi");
      const m = lines[i].match(re);
      if (m) { n += m.length; lines[i] = lines[i].replace(re, to); }
    }
  }
  out = lines.join("\n");
  for (const [from, to] of SHAPE) {
    if (out.includes(from)) { out = out.split(from).join(to); n++; }
  }
  return { text: out, n };
}

/* ---------- ナビをカテゴリ別に組み直す ---------- */
const NAV_CSS = `
  /* ナビはカテゴリごとにまとめる。小さな見出しを付けて、探す場所を分かりやすくする */
  nav{margin:0 0 18px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end}
  .ng{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding-left:16px;border-left:1px solid rgba(255,255,255,.16)}
  .ng:first-of-type{padding-left:0;border-left:none}
  .ng{position:relative;padding-top:17px}
  .ng:has(.ngs){padding-top:35px}
  .ngl{position:absolute;left:16px;top:0;white-space:nowrap;font-size:10.5px;font-weight:700;letter-spacing:.1em;color:#8FA9C6;text-transform:uppercase}
  .ng:first-of-type .ngl,.ng:first-of-type .ngs{left:0}
  .ngs{position:absolute;left:16px;top:17px;white-space:nowrap;font-size:11px;color:#8FA9C6;line-height:1.3}
  nav a .pcb{display:inline-block;margin-left:6px;padding:0 5px;border-radius:6px;font-size:9.5px;font-weight:700;letter-spacing:.06em;line-height:16px;vertical-align:1px;background:rgba(255,255,255,.14);color:#CFE3FA}
  nav a.on .pcb{background:rgba(255,255,255,.28);color:#fff}
  @media (max-width:760px){
    .ng{padding-left:0;border-left:none;width:100%} .ngl,.ngs{left:0}
  }`;

function navHtml(current) {
  // pc=true のものは「PC」の札を付ける（ログを読む機能はスマホでは使えない）
  const a = (href, key, label, pc) => pc
    ? `<a href="${href}"${href === current ? ' class="on"' : ""}><span data-i18n="${key}">${label}</span><b class="pcb" data-i18n="nav.pc">PC</b></a>`
    : `<a href="${href}"${href === current ? ' class="on"' : ""} data-i18n="${key}">${label}</a>`;
  return `<nav>
      <div class="ng"><span class="ngl" data-i18n="navgrp.start">はじめに</span>
        ${a("./guide.html", "nav.guide", "使い方")}</div>
      <div class="ng"><span class="ngl" data-i18n="navgrp.build">練習する</span><span class="ngs" data-i18n="navsub.build">仮想パックで1人でも、友人と対戦しても</span>
        ${a("./", "nav.sealed", "シールド練習")}
        ${a("./draft.html", "nav.draft", "ドラフト練習")}</div>
      <div class="ng"><span class="ngl" data-i18n="navgrp.assist">アリーナで使う</span><span class="ngs" data-i18n="navsub.assist">実戦のログを読んで助ける・PC専用</span>
        ${a("./assistant.html", "nav.assist", "ドラフト補助", true)}
        ${a("./sealed-assist.html", "nav.sassist", "シールド補助", true)}</div>
      <div class="ng"><span class="ngl" data-i18n="navgrp.data">データを見る</span>
        ${a("./ratings.html", "nav.ratings", "カード勝率一覧")}
        ${a("./reports.html", "nav.reports", "環境レポート")}</div>
      <div class="ng"><span class="ngl" data-i18n="navgrp.play">対戦する</span>
        ${a("./table.html", "nav.table", "対戦卓")}
        ${a("./swiss.html", "nav.swiss", "スイスドロー")}</div>
    </nav>`;
}

export function replaceNav(text, current) {
  const m = text.match(/<nav>[\s\S]*?<\/nav>/);
  if (!m) return { text, ok: false };
  let out = text.replace(m[0], navHtml(current));
  // ナビ用の CSS を、既存の nav の指定のすぐ後ろに足す
  if (!out.includes(".ngs{")) {
    out = out.replace(/(\n\s*nav a\.on\{[^\n]*\n)/, `$1${NAV_CSS}\n`);
  }
  return { text: out, ok: true };
}

/* ---------- 実行 ---------- */
const PAGE_SELF = {
  "index.html": "./", "draft.html": "./draft.html", "guide.html": "./guide.html",
  "ratings.html": "./ratings.html", "reports.html": "./reports.html", "swiss.html": "./swiss.html",
  "assistant.html": "./assistant.html", "table.html": "./table.html", "privacy.html": "./privacy.html",
  "404.html": ""
};

if (process.argv[1] && process.argv[1].endsWith("restyle.mjs")) {
  const check = process.argv.includes("--check");
  const files = (await readdir(".")).filter(f => f.endsWith(".html"));
  for (const f of files) {
    const src = await readFile(f, "utf8");
    let { text, n } = restyle(src);
    let navOk = false;
    if (f in PAGE_SELF) { const r = replaceNav(text, PAGE_SELF[f]); text = r.text; navOk = r.ok; }
    console.log(`${f}: 色 ${n}件${navOk ? " / ナビ 組み直し" : ""}`);
    if (!check && text !== src) await writeFile(f, text);
  }
  // セット別ページの雛形
  const mp = "maintenance/build-set-pages.mjs";
  const src = await readFile(mp, "utf8");
  const { text, n } = restyle(src);
  console.log(`${mp}: 色 ${n}件`);
  if (!check && text !== src) await writeFile(mp, text);
}
