/*
 * 共通の言語切り替え。全ページがこれを読み込む。
 *
 * 使い方
 *   HTML: <span data-i18n="nav.sealed"></span>
 *         <input data-i18n-ph="deck.exportPh">      （placeholder）
 *         <span data-i18n-title="wr.gih.tip">        （title属性＝カーソルを乗せたときの説明）
 *         <html data-title="page.index.title">       （ページタイトル）
 *   JS  : t("status.ready")  /  t("pool.made", {n: 84})
 *
 * 文言を足すときは STRINGS に ja と en を両方書く。
 * 選んだ言語は localStorage に残る。
 */
(function(){
  const STRINGS = {
    /* ---- 共通 ---- */
    "site.name":        { ja:"MTGアリーナ リミテッド・ワークベンチ", en:"MTG Arena Limited Workbench" },
    "nav.sealed":       { ja:"シールド構築",       en:"Sealed" },
    "nav.draft":        { ja:"ドラフト構築",       en:"Draft" },
    "nav.ratings":      { ja:"カード勝率一覧",     en:"Card win rates" },
    "lang.label":       { ja:"言語",               en:"Language" },
    "foot.short":       { ja:"データの出典・権利表示、および当サイトの内容を引用する際のお願いは<a href=\"./privacy.html\">プライバシーポリシー</a>にまとめています。",
                          en:"Data sources, legal notices and how to credit this site are all on the <a href=\"./privacy.html\">privacy page</a>." },
    "err.noSet":        { ja:"セットを選んでから始めてください。", en:"Choose a set first." },
    "wr.gih.tip":       { ja:"GIH勝率（Games In Hand）：そのカードが手札か戦場にあった試合の勝率です。カードの強さを見る基本の指標で、17Landsの公開データを集計しています。",
                          en:"GIH win rate (Games In Hand): the win rate of games where this card was in hand or on the battlefield — the basic measure of card strength, aggregated from 17Lands public data." },


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
    "deck.target":      { ja:"追加先", en:"Add to" },
    "deck.targetMain":  { ja:"メイン", en:"Main" },
    "deck.targetSide":  { ja:"サイド", en:"Side" },
    "deck.side":        { ja:"サイドボード", en:"Sideboard" },
    "deck.sideEmpty":   { ja:"追加先を「サイド」にしてプールのカードを押すと加わります", en:"Set \"Add to\" to Side, then click a card in the pool" },
    "deck.moveToSide":  { ja:"サイドボードへ移す", en:"Move to sideboard" },
    "deck.moveToMain":  { ja:"メインデッキへ戻す", en:"Move to main deck" },
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
    "sel.event":        { ja:"形式",             en:"Format" },
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
    "page.index.title": { ja:"シールド構築｜MTGアリーナのシールド戦を練習できる無料ツール",
                          en:"Sealed builder — Free MTG Arena sealed practice" },
    "desc.index":       { ja:"マジック：ザ・ギャザリング アリーナのリミテッド（シールド戦）を無料で練習。6パックを開封して40枚デッキを組み、そのままアリーナにインポートできるテキストを書き出します。17Landsの実戦データによるカード勝率つき。日本語対応。",
                          en:"Free sealed practice for Magic: The Gathering Arena Limited. Open six packs, build a 40-card deck, and export text you can import straight into Arena. Includes real card win rates from 17Lands data." },
    "index.h1":         { ja:"シールド構築", en:"Sealed builder" },
    "index.lead":       { ja:"6パック分のカードプールを生成して40枚デッキを組み、マジック：ザ・ギャザリング アリーナにそのまま貼り付けられるテキストを書き出します。",
                          en:"Open six packs, build a 40-card deck, and export text you can paste straight into Magic: The Gathering Arena." },
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
    "page.draft.title": { ja:"ドラフト構築｜MTGアリーナの8人卓ドラフトを1人で練習",
                          en:"Draft — Practice 8-player MTG Arena drafts solo" },
    "desc.draft":       { ja:"マジック：ザ・ギャザリング アリーナのドラフトを1人で練習できる無料ツール。8人卓を再現し、他の7人は17Landsの勝率データをもとにピックします。3パック42手を終えたらデッキを組み、アリーナにインポートできます。",
                          en:"Free solo draft practice for Magic: The Gathering Arena. Simulates an eight-seat pod where the other drafters pick using 17Lands win-rate data. Finish 42 picks, build your deck, and import it into Arena." },
    "draft.h1":         { ja:"ドラフト構築", en:"Draft builder" },
    "draft.lead":       { ja:"8人卓のドラフトを1人で練習し、組んだデッキをマジック：ザ・ギャザリング アリーナに貼り付けられるテキストで書き出します。",
                          en:"Practise an eight-player draft on your own, then export the deck as text you can paste into Magic: The Gathering Arena." },
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
    "desc.ratings":     { ja:"マジック：ザ・ギャザリング アリーナのリミテッドにおけるカードごとの実戦勝率を、色別・数値順に並べ替えて確認できます。17Landsの公開データを独自に集計。日本語カード名・カード画像に対応。",
                          en:"Card-by-card win rates for Magic: The Gathering Arena Limited, sortable by color and by any metric. Aggregated from the 17Lands public datasets, with card images and localized names." },
    "ratings.h1":       { ja:"カード勝率一覧", en:"Card win rates" },
    "ratings.lead":     { ja:"マジック：ザ・ギャザリング アリーナのリミテッドにおける、カードごとの実戦勝率です。",
                          en:"Measured win rates for each card in Magic: The Gathering Arena Limited." },
    "ratings.load":     { ja:"読み込む", en:"Load" },
    "ratings.ready":    { ja:"セットと形式を選んでください。",
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
    "ev.PickTwoDraft":  { ja:"2枚ピックドラフト",           en:"Pick Two Draft" },

    /* ---- フッター ---- */
    "nav.guide":        { ja:"使い方",  en:"Guide" },

    "page.guide.title": { ja:"使い方｜MTGアリーナのリミテッドを無料で練習する",
                          en:"Guide — Free MTG Arena Limited practice" },
    "desc.guide":       { ja:"リミテッド・ワークベンチの使い方と、向いている人。マジック：ザ・ギャザリング アリーナでワイルドカードが余っている方、カードが揃っている方が、リミテッドのデッキを組んでフレンド戦で遊ぶための手引きです。カード勝率の読み方も解説します。",
                          en:"How to use Limited Workbench and who it is for. A guide for Magic: The Gathering Arena players with spare wildcards or a deep collection who want to build Limited decks and play them in Direct Challenge. Includes how to read card win rates." },
    "guide.h1":         { ja:"使い方", en:"Guide" },
    "guide.lead":       { ja:"このサイトで何ができるのか、実際にアリーナで遊ぶまでの流れをまとめます。",
                          en:"What this site does, and how to get a deck into Arena." },

    "guide.s0.h":       { ja:"このサイトの目的", en:"Why this site exists" },
    "guide.s0.body":    { ja:"<p>マジック：ザ・ギャザリング アリーナのリミテッドを、もっと楽しんでもらうためのサイトです。目指していることは2つあります。</p><p><b>アリーナに接続しなくても、練習や友人との対戦ができるようにすること。</b>有料イベントに入らなくても、シールドとドラフトを何度でも試せます。組んだデッキはアリーナにそのまま取り込めるので、そのまま友人との対戦にも使えます。</p><p><b>客観的なデータで強いデッキを組めるようにすること。</b>カードの強弱は感覚で語られがちですが、実際には何万試合もの結果が公開されています。それを日本語で、並べ替えて読める形にしました。感覚に頼らず、数字を見てデッキを組めます。</p>",
                          en:"<p>This site exists to make Magic: The Gathering Arena Limited more enjoyable. Two things guide it.</p><p><b>Practise and play with friends without connecting to Arena.</b> Try Sealed and Draft as often as you like without paying for an event, then take the finished deck into Arena and play it against a friend.</p><p><b>Build strong decks from real data.</b> Card strength is usually argued from feel, but tens of thousands of recorded games are published every set. This site puts those numbers in front of you, sortable and readable, so you can build from evidence rather than instinct.</p>" },

    "guide.s1.h":       { ja:"このサイトでできること", en:"What this site does" },
    "guide.s1.body":    { ja:"<p>できることは6つです。練習するための2つ、調べるための2つ、対戦会を運営するための1つ、そして本番のドラフトを助ける1つです。</p><p><b>シールド構築</b>と<b>ドラフト構築</b>は、パックの開封から40枚デッキを組むところまでをブラウザ上で行います。組んだデッキは、アリーナにそのまま取り込めるテキストとして書き出せます。</p><p><b>カード勝率一覧</b>では、カード1枚ごとの実戦勝率を並べ替えて確認できます。<b>環境レポート</b>は、そのセットの環境全体を文章と図でまとめたものです。勝率はいずれも、17Landsの公開データを集計した数字です。</p><p><b>スイスドロー対戦表</b>は、組んだデッキで友人と対戦会を開くときの組み合わせと順位表です。</p><p><b>ドラフト補助</b>は、アリーナで実際にドラフトしている最中に、いま見ているパックのカードを勝率・自分の色・デッキの枠・環境の速さから並べ替え、おすすめの1枚（評価が近ければ2枚）をカード画像つきで示します。ピックが終わると、そのプールからのデッキ案も出ます。PCのChromeまたはEdge専用で、スマートフォンでは使えません。</p><p>6つとも無料で、アカウント登録はいりません。カード名とカード画像は日本語に対応しています。</p>",
                          en:"<p>There are six tools: two for practising, two for looking things up, one for running a tournament, and one that helps during a real draft.</p><p><b>Sealed builder</b> and <b>Draft builder</b> take you from opening packs to a finished 40-card deck in the browser. The deck exports as text you can import straight into Arena.</p><p><b>Card win rates</b> lets you sort every card in a set by how it actually performs. <b>Set reports</b> summarise the whole format in words and charts. Both draw on aggregated 17Lands public data.</p><p><b>Swiss pairings</b> handles the pairings and standings when you play the decks against friends.</p><p><b>Draft assistant</b> ranks the pack in front of you during a live Arena draft by win rate, your colours, deck composition and format speed, and shows the recommended pick (two when they are close) with card images. When the draft ends it also suggests a deck from your pool. PC Chrome/Edge only; not available on phones.</p><p>All six are free and need no account. Japanese card names and images are supported.</p>" },

    "guide.s2.h":       { ja:"こんな人に向いています", en:"Who this is for" },
    "guide.s2.body":    { ja:"<p><b>1. ワイルドカードが余っている人</b><br>リミテッドを中心に遊んでいると、ワイルドカードは使い道がないまま貯まっていきます。リミテッド用の40枚デッキを作って、フレンド戦で遊ぶという使い道があります。</p><p><b>2. カードがほとんど揃っている人</b><br>すでに該当セットのカードを持っているなら、ワイルドカードを使わずに組めます。開封の運に左右されない、公平なリミテッド対戦ができます。</p><p><b>3. 本番前に練習したい人</b><br>有料イベントに入る前に、そのセットのシールドやドラフトの感触を掴めます。何度でも無料です。</p><p><b>4. 環境を知りたい人</b><br>構築ツールを使わず、データだけを見に来るのも歓迎です。どのカードが強いのか、どの色の組み合わせが勝っているのか、環境は速いのか遅いのか。セット全体の傾向まで日本語で読めるサイトは多くありません。</p><p><b>5. 本番のドラフトで迷いたくない人</b><br>ピックの場面で「勝率は高いが色が違う」「色は合うが弱い」と迷うことは多いものです。ドラフト補助は、その判断の材料を理由つきで並べます。最後に決めるのは自分ですが、数字を見ながら選べます。</p>",
                          en:"<p><b>1. You have spare wildcards</b><br>If you mostly play Limited, wildcards pile up with nowhere to go. Building a 40-card Limited deck and playing it against a friend is one use for them.</p><p><b>2. You already own most of a set</b><br>If you have the cards, you can build without spending wildcards — a fair Limited game that does not hinge on who opened better packs.</p><p><b>3. You want to practise first</b><br>Get a feel for a set's Sealed or Draft before paying to enter an event. As many times as you like, for free.</p><p><b>4. You want to understand the format</b><br>You are welcome to skip the builders and come only for the data: which cards are strong, which colour pairs are winning, whether the format is fast or slow. Few sites cover a whole format this way in Japanese.</p><p><b>5. You want fewer agonising picks</b><br>\"Higher win rate but off-colour\" versus \"on-colour but weaker\" comes up constantly. The draft assistant lays out the numbers and the reasoning so you can decide with the data in front of you.</p>" },

    "guide.s3.h":       { ja:"アリーナで遊ぶまでの流れ", en:"Getting a deck into Arena" },
    "guide.s3.body":    { ja:"<ol><li>このサイトでプールを生成し、40枚のデッキを組む</li><li>「アリーナ用テキストをコピー」を押す</li><li>マジック：ザ・ギャザリング アリーナのデッキ画面で「インポート」を選ぶ</li><li>対戦相手とダイレクトチャレンジ（フレンド対戦）で対戦する</li></ol><p><b>大切な注意点</b>：40枚のデッキは、イベント外では<b>ダイレクトチャレンジでしか使えません</b>。通常のマッチングでは60枚以上が必要です。友人と遊ぶ前提のツールだとお考えください。</p><p><b>サイドボードについて</b>：構築画面で追加先を「サイド」にすると、サイドボードにも入れられます。アリーナに取り込むと、そのままサイドボードとして登録されます。フレンド対戦を2本先取で行うときにお使いください。上限は15枚です。</p><p><b>ワイルドカードについて</b>：持っていないカードは作成が必要です。構築画面に「作成に必要なワイルドカード」を表示しているので、組む前に確認できます。集め方は次の節にまとめました。</p>",
                          en:"<ol><li>Generate a pool here and build your 40 cards</li><li>Press “Copy Arena import text”</li><li>In Arena, open the deck screen and choose Import</li><li>Play your opponent via Direct Challenge</li></ol><p><b>Important</b>: outside of events, a 40-card deck can <b>only</b> be used in Direct Challenge. Normal matchmaking requires 60 or more cards. Treat this as a tool for playing with friends.</p><p><b>About sideboards</b>: set \"Add to\" to Side in the builder to put cards in a sideboard. Arena imports it as the deck's sideboard, which is handy for best-of-three matches with friends. The limit is 15 cards.</p><p><b>About wildcards</b>: you have to craft any card you do not own. The builder shows how many wildcards of each rarity a deck needs, so you can check before committing. The next section covers how to earn them.</p>" },

    "guide.s7.h":       { ja:"ワイルドカードの集め方", en:"How to get wildcards" },
    "guide.s7.body":    { ja:"<p>このサイトで組んだデッキをアリーナで使うには、持っていないカードをワイルドカードで作る必要があります。集める方法は主に4つです。</p>"
                              + "<p><b>1. パックから直接出る</b><br>パックの中のカードが、同じレアリティのワイルドカードに置き換わることがあります。レア・神話レアが出る確率は低めで、目安は24パックに1枚ほどです。</p>"
                              + "<p><b>2. ワイルドカード トラック</b><br>パック画面の右上にある2つの輪です。パックを6個開けるごとに、小さい輪からアンコモン1枚、大きい輪からレア1枚が出ます。大きい輪は5回に1回、レアではなく神話レアになります。</p>"
                              + "<p><b>3. 保管庫（ヴォールト）</b><br>すでに4枚持っているコモン・アンコモンを引くと、その分が保管庫に貯まります。100%になったところで開けると、アンコモン3枚・レア2枚・神話レア1枚がまとめて手に入ります。</p>"
                              + "<p><b>4. ゴールデンパック</b><br>ストアでパックを10個<b>購入</b>するごとに1つもらえます。中身はレアと神話レアだけの6枚で、開けるとトラックも進みます。報酬やコードで受け取ったパックは、この数に入りません。</p>"
                              + "<p>なお、ドラフトやシールドで使うパックは、ワイルドカードが出ることもトラックが進むこともありません。ワイルドカード目当てなら、ストアのパックを開ける必要があります。</p>"
                              + "<p>40枚デッキで作ることになるのは、土地を除いて20枚強です。その多くはコモンとアンコモンなので、上の1〜3で貯まる分でおおむね足ります。レアと神話レアをどこまで作るかが、実際の負担を決めます。</p>"
                              + "<p>アリーナの仕組みは変わることがあります。最新の内容は公式のヘルプでご確認ください。",
                          en:"<p>To play a deck from this site in Arena, you need to craft the cards you do not own. There are four main ways to get wildcards.</p>"
                              + "<p><b>1. Straight from packs</b><br>Any card in a pack can be replaced by a wildcard of the same rarity. Rares and mythics are the scarce ones — roughly one every 24 packs.</p>"
                              + "<p><b>2. The wildcard tracks</b><br>Two wheels in the top right of the Packs screen. Every six packs you open, the small wheel gives an uncommon and the large wheel a rare. Every fifth turn of the large wheel gives a mythic instead.</p>"
                              + "<p><b>3. The Vault</b><br>Extra copies of commons and uncommons you already own four of fill the Vault. Opening it at 100% gives three uncommon, two rare and one mythic wildcard.</p>"
                              + "<p><b>4. Golden Packs</b><br>You earn one for every ten packs you <b>buy</b> in the store. It holds six cards, all rare or mythic, and opening it advances the tracks. Packs from rewards or codes do not count towards it.</p>"
                              + "<p>Note that packs used in Draft and Sealed events never contain wildcards and never advance the tracks. If wildcards are the goal, you need store packs.</p>"
                              + "<p>A 40-card deck needs a little over 20 non-land cards, most of them commons and uncommons, which the first three sources cover easily. How many rares and mythics you choose to craft is what really decides the cost.</p>"
                              + "<p>Arena's systems change from time to time; check the official help for the current details."
                            },

    "guide.s4.h":       { ja:"6つのツール", en:"The six tools" },
    "guide.s4.body":    { ja:"<p><b>シールド構築</b>：6パック分のプールを生成して40枚デッキを組みます。カードを押すとデッキに入り、もう一度押すと戻ります。基本土地は＋−で増減します。</p><p><b>ドラフト構築</b>：8人卓を再現します。14枚のパックから1枚選ぶと残りが隣に流れ、同時に他の7人もピックします。他の7人はカードの勝率を基本に、ピックが進むほど自分の色を優先するように動きます。3パック42手を終えると構築画面に移ります。</p><p>パックの中身は、現在のプレイ・ブースターに合わせています。コモン7枚・アンコモン3枚・レアまたは神話レア1枚・土地1枚、そしてどのレアリティも出る特殊枠が2枚の計14枚です。特殊枠があるため、1パックに2枚以上のレアが入ることがあります。</p><p><b>カード勝率一覧</b>：セットを選ぶと自動で読み込まれ、シールドとドラフトはタブで切り替えられます。色・レアリティ・試合数で絞り込み、どの列でも並べ替えられます。</p><p><b>環境レポート</b>：そのセットがどんな環境かを文章と図でまとめます。環境の速さ、色ごとの勝率、強いアーキタイプ（色の組み合わせ）、マナカーブ、レアリティ別の上位カードを一度に見渡せます。こちらもシールドとドラフトをタブで切り替えられます。</p><p><b>スイスドロー対戦表</b>：友人との対戦会の運営用です。参加者を登録して大会を始めると、各ラウンドの組み合わせと順位表が出ます。参加者の名簿はブラウザに残るので、次回はチェックを入れるだけで呼び出せます。遅れて来る人が分かっているときは、初戦のバイをその人に指定できます。</p><p><b>ドラフト補助</b>：アリーナで実際にドラフトしているときに使います。準備は初回だけで、アリーナの設定で「詳細ログ（プラグインのサポート）」をオンにし、ページの案内に従ってログファイルを一度選びます。以降はパックを開くたびに、カードが次の考え方で並び替わります。</p><p>基本は<b>GIH勝率</b>です。そこに、ピックが進むほど強まる<b>自分の色</b>との合い具合（上位2色を自分の色とみなし、ハイブリッド・マナはどちらか1色が合えば合う扱い）、クリーチャー17枚・スペル6枚を目安にした<b>デッキの枠</b>、環境レポートと同じデータによる<b>環境の速さ</b>に応じたマナ域の調整を加えます。同じ伝説のカードを重ねて取らないようにも働きます。初手は勝率だけで並びます。</p><p>一番上に<b>おすすめの1枚</b>をカード画像と理由つきで示し、評価が近いときは2枚を並べて選択を委ねます。各行にカーソルを乗せると「勝率／色／枠／速さ」の内訳が見えます。「色へのこだわり」は設定で3段階から選べます。</p><p><b>常に前面の小窓</b>を開くと、アリーナの画面の横に置いて使えます。ピックが終わると<b>デッキ案</b>に切り替わり、勝率の高い順にクリーチャー17枚・スペル6枚を目安に選び、土地はマナ・シンボルの比率で配分します（ダブルシンボルのある色は多めに、色の合う特殊土地も含めます）。デッキリストはアリーナ形式でコピーできます。</p><p>プレミア・ドラフトとクイック・ドラフトの両方に対応しています。画面を読み取ったりゲームに手を加えたりはせず、ウィザーズ社が第三者ツール向けに用意しているログだけを使います。ログはブラウザの中でだけ読み、どこにも送りません。</p>",
                          en:"<p><b>Sealed builder</b>: generate a six-pack pool and build a 40-card deck. Click a card to add it, click again to take it out. Basic lands use the +/- buttons.</p><p><b>Draft builder</b>: an eight-player pod. Pick one card from a 14-card pack and the rest passes on, while the other seven seats pick too. They follow card win rates and increasingly favour their own colours as the draft goes on. After three packs and 42 picks you move to the deck builder.</p><p>Packs follow the current Play Booster: seven commons, three uncommons, one rare or mythic, one land, and two wildcard slots that can be any rarity — 14 cards. Thanks to the wildcard slots, a pack can hold more than one rare.</p><p><b>Card win rates</b>: choose a set and it loads automatically; switch between Sealed and Draft with the tabs. Filter by colour, rarity and sample size, and sort on any column.</p><p><b>Set reports</b>: a written summary of the format — how fast it is, win rates by colour, the strongest archetypes, the mana curve, and the best cards at each rarity. Sealed and Draft switch with tabs here too.</p><p><b>Swiss pairings</b>: for running a tournament with friends. Register the players and start; each round's pairings and the standings are generated for you. The roster stays in your browser, so next time you just tick who is playing. If you know someone will be late, you can give them the round-one bye.</p><p><b>Draft assistant</b>: for use during a real Arena draft. Setup happens once: turn on Detailed Logs (Plugin Support) in Arena's settings and choose the log file as the page explains. From then on, every pack is re-ranked as it appears.</p><p>The base is <b>GIH win rate</b>. On top of that come <b>colour fit</b> (your two most-picked colours count as yours; hybrid mana counts as on-colour if either colour fits), <b>deck composition</b> (aiming for 17 creatures and 6 spells), and a <b>format-speed</b> adjustment by mana value using the same data as the set report. It also avoids stacking copies of the same legend. The first pick is ranked purely by win rate.</p><p>The top of the panel shows the <b>recommended pick</b> with its card image and a reason — two cards side by side when they are close, so the final call stays with you. Hover any row for the breakdown (win rate / colour / slot / pace). Colour commitment has three settings.</p><p>An <b>always-on-top mini window</b> can sit beside Arena. When the draft ends the panel switches to a <b>deck suggestion</b>: 17 creatures and 6 spells by win rate, lands split by mana symbols (extra sources for double-pip colours, on-colour non-basic lands included), with an Arena-format deck list to copy.</p><p>Works with both Premier and Quick Draft. It never reads the screen or touches the game; it only uses the log that Wizards provides for third-party tools, and the log is read inside your browser and never uploaded.</p>" },

    "guide.s5.h":       { ja:"数値の読み方", en:"Reading the numbers" },
    "guide.s5.body":    { ja:"<p><b>GIH勝率</b>が最も重要な指標です。そのカードが手札か戦場にあった試合の勝率で、「引いたときに勝てるカードか」を表します。同じセット内で比べるのが基本で、平均より3ポイント高ければ強いカード、低ければ弱いカードと考えられます。</p><p><b>IWD</b>は、引いた試合と引かなかった試合の勝率差です。GIH勝率が高くても、そもそも強いデッキにしか入らないカードは数値が膨らみます。IWDを併せて見ると、そのカード自体の貢献度がわかります。</p><p><b>試合数</b>は、その勝率がどれだけの試合から出た数字かを表します。試合数が少ないと勝率は偶然で動くため、初期状態では500試合以上のカードだけを表示しています。絞り込みを「すべて」にすると、試合数の少ないカードも並びます。</p><p>なお17Landsのデータは、自分の成績を記録している熱心なプレイヤーが中心です。全体の平均より勝率がやや高めに出ます。絶対値ではなく、カード同士の比較にお使いください。</p>",
                          en:"<p><b>GIH win rate</b> is the key number: the win rate of games where the card was in hand or on the battlefield — in other words, whether drawing it wins games. Compare within a set; three points above average is a strong card, three below is a weak one.</p><p><b>IWD</b> is the gap between games where you drew the card and games where you did not. A card that only ever goes in strong decks can show a high GIH win rate, so IWD helps isolate the card's own contribution.</p><p><b>Games</b> shows how many games a win rate is based on. Small samples move around, so by default only cards with 500 or more games are shown. Set the filter to \"All\" to include the rest.</p><p>Note that 17Lands data comes mostly from players who track their own results, so win rates run a little above the overall average. Use the numbers to compare cards, not as absolute values.</p>" },

    "guide.s6.h":       { ja:"よくある質問", en:"Questions" },
    "guide.s6.body":    { ja:"<p><b>無料ですか</b><br>はい。アカウント登録も不要です。</p><p><b>データはいつ更新されますか</b><br>毎月1回、自動で最新の集計に入れ替わります。新しいセットも、発売から12日後以降に自動で追加されます（17Landsの規約に従っています）。</p><p><b>クイックドラフトのデータがないのはなぜですか</b><br>17Landsが公開しているデータにクイックドラフトが含まれていないためです。公開されれば自動で追加されます。</p><p><b>パックの中身は本物と同じですか</b><br>おおむね寄せています。現在のプレイ・ブースターに合わせ、コモン7枚・アンコモン3枚・レアまたは神話レア1枚・土地1枚・特殊枠2枚の14枚で構成しています。特殊枠はどのレアリティも出るため、1パックに2枚以上のレアが入ることがあります。ただしThe ListやSpecial Guests、セット固有のボーナスシートは再現していません。</p><p><b>日本語と英語を切り替えられますか</b><br>画面右上の言語選択で切り替わります。カード名や画像も連動します。</p><p><b>ドラフト補助はスマートフォンで使えますか</b><br>使えません。スマホ版アリーナは他のアプリからログを読めない作りのためです。PCのChromeまたはEdgeでお使いください。</p><p><b>ドラフト補助を使うのは規約上問題ありませんか</b><br>アリーナの「詳細ログ」は、ウィザーズ社が第三者ツール向けに公開している機能で、17Landsなどの既存ツールも同じ仕組みを使っています。当サイトは画面を読み取ったりゲームに手を加えたりはしません。</p><p><b>おすすめどおりにピックすれば勝てますか</b><br>おすすめは、実戦データから機械的に出した判断材料です。相手の動きや自分の好みまでは見ていません。迷ったときの拠りどころとして使い、最後はご自身で決めてください。</p>",
                          en:"<p><b>Is it free?</b><br>Yes, and no account is needed.</p><p><b>How often is the data updated?</b><br>Once a month, automatically. New sets are added automatically once they are twelve days old, in line with the 17Lands guidelines.</p><p><b>Why is there no Quick Draft data?</b><br>17Lands does not publish it. If that changes, it will appear automatically.</p><p><b>Are the packs identical to real ones?</b><br>Close. They follow the current Play Booster: seven commons, three uncommons, one rare or mythic, one land and two wildcard slots — 14 cards. The wildcard slots can be any rarity, so a pack can hold more than one rare. The List, Special Guests and set-specific bonus sheets are not reproduced.</p><p><b>Can I switch languages?</b><br>Yes — use the selector at the top of any page. Card names and images follow.</p><p><b>Does the draft assistant work on phones?</b><br>No. The mobile Arena app does not expose its log to other apps. Use Chrome or Edge on a PC.</p><p><b>Is using the draft assistant allowed?</b><br>Arena's Detailed Logs are a feature Wizards provides for third-party tools, and established tools such as 17Lands use the same mechanism. This site never reads the screen or modifies the game.</p><p><b>Will I win if I follow the recommendations?</b><br>They are a data-driven starting point, not a guarantee. They do not see your opponents or your preferences. Use them when unsure, and make the final call yourself.</p>" },

    "nav.swiss":        { ja:"スイスドロー",     en:"Swiss pairings" },
    "nav.assist":       { ja:"ドラフト補助",     en:"Draft assistant" },
    "nav.privacy":      { ja:"プライバシー", en:"Privacy" },

    "page.privacy.title":{ ja:"プライバシーポリシー｜リミテッド・ワークベンチ",
                          en:"Privacy Policy — Limited Workbench" },
    "desc.privacy":     { ja:"リミテッド・ワークベンチにおけるアクセス解析、広告、外部サービスの利用と、取得する情報の取り扱いについて説明します。",
                          en:"How Limited Workbench handles analytics, advertising, third-party services and the information they involve." },
    /* ===== スイスドロー対戦表 ===== */
    "page.swiss.title": { ja:"スイスドロー対戦表｜友人との対戦会の組み合わせと順位を管理",
                          en:"Swiss pairings — Run a casual tournament with friends" },
    "desc.swiss":       { ja:"友人との対戦会のためのスイスドロー対戦表。参加者はブラウザに保存され、初戦のバイも指定できます。",
                          en:"A Swiss pairing tool for casual tournaments with friends. Players are saved in your browser, and the round-one bye can be assigned by hand." },
    "swiss.h1":         { ja:"スイスドロー対戦表", en:"Swiss pairings" },
    "swiss.lead":       { ja:"友人との対戦会の組み合わせと順位を管理します。参加者はこのブラウザに保存され、次回もそのまま呼び出せます。",
                          en:"Pairings and standings for a casual tournament. Players are saved in this browser and can be recalled next time." },

    "swiss.players":    { ja:"参加者", en:"Players" },
    "swiss.playersHint":{ ja:"一度登録した名前はこのブラウザに残ります。次回は「過去の参加者から追加」で押すだけで呼び出せます。",
                          en:"Names stay in this browser. Next time, add them back with one click from the past-players list." },
    "swiss.namePh":     { ja:"名前（Enterで追加）", en:"Name (Enter to add)" },
    "swiss.add":        { ja:"追加", en:"Add" },
    "swiss.checkAll":   { ja:"名簿の全員を参加にする", en:"Add everyone on the roster" },
    "swiss.uncheckAll": { ja:"全員を外す", en:"Clear all" },
    "swiss.today":      { ja:"今回の参加者", en:"Playing today" },
    "swiss.todayEmpty": { ja:"まだ誰もいません。下の名簿から選ぶか、名前を入力してください。", en:"Nobody yet. Pick from the roster below or type a name." },
    "swiss.past":       { ja:"過去の参加者から追加", en:"Add from past players" },
    "swiss.pastEmpty":  { ja:"名簿の全員が今回の参加者に入っています。", en:"Everyone on the roster is already in." },
    "swiss.newName":    { ja:"名簿にない人を追加", en:"Add someone new" },
    "swiss.startedAt":  { ja:"{d} 開始", en:"started {d}" },
    "swiss.joinLabel":  { ja:"{n}を参加にする", en:"{n} is playing" },
    "swiss.remove":     { ja:"名簿から削除", en:"Remove from roster" },
    "swiss.removeLabel":{ ja:"{n}を名簿から削除", en:"Remove {n} from roster" },
    "swiss.rosterCount":{ ja:"{n}人", en:"{n}" },

    "swiss.import":     { ja:"名簿をファイルから読み込む", en:"Import a roster file" },
    "swiss.importHint": { ja:"1行に1人の名前を書いたテキストファイル（.txt）を読み込みます。すでに名簿にある名前は重複しません。",
                          en:"Reads a plain-text file (.txt) with one name per line. Names already on the roster are skipped." },
    "swiss.importBtn":  { ja:"ファイルを選んで読み込む", en:"Choose a file" },
    "swiss.imported":   { ja:"{n}人を名簿に追加しました。", en:"Added {n} to the roster." },
    "swiss.sample":     { ja:"サンプルをダウンロード", en:"Download a sample" },
    "swiss.sampleFile": { ja:"参加者名簿サンプル.txt", en:"roster-sample.txt" },
    "swiss.sampleBody": { ja:"田中\n鈴木\n佐藤\n高橋\n伊藤\n渡辺\n山本\n中村", en:"Alice\nBob\nCarol\nDave\nEve\nFrank\nGrace\nHeidi" },
    "swiss.export":     { ja:"いまの名簿を書き出す", en:"Export current roster" },
    "swiss.exportFile": { ja:"参加者名簿.txt", en:"roster.txt" },
    "swiss.saveImage":  { ja:"画像で保存", en:"Save as image" },
    "swiss.imageFile":  { ja:"順位表_{d}.png", en:"standings_{d}.png" },
    "swiss.roundImageFile":{ ja:"対戦表_ラウンド{n}_{d}.png", en:"pairings_round{n}_{d}.png" },
    "swiss.resultShort":{ ja:"結果", en:"Result" },
    "swiss.champion":   { ja:"優勝", en:"Champion" },
    "swiss.share":      { ja:"共有用URLをコピー", en:"Copy share link" },
    "swiss.shared":     { ja:"URLをコピーしました", en:"Link copied" },
    "swiss.shareFailed":{ ja:"このブラウザでは作れませんでした", en:"Not supported in this browser" },
    "swiss.shareHint":  { ja:"共有用URLを開いた人は、この時点の対戦表と順位表を見ることだけができます。結果の入力や組み合わせの変更はできません。更新したら、もう一度URLを作って送ってください。",
                          en:"Anyone opening the share link can only view the pairings and standings as of now. They cannot enter results or change pairings. After updating, make a new link and send it again." },
    "swiss.viewNote":   { ja:"これは共有された表示です。閲覧のみで、結果の入力や変更はできません。最新の状態は主催者の画面にあります。",
                          en:"This is a shared, view-only copy. Results and pairings can only be changed on the organiser's screen." },
    "swiss.viewStatus": { ja:"対戦表と順位表（共有時点の内容）", en:"Pairings and standings as of when the link was made" },
    "swiss.setup":      { ja:"大会の設定", en:"Tournament settings" },
    "swiss.rounds":     { ja:"ラウンド数", en:"Rounds" },
    "swiss.roundsHint": { ja:"{n}人なら{r}ラウンドが目安です", en:"{r} rounds is typical for {n} players" },
    "swiss.firstBye":   { ja:"初戦のバイ", en:"Round-one bye" },
    "swiss.byeAuto":    { ja:"自動（順位の低い人）", en:"Automatic (lowest-ranked)" },
    "swiss.firstByeHint":{ ja:"遅れて来る人が決まっているときに指定します。人数が奇数のときだけバイが出ます。",
                          en:"Use this when you know someone will arrive late. A bye only occurs with an odd number of players." },
    "swiss.byeEven":    { ja:"人数が偶数なのでバイはありません。", en:"Even number of players — no bye this round." },
    "swiss.start":      { ja:"大会を始める", en:"Start tournament" },
    "swiss.needTwo":    { ja:"参加者が2人以上必要です。", en:"You need at least two players." },

    "swiss.round":      { ja:"ラウンド {n}", en:"Round {n}" },
    "swiss.roundOf":    { ja:"全{total}ラウンド中 {n}", en:"{n} of {total}" },
    "swiss.final":      { ja:"最終結果", en:"Final standings" },
    "swiss.statusEnter":{ ja:"各卓の結果を入れてください。左のプレイヤーの勝ち数 − 右のプレイヤーの勝ち数です。", en:"Enter each table's result: games won by the left player − games won by the right player." },
    "swiss.statusReady":{ ja:"全卓の結果が入りました。次のラウンドを組めます。", en:"All results are in. You can pair the next round." },
    "swiss.statusDone": { ja:"大会は終了しました（全{n}ラウンド）。", en:"The tournament is over ({n} rounds)." },
    "swiss.table":      { ja:"卓", en:"Table" },
    "swiss.playerA":    { ja:"プレイヤー", en:"Player" },
    "swiss.result":     { ja:"結果（左の勝ち数 − 右の勝ち数）", en:"Result (left − right)" },
    "swiss.playerB":    { ja:"プレイヤー", en:"Player" },
    "swiss.byeRow":     { ja:"バイ（不戦勝・2-0扱い）", en:"Bye (counts as a 2-0 win)" },
    "swiss.nextBye":    { ja:"次のラウンドのバイ", en:"Bye for next round" },
    "swiss.next":       { ja:"次のラウンドを組む", en:"Pair next round" },
    "swiss.addRound":   { ja:"予定を超えてもう1ラウンド", en:"Add one more round" },
    "swiss.finish":     { ja:"ここで大会を終える", en:"End tournament here" },
    "swiss.finishFinal":{ ja:"最終結果を確定する", en:"Confirm final standings" },
    "swiss.finishConfirm":{ ja:"大会を終了して順位を確定します。よろしいですか？", en:"End the tournament and lock the standings?" },

    "swiss.standings":  { ja:"順位表", en:"Standings" },
    "swiss.name":       { ja:"名前", en:"Name" },
    "swiss.record":     { ja:"勝-敗-分", en:"W-L-D" },
    "swiss.points":     { ja:"Pt", en:"Pts" },
    "swiss.tiebreakHint":{ ja:"同点のときは OMW%（対戦相手の勝率）、GW%（自分のゲーム勝率）、OGW%（対戦相手のゲーム勝率）の順で比べます。マジックの公式大会と同じ基準です。",
                          en:"Ties are broken by OMW% (opponents' match-win %), then GW% (your game-win %), then OGW% (opponents' game-win %) — the same order as official Magic events." },
    "swiss.out":        { ja:"不参加", en:"Out" },
    "swiss.in":         { ja:"参加", en:"In" },
    "swiss.byeTag":     { ja:"バイ済", en:"Had bye" },
    "swiss.copy":       { ja:"順位表をコピー", en:"Copy standings" },
    "swiss.copied":     { ja:"コピーしました", en:"Copied" },
    "swiss.copyManual": { ja:"コピーできませんでした。以下を選択してコピーしてください。", en:"Could not copy. Select the text below." },
    "swiss.copyTitle":  { ja:"順位表（{n}ラウンド終了時点）", en:"Standings after round {n}" },

    "swiss.attendance": { ja:"参加者の出入り", en:"Attendance" },
    "swiss.attendanceHint":{ ja:"ボタンで参加と不参加を切り替えます。遅れて来た人は「参加させる」を押すと、次のラウンドから組み込まれます。進行中のラウンドには影響しません。",
                          en:"Use the buttons to switch players between in and out. Late arrivals join from the next round. The current round is not affected." },
    "swiss.fromRoster": { ja:"名簿から途中参加させる", en:"Add a late arrival from the roster" },
    "swiss.benchEmpty": { ja:"名簿の全員がすでに参加しています。", en:"Everyone on the roster is already in." },
    "swiss.newLate":    { ja:"名簿にない人を途中参加させる", en:"Add someone not on the roster" },
    "swiss.joinNow":    { ja:"参加させる", en:"Add" },
    "swiss.setIn":      { ja:"{n}を参加にする", en:"Mark {n} as playing" },
    "swiss.setOut":     { ja:"{n}を不参加にする", en:"Mark {n} as out" },
    "swiss.latePh":     { ja:"名前", en:"Name" },
    "swiss.lateAdd":    { ja:"途中参加を追加", en:"Add late arrival" },
    "swiss.history":    { ja:"これまでのラウンド", en:"Previous rounds" },
    "swiss.noHistory":  { ja:"まだありません。", en:"Nothing yet." },
    "swiss.reset":      { ja:"この大会を消して最初から", en:"Discard this tournament" },
    "swiss.resetConfirm":{ ja:"進行中の大会を消します。参加者の名簿は残ります。よろしいですか？", en:"Discard the current tournament? The roster will be kept." },

    /* ===== ドラフト・アシスタント ===== */
    "page.assist.title":{ ja:"ドラフト・アシスタント｜アリーナのドラフト中に勝率と色から推奨カードを表示",
                          en:"Draft assistant — Live pick suggestions for Arena drafts" },
    "desc.assist":      { ja:"マジック：ザ・ギャザリング アリーナのドラフト中に、いま見ているパックを勝率と自分の色から並べ替えて表示するPC用ツール。ログファイルを読むだけで、画面には触れません。",
                          en:"A PC tool that ranks the pack in front of you during a Magic: The Gathering Arena draft, using real win rates and the colours you are drafting. It reads Arena's log file only." },
    "assist.h1":        { ja:"ドラフト・アシスタント（PC版）", en:"Draft assistant (PC)" },
    "assist.lead":      { ja:"アリーナのドラフト中に、いま見ているパックのカードを勝率と自分の色から並べ替えて表示します。PCのChrome／Edge専用です。",
                          en:"During an Arena draft, ranks the cards in your current pack by win rate and the colours you are drafting. PC Chrome/Edge only." },
    "assist.support":   { ja:"<b>対応環境</b>：Windows／MacのPCで、<b>Google Chrome</b> または <b>Microsoft Edge</b>。FirefoxとSafariは、ログファイルを読み続ける機能が無いため使えません。<b>スマートフォン・タブレットでは利用できません</b>（スマホ版アリーナはログを外部に公開しない作りのため）。",
                          en:"<b>Requirements</b>: a Windows or Mac PC with <b>Google Chrome</b> or <b>Microsoft Edge</b>. Firefox and Safari cannot keep reading the log file, so they are not supported. <b>Not available on phones or tablets</b>, because the mobile Arena app does not expose its log." },
    "assist.unsupported":{ ja:"このブラウザでは動きません。PCのChromeまたはEdgeで開いてください。", en:"This browser is not supported. Please open it in Chrome or Edge on a PC." },
    "assist.setupH":    { ja:"準備（初回だけ）", en:"Setup (first time only)" },
    "assist.steps":     { ja:"<li>マジック：ザ・ギャザリング アリーナを起動し、右上の歯車から設定を開き、「アカウント」→「詳細ログ（プラグインのサポート）」にチェックを入れる</li><li>アリーナを再起動する</li><li>下の「Player.log を選ぶ」を押すとファイル選択の画面が開くので、上部のアドレス欄に次を貼り付けてEnterを押し、開いたフォルダの中の <b>Player.log</b> を選ぶ<br>Windows：<code>%USERPROFILE%\\AppData\\LocalLow\\Wizards Of The Coast\\MTGA</code><br>Mac：<code>~/Library/Logs/Wizards Of The Coast/MTGA</code></li>",
                          en:"<li>In Magic: The Gathering Arena, open Settings (gear) → Account → turn on <b>Detailed Logs (Plugin Support)</b></li><li>Restart Arena</li><li>Press \"Choose Player.log\" below. In the file dialog, paste this into the address bar, press Enter, then pick <b>Player.log</b><br>Windows: <code>%USERPROFILE%\\AppData\\LocalLow\\Wizards Of The Coast\\MTGA</code><br>Mac: <code>~/Library/Logs/Wizards Of The Coast/MTGA</code></li>" },
    "assist.shotCap":   { ja:"設定 →「アカウント」の画面。「詳細ログ（プラグインのサポート）」にチェックを入れます。", en:"Settings → Account. Tick \"Detailed Logs (Plugin Support)\"." },
    "assist.setupHint": { ja:"ファイルはこのブラウザの中でだけ読み取ります。内容がどこかに送られることはありません。上のパスはユーザー名を打たなくても自分のフォルダに置き換わります。",
                          en:"The file is read inside this browser only; nothing is uploaded. The path above expands to your own user folder automatically." },
    "assist.pick":      { ja:"Player.log を選ぶ", en:"Choose Player.log" },
    "assist.resume":    { ja:"前回のファイルで再開", en:"Resume with last file" },
    "assist.demo":      { ja:"サンプルで動きを見る", en:"Try with a sample pack" },
    "assist.idle":      { ja:"ログファイルを選ぶと監視を始めます。", en:"Choose the log file to start watching." },
    "assist.watching":  { ja:"{name} を監視しています。アリーナでドラフトを始めてください。", en:"Watching {name}. Start a draft in Arena." },
    "assist.lost":      { ja:"ファイルを読めなくなりました。「前回のファイルで再開」を押してください。", en:"Lost access to the file. Press \"Resume with last file\"." },
    "assist.loadingSet":{ ja:"{set} のカード情報と勝率を読み込んでいます…", en:"Loading cards and win rates for {set}…" },
    "assist.ready":     { ja:"{set} の準備ができました（{n}種）。パックを開くとここに並びます。", en:"{set} is ready ({n} cards). Open a pack and it will appear here." },
    "assist.waiting":   { ja:"ドラフトの開始を待っています", en:"Waiting for a draft to start" },
    "assist.packPick":  { ja:"パック {p}・ピック {k}", en:"Pack {p}, pick {k}" },
    "assist.setLabel":  { ja:"セット {set}", en:"Set {set}" },
    "assist.packEmpty": { ja:"アリーナでドラフトのパックを開くと、ここにカードが並びます。", en:"When you open a pack in Arena, its cards appear here." },
    "assist.leaning":   { ja:"向かっている色：", en:"Leaning:" },
    "assist.viewPack":  { ja:"パック", en:"Pack" },
    "assist.viewDeck":  { ja:"デッキ案", en:"Deck" },
    "assist.doneTitle": { ja:"ドラフトが終わりました", en:"Draft complete" },
    "assist.deckTitle": { ja:"デッキ案（いまのピックから）：{c}", en:"Deck so far: {c}" },
    "assist.deckTitleDone":{ ja:"デッキ案：{c}", en:"Suggested deck: {c}" },
    "assist.deckNone":  { ja:"デッキを組むにはカードが足りません。", en:"Not enough cards to build a deck yet." },
    "assist.deckCount": { ja:"{n}枚（クリーチャー{c}・スペル{s}）", en:"{n} cards ({c} creatures, {s} spells)" },
    "assist.deckAvg":   { ja:"平均マナ総量 {v}", en:"Avg. mana value {v}" },
    "assist.deckShort": { ja:"この2色では{n}枚足りません。土地を増やすか、別の色の組み合わせもご検討ください。", en:"{n} short in this pair — add lands or consider another pair." },
    "assist.deckCreatures":{ ja:"クリーチャー", en:"Creatures" },
    "assist.deckSpells":{ ja:"スペル", en:"Spells" },
    "assist.deckLands": { ja:"土地", en:"Lands" },
    "assist.deckSide":  { ja:"入れ替え候補（サイドボード）", en:"Sideboard candidates" },
    "assist.landBasis": { ja:"（マナ・シンボル：{c}）", en:"(mana symbols: {c})" },
    "assist.landDouble":{ ja:"ダブルシンボルのカードがあるため{c}の土地を多めにしています", en:"{c} gets extra lands because of double-pip cards" },
    "assist.waitingNext":{ ja:"次のパックを待っています", en:"Waiting for the next pack" },
    "assist.packEmptyNext":{ ja:"他のプレイヤーのピックが終わると、次のパックがここに並びます。", en:"The next pack appears here once the other players have picked." },
    "assist.deckAlt":   { ja:"次点の色：{a}（かっこ内は評価の差）", en:"Runner-up pairs: {a} (score difference)" },
    "assist.deckCopy":  { ja:"デッキリストをコピー", en:"Copy deck list" },
    "assist.deckCopied":{ ja:"コピーしました", en:"Copied" },
    "assist.deckNote":  { ja:"勝率の高い順に、クリーチャー17・スペル6を目安に選んでいます。重いカードが多ければ軽いカードに入れ替え、同じ伝説のカードは2枚までにします。土地はマナ・シンボルの比率で分け、ダブルシンボルのある色は8枚以上を確保し、色の合う特殊土地は勝率が高ければ最大3枚まで含めます。最終的な調整はご自身の判断でどうぞ。", en:"Chosen by win rate, aiming for 17 creatures and 6 spells. Heavy cards are swapped for cheaper ones when there are too many; duplicate legends are limited to two copies. Lands are split by mana symbols, colours with double-pip cards get at least 8 sources, and up to 3 on-colour non-basic lands are included when their win rate is high. Adjust as you see fit." },
    "assist.best":      { ja:"おすすめ", en:"Pick this" },
    "assist.bestWr":    { ja:"GIH勝率 {p}%", en:"GIH win rate {p}%" },
    "assist.reasonLast":{ ja:"残り1枚なので、選ぶ余地はありません。デッキに入らなくても気にしなくて大丈夫です。", en:"Only one card left, so there is nothing to choose. It need not make the deck." },
    "assist.reasonLate":{ ja:"パックの終盤で選択肢が少ない場面です。色や勝率が合わなくても仕方ありません。デッキに入らない前提で、いちばん無難なものを挙げています。", en:"Late in the pack with little left. Colour and win rate cannot be helped here; this is simply the least bad option, and it probably will not make the deck." },
    "assist.reasonEarly":{ ja:"まだ色を決める前なので、勝率が最も高いカードです。", en:"Colours are still open, so this is simply the highest win rate." },
    "assist.reasonColor":{ ja:"いま向かっている{c}に合い、総合評価が最も高いカードです。", en:"Fits the {c} you are drafting and scores highest overall." },
    "assist.reasonOff": { ja:"{c}とは色が違いますが、勝率が飛び抜けているので候補に残しています。", en:"Off your {c} lane, but the win rate is high enough to stay on top." },
    "assist.reasonBest":{ ja:"勝率と色の合い具合をあわせて見て、最も高いカードです。", en:"Highest overall once win rate and colour fit are combined." },
    "assist.bestN":     { ja:"おすすめ {n}", en:"Pick {n}" },
    "assist.bestTwoNote":{ ja:"評価が近いので2枚並べています。デッキの方向や好みで選んでください。", en:"These two score almost the same — choose by the deck you want to build." },
    "assist.slots":     { ja:"クリーチャー {c}／スペル {s}（目安 {tc}：{ts}）", en:"Creatures {c} / spells {s} (aim {tc}:{ts})" },
    "assist.slotsTip":  { ja:"自分の色でピック済みの枚数です。40枚デッキの土地以外23枚は、クリーチャー17枚・スペル6枚前後が目安です。足りない側の枠を持ち上げます。", en:"On-colour picks so far. A 40-card deck's 23 non-lands are usually ~17 creatures and ~6 spells; whichever is short gets a boost." },
    "assist.paceLabel": { ja:"環境の速さ：{p}", en:"Format pace: {p}" },
    "assist.paceTip":   { ja:"環境レポートと同じデータです。速い環境では低マナ域を、遅い環境では中〜高マナ域を持ち上げます。", en:"Same data as the set report. Fast formats boost cheap cards; slow formats boost the mid-to-high end." },
    "assist.pace.fast": { ja:"速い", en:"fast" },
    "assist.pace.mid":  { ja:"中速", en:"medium" },
    "assist.pace.slow": { ja:"遅い", en:"slow" },
    "assist.pace.slower":{ ja:"かなり遅い", en:"very slow" },
    "assist.reasonNeedCreature":{ ja:"クリーチャーが不足気味なので、その分も上げています。", en:"You are short on creatures, which adds to it." },
    "assist.reasonNeedSpell":{ ja:"スペルが不足気味なので、その分も上げています。", en:"You are short on spells, which adds to it." },
    "assist.reasonPace":{ ja:"{p}環境に合うマナ域です。", en:"The mana value suits a {p} format." },
    "assist.breakdown": { ja:"勝率 {b}　色 {c}　枠 {s}　速さ {p}", en:"WR {b}  colour {c}  slot {s}  pace {p}" },
    "assist.breakdownLegend":{ ja:"伝説の重複 {v}", en:"legend dup {v}" },
    "assist.legendTag": { ja:"伝説・{n}枚目あり", en:"Legend ×{n} owned" },
    "assist.targetPair":{ ja:"目標：{c}（環境での勝率 {p}%）", en:"Target: {c} (format win rate {p}%)" },
    "assist.targetPairNoData":{ ja:"目標：{c}", en:"Target: {c}" },
    "assist.targetPairTip":{ ja:"ピック済みの色に、環境レポートの「2色の組み合わせの勝率」を加えて決めた目標の2色です。環境で弱い組み合わせには流れにくくしています。", en:"Your target pair: picked colours plus the set report's two-colour win rates, so weak pairings are avoided." },
    "assist.reasonArcheGood":{ ja:"{c}は環境レポートでも勝率{p}%と強い組み合わせです。", en:"{c} is a strong pairing in the set report ({p}%)." },
    "assist.reasonArcheNone":{ ja:"{c}は環境レポートに載らないほど組まれていない組み合わせなので、他の色が伸びれば目標が変わることがあります。", en:"{c} is rarely drafted (not enough games in the set report); the target may shift if another colour gains ground." },
    "assist.reasonArcheWeak":{ ja:"{c}は環境レポートでは平均以下（{p}%）の組み合わせなので、他の色が伸びれば目標が変わることがあります。", en:"{c} is below average in the set report ({p}%); the target may shift if another colour gains ground." },
    "assist.reasonLegend":{ ja:"伝説のカードで、同じものをすでに{n}枚持っています。場には1枚しか置けないので少し下げていますが、2枚目までは十分に候補です。", en:"It is legendary and you already hold {n}; only one can be on the battlefield, so it is marked down slightly — a second copy is still worth taking." },
    "assist.weight":    { ja:"色へのこだわり", en:"Colour commitment" },
    "assist.weightWeak":{ ja:"弱め（勝率を重視）", en:"Weak (favour win rate)" },
    "assist.weightMid": { ja:"標準", en:"Standard" },
    "assist.weightStrong":{ ja:"強め（色を重視）", en:"Strong (favour colours)" },
    "assist.weightHint":{ ja:"ピック済みの上位2色を自分の色とみなし、合うカードを持ち上げ、違うカードを下げます。標準では1パック目で最大±4、2パック目で±6、3パック目で±8ポイントです。", en:"Your two most-picked colours count as yours. On-colour cards are boosted and off-colour cards lowered — on Standard, up to ±4 points in pack 1, ±6 in pack 2 and ±8 in pack 3." },
    "assist.onColor":   { ja:"色が合う", en:"On colour" },
    "assist.offColor":  { ja:"色が違う", en:"Off colour" },
    "assist.settingsH": { ja:"設定", en:"Settings" },
    "assist.pipLabel":  { ja:"小窓表示", en:"Mini window" },
    "assist.pip":       { ja:"常に前面の小窓で表示", en:"Open always-on-top window" },
    "assist.pipClose":  { ja:"小窓を閉じる", en:"Close the window" },
    "assist.pipHint":   { ja:"アリーナを全画面ではなくウィンドウ表示にしておくと、小窓を横に置けます。", en:"Run Arena in windowed mode so the small window can sit beside it." },
    "assist.pipUnsupported":{ ja:"この機能はChrome／Edgeの新しい版でのみ使えます。", en:"This needs a recent Chrome or Edge." },
    "assist.pickedH":   { ja:"これまでのピック", en:"Picks so far" },
    "assist.pickedEmpty":{ ja:"まだありません。", en:"Nothing yet." },
    "assist.debugH":    { ja:"読み取りの記録（うまく動かないときに）", en:"Log of what was read (for troubleshooting)" },
    "assist.debugHint": { ja:"ログから拾えた出来事を新しい順に出します。パックを開いたのにここに何も出ない場合は、アリーナ側のログ形式が変わった可能性があります。この内容を添えてお知らせください。",
                          en:"Events picked up from the log, newest first. If you opened a pack and nothing appears here, Arena's log format may have changed — please report it with this text." },
    "assist.demoLoading":{ ja:"サンプルを用意しています…", en:"Preparing a sample…" },
    "assist.demoFailed":{ ja:"サンプルを用意できませんでした。", en:"Could not prepare a sample." },
    "assist.demoReady": { ja:"サンプルです。{set} のカードで仮のパックを表示しています。実際のドラフトではアリーナのログから自動で更新されます。",
                          en:"Sample mode: showing a mock pack of {set} cards. In a real draft this updates automatically from Arena's log." },

    "privacy.h1":       { ja:"プライバシーポリシー", en:"Privacy Policy" },
    "privacy.lead":     { ja:"取得する情報とその使い道、データの出典と権利表示をまとめます。",
                          en:"What we collect and why, plus data sources and legal notices." },
    "privacy.updated":  { ja:"最終更新：2026年9月14日", en:"Last updated: 14 September 2026" },

    "privacy.s1.h":     { ja:"はじめに", en:"Overview" },
    "privacy.s1.body":  { ja:"<p>リミテッド・ワークベンチ（以下「当サイト」）は、個人を特定する情報の登録を求めません。アカウント登録もログインも不要で、氏名やメールアドレスを入力する場面はありません。</p><p>一方で、アクセス状況の把握や外部サービスの利用にともない、いくつかの情報が自動的に扱われます。以下でその内容を説明します。</p>",
                          en:"<p>Limited Workbench (“this site”) does not ask you to register or identify yourself. There is no account, no login, and no form asking for your name or email address.</p><p>Some information is nonetheless handled automatically, through analytics and the third-party services the site relies on. The sections below explain what and why.</p>" },

    "privacy.s2.h":     { ja:"アクセス解析", en:"Analytics" },
    "privacy.s2.body":  { ja:"<p>当サイトは、閲覧状況を把握するために <b>Cloudflare Web Analytics</b> を利用しています。これはCookieを使わず、個人を追跡しない仕組みです。訪問数、閲覧されたページ、参照元、おおまかな地域、ブラウザの種類といった集計情報のみを扱います。</p><p>取得した情報は、どのページが役に立っているかを判断し、当サイトを改善する目的にのみ使用します。</p>",
                          en:"<p>This site uses <b>Cloudflare Web Analytics</b> to understand how it is being used. It does not use cookies and does not track individuals. It records aggregate figures only: visits, pages viewed, referrers, approximate region and browser type.</p><p>That information is used solely to work out which pages are useful and to improve the site.</p>" },

    "privacy.s3.h":     { ja:"ブラウザに保存される情報", en:"Information stored in your browser" },
    "privacy.s3.body":  { ja:"<p>選択した言語（日本語／英語）を、お使いのブラウザの<b>ローカルストレージ</b>に保存します。次回訪問時に同じ言語で表示するためのものです。</p><p>スイスドロー対戦表では、入力した参加者の名前と進行中の大会の内容も、同じくローカルストレージに保存します。次回に参加者を呼び出したり、ページを閉じても大会を続けられるようにするためです。</p><p>これらは、当サイトの運営者を含む誰かに送信されることはありません。ブラウザの設定から削除できます。</p>",
                          en:"<p>Your language choice (Japanese or English) is kept in your browser's <b>local storage</b> so the site opens in the same language next time.</p><p>The Swiss pairings tool also stores the player names you enter and the state of the current tournament in local storage, so the roster can be recalled and a tournament survives closing the page.</p><p>None of this is sent to anyone, including the site operator. You can delete it from your browser settings.</p>" },

    "privacy.s4.h":     { ja:"広告について", en:"Advertising" },
    "privacy.s4.body":  { ja:"<p>当サイトでは、将来的に第三者配信の広告サービス（Google AdSense など）の利用を予定しています。導入した場合、広告配信事業者がCookieを使用して、利用者の過去のアクセス情報に基づく広告を表示することがあります。</p><p>Googleが広告Cookieを使用することにより、利用者が当サイトや他のサイトにアクセスした際の情報に基づいて広告を配信します。利用者は <a href=\"https://myadcenter.google.com/\" target=\"_blank\" rel=\"noopener\">広告設定</a> でパーソナライズ広告を無効にできます。また <a href=\"https://www.aboutads.info/choices/\" target=\"_blank\" rel=\"noopener\">aboutads.info</a> で第三者配信事業者のCookieを無効にすることもできます。</p><p>広告を導入した時点で、本ページに明記します。</p>",
                          en:"<p>This site expects to carry third-party advertising (such as Google AdSense) in future. Where it does, advertising vendors may use cookies to serve ads based on your prior visits to this and other sites.</p><p>Google's use of advertising cookies enables it and its partners to serve ads based on your visits to this site and others. You can opt out of personalised advertising via <a href=\"https://myadcenter.google.com/\" target=\"_blank\" rel=\"noopener\">Google Ads Settings</a>, or opt out of third-party vendor cookies at <a href=\"https://www.aboutads.info/choices/\" target=\"_blank\" rel=\"noopener\">aboutads.info</a>.</p><p>This page will be updated at the point advertising is actually introduced.</p>" },

    "privacy.s5.h":     { ja:"外部サービス", en:"Third-party services" },
    "privacy.s5.body":  { ja:"<p>当サイトは次の外部サービスを利用しています。これらのサービスを読み込む際、利用者のIPアドレスなどの通信情報が各事業者に送信されます。</p><ul><li><b>Scryfall</b>：カードの情報と画像の取得</li><li><b>17Lands</b>：公開データセットの取得（月1回、当サイトの自動処理が行うもので、利用者のブラウザからは接続しません）</li><li><b>Cloudflare</b>：サイトの配信とアクセス解析</li><li><b>Google Fonts</b>：書体の読み込み</li></ul><p>各サービスにおける情報の取り扱いは、それぞれの事業者の方針に従います。</p>",
                          en:"<p>This site relies on the services below. When your browser loads them, connection information such as your IP address is sent to the relevant provider.</p><ul><li><b>Scryfall</b> — card data and images</li><li><b>17Lands</b> — public datasets (fetched once a month by this site's own automation, not from your browser)</li><li><b>Cloudflare</b> — hosting and analytics</li><li><b>Google Fonts</b> — typefaces</li></ul><p>Information handled by those services is governed by their own policies.</p>" },

    "privacy.s8.h":     { ja:"出典と権利表示", en:"Credits and legal notices" },
    "privacy.s8.body":  { ja:"<p>カードの情報と画像は <a href=\"https://scryfall.com\" target=\"_blank\" rel=\"noopener\">Scryfall</a> から取得しています。画像は加工せず、そのままの形で表示しています。</p><p>カード勝率は <a href=\"https://www.17lands.com/public_datasets\" target=\"_blank\" rel=\"noopener\">17Lands Public Data</a>（<a href=\"https://creativecommons.org/licenses/by/4.0/\" target=\"_blank\" rel=\"noopener\">CC BY 4.0</a>）を当サイトが集計したものです。</p><p>当サイトは、ファンコンテンツ・ポリシーに基づく非公式のファンコンテンツです。ウィザーズ・オブ・ザ・コースト社の認可・許可を受けていません。題材の一部に同社の財産を含みます。&copy;Wizards of the Coast LLC.</p>",
                          en:"<p>Card data and images come from <a href=\"https://scryfall.com\" target=\"_blank\" rel=\"noopener\">Scryfall</a>, shown unmodified.</p><p>Card win rates are aggregated by this site from <a href=\"https://www.17lands.com/public_datasets\" target=\"_blank\" rel=\"noopener\">17Lands Public Data</a> (<a href=\"https://creativecommons.org/licenses/by/4.0/\" target=\"_blank\" rel=\"noopener\">CC BY 4.0</a>).</p><p>This site is unofficial Fan Content permitted under the Fan Content Policy. Not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. &copy;Wizards of the Coast LLC.</p>" },

    "privacy.s9.h":     { ja:"当サイトの内容の引用について", en:"Citing this site" },
    "privacy.s9.body":  { ja:"<p>当サイトが集計した勝率データや環境レポートの内容は、個人・法人を問わず自由に引用していただけます。</p><p>引用される際は、出典として <a href=\"https://sealed-workbench.com\">https://sealed-workbench.com</a> へのリンクを記載してください。</p><p>なお、元データである17Landsの公開データセットはCC BY 4.0で提供されています。数値をそのまま転載する場合は、あわせて17Landsへの出典表示もお願いします。</p>",
                          en:"<p>You are welcome to quote the win-rate figures and set reports compiled here.</p><p>When you do, please credit this site with a link to <a href=\"https://sealed-workbench.com\">https://sealed-workbench.com</a>.</p><p>The underlying 17Lands public datasets are provided under CC BY 4.0, so please also credit 17Lands when reproducing the raw figures.</p>" },

    "privacy.s10.h":    { ja:"利用条件", en:"Terms of use" },
    "privacy.s10.body": { ja:"<p>当サイトのプログラム、文章、デザイン、および当サイトが作成した集計データ（勝率一覧・環境レポートの内容）の著作権は、当サイトの運営者に帰属します。</p><p>個人でご利用いただくのは自由です。集計データや記事の内容を引用される場合は、上の「当サイトの内容の引用について」のとおり、出典として当サイトへのリンクを記載してください。</p><p>次の行為はご遠慮ください。</p><ul><li>サイト全体、またはプログラム・デザインを複製し、他のサイトやサービスとして公開すること</li><li>当サイトのデータファイルを、他のサイトやプログラムから直接読み込んで利用すること</li><li>当サイトの内容を改変して再配布すること</li><li>営利目的での利用（事前にご相談ください）</li></ul><p>カードの情報と画像はウィザーズ・オブ・ザ・コースト社の財産であり、Scryfallを通じて表示しています。集計の元データである17Landsの公開データセットは、17Landsから直接取得できます。</p>",
                          en:"<p>The programs, text, design and the aggregated data produced by this site (the win-rate tables and set reports) are the copyright of the site operator.</p><p>Personal use is free. When quoting the data or reports, please credit this site with a link, as described in \"Citing this site\" above.</p><p>Please do not:</p><ul><li>copy the site, its programs or its design and publish them as another site or service;</li><li>load this site's data files directly from another site or program;</li><li>modify and redistribute the site's content;</li><li>use it commercially without asking first.</li></ul><p>Card data and images are the property of Wizards of the Coast and are shown via Scryfall. The underlying 17Lands public datasets are available directly from 17Lands.</p>" },

    "privacy.s6.h":     { ja:"免責事項", en:"Disclaimer" },
    "privacy.s6.body":  { ja:"<p>当サイトが表示するカード勝率は、17Landsが公開しているデータを当サイトが独自に集計したものです。正確性を期していますが、内容を保証するものではありません。</p><p>当サイトの利用によって生じた損害について、運営者は責任を負いかねます。</p><p>当サイトは非公式のファンコンテンツであり、ウィザーズ・オブ・ザ・コースト社および17Landsとは関係ありません。</p>",
                          en:"<p>The win rates shown here are aggregated by this site from data published by 17Lands. Every effort is made to get them right, but no guarantee is given.</p><p>The operator accepts no liability for any loss arising from use of this site.</p><p>This is unofficial fan content and is not affiliated with Wizards of the Coast or with 17Lands.</p>" },

    "privacy.s7.h":     { ja:"お問い合わせと改定", en:"Contact and changes" },
    "privacy.s7.body":  { ja:"<p>本ポリシーおよび当サイトに関するお問い合わせは、X（旧Twitter）の <a href=\"https://x.com/MTGtbg\" target=\"_blank\" rel=\"noopener\">@MTGtbg</a> へのダイレクトメッセージ、または投稿への返信でお願いします。個人で運営しているため、返信までお時間をいただくことがあります。</p><p>本ポリシーは、必要に応じて予告なく改定することがあります。改定した場合は、本ページの最終更新日を変更します。</p>",
                          en:"<p>For questions about this policy or the site, please send a direct message to <a href=\"https://x.com/MTGtbg\" target=\"_blank\" rel=\"noopener\">@MTGtbg</a> on X, or reply to one of its posts. The site is run by one person, so replies may take a little time.</p><p>This policy may be revised as needed without prior notice. The date at the top of this page will be updated when it is.</p>" },

    "mode.sealed":      { ja:"シールド", en:"Sealed" },
    "mode.draft":       { ja:"ドラフト", en:"Draft" },
    "reports.sources":  { ja:"内訳：{list}", en:"Includes: {list}" },
    "reports.compare.h":{ ja:"他のセットとの比較", en:"Compared with other sets" },
    "reports.compare.lead":{ ja:"1試合あたりの平均ターン数です。短いほど速い環境です。縦線は同じ形式の直近{n}セットの平均を表します。",
                          en:"Average turns per game — fewer means a faster format. The vertical line marks the average of the {n} most recent sets in the same mode." },
    "reports.compare.avg":{ ja:"直近{c}セットの平均 {n}ターン", en:"Average of the last {c} sets: {n} turns" },
    "reports.compare.this":{ ja:"このセット", en:"This set" },
    "reports.turns":    { ja:"{n}ターン", en:"{n} turns" },
    "reports.faster":   { ja:"平均より {n}ターン速い", en:"{n} turns faster than average" },
    "reports.slower":   { ja:"平均より {n}ターン遅い", en:"{n} turns slower than average" },
    "reports.same":     { ja:"平均とほぼ同じ", en:"About average" },

    "nav.reports":      { ja:"環境レポート", en:"Set reports" },

    "page.reports.title":{ ja:"環境レポート｜MTGアリーナのリミテッド環境をデータで読む",
                          en:"Set reports — MTG Arena Limited formats in data" },
    "desc.reports":     { ja:"マジック：ザ・ギャザリング アリーナのリミテッド環境を、17Landsの実戦データから読み解きます。環境の速さ、色の組み合わせの強さ、レアリティ別の強いカード、マナカーブの傾向を、セットごとに掲載しています。",
                          en:"Reading Magic: The Gathering Arena Limited formats from 17Lands game data: format speed, colour pair strength, the best cards at each rarity, and how the mana curve performs — set by set." },
    "reports.h1":       { ja:"環境レポート", en:"Set report" },
    "reports.lead":     { ja:"そのセットのリミテッド環境を、実戦データから読み解きます。",
                          en:"Reading a set's Limited format from real game data." },
    "reports.staticLink":{ ja:"このセットの固定ページ（共有・検索用）", en:"Static page for this set (for sharing and search)" },
    "reports.ready":    { ja:"セットと形式を選んでください。", en:"Choose a set and a format." },
    "reports.loading":  { ja:"レポートを読み込んでいます…", en:"Loading the report…" },
    "reports.none":     { ja:"この組み合わせのレポートはまだありません。", en:"No report for this combination yet." },
    "reports.summary":  { ja:"{set} ／ {ev} ／ {g}試合 ／ 全体勝率 {wr}%",
                          en:"{set} · {ev} · {g} games · {wr}% overall win rate" },
    "reports.built":    { ja:"集計 {d}", en:"Built {d}" },

    "reports.speed.h":  { ja:"環境の速さ", en:"Format speed" },
    "reports.speed.lead":{ ja:"デッキの平均マナ総量ごとに勝率を出しました。低いほど速いデッキです。",
                          en:"Win rate by a deck's average mana value. Lower means a faster deck." },
    "reports.speed.best":  { ja:"{label}が最も勝率が高く、{p}%です。",
                          en:"{label} have the highest win rate, at {p}%." },
    "reports.pace.fast":  { ja:"直近{c}セットと比べると、速い環境です。", en:"Compared with the last {c} sets, this is a fast format." },
    "reports.pace.same":  { ja:"直近{c}セットと比べると、速さは同じくらいです。", en:"Compared with the last {c} sets, the pace is about the same." },
    "reports.pace.slow":  { ja:"直近{c}セットと比べると、遅い環境です。", en:"Compared with the last {c} sets, this is a slow format." },
    "reports.speedn.fast":  { ja:"平均マナ総量2.9未満の速いデッキ",   en:"Decks averaging under 2.9 mana value" },
    "reports.speedn.mid":   { ja:"平均マナ総量3.2未満の中速デッキ",   en:"Decks averaging under 3.2 mana value" },
    "reports.speedn.slow":  { ja:"平均マナ総量3.5未満の遅いデッキ",   en:"Decks averaging under 3.5 mana value" },
    "reports.speedn.slower":{ ja:"平均マナ総量3.5以上の重いデッキ",   en:"Decks averaging 3.5 mana value or more" },
    "reports.speed.bestnote":{ ja:"全体勝率 {a}%／該当 {g}試合", en:"Overall {a}% · {g} games in this band" },
    "reports.compare.avgRow":{ ja:"直近{c}セットの平均", en:"Average, last {c} sets" },
    "reports.compare.fastest":{ ja:"最も速い：{s}", en:"Fastest: {s}" },
    "reports.compare.slowest":{ ja:"最も遅い：{s}", en:"Slowest: {s}" },
    "reports.speed.fast":  { ja:"速い（2.9未満）", en:"Fast (under 2.9)" },
    "reports.speed.mid":   { ja:"中間（3.2未満）", en:"Middling (under 3.2)" },
    "reports.speed.slow":  { ja:"遅い（3.5未満）", en:"Slow (under 3.5)" },
    "reports.speed.slower":{ ja:"もっと遅い（3.5以上）", en:"Slowest (3.5 and up)" },
    "verdict.fast":     { ja:"速い環境です。低マナ域を厚くしたデッキが勝ちやすい傾向がはっきり出ています。",
                          en:"A fast format. Decks weighted toward cheap spells clearly win more." },
    "verdict.slow":     { ja:"遅い環境です。重いカードを支えられるデッキが勝ちやすい傾向が出ています。",
                          en:"A slow format. Decks that can support expensive cards win more." },
    "verdict.even":     { ja:"速さによる有利不利がはっきりしない環境です。デッキの中身で決まる部分が大きそうです。",
                          en:"Speed does not decide much here. What goes in the deck matters more." },
    "reports.gap":      { ja:"速いデッキと最も遅いデッキの差：{n}ポイント", en:"Fast vs slowest: {n} points" },

    "reports.colors.h": { ja:"色の強さ", en:"Colour strength" },
    "reports.colors.lead":{ ja:"その色を含むデッキの勝率です。2色の組み合わせは下の表をご覧ください。",
                          en:"Win rate of decks containing each colour. Pairs are in the table below." },
    "reports.arche.h":  { ja:"色の組み合わせ", en:"Colour pairs" },
    "reports.arche.lead":{ ja:"試合数の少ない組み合わせは除いています。",
                          en:"Combinations with small samples are left out." },

    "reports.curve.h":  { ja:"マナ総量ごとの勝率", en:"Win rate by mana value" },
    "reports.curve.lead":{ ja:"カードのGIH勝率を、試合数で重みづけしてマナ総量ごとにまとめました。土地は含みません。",
                          en:"Card GIH win rates grouped by mana value, weighted by games. Lands excluded." },

    "reports.cards.h":  { ja:"レアリティ別の強いカード", en:"Best cards by rarity" },
    "reports.cards.lead":{ ja:"GIH勝率の高い順です。{n}試合以上のカードに限っています。カード名にカーソルを合わせると画像が出ます。",
                          en:"Sorted by GIH win rate, limited to cards with at least {n} games. Hover a card name to see it." },

    "reports.notes.h":  { ja:"考察", en:"Notes" },
    "reports.col.card": { ja:"カード", en:"Card" },
    "reports.col.cmc":  { ja:"マナ", en:"MV" },
    "reports.col.wr":   { ja:"勝率", en:"Win rate" },
    "reports.col.games":{ ja:"試合数", en:"Games" },
    "reports.col.pair": { ja:"色", en:"Colours" },
    "reports.col.speed":{ ja:"デッキの速さ", en:"Deck speed" },
    "reports.col.mv":   { ja:"マナ総量", en:"Mana value" },

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
    scope.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.setAttribute("title", t(el.dataset.i18nTitle));
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
    setMeta("property", "og:url", location.origin + location.pathname);
    setMeta("property", "og:image", location.origin + "/ogp-" + lang + ".png");
    setMeta("name", "twitter:image", location.origin + "/ogp-" + lang + ".png");
    document.documentElement.lang = lang;
    setJsonLd();
  }

  /* 検索エンジン向けの構造化データ。言語を切り替えたら中身も入れ替える。 */
  function setJsonLd(){
    const site = location.origin;
    const tk = document.documentElement.dataset.title;
    const dk = document.documentElement.dataset.desc;
    if(!tk || !dk) return;

    const data = {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": t(tk).split(/[｜—]/)[0].trim(),
      "url": location.origin + location.pathname,
      "description": t(dk),
      "inLanguage": lang,
      "applicationCategory": "GameApplication",
      "operatingSystem": "Web",
      "isAccessibleForFree": true,
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "publisher": { "@type": "Organization", "name": "Limited Workbench", "url": site }
    };

    let el = document.getElementById("ld-json");
    if(!el){
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = "ld-json";
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
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
