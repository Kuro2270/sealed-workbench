# r/lrcast 投稿の下書き — The Hobbit（HOB）

**そのまま投稿せず、必ず数字と言い回しに目を通してください。**
投稿は手動です。画像は下の PNG を Reddit にアップロードしてください。

| | |
| --- | --- |
| 集計した試合数 | 375,126 |
| 環境全体の勝率 | 56.7% |
| データ取得日 | 2026-09-18 |
| 画像 | `lrcast/HOB.png` |

## タイトル候補

1. [HOB] Cheap decks are winning: 57.8% vs 52.9% by deck average mana value, over 375,126 games
2. [HOB] BR is the pairing that actually adds something; UB is worse than its two colours apart (17Lands data)
3. [HOB] I ran the 17Lands public data on 375,126 games — curve and colour pair numbers inside

## 本文（ここから下をコピーして貼り付け）

````markdown
I pulled the 17Lands public dataset for The Hobbit and looked at two things: how much the curve is actually worth, and whether any colour pair does more than its two colours do on their own. Numbers below are from **375,126 tracked games** — Pick-Two (106,284), Premier (241,727), Traditional (27,115) — with an overall win rate of **56.7%** and an average game length of 8.9 turns.

## 1. Cheaper decks win more, and the gradient is steep

Win rate by the deck's **average mana value** across its nonland cards, for decks with 15 or more spells:

| avg. mana value | win rate | games |
| --- | --- | --- |
| under 2.9 | 57.8% | 136,609 |
| 2.9 – 3.2 | 56.7% | 157,342 |
| 3.2 – 3.5 | 55.4% | 68,476 |
| 3.5 and up | 52.9% | 12,699 |

That is a **4.9 point** spread between the cheapest bucket and the most expensive one. For comparison, the gap between the best and worst colour pair below is 4.3 points. Trimming the top of your curve looks like it matters more than which two colours you end up in.

Caveat worth stating up front: this is a correlation in deck lists, not an experiment. Decks with a low average mana value are also, on average, decks that opened better commons and had a cleaner curve to begin with.

## 2. Which pairings actually add something

For each two-colour archetype I compared its win rate against the **average of its two colours' win rates** across every deck containing them. The gap is a rough read on whether the pairing does more than its parts.

| pair | win rate | avg. of its colours | gap | games |
| --- | --- | --- | --- | --- |
| BR | 58.7% | 57.5% | +1.2 pt | 102,430 |
| WB \* | 57.8% | 56.9% | +0.9 pt | 5,830 |
| BG | 57.4% | 56.5% | +0.9 pt | 67,783 |
| WR | 56.9% | 57.0% | ±0.0 pt | 59,777 |
| WU | 56.5% | 55.7% | +0.8 pt | 61,995 |
| UR \* | 56.4% | 56.3% | +0.1 pt | 5,229 |
| UB | 54.8% | 56.2% | −1.5 pt | 14,199 |
| RG \* | 54.4% | 56.5% | −2.1 pt | 3,430 |

\* fewer than 10,000 games — treat as noise.

**BR** beats its parts by the most (+1.2 pt), and **UB** gives the most away (−1.5 pt). If you find yourself in UB, the reading here is that the two colours are fine and the pairing is not — a splash out of it may be worth more than leaning further in.

This measure has a real flaw and I would rather say it than have it found in the comments: a colour's win rate is computed over all decks containing that colour, which **includes the pair being tested**. So the "expected" value is not independent of the result. It is a signal, not a measurement. If someone knows a cleaner way to normalise this out of the public dataset I would like to hear it.

## Top commons by GIH win rate

| card | GIH WR | IWD | games |
| --- | --- | --- | --- |
| Crude Bent Blade | 61.4% | +5.7 pt | 70,094 |
| Gollum, Silent Slinker | 60.2% | +3.0 pt | 61,854 |
| Pinecone Strike | 60.0% | +3.4 pt | 64,667 |
| Plunder the Trollshaws | 58.9% | +7.4 pt | 52,842 |
| Patient Instructor | 58.8% | +5.4 pt | 57,946 |

---

Data: [17Lands public datasets](https://www.17lands.com/public_datasets) (CC BY 4.0), pulled 2026-09-18. I am not affiliated with 17Lands.

Full disclosure: I maintain a free Limited practice site, and these numbers come out of its aggregation pipeline — the per-card and per-archetype tables for The Hobbit are at https://sealed-workbench.com/sets/HOB.en.html if you want to dig further. No account needed. Happy to answer methodology questions in the comments.
````

## 投稿のとき

- r/lrcast に自己宣伝を禁じるルールはありません（ルール3は Limited Resources 自身の番組・ブログのリンクのみ）
- **投稿から数時間はコメントを見てください。** 手法への質問が必ず来ます
- 30分後にログアウト状態で自分の投稿を開き、消えていないか確認してください
  （AutoModerator に消されても、自分のアカウントからは普通に見えます）