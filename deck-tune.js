/* デッキ案の入れ替え（除去の枚数と、マナカーブ・平均マナ）。役割はこれだけ。
   ドラフト補助・シールド補助が、勝率順に選んだ23枚に対して使う。

   勝率（GIH）は、重いカードほど高く出やすい（長引いた試合で引かれるため）。勝率順に並べるだけだと、
   重く、除去の少ないデッキになりやすい。そこで、勝率の差が小さい範囲で次の順に入れ替える。
     1) 除去が目安（REMOVAL_MIN）より少なければ、控えの除去と、デッキの除去でない最も評価の低いカードを入れ替える
     2) 平均マナ総量が環境の速さの目安を超えるか、2マナ以下が目安より少なければ、重いカードを同じ枠（クリーチャーならクリーチャー）の軽いカードと入れ替える
   クリーチャーは MIN_CREATURES 枚より減らさない。除去は目安の枚数を割るほどには抜かない。

   DeckTune.goals(pace, avgMax) … { avgMax, earlyMin, removalMin }。avgMax は環境レポートの区切り（無ければ速さごとの既定）
   DeckTune.tune(deck, rest, opt) … deck（23枚）と rest（控え、評価の高い順）を入れ替える。
       opt: { pace, avgMax, allowed(x) }   allowed は同じ伝説の枚数などの制限（入れてよければ true）
       戻り値: { removal, avg, early, goals }
   カードは { id, c: { cmc, removal }, r（評価）, kind: "creature" | "spell" } の形。 */
const DeckTune = (() => {
  const REMOVAL_MIN = 5;            // 除去の目安（スペル枠は除去を先に入れたうえで、足りなければクリーチャー枠とも入れ替える）
  const LOSS_REMOVAL = 6;           // 除去を入れるために許す評価の差（勝率ポイント）
  const LOSS_CURVE = 3;             // カーブを整えるために許す評価の差
  const MIN_CREATURES = 14;         // クリーチャーはこれより減らさない
  const AVG_MAX = { fast: 2.9, mid: 3.2, slow: 3.5, slower: null };   // 環境レポートの「速さ」の区切りと同じ
  const EARLY_MIN = { fast: 8, mid: 6, slow: 5, slower: 4 };          // 1〜2マナのカードの目安

  const cmc = x => (x.c && x.c.cmc) || 0;
  const isRem = x => !!(x.c && x.c.removal);
  const isCre = x => x.kind === "creature";

  function goals(pace, avgMax){
    const p = AVG_MAX.hasOwnProperty(pace) ? pace : "mid";
    return {
      avgMax: avgMax != null ? avgMax : AVG_MAX[p],
      earlyMin: EARLY_MIN[p],
      removalMin: REMOVAL_MIN
    };
  }
  function stats(deck){
    const n = deck.length || 1;
    return {
      removal: deck.filter(isRem).length,
      avg: deck.reduce((a, x) => a + cmc(x), 0) / n,
      early: deck.filter(x => cmc(x) <= 2).length,
      creatures: deck.filter(isCre).length
    };
  }
  function swap(deck, rest, out, inn){
    deck.splice(deck.indexOf(out), 1); rest.splice(rest.indexOf(inn), 1);
    deck.push(inn); rest.push(out);
    rest.sort((a, b) => b.r - a.r);
  }
  /* クリーチャーの枚数を割らない入れ替えか */
  function keepsCreatures(deck, out, inn){
    return !isCre(out) || isCre(inn) || stats(deck).creatures > MIN_CREATURES;
  }

  function tune(deck, rest, opt){
    const g = goals(opt.pace, opt.avgMax);
    const allowed = opt.allowed || (() => true);
    // 1) 除去
    for(let guard = 0; guard < 8; guard++){
      if(stats(deck).removal >= g.removalMin) break;
      const inn = rest.find(x => isRem(x) && allowed(x));
      if(!inn) break;
      const out = deck.filter(x => !isRem(x) && keepsCreatures(deck, x, inn)).sort((a, b) => a.r - b.r)[0];
      if(!out || out.r - inn.r > LOSS_REMOVAL) break;
      swap(deck, rest, out, inn);
    }
    // 2) カーブ：いちばん評価を落とさずに、目安へ近づく入れ替えを1組ずつ選ぶ
    for(let guard = 0; guard < 12; guard++){
      const st = stats(deck);
      const tooHeavy = g.avgMax != null && st.avg >= g.avgMax;
      const tooFewEarly = st.early < g.earlyMin;
      if(!tooHeavy && !tooFewEarly) break;
      let best = null;
      for(const out of deck){
        if(isRem(out) && st.removal <= g.removalMin) continue;          // 除去は目安を割るほど抜かない
        for(const inn of rest){
          if(!allowed(inn) || inn.kind !== out.kind) continue;           // 枠（クリーチャー・スペル）はそのまま。スペル枠の除去も崩さない
          const drop = cmc(out) - cmc(inn);
          if(drop <= 0) continue;                                         // 軽くならない入れ替えは見ない
          if(tooFewEarly && !(cmc(inn) <= 2 && cmc(out) > 2)) continue;   // 1〜2マナを増やす入れ替えに限る
          const loss = out.r - inn.r;
          if(loss > LOSS_CURVE) continue;
          // 評価の差が小さいほど良く、同じなら重さの差が大きいほど良い
          const val = loss - drop * 0.25;
          if(!best || val < best.val) best = { out, inn, val };
        }
      }
      if(!best) break;
      swap(deck, rest, best.out, best.inn);
    }
    const st = stats(deck);
    return { removal: st.removal, avg: st.avg, early: st.early, goals: g };
  }
  return { goals, tune, REMOVAL_MIN };
})();
if(typeof module !== "undefined") module.exports = DeckTune;
