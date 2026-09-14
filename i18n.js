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
    "site.name":        { ja:"リミテッド・ワークベンチ", en:"Limited Workbench" },
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
    "page.index.title": { ja:"シールド構築｜MTGアリーナのシールド戦を練習できる無料ツール",
                          en:"Sealed builder — Free MTG Arena sealed practice" },
    "desc.index":       { ja:"MTGアリーナのリミテッド（シールド戦）を無料で練習。6パックを開封して40枚デッキを組み、そのままアリーナにインポートできるテキストを書き出します。17Landsの実戦データによるカード勝率つき。日本語対応。",
                          en:"Free sealed practice for MTG Arena Limited. Open six packs, build a 40-card deck, and export text you can import straight into Arena. Includes real card win rates from 17Lands data." },
    "index.h1":         { ja:"シールド構築", en:"Sealed builder" },
    "index.lead":       { ja:"6パック分のカードプールを生成して40枚デッキを組み、MTGアリーナにそのまま貼り付けられるテキストを書き出します。ドラフトの練習は上のタブから。",
                          en:"Open six packs, build a 40-card deck, and export text you can paste straight into MTG Arena. For draft practice, use the tab above." },
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
    "page.draft.title": { ja:"ドラフト｜MTGアリーナの8人卓ドラフトを1人で練習",
                          en:"Draft — Practice 8-player MTG Arena drafts solo" },
    "desc.draft":       { ja:"MTGアリーナのドラフトを1人で練習できる無料ツール。8人卓を再現し、他の7人は17Landsの勝率データをもとにピックします。3パック42手を終えたらデッキを組み、アリーナにインポートできます。",
                          en:"Free solo draft practice for MTG Arena. Simulates an eight-seat pod where the other drafters pick using 17Lands win-rate data. Finish 42 picks, build your deck, and import it into Arena." },
    "draft.h1":         { ja:"ドラフト", en:"Draft" },
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
    "ev.PickTwoDraft":  { ja:"2枚ピックドラフト",           en:"Pick Two Draft" },

    /* ---- フッター ---- */
    "nav.guide":        { ja:"使い方",  en:"Guide" },

    "page.guide.title": { ja:"使い方｜MTGアリーナのリミテッドを無料で練習する",
                          en:"Guide — Free MTG Arena Limited practice" },
    "desc.guide":       { ja:"リミテッド・ワークベンチの使い方と、向いている人。MTGアリーナでワイルドカードが余っている方、カードが揃っている方が、リミテッドのデッキを組んでフレンド戦で遊ぶための手引きです。カード勝率の読み方も解説します。",
                          en:"How to use Limited Workbench and who it is for. A guide for MTG Arena players with spare wildcards or a deep collection who want to build Limited decks and play them in Direct Challenge. Includes how to read card win rates." },
    "guide.h1":         { ja:"使い方", en:"Guide" },
    "guide.lead":       { ja:"このサイトで何ができるのか、誰に向いているのか、そして実際にアリーナで遊ぶまでの流れをまとめます。",
                          en:"What this site does, who it is for, and how to take a deck from here into Arena." },

    "guide.s1.h":       { ja:"このサイトでできること", en:"What this site does" },
    "guide.s1.body":    { ja:"<p>MTGアリーナのリミテッド（シールド戦・ドラフト）を、<b>課金せずに何度でも練習できる</b>ツールです。パックの開封からデッキ構築までをブラウザ上で行い、組んだデッキはアリーナにそのままインポートできるテキストとして書き出せます。</p><p>カードの強さは主観的な点数ではなく、<a href=\"https://www.17lands.com/public_datasets\" target=\"_blank\" rel=\"noopener\">17Landsの公開データ</a>を独自に集計した<b>実際の勝率</b>で表示します。日本語のカード名・カード画像に対応しています。</p>",
                          en:"<p>A free tool for practising MTG Arena Limited — sealed and draft — as many times as you like. Open packs and build a deck in your browser, then export text you can import straight into Arena.</p><p>Card strength is shown as a <b>measured win rate</b> aggregated from the <a href=\"https://www.17lands.com/public_datasets\" target=\"_blank\" rel=\"noopener\">17Lands public datasets</a>, not a subjective grade.</p>" },

    "guide.s2.h":       { ja:"こんな人に向いています", en:"Who this is for" },
    "guide.s2.body":    { ja:"<p><b>1. ワイルドカードが余っている人</b><br>リミテッドを中心に遊んでいると、ワイルドカードは使い道がないまま貯まっていきます。リミテッド用の40枚デッキを作って、フレンド戦で遊ぶという使い道があります。</p><p><b>2. カードがほとんど揃っている人</b><br>すでに該当セットのカードを持っているなら、ワイルドカードを使わずに組めます。開封の運に左右されない、公平なリミテッド対戦ができます。</p><p><b>3. 本番前に練習したい人</b><br>有料イベントに入る前に、そのセットのシールドやドラフトの感触を掴めます。何度でも無料です。</p><p><b>4. カードの強さを知りたい人</b><br>ツールを使わず、カード勝率一覧だけを見に来るのも歓迎です。日本語で実戦勝率を並べ替えられるサイトは多くありません。</p>",
                          en:"<p><b>1. Players sitting on spare wildcards</b><br>If you mostly play Limited, wildcards pile up with nowhere to go. Crafting a 40-card Limited deck and playing it in Direct Challenge is one way to spend them.</p><p><b>2. Players with a deep collection</b><br>If you already own the set, you can build without spending wildcards at all — and get an even Limited match that does not hinge on pack luck.</p><p><b>3. Players warming up for a real event</b><br>Get a feel for a set's sealed or draft format before paying an entry fee. As many runs as you want, free.</p><p><b>4. Anyone who just wants the numbers</b><br>You are welcome to use the win-rate table on its own.</p>" },

    "guide.s3.h":       { ja:"アリーナで遊ぶまでの流れ", en:"Getting a deck into Arena" },
    "guide.s3.body":    { ja:"<ol><li>このサイトでプールを生成し、40枚のデッキを組む</li><li>「アリーナ用テキストをコピー」を押す</li><li>MTGアリーナのデッキ画面で「インポート」を選ぶ</li><li>対戦相手とダイレクトチャレンジ（フレンド対戦）で対戦する</li></ol><p><b>大切な注意点</b>：40枚のデッキは、イベント外では<b>ダイレクトチャレンジでしか使えません</b>。通常のマッチングでは60枚以上が必要です。友人と遊ぶ前提のツールだとお考えください。</p><p><b>ワイルドカードについて</b>：持っていないカードは作成が必要です。40枚のデッキなら、土地を除いて20枚強のカードを作ることになります。構築画面に「作成に必要なワイルドカード」を表示しているので、組む前に確認できます。</p>",
                          en:"<ol><li>Generate a pool here and build your 40 cards</li><li>Press “Copy Arena import text”</li><li>In Arena, open the deck screen and choose Import</li><li>Play your opponent via Direct Challenge</li></ol><p><b>Important</b>: outside of events, a 40-card deck can <b>only</b> be used in Direct Challenge. Normal matchmaking requires 60 or more cards. Treat this as a tool for playing with friends.</p><p><b>About wildcards</b>: you have to craft any card you do not own — roughly twenty-odd cards for a 40-card deck once lands are excluded. The builder shows how many wildcards of each rarity a deck needs, so you can check before committing.</p>" },

    "guide.s4.h":       { ja:"3つのツール", en:"The three tools" },
    "guide.s4.body":    { ja:"<p><b>シールド構築</b>：6パック分のプールを生成して40枚デッキを組みます。カードを押すとデッキに入り、もう一度押すと戻ります。基本土地は＋−で増減します。</p><p><b>ドラフト</b>：8人卓を再現します。14枚のパックから1枚選ぶと残りが隣に流れ、同時に他の7人もピックします。他の7人はカードの勝率を基本に、ピックが進むほど自分の色を優先するように動きます。3パック42手を終えると構築画面に移ります。</p><p><b>カード勝率一覧</b>：セットとイベント種別を選ぶと、カードごとの実戦勝率が並びます。色・レアリティ・試合数で絞り込み、どの列でも並べ替えられます。</p>",
                          en:"<p><b>Sealed</b>: generate a six-pack pool and build 40 cards. Click a card to add it, click it again in the deck to remove it. Use + and − for basic lands.</p><p><b>Draft</b>: an eight-seat pod. Pick one card from a 14-card pack and the rest passes on while the other seven seats pick too. They weigh win rates first and increasingly favour their own colors as the draft goes on. After three packs you move to deck building.</p><p><b>Card win rates</b>: choose a set and event type to see per-card results. Filter by color, rarity and sample size, and sort by any column.</p>" },

    "guide.s5.h":       { ja:"数値の読み方", en:"Reading the numbers" },
    "guide.s5.body":    { ja:"<p><b>GIH勝率</b>が最も重要な指標です。そのカードが手札か戦場にあった試合の勝率で、「引いたときに勝てるカードか」を表します。同じセット内で比べるのが基本で、平均より3ポイント高ければ強いカード、低ければ弱いカードと考えられます。</p><p><b>IWD</b>は、引いた試合と引かなかった試合の勝率差です。GIH勝率が高くても、そもそも強いデッキにしか入らないカードは数値が膨らみます。IWDを併せて見ると、そのカード自体の貢献度がわかります。</p><p><b>試合数</b>は必ず確認してください。数十試合しかないカードの勝率は偶然で大きく動きます。初期状態では500試合以上に絞っていますが、レアや神話レアを見るときは特に注意が必要です。</p><p><b>注意</b>：17Landsのデータは、自分の成績を記録したい熱心なプレイヤーが中心です。全体の平均より勝率がやや高めに出る傾向があります。絶対値より、カード同士の比較に使ってください。</p>",
                          en:"<p><b>GIH WR</b> is the number that matters most: the win rate in games where the card was in hand or on the battlefield. Compare within a set — roughly three points above average is strong, three below is weak.</p><p><b>IWD</b> is the gap between games where you drew it and games where you did not. A card can post a high GIH WR simply because it only goes in good decks; IWD isolates the card's own contribution.</p><p><b>Always check the sample size.</b> A card with a few dozen games can swing wildly. The table filters to 500+ games by default, which matters most for rares and mythics.</p><p><b>One caveat</b>: 17Lands data comes from players engaged enough to track their own results, so win rates skew slightly high. Use it for comparing cards, not as an absolute.</p>" },

    "guide.s6.h":       { ja:"よくある質問", en:"Questions" },
    "guide.s6.body":    { ja:"<p><b>無料ですか</b><br>はい。アカウント登録も不要です。</p><p><b>データはいつ更新されますか</b><br>毎月1回、自動で最新の集計に入れ替わります。新しいセットも、発売から12日後以降に自動で追加されます（17Landsの規約に従っています）。</p><p><b>クイックドラフトのデータがないのはなぜですか</b><br>17Landsが公開しているデータにクイックドラフトが含まれていないためです。公開されれば自動で追加されます。</p><p><b>パックの中身は本物と同じですか</b><br>厳密には違います。レア1枚・アンコモン3枚・コモン10枚という簡易な構成で、実際のプレイ・ブースターの特殊枠などは再現していません。</p><p><b>日本語と英語を切り替えられますか</b><br>画面右上の言語選択で切り替わります。カード名や画像も連動します。</p>",
                          en:"<p><b>Is it free?</b><br>Yes, and no account is needed.</p><p><b>How often is the data updated?</b><br>Once a month, automatically. New sets are added automatically once they are twelve days old, in line with the 17Lands guidelines.</p><p><b>Why is there no Quick Draft data?</b><br>17Lands does not publish it. If that changes, it will appear automatically.</p><p><b>Are the packs identical to real ones?</b><br>Not exactly. They use a simplified 1 rare / 3 uncommon / 10 common structure and do not reproduce every Play Booster slot.</p><p><b>Can I switch languages?</b><br>Yes — use the selector at the top of any page. Card names and images follow.</p>" },

    "nav.privacy":      { ja:"プライバシー", en:"Privacy" },

    "page.privacy.title":{ ja:"プライバシーポリシー｜リミテッド・ワークベンチ",
                          en:"Privacy Policy — Limited Workbench" },
    "desc.privacy":     { ja:"リミテッド・ワークベンチにおけるアクセス解析、広告、外部サービスの利用と、取得する情報の取り扱いについて説明します。",
                          en:"How Limited Workbench handles analytics, advertising, third-party services and the information they involve." },
    "privacy.h1":       { ja:"プライバシーポリシー", en:"Privacy Policy" },
    "privacy.lead":     { ja:"このサイトで取得する情報と、その使い道についてまとめます。",
                          en:"What information this site collects and what it is used for." },
    "privacy.updated":  { ja:"最終更新：2026年9月14日", en:"Last updated: 14 September 2026" },

    "privacy.s1.h":     { ja:"はじめに", en:"Overview" },
    "privacy.s1.body":  { ja:"<p>リミテッド・ワークベンチ（以下「当サイト」）は、個人を特定する情報の登録を求めません。アカウント登録もログインも不要で、氏名やメールアドレスを入力する場面はありません。</p><p>一方で、アクセス状況の把握や外部サービスの利用にともない、いくつかの情報が自動的に扱われます。以下でその内容を説明します。</p>",
                          en:"<p>Limited Workbench (“this site”) does not ask you to register or identify yourself. There is no account, no login, and no form asking for your name or email address.</p><p>Some information is nonetheless handled automatically, through analytics and the third-party services the site relies on. The sections below explain what and why.</p>" },

    "privacy.s2.h":     { ja:"アクセス解析", en:"Analytics" },
    "privacy.s2.body":  { ja:"<p>当サイトは、閲覧状況を把握するために <b>Cloudflare Web Analytics</b> を利用しています。これはCookieを使わず、個人を追跡しない仕組みです。訪問数、閲覧されたページ、参照元、おおまかな地域、ブラウザの種類といった集計情報のみを扱います。</p><p>取得した情報は、どのページが役に立っているかを判断し、当サイトを改善する目的にのみ使用します。</p>",
                          en:"<p>This site uses <b>Cloudflare Web Analytics</b> to understand how it is being used. It does not use cookies and does not track individuals. It records aggregate figures only: visits, pages viewed, referrers, approximate region and browser type.</p><p>That information is used solely to work out which pages are useful and to improve the site.</p>" },

    "privacy.s3.h":     { ja:"ブラウザに保存される情報", en:"Information stored in your browser" },
    "privacy.s3.body":  { ja:"<p>選択した言語（日本語／英語）を、お使いのブラウザの<b>ローカルストレージ</b>に保存します。次回訪問時に同じ言語で表示するためのもので、当サイトの運営者を含む誰かに送信されることはありません。ブラウザの設定から削除できます。</p>",
                          en:"<p>Your language choice (Japanese or English) is kept in your browser's <b>local storage</b> so the site opens in the same language next time. It is never transmitted anywhere, including to the site operator, and you can clear it from your browser settings.</p>" },

    "privacy.s4.h":     { ja:"広告について", en:"Advertising" },
    "privacy.s4.body":  { ja:"<p>当サイトでは、将来的に第三者配信の広告サービス（Google AdSense など）の利用を予定しています。導入した場合、広告配信事業者がCookieを使用して、利用者の過去のアクセス情報に基づく広告を表示することがあります。</p><p>Googleが広告Cookieを使用することにより、利用者が当サイトや他のサイトにアクセスした際の情報に基づいて広告を配信します。利用者は <a href=\"https://myadcenter.google.com/\" target=\"_blank\" rel=\"noopener\">広告設定</a> でパーソナライズ広告を無効にできます。また <a href=\"https://www.aboutads.info/choices/\" target=\"_blank\" rel=\"noopener\">aboutads.info</a> で第三者配信事業者のCookieを無効にすることもできます。</p><p>広告を導入した時点で、本ページに明記します。</p>",
                          en:"<p>This site expects to carry third-party advertising (such as Google AdSense) in future. Where it does, advertising vendors may use cookies to serve ads based on your prior visits to this and other sites.</p><p>Google's use of advertising cookies enables it and its partners to serve ads based on your visits to this site and others. You can opt out of personalised advertising via <a href=\"https://myadcenter.google.com/\" target=\"_blank\" rel=\"noopener\">Google Ads Settings</a>, or opt out of third-party vendor cookies at <a href=\"https://www.aboutads.info/choices/\" target=\"_blank\" rel=\"noopener\">aboutads.info</a>.</p><p>This page will be updated at the point advertising is actually introduced.</p>" },

    "privacy.s5.h":     { ja:"外部サービス", en:"Third-party services" },
    "privacy.s5.body":  { ja:"<p>当サイトは次の外部サービスを利用しています。これらのサービスを読み込む際、利用者のIPアドレスなどの通信情報が各事業者に送信されます。</p><ul><li><b>Scryfall</b>：カードの情報と画像の取得</li><li><b>17Lands</b>：公開データセットの取得（月1回、当サイトの自動処理が行うもので、利用者のブラウザからは接続しません）</li><li><b>Cloudflare</b>：サイトの配信とアクセス解析</li><li><b>Google Fonts</b>：書体の読み込み</li></ul><p>各サービスにおける情報の取り扱いは、それぞれの事業者の方針に従います。</p>",
                          en:"<p>This site relies on the services below. When your browser loads them, connection information such as your IP address is sent to the relevant provider.</p><ul><li><b>Scryfall</b> — card data and images</li><li><b>17Lands</b> — public datasets (fetched once a month by this site's own automation, not from your browser)</li><li><b>Cloudflare</b> — hosting and analytics</li><li><b>Google Fonts</b> — typefaces</li></ul><p>Information handled by those services is governed by their own policies.</p>" },

    "privacy.s6.h":     { ja:"免責事項", en:"Disclaimer" },
    "privacy.s6.body":  { ja:"<p>当サイトが表示するカード勝率は、17Landsが公開しているデータを当サイトが独自に集計したものです。正確性を期していますが、内容を保証するものではありません。</p><p>当サイトの利用によって生じた損害について、運営者は責任を負いかねます。</p><p>当サイトは非公式のファンコンテンツであり、ウィザーズ・オブ・ザ・コースト社および17Landsとは関係ありません。</p>",
                          en:"<p>The win rates shown here are aggregated by this site from data published by 17Lands. Every effort is made to get them right, but no guarantee is given.</p><p>The operator accepts no liability for any loss arising from use of this site.</p><p>This is unofficial fan content and is not affiliated with Wizards of the Coast or with 17Lands.</p>" },

    "privacy.s7.h":     { ja:"お問い合わせと改定", en:"Contact and changes" },
    "privacy.s7.body":  { ja:"<p>本ポリシーに関するお問い合わせは、<a href=\"https://github.com/Kuro2270/sealed-workbench/issues\" target=\"_blank\" rel=\"noopener\">GitHubのIssue</a> よりご連絡ください。</p><p>本ポリシーは、必要に応じて予告なく改定することがあります。改定した場合は、本ページの最終更新日を変更します。</p>",
                          en:"<p>For questions about this policy, please open an issue on <a href=\"https://github.com/Kuro2270/sealed-workbench/issues\" target=\"_blank\" rel=\"noopener\">GitHub</a>.</p><p>This policy may be revised as needed without prior notice. The date at the top of this page will be updated when it is.</p>" },

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
