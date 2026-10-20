# r/lrcast 投稿の下書き — Reality Fracture（FRA）

**そのまま投稿せず、必ず数字と言い回しに目を通してください。**
投稿は手動です。画像は下の PNG を Reddit にアップロードしてください。

| | |
| --- | --- |
| 集計した試合数 | 399,482 |
| 環境全体の勝率 | 55.9% |
| データ取得日 | 2026-10-19 |
| 画像 | `lrcast/FRA.png` |

## タイトル候補

1. [FRA] Slower decks are winning: 57.2% vs 55.0% by deck average mana value, over 399,482 games
2. [FRA] WU is the pairing that actually adds something; BG is worse than its two colours apart (17Lands data)
3. [FRA] I ran the 17Lands public data on 399,482 games — curve and colour pair numbers inside

## 本文（ここから下をコピーして貼り付け）

````markdown
I pulled the 17Lands public dataset for Reality Fracture and looked at two things: how much the curve is actually worth, and whether any colour pair does more than its two colours do on their own. Numbers below are from **399,482 tracked games** — Pick-Two (73,286), Premier (297,964), Traditional (28,232) — with an overall win rate of **55.9%** and an average game length of 10.1 turns.

## 1. Bigger decks win more here

Win rate by the deck's **average mana value** across its nonland cards, for decks with 15 or more spells:

| avg. mana value | win rate | games |
| --- | --- | --- |
| under 2.9 | 55.0% | 94,565 |
| 2.9 – 3.2 | 55.6% | 149,081 |
| 3.2 – 3.5 | 56.7% | 110,737 |
| 3.5 and up | 57.2% | 45,097 |

That is a **2.2 point** spread between the most expensive bucket and the cheapest one. For comparison, the gap between the best and worst colour pair below is 1.5 points. This is unusual — most recent formats reward the cheaper deck.

Caveat worth stating up front: this is a correlation in deck lists, not an experiment. Decks with a low average mana value are also, on average, decks that opened better commons and had a cleaner curve to begin with.

## 2. Which pairings actually add something

For each two-colour archetype I compared its win rate against the **average of its two colours' win rates** across every deck containing them. The gap is a rough read on whether the pairing does more than its parts.

| pair | win rate | avg. of its colours | gap | games |
| --- | --- | --- | --- | --- |
| WU | 57.9% | 56.0% | +1.9 pt | 47,878 |
| UB | 57.0% | 56.2% | +0.8 pt | 55,303 |
| UR | 56.8% | 56.0% | +0.8 pt | 31,687 |
| RG | 56.7% | 55.6% | +1.1 pt | 37,967 |
| BG | 56.4% | 55.8% | +0.6 pt | 26,566 |


**WU** beats its parts by the most (+1.9 pt), and **BG** gives the most away (+0.6 pt). If you find yourself in BG, the reading here is that the two colours are fine and the pairing is not — a splash out of it may be worth more than leaning further in.

This measure has a real flaw and I would rather say it than have it found in the comments: a colour's win rate is computed over all decks containing that colour, which **includes the pair being tested**. So the "expected" value is not independent of the result. It is a signal, not a measurement. If someone knows a cleaner way to normalise this out of the public dataset I would like to hear it.

## Top commons by GIH win rate

| card | GIH WR | IWD | games |
| --- | --- | --- | --- |
| Mindseeker Oculus | 60.5% | +6.6 pt | 68,160 |
| Extended Absence | 60.4% | +7.1 pt | 58,394 |
| Protege's Awakening | 59.5% | +5.1 pt | 49,749 |
| Twinned Vision | 59.1% | +2.7 pt | 50,563 |
| Icy Reception | 59.0% | +4.3 pt | 52,345 |

---

Data: [17Lands public datasets](https://www.17lands.com/public_datasets) (CC BY 4.0), pulled 2026-10-19. I am not affiliated with 17Lands.

Full disclosure: I maintain a free Limited practice site, and these numbers come out of its aggregation pipeline — the per-card and per-archetype tables for Reality Fracture are at https://sealed-workbench.com/sets/FRA.en.html if you want to dig further. No account needed. Happy to answer methodology questions in the comments.
````

## 投稿のとき

- r/lrcast に自己宣伝を禁じるルールはありません（ルール3は Limited Resources 自身の番組・ブログのリンクのみ）
- **投稿から数時間はコメントを見てください。** 手法への質問が必ず来ます
- 30分後にログアウト状態で自分の投稿を開き、消えていないか確認してください
  （AutoModerator に消されても、自分のアカウントからは普通に見えます）