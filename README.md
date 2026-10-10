# sealed-workbench

MTGアリーナのリミテッド（シールド・ドラフト）向けサイト「リミテッド・ワークベンチ」（https://sealed-workbench.com）と、
その環境レポート動画（YouTube: @sealedworkbench_jp / @sealedworkbench）を作るためのリポジトリです。

## 利用について（All rights reserved）

このリポジトリの内容（プログラム、ワークフロー、文面、台本、画像、データの加工物を含むすべて）は、
作者が権利を保持しています。オープンソースのライセンスは付与していません。

- 閲覧は自由ですが、**転載・複製・改変しての再利用・再配布、サイトや動画の複製はご遠慮ください**
- 一部または全部を使って、同種のサイト・動画・ツールを作ることも許可していません
- 引用は、出典（sealed-workbench.com）を明記した通常の範囲でお願いします

This repository is **not** open source. All rights reserved. Viewing is fine, but please do not copy, redistribute,
or reuse the code, scripts, text, images or generated data to build a similar site, video or tool.

## 使っているもの・出典

- 勝率データ: 17Lands（公開データ、CC BY 4.0）およびカード評価 API。17Lands の利用ガイドラインに従っています
- カード情報・画像: Scryfall API。カードの画像・名称は Wizards of the Coast の著作物で、Fan Content Policy の範囲で使用しています
- 音声: VOICEVOX（ずんだもん／四国めたん）。各キャラクターの利用規約に従っています
- 四国めたんの立ち絵: 坂本アヒル氏のイラストを、規約の範囲で色変え・加工して使用

## 構成

- `index.html` ほか … サイト本体（Cloudflare Pages で配信）
- `maintenance/` … データ集計・ページ生成・動画生成のプログラム
- `.github/workflows/` … 自動実行（詳しくは `docs/actions.md`）
- `data/` … 集計済みのデータ
- `short/` … 動画づくりの素材（ロゴ、キャラクター、読み辞書）
