/*
 * レア度ごとの平均勝率と、コモン・アンコモンが「ボム級」かどうかの決まり。役割はこれだけ
 * （長尺・ショート・速報データで共通。読み上げや描画はそれぞれの build-*.mjs）。
 *
 *   rarityAverage(cards, rarity, minGames) … そのレア度（"common" / "uncommon" / "rare"。rare は神話レアも含む）の、
 *                                  引けた試合の勝率の平均（試合数で重みづけ。土地は除く）。無ければ null
 *                                  cards は勝率一覧（data/ratings/*.json の cards）の形 { rarity, gih, games, land }。minGames より試合数の少ないカードは数えない
 *   rarityAverages(cards, minGames) … { common, uncommon, rare } をまとめて
 *   rareAverage(cards, minGames) … rarityAverage(cards, "rare", minGames)
 *   isBombLevel(gih, rareAvg)    … 引けた試合の勝率が、レア全体の平均を BOMB_LEVEL（1pt）以上上回るか。
 *                                  わずかに上回るだけ（59.8% に対して 60.0% など）では「ボム級」と呼ばない（言い過ぎになる）
 *   trophyShare(trophies, card)  … 全勝デッキの採用率：そのカードの色を全部含む色で組まれた全勝デッキのうち、そのカードが入っていた割合。
 *                                  trophies は data/trophies/<SET>_draft.json（card_trophies がある新しい形式）。
 *                                  全勝デッキが TROPHY_MIN 件より少ないときは null（数字がぶれる）。返り値 { share, col（デッキの色。無色のカードは ""）}
 */
export const BOMB_LEVEL = 0.01;
export const TROPHY_MIN = 100;

export function rarityAverage(cards, rarity, minGames = 1500){
  const ok = rarity === "rare" ? (r => r === "rare" || r === "mythic") : (r => r === rarity);
  const rl = (cards || []).filter(c => !c.land && ok(c.rarity) && c.gih != null && c.games >= minGames);
  const games = rl.reduce((n, c) => n + c.games, 0);
  return games ? rl.reduce((n, c) => n + c.gih * c.games, 0) / games : null;
}
export const rarityAverages = (cards, minGames = 1500) =>
  ({ common: rarityAverage(cards, "common", minGames), uncommon: rarityAverage(cards, "uncommon", minGames), rare: rarityAverage(cards, "rare", minGames) });
export const rareAverage = (cards, minGames = 1500) => rarityAverage(cards, "rare", minGames);

export const isBombLevel = (gih, rareAvg) => rareAvg != null && rareAvg > 0 && gih != null && gih - rareAvg >= BOMB_LEVEL;

export function trophyShare(tr, card){
  if(!tr || !tr.card_trophies) return null;
  const col = "WUBRG".split("").filter(x => String(card.color || "").includes(x)).join("");
  const has = k => [...col].every(x => k.includes(x));
  const decks = (tr.colors || []).filter(c => has(c.colors)).reduce((n, c) => n + c.trophies, 0);
  if(decks < TROPHY_MIN) return null;
  const m = tr.card_trophies[card.name] || {};
  const inn = Object.entries(m).filter(([k]) => has(k)).reduce((n, [, v]) => n + v, 0);
  return { share: inn / decks, col };
}
