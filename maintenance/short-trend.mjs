/*
 * 修正版ショート（確定版のあと。ドラフトの「1週目 → 直近の1週間」の変化）の台本を作る。役割はこれだけ。
 * 画面の描き方・読み上げ・動画の組み立ては build-short.mjs（MODE = trend のとき、この台本を使う）。
 *
 *   trendScript(d, ctx) → 場面の並び
 *     d   … data/trends/<SET>_draft.json（build-trend.mjs が作る。カードはコモン・アンコモンだけ）
 *     ctx … { JA, nameJa, names（data/names/<SET>.json）, pairName（2色の名前） }
 *
 * 場面: 冒頭（サムネイルと同じ中身：いちばん上がったコモン・アンコモンと、1週目 → 今の勝率）
 *       → 上がったコモン・アンコモン（3枚）→ 下がったコモン・アンコモン（3枚）→ 2色の組み合わせの変化 → 締め
 * 数字はセリフで言う分だけにする（1位のカードの差と、組み合わせの名前）。ほかは画面に任せる。
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

export function trendScript(d, { JA, nameJa, names, pairName }){
  const label = c => JA ? ((names.names || {})[c.name] || c.name) : c.name;
  const withLabel = list => (list || []).slice(0, 3).map(c => ({ ...c, label: label(c), img: JA ? (names.images || {})[c.name] : null }));
  const up = withLabel(d.risers), down = withLabel(d.fallers);
  const w = d.window || {};
  const games = (w.first ? w.first.games : 0) + (w.last ? w.last.games : 0);
  const el = elapsed(d, JA);
  const scenes = [];

  // 冒頭：サムネイルと同じ中身（帯「ドラフト環境の変化」・いちばん上がったカード・何週間で・1週目 → 今の勝率）。セリフも、その答えから入る
  const thumb = up[0] ? {
    ribbon: JA ? "ドラフト環境の変化" : "WHAT CHANGED IN DRAFT", bigRibbon: true,
    l1: JA ? `「${up[0].label}」` : `“${up[0].label}”`, l2: "",
    subs: JA ? [el ? `発売${el}で一番上がった` : "1週目から一番上がった", "コモン・アンコモン"] : ["Top rising common/uncommon", el ? `${el} in` : "since week one"],
    sub2: JA ? `1週目 ${pct(up[0].first.gih)}% → 今 ${pct(up[0].last.gih)}%` : `Week 1 ${pct(up[0].first.gih)}% → now ${pct(up[0].last.gih)}%`
  } : null;
  scenes.push({ kind: "hook", art: true, trend: true, gamesN: games, thumb,
    say: up[0]
      ? (JA ? `MTGアリーナ、${nameJa}のドラフト。発売${el ? "から" + el : "直後から"}で、一番評価が上がったコモン・アンコモンは、${up[0].label}でした。`
            : `${nameJa} Draft on MTG Arena: ${el ? el + " in" : "since week one"}, the common or uncommon that rose the most is ${up[0].label}.`)
      : (JA ? `MTGアリーナ、${nameJa}のドラフト。1週目と最近の1週間で、評価が変わったカードを1分でまとめました。`
            : `${nameJa} Draft on MTG Arena: what changed between week one and the latest week, in one minute.`),
    title: nameJa });

  // 上がった・下がったコモン・アンコモン（3枚ずつ。1位だけ、差を読む）
  if(up.length){
    const rest = up.slice(1).map(c => c.label);
    scenes.push({ kind: "trendCards", dir: "up", cards: up, label: "trend-up", tail: 0.8, minDur: 6,
      say: JA ? `${up[0].label}は、1週目から勝率が${pt1(up[0].delta)}ポイント上がりました。${rest.length ? "ほかに、" + rest.join("と") + "も上がっています。" : ""}`
              : `${up[0].label} is up ${pt1(up[0].delta)} points since week one.${rest.length ? ` ${rest.join(" and ")} are climbing too.` : ""}` });
  }
  if(down.length){
    const rest = down.slice(1).map(c => c.label);
    scenes.push({ kind: "trendCards", dir: "down", cards: down, label: "trend-down", tail: 0.8, minDur: 6,
      say: JA ? `逆に一番下がったのは${down[0].label}。${pt1(down[0].delta)}ポイント下がりました。${rest.length ? rest.join("と") + "も下がっています。" : ""}`
              : `The biggest faller: ${down[0].label}, down ${pt1(down[0].delta)} points.${rest.length ? ` ${rest.join(" and ")} dropped too.` : ""}` });
  }

  // 2色の組み合わせ：いちばん伸びた・いちばん落ちた・1位（1週目から変わらないか、入れ替わったか）
  const pairs = (d.pairs || []).slice();
  if(pairs.length >= 3){
    const rise = pairs.slice().sort((a, b) => b.delta - a.delta)[0], fall = pairs.slice().sort((a, b) => a.delta - b.delta)[0], top = pairs[0];
    const firstTop = pairs.slice().sort((a, b) => b.first.wr - a.first.wr)[0];
    const keepTop = firstTop === top;
    const R = pairName(rise.colors), F = pairName(fall.colors), Tn = pairName(top.colors), F1 = pairName(firstTop.colors);
    const topLine = keepTop
      ? (JA ? `1位は発売直後から変わらず、${Tn}です。` : `${Tn} has been the best pair since week one.`)
      : top === rise
        ? (JA ? `伸びた${R}が、${F1}を抜いて1位になりました。` : `${R} has overtaken ${F1} for first place.`)
        : (JA ? `1週目の1位は${F1}でしたが、今は${Tn}が1位です。` : `${F1} was best in week one; now it's ${Tn}.`);
    scenes.push({ kind: "trendPairs", pairs, rise, fall, top, keepTop, tail: 0.8, minDur: 6,
      say: JA ? `色の組み合わせでは、${R}が一番伸びて、${F}が一番落ちました。${topLine}`
              : `Among colour pairs, ${R} rose the most and ${F} fell the most. ${topLine}` });
  }

  scenes.push({ kind: "outro", art: true,
    say: JA ? `次のセットも出すので、チャンネル登録お願いします！` : `Next set's coming, so subscribe!`, tail: 0.4 });
  return scenes;
}
