/*
 * 新セットが出たときの告知文を作る（文面だけ。投稿はしない）。
 *   X（日本語・手で投稿）と Bluesky（英語・自動投稿）の2つ。
 *   練習の3つ（CPU とのドラフト・友達とドラフト・シールド）と、アリーナへ持ち込めることを伝える。
 *   リンクは「友達とドラフト」のページ（貼ったときに専用の画像が出る）。どこから来たかが分かるよう ?from= を付ける。
 * 役割はこれだけ。release-post.mjs から使う。文字数の数え方と上限への収め方は x-text.mjs。
 */
import { fit } from "./x-text.mjs";

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const tagOf = s => "#" + String(s).replace(/[\s・:：'’!！?？,，.。&＆\-－]/g, "");

/* name = { ja, en }（セット名）。先頭に「~」の付いた行は、文字数が上限を超えたときに後ろから落とす */
export function releaseTexts(name){
  const x = fit([
    `【${name.ja}】新セットのドラフト・シールドを無料で練習できます。`,
    "",
    "・ドラフト練習（CPU 7人と）",
    "・友達とドラフト（空いた席はCPU）",
    "~・シールド練習（6パック開封）",
    "",
    "組んだデッキは、そのままアリーナにインポート。",
    `${SITE}/draftroom?from=x-release`,
    `#MTGアリーナ ${tagOf(name.ja)}`
  ], "x");
  const bsky = fit([
    `${name.en}: practise Draft and Sealed for free, right now.`,
    "",
    "・Draft vs 7 CPUs",
    "・Draft with friends (invite link, CPUs fill the empty seats)",
    "~・Sealed (open 6 packs)",
    "",
    "~Import your deck straight into MTG Arena.",
    `${SITE}/draftroom?from=bsky-release`,
    `#MTGArena ${tagOf(name.en)}`
  ], "bsky");
  return { x, bsky, link: `${SITE}/draftroom` };
}
