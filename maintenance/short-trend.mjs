/*
 * 修正版ショート（確定版のあと。ドラフトの「1週目 → 直近の1週間」の変化）の台本を作る。役割はこれだけ。
 * 画面の描き方・読み上げ・動画の組み立ては build-short.mjs（MODE = trend のとき、この台本を使う）。
 *
 *   trendScript(d, ctx) → 場面の並び
 *     d   … data/trends/<SET>_draft.json（build-trend.mjs が作る）
 *     ctx … { JA, nameJa, names（data/names/<SET>.json）, pairName（2色の名前） }
 *
 * 章立て
 *   冒頭（サムネイルと同じ見た目。セリフは短く「何の動画か」だけ）
 *   → 注目のカード（いちばん上がったコモン／アンコモンを大きく。引けた試合の勝率の 1週目 → 今）
 *   → コモン編 → アンコモン編 → レア編（それぞれ、上がった3枚・下がった3枚）
 *   → 色の組み合わせ編（2色デッキの勝率の変化 → 狙い目（勝率が高いのに使う人が少ない組み合わせ。あるときだけ））→ 締め
 * カードの勝率は、どれも「引けた試合の勝率」（17Lands の GIH WR）。何の数字かが分かるよう、章の頭でセリフでも言う。
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
const RN = { ja: { common: "コモン", uncommon: "アンコモン", rare: "レア" }, en: { common: "common", uncommon: "uncommon", rare: "rare" } };

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
  const cap = t => t[0].toUpperCase() + t.slice(1);
  const el = elapsed(d, JA);
  const byR = d.by_rarity || {};
  const top = withLabel(d.risers)[0] || null;
  const R0 = top && RN[L][top.rarity] ? top.rarity : "uncommon";
  const scenes = [];

  // 冒頭：サムネイルと同じ見た目（サムネイルで見た答えが、動画でもそのまま出る）。セリフは短く、何の動画かだけ。答えは次の場面で、カードを大きく見せながら言う
  const thumb = top ? {
    ribbon: JA ? "ドラフト環境の変化" : "WHAT CHANGED IN DRAFT", bigRibbon: true,
    l1: JA ? `「${top.label}」` : `“${top.label}”`, l2: "",
    subs: JA ? [`発売${el || "直後"}で一番上がった${RN.ja[R0]}`, "引けた試合の勝率"] : [`Top rising ${RN.en[R0]}${el ? `, ${el} in` : ""}`, "Win rate when drawn"],
    sub2: JA ? `1週目 ${pct(top.first.gih)}% → 今 ${pct(top.last.gih)}%` : `Week 1 ${pct(top.first.gih)}% → now ${pct(top.last.gih)}%`
  } : null;
  scenes.push({ kind: "hook", art: true, trend: true, thumb, title: nameJa,
    say: JA ? `MTGアリーナ、${nameJa}のドラフト。${el ? `発売から${el}で` : "1週目から"}、評価が大きく変わったカードをまとめました。`
            : `${nameJa} Draft on MTG Arena: the cards whose results changed the most${el ? `, ${el} in` : " since week one"}.` });

  // 注目のカード：いちばん上がったコモン／アンコモンを大きく見せて、答えを言う
  if(top) scenes.push({ kind: "trendFeature", card: top, cards: [top], label: "trend-feature", rarityName: RN[L][R0], tail: 0.6, minDur: 5,
    say: JA ? `一番評価が上がった${RN.ja[R0]}は、${top.label}。引けた試合の勝率は、1週目の${pct(top.first.gih)}パーセントから、今は${pct(top.last.gih)}パーセントです。`
            : `The ${RN.en[R0]} that rose the most: ${top.label}. Its win rate when drawn went from ${pct(top.first.gih)} percent in week one to ${pct(top.last.gih)} percent now.` });

  // コモン編・アンコモン編・レア編（それぞれ、上がった3枚 → 下がった3枚。無い側は飛ばす）
  const chapterJa = { common: "コモン編", uncommon: "アンコモン編", rare: "レア編" };
  const chapterEn = { common: "COMMONS", uncommon: "UNCOMMONS", rare: "RARES" };
  const intro = { common: JA ? "まずはコモン編。" : "First, commons.", uncommon: JA ? "続いてアンコモン編。" : "Next, uncommons.", rare: JA ? "そしてレア編。" : "Then rares." };
  for(const r of ["common", "uncommon", "rare"]){
    const g = byR[r] || {}, up = withLabel(g.risers), down = withLabel(g.fallers);
    if(!up.length && !down.length) continue;
    const rn = RN[L][r], ch = JA ? chapterJa[r] : chapterEn[r];
    let opened = false;
    const open = () => { const t = opened ? "" : intro[r] + (JA ? "" : " "); opened = true; return t; };
    if(up.length){
      const c0 = up[0], rest = up.slice(1).map(c => c.label);
      const isTop = top && c0.name === top.name;
      const lead = isTop
        ? (rest.length ? (JA ? `${c0.label}に続いて、${and(rest)}も、引けた試合の勝率が上がっています。` : `After ${c0.label}, ${and(rest)} are also winning more when drawn.`)
                       : (JA ? `${c0.label}のほかには、大きく上がった${rn}はありませんでした。` : `Beyond ${c0.label}, no other ${rn} rose much.`))
        : r === "rare" && c0.underrated
          ? (JA ? `発売直後は目立たなかった${c0.label}が、引けた試合の勝率${pct(c0.first.gih)}パーセントから${pct(c0.last.gih)}パーセントに上がりました。`
                : `${c0.label}, overlooked at launch, went from ${pct(c0.first.gih)} to ${pct(c0.last.gih)} percent in win rate when drawn.`)
          : (JA ? `一番上がったのは${c0.label}で、引けた試合の勝率は${pct(c0.first.gih)}パーセントから${pct(c0.last.gih)}パーセントです。`
                : `The biggest riser is ${c0.label}: ${pct(c0.first.gih)} to ${pct(c0.last.gih)} percent in win rate when drawn.`);
      const tail = isTop || !rest.length ? "" : (JA ? `${and(rest)}も上がっています。` : ` ${and(rest)} are up too.`);
      scenes.push({ kind: "trendCards", dir: "up", cards: up, label: `trend-${r}-up`, tail: 0.8, minDur: 6, rare: r === "rare",
        chapter: ch, heading: JA ? "引けた試合の勝率が上がった" : "Win rate when drawn: rising",
        say: open() + lead + tail });
    }
    if(down.length){
      const c0 = down[0], rest = down.slice(1).map(c => c.label);
      scenes.push({ kind: "trendCards", dir: "down", cards: down, label: `trend-${r}-down`, tail: 0.8, minDur: 6, rare: r === "rare",
        chapter: ch, heading: JA ? "引けた試合の勝率が下がった" : "Win rate when drawn: falling",
        say: open() + (JA ? `逆に一番下がったのは${c0.label}。引けた試合の勝率が${pt1(c0.delta)}ポイント下がりました。${rest.length ? and(rest) + "も下がっています。" : ""}`
                          : `The biggest faller: ${c0.label}, down ${pt1(c0.delta)} points in win rate when drawn.${rest.length ? ` ${and(rest)} dropped too.` : ""}`) });
    }
  }

  // 色の組み合わせ編：いちばん伸びた・いちばん落ちた・1位（1週目から変わらないか、入れ替わったか）→ 狙い目（あるときだけ）
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
    const chapter = JA ? "色の組み合わせ編" : "COLOUR PAIRS", heading = JA ? "2色デッキの勝率の変化" : "Deck win rate, week 1 → now";
    // ここの勝率は、カードではなく2色デッキの勝率。取り違えないよう「デッキの勝率」と言う
    scenes.push({ kind: "trendPairs", pairs, rise, fall, top: topP, keepTop, chapter, heading, tail: 0.8, minDur: 6,
      say: JA ? `色の組み合わせ編。2色デッキの勝率では、${R}が一番伸びて、${F}が一番落ちました。${topLine}`
              : `Colour pairs. By deck win rate, ${R} rose the most and ${F} fell the most. ${topLine}` });
    const t = pickTarget(pairs);
    if(t){
      const P = pairName(t.pair.colors), sh = Math.round(t.pair.last.share * 100), av = Math.round(t.avgShare * 100);
      scenes.push({ kind: "trendPairs", pairs, rise, fall, top: topP, keepTop, chapter, heading, nofade: true, tail: 0.8,
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
