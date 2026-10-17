/*
 * 新セットが出たときの告知文を作る（文面だけ。投稿はしない）。
 *   X（日本語・手で投稿）と Bluesky（英語・自動投稿）の2つ。
 *   アリーナではなくここで練習する理由（ジェムが要らない・友達と確実に同じ卓・空き席はCPU・ダイレクトチャレンジで対戦）を伝える。
 *   リンクは「ドラフト練習（対人戦）」のページ（貼ったときに専用の画像が出る）。どこから来たかが分かるよう ?from= を付ける。
 * 役割はこれだけ。release-post.mjs から使う。文字数の数え方と上限への収め方は x-text.mjs。
 */
import { fit } from "./x-text.mjs";

const SITE = process.env.SITE_URL || "https://sealed-workbench.com";
const tagOf = s => "#" + String(s).replace(/[\s・:：'’!！?？,，.。&＆\-－]/g, "");

/* name = { ja, en }（セット名）。先頭に「~」の付いた行は、文字数が上限を超えたときに後ろから落とす */
export function releaseTexts(name){
  const x = fit([
    `【${name.ja}】ドラフト・シールドを、ジェムを使わずに練習できます。`,
    "",
    "・友達と確実に同じ卓でドラフト（空き席はCPU）",
    "~・CPU戦のドラフト、シールドも",
    "・組んだデッキはアリーナへ。ダイレクトチャレンジで対戦",
    "",
    `${SITE}/draftroom?from=x-release`,
    `#MTGアリーナ ${tagOf(name.ja)}`
  ], "x");
  const bsky = fit([
    `${name.en}: practise Draft & Sealed without spending gems.`,
    "",
    "・Draft at one table with your friends (CPUs fill empty seats)",
    "~・Also: Draft vs 7 CPUs, Sealed",
    "・Take your deck to MTG Arena, play via Direct Challenge",
    "",
    `${SITE}/draftroom?from=bsky-release`,
    `#MTGArena ${tagOf(name.en)}`
  ], "bsky");
  return { x, bsky, link: `${SITE}/draftroom` };
}
