#!/usr/bin/env node
/*
 * 「はじめてのMTG」入門ページ（start/index.html, start/index.en.html）を作る。
 *
 *   node maintenance/build-start.mjs
 *
 * 内容は MTG とは何か／カードの見方／MTGアリーナ／フォーマット／リミテッド／40枚の配分／除去が強い理由 を 1 ページにまとめたもの。
 * 画像は Scryfall の公式カード画像とマナシンボルを、ブラウザから直接読み込む（Wizards の Fan Content Policy の範囲）。
 * ページの枠（ナビ・言語切り替え・フッター）は他のセット別ページと同じ shell() を使う。
 * 文章は参考にした入門記事の要点を、このサイト向けにかみ砕いて書き直したもの。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { shell, L, esc, SITE } from "./build-set-pages.mjs";

const SYM = k => `<img class="ms" src="https://svgs.scryfall.io/card-symbols/${k}.svg" alt="${k}" width="22" height="22" loading="lazy">`;
const cardUrl = name => `https://api.scryfall.com/cards/named?format=image&version=normal&exact=${encodeURIComponent(name)}`;
const card = (name, cls = "") =>
  `<span class="cimg ${cls}" data-name="${esc(name)}"><img src="${cardUrl(name)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('miss')"><i>${esc(name)}</i></span>`;

/* ------------------------------------------------------------------ 文面 */

const JA = {
  pages: {
    mtg: {
      title: "MTGとは｜マジック：ザ・ギャザリングの遊び方とMTGアリーナの始め方（初心者向け）",
      desc: "マジック：ザ・ギャザリング（MTG）はどんなゲームか。5つの色、カードの種類と見方、構築とリミテッドの違い、パソコンとスマートフォンで遊べるMTGアリーナのインストールまで。初心者向けに図と画像でまとめました。",
      h1: "MTGとは",
      lead: "マジック：ザ・ギャザリングはどんなゲームか。カードの見方、フォーマット、MTGアリーナの始め方を、ぱっとわかるようにまとめました。",
      toc: [["what", "どんなゲーム"], ["colors", "5つの色"], ["types", "カードの種類"], ["read", "カードの見方"], ["formats", "フォーマット"], ["arena", "MTGアリーナ"], ["official", "公式ページ"], ["next", "次の一歩"]]
    },
    limited: {
      title: "リミテッドとは｜シールドとドラフト、40枚デッキの組み方と除去が強い理由（MTG初心者向け）",
      desc: "MTGのリミテッド（シールド・ドラフト）とは何か。開けたパックだけでデッキを作る遊び方、40枚デッキの配分の目安、マナカーブ、リミテッドで除去が強い理由、カードの強さの調べ方を、初心者向けにまとめました。",
      h1: "リミテッドとは",
      lead: "開けたパックのカードだけで戦う「リミテッド」。シールドとドラフトの違い、40枚デッキの組み方、除去が強い理由を、1ページでまとめました。",
      toc: [["limited", "リミテッドとは"], ["deck", "40枚の配分"], ["removal", "除去が強い理由"], ["next", "次の一歩"]]
    }
  },

  what: {
    h: "MTGって、どんなゲーム？",
    lead: "基本は1対1で遊ぶカードゲームです。自分でデッキ（カードの束）を組んで戦うところが一番の魅力です。",
    points: [
      ["⚔️", "基本は1対1", "おたがいにライフ20から始め、相手のライフを0にすれば勝ち。2人1組で戦う形式や、3人以上で遊ぶ形式もあります。"],
      ["🃏", "デッキは自分で作る", "好きなカードを選んで、自分だけのデッキを組み立てます。"],
      ["🌍", "30年以上続く定番のTCG", "1993年に生まれたカードゲーム。大会も世界中で開かれています。"]
    ],
    flowH: "1ターンの流れ",
    flow: [["起こす", "前のターンに使ったカードを元に戻す"], ["引く", "デッキの上から1枚引く"], ["出す", "土地を1枚置き、マナで呪文やクリーチャーを出す"], ["攻撃", "クリーチャーで相手を攻撃する"], ["終わり", "ターンを相手に渡す"]],
    flowNote: "<b>土地</b>がマナ（呪文を使うためのエネルギー）の源です。土地は1ターンに1枚だけ置けるので、ターンが進むほど大きなカードを出せるようになります。"
  },

  colors: {
    h: "5つの色が、それぞれ違う戦い方をする",
    lead: "カードは5つの色に分かれ、色ごとに得意なことが違います。デッキは1〜2色で組むのが基本です。",
    list: [
      ["W", "白", "守りと秩序", "小さな仲間をたくさん並べ、空を飛ぶクリーチャーや回復で堅く戦います。"],
      ["U", "青", "知略とコントロール", "相手の呪文を打ち消したり、カードを引いたり。空を飛ぶ生き物も得意です。"],
      ["B", "黒", "犠牲と除去", "相手のクリーチャーを倒す呪文が豊富。ライフを払って強い効果を得ます。"],
      ["R", "赤", "速さと火力", "ダメージを与える呪文（火力）で相手のクリーチャーやライフを直接焼きます。"],
      ["G", "緑", "大きさと成長", "大型クリーチャーとマナ加速。力でゴリ押しする戦い方です。"]
    ],
    note: "ほかに、色を持たない<b>無色</b>のカード（アーティファクトなど）もあり、どんなデッキにも入れられます。"
  },

  types: {
    h: "カードの種類",
    lead: "まずは、よく出てくる7種類を覚えれば大丈夫です。画像は説明用の例です（現在のアリーナで遊べるとは限りません）。",
    list: [
      ["Serra Angel", "セラの天使", "クリーチャー", "戦場に出て戦う生き物。攻撃したり、相手の攻撃を受け止めたりします。"],
      ["Lightning Bolt", "稲妻", "インスタント", "好きなタイミングで使える呪文。相手のターン中にも使えて、使うと墓地に行きます。"],
      ["Wrath of God", "神の怒り", "ソーサリー", "自分のターンの途中にしか使えない呪文。大きな効果が多く、使い切りです。"],
      ["Pacifism", "平和な心", "エンチャント", "戦場に残り続ける効果。これは「相手のクリーチャーを動けなくする」タイプです。"],
      ["Sol Ring", "太陽の指輪", "アーティファクト", "道具のような永続物。多くは色を持たず、どのデッキにも入ります。"],
      ["Chandra, Torch of Defiance", "反逆の先導者、チャンドラ", "プレインズウォーカー", "味方になってくれる強力な魔道士。毎ターン能力を使い、相手に攻撃されると減っていきます。"],
      ["Forest", "森", "土地", "マナを生み出す、ゲームの土台。デッキの約4割は土地です。"]
    ]
  },

  read: {
    h: "カードの見方",
    lead: "数字や記号の意味が分かれば、初めて見るカードでも強さが読めます。",
    items: [
      ["1", "名前"],
      ["2", "マナコスト（出すために必要なマナ）"],
      ["3", "イラスト"],
      ["4", "タイプ（クリーチャーなど）"],
      ["5", "テキスト（能力の説明）"],
      ["6", "パワー／タフネス（攻撃力／体力）"]
    ],
    costH: "マナコストの読み方",
    costBody: `セラの天使のコストは <span class="cost">${SYM("3")}${SYM("W")}${SYM("W")}</span>。<b>白マナ2つ＋好きな色のマナ3つ</b>、合計5マナで出せるという意味です。丸い数字は「どの色でもよいマナ」、色のついた記号は「その色の土地から出るマナ」です。`,
    ptBody: "パワー／タフネスの <b>4/4</b> は、「4点のダメージを与え、4点のダメージを受けると倒れる」という意味です。"
  },

  arena: {
    h: "MTGアリーナ（デジタル版）で始める",
    lead: "MTGの公式デジタル版です。<b>パソコン（Windows・Mac）でも、スマートフォン・タブレット（iPhone・iPad・Android）でも</b>遊べて、基本プレイ無料、日本語に対応しています。PC版とスマホ版は、同じアカウントのデータで遊べます。",
    installH: "インストールする",
    install: [["💻", "パソコン（Windows・Mac）", "公式ページへ", "https://mtg-jp.com/mtgarena/"], ["📱", "iPhone・iPad", "App Store", "https://apps.apple.com/jp/app/magic-the-gathering-arena/id1496227521"], ["📱", "Android", "Google Play", "https://play.google.com/store/apps/details?id=com.wizards.mtga&hl=ja"]],
    installNote: "対応する機種や必要な容量は、公式ページとストアの案内で確認してください。このサイトの練習ツールはスマートフォンでも使えますが、アリーナのログを読む補助ツールはパソコン専用です。",
    stepsH: "はじめの一歩",
    steps: [["インストール", "上のボタンからアプリを入れて、アカウントを作ります。"], ["チュートリアル", "ゲーム内で、ルールを順に教えてくれます。"], ["カラーチャレンジ", "5色それぞれの無料デッキで、色の違いを体験できます。"], ["好きなモードへ", "対戦、ドラフト、シールドなどを選んで遊びます。"]],
    why: [
      ["ルールを自動で処理", "難しい判定はアプリがやってくれるので、遊びながら覚えられます。"],
      ["いつでも相手が見つかる", "世界中のプレイヤーと、好きな時間に対戦できます。"],
      ["遊ぶほど増える", "ゲーム内でもらえるゴールドで、パックやイベント参加を手に入れられます。"]
    ],
    moneyH: "覚えておきたい言葉",
    money: [["ゴールド", "遊ぶと貯まるゲーム内のお金。"], ["ジェム", "課金で買えるお金。ゴールドの代わりに使える場面も。"], ["ワイルドカード", "好きなカードに交換できるチケット。"]]
  },

  official: {
    h: "公式ページで、もっと学ぶ",
    lead: "ルールや用語を詳しく知りたいときは、公式サイトが一番確かです。",
    list: [
      ["スタートガイド", "動画で、マジックとは何かから順に学べます。", "https://mtg-jp.com/startguide/"],
      ["遊び方", "ゲームの流れと基本ルールの解説。", "https://mtg-jp.com/howtoplay"],
      ["マジックの基礎知識", "カードの種類や用語を調べられます。", "https://mtg-jp.com/startguide/knowledge"],
      ["基本用語集", "分からない言葉を引けます。", "https://mtg-jp.com/startguide/glossary/"],
      ["フォーマット一覧", "構築・リミテッド・チーム戦などの種類。", "https://mtg-jp.com/gameplay/format/"],
      ["ウェルカムデッキ配布店舗", "実際のカードで始めたい方向け。", "https://mtg-jp.com/shop/"]
    ]
  },

  formats: {
    h: "フォーマットって何？",
    lead: "「どのカードを使えるか」「デッキは何枚か」などの取り決めのことです。大きく<b>構築</b>と<b>リミテッド</b>の2種類があります。",
    colH: ["", "構築", "リミテッド"],
    rows: [
      ["カードの入手", "持っているカードから自由に選ぶ", "その場で開けたパックのカードだけ"],
      ["デッキの枚数", "60枚以上（同名カードは4枚まで）", "40枚以上"],
      ["準備", "カードを集める必要がある", "参加費だけで、全員が同じスタート"],
      ["アリーナの例", "スタンダード、エクスプローラー、ヒストリック など", "ドラフト、シールド"],
      ["向いている人", "強いデッキを研究して育てたい", "すぐ始めたい、カードを集めたくない"]
    ],
    note: "どちらにも面白さがあります。このサイトは<b>リミテッド</b>を専門に扱っています。",
    multi: "ほかに、2人1組で戦う<b>双頭巨人戦</b>（チームでライフ30を共有）や、3人以上で遊ぶ<b>コマンダー</b>など、人数の違う遊び方もあります。ただし、アリーナのリミテッドは<b>1対1</b>が基本です。"
  },

  limited: {
    h: "リミテッドとは",
    lead: "開けたパックのカードだけで、その場でデッキを作って戦う遊び方です。みんなが同じ条件で始めるので、カードの持ち数で差がつきません。",
    cols: [
      ["シールド", "6パック分のカードをまとめて開け、そのプールから40枚のデッキを組む。", ["一人で、じっくり組み立てられる", "「どのカードを入れるか」が勝負", "ドラフトより気軽に始められる"]],
      ["ドラフト", "8人で卓を囲み、1パックから1枚ずつ取って隣に回していく（3パック・計42枚をピック）。", ["「何を取るか」の判断力が問われる", "他の人の動きを読むのが面白い", "デッキ作りまで含めて楽しめる"]]
    ],
    tipH: "リミテッドで大切なこと",
    tip: "強いカードを集めるだけでなく、<b>40枚全体のバランス</b>が勝敗を分けます。次の「配分」の目安を知っておくと、迷いません。"
  },

  deck: {
    h: "40枚デッキの配分の目安",
    lead: "迷ったら、まずこの形から始めましょう。",
    bar: [["土地", 17], ["クリーチャー", 17], ["その他の呪文", 6]],
    barNote: "土地16〜17枚、クリーチャー15〜17枚、除去や強化などの呪文6〜8枚が目安です。近年は、土地17・クリーチャー17・呪文6という形を基準に紹介する解説が多く見られます（攻めるデッキは土地16に減らすことも）。",
    curveH: "マナカーブ（土地を除く23枚の目安）",
    curve: [["1", 2], ["2", 6], ["3", 5], ["4", 4], ["5", 3], ["6+", 3]],
    curveNote: "軽いカードを多めにして、重いカードは少なめに。序盤に何も出せない手札事故を防げます。",
    tips: [
      ["🎨", "色は2色までに", "土地は色の枚数に合わせて、たとえば9枚と8枚のように分けます。"],
      ["⚖️", "クリーチャーを十分に", "戦場に出せる味方が少ないと、攻めも守りも苦しくなります。"],
      ["🎯", "除去を忘れずに", "呪文の枠は少ないので、除去は厳選して入れます。除去の力を持つクリーチャーも数えられます。"]
    ]
  },

  removal: {
    h: "リミテッドで「除去」が強い理由",
    lead: "除去とは、相手のクリーチャーを倒したり、動けなくしたりするカードのことです。",
    reasonsH: "なぜ強いのか",
    reasons: [
      ["相手の主役を1枚で止められる", "リミテッドは、相手が大型や空を飛ぶ強いクリーチャーを出してきます。除去があれば、それを1枚で片づけられます。"],
      ["数に限りがある", "1パックに入る除去は数枚だけ。ドラフトでは、早めに取っておくと差がつきます。"],
      ["カードの交換が得になる", "自分の1枚で相手の強い1枚を倒せば、盤面が一気にこちらへ傾きます。"]
    ],
    exH: "除去の例",
    ex: [["Lightning Bolt", "稲妻", "ダメージを与えて倒す（火力）"], ["Pacifism", "平和な心", "攻撃もブロックもできなくする"]],
    rarityH: "レアリティ（めずらしさ）",
    rarityLead: "カードの価値と、強さは別ものです。レアでなくても、強いカードはたくさんあります。",
    rarity: [["コモン", "c", "いちばん多い。デッキの土台"], ["アンコモン", "u", "ふつうより少なめ"], ["レア", "r", "強力なものが多い"], ["神話レア", "m", "最もめずらしい"]],
    dataH: "強いカードを数字で調べる",
    data: "このサイトの<a href=\"../reports.html\">環境レポート</a>では、17Landsの実戦データから、色ごと・レアリティごとのカードの勝率を確認できます。目安にするのは<b>GIH勝率</b>（そのカードが手札か戦場にあった試合の勝率）で、同じセットの中で平均より3ポイントほど高ければ強いカードです。"
  },

  next: {
    h: "次の一歩",
    lead: "ここまで読めば、遊び始める準備は十分です。",
    mtgList: [
      ["リミテッドとは", "このサイトが扱う「リミテッド」を、40枚デッキの組み方まで解説。", "limited.html", true],
      ["MTGアリーナを入れる", "パソコンでもスマートフォンでも、無料で始められます。", "#arena", false]
    ],
    list: [
      ["MTGアリーナを入れる", "パソコンでもスマートフォンでも、無料で始められます。", "index.html#arena", true],
      ["シールドを練習する", "6パック分の仮想パックで、40枚デッキを組む練習。", "../", false],
      ["ドラフトを練習する", "8人卓を再現した仮想ドラフトで、ピックの練習。", "../draft.html", false],
      ["環境レポートを見る", "セットごとの強い色・強いカードを確認。", "../reports.html", false]
    ],
    credit: "カード画像とマナシンボルは Scryfall から読み込んでいます。Magic: The Gathering は Wizards of the Coast LLC の商標です。このサイトは非公式のファンサイトです。"
  },

  glossH: "用語集",
  gloss: [["マナ", "呪文を使うためのエネルギー。土地から出ます。"], ["呪文", "手札から使うカード全般。クリーチャーも呪文の一種です。"], ["戦場", "カードを出して戦う場所。"], ["墓地", "使い終わったカードや倒されたカードが行く場所。"], ["タップ", "カードを横向きにすること。土地を使うとタップされます。"], ["ライフ", "体力のこと。最初は20で、0になると負け。"], ["ブロック", "相手の攻撃を、自分のクリーチャーで受け止めること。"], ["飛行", "飛行を持たないクリーチャーにはブロックされない能力。"]]
};

const EN = {
  pages: {
    mtg: {
      title: "What is Magic: The Gathering? How to play and start on MTG Arena (beginners)",
      desc: "What kind of game Magic: The Gathering is: the five colors, card types and how to read a card, Constructed vs Limited, and how to install MTG Arena on PC and mobile. An illustrated guide for beginners.",
      h1: "What is MTG?",
      lead: "What kind of game Magic: The Gathering is, how to read a card, the formats, and how to start on MTG Arena — at a glance.",
      toc: [["what", "The game"], ["colors", "Five colors"], ["types", "Card types"], ["read", "Reading a card"], ["formats", "Formats"], ["arena", "MTG Arena"], ["official", "Official pages"], ["next", "Next steps"]]
    },
    limited: {
      title: "What is Limited? Sealed and Draft, building a 40-card deck, and why removal is strong (MTG beginners)",
      desc: "What MTG Limited (Sealed and Draft) is: building a deck from the packs you open, a guide to a 40-card deck, the mana curve, why removal is so strong in Limited, and how to find which cards are strong.",
      h1: "What is Limited?",
      lead: "Limited means playing with only the cards from packs you open. Sealed vs Draft, how to build 40 cards, and why removal is strong — on one page.",
      toc: [["limited", "What is Limited"], ["deck", "40-card deck"], ["removal", "Why removal"], ["next", "Next steps"]]
    }
  },

  what: {
    h: "What kind of game is Magic?",
    lead: "A card game usually played one-on-one. The best part is building your own deck.",
    points: [
      ["⚔️", "Usually one-on-one", "Both start at 20 life; bring your opponent to 0 and you win. There are also team formats for pairs, and formats for three or more players."],
      ["🃏", "You build the deck", "Pick the cards you like and put together a deck that is yours."],
      ["🌍", "30+ years and still going", "Created in 1993, with tournaments held all over the world."]
    ],
    flowH: "One turn at a glance",
    flow: [["Untap", "Ready the cards you used last turn"], ["Draw", "Draw one card"], ["Play", "Play a land, then spend mana on spells and creatures"], ["Attack", "Attack with your creatures"], ["End", "Pass the turn"]],
    flowNote: "<b>Lands</b> produce mana, the energy you spend on spells. You can play only one land per turn, so you can cast bigger cards as the game goes on."
  },

  colors: {
    h: "Five colors, five ways to play",
    lead: "Cards come in five colors, and each color is good at different things. Most decks use one or two.",
    list: [
      ["W", "White", "Order and protection", "Many small allies, flying creatures and life gain make for a sturdy game."],
      ["U", "Blue", "Knowledge and control", "Counter spells, draw cards and fly over the board."],
      ["B", "Black", "Sacrifice and removal", "Lots of ways to destroy creatures, often at a cost to you."],
      ["R", "Red", "Speed and fire", "Damage spells that hit creatures or your opponent directly."],
      ["G", "Green", "Size and growth", "Big creatures and extra mana. Win by being bigger."]
    ],
    note: "There are also <b>colorless</b> cards (artifacts, for example) that fit in any deck."
  },

  types: {
    h: "Card types",
    lead: "These seven cover most of what you will see. The images are examples for illustration and may not be playable in Arena today.",
    list: [
      ["Serra Angel", "Serra Angel", "Creature", "A being that fights on the battlefield. It attacks, and it blocks."],
      ["Lightning Bolt", "Lightning Bolt", "Instant", "A spell you can cast almost any time, even on your opponent's turn. It is used up once cast."],
      ["Wrath of God", "Wrath of God", "Sorcery", "A spell you can cast only on your own turn, in your main phase. Often big effects."],
      ["Pacifism", "Pacifism", "Enchantment", "An effect that stays on the battlefield. This one stops a creature from fighting."],
      ["Sol Ring", "Sol Ring", "Artifact", "A permanent like a tool. Many are colorless and go in any deck."],
      ["Chandra, Torch of Defiance", "Chandra, Torch of Defiance", "Planeswalker", "A powerful mage on your side. Use an ability each turn; attacks wear her down."],
      ["Forest", "Forest", "Land", "Makes mana — the foundation of your deck. About 40% of a deck is lands."]
    ]
  },

  read: {
    h: "How to read a card",
    lead: "Once you know the numbers and symbols, you can judge a card you have never seen.",
    items: [
      ["1", "Name"],
      ["2", "Mana cost (what you pay to cast it)"],
      ["3", "Art"],
      ["4", "Type (Creature, etc.)"],
      ["5", "Rules text (abilities)"],
      ["6", "Power / Toughness (attack / health)"]
    ],
    costH: "Reading the mana cost",
    costBody: `Serra Angel costs <span class="cost">${SYM("3")}${SYM("W")}${SYM("W")}</span>: <b>two white mana plus three mana of any color</b>, five in total. A number means "any color", a colored symbol means mana of that color from your lands.`,
    ptBody: "<b>4/4</b> means it deals 4 damage and is destroyed by 4 damage."
  },

  arena: {
    h: "Starting on MTG Arena",
    lead: "The official digital version of Magic. It runs on <b>PC (Windows and Mac) and on phones and tablets (iPhone, iPad and Android)</b>, and it is free to play to start. Your account works across PC and mobile.",
    installH: "Install it",
    install: [["💻", "PC (Windows / Mac)", "Official page", "https://magic.wizards.com/en/mtgarena"], ["📱", "iPhone / iPad", "App Store", "https://apps.apple.com/app/id1496227521"], ["📱", "Android", "Google Play", "https://play.google.com/store/apps/details?id=com.wizards.mtga&hl=en_US"]],
    installNote: "Check the official page and the store listing for supported devices and storage. The practice tools on this site work on a phone; the helper tools that read Arena's log are PC only.",
    stepsH: "Your first steps",
    steps: [["Install", "Get the app with the buttons above and create an account."], ["Tutorial", "The game teaches you the rules step by step."], ["Color Challenge", "Try free decks in each of the five colors."], ["Pick a mode", "Play matches, Draft, Sealed and more."]],
    why: [
      ["Rules handled for you", "The app resolves the hard parts, so you learn as you play."],
      ["Always an opponent", "Play people around the world whenever you like."],
      ["Earn as you play", "Gold earned in game buys packs and event entries."]
    ],
    moneyH: "Words worth knowing",
    money: [["Gold", "In-game money you earn by playing."], ["Gems", "Money you can buy. Sometimes usable instead of gold."], ["Wildcards", "Tickets you trade for the cards of your choice."]]
  },

  official: {
    h: "Learn more on the official site",
    lead: "For the full rules and terms, the official site is the most reliable place.",
    list: [
      ["What is Magic?", "An introduction from Wizards of the Coast.", "https://magic.wizards.com/en/intro"],
      ["How to play", "The flow of a game and the basic rules.", "https://magic.wizards.com/en/how-to-play"],
      ["MTG Arena", "The official page, with downloads.", "https://magic.wizards.com/en/mtgarena"],
      ["Getting started on Arena", "The official step-by-step start.", "https://magic.wizards.com/en/mtgarena/getting-started"]
    ]
  },

  formats: {
    h: "What is a format?",
    lead: "A format is a set of rules on which cards you may use and how many cards the deck holds. There are two big families: <b>Constructed</b> and <b>Limited</b>.",
    colH: ["", "Constructed", "Limited"],
    rows: [
      ["Your cards", "Anything in your collection", "Only the packs you open on the spot"],
      ["Deck size", "60+ cards (max 4 copies of a card)", "40+ cards"],
      ["Preparation", "You need to collect cards", "Just the entry fee; everyone starts equal"],
      ["On Arena", "Standard, Explorer, Historic, etc.", "Draft, Sealed"],
      ["Good if you", "Want to research and refine strong decks", "Want to start now without collecting"]
    ],
    note: "Both are fun. This site focuses on <b>Limited</b>.",
    multi: "There are also formats with a different number of players, such as <b>Two-Headed Giant</b> (pairs share 30 life) and <b>Commander</b> (three or more). Limited on Arena, though, is <b>one-on-one</b>."
  },

  limited: {
    h: "What is Limited?",
    lead: "You build a deck on the spot, using only the cards from packs you open. Everyone starts on equal footing, so a bigger collection does not decide the game.",
    cols: [
      ["Sealed", "Open six packs at once and build a 40-card deck from that pool.", ["Build calmly, on your own", "Deck-building is the skill", "An easier way to start than Draft"]],
      ["Draft", "Eight players sit in a pod, take one card from a pack and pass it on (three packs, 42 picks).", ["Tests what you choose to take", "Reading the others is half the fun", "Includes building the deck too"]]
    ],
    tipH: "What matters in Limited",
    tip: "It is not only about collecting strong cards; the <b>balance of all 40</b> decides games. The guide below keeps you from guessing."
  },

  deck: {
    h: "A 40-card deck, at a glance",
    lead: "When unsure, start from this shape.",
    bar: [["Lands", 17], ["Creatures", 17], ["Other spells", 6]],
    barNote: "A rough guide: 16–17 lands, 15–17 creatures, and 6–8 spells such as removal and tricks. Many current guides use 17 lands, 17 creatures and 6 spells as the baseline (aggressive decks may drop to 16 lands).",
    curveH: "Mana curve (a guide for the 23 non-land cards)",
    curve: [["1", 2], ["2", 6], ["3", 5], ["4", 4], ["5", 3], ["6+", 3]],
    curveNote: "Lots of cheap cards, fewer expensive ones. You avoid hands that do nothing early.",
    tips: [
      ["🎨", "Two colors at most", "Split your lands to match, for example 9 and 8."],
      ["⚖️", "Enough creatures", "Too few and you struggle both to attack and to defend."],
      ["🎯", "Don't forget removal", "With few spell slots, choose your removal carefully. Creatures that act as removal count too."]
    ]
  },

  removal: {
    h: "Why removal is so strong in Limited",
    lead: "Removal is any card that destroys a creature or stops it from fighting.",
    reasonsH: "Why it is strong",
    reasons: [
      ["One card answers their best", "Opponents will play big or flying creatures. Removal deals with them with one card."],
      ["There is only a little of it", "A pack has just a few removal spells. In Draft, taking them early makes a difference."],
      ["It is a good trade", "One card of yours for one strong card of theirs swings the board your way."]
    ],
    exH: "Examples",
    ex: [["Lightning Bolt", "Lightning Bolt", "Deals damage to destroy a creature (burn)"], ["Pacifism", "Pacifism", "Stops a creature from attacking or blocking"]],
    rarityH: "Rarity",
    rarityLead: "Rarity is not the same as strength. Plenty of commons are very strong.",
    rarity: [["Common", "c", "Most plentiful; the backbone of a deck"], ["Uncommon", "u", "Less frequent"], ["Rare", "r", "Often powerful"], ["Mythic rare", "m", "The rarest"]],
    dataH: "Checking which cards are strong",
    data: "The <a href=\"../reports.en.html\">set reports</a> on this site show card win rates by color and rarity from 17Lands data. Look at <b>GIH WR</b> (win rate in games where the card was in hand or on the battlefield); about 3 points above the set average is a strong card."
  },

  next: {
    h: "Next steps",
    lead: "You now have enough to get started.",
    mtgList: [
      ["What is Limited?", "The format this site covers, down to how to build 40 cards.", "limited.en.html", true],
      ["Install MTG Arena", "Free to start, on PC or your phone.", "#arena", false]
    ],
    list: [
      ["Install MTG Arena", "Free to start, on PC or your phone.", "index.en.html#arena", true],
      ["Practice Sealed", "Build a 40-card deck from six virtual packs.", "../", false],
      ["Practice Draft", "Practice picking in a simulated eight-player pod.", "../draft.html", false],
      ["Read the set reports", "See the strong colors and cards for each set.", "../reports.html", false]
    ],
    credit: "Card images and mana symbols are loaded from Scryfall. Magic: The Gathering is a trademark of Wizards of the Coast LLC. This is an unofficial fan site."
  },

  glossH: "Glossary",
  gloss: [["Mana", "The energy you spend on spells, produced by lands."], ["Spell", "Any card you cast from hand. Creatures are spells too."], ["Battlefield", "Where cards are played and fight."], ["Graveyard", "Where used or destroyed cards go."], ["Tap", "Turning a card sideways. Using a land taps it."], ["Life", "Your health. You start at 20; at 0 you lose."], ["Block", "Stopping an attacker with one of your creatures."], ["Flying", "Can't be blocked by creatures without flying."]]
};

const JS_JA = String.raw`
<script>
/* 日本語ページでは、Scryfall に日本語版の印刷があればその画像に差し替える（無ければ英語のまま） */
(function(){
  var boxes = [].slice.call(document.querySelectorAll(".cimg[data-name]"));
  var done = {};
  function pickImg(c){
    if(c.image_uris) return c.image_uris.normal;
    if(c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) return c.card_faces[0].image_uris.normal;
    return null;
  }
  function next(i){
    if(i >= boxes.length) return;
    var box = boxes[i], name = box.getAttribute("data-name");
    var apply = function(url){ if(!url) return; [].slice.call(document.querySelectorAll('.cimg[data-name="' + name.replace(/"/g, '\\"') + '"] img')).forEach(function(im){ im.src = url; }); };
    if(done[name] !== undefined){ next(i + 1); return; }
    done[name] = null;
    var q = '!"' + name + '" lang:ja';
    fetch("https://api.scryfall.com/cards/search?unique=prints&order=released&dir=desc&q=" + encodeURIComponent(q))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        var list = (d && d.data) || [];
        for(var k = 0; k < list.length; k++){ var u = pickImg(list[k]); if(u){ done[name] = u; apply(u); break; } }
      })
      .catch(function(){})
      .then(function(){ setTimeout(function(){ next(i + 1); }, 120); });
  }
  next(0);
})();
</script>`;

/* ------------------------------------------------------------------ 本体 */

const css = `<style>
  html{scroll-behavior:smooth}
  main{max-width:960px}
  .toc{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 22px;padding:0;list-style:none;position:sticky;top:0;z-index:20;background:rgba(245,248,252,.94);backdrop-filter:blur(6px);padding:8px 0;border-bottom:1px solid var(--line)}
  .toc a{display:inline-block;font-size:12.5px;padding:5px 11px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--ink);text-decoration:none;white-space:nowrap}
  .toc a:hover{border-color:var(--gold);color:var(--gold)}
  .blk{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:0 0 22px;scroll-margin-top:60px}
  .blk > h2{font-size:22px;margin:0 0 6px}
  .blk > .lead{margin:0 0 14px;color:var(--muted);font-size:14px}
  .cards3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .pt{background:var(--paper-2);border-radius:10px;padding:14px 16px}
  .pt .ic{font-size:26px;line-height:1}
  .pt b{display:block;margin:6px 0 2px;font-size:15px}
  .pt p{margin:0;font-size:13.5px;line-height:1.65}
  h3.sub{font-size:15px;margin:20px 0 8px}
  .flow{list-style:none;margin:0;padding:0;display:flex;gap:6px;flex-wrap:wrap;counter-reset:f}
  .flow li{flex:1 1 140px;position:relative;background:var(--pine);color:#fff;border-radius:10px;padding:10px 12px 10px 38px;font-size:12.5px;line-height:1.5;counter-increment:f}
  .flow li::before{content:counter(f);position:absolute;left:10px;top:10px;width:20px;height:20px;border-radius:50%;background:var(--gold);color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
  .flow li b{display:block;font-size:14px;color:#9CC8FF}
  .note{margin:12px 0 0;font-size:13.5px;background:var(--paper-2);border-left:4px solid var(--gold);padding:9px 13px;border-radius:0 8px 8px 0}
  .colors{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
  .col{border-radius:10px;padding:12px 14px;border:2px solid;background:#fff}
  .col .nm{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px}
  .col .nm img{width:30px;height:30px}
  .col .tg{font-size:12px;color:var(--muted);margin:2px 0 6px}
  .col p{margin:0;font-size:13px;line-height:1.65}
  .col.W{border-color:#E7D9A8;background:#FFFBEF}.col.U{border-color:#8DBBDE;background:#F1F8FD}.col.B{border-color:#8D8795;background:#F4F2F6}.col.R{border-color:#E39A86;background:#FFF3EF}.col.G{border-color:#86B58C;background:#F1F9F2}
  .types{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:16px 14px}
  .ty{display:flex;flex-direction:column;gap:8px}
  .ty .cimg{max-width:200px}
  .ty .tn{font-weight:800;font-size:14.5px}
  .ty .tn small{display:block;font-weight:500;color:var(--muted);font-size:11.5px}
  .ty p{margin:0;font-size:12.5px;line-height:1.6}
  .cimg{position:relative;display:block;aspect-ratio:488/680;border-radius:4.5%;overflow:hidden;background:var(--paper-2);box-shadow:0 8px 20px -10px rgba(13,27,42,.55)}
  .cimg img{width:100%;height:100%;display:block;object-fit:cover}
  .cimg i{display:none;position:absolute;inset:0;padding:12px;font-style:normal;font-weight:700;font-size:13px;color:var(--muted);align-items:center;justify-content:center;text-align:center}
  .cimg.miss img{display:none}.cimg.miss i{display:flex}
  .anat{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:24px;align-items:start}
  .anat .cardwrap{position:relative}
  .badge{position:absolute;width:24px;height:24px;border-radius:50%;background:var(--gold);color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.45);transform:translate(-50%,-50%);border:2px solid #fff}
  .anat ol{list-style:none;margin:0 0 14px;padding:0}
  .anat ol li{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--paper-2);font-size:14px}
  .anat ol li span{flex:none;width:22px;height:22px;border-radius:50%;background:var(--gold);color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
  .ms{vertical-align:middle;margin:0 1px}
  .cost{display:inline-block;background:var(--paper-2);padding:2px 8px;border-radius:999px}
  .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
  .box{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .box h3{margin:0 0 6px;font-size:16px}
  .box ul{margin:8px 0 0;padding-left:1.2em;font-size:13.5px}
  .steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;counter-reset:s}
  .steps li{background:var(--paper-2);border-radius:10px;padding:12px 14px 12px;counter-increment:s;font-size:13px;line-height:1.6}
  .steps li b{display:block;font-size:14.5px;margin-bottom:2px}
  .steps li::before{content:counter(s);display:inline-flex;width:22px;height:22px;border-radius:50%;background:var(--gold);color:#fff;font-weight:800;font-size:12px;align-items:center;justify-content:center;margin-bottom:6px}
  .cmp{width:100%;border-collapse:collapse;font-size:13.5px}
  .cmp th,.cmp td{padding:9px 10px;border-bottom:1px solid var(--paper-2);text-align:left;vertical-align:top}
  .cmp thead th{font-size:13px;color:#fff;background:var(--pine)}
  .cmp thead th:last-child{background:var(--gold)}
  .cmp tbody th{width:22%;color:var(--muted);font-weight:500;font-size:12.5px}
  .stack{display:flex;height:54px;border-radius:10px;overflow:hidden;font-weight:800;color:#fff;font-size:13px}
  .stack div{display:flex;align-items:center;justify-content:center;flex-direction:column;line-height:1.25;text-align:center;padding:0 4px}
  .stack div b{font-size:19px}
  .stack .s0{background:#7C6F5A}.stack .s1{background:var(--pine)}.stack .s2{background:var(--gold)}
  .curve{display:flex;align-items:flex-end;gap:10px;height:170px;padding:26px 4px 0;border-bottom:2px solid var(--line)}
  .curve div{flex:1;background:var(--gold);border-radius:6px 6px 0 0;position:relative;min-height:6px}
  .curve div b{position:absolute;top:-22px;left:0;right:0;text-align:center;font-size:13px}
  .curvelab{display:flex;gap:10px;padding:4px 4px 0;font-size:12px;color:var(--muted)}
  .curvelab span{flex:1;text-align:center}
  .rarg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:0}
  .rarg div{border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12.5px;background:#fff}
  .rarg b{display:flex;align-items:center;gap:7px;font-size:14px;margin-bottom:2px}
  .rarg b::before{content:"";width:12px;height:12px;border-radius:50%;background:#2A3B4C}
  .rarg .u b::before{background:#9DB0BC}.rarg .r b::before{background:#C9A227}.rarg .m b::before{background:#D8572A}
  .exs{display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 0}
  .exs figure{margin:0;width:150px}
  .exs figcaption{font-size:12.5px;margin-top:6px;line-height:1.5}
  .exs figcaption b{display:block}
  .cta{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
  .cta a{display:block;background:var(--paper-2);border:1px solid var(--line);border-radius:10px;padding:13px 15px;text-decoration:none;color:var(--ink)}
  .cta a:hover{border-color:var(--gold)}
  .cta a b{display:block;font-size:15px;color:var(--pine);margin-bottom:2px}
  .cta a small{font-size:12.5px;color:var(--muted);line-height:1.5}
  .cta a.main{background:var(--gold);border-color:var(--gold)}
  .cta a.main b,.cta a.main small{color:#fff}
  .inst{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:0 0 4px}
  .inst a{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;background:var(--gold);color:#fff;text-decoration:none;border-radius:12px;padding:14px 12px;box-shadow:0 6px 16px -10px rgba(47,125,246,.9)}
  .inst a:hover{background:#1F6AE0}
  .inst .ii{font-size:24px;line-height:1.1}
  .inst b{font-size:14.5px}
  .inst small{font-size:12px;opacity:.9}
  .more{font-size:13px;margin:14px 0 0;padding-left:1.2em}
  .more a,.blk p a{color:var(--pine)}
  details.gl{margin:0 0 22px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 20px}
  details.gl summary{cursor:pointer;font-weight:800;font-size:16px}
  details.gl dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:12px 0 0;font-size:13.5px}
  details.gl dt{font-weight:700}details.gl dd{margin:0;color:var(--muted)}
  .credit{font-size:11.5px;color:var(--muted);margin:8px 0 0}
  @media (max-width:720px){
    .blk{padding:16px 14px}.anat{grid-template-columns:1fr}.anat .cardwrap{width:100%;max-width:280px;margin:0 auto}
    .toc{position:static;flex-wrap:nowrap;overflow-x:auto}
    .cmp tbody th{width:28%}
    .types{grid-template-columns:repeat(2,1fr);gap:16px 10px}
  }
</style>`;

function page(lang, kind){
  const T = lang === "ja" ? JA : EN;
  const en = lang === "en";
  const P = T.pages[kind];
  const base = kind === "mtg" ? "index" : "limited";
  const self = `${base}${en ? ".en" : ""}.html`;
  const canonical = `${SITE}/start/${self}`;
  const head = `<title>${esc(P.title)}</title>
<meta name="description" content="${esc(P.desc)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${SITE}/start/${base}.html">
<link rel="alternate" hreflang="en" href="${SITE}/start/${base}.en.html">
<meta property="og:title" content="${esc(P.title)}">
<meta property="og:description" content="${esc(P.desc)}">
<meta property="og:url" content="${canonical}">
${css}`;
  const header = `    <h1>${esc(P.h1)}</h1>
    <p>${esc(P.lead)}</p>`;

  const w = T.what, c = T.colors, ty = T.types, r = T.read, a = T.arena, f = T.formats, l = T.limited, d = T.deck, rm = T.removal, n = T.next, of = T.official;
  const S = {};

  S.what = `<section class="blk" id="what"><h2>${w.h}</h2><p class="lead">${w.lead}</p>
<div class="cards3">${w.points.map(p => `<div class="pt"><span class="ic">${p[0]}</span><b>${p[1]}</b><p>${p[2]}</p></div>`).join("")}</div>
<h3 class="sub">${w.flowH}</h3>
<ol class="flow">${w.flow.map(s => `<li><b>${s[0]}</b>${s[1]}</li>`).join("")}</ol>
<p class="note">${w.flowNote}</p></section>`;

  S.colors = `<section class="blk" id="colors"><h2>${c.h}</h2><p class="lead">${c.lead}</p>
<div class="colors">${c.list.map(x => `<div class="col ${x[0]}"><div class="nm">${SYM(x[0]).replace('width="22" height="22"', 'width="30" height="30"')}${x[1]}</div><div class="tg">${x[2]}</div><p>${x[3]}</p></div>`).join("")}</div>
<p class="note">${c.note}</p></section>`;

  S.types = `<section class="blk" id="types"><h2>${ty.h}</h2><p class="lead">${ty.lead}</p>
<div class="types">${ty.list.map(x => `<div class="ty">${card(x[0])}<div class="tn">${x[2]}<small>${en ? x[1] : x[1] + "（" + x[0] + "）"}</small></div><p>${x[3]}</p></div>`).join("")}</div></section>`;

  const badges = [[11, 5.8], [88, 5.8], [50, 30], [11, 57.5], [50, 74], [89, 92.5]];
  S.read = `<section class="blk" id="read"><h2>${r.h}</h2><p class="lead">${r.lead}</p>
<div class="anat"><div class="cardwrap">${card("Serra Angel")}${badges.map((b, i) => `<span class="badge" style="left:${b[0]}%;top:${b[1]}%">${i + 1}</span>`).join("")}</div>
<div><ol>${r.items.map(x => `<li><span>${x[0]}</span>${x[1]}</li>`).join("")}</ol>
<h3 class="sub" style="margin-top:6px">${r.costH}</h3><p style="margin:0 0 8px">${r.costBody}</p><p style="margin:0">${r.ptBody}</p></div></div></section>`;

  S.formats = `<section class="blk" id="formats"><h2>${f.h}</h2><p class="lead">${f.lead}</p>
<table class="cmp"><thead><tr>${f.colH.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${f.rows.map(x => `<tr><th>${x[0]}</th><td>${x[1]}</td><td>${x[2]}</td></tr>`).join("\n")}</tbody></table>
<p class="note">${f.multi}</p><p class="note">${f.note}</p></section>`;

  S.arena = `<section class="blk" id="arena"><h2>${a.h}</h2><p class="lead">${a.lead}</p>
<h3 class="sub" style="margin-top:6px">${a.installH}</h3>
<div class="inst">${a.install.map(x => `<a href="${x[3]}" target="_blank" rel="noopener"><span class="ii">${x[0]}</span><b>${x[1]}</b><small>${x[2]}</small></a>`).join("")}</div>
<p class="note">${a.installNote}</p>
<h3 class="sub">${a.stepsH}</h3>
<ol class="steps">${a.steps.map(s => `<li><b>${s[0]}</b>${s[1]}</li>`).join("")}</ol>
<div class="cards3" style="margin-top:16px">${a.why.map(p => `<div class="pt"><b>${p[0]}</b><p>${p[1]}</p></div>`).join("")}</div>
<h3 class="sub">${a.moneyH}</h3>
<div class="cards3">${a.money.map(p => `<div class="pt"><b>${p[0]}</b><p>${p[1]}</p></div>`).join("")}</div></section>`;

  S.official = `<section class="blk" id="official"><h2>${of.h}</h2><p class="lead">${of.lead}</p>
<div class="cta">${of.list.map(x => `<a href="${x[2]}" target="_blank" rel="noopener"><b>${x[0]} ↗</b><small>${x[1]}</small></a>`).join("")}</div></section>`;

  S.limited = `<section class="blk" id="limited"><h2>${l.h}</h2><p class="lead">${l.lead}</p>
<div class="two">${l.cols.map(x => `<div class="box"><h3>${x[0]}</h3><p style="margin:0;font-size:13.5px">${x[1]}</p><ul>${x[2].map(i => `<li>${i}</li>`).join("")}</ul></div>`).join("")}</div>
<p class="note"><b>${l.tipH}</b>　${l.tip}</p></section>`;

  const total = d.bar.reduce((s, x) => s + x[1], 0), maxC = Math.max(...d.curve.map(x => x[1]));
  S.deck = `<section class="blk" id="deck"><h2>${d.h}</h2><p class="lead">${d.lead}</p>
<div class="stack">${d.bar.map((x, i) => `<div class="s${i}" style="width:${(x[1] / total * 100).toFixed(1)}%"><b>${x[1]}</b>${x[0]}</div>`).join("")}</div>
<p style="font-size:13px;color:var(--muted);margin:8px 0 18px">${d.barNote}</p>
<h3 class="sub">${d.curveH}</h3>
<div class="curve">${d.curve.map(x => `<div style="height:${Math.round(x[1] / maxC * 100)}%"><b>${x[1]}</b></div>`).join("")}</div>
<div class="curvelab">${d.curve.map(x => `<span>${x[0]}${en ? " mana" : "マナ"}</span>`).join("")}</div>
<p style="font-size:13px;color:var(--muted);margin:8px 0 14px">${d.curveNote}</p>
<div class="cards3">${d.tips.map(p => `<div class="pt"><span class="ic">${p[0]}</span><b>${p[1]}</b><p>${p[2]}</p></div>`).join("")}</div></section>`;

  S.removal = `<section class="blk" id="removal"><h2>${rm.h}</h2><p class="lead">${rm.lead}</p>
<h3 class="sub" style="margin-top:6px">${rm.reasonsH}</h3>
<div class="cards3">${rm.reasons.map((p, i) => `<div class="pt"><span class="ic">${["①", "②", "③"][i]}</span><b>${p[0]}</b><p>${p[1]}</p></div>`).join("")}</div>
<h3 class="sub">${rm.exH}</h3>
<div class="exs">${rm.ex.map(x => `<figure>${card(x[0])}<figcaption><b>${x[1]}</b>${x[2]}</figcaption></figure>`).join("")}</div>
<h3 class="sub">${rm.rarityH}</h3><p style="margin:0 0 8px;font-size:13.5px">${rm.rarityLead}</p>
<div class="rarg">${rm.rarity.map(x => `<div class="${x[1]}"><b>${x[0]}</b>${x[2]}</div>`).join("")}</div>
<h3 class="sub">${rm.dataH}</h3><p style="margin:0;font-size:14px">${rm.data.replace(/href="\.\.\/reports(\.en)?\.html"/, `href="../reports.html"`)}</p></section>`;

  const nextList = kind === "mtg" ? n.mtgList : n.list;
  S.next = `<section class="blk" id="next"><h2>${n.h}</h2><p class="lead">${n.lead}</p>
<div class="cta">${nextList.map(x => `<a class="${x[3] ? "main" : ""}" href="${x[2]}"><b>${x[0]}</b><small>${x[1]}</small></a>`).join("")}</div>
<p class="credit">${n.credit}</p></section>`;

  const order = kind === "mtg"
    ? ["what", "colors", "types", "read", "formats", "arena", "official", "next"]
    : ["limited", "deck", "removal", "next"];

  const gloss = `<details class="gl"><summary>${T.glossH}</summary><dl>${T.gloss.map(x => `<dt>${x[0]}</dt><dd>${x[1]}</dd>`).join("")}</dl></details>`;
  const toc = `<ul class="toc">${P.toc.map(x => `<li><a href="#${x[0]}">${x[1]}</a></li>`).join("")}</ul>`;
  const main = `${toc}\n${order.map(k => S[k]).join("\n")}\n${kind === "mtg" ? gloss : ""}${en ? "" : JS_JA}`;

  return shell(lang, base, head, { header, main });
}

await mkdir("start", { recursive: true });
for(const kind of ["mtg", "limited"]){
  for(const lang of ["ja", "en"]){
    const base = kind === "mtg" ? "index" : "limited";
    await writeFile(`start/${base}${lang === "en" ? ".en" : ""}.html`, page(lang, kind), "utf8");
  }
}
console.log("入門ページを作りました: start/index(.en).html（MTGとは）, start/limited(.en).html（リミテッドとは）");
