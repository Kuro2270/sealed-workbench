#!/usr/bin/env node
/*
 * sitemap.xml と robots.txt を作る。
 *
 *   node maintenance/build-seo.mjs
 *
 * ・リポジトリ直下の .html を自動で拾うので、ページを足せば勝手に載る
 * ・日本語版と英語版を hreflang で相互にひもづける（同じURLの2言語なので x-default も付ける）
 * ・更新日は data/ratings/index.json の生成日時を使う
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const ROOT = ".";

// 検索結果に出したい順（大きいほど優先）
const PRIORITY = {
  "index.html": "1.0",
  "guide.html": "0.9",
  "ratings.html": "0.8",
  "reports.html": "0.9",
  "draft.html": "0.8",
  "swiss.html": "0.7",
  "assistant.html": "0.7",
  "privacy.html": "0.3"
};

const urlOf = f => f === "index.html" ? SITE + "/" : `${SITE}/${f}`;

async function lastUpdated(){
  try{
    const j = JSON.parse(await readFile("data/ratings/index.json", "utf8"));
    if(j.generated_at) return j.generated_at.slice(0, 10);
  }catch(e){ /* 無ければ今日 */ }
  return new Date().toISOString().slice(0, 10);
}

async function main(){
  const files = (await readdir(ROOT))
    .filter(f => f.endsWith(".html"))
    .sort((a, b) => (PRIORITY[b] || "0.5").localeCompare(PRIORITY[a] || "0.5"));

  if(!files.length) throw new Error("HTMLファイルが見つかりませんでした");

  const day = await lastUpdated();

  const entries = files.map(f => {
    const loc = urlOf(f);
    // 同一URLで日英を切り替えるので、両言語とも同じURLを指す
    const alt = ["ja", "en"].map(l =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${loc}"/>`).join("\n");
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <lastmod>${day}</lastmod>`,
      "    <changefreq>monthly</changefreq>",
      `    <priority>${PRIORITY[f] || "0.5"}</priority>`,
      alt,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}"/>`,
      "  </url>"
    ].join("\n");
  });

  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
  await writeFile("sitemap.xml", xml, "utf8");

  const robots =
`User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
  await writeFile("robots.txt", robots, "utf8");

  process.stderr.write(`sitemap.xml を生成（${files.length}ページ／更新日 ${day}）\n`);
  files.forEach(f => process.stderr.write(`  ${urlOf(f)}\n`));
  process.stderr.write("robots.txt を生成\n");
}

main().catch(e => {
  console.error("SEOファイルの生成に失敗しました:", e.message);
  process.exit(1);
});
