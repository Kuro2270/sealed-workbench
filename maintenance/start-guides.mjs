/*
 * 入門ページのうち、読み物の2ページ「シールドの組み方」（start/sealed）と「ドラフトの基本」（start/draft）の中身。役割はこれだけ。
 *   ページの枠・タブ・書き出しは build-start.mjs（このファイルは文面と、各ブロックの HTML を返すだけ）。
 *   長い説明は書かない。3行まとめ → 手順 → データ → チェックリスト → よくある失敗 → 次の一歩 の順で、流し読みできる形にする。
 *   「データで見る」の数字は、ページを作るときに data/articles/<SET>_sealed.json・<SET>_draft.json（環境レポートと同じ集計）から出す。
 *   40枚の配分・マナカーブ・除去の話は「リミテッドとは」（start/limited）にあるので、ここでは繰り返さずにリンクする。
 */
import { readdirSync, readFileSync } from "node:fs";

/* ------------------------------------------------------------------ データ（全セットの集計） */
export function formatStats(dir = "data/articles"){
  const files = (() => { try{ return readdirSync(dir); }catch(e){ return []; } })();
  const load = (set, mode) => { try{ return JSON.parse(readFileSync(`${dir}/${set}_${mode}.json`, "utf8")); }catch(e){ return null; } };
  const sets = [...new Set(files.map(f => (f.match(/^([A-Z0-9]+)_sealed\.json$/) || [])[1]).filter(Boolean))].sort();
  const colorAgg = { sealed: {}, draft: {} };
  const deltas = [];      // [セット, シールドの差, ドラフトの差]（差 = 重いデッキ − 軽いデッキの勝率。ポイント）
  let latest = "";
  for(const set of sets){
    const s = load(set, "sealed"), d = load(set, "draft");
    if(!s || !d) continue;
    for(const [mode, a] of [["sealed", s], ["draft", d]]){
      for(const x of a.archetypes || []){
        const n = String(x.colors || "").length; if(n < 2 || n > 3) continue;
        const g = colorAgg[mode][n] || (colorAgg[mode][n] = { games: 0, wins: 0 });
        g.games += x.games; g.wins += x.games * x.wr;
      }
      if(String(a.data_generated_at || "") > latest) latest = String(a.data_generated_at);
    }
    const gap = a => { const m = Object.fromEntries((a.speed || []).map(x => [x.key, x.wr])); return m.fast != null && m.slower != null ? (m.slower - m.fast) * 100 : null; };
    const gs = gap(s), gd = gap(d);
    if(gs != null && gd != null) deltas.push([set, gs, gd]);
  }
  const col = mode => {
    const two = colorAgg[mode][2], three = colorAgg[mode][3];
    if(!two || !three) return null;
    return { two: two.wins / two.games * 100, three: three.wins / three.games * 100, share: three.games / (two.games + three.games) * 100 };
  };
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return {
    sets: deltas.length,
    asOf: latest.slice(0, 10),
    sealedKinder: deltas.filter(([, s, d]) => s > d).length,       // シールドのほうが、ドラフトより重いデッキに寛容なセットの数
    draftLight: deltas.filter(([, , d]) => d < 0).length,          // ドラフトで、軽いデッキが重いデッキより勝っているセットの数
    gapSealed: avg(deltas.map(x => x[1])), gapDraft: avg(deltas.map(x => x[2])),
    colSealed: col("sealed"), colDraft: col("draft")
  };
}

/* ------------------------------------------------------------------ 文面 */
const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
const sign = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + f1(Math.abs(n));

export const READ = {
  ja: {
    sealed: {
      title: "シールドの組み方｜MTGアリーナのシールドで40枚デッキを作る5ステップ",
      desc: "6パックのプールから40枚のデッキを組む手順を、5つのステップとチェックリストでまとめました。タッチ（3色目）の判断や、実戦データから見たシールドの特徴も紹介します。",
      h1: "シールドの組み方",
      tab: "シールドの組み方",
      lead: "6パック（84枚）のプールから、40枚のデッキを組む手順です。迷ったら、この順番で進めてください。",
      toc: [["sum", "3行まとめ"], ["steps", "5ステップ"], ["touch", "3色目の判断"], ["data", "データで見る"], ["check", "チェックリスト"], ["ng", "よくある失敗"], ["next", "次の一歩"]],
      sum: ["<b>強いカードから色を決める</b>（1枚で勝てるレアと、除去）", "<b>2色・土地17枚</b>が基本。クリーチャーは15〜17枚", "シールドはドラフトより<b>少し重いデッキでも戦える</b>"],
      stepsH: "組み方の5ステップ",
      steps: [
        ["色ごとに並べる", "プールを色別に分け、各色の「デッキに入れられるカード」を数えます。色のないカードは別にしておきます。"],
        ["強いカードに印をつける", "1枚で試合を決めるカード（ボム）と、相手のクリーチャーを倒せるカード（除去）を探します。色はここでほぼ決まります。"],
        ["2色を選ぶ", "ボムと除去が多い色を軸に、使えるカードが23枚前後そろう組み合わせを選びます。片方が薄ければ、別の組み合わせも並べて比べます。"],
        ["23枚にしぼる", "クリーチャー15〜17枚、呪文6〜8枚。2マナを多めにして、5マナ以上は4〜5枚までにします。"],
        ["土地を決める", "基本は17枚。色の比率はカードに書かれた色マークの数に合わせます（例：平地9・山8）。"]
      ],
      stepsNote: "枚数の目安とマナカーブは<a href=\"limited.html#deck\">リミテッドとは</a>の図で確認できます。",
      touchH: "3色目（タッチ）を足すか",
      touchLead: "2色に、別の色のカードを1〜2枚だけ足すことを「タッチ」と呼びます。",
      touchOk: ["1枚で勝てるボムや、強い除去", "色マークが1つだけ（例：{2}{R}）", "その色のマナを出せる土地やカードがある"],
      touchNg: ["色マークが2つ以上（例：{R}{R}）", "ふつうのカードを足したいだけ", "軽いデッキで、速さが大事な環境"],
      okH: "タッチしてよい", noH: "やめたほうがよい",
      dataH: "データで見るシールド",
      dataLead: "このサイトの<a href=\"../reports.html\">環境レポート</a>を、セットをまたいで集計しました。",
      tiles: st => [
        st.sets ? [`${st.sealedKinder}<small>/${st.sets}セット</small>`, "シールドは、重いデッキでも勝率が落ちにくい",
          `${st.sets}セット中${st.sealedKinder}セットで、ドラフトより差が小さくなっています。重いデッキ（平均マナ総量3.5以上）と軽いデッキ（2.9未満）の勝率の差は、平均でシールド${sign(st.gapSealed)}・ドラフト${sign(st.gapDraft)}ポイント。シールドでは5〜6マナの強いカードも入れやすくなります。`] : null,
        st.colSealed ? [`約${Math.round(st.colSealed.share)}<small>%</small>`, "シールドの3色デッキの割合",
          `勝率は2色${f1(st.colSealed.two)}%・3色${f1(st.colSealed.three)}%で、差は${f1(st.colSealed.two - st.colSealed.three)}ポイント${st.colDraft ? `（ドラフトは${f1(st.colDraft.two - st.colDraft.three)}ポイント）` : ""}。強いカードのためのタッチは、シールドなら割に合いやすいです。`] : null
      ].filter(Boolean),
      asOf: (st) => `集計：${st.sets}セット・${st.asOf}時点のデータ。数字はデータの更新で変わります。`,
      checkH: "提出前のチェックリスト",
      check: ["40枚ちょうど（土地17枚）", "2マナのクリーチャーが4枚以上", "除去ができるカードが3枚以上（できれば）", "5マナ以上は5枚まで", "土地の色の比率が、色マークの数と合っている", "空を飛ぶクリーチャーへの対処がある", "使いにくい強化呪文より、ふつうのクリーチャーを優先した"],
      ngH: "よくある失敗",
      ng: [
        ["強いカードを全部入れたくて、3〜4色になる", "2色＋タッチ1〜2枚まで。土地がそろわない負けがいちばんもったいない"],
        ["レアだから入れる", "強さはレアリティではなく勝率で見る（環境レポートのカード勝率）"],
        ["土地を16枚に減らす", "17枚が基本。重いデッキなら17〜18枚"]
      ],
      nextH: "次の一歩",
      next: [
        ["シールドを練習する", "仮想の6パックで、40枚デッキを組む練習。", "../sealed.html", true],
        ["シールドのデッキ構築補助", "アリーナのプールを読み込み、勝率からデッキ案を出します（PC）。", "../sealed-assist.html", false],
        ["環境レポートを見る", "セットごとの強い色・強いカード。", "../reports.html", false],
        ["ドラフトの基本", "パックを回してカードを取る、もう1つの遊び方。", "draft.html", false]
      ]
    },
    draft: {
      title: "ドラフトの基本｜MTGアリーナのドラフトで、カードを取る順番と色の決め方",
      desc: "8人でパックを回しながらカードを取るドラフトの基本を、ピックの流れ・時期ごとの優先順位・空いている色の見つけ方・チェックリストでまとめました。",
      h1: "ドラフトの基本",
      tab: "ドラフトの基本",
      lead: "パックを回しながら1枚ずつカードを取り、40枚のデッキを作るのがドラフトです。何を取るか・いつ色を決めるかの基本をまとめました。",
      toc: [["sum", "3行まとめ"], ["flow", "ピックの流れ"], ["when", "時期ごとの取り方"], ["signal", "空いている色"], ["data", "データで見る"], ["ng", "よくある失敗"], ["next", "次の一歩"]],
      sum: ["最初の数手は、色にこだわらず<b>いちばん強いカード</b>", "<b>2パック目の前半までに2色</b>にしぼる", "遅い手番で強いカードが流れてくる色は<b>空いている</b>"],
      flowH: "ピックの流れ",
      flow: [["1パック目", "14枚から1枚取り、残りを左へ回す"], ["2パック目", "今度は右へ回す"], ["3パック目", "また左へ回す"], ["デッキを組む", "取った42枚から23枚＋土地17枚"]],
      flowNote: "デッキの組み方は、シールドと同じです。<a href=\"sealed.html#steps\">シールドの組み方</a>の手順で進めてください。",
      whenH: "時期ごとの取り方",
      whenCol: ["時期", "取るもの"],
      when: [
        ["1パック目の前半<br><small>1〜5手目</small>", "色にこだわらず、<b>いちばん強いカード</b>。ボム ＞ 除去 ＞ 強いクリーチャーの順"],
        ["1パック目の後半〜<br>2パック目の前半", "強いカードが流れてくる色を見ながら、<b>2色にしぼる</b>"],
        ["2パック目の後半〜<br>3パック目", "自分の2色で<b>足りない役を埋める</b>（2マナのクリーチャー、除去、飛行への対処）"]
      ],
      signalH: "空いている色の見つけ方",
      signal: [
        ["🔍", "遅い手番を見る", "6手目以降に、その色の強いカードがまだ残っていれば、上流（渡してくる人）はその色を取っていません。"],
        ["🔁", "向きを覚える", "1パック目と3パック目は同じ向き。1パック目で空いていた色は、3パック目でも流れてきやすいです。"],
        ["⚖️", "こだわりすぎない", "1枚の強いカードのために、流れてこない色を続けるより、空いている色に移るほうが結果は良くなりがちです。"]
      ],
      signalNote: "クイックドラフトは、ほかの7人がコンピューターです。流れの読み方は目安くらいに考えてください。",
      dataH: "データで見るドラフト",
      dataLead: "このサイトの<a href=\"../reports.html\">環境レポート</a>を、セットをまたいで集計しました。",
      tiles: st => [
        st.sets ? [`${st.draftLight}<small>/${st.sets}セット</small>`, "ドラフトは、軽いデッキが有利",
          `軽いデッキ（平均マナ総量2.9未満）が、重いデッキ（3.5以上）より勝っています。差は平均${f1(Math.abs(st.gapDraft))}ポイント。重いカードの取りすぎに注意。`] : null,
        st.colDraft ? [`${f1(st.colDraft.two - st.colDraft.three)}<small>ポイント</small>`, "3色デッキは2色より勝率が低い",
          `2色${f1(st.colDraft.two)}%・3色${f1(st.colDraft.three)}%。3色デッキは全体の約${Math.round(st.colDraft.share)}%です。ドラフトでは2色にまとめるのが基本です。`] : null
      ].filter(Boolean),
      asOf: (st) => `集計：${st.sets}セット・${st.asOf}時点のデータ。数字はデータの更新で変わります。`,
      ngH: "よくある失敗",
      ng: [
        ["1手目の色に最後までこだわる", "流れを見て、2パック目の前半までに乗り換える"],
        ["レアや重いカードばかり取る", "2マナのクリーチャーと除去を、中盤から意識して取る"],
        ["3パック目でも強いカードを取り続ける", "自分の2色で使えるカードを優先する。使えないカードは0点"]
      ],
      nextH: "次の一歩",
      next: [
        ["ドラフトを練習する", "8人卓を再現した仮想ドラフトで、ピックの練習。", "../draft.html", true],
        ["友達とドラフトする", "招待リンクで、友達と同じ卓を囲むドラフト。", "../draftroom.html", false],
        ["ドラフトのデッキ構築補助", "アリーナのドラフト中に、勝率と色から候補を表示します（PC）。", "../assistant.html", false],
        ["環境レポートを見る", "セットごとの強い色・強いカード。", "../reports.html", false]
      ]
    }
  },

  en: {
    sealed: {
      title: "How to Build a Sealed Deck | 5 Steps for MTG Arena Sealed",
      desc: "How to turn a six-pack pool into a 40-card deck, in five steps and a checklist — plus when to splash a third colour and what the data says about Sealed.",
      h1: "Building a Sealed deck",
      tab: "Building Sealed",
      lead: "How to build a 40-card deck from a six-pack (84-card) pool. If you are not sure where to start, follow these steps in order.",
      toc: [["sum", "In short"], ["steps", "5 steps"], ["touch", "Splashing"], ["data", "The data"], ["check", "Checklist"], ["ng", "Common mistakes"], ["next", "Next steps"]],
      sum: ["<b>Let your best cards pick your colours</b> (bombs and removal)", "<b>Two colours and 17 lands</b>, with 15–17 creatures", "Sealed is slower than Draft, so <b>a slightly heavier deck is fine</b>"],
      stepsH: "Five steps",
      steps: [
        ["Sort by colour", "Split the pool by colour and count the playable cards in each. Keep colourless cards to one side."],
        ["Mark your best cards", "Find the cards that win games on their own (bombs) and the ones that deal with creatures (removal). These usually decide your colours."],
        ["Pick two colours", "Build around the colours with the most bombs and removal, aiming for about 23 playables. If one colour is thin, lay out another pair and compare."],
        ["Cut to 23 cards", "15–17 creatures and 6–8 spells. Plenty of two-drops, and no more than 4–5 cards that cost five or more."],
        ["Set your lands", "Start at 17. Split them by the coloured mana symbols on your cards (for example 9 Plains and 8 Mountains)."]
      ],
      stepsNote: "For the card counts and mana curve, see the charts in <a href=\"limited.en.html#deck\">What is Limited?</a>",
      touchH: "Should you splash a third colour?",
      touchLead: "Adding just one or two cards of a third colour is called a splash.",
      touchOk: ["A bomb or premium removal", "Only one coloured symbol (e.g. {2}{R})", "You have lands or cards that make that colour"],
      touchNg: ["Two or more coloured symbols (e.g. {R}{R})", "You only want to add an average card", "A fast format where tempo matters"],
      okH: "Splash it", noH: "Skip it",
      dataH: "Sealed by the numbers",
      dataLead: "Totals across sets from this site's <a href=\"../reports.html\">set reports</a>.",
      tiles: st => [
        st.sets ? [`${st.sealedKinder}<small>/${st.sets} sets</small>`, "Heavy decks lose less ground in Sealed",
          `In ${st.sealedKinder} of ${st.sets} sets the gap is smaller than in Draft. The win-rate gap between heavy decks (3.5+ average mana value) and light ones (under 2.9) averages ${sign(st.gapSealed)} points in Sealed and ${sign(st.gapDraft)} in Draft. Strong five- and six-drops are easier to play in Sealed.`] : null,
        st.colSealed ? [`~${Math.round(st.colSealed.share)}<small>%</small>`, "of Sealed decks use three colours",
          `Two colours win ${f1(st.colSealed.two)}% and three colours ${f1(st.colSealed.three)}%, a gap of only ${f1(st.colSealed.two - st.colSealed.three)} points${st.colDraft ? ` (${f1(st.colDraft.two - st.colDraft.three)} in Draft)` : ""}. Splashing for a strong card pays off more often in Sealed.`] : null
      ].filter(Boolean),
      asOf: (st) => `Based on ${st.sets} sets, data as of ${st.asOf}. The numbers change as the data updates.`,
      checkH: "Checklist before you submit",
      check: ["Exactly 40 cards (17 lands)", "At least four two-mana creatures", "Three or more removal cards (if you can)", "No more than five cards costing five or more", "Your land split matches your coloured symbols", "An answer to flying creatures", "Solid creatures over clunky pump spells"],
      ngH: "Common mistakes",
      ng: [
        ["Playing three or four colours to fit every good card", "Two colours plus a splash of one or two cards. Losing to your own mana is the worst way to lose"],
        ["Playing a card because it is rare", "Judge cards by win rate, not rarity (see the card win rates in the set reports)"],
        ["Cutting to 16 lands", "17 is the default. Heavier decks can run 17–18"]
      ],
      nextH: "Next steps",
      next: [
        ["Practise Sealed", "Build a 40-card deck from six virtual packs.", "../sealed.html", true],
        ["Sealed deck helper", "Reads your Arena pool and suggests decks from win rates (PC).", "../sealed-assist.html", false],
        ["Set reports", "The strongest colours and cards in each set.", "../reports.html", false],
        ["Draft basics", "The other way to play: pass packs and pick cards.", "draft.en.html", false]
      ]
    },
    draft: {
      title: "Draft Basics | What to Pick and When to Choose Colours in MTG Arena Draft",
      desc: "The basics of Draft: how picks flow, what to take at each stage, how to spot an open colour, and the mistakes to avoid.",
      h1: "Draft basics",
      tab: "Draft basics",
      lead: "In Draft you pick one card at a time as packs are passed around, then build a 40-card deck. Here is what to take and when to settle on colours.",
      toc: [["sum", "In short"], ["flow", "How picks flow"], ["when", "What to take"], ["signal", "Open colours"], ["data", "The data"], ["ng", "Common mistakes"], ["next", "Next steps"]],
      sum: ["Early on, take <b>the strongest card</b>, whatever the colour", "<b>Settle on two colours</b> by early pack two", "A colour whose good cards come late is <b>open</b>"],
      flowH: "How picks flow",
      flow: [["Pack 1", "Take one of 14 cards and pass the rest left"], ["Pack 2", "Pass to the right"], ["Pack 3", "Pass left again"], ["Build", "23 of your 42 picks plus 17 lands"]],
      flowNote: "Building the deck works the same as in Sealed — follow the steps in <a href=\"sealed.en.html#steps\">Building a Sealed deck</a>.",
      whenH: "What to take at each stage",
      whenCol: ["Stage", "What to take"],
      when: [
        ["Early pack 1<br><small>Picks 1–5</small>", "<b>The strongest card</b>, whatever the colour: bombs, then removal, then strong creatures"],
        ["Late pack 1 to<br>early pack 2", "Watch which colours keep flowing and <b>narrow down to two</b>"],
        ["Late pack 2 to<br>pack 3", "<b>Fill the gaps</b> in your two colours: two-drops, removal, answers to flyers"]
      ],
      signalH: "How to spot an open colour",
      signal: [
        ["🔍", "Watch the late picks", "If strong cards of a colour are still there from pick 6 onwards, the players passing to you are not taking it."],
        ["🔁", "Remember the direction", "Packs 1 and 3 go the same way, so a colour that was open in pack 1 tends to flow again in pack 3."],
        ["⚖️", "Don't marry a colour", "Moving into the open colour usually works out better than forcing one strong card's colour."]
      ],
      signalNote: "In Quick Draft the other seven drafters are bots, so treat these signals as a rough guide.",
      dataH: "Draft by the numbers",
      dataLead: "Totals across sets from this site's <a href=\"../reports.html\">set reports</a>.",
      tiles: st => [
        st.sets ? [`${st.draftLight}<small>/${st.sets} sets</small>`, "Light decks do better in Draft",
          `Decks under 2.9 average mana value beat decks at 3.5 and above, by ${f1(Math.abs(st.gapDraft))} points on average. Don't overload on expensive cards.`] : null,
        st.colDraft ? [`${f1(st.colDraft.two - st.colDraft.three)}<small> points</small>`, "Three-colour decks win less than two-colour ones",
          `Two colours win ${f1(st.colDraft.two)}%, three colours ${f1(st.colDraft.three)}%. Only about ${Math.round(st.colDraft.share)}% of decks use three. Stick to two in Draft.`] : null
      ].filter(Boolean),
      asOf: (st) => `Based on ${st.sets} sets, data as of ${st.asOf}. The numbers change as the data updates.`,
      ngH: "Common mistakes",
      ng: [
        ["Sticking with your first pick's colour no matter what", "Read the flow and switch by early pack two"],
        ["Taking only rares and expensive cards", "From mid pack 1, pick up two-drops and removal on purpose"],
        ["Still taking the 'best card' in pack 3", "Prioritise playables in your two colours. A card you can't play is worth nothing"]
      ],
      nextH: "Next steps",
      next: [
        ["Practise Draft", "A virtual eight-player draft to practise your picks.", "../draft.html", true],
        ["Draft with friends", "Share an invite link and draft at the same table.", "../draftroom.html", false],
        ["Draft deck helper", "Shows suggestions by win rate and colour during an Arena draft (PC).", "../assistant.html", false],
        ["Set reports", "The strongest colours and cards in each set.", "../reports.html", false]
      ]
    }
  }
};

/* ------------------------------------------------------------------ 見た目（build-start.mjs の css に足す） */
export const guideCss = `<style>
  .sum{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;counter-reset:m}
  .sum li{counter-increment:m;background:var(--pine);color:#fff;border-radius:12px;padding:14px 16px 14px 50px;position:relative;font-size:14px;line-height:1.6}
  .sum li::before{content:counter(m);position:absolute;left:14px;top:13px;width:26px;height:26px;border-radius:50%;background:var(--gold);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px}
  .sum li b{color:#9CC8FF}
  .yn{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .yn div{border-radius:10px;padding:12px 16px;border:2px solid}
  .yn .y{border-color:#86B58C;background:#F1F9F2}.yn .n{border-color:#E39A86;background:#FFF3EF}
  .yn h3{margin:0 0 6px;font-size:15px}
  .yn ul{margin:0;padding:0;list-style:none;font-size:13.5px;line-height:1.7}
  .yn .y li::before{content:"✓";color:#2E8B3E;font-weight:800;margin-right:8px}
  .yn .n li::before{content:"✕";color:#C4472B;font-weight:800;margin-right:8px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .tile{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:linear-gradient(180deg,#F4F8FE,#fff)}
  .tile .big{font-size:34px;font-weight:800;color:var(--gold);line-height:1.1}
  .tile .big small{font-size:15px;font-weight:700;margin-left:2px;color:var(--muted)}
  .tile b{display:block;margin:4px 0 4px;font-size:15px}
  .tile p{margin:0;font-size:13px;line-height:1.65;color:var(--ink)}
  .asof{font-size:12px;color:var(--muted);margin:10px 0 0}
  .chk{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px 14px}
  .chk label{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:8px;background:var(--paper-2);font-size:14px;line-height:1.5;cursor:pointer}
  .chk input{width:18px;height:18px;margin:1px 0 0;flex:none;accent-color:var(--gold)}
  .chk input:checked + span{color:var(--muted);text-decoration:line-through}
  .mist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
  .mist li{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;font-size:13.5px;line-height:1.6}
  .mist .bad,.mist .good{border-radius:10px;padding:10px 12px}
  .mist .bad{background:#FFF3EF;border:1px solid #F0C6B9}.mist .good{background:#F1F9F2;border:1px solid #BFDDC3}
  .mist .bad::before{content:"✕ ";color:#C4472B;font-weight:800}.mist .good::before{content:"✓ ";color:#2E8B3E;font-weight:800}
  .mist .ar{color:var(--muted);font-weight:800}
  .when td:first-child{width:30%;font-weight:700;color:var(--pine)}
  .when td small{font-weight:500;color:var(--muted)}
  #steps .steps{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
  #next .cta{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
  @media (max-width:720px){
    .mist li{grid-template-columns:1fr;gap:4px}.mist .ar{display:none}
    .modebar .tabs{display:flex;overflow-x:auto;max-width:100%}.modebar .tab{padding:8px 14px;white-space:nowrap}
  }
</style>`;

/* ------------------------------------------------------------------ ブロック */
const SYM = t => String(t).replace(/\{([0-9WUBRGC])\}/g, (m, k) => `<img class="ms" src="https://svgs.scryfall.io/card-symbols/${k}.svg" alt="{${k}}" width="18" height="18" loading="lazy">`);   // {2}{R} → マナシンボル

export function guideSections(lang, kind){
  const G = READ[lang][kind], st = formatStats();
  const S = {};
  S.sum = `<section class="blk" id="sum"><h2>${lang === "en" ? "In short" : "3行まとめ"}</h2><ol class="sum">${G.sum.map(x => `<li>${x}</li>`).join("")}</ol></section>`;
  if(G.steps) S.steps = `<section class="blk" id="steps"><h2>${G.stepsH}</h2>
<ol class="steps">${G.steps.map(s => `<li><b>${s[0]}</b>${s[1]}</li>`).join("")}</ol><p class="note">${G.stepsNote}</p></section>`;
  if(G.touchOk) S.touch = `<section class="blk" id="touch"><h2>${G.touchH}</h2><p class="lead">${G.touchLead}</p>
<div class="yn"><div class="y"><h3>${G.okH}</h3><ul>${G.touchOk.map(x => `<li>${SYM(x)}</li>`).join("")}</ul></div><div class="n"><h3>${G.noH}</h3><ul>${G.touchNg.map(x => `<li>${SYM(x)}</li>`).join("")}</ul></div></div></section>`;
  if(G.flow) S.flow = `<section class="blk" id="flow"><h2>${G.flowH}</h2>
<ol class="flow">${G.flow.map(s => `<li><b>${s[0]}</b>${s[1]}</li>`).join("")}</ol><p class="note">${G.flowNote}</p></section>`;
  if(G.when) S.when = `<section class="blk" id="when"><h2>${G.whenH}</h2>
<table class="cmp when"><thead><tr>${G.whenCol.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${G.when.map(x => `<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join("\n")}</tbody></table></section>`;
  if(G.signal) S.signal = `<section class="blk" id="signal"><h2>${G.signalH}</h2>
<div class="cards3">${G.signal.map(p => `<div class="pt"><span class="ic">${p[0]}</span><b>${p[1]}</b><p>${p[2]}</p></div>`).join("")}</div><p class="note">${G.signalNote}</p></section>`;
  const tiles = G.tiles(st);
  if(tiles.length) S.data = `<section class="blk" id="data"><h2>${G.dataH}</h2><p class="lead">${G.dataLead}</p>
<div class="tiles">${tiles.map(t => `<div class="tile"><div class="big">${t[0]}</div><b>${t[1]}</b><p>${t[2]}</p></div>`).join("")}</div><p class="asof">${G.asOf(st)}</p></section>`;
  if(G.check) S.check = `<section class="blk" id="check"><h2>${G.checkH}</h2>
<ul class="chk">${G.check.map(x => `<li><label><input type="checkbox"><span>${x}</span></label></li>`).join("")}</ul></section>`;
  S.ng = `<section class="blk" id="ng"><h2>${G.ngH}</h2>
<ul class="mist">${G.ng.map(x => `<li><span class="bad">${x[0]}</span><span class="ar">→</span><span class="good">${x[1]}</span></li>`).join("")}</ul></section>`;
  S.next = `<section class="blk" id="next"><h2>${G.nextH}</h2>
<div class="cta">${G.next.map(x => `<a class="${x[3] ? "main" : ""}" href="${x[2]}"><b>${x[0]}</b><small>${x[1]}</small></a>`).join("")}</div></section>`;
  const toc = `<ul class="toc">${G.toc.filter(x => S[x[0]]).map(x => `<li><a href="#${x[0]}">${x[1]}</a></li>`).join("")}</ul>`;
  return toc + "\n" + G.toc.map(x => S[x[0]]).filter(Boolean).join("\n");
}
