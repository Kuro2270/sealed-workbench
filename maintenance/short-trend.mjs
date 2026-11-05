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
 *   → 登録と高評価のお願い（ctx.cta。一言だけ）→ コモン編 → アンコモン編 → レア編（それぞれ、上がった3枚だけ）で終わる
 *   2026年11月：FRA の修正版で、いちばん役に立つ色の組み合わせを最後に置いていたのを最初にした。
 *   また、下がったカード（とくにコモン）の場面で見るのをやめる人が多かったので、下がったカードは言わず、上がったカードだけにして短くした。
 *   締めの「登録のお願い」で見るのをやめる人も多かったので、お願いは途中（色の組み合わせのあと）に一度だけにし、締めは無くした
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

export function trendScript(d, { JA, nameJa, names, pairName, cta }){
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
  // games：比べた2つの期間（発売直後の1週間と、最近の1週間）の試合数の合計。画面の「〇万試合を分析」とセリフで同じ数を言う
  const games = ((d.window || {}).first || {}).games + ((d.window || {}).last || {}).games || 0;
  const man = n => JA ? (n >= 10000 ? `${Math.round(n / 10000)}万` : n.toLocaleString("ja-JP")) : (n >= 10000 ? `${Math.round(n / 1000)}K` : n.toLocaleString("en-US"));
  const gSay = JA ? man(games) : (games >= 10000 ? `${Math.round(games / 1000)} thousand` : String(games));
  scenes.push({ kind: "hook", art: true, trend: true, thumb, title: nameJa, topName: top ? top.name : null,
    games, gamesLabel: games ? man(games) : "",
    say: games
      ? (JA ? `MTGアリーナ、${nameJa}のドラフト環境の変化。${gSay}試合を分析して、勝てる色の組み合わせと、引けた試合の勝率が上がったカードを解説します。`
            : `What changed in ${nameJa} Draft on MTG Arena? We analyzed ${gSay} games: the colour pairs that win, and the cards whose win rate when drawn rose.`)
      : (JA ? `MTGアリーナ、${nameJa}のドラフト環境の変化。勝てる色の組み合わせと、引けた試合の勝率が上がったカードを解説します。`
            : `What changed in ${nameJa} Draft on MTG Arena? The colour pairs that win, and the cards whose win rate when drawn rose.`) });

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

  // 登録と高評価のお願い（build-short.mjs の ctaScene。色の組み合わせのあと、カードの話の前に一度だけ）
  if(cta) scenes.push(cta);

  // コモン編・アンコモン編・レア編（それぞれ、上がった3枚だけ。上がったカードが無い章は飛ばす）
  const chapterJa = { common: "コモン編", uncommon: "アンコモン編", rare: "レア編" };
  const chapterEn = { common: "COMMONS", uncommon: "UNCOMMONS", rare: "RARES" };
  const intro = { common: JA ? "続いてコモン編。" : "Next, commons. ", uncommon: JA ? "次はアンコモン編。" : "Then uncommons. ", rare: JA ? "そしてレア編。" : "And rares. " };
  // 1枚目に添える一言（2026年11月）：発売直後と最近のそれぞれで、同じレアリティの平均（比べたカード全体。試合数で重みづけ。レアは神話レアを含む）と比べて、
  //   どういう上がり方をしたかを言う。画面にも同じ内容の札を出す（tags）
  //   ・climbing   … 最近も平均より下（発売直後は軽く見られていたが、じわじわ上げてきている）
  //   ・reversal   … 発売直後は平均より 0.5pt 以上下 → 最近は平均より 0.5pt 以上上（逆転）
  //   ・strongMore … 発売直後から平均より 1pt 以上上（もともと強かったのが、さらに上がった）
  //   ・fromAvg    … 発売直後は平均並み → 最近は平均より 1pt 以上上
  //   最近の勝率がそのレアリティで1位なら、「今では〇〇で一番勝てるカード」と言う
  const grp = r => r === "mythic" ? "rare" : r;
  const avgW = (r, k) => { const l = (d.cards || []).filter(c => grp(c.rarity) === r && c[k]); const g = l.reduce((n, c) => n + c[k].games, 0); return g ? l.reduce((n, c) => n + c[k].gih * c[k].games, 0) / g : null; };
  const noteOf = (c, r) => {
    const aF = avgW(r, "first"), aL = avgW(r, "last");
    if(aF == null || aL == null) return null;
    const f = c.first.gih - aF, l = c.last.gih - aL;
    const best = (d.cards || []).filter(x => grp(x.rarity) === r).sort((a, b) => b.last.gih - a.last.gih)[0];
    const key = l < 0 ? "climbing" : f < -0.005 && l >= 0.005 ? "reversal" : f >= 0.01 ? "strongMore" : l >= 0.01 ? "fromAvg" : null;
    const top = !!best && best.name === c.name && key !== "climbing";
    if(!key && !top) return null;
    // 何の平均かを必ず言う（「コモンの平均勝率」など。2026年11月：「平均」だけでは何の平均か分からなかったため）
    const rn = RN[L][r], av = JA ? `${rn}の平均勝率` : `the average ${rn}`;
    const say = JA ? ({
        strongMore: top ? `発売直後から${av}を上回っていましたが、環境が成熟して、今では${rn}で一番勝てるカードになりました。` : `発売直後から${av}を上回る十分な評価でしたが、環境が成熟して、さらに評価を上げました。`,
        reversal: top ? `発売直後は${av}を下回っていましたが、今では${rn}で一番勝てるカードに。評価が大逆転しました。` : `発売直後は${av}を下回っていましたが、今では平均を超える一枚に。評価が逆転しました。`,
        fromAvg: top ? `発売直後は${av}並みでしたが、今では${rn}で一番勝てるカードです。` : `発売直後は${av}並みでしたが、今でははっきり上回っています。`,
        climbing: `発売直後は${av}を下回り、軽く見られていましたが、使い方が浸透して、じわじわ評価を上げています。`
      }[key] || `今では${rn}で一番勝てるカードです。`)
      : (" " + ({
        strongMore: top ? `Already above ${av} at launch, it's now the top ${rn} by win rate.` : `Already above ${av} at launch, it climbed even higher as the format matured.`,
        reversal: top ? `Below ${av} at launch, it's now the top ${rn}: a big turnaround.` : `Below ${av} at launch, it's now above average: a real turnaround.`,
        fromAvg: top ? `About ${av} at launch, it's now the top ${rn}.` : `About ${av} at launch, it's now clearly above it.`,
        climbing: `Below ${av} at launch and easy to overlook, it's slowly gaining ground as players learn how to use it.`
      }[key] || `It's now the top ${rn} by win rate.`));
    const TAG = JA ? { strongMore: "さらに評価アップ", reversal: "評価が逆転", fromAvg: "平均並み→平均以上", climbing: "じわじわ上昇中" }
                   : { strongMore: "Even stronger", reversal: "Turnaround", fromAvg: "Average → above", climbing: "Slowly rising" };
    const tags = [...(key ? [TAG[key]] : []), ...(top ? [JA ? `今の${rn}1位` : `#1 ${rn} now`] : [])];
    // 画面にも、比べた平均（発売直後 → 最近）を出す
    const avgLine = JA ? `${rn}の平均 ${pct(aF)}% → ${pct(aL)}%` : `Avg ${rn} ${pct(aF)}% → ${pct(aL)}%`;
    return { key, top, say, tags, avgLine };
  };
  let firstCh = true;
  for(const r of ["common", "uncommon", "rare"]){
    const up = chapterUp(r);
    if(!up.length) continue;
    const open = firstCh ? (JA ? `さて、まずは${chapterJa[r]}。` : `First up, ${r}s. `) : intro[r];   // 直前のお願いで「レアリティ別のカード評価を見る前に」と言っているので、短くつなぐ
    firstCh = false;
    const ch = JA ? chapterJa[r] : chapterEn[r];
    const c0 = up[0], rest = up.slice(1).map(c => c.label);
    // 何が上がったのか（引けた試合の勝率）を、文の前半で先に言う（2026年11月：「一番上がったのは〜」だけでは、何が上がったのか分からなかったため）。
    // どのレアリティかは直前の「〇〇編」で言っているので、ここでは繰り返さない
    // 発売直後に目立たなかったかどうかは、下の一言（noteOf）で言う（2026年11月から。以前はレアだけ「発売直後は目立たなかった〜」と言っていた）
    const note = noteOf(c0, r);
    if(note){ c0.tags = note.tags; c0.avgLine = note.avgLine; }
    const lead = (JA ? `引けた試合の勝率が一番上がったのは${c0.label}。発売直後の${pct(c0.first.gih)}パーセントから、最近は${pct(c0.last.gih)}パーセントです。`
                     : `The biggest rise in win rate when drawn is ${c0.label}: from ${pct(c0.first.gih)} percent at launch to ${pct(c0.last.gih)} percent recently.`)
               + (note ? note.say : "");
    const tail = !rest.length ? "" : (JA ? `${and(rest)}も上がっています。` : ` ${and(rest)} are up too.`);
    // 2026年11月：1枚目を大きく映す場面と、残りの2枚の場面に分けた（3枚並びはスマホで読めなかったため）。cards は両方とも同じ並び
    const base = { kind: "trendCards", dir: "up", cards: up, label: `trend-${r}-up`, rare: r === "rare",
      chapter: ch, heading: JA ? "引けた試合の勝率が上がった" : "Win rate when drawn: rising" };
    scenes.push({ ...base, part: "focus", say: open + lead, tail: rest.length ? 0.3 : 0.8, minDur: 4 });
    if(rest.length) scenes.push({ ...base, part: "rest", say: tail.trim(), tail: 0.8, minDur: 3 });
  }

  return scenes;
}
