/*
 * カードのティア表（S〜D）を作る。環境レポート（build-articles.mjs）と、暫定版（build-provisional.mjs）から使う。役割はこれだけ。
 *
 * 決め方：そのセット・形式の全カード（土地を除き、試合数が minGames 以上）の GIH 勝率の平均と散らばり（標準偏差）を出し、
 *   S … 平均 + 1.5σ 以上 ／ A … +0.5σ 以上 ／ B … −0.5σ 以上 ／ C … −1.5σ 以上 ／ D … それ未満
 * 全カード共通のものさしで分けるので、レアリティが違っても同じランクなら同じくらいの強さ。
 * 表は「神話レア・レア」「アンコモン」「コモン」の3つに分けて並べる（mr / u / c）。
 */
export const TIERS = ["S", "A", "B", "C", "D"];
const GROUP = { mythic: "mr", rare: "mr", uncommon: "u", common: "c" };

export function cardTiers(cards, minGames = 500){
  const pool = (cards || []).filter(c => !c.land && c.gih != null && (c.games || 0) >= minGames && GROUP[c.rarity]);
  if(pool.length < 10) return null;
  const mean = pool.reduce((n, c) => n + c.gih, 0) / pool.length;
  const sd = Math.sqrt(pool.reduce((n, c) => n + (c.gih - mean) ** 2, 0) / pool.length) || 0.01;
  const tierOf = g => g >= mean + 1.5 * sd ? "S" : g >= mean + 0.5 * sd ? "A" : g >= mean - 0.5 * sd ? "B" : g >= mean - 1.5 * sd ? "C" : "D";
  const groups = {};
  for(const k of ["mr", "u", "c"]) groups[k] = Object.fromEntries(TIERS.map(t => [t, []]));
  for(const c of pool.slice().sort((a, b) => b.gih - a.gih)){
    groups[GROUP[c.rarity]][tierOf(c.gih)].push({ name: c.name, gih: Math.round(c.gih * 10000) / 10000, color: c.color || "", rarity: c.rarity });
  }
  return { mean: Math.round(mean * 10000) / 10000, sd: Math.round(sd * 10000) / 10000, min_games: minGames, groups };
}
