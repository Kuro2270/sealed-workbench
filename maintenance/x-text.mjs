/*
 * X（と Bluesky）の文字数の数え方と、上限に収める処理。
 * 自動投稿（post-social.mjs）と、動画を作ったときの X のおすすめ投稿文（x-post-draft.mjs）で共通に使う。役割はこれだけ。
 *
 *   xLength(text)        … X の数え方の文字数（URL は 23、全角は 2、それ以外は 1）
 *   fit(lines, track)    … 行の並びを上限（X は 280、Bluesky は 300）に収まるまで、先頭に「~」の付いた行から後ろ順に落とし、つないで返す
 */
export function xLength(text){
  // URL は 23、全角（CJK など）は 2、それ以外は 1
  let n = 0;
  const parts = text.split(/(https?:\/\/\S+)/);
  for(const p of parts){
    if(/^https?:\/\//.test(p)) n += 23;
    else for(const ch of p) n += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return n;
}
/* 上限に収まるまで、印のついた行から順に落とす。X は独自の数え方で 280、Bluesky は文字数（URL も全部）で 300 */
export function fit(lines, track = "x"){
  const limit = track === "bsky" ? 300 : 280;
  const len = track === "bsky" ? (t => [...t].length) : xLength;
  let out = lines.slice();
  const join = arr => arr.filter(l => l != null).map(l => l.replace(/^~/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  while(len(join(out)) > limit){
    const i = out.map((l, k) => [l, k]).reverse().find(([l]) => typeof l === "string" && l.startsWith("~"));
    if(!i) break;
    out.splice(i[1], 1);
  }
  return join(out);
}
