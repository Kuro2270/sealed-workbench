/*
 * 修正版ショート（確定版のあと。ドラフトの「1週目 → 直近の1週間」の変化）の台本を作る。役割はこれだけ。
 * 画面の描き方・読み上げ・動画の組み立ては build-short.mjs（MODE = trend のとき、この台本を使う）。
 *
 *   trendScript(d, ctx) → 場面の並び
 *     d   … data/trends/<SET>_draft.json（build-trend.mjs が作る）
 *     ctx … { JA, nameJa, names（data/names/<SET>.json）, pairName（2色の名前） }
 *
 * 場面
 *   冒頭（サムネイルと同じ中身：いちばん上がったカードとそのレアリティ、引けた試合の勝率の 1週目 → 今）
 *   → レアリティごとの章（冒頭のカードのレアリティから。コモン／アンコモンそれぞれ、上がった3枚・下がった3枚）
 *   → 見直されたレア（発売直後は目立たなかったのに上がったレア・神話レア。あるときだけ）
 *   → 2色の組み合わせの変化 → 狙い目（勝率が高いのに使う人が少ない組み合わせ。あるときだけ）→ 締め
 * 勝率は、どれも「引けた試合の勝率」（17Lands の GIH WR）。何の数字かが分かるよう、章の頭でセリフでも言う。
 * 「上がった」「下がった」の読み（あがった・さがった）は short/yomi.json で直す。
 */
const pt1 = v => (Math.abs(v) * 100).toFixed(1).replace(/\.0$/, "");
const pct = v => (v * 100).toFixed(1);
/* 発売（データの最初の日）から直近（データの最後の日）まで。7日の倍数に近ければ週で言う */
export function elapsed(d, JA){
  const days = Math.round((Date.parse(d.data_to) - Date.parse(d.data_from)) / 86400000) + 1;
  if(!(days > 0)) return "";
  const w = Math.round(days / 7);
  if(Math.abs(days - w * 7) <= 1) return JA ? `${w}週間` : `${w} week${w > 1 ? "s" : ""}`;
  return JA ? `${days}日` : `${days} days`;
}
const RN = { ja: { common: "コモン", uncommon: "アンコモン" }, en: { common: "common", uncommon: "uncommon" } };

/* 狙い目：直近で勝率が高いのに、使っている人（2色デッキのうちの割合）が少ない組み合わせ。無理には選ばない
   （本編のショートと同じ考え方：まず「1位に近い（−1.5pt 以内）かつ使用率が平均の 80% 以下」、次に「平均の勝率以上かつ使用率が平均の 85% 以下」、
     それも無く1位そのものが空いていれば1位を「狙い目でもある」とする） */
function pickTarget(pairs){
  if(pairs.length < 4 || pairs.some(p => p.last.share == null)) return null;
  const top = pairs[0], worst = pairs[pairs.length - 1], avgShare = 1 / 10;
  const games = pairs.reduce((n, p) => n + p.last.games, 0) || 1;
  const avgWr = pairs.reduce((n, p) => n + p.last.wr * p.last.games, 0) / games;
  const best = list => list.sort((a, b) => b.last.wr - a.last.wr)[0] || null;
  let t = best(pairs.filter(p => p !== top && p.last.wr >= top.last.wr - 0.015 && p.last.share <= avgShare * 0.8));
  if(!t) t = best(pairs.filter(p => p !== top && p !== worst && p.last.wr >= avgWr - 0.005 && p.last.share <= avgShare * 0.85));
  if(!t && top.last.share <= avgShare * 0.9) return { pair: top, rank: 1, avgShare, isTop: true };
  return t ? { pair: t, rank: pairs.indexOf(t) + 1, avgShare } : null;
}

export function trendScript(d, { JA, nameJa, names, pairName }){
  const L = JA ? "ja" : "en";
  const label = c => JA ? ((names.names || {})[c.name] || c.name) : c.name;
  const withLabel = list => (list || []).slice(0, 3).map(c => ({ ...c, label: label(c), img: JA ? (names.images || {})[c.name] : null }));
  const and = list => JA ? list.join("と") : list.join(" and ");
  const w = d.window || {};
  const games = (w.first ? w.first.games : 0) + (w.last ? w.last.games : 0);
  const el = elapsed(d, JA);
  const byR = d.by_rarity || {};
  const top = withLabel(d.risers)[0] || null;
  const R0 = top && RN[L][top.rarity] ? top.rarity : "uncommon";
  const scenes = [];

  // 冒頭：サムネイルと同じ中身。セリフも、その答え（どのレアリティの、どのカードが、引けた試合の勝率でどれだけ）から入る
  const thumb = top ? {
    ribbon: JA ? "ドラフト環境の変化" : "WHAT CHANGED IN DRAFT", bigRibbon: true,
    l1: JA ? `「${top.label}」` : `“${top.label}”`, l2: "",
    subs: JA ? [`発売${el || "直後"}で一番上がった${RN.ja[R0]}`, "引けた試合の勝率"] : [`Top rising ${RN.en[R0]}${el ? `, ${el} in` : ""}`, "Win rate when drawn"],
    sub2: JA ? `1週目 ${pct(top.first.gih)}% → 今 ${pct(top.last.gih)}%` : `Week 1 ${pct(top.first.gih)}% → now ${pct(top.last.gih)}%`
  } : null;
  scenes.push({ kind: "hook", art: true, trend: true, gamesN: games, thumb, title: nameJa,
    say: top
      ? (JA ? `MTGアリーナ、${nameJa}のドラフト。${el ? `発売から${el}で` : "1週目と比べて"}、一番評価が上がった${RN.ja[R0]}は、${top.label}でした。引けた試合の勝率は、1週目の${pct(top.first.gih)}パーセントから、今は${pct(top.last.gih)}パーセントです。`
            : `${nameJa} Draft on MTG Arena${el ? `, ${el} in` : ""}: the ${RN.en[R0]} that rose the most is ${top.label}. Its win rate when drawn went from ${pct(top.first.gih)} percent in week one to ${pct(top.last.gih)} percent now.`)
      : (JA ? `MTGアリーナ、${nameJa}のドラフト。1週目と最近の1週間で、評価が変わったカードを1分でまとめました。`
            : `${nameJa} Draft on MTG Arena: what changed between week one and the latest week, in one minute.`) });

  // レアリティごとの章（冒頭のカードのレアリティから）
  const order = [R0, R0 === "uncommon" ? "common" : "uncommon"];
  order.forEach((r, ci) => {
    const g = byR[r] || {}, up = withLabel(g.risers), down = withLabel(g.fallers);
    const rn = RN[L][r], rns = JA ? rn : rn + "s";
    if(up.length){
      const rest = up.slice(1).map(c => c.label), first = ci === 0 && top && up[0].name === top.name;
      scenes.push({ kind: "trendCards", dir: "up", cards: up, label: `trend-${r}-up`, tail: 0.8, minDur: 6,
        heading: JA ? `${rn}｜引けた試合の勝率が上がった` : `${rns[0].toUpperCase() + rns.slice(1)} · win rate when drawn, rising`,
        say: first
          ? (JA ? `まずは${rn}。${rest.length ? `${up[0].label}に続いて、${and(rest)}も、引けた試合の勝率が上がっています。` : `引けた試合の勝率が上がったのは、${up[0].label}です。`}`
                : `${rns[0].toUpperCase() + rns.slice(1)} first.${rest.length ? ` After ${up[0].label}, ${and(rest)} are also winning more when drawn.` : ` The riser is ${up[0].label}.`}`)
          : (JA ? `次は${rn}。一番上がったのは${up[0].label}で、引けた試合の勝率は${pct(up[0].first.gih)}パーセントから${pct(up[0].last.gih)}パーセントです。${rest.length ? and(rest) + "も上がっています。" : ""}`
                : `Now ${rns}. The biggest riser is ${up[0].label}: its win rate when drawn went from ${pct(up[0].first.gih)} to ${pct(up[0].last.gih)} percent.${rest.length ? ` ${and(rest)} are up too.` : ""}`) });
    }
    if(down.length){
      const rest = down.slice(1).map(c => c.label);
      scenes.push({ kind: "trendCards", dir: "down", cards: down, label: `trend-${r}-down`, tail: 0.8, minDur: 6,
        heading: JA ? `${rn}｜引けた試合の勝率が下がった` : `${rns[0].toUpperCase() + rns.slice(1)} · win rate when drawn, falling`,
        say: JA ? `下がった${rn}は、${down[0].label}。引けた試合の勝率が${pt1(down[0].delta)}ポイント下がりました。${rest.length ? and(rest) + "も下がっています。" : ""}`
                : `The ${rn} that fell the most: ${down[0].label}, down ${pt1(down[0].delta)} points in win rate when drawn.${rest.length ? ` ${and(rest)} dropped too.` : ""}` });
    }
  });

  // 見直されたレア（発売直後は目立たなかったのに、上がったレア・神話レア）。あるときだけ
  const rares = withLabel(d.rares_up);
  if(rares.length){
    const rest = rares.slice(1).map(c => c.label);
    scenes.push({ kind: "trendCards", dir: "up", cards: rares, label: "trend-rare", tail: 0.8, minDur: 6, rare: true,
      heading: JA ? "発売直後は目立たなかったのに上がったレア" : "Rares underrated at launch",
      say: JA ? `発売直後は目立たなかったレアでは、${rares[0].label}が、引けた試合の勝率${pct(rares[0].first.gih)}パーセントから${pct(rares[0].last.gih)}パーセントに上がりました。${rest.length ? and(rest) + "も見直されています。" : ""}`
              : `Some rares were underrated at launch. ${rares[0].label}'s win rate when drawn went from ${pct(rares[0].first.gih)} to ${pct(rares[0].last.gih)} percent.${rest.length ? ` ${and(rest)} are climbing too.` : ""}` });
  }

  // 2色の組み合わせ：いちばん伸びた・いちばん落ちた・1位（1週目から変わらないか、入れ替わったか）→ 狙い目（あるときだけ）
  const pairs = (d.pairs || []).slice();
  if(pairs.length >= 3){
    const rise = pairs.slice().sort((a, b) => b.delta - a.delta)[0], fall = pairs.slice().sort((a, b) => a.delta - b.delta)[0], topP = pairs[0];
    const firstTop = pairs.slice().sort((a, b) => b.first.wr - a.first.wr)[0];
    const keepTop = firstTop === topP;
    const R = pairName(rise.colors), F = pairName(fall.colors), Tn = pairName(topP.colors), F1 = pairName(firstTop.colors);
    const topLine = keepTop
      ? (JA ? `1位は発売直後から変わらず、${Tn}です。` : `${Tn} has been the best pair since week one.`)
      : topP === rise
        ? (JA ? `伸びた${R}が、${F1}を抜いて1位になりました。` : `${R} has overtaken ${F1} for first place.`)
        : (JA ? `1週目の1位は${F1}でしたが、今は${Tn}が1位です。` : `${F1} was best in week one; now it's ${Tn}.`);
    scenes.push({ kind: "trendPairs", pairs, rise, fall, top: topP, keepTop, tail: 0.8, minDur: 6,
      // ここの勝率は、カードではなく2色デッキの勝率。取り違えないよう「デッキの勝率」と言う
      say: JA ? `2色デッキの勝率では、${R}が一番伸びて、${F}が一番落ちました。${topLine}`
              : `By deck win rate, ${R} rose the most and ${F} fell the most among colour pairs. ${topLine}` });
    const t = pickTarget(pairs);
    if(t){
      const P = pairName(t.pair.colors), sh = Math.round(t.pair.last.share * 100), av = Math.round(t.avgShare * 100);
      scenes.push({ kind: "trendPairs", pairs, rise, fall, top: topP, keepTop, nofade: true, tail: 0.8,
        pick: { pair: t.pair, note: JA ? `狙い目：勝率${t.rank}位・使用率 ${sh}%（平均 ${av}%）` : `Aim for: #${t.rank} by win rate · drafted ${sh}% (avg ${av}%)` },
        say: t.isTop
          ? (JA ? `狙い目は、1位の${P}そのもの。勝率1位なのに、使っている人は${sh}パーセントだけです。` : `The pick to aim for is ${P} itself: number one, yet only ${sh} percent of decks play it.`)
          : (JA ? `狙い目は${P}。勝率${t.rank}位なのに、使っている人は${sh}パーセントだけです。` : `The pick to aim for: ${P}. Number ${t.rank} by win rate, yet only ${sh} percent of decks play it.`) });
    }
  }

  scenes.push({ kind: "outro", art: true,
    say: JA ? `次のセットも出すので、チャンネル登録お願いします！` : `Next set's coming, so subscribe!`, tail: 0.4 });
  return scenes;
}
