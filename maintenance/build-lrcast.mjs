#!/usr/bin/env node
/*
 * r/lrcast 向けの投稿下書きを作る（英語）。
 *
 *   node maintenance/build-lrcast.mjs          … announce.json の新セット分
 *   node maintenance/build-lrcast.mjs HOB      … セットを指定して作り直す
 *
 * 出力: lrcast/<SET>.md（投稿文）, lrcast/<SET>.png（図。sharp が無ければ .svg）
 *       lrcast.md … その回ぶんをまとめたもの。ワークフローが Issue にする
 *
 * ・data/articles/<SET>_draft.json（無ければ sealed）の数字だけを使う。
 *   ここで新しく計算するのは「2色の期待値＝構成する2色の平均」だけ。
 * ・投稿そのものは人が行う。数字と言い回しに必ず目を通してから使うこと。
 * ・17Lands のデータを出すので、出典表記（CC BY 4.0）は本文から外さないこと。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const ARTICLES = "data/articles";
const OUT = "lrcast";

/* 図の色。dataviz の検証を通した組み合わせ */
const INK = "#1A1F2B", MUTED = "#5B6572", FAINT = "#98A1AE";
const GRID = "#E3E7EC", UP = "#2F6FD0", DOWN = "#D96A1E", REF = "#6B7280", SURFACE = "#FCFCFB";
const FONT = "'DejaVu Sans','Noto Sans','Helvetica Neue',Arial,sans-serif";

const COLOR_NAME = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const EVENT_NAME = {
  PremierDraft: "Premier", TradDraft: "Traditional", QuickDraft: "Quick",
  PickTwoDraft: "Pick-Two", Sealed: "Sealed", TradSealed: "Traditional Sealed"
};

const readJson = async (p, f) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { return f; } };
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const pt = v => (v * 100).toFixed(1);                       // 勝率を「56.7」の形に
const num = n => Number(n || 0).toLocaleString("en-US");
const ORD = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/* ------------------------------------------------------------------ 集計 */

/* 平均マナ総量の区切りを「under 2.9」「2.9 – 3.2」のような見出しにする */
function paceRows(speed){
  const rows = [];
  let prev = null;
  for(const s of speed){
    if(s.wr == null || !s.games) { prev = s.max; continue; }
    const label = prev == null ? `under ${s.max}`
                : s.max == null ? `${prev} and up`
                : `${prev} – ${s.max}`;
    rows.push({ key: s.key, label, wr: s.wr, games: s.games });
    prev = s.max;
  }
  return rows;
}

/* 2色アーキタイプを、構成する2色の平均勝率と並べる */
function pairRows(archetypes, colors){
  const mono = Object.fromEntries(colors.map(c => [c.color, c.wr]));
  return (archetypes || [])
    .filter(a => a.colors && a.colors.length === 2 && a.wr != null)
    .map(a => {
      const [x, y] = a.colors.split("");
      const exp = mono[x] != null && mono[y] != null ? (mono[x] + mono[y]) / 2 : null;
      return { pair: a.colors, wr: a.wr, exp, games: a.games || 0, gap: exp == null ? null : a.wr - exp };
    })
    .filter(r => r.exp != null)
    .sort((a, b) => b.wr - a.wr);
}

/* 本文で触れる材料をひととおり出す */
function digest(d){
  const pace = paceRows(d.speed || []);
  const pairs = pairRows(d.archetypes, d.colors || []);
  const best = pace.length ? pace.reduce((m, r) => r.wr > m.wr ? r : m) : null;
  const worst = pace.length ? pace.reduce((m, r) => r.wr < m.wr ? r : m) : null;
  const solid = pairs.filter(p => p.games >= 10000);        // 少数サンプルは結論に使わない
  const over = solid.length ? solid.reduce((m, r) => r.gap > m.gap ? r : m) : null;
  const under = solid.length ? solid.reduce((m, r) => r.gap < m.gap ? r : m) : null;
  return {
    pace, pairs, best, worst, over, under,
    // 速いデッキほど勝つ環境か、その逆か
    faster: pace.length > 1 && pace[0].wr > pace[pace.length - 1].wr,
    spread: best && worst ? (best.wr - worst.wr) * 100 : 0,
    commons: ((d.top && d.top.common) || []).slice(0, 5),
    colors: (d.colors || []).slice().sort((a, b) => b.wr - a.wr)
  };
}

/* ------------------------------------------------------------------ 図 */

const W = 1240, PAD = 40;
const L = 280, R = 92;

/* 勝率の目盛りは、2つの図で同じ範囲にして見比べられるようにする。
   セットによって勝率の散らばりが違うので、範囲はデータから決める（固定するとはみ出す）。 */
function scaleFor(values){
  const vs = values.filter(v => v != null && isFinite(v));
  let lo = Math.floor(Math.min(...vs) - 0.6);
  let hi = Math.ceil(Math.max(...vs) + 0.6);
  while(hi - lo < 4) { lo -= 1; hi += 1; }                   // 差が小さいセットで拡大されすぎないように
  const step = hi - lo > 14 ? 3 : hi - lo > 8 ? 2 : 1;
  lo -= (lo % step + step) % step;                           // 目盛りが刻み幅に乗るようにする
  return { lo, hi, step, sx: v => L + (v - lo) / (hi - lo) * (W - L - R) };
}

/* 目盛りと、環境全体の勝率を示す破線 */
function axis(sc, top, bottom, overall){
  let s = "";
  for(let v = sc.lo; v <= sc.hi; v += sc.step){
    s += `<line x1="${sc.sx(v)}" x2="${sc.sx(v)}" y1="${top}" y2="${bottom}" stroke="${GRID}" stroke-width="1"/>`;
    s += `<text x="${sc.sx(v)}" y="${bottom + 19}" font-size="12.5" fill="${FAINT}" text-anchor="middle">${v}%</text>`;
  }
  const r = sc.sx(overall);
  s += `<line x1="${r}" x2="${r}" y1="${top - 4}" y2="${bottom}" stroke="${REF}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  return s;
}

function chartSvg(set, name, d, g){
  const overall = +pt(d.overall_win_rate);
  /* 2つの図に出る値をすべて入れて、はみ出さない範囲を決める */
  const sc = scaleFor([
    overall,
    ...g.pace.map(r => +pt(r.wr)),
    ...g.pairs.map(r => +pt(r.wr)),
    ...g.pairs.map(r => +pt(r.exp))
  ]);

  let s = "", y = 0;                                         // y は下へ進めていく。高さは最後に確定する
  const t = (x, yy, str, o = {}) =>
    `<text x="${x}" y="${yy}" font-size="${o.size || 13.5}" fill="${o.fill || MUTED}"` +
    `${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}>${esc(str)}</text>`;

  /* 見出し */
  const events = (d.events || []).map(e => EVENT_NAME[e.event] || e.event).join(", ");
  s += t(PAD, y += 56, `${name} Limited: what ${num(d.total_games)} tracked games say`, { size: 27, fill: INK, weight: 800 });
  s += t(PAD, y += 30, `${events}. Overall win rate ${pt(d.overall_win_rate)}%`
    + (d.avg_turns ? `, average game ${d.avg_turns.toFixed(1)} turns.` : "."), { size: 14.5 });

  /* 上段：平均マナ総量ごとの勝率 */
  /* 差が小さいセットで「安いデッキが勝つ」と言い切らない */
  s += t(PAD, y += 54, g.spread < 2 ? "Curve barely moves the win rate here"
                     : g.faster ? "Cheaper decks win more" : "Heavier decks win more",
    { size: 17, fill: INK, weight: 700 });
  s += t(PAD, y += 22, "Win rate by the deck's average mana value across its nonland cards (decks with 15+ spells).", { size: 13 });
  s += t(PAD, y += 18, `The dashed line is the format's overall ${pt(d.overall_win_rate)}%.`, { size: 13 });

  let top = y + 26;
  s += axis(sc, top - 8, top + g.pace.length * 38 - 10, overall);
  s += t(sc.sx(overall), top - 14, "format average", { anchor: "middle", size: 12, fill: REF });
  g.pace.forEach((r, i) => {
    const yy = top + i * 38 + 10, x = sc.sx(+pt(r.wr));
    s += t(L - 16, yy + 5, i === 0 ? "avg. mana value " + r.label : r.label, { anchor: "end", fill: INK, size: 14 });
    s += `<line x1="${L}" x2="${x}" y1="${yy}" y2="${yy}" stroke="${GRID}" stroke-width="2"/>`;
    s += `<circle cx="${x}" cy="${yy}" r="7" fill="${UP}" stroke="${SURFACE}" stroke-width="2"/>`;
    s += t(x + 14, yy + 5, pt(r.wr) + "%", { fill: INK, weight: 700, size: 14 });
    s += t(W - PAD, yy + 5, num(r.games) + " games", { anchor: "end", size: 12.5, fill: FAINT });
  });
  y = top + g.pace.length * 38 - 10 + 19;                    // 目盛りの文字の下まで

  /* 下段：2色と、その2色の平均 */
  s += t(PAD, y += 46, "Colour pairs against the sum of their parts", { size: 17, fill: INK, weight: 700 });
  s += t(PAD, y += 22, "Filled dot is the pair's win rate; hollow dot is the average of its two colours'.", { size: 13 });
  s += t(PAD, y += 18, "The gap is what the pairing adds or loses.", { size: 13 });

  const lg = y += 22;
  const chip = (x, fill, stroke, label) =>
    `<circle cx="${x + 6}" cy="${lg - 4}" r="5.5" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="2"` : ""}/>`
    + t(x + 18, lg, label, { size: 13 });
  s += chip(PAD + 10, UP, null, "Pair beats its colours' average");
  s += chip(PAD + 260, DOWN, null, "Pair falls short of it");
  s += chip(PAD + 470, SURFACE, REF, "Average of the two colours");

  top = y + 32;
  s += axis(sc, top - 8, top + g.pairs.length * 36 - 12, overall);
  g.pairs.forEach((r, i) => {
    const yy = top + i * 36 + 8, small = r.games < 10000;
    const flat = Math.abs(r.gap * 100) < 0.05;              // 差が丸めて 0 になるもの
    const col = flat ? REF : (r.gap > 0 ? UP : DOWN);
    const op = small ? 0.5 : 1;
    s += t(PAD, yy + 5, r.pair + (small ? " *" : ""), { fill: INK, size: 15, weight: 700 });
    s += t(L - 16, yy + 5, num(r.games) + " games", { anchor: "end", size: 12.5, fill: FAINT });
    s += `<line x1="${sc.sx(Math.min(+pt(r.wr), +pt(r.exp)))}" x2="${sc.sx(Math.max(+pt(r.wr), +pt(r.exp)))}"`
       + ` y1="${yy}" y2="${yy}" stroke="${col}" stroke-width="3" opacity="${small ? 0.45 : 1}"/>`;
    s += `<circle cx="${sc.sx(+pt(r.exp))}" cy="${yy}" r="6" fill="${SURFACE}" stroke="${REF}" stroke-width="2.5" opacity="${op}"/>`;
    s += `<circle cx="${sc.sx(+pt(r.wr))}" cy="${yy}" r="7.5" fill="${col}" stroke="${SURFACE}" stroke-width="2" opacity="${op}"/>`;
    const delta = flat ? "±0.0 pt" : (r.gap > 0 ? "+" : "−") + Math.abs(r.gap * 100).toFixed(1) + " pt";
    s += t(W - PAD, yy + 5, pt(r.wr) + "%   " + delta,
      { anchor: "end", fill: small ? MUTED : INK, weight: small ? 400 : 700, size: 13.5 });
  });
  y = top + g.pairs.length * 36 - 12 + 19;

  /* 脚注 */
  y += 26;
  s += `<line x1="${PAD}" x2="${W - PAD}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
  s += t(PAD, y += 22, `Data: 17Lands public datasets (CC BY 4.0), pulled ${(d.data_generated_at || d.generated_at || "").slice(0, 10)}`
    + " · Colour win rates are computed over all decks containing that colour, so a pair's \"expected\" value", { size: 12.5, fill: FAINT });
  s += t(PAD, y += 18, "is not independent of the pair itself — read the gaps as a rough signal, not a measurement"
    + (g.pairs.some(p => p.games < 10000) ? " · * fewer than 10,000 games" : ""), { size: 12.5, fill: FAINT });
  s += t(W - PAD, y, "sealed-workbench.com", { anchor: "end", size: 12.5, fill: FAINT });

  const H = y + 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}"`
    + ` font-family="${FONT}"><rect width="${W}" height="${H}" fill="${SURFACE}"/>${s}</svg>`;
}

/* ------------------------------------------------------------------ 本文 */

function titles(set, name, d, g){
  const out = [];
  if(g.best && g.worst && g.spread >= 2){
    out.push(`[${set}] ${g.faster ? "Cheap decks are winning" : "Slower decks are winning"}: `
      + `${pt(g.best.wr)}% vs ${pt(g.worst.wr)}% by deck average mana value, over ${num(d.total_games)} games`);
  }
  if(g.over && g.under){
    // 一番低い組み合わせの差がプラスなら「2色より悪い」とは言わない（本文の表と食い違うため）
    out.push(`[${set}] ${g.over.pair} is the pairing that actually adds something` + (g.under.gap < 0
      ? `; ${g.under.pair} is worse than its two colours apart (17Lands data)`
      : `, gaining ${(g.over.gap * 100).toFixed(1)} pt over its two colours (17Lands data)`));
  }
  out.push(`[${set}] I ran the 17Lands public data on ${num(d.total_games)} games — curve and colour pair numbers inside`);
  return out;
}

function body(set, name, d, g){
  const L = [];
  const events = (d.events || []).map(e => `${EVENT_NAME[e.event] || e.event} (${num(e.games)})`).join(", ");

  L.push(`I pulled the 17Lands public dataset for ${name} and looked at two things: how much the curve is `
    + `actually worth, and whether any colour pair does more than its two colours do on their own. `
    + `Numbers below are from **${num(d.total_games)} tracked games** — ${events} — `
    + `with an overall win rate of **${pt(d.overall_win_rate)}%**`
    + (d.avg_turns ? ` and an average game length of ${d.avg_turns.toFixed(1)} turns.` : "."));
  L.push("");

  /* 1つめ：カーブ */
  L.push("## 1. " + (g.spread < 2 ? "Curve barely moves the win rate in this format"
    : g.faster ? "Cheaper decks win more, and the gradient is steep" : "Heavier decks win more here"));
  L.push("");
  L.push("Win rate by the deck's **average mana value** across its nonland cards, for decks with 15 or more spells:");
  L.push("");
  L.push("| avg. mana value | win rate | games |");
  L.push("| --- | --- | --- |");
  for(const r of g.pace) L.push(`| ${r.label} | ${pt(r.wr)}% | ${num(r.games)} |`);
  L.push("");
  if(g.best && g.worst && g.spread >= 2){
    L.push(`That is a **${g.spread.toFixed(1)} point** spread between the ${g.faster ? "cheapest" : "most expensive"} `
      + `bucket and the ${g.faster ? "most expensive" : "cheapest"} one. For comparison, the gap between the best `
      // 表に出る組み合わせが全部（10組）でないときは「最下位」と言わない（上位だけの表で「worst」と書くと誤り）
      + `colour pair and the ${g.pairs.length >= 10 ? "worst" : ORD[g.pairs.length] + "-best"} one below is `
      + `${g.pairs.length ? ((g.pairs[0].wr - g.pairs[g.pairs.length - 1].wr) * 100).toFixed(1) : "—"} points. `
      + `${g.faster ? "Trimming the top of your curve looks like it matters more than which two colours you end up in."
                    : "This is unusual — most recent formats reward the cheaper deck."}`);
  } else {
    L.push("The spread here is small, so curve looks like a weaker lever in this format than it usually is.");
  }
  L.push("");
  // 断り書きは、結果の向き（軽いほうが勝つ／重いほうが勝つ）に関係なく成り立つ言い方にする
  L.push("Caveat worth stating up front: this is a correlation in deck lists, not an experiment. A deck's average "
    + "mana value also depends on what was opened and which colours were open, so this is not a clean read of the curve on its own.");
  L.push("");

  /* 2つめ：2色 */
  L.push("## 2. Which pairings actually add something");
  L.push("");
  L.push("For each two-colour archetype I compared its win rate against the **average of its two colours' win rates** "
    + "across every deck containing them. The gap is a rough read on whether the pairing does more than its parts.");
  L.push("");
  L.push("| pair | win rate | avg. of its colours | gap | games |");
  L.push("| --- | --- | --- | --- | --- |");
  for(const r of g.pairs){
    const flat = Math.abs(r.gap * 100) < 0.05;
    const delta = flat ? "±0.0" : (r.gap > 0 ? "+" : "−") + Math.abs(r.gap * 100).toFixed(1);
    L.push(`| ${r.pair}${r.games < 10000 ? " \\*" : ""} | ${pt(r.wr)}% | ${pt(r.exp)}% | ${delta} pt | ${num(r.games)} |`);
  }
  L.push("");
  if(g.pairs.some(p => p.games < 10000)) L.push("\\* fewer than 10,000 games — treat as noise.");
  L.push("");
  if(g.over && g.under && g.over.pair !== g.under.pair){
    const sgn = v => (v > 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1);
    // 一番低い組み合わせの差がプラスなら「損している」とは言わない（表の数字と言い回しが逆になるため）。
    // 差だけでタッチなどの具体的な助言はしない（このデータからは言えない）
    if(g.under.gap < 0){
      L.push(`**${g.over.pair}** gets the most out of the pairing (${sgn(g.over.gap)} pt), and **${g.under.pair}** `
        + `does worse than its two colours do on their own (${sgn(g.under.gap)} pt). In ${g.under.pair}, the individual colours `
        + `seem to be carrying more of the deck than the pairing is.`);
    }else{
      L.push(`**${g.over.pair}** gets the most out of the pairing (${sgn(g.over.gap)} pt). Every pair listed does at least `
        + `a little better than its two colours on their own; **${g.under.pair}** gains the least (${sgn(g.under.gap)} pt), `
        + `so most of its edge comes from the colours themselves rather than from the pairing.`);
    }
    L.push("");
  }
  L.push("This measure has a real flaw and I would rather say it than have it found in the comments: a colour's win rate "
    + "is computed over all decks containing that colour, which **includes the pair being tested**. So the \"expected\" "
    + "value is not independent of the result. It is a signal, not a measurement. If someone knows a cleaner way to "
    + "normalise this out of the public dataset I would like to hear it.");
  L.push("");

  /* おまけ：コモン */
  if(g.commons.length){
    L.push("## Top commons by GIH win rate");
    L.push("");
    L.push("| card | GIH WR | IWD | games |");
    L.push("| --- | --- | --- | --- |");
    for(const c of g.commons){
      L.push(`| ${c.name} | ${pt(c.gih)}% | ${c.iwd != null ? (c.iwd >= 0 ? "+" : "") + (c.iwd * 100).toFixed(1) + " pt" : "—"} | ${num(c.games)} |`);
    }
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("Data: [17Lands public datasets](https://www.17lands.com/public_datasets) (CC BY 4.0), "
    + `pulled ${(d.data_generated_at || d.generated_at || "").slice(0, 10)}. I am not affiliated with 17Lands.`);
  L.push("");
  // サイトの説明は、あとで仕様が変わっても嘘にならない範囲にとどめること
  L.push(`Full disclosure: I maintain a free Limited practice site, and these numbers come out of its aggregation `
    + `pipeline — the per-card and per-archetype tables for ${name} are at ${SITE}/sets/${set}.en.html if you want `
    + `to dig further. No account needed. Happy to answer methodology questions in the comments.`);

  return L.join("\n");
}

function sheet(set, name, d, g, img){
  const opts = titles(set, name, d, g);
  return [
    `# r/lrcast 投稿の下書き — ${name}（${set}）`,
    "",
    "**そのまま投稿せず、必ず数字と言い回しに目を通してください。**",
    "投稿は手動です。画像は下の PNG を Reddit にアップロードしてください。",
    "",
    "| | |",
    "| --- | --- |",
    "| 集計した試合数 | " + num(d.total_games) + " |",
    "| 環境全体の勝率 | " + pt(d.overall_win_rate) + "% |",
    "| データ取得日 | " + (d.data_generated_at || d.generated_at || "").slice(0, 10) + " |",
    "| 画像 | `" + img + "` |",
    "",
    "## タイトル候補",
    "",
    ...opts.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## 本文（ここから下をコピーして貼り付け）",
    "",
    "````markdown",
    body(set, name, d, g),
    "````",
    "",
    "## 投稿のとき",
    "",
    "- r/lrcast に自己宣伝を禁じるルールはありません（ルール3は Limited Resources 自身の番組・ブログのリンクのみ）",
    "- **投稿から数時間はコメントを見てください。** 手法への質問が必ず来ます",
    "- 30分後にログアウト状態で自分の投稿を開き、消えていないか確認してください",
    "  （AutoModerator に消されても、自分のアカウントからは普通に見えます）"
  ].join("\n");
}

/* ------------------------------------------------------------------ 実行 */

async function setNameOf(code){
  const names = await readJson(`data/names/${code}.json`, null);
  return (names && names.set) || code;
}

async function main(){
  const arg = process.argv.slice(2).filter(Boolean);
  let sets = arg;
  if(!sets.length){
    sets = (await readJson("announce.json", { sets: [] })).sets || [];
  }
  if(!sets.length){
    process.stderr.write("対象のセットがありません。\n");
    return;
  }

  let sharp = null;
  try { sharp = (await import("sharp")).default; }
  catch (e) { process.stderr.write("sharp が無いので SVG だけを出力します\n"); }

  await mkdir(OUT, { recursive: true });
  const made = [], sheets = [];

  for(const set of sets){
    const d = await readJson(`${ARTICLES}/${set}_draft.json`, null)
           || await readJson(`${ARTICLES}/${set}_sealed.json`, null);
    if(!d){ process.stderr.write(`${set}: 記事データが見つかりません\n`); continue; }
    if(!d.total_games || !(d.speed || []).length){ process.stderr.write(`${set}: 数字が足りません\n`); continue; }

    const name = await setNameOf(set);
    const g = digest(d);
    const svg = chartSvg(set, name, d, g);

    let img = `${OUT}/${set}.svg`;
    if(sharp){
      img = `${OUT}/${set}.png`;
      await writeFile(img, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
    }
    // PNG にしたあとも SVG を残す（図の中身を機械で確かめたいとき用）
    if(!sharp || process.env.LRCAST_KEEP_SVG) await writeFile(`${OUT}/${set}.svg`, svg, "utf8");

    const md = sheet(set, name, d, g, img);
    await writeFile(`${OUT}/${set}.md`, md, "utf8");
    made.push(set);
    sheets.push(md);
  }

  if(sheets.length) await writeFile("lrcast.md", sheets.join("\n\n---\n\n"), "utf8");
  process.stderr.write(made.length ? `r/lrcast 下書き: ${made.join(", ")}\n` : "下書きは作られませんでした\n");
}

main().catch(e => {
  console.error("r/lrcast 下書きの作成に失敗しました:", e.message);
  process.exit(1);
});
