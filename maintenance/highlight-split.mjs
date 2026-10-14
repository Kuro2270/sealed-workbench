/*
 * 読み上げに合わせて画面の一部を光らせるための、セリフの区切り方（長尺・ショートで共通）。
 *
 * 光らせる項目（カード名など）ごとに、セリフを区切る。区切りごとに別々に読み上げて長さを測り、
 * 「どの項目の話が、何秒から何秒か」を実際の音声の長さで決めるため（文字数の割合で見積もると、数字の読み上げなどでずれる）。
 *
 *   splitSay(say, highlight, en)
 *     say       … セリフ全体
 *     highlight … 光らせる項目の並び。各項目の label がセリフの中に出てくる順に並べる
 *     en        … 英語のセリフなら true（句読点の区切り方が変わる）
 *   返り値：chunks（読み上げる文の並び）と、spans（項目 k が、chunks の何番目から何番目までか。見つからなければ null）
 *
 * 役割はこれだけ（読み上げや描画はそれぞれの build-*.mjs）。
 */
export function splitSay(say, highlight, en){
  const cuts = new Set([0, say.length]), marks = [];
  const punct = en ? /[,.!?;:]\s/g : /[、。]/g;
  let from = 0;
  for(const h of highlight){
    const i = say.indexOf(h.label, from);
    if(i < 0){ marks.push(null); continue; }
    // 区切りの始まり：名前の直前にある句読点の後ろ（「左から、」「1位、」なども一緒に読む）
    let b = from; const seg = say.slice(from, i); let m; punct.lastIndex = 0;
    while((m = punct.exec(seg))) b = from + m.index + m[0].length;
    from = i + h.label.length;
    // 区切りの終わり：その文の終わり（「。」／ピリオド）
    const j = say.slice(from).search(en ? /[.!?](\s|$)/ : /。/), e = j < 0 ? say.length : from + j + 1 + (en ? 1 : 0);
    cuts.add(b); cuts.add(Math.min(e, say.length)); marks.push([b, Math.min(e, say.length)]);
  }
  // 同じ文の中に次のカードが続くとき（「左から、A、B、C。」）は、次のカードの区切りの手前で終える
  marks.forEach((mk, k) => { if(!mk) return; const nx = marks.slice(k + 1).find(Boolean); if(nx && nx[0] < mk[1]) mk[1] = nx[0]; });
  const pos = [...cuts].sort((a, b) => a - b);
  const chunks = [];
  for(let k = 0; k + 1 < pos.length; k++){ const t = say.slice(pos[k], pos[k + 1]); if(t.trim()) chunks.push({ text: t.trim(), at: pos[k], end: pos[k + 1] }); }
  const spans = marks.map(mk => {
    if(!mk) return null;
    const a = chunks.findIndex(c => c.at >= mk[0]), z = chunks.reduce((n, c, idx) => c.end <= mk[1] ? idx : n, a);
    return a < 0 ? null : [a, Math.max(a, z)];
  });
  return { chunks, spans };
}
