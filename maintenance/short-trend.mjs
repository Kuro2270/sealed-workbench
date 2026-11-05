/*
 * 修正版ショート（確定版のあと。ドラフトの「発売直後（最初の1週間）→ 最近の1週間」の変化）の台本を作る。役割はこれだけ。
 * 画面の描き方・読み上げ・動画の組み立ては build-short.mjs（MODE = trend のとき、この台本を使う）。
 *
 *   trendScript(d, ctx) → 場面の並び
 *     d   … data/trends/<SET>_draft.json（build-trend.mjs が作る）
 *     ctx … { JA, nameJa, names（data/names/<SET>.json）, pairName（2色の名前） }
 *
 * 章立て
 *   冒頭（サムネイルと同じ見た目。セリフは短く「何の動画か」だけ）
 *   → 色の組み合わせ編（2色デッキの勝率の変化 → 狙い目（勝率が高いのに使う人が少ない組み合わせ。あるときだけ））
 *   → コモン編 → アンコモン編 → レア編（それぞれ、上がった3枚だけ）→ 締め
 *   2026年11月：FRA の修正版で、いちばん役に立つ色の組み合わせを最後に置いていたのを最初にした。
 *   また、下がったカード（とくにコモン）の場面で見るのをやめる人が多かったので、下がったカードは言わず、上がったカードだけにして短くした
 * カードの勝率は、どれも「引けた試合の勝率」（17Lands の GIH WR）。何の数字かが分かるよう、章の頭でセリフでも言う。
 * 「上がった」「下がった」の読み（あがった・さがった）は short/yomi.json で直す。
 */
const pct = v => (v * 100).toFixed(1);
/* 「発売から〇日」は言わない。データは集計した日までのもので、ショートは見る日によって日数がずれるため（2026年10月）。
   「発売直後」と「最近（発売からしばらくたった今）」の比べとして言う。比べた期間の日付は、YouTube の説明欄に書く */
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
  const byR = d.by_rarity || {};
  // 章ごとの3枚は、揺れを考えた確かさ（z）で選んだうえで、差の大きい順に並べる（画面の上から「一番」になるように）
  const byDelta = (list, dir) => (list || []).slice().sort((a, b) => dir * (b.delta - a.delta));
  const chapterUp = r => withLabel(byDelta((byR[r] || {}).risers, 1));   // 下がったカードは動画では言わない（2026年11月）
  // サムネイルの答え：コモンとアンコモンの章の1枚目のうち、差の大きいほう（動画のその章の1枚目と同じカードになる）
  const top = ["common", "uncommon"].map(r => chapterUp(r)[0]).filter(Boolean).sort((a, b) => b.delta - a.delta)[0] || withLabel(d.risers)[0] || null;
  const R0 = top && RN[L][top.rarity] ? top.rarity : "uncommon";
  const scenes = [];

  // 冒頭：セリフは短く、何の動画かだけ。thumb は YouTube 用サムネイルの中身（答えのカードと数字）。動画では、そのカードの章で言う
  const thumb = top ? {
    ribbon: JA ? "ドラフト環境の変化" : "WHAT CHANGED IN DRAFT", bigRibbon: true,
    l1: JA ? `「${top.label}」` : `“${top.label}”`, l2: "",
    subs: JA ? [`発売直後から一番上がった${RN.ja[R0]}`, "引けた試合の勝率"] : [`Top rising ${RN.en[R0]} since launch`, "Win rate when drawn"],
    sub2: JA ? `発売直後 ${pct(top.first.gih)}% → 最近 ${pct(top.last.gih)}%` : `Launch ${pct(top.first.gih)}% → recent ${pct(top.last.gih)}%`
  } : null;
  // topName：サムネイルに並べるカードを、このカードの章から取るため（このカードを真ん中に）
  scenes.push({ kind: "hook", art: true, trend: true, thumb, title: nameJa, topName: top ? top.name : null,
    say: JA ? `MTGアリーナ、${nameJa}のドラフト。発売からしばらくたって、勝てる色の組み合わせと、評価が上がったカードをまとめました。`
            : `${nameJa} Draft on MTG Arena, a while after launch: the colour pairs that win, and the cards that rose the most.` });

  // 色の組み合わせ編：いちばん伸びた・いちばん落ちた・1位（発売直後から変わらないか、入れ替わったか）→ 狙い目（あるときだけ）
  const pairs = (d.pairs || []).slice();
  if(pairs.length >= 3){
    const rise = pairs.slice().sort((a, b) => b.delta - a.delta)[0], fall = pairs.slice().sort((a, b) => a.delta - b.delta)[0], topP = pairs[0];
    const firstTop = pairs.slice().sort((a, b) => b.first.wr - a.first.wr)[0];
    const keepTop = firstTop === topP;
    const R = pairName(rise.colors), F = pairName(fall.colors), Tn = pairName(topP.colors), F1 = pairName(firstTop.colors);
    const topLine = keepTop
      ? (JA ? `1位は発売直後から変わらず、${Tn}です。` : `${Tn} has been the best pair since launch.`)
      : topP === rise
        ? (JA ? `伸びた${R}が、${F1}を抜いて1位になりました。` : `${R} has overtaken ${F1} for first place.`)
        : (JA ? `発売直後の1位は${F1}でしたが、最近は${Tn}が1位です。` : `${F1} was best at launch; recently it's ${Tn}.`);
    const chapter = JA ? "色の組み合わせ編" : "COLOUR PAIRS", heading = JA ? "2色デッキの勝率の変化" : "Deck win rate, launch → recent";
    // ここの勝率は、カードではなく2色デッキの勝率。取り違えないよう「デッキの勝率」と言う
    scenes.push({ kind: "trendPairs", pairs, rise, fall, top: topP, keepTop, chapter, heading, tail: 0.8, minDur: 6,
      say: JA ? `まずは色の組み合わせ編。2色デッキの勝率では、${R}が一番伸びて、${F}が一番落ちました。${topLine}`
              : `First, colour pairs. By deck win rate, ${R} rose the most and ${F} fell the most. ${topLine}` });
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

  // コモン編・アンコモン編・レア編（それぞれ、上がった3枚だけ。上がったカードが無い章は飛ばす）
  const chapterJa = { common: "コモン編", uncommon: "アンコモン編", rare: "レア編" };
  const chapterEn = { common: "COMMONS", uncommon: "UNCOMMONS", rare: "RARES" };
  const intro = { common: JA ? "続いてコモン編。" : "Next, commons. ", uncommon: JA ? "次はアンコモン編。" : "Then uncommons. ", rare: JA ? "そしてレア編。" : "And rares. " };
  for(const r of ["common", "uncommon", "rare"]){
    const up = chapterUp(r);
    if(!up.length) continue;
    const rn = RN[L][r], rns = rn + "s", ch = JA ? chapterJa[r] : chapterEn[r];
    const c0 = up[0], rest = up.slice(1).map(c => c.label);
    const lead = r === "rare" && c0.underrated
        ? (JA ? `発売直後は目立たなかった${c0.label}が、引けた試合の勝率${pct(c0.first.gih)}パーセントから、最近は${pct(c0.last.gih)}パーセントに上がりました。`
              : `${c0.label}, overlooked at launch, went from ${pct(c0.first.gih)} percent at launch to ${pct(c0.last.gih)} percent recently in win rate when drawn.`)
        : (JA ? `${rn}の中で一番上がったのは${c0.label}で、引けた試合の勝率は、発売直後の${pct(c0.first.gih)}パーセントから、最近は${pct(c0.last.gih)}パーセントです。`
              : `The biggest riser among ${rns} is ${c0.label}: win rate when drawn went from ${pct(c0.first.gih)} percent at launch to ${pct(c0.last.gih)} percent recently.`);
    const tail = !rest.length ? "" : (JA ? `${and(rest)}も上がっています。` : ` ${and(rest)} are up too.`);
    scenes.push({ kind: "trendCards", dir: "up", cards: up, label: `trend-${r}-up`, tail: 0.8, minDur: 6, rare: r === "rare",
      chapter: ch, heading: JA ? "引けた試合の勝率が上がった" : "Win rate when drawn: rising",
      say: intro[r] + lead + tail });
  }

  // 締めは一言だけ。登録ボタンを押す動き（build-short.mjs の popLayer）で2秒ほどに収める（2026年11月）
  scenes.push({ kind: "outro", art: true, say: JA ? `チャンネル登録もぜひ！` : `Subscribe!`, tail: 0.2, minDur: 1.9 });
  return scenes;
}
