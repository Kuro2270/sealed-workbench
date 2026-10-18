/* カードの文面（Scryfall の英語のオラクル）から、デッキの中での役割（除去・半除去・クリーチャーを出す呪文）を決める。役割はこれだけ。
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
   色限定の除去（「緑か青のクリーチャー」だけを対象にできるもの）は、除去に数えない（narrow）。
     1本勝負では相手の色が合わなければ何もできず、3本勝負でもサイドに回すカードのため。
     「黒でないクリーチャー」のような、1色を除くだけのものは、ふつうの除去のまま

   半除去（完全な除去ではないが、除去が足りないときの埋め合わせになるもの）。除去でないカードだけを見る
     ・trick（巨大化）：インスタントで、クリーチャーに +N/+M（合わせて3以上か X）や、先制攻撃・接死・破壊不能を与えるもの。
       戦闘で相手のクリーチャーを討ち取れるので、疑似的な除去になる
     ・shrink（縮小）：クリーチャーの基本のパワー・タフネスを 1/1 などにするもの。戦闘で大きいクリーチャーを討ち取れる
     ・blunt（パワーを下げる）：インスタントで、クリーチャーに −3/−0 以上（か −X/−0）を与えるもの。戦闘で相手の攻撃・ブロックを空振りさせる。
       巨大化・縮小より使いどころが限られる
     ・bounce（バウンス）：相手のクリーチャーなどを手札（またはライブラリーの上）に戻すもの。トークンには除去、それ以外にもテンポを取れる
   クリーチャーを出す呪文：自分でクリーチャー・トークンを生み出すもの（「Create two 1/1 ... creature tokens」）。
     クリーチャー枠として数える。相手が生み出すもの（「Its controller creates ...」）は含めない

   CardRole.removal(text)        … 文面（両面・出来事などは各面をつないだもの）が除去なら true
   CardRole.narrow(text)         … 色限定の除去なら true（removal は false になる）
   CardRole.soft(text, type)     … 半除去なら "trick"・"shrink"・"blunt"・"bounce"、そうでなければ ""（type はタイプ行。巨大化はインスタントに限る）
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
  const COLOR = "(?:white|blue|black|red|green)";
  const NARROW = [
    new RegExp(`\\btarget (?:[\\w-]+ )?${COLOR}(?:,? (?:or|and) ${COLOR})* (?:[\\w-]+ )?(?:creature|permanent|planeswalker)`, "i"),
    new RegExp(`\\btarget [^.]*?(?:creature|permanent|planeswalker)[^.]*?\\bthat's ${COLOR}`, "i")
  ];
  const norm = text => String(text || "").replace(/\u2212/g, "-");   // −（マイナス記号）を - にそろえる
  const anyRemoval = s => RULES.some(re => re.test(s));
  function narrow(text){
    const s = norm(text);
    return anyRemoval(s) && NARROW.some(re => re.test(s));
  }
  function removal(text){
    const s = norm(text);
    return anyRemoval(s) && !NARROW.some(re => re.test(s));
  }
  /* 命令形の「create」（文の頭・「,」「:」のあと・then のあと）だけを見る。「creates」は相手や別の条件で生まれるもの */
  const TOKEN = /(?:^|[.:\n]\s*|,\s*|\bthen\s+)create (?:a|an|one|two|three|four|five|six|x|that many|\d+) [^.\n]*?\bcreature tokens?\b/i;
  function makesCreatures(text){ return TOKEN.test(String(text || "")); }
  /* 巨大化：+N/+M を数字で読む（X を含むものも巨大化とみなす） */
  const PUMP = /\btarget creature (?:you control )?gets? \+(\d+|x)\/\+(\d+|x)/i;
  const GRANT = /\btarget creature (?:you control )?(?:gets? [^.]*?and )?gains? [^.]*?\b(?:first strike|double strike|deathtouch|indestructible)\b/i;
  const BOUNCE = new RegExp(`\\b(?:return|put) (?:up to one )?(?:another )?target (?:[\\w-]+ ){0,3}?${CRE}${NOT_THEIRS}[^.]*?\\b(?:to (?:its|their) owner(?:'s|s') hands?|on top of (?:its|their) owner(?:'s|s') librar(?:y|ies))`, "i");
  /* 縮小：基本のパワー・タフネスを 0〜1 にする（自分のクリーチャーを対象にするものは除く） */
  const SHRINK = [
    /\b(?:target|enchanted) creature(?! you control)[^.]*?\b(?:has|have|with) base power and toughness [01]\/[01]\b/i,
    /\btarget creature(?! you control)[^.]*?\bbecomes? an? (?:[\w-]+ )*?[01]\/[01]\b/i
  ];
  /* パワーを下げる：−N/−0（N は3以上か X）。タフネスも下がるものは除去の側で見る */
  const BLUNT = /\btarget creature(?! you control)[^.]*?\bgets? -(?:[3-9]|\d{2,}|x)\/-?0\b/i;
  function soft(text, type){
    const s = String(text || "").replace(/\u2212/g, "-");
    if(anyRemoval(s)) return "";       // 除去・色限定の除去は半除去ではない
    if(/\bInstant\b/.test(type || "") || /\bFlash\b/.test(s)){
      const m = s.match(PUMP);
      if(m && (/x/i.test(m[1] + m[2]) || (+m[1] + +m[2]) >= 3)) return "trick";
      if(GRANT.test(s)) return "trick";
      if(BLUNT.test(s)) return "blunt";
    }
    if(SHRINK.some(re => re.test(s))) return "shrink";
    if(BOUNCE.test(s)) return "bounce";
    return "";
  }
  function textOf(c){
    if(!c) return "";
    const faces = (c.card_faces || []).map(f => f.oracle_text || "").filter(Boolean);
    return faces.length ? faces.join("\n") : (c.oracle_text || "");
  }
  return { removal, narrow, soft, makesCreatures, textOf };
})();
if(typeof module !== "undefined") module.exports = CardRole;
