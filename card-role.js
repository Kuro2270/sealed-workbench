/* カードの文面（Scryfall の英語のオラクル）から、デッキの中での役割（除去か、クリーチャーを出す呪文か）を決める。役割はこれだけ。
   ドラフト補助・シールド補助が、デッキ案とピックで、除去の枚数とクリーチャー枠の枚数を数えるために使う。

   除去とみなすもの（相手のクリーチャーを、戦場から取り除くか、戦力として働かなくするもの）
     ・破壊・追放：destroy / exile target creature（土地以外のパーマネント なども）、すべてのクリーチャー
     ・ダメージ：target creature・any target・each creature に与えるダメージ（パワーに等しい、割り振る、も含む）
     ・格闘・噛みつき：fight
     ・−2/−2 以上の修整、−1/−1 カウンター2個以上
     ・生け贄の強要：opponent sacrifices a creature
     ・平和な心のようなオーラ：攻撃もブロックもできない、能力を失う
     ・タップしてアンタップさせないもの：doesn't untap during its controller's untap step（「次の」アンタップ・ステップだけのものは含めない）
   除去とみなさないもの：手札に戻す（バウンス）、墓地のカードの追放、自分のクリーチャーを対象にするもの、打ち消し

   クリーチャーを出す呪文：自分でクリーチャー・トークンを生み出すもの（「Create two 1/1 ... creature tokens」）。
     クリーチャー枠として数える。相手が生み出すもの（「Its controller creates ...」）は含めない

   CardRole.removal(text)        … 文面（両面・出来事などは各面をつないだもの）が除去なら true
   CardRole.makesCreatures(text) … 自分でクリーチャー・トークンを生み出すなら true
   CardRole.textOf(c)            … Scryfall のカードから、各面の文面をつないで返す */
const CardRole = (() => {
  const CRE = "(?:creature|nonland permanent|permanent)";   // プレインズウォーカーだけを対象にするものは含めない
  /* 「target creature」のあとに続くと、相手のクリーチャーではなくなる言い回し */
  const NOT_THEIRS = "(?!\\s+(?:card|cards|you control|spell))";
  const TGT = `(?:up to (?:one|two|three|\\w+) )?(?:another |other )?target (?:[\\w-]+ ){0,3}?${CRE}s?${NOT_THEIRS}`;
  const RULES = [
    // 破壊・追放
    new RegExp(`\\b(?:destroy|exile)s? ${TGT}`, "i"),
    /\b(?:destroy|exile) (?:all|each) (?:other )?(?:[\w-]+ )?creatures?\b/i,
    // ダメージ（数字・X・それに等しい）
    new RegExp(`\\bdeals? (?:\\d+|x|that much|twice that much) damage to (?:any target|${TGT}|each (?:other )?creature)`, "i"),
    new RegExp(`\\bdeals? damage equal to [^.]*? to (?:any target|${TGT}|each (?:other )?creature)`, "i"),
    /\bdeals? (?:\d+|x) damage divided as you choose among\b/i,
    // 格闘
    /\bfights? (?:up to one )?(?:another )?target creature/i,
    /\btarget creature you control and (?:up to one )?target creature[^.]*\bfight each other/i,
    // −N/−N（N は2以上か X）、−1/−1 カウンターを2個以上
    /\bgets? -(?:[2-9]|\d{2,}|x)\/-(?:[2-9]|\d{2,}|x)\b/i,
    /\bput (?:two|three|four|five|six|x|[2-9]) -1\/-1 counters on (?:up to one )?target creature/i,
    // 生け贄の強要
    /\b(?:target|each) opponent sacrifices (?:a|an|one|two) (?:[\w-]+ )?(?:creature|nonland permanent|permanent)/i,
    // 平和な心のようなオーラ
    /\benchanted creature can't attack or block\b/i,
    /\benchanted creature can't attack, block\b/i,
    /\benchanted creature loses all abilities\b/i,
    // タップしてアンタップさせない（「次の」アンタップ・ステップだけのものは含めない）
    /\bdoesn't untap during its controller's untap step\b/i
  ];
  function removal(text){
    const s = String(text || "").replace(/\u2212/g, "-");     // −（マイナス記号）を - にそろえる
    return RULES.some(re => re.test(s));
  }
  /* 命令形の「create」（文の頭・「,」「:」のあと・then のあと）だけを見る。「creates」は相手や別の条件で生まれるもの */
  const TOKEN = /(?:^|[.:\n]\s*|,\s*|\bthen\s+)create (?:a|an|one|two|three|four|five|six|x|that many|\d+) [^.\n]*?\bcreature tokens?\b/i;
  function makesCreatures(text){ return TOKEN.test(String(text || "")); }
  function textOf(c){
    if(!c) return "";
    const faces = (c.card_faces || []).map(f => f.oracle_text || "").filter(Boolean);
    return faces.length ? faces.join("\n") : (c.oracle_text || "");
  }
  return { removal, makesCreatures, textOf };
})();
if(typeof module !== "undefined") module.exports = CardRole;
