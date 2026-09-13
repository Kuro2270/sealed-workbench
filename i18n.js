/*
 * 共通の言語切り替え。全ページがこれを読み込む。
 *
 * 使い方
 *   HTML: <span data-i18n="nav.sealed"></span>
 *         <input data-i18n-ph="deck.exportPh">      （placeholder）
 *         <html data-title="page.index.title">       （ページタイトル）
 *   JS  : t("status.ready")  /  t("pool.made", {n: 84})
 *
 * 文言を足すときは STRINGS に ja と en を両方書く。
 * 選んだ言語は localStorage に残る。
 */
(function(){
  const STRINGS = {
    /* ---- 共通 ---- */
    "nav.sealed":       { ja:"シールド構築",       en:"Sealed" },
    "nav.draft":        { ja:"ドラフト",           en:"Draft" },
    "nav.ratings":      { ja:"カード勝率一覧",     en:"Card win rates" },
    "lang.label":       { ja:"言語",               en:"Language" },

    "opt.img":          { ja:"カード画像を表示",   en:"Show card images" },
    "opt.text":         { ja:"テキストで一覧表示", en:"Text list view" },
    "opt.wr":           { ja:"勝率を表示",         en:"Show win rates" },

    "color.W":          { ja:"白",   en:"White" },
    "color.U":          { ja:"青",   en:"Blue" },
    "color.B":          { ja:"黒",   en:"Black" },
    "color.R":          { ja:"赤",   en:"Red" },
    "color.G":          { ja:"緑",   en:"Green" },
    "color.M":          { ja:"多色", en:"Multicolor" },
    "color.C":          { ja:"無色・土地", en:"Colorless & lands" },
    "color.Cshort":     { ja:"無色", en:"Colorless" },

    "sec.creature":     { ja:"クリーチャー", en:"Creatures" },
    "sec.spell":        { ja:"呪文",         en:"Spells" },
    "sec.land":         { ja:"土地",         en:"Lands" },

    "land.Plains":      { ja:"平地", en:"Plains" },
    "land.Island":      { ja:"島",   en:"Island" },
    "land.Swamp":       { ja:"沼",   en:"Swamp" },
    "land.Mountain":    { ja:"山",   en:"Mountain" },
    "land.Forest":      { ja:"森",   en:"Forest" },

    "unit.cards":       { ja:"{n}枚",  en:"{n}" },
    "unit.total":       { ja:"計 {n}枚", en:"{n} total" },

    "deck.title":       { ja:"デッキ",   en:"Deck" },
    "deck.empty":       { ja:"プールのカードを押すと加わります", en:"Click a card in the pool to add it" },
    "deck.lands":       { ja:"基本土地", en:"Basic lands" },
    "deck.plus":        { ja:"{c}を1枚増やす", en:"Add one {c}" },
    "deck.minus":       { ja:"{c}を1枚減らす", en:"Remove one {c}" },
    "deck.exportPh":    { ja:"デッキを組むとここにアリーナ用テキストが出ます", en:"Build a deck and the Arena import text appears here" },
    "deck.exportNote":  { ja:"インポート用のカード名は、表示設定にかかわらず英語名で出力します。",
                          en:"Card names in the import text are always in English." },
    "deck.copy":        { ja:"アリーナ用テキストをコピー", en:"Copy Arena import text" },
    "deck.copied":      { ja:"コピーしました", en:"Copied" },
    "deck.copyManual":  { ja:"テキストを選択しました。Ctrl+C でコピーしてください", en:"Text selected — press Ctrl+C to copy" },
    "deck.wildcards":   { ja:"作成に必要なワイルドカード：", en:"Wildcards needed:" },
    "rarity.common":    { ja:"コモン",     en:"Common" },
    "rarity.uncommon":  { ja:"アンコモン", en:"Uncommon" },
    "rarity.rare":      { ja:"レア",       en:"Rare" },
    "rarity.mythic":    { ja:"神話レア",   en:"Mythic" },

    "sel.set":          { ja:"セットを選ぶ",     en:"Choose a set" },
    "sel.sort":         { ja:"プールの並び順",   en:"Pool sort order" },
    "sel.event":        { ja:"イベント種別",     en:"Event type" },
    "tip.gih":          { ja:"GIH勝率 {p}%（{n}試合）", en:"GIH win rate {p}% ({n} games)" },
    "tip.curve":        { ja:"{c}マナ：{n}枚",   en:"{c} mana: {n} cards" },
    "err.sets":         { ja:"セット一覧を取得できませんでした。再読み込みしてください。（{e}）",
                          en:"Could not load the set list. Please reload. ({e})" },
    "err.cards":        { ja:"このセットのカードが見つかりませんでした。別のセットを選んでください。",
                          en:"No cards found for this set. Please choose another set." },
    "err.commons":      { ja:"コモンが取得できませんでした。別のセットを選んでください。",
                          en:"No commons were returned. Please choose another set." },
    "err.booster":      { ja:"このセットにはブースター用のカードが見つかりませんでした",
                          en:"No booster cards were found for this set" },
    "err.scryfall":     { ja:"Scryfall への接続に失敗しました（HTTP {s}）", en:"Could not reach Scryfall (HTTP {s})" },

    /* ---- シールド構築 ---- */
    "page.index.title": { ja:"シールド・ワークベンチ｜MTGアリーナのシールド戦を練習できる無料ツール",
                          en:"Sealed Workbench — Free MTG Arena sealed practice tool" },
    "desc.index":       { ja:"MTGアリーナのリミテッド（シールド戦）を無料で練習。6パックを開封して40枚デッキを組み、そのままアリーナにインポートできるテキストを書き出します。17Landsの実戦データによるカード勝率つき。日本語対応。",
                          en:"Free sealed practice for MTG Arena Limited. Open six packs, build a 40-card deck, and export text you can import straight into Arena. Includes real card win rates from 17Lands data." },
    "index.h1":         { ja:"シールド・ワークベンチ", en:"Sealed Workbench" },
    "index.lead":       { ja:"MTGアリーナのシールド戦を練習するツールです。6パック分のカードプールを生成して40枚デッキを組み、アリーナにそのまま貼り付けられるテキストを書き出します。",
                          en:"Practice MTG Arena sealed. Open six packs, build a 40-card deck, and export text you can paste straight into Arena." },
    "index.open":       { ja:"6パック開封",       en:"Open 6 packs" },
    "index.clear":      { ja:"デッキを空にする",   en:"Clear deck" },
    "index.sortCmc":    { ja:"マナ総量順",         en:"By mana value" },
    "index.sortWr":     { ja:"勝率順",             en:"By win rate" },
    "index.ready":      { ja:"セットを選んで「6パック開封」を押してください。",
                          en:"Choose a set and press “Open 6 packs”." },
    "index.loading":    { ja:"カードデータを取得しています…", en:"Loading card data…" },
    "index.loadingJa":  { ja:"日本語版のカードを取得しています…", en:"Loading localized cards…" },
    "index.loadingWr":  { ja:"勝率データを読み込んでいます…", en:"Loading win-rate data…" },
    "index.made":       { ja:"プール {n}枚を生成しました（{set} の対象カード {k}種{ja}{wr}）。カードを押すとデッキに入ります。",
                          en:"Generated a pool of {n} cards ({set}, {k} distinct{ja}{wr}). Click a card to add it to your deck." },
    "index.jaCount":    { ja:"／日本語版 {n}件", en:"" },
    "index.jaNone":     { ja:"／日本語版なし",   en:"" },
    "index.wrFrom":     { ja:"／勝率 {src}",     en:" / win rates from {src}" },
    "index.wrNone":     { ja:"／勝率データなし", en:" / no win-rate data" },

    /* ---- ドラフト ---- */
    "page.draft.title": { ja:"ドラフト・ワークベンチ｜MTGアリーナの8人卓ドラフトを1人で練習",
                          en:"Draft Workbench — Practice 8-player MTG Arena drafts solo" },
    "desc.draft":       { ja:"MTGアリーナのドラフトを1人で練習できる無料ツール。8人卓を再現し、他の7人は17Landsの勝率データをもとにピックします。3パック42手を終えたらデッキを組み、アリーナにインポートできます。",
                          en:"Free solo draft practice for MTG Arena. Simulates an eight-seat pod where the other drafters pick using 17Lands win-rate data. Finish 42 picks, build your deck, and import it into Arena." },
    "draft.h1":         { ja:"ドラフト・ワークベンチ", en:"Draft Workbench" },
    "draft.lead":       { ja:"8人卓のドラフトを1人で練習できます。他の7人は17Landsの勝率データをもとにピックします。",
                          en:"Practice an eight-seat draft on your own. The other seven drafters pick using 17Lands win-rate data." },
    "draft.start":      { ja:"ドラフト開始", en:"Start draft" },
    "draft.ready":      { ja:"セットを選んで「ドラフト開始」を押してください。",
                          en:"Choose a set and press “Start draft”." },
    "draft.howto":      { ja:"<b>進め方</b>：14枚のパックから1枚選ぶと、残りは隣に流れます。同時に他の7人もピックします。3パック（42手）を終えると構築画面に切り替わります。　<b>他プレイヤー</b>：カードの勝率を基本にしつつ、ピックが進むほど自分の色を優先するようにしてあります。",
                          en:"<b>How it works</b>: pick one card from a 14-card pack and the rest passes on. The other seven seats pick at the same time. After three packs (42 picks) you move to deck building.　<b>Other drafters</b>: they weigh card win rates first, then increasingly favour their own colors as the draft goes on." },
    "draft.phase":      { ja:"パック{p} ／ ピック{i}", en:"Pack {p} · Pick {i}" },
    "draft.phaseSub":   { ja:"残り{n}枚　（全{t}手中 {d}手目）", en:"{n} left · pick {d} of {t}" },
    "draft.picked":     { ja:"ピック済み", en:"Picked" },
    "draft.pickedEmpty":{ ja:"まだ何も取っていません", en:"Nothing picked yet" },
    "draft.colors":     { ja:"色の内訳", en:"Color spread" },
    "draft.started":    { ja:"{set} のドラフトを開始しました{wr}。カードを押して1枚選んでください。",
                          en:"Started a {set} draft{wr}. Click a card to pick it." },
    "draft.wrFrom":     { ja:"（勝率 {src} ／ {n}種）", en:" (win rates from {src}, {n} cards)" },
    "draft.wrNone":     { ja:"（勝率データなし・レアリティで代用）", en:" (no win-rate data — using rarity instead)" },
    "draft.done":       { ja:"ドラフト終了。{n}枚のプールから40枚のデッキを組んでください。",
                          en:"Draft complete. Build a 40-card deck from your {n}-card pool." },

    /* ---- 勝率一覧 ---- */
    "page.ratings.title":{ ja:"カード勝率一覧｜MTGアリーナのリミテッド実戦データ",
                          en:"Card win rates — MTG Arena Limited game data" },
    "desc.ratings":     { ja:"MTGアリーナのリミテッドにおけるカードごとの実戦勝率を、色別・数値順に並べ替えて確認できます。17Landsの公開データを独自に集計。日本語カード名・カード画像に対応。",
                          en:"Card-by-card win rates for MTG Arena Limited, sortable by color and by any metric. Aggregated from the 17Lands public datasets, with card images and localized names." },
    "ratings.h1":       { ja:"カード勝率一覧", en:"Card win rates" },
    "ratings.lead":     { ja:"MTGアリーナのリミテッドにおけるカードごとの実戦勝率です。17Landsの公開データを集計したもので、主観的な点数ではありません。色別・数値順に並べ替えられます。",
                          en:"Measured win rates for MTG Arena Limited, aggregated from the 17Lands public datasets — not subjective grades. Sort by color or by any metric." },
    "ratings.load":     { ja:"読み込む", en:"Load" },
    "ratings.ready":    { ja:"セットとイベント種別を選んで「読み込む」を押してください。",
                          en:"Choose a set and event type, then press “Load”." },
    "ratings.loading":  { ja:"データを読み込んでいます…", en:"Loading data…" },
    "ratings.loadingJa":{ ja:"カード情報を取得しています…", en:"Loading card details…" },
    "ratings.none":     { ja:"このセットとイベント種別の集計データはまだありません。用意のある組み合わせをお試しください。",
                          en:"No aggregated data yet for this set and event type. Try another combination." },
    "ratings.fail":     { ja:"読み込みに失敗しました。しばらく待って再度お試しください。",
                          en:"Loading failed. Please wait a moment and try again." },
    "ratings.summary":  { ja:"{set} ／ {ev} ／ {n}種 ／ 総試合数 {g}{wr}（集計 {d}）",
                          en:"{set} · {ev} · {n} cards · {g} games{wr} (built {d})" },
    "ratings.overall":  { ja:"／全体勝率 {p}%", en:" · overall win rate {p}%" },
    "ratings.note":     { ja:"<b>GIH勝率</b>：そのカードが手札か戦場にあった試合の勝率。カードの強さを見る基本の指標です。　<b>GP勝率</b>：そのカードをデッキに入れた試合の勝率。　<b>IWD</b>：引いた試合と引かなかった試合の勝率差（GIH勝率 − GNS勝率）。　<b>GNS勝率</b>：デッキには入れたが引かなかった試合の勝率。　<b>採用数</b>：デッキに入れられた試合数。　<b>試合数</b>：GIH勝率の母数。少ないカードは数値が揺れやすいので併せて見てください。",
                          en:"<b>GIH WR</b>: win rate in games where the card was in hand or on the battlefield — the main measure of card strength.　<b>GP WR</b>: win rate in games where the card was in the deck.　<b>IWD</b>: the gap between drawing it and not (GIH WR − GNS WR).　<b>GNS WR</b>: win rate in games where it sat in the deck undrawn.　<b>Played</b>: games it was in a deck.　<b>Games</b>: sample size behind GIH WR — small samples move around, so read them together." },
    "ratings.col.name": { ja:"カード名", en:"Card" },
    "ratings.col.rar":  { ja:"レア",     en:"Rarity" },
    "ratings.col.gih":  { ja:"GIH勝率",  en:"GIH WR" },
    "ratings.col.gp":   { ja:"GP勝率",   en:"GP WR" },
    "ratings.col.iwd":  { ja:"IWD",      en:"IWD" },
    "ratings.col.gns":  { ja:"GNS勝率",  en:"GNS WR" },
    "ratings.col.play": { ja:"採用数",   en:"Played" },
    "ratings.col.games":{ ja:"試合数",   en:"Games" },
    "ratings.f.color":  { ja:"色",         en:"Color" },
    "ratings.f.rarity": { ja:"レアリティ", en:"Rarity" },
    "ratings.f.games":  { ja:"試合数",     en:"Games" },
    "ratings.f.all":    { ja:"すべて",     en:"All" },
    "ratings.f.500":    { ja:"500以上",    en:"500+" },
    "ratings.f.2000":   { ja:"2000以上",   en:"2000+" },

    "ev.PremierDraft":  { ja:"プレミアドラフト",             en:"Premier Draft" },
    "ev.TradDraft":     { ja:"トラディショナルドラフト",     en:"Traditional Draft" },
    "ev.QuickDraft":    { ja:"クイックドラフト",             en:"Quick Draft" },
    "ev.Sealed":        { ja:"シールド",                     en:"Sealed" },
    "ev.TradSealed":    { ja:"トラディショナルシールド",     en:"Traditional Sealed" },

    /* ---- フッター ---- */
    "foot.scryfall":    { ja:"カードデータ・カード画像は <a href=\"https://scryfall.com\" target=\"_blank\" rel=\"noopener\">Scryfall</a> より取得しています。画像は加工せず、そのままの形で表示しています。",
                          en:"Card data and images come from <a href=\"https://scryfall.com\" target=\"_blank\" rel=\"noopener\">Scryfall</a> and are shown unmodified." },
    "foot.17lands":     { ja:"カード勝率は <a href=\"https://www.17lands.com/public_datasets\" target=\"_blank\" rel=\"noopener\">17Lands Public Data</a>（<a href=\"https://creativecommons.org/licenses/by/4.0/\" target=\"_blank\" rel=\"noopener\">CC BY 4.0</a>）を集計したものです。",
                          en:"Win rates are aggregated from <a href=\"https://www.17lands.com/public_datasets\" target=\"_blank\" rel=\"noopener\">17Lands Public Data</a> (<a href=\"https://creativecommons.org/licenses/by/4.0/\" target=\"_blank\" rel=\"noopener\">CC BY 4.0</a>)." },
    "foot.wotc":        { ja:"本サイトは、ファンコンテンツ・ポリシーに基づく非公式のファンコンテンツです。ウィザーズ社の認可・許可を受けていません。題材の一部にウィザーズ・オブ・ザ・コースト社の財産を含みます。©Wizards of the Coast LLC.",
                          en:"Unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC." }
  };

  /* セット名の日本語表記。Scryfall は英語名しか持たないためここで持つ。
     未登録のセットは英語名のまま表示する。 */
  const SET_JA = {
    msh:"マジック：ザ・ギャザリング｜マーベル スーパー・ヒーローズ",
    spm:"マジック：ザ・ギャザリング｜マーベル スパイダーマン",
    om1:"領界路の彼方", eoe:"エッジ・オブ・エタニティーズ", fin:"ファイナルファンタジー",
    tdm:"タルキール：龍嵐録", dft:"霊気走破", fdn:"基本セット：ファウンデーションズ",
    dsk:"ダスクモーン：戦慄の館", blb:"ブルームバロウ", mh3:"モダンホライゾン3",
    otj:"サンダー・ジャンクションの無法者", mkm:"カルロフ邸殺人事件",
    lci:"イクサラン：失われし洞窟", woe:"エルドレインの森", ltr:"指輪物語：中つ国の伝承",
    mom:"機械兵団の進軍", one:"ファイレクシア：完全なる統一", bro:"兄弟戦争",
    dmu:"団結のドミナリア", snc:"ニューカペナの街角", neo:"神河：輝ける世界",
    vow:"イニストラード：真紅の契り", mid:"イニストラード：真夜中の狩り",
    afr:"フォーゴトン・レルム探訪", stx:"ストリクスヘイヴン：魔法学院",
    khm:"カルドハイム", znr:"ゼンディカーの夜明け",
    hob:"ホビット", sos:"ストリクスヘイヴンの秘密", tmt:"ミュータント タートルズ",
    ecl:"ローウィンの昏明", tla:"アバター 伝説の少年アン"
  };

  const KEY = "sw.lang";
  const listeners = [];

  function detect(){
    try{
      const saved = localStorage.getItem(KEY);
      if(saved === "ja" || saved === "en") return saved;
    }catch(e){ /* 保存できない環境でも動かす */ }
    const nav = (navigator.language || "en").toLowerCase();
    return nav.startsWith("ja") ? "ja" : "en";
  }

  let lang = detect();

  function t(key, vars){
    const e = STRINGS[key];
    let s = e ? (e[lang] ?? e.en ?? key) : key;
    if(vars) for(const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  function setName(code, englishName){
    if(lang !== "ja") return englishName;
    return SET_JA[String(code).toLowerCase()] || englishName;
  }

  function apply(root){
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    scope.querySelectorAll("[data-i18n-html]").forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach(el => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    scope.querySelectorAll("[data-i18n-label]").forEach(el => {
      el.setAttribute("aria-label", t(el.dataset.i18nLabel));
    });
    const tk = document.documentElement.dataset.title;
    if(tk){
      document.title = t(tk);
      setMeta("property", "og:title", t(tk));
    }
    const dk = document.documentElement.dataset.desc;
    if(dk){
      setMeta("name", "description", t(dk));
      setMeta("property", "og:description", t(dk));
    }
    setMeta("property", "og:locale", lang === "ja" ? "ja_JP" : "en_US");
    document.documentElement.lang = lang;
  }

  function setMeta(attr, key, value){
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if(!el){
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", value);
  }

  function set(next){
    if(next !== "ja" && next !== "en") return;
    lang = next;
    try{ localStorage.setItem(KEY, lang); }catch(e){ /* 保存できなくても続行 */ }
    apply();
    listeners.forEach(fn => fn(lang));
  }

  window.I18N = {
    get lang(){ return lang; },
    isJa(){ return lang === "ja"; },
    t, set, apply, setName,
    onChange(fn){ listeners.push(fn); }
  };
  window.t = t;

  document.addEventListener("DOMContentLoaded", () => apply());
})();
