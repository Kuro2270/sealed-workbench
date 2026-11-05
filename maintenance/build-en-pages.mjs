#!/usr/bin/env node
/*
 * サイトの直下の、日英で URL を分けているページ（i18n.js の EN_PAGES）の英語版を作る。役割はこれだけ。
 *
 *   node maintenance/build-en-pages.mjs
 *
 *   ・日本語版（<名前>.html）は人が直すもの。ここでは、検索結果に出る部分（題・説明・正規の URL・言語の対応）だけを
 *     日本語で書き直す（<!-- seo --> の印の間。手で直さない）
 *   ・英語版（<名前>.en.html）は、日本語版を写して、言語・検索結果に出る部分を英語にし、ページの中のリンクを英語版へ向けたもの
 *   ・題と説明は i18n.js の文言（<html data-title data-desc> の鍵）を使う
 *   ・画面の言語は、i18n.js が <html data-page-lang> を見て決める（URL で決まる）
 *
 * 2026年11月：それまでは1つの URL で言語を切り替えていたため、英語の設定で見に来る検索エンジンに英語の題が載り、
 * 日本で検索しても英語の題が出ていた。日英で URL を分け、それぞれの言語で載るようにした。
 */
import { readFile, writeFile } from "node:fs/promises";
import { enPages, t, enLinks } from "./en-pages.mjs";

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const pretty = n => n === "index" ? `${SITE}/` : `${SITE}/${n}`;              // Cloudflare Pages は .html なしの形で配る
const urlOf = (name, lang) => lang === "en" ? pretty(`${name}.en`) : pretty(name);
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const SEO = /\n?<!-- seo:start[\s\S]*?<!-- seo:end -->/;

/* 検索結果・SNS のカードに出る部分。SNS のカードはスクリプトを動かさずに読むので、ここに書いておく */
function seoBlock(name, lang, title, desc, ogp){
  return [
    "<!-- seo:start（maintenance/build-en-pages.mjs が書く。手で直さない。文言は i18n.js） -->",
    desc ? `<meta name="description" content="${esc(desc)}">` : "",
    `<link rel="canonical" href="${urlOf(name, lang)}">`,
    `<link rel="alternate" hreflang="ja" href="${urlOf(name, "ja")}">`,
    `<link rel="alternate" hreflang="en" href="${urlOf(name, "en")}">`,
    `<link rel="alternate" hreflang="x-default" href="${urlOf(name, "ja")}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    desc ? `<meta property="og:description" content="${esc(desc)}">` : "",
    `<meta property="og:url" content="${urlOf(name, lang)}">`,
    `<meta property="og:image" content="${SITE}/${ogp}-${lang}.png">`,
    `<meta property="og:locale" content="${lang === "ja" ? "ja_JP" : "en_US"}">`,
    "<!-- seo:end -->"
  ].filter(Boolean).join("\n");
}

function localize(src, name, lang){
  const html = (src.match(/<html[^>]*>/) || [])[0];
  if(!html) throw new Error(`${name}.html に <html> がありません`);
  const key = a => (html.match(new RegExp(`${a}="([^"]+)"`)) || [])[1];
  const tk = key("data-title"), dk = key("data-desc"), ogp = key("data-ogp") || "ogp";
  const title = tk ? t(tk, lang) : "", desc = dk ? t(dk, lang) : "";
  if(!title) throw new Error(`${name}.html の題（data-title）の文言が i18n.js にありません`);
  const newHtml = html.replace(/\slang="[^"]*"/, "").replace(/\sdata-page-lang="[^"]*"/, "").replace(/^<html/, `<html lang="${lang}" data-page-lang="${lang}"`);
  let out = src.replace(html, newHtml)
    .replace(SEO, "")
    .replace(/\n?<meta name="description"[^>]*>/g, "")                   // 手で書いた説明があれば、印の中の1つにまとめる
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>\n${seoBlock(name, lang, title, desc, ogp)}`);
  if(lang === "en") out = enLinks(out, "");
  return out;
}

async function main(){
  const pages = enPages();
  let changed = 0;
  for(const name of pages){
    const src = await readFile(`${name}.html`, "utf8");
    for(const [lang, file] of [["ja", `${name}.html`], ["en", `${name}.en.html`]]){
      const out = localize(src, name, lang);
      let old = ""; try{ old = await readFile(file, "utf8"); }catch(e){}
      if(out !== old){ await writeFile(file, out, "utf8"); changed++; process.stderr.write(`書き直し: ${file}\n`); }
    }
  }
  process.stderr.write(`英語版のページ：${pages.length}ページ（書き直したファイル ${changed}）\n`);
}

main().catch(e => { console.error("英語版のページを作れませんでした:", e.message); process.exit(1); });
