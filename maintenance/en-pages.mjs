/*
 * 日本語と英語で URL を分けているページの、共通の道具。役割はこれだけ（2026年11月から）。
 *   ・どのページが日英で分かれているか（i18n.js の EN_PAGES。ブラウザ側と同じ並びを使う）
 *   ・i18n.js の文言（ページの題・説明）
 *   ・英語のページの中のリンクを、英語版のページへ向ける（enLinks）
 * 英語版を作るのは build-en-pages.mjs。セット別ページ・入門ページ・商品ページの英語版も、書き出すときに enLinks を通す。
 */
import { readFileSync } from "node:fs";

const I18N_SRC = () => readFileSync("i18n.js", "utf8");

/* 日英で URL を分けているページ（サイトの直下の <名前>.html と <名前>.en.html） */
export function enPages(){
  const m = I18N_SRC().match(/const EN_PAGES = (\[[\s\S]*?\]);/);
  if(!m) throw new Error("i18n.js に EN_PAGES が見つかりませんでした");
  return new Function("return " + m[1])();
}

/* i18n.js の文言。t(key, lang) */
let STRINGS = null;
export function t(key, lang){
  if(!STRINGS){
    const m = I18N_SRC().match(/const STRINGS = (\{[\s\S]*?\n  \});/);
    if(!m) throw new Error("i18n.js に STRINGS が見つかりませんでした");
    STRINGS = new Function("return " + m[1])();
  }
  const e = STRINGS[key];
  return e ? (e[lang] ?? e.en ?? "") : "";
}

/* 英語のページの HTML の中の href を、英語版のページへ向ける。dir はそのページの置き場所（"" ＝サイトの直下、"sets" など）
   ・サイトの直下のページは EN_PAGES にあるものだけ。start/ goods/ sets/ の下は、もともと日英で分かれているので全部
   ・.html でないもの（画像・データ）と、外のサイトへのリンクは触らない */
const SPLIT_DIRS = ["start", "goods", "sets"];
export function enLinks(html, dir = ""){
  const pages = new Set(enPages());
  return html.replace(/href="([^"]*)"/g, (all, h) => {
    if(!h || /^(#|[a-z]+:|\/\/)/i.test(h)) return all;                     // ページ内・外のサイト・mailto など
    const [p, rest = ""] = h.split(/(?=[?#])/);
    let u; try{ u = new URL(p || "./", `https://x/${dir ? dir + "/" : ""}`); }catch(e){ return all; }
    const m = u.pathname.match(/^\/(?:([a-z]+)\/)?([^\/]*)$/);
    if(!m) return all;
    const d = m[1] || "", file = m[2];
    if(file && !/\.html$/.test(file)) return all;                         // 拡張子なし・ほかのファイルは触らない
    const base = (file || "index.html").replace(/\.html$/, "");
    if(/\.en$/.test(base)) return all;                                     // もう英語版
    if(d ? !SPLIT_DIRS.includes(d) : !pages.has(base)) return all;
    const to = base + ".en.html";
    const out = file ? p.replace(/[^\/]*$/, to) : p.replace(/\/?$/, "/") + to;   // 「./」「../」「/」のような、ファイル名なしの形にはファイル名を足す
    return `href="${out}${rest}"`;
  });
}
