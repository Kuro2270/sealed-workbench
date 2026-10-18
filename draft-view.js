/* ドラフトの「取ったカード」の見せ方（ドラフト練習 draft.html と、友達とドラフト draftroom.html の両方で使う）
   ・クリーチャー／スペル／土地に分けた一覧
   ・色の内訳（棒グラフ）
   ・マナシンボルの画像（mana-font。assets/mana/ に同梱。画面に mana.min.css を読み込んでおく）
   1行ぶんの中身（勝率・移動ボタンなど）は、それぞれのページが作る。draft-core.js（COLORS・cardColors・displayName）と i18n.js の t() を使う */

/* 色のマナシンボル。W U B R G は各色、M は多色、C は無色 */
function manaIcon(k){
  k = String(k || "C").toUpperCase();
  const cls = k === "M" ? "ms-multicolor mfi-m" : "ms-" + k.toLowerCase();
  return `<i class="ms ms-cost ${cls} mfi" aria-hidden="true"></i>`;
}

/* カードのマナコスト（例：{2}{U}{U}）をマナシンボルの並びにする。両面・分割カードは「//」で区切る */
function manaCostHtml(c){
  const cost = (c && (c.mana_cost || (c.card_faces && c.card_faces[0] && c.card_faces[0].mana_cost))) || "";
  if(!cost) return "";
  const sym = s => {
    const k = s.slice(1, -1).toLowerCase().replace(/\//g, "");   // {W/U} → wu、{2/W} → 2w、{U/P} → up
    return `<i class="ms ms-cost ms-${k.replace(/[^a-z0-9]/g, "")}"></i>`;                // 混成マナ（wu・2w）は mana-font が2色に塗り分ける
  };
  const html = String(cost).split(" // ").map(part => (part.match(/\{[^}]+\}/g) || []).map(sym).join("")).join('<span class="msep">/</span>');
  const e = String(cost).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  return `<span class="mcost" title="${e}" aria-label="${e}">${html}</span>`;
}

/* 区分け（クリーチャー／スペル／土地） */
const SECTIONS = [{key:"creature"}, {key:"spell"}, {key:"land"}];
const secLabel = k => t("sec." + k);
function cardSection(c){
  const front = (c.type_line || "").split("//")[0];
  if(front.includes("Creature")) return "creature";
  if(front.includes("Land")) return "land";
  return "spell";
}

/* 取ったカードの一覧を、区分けごとに見出し＋マナ総量の順で box に入れる。rowOf(c) は1行（li）を返す */
function renderSections(box, list, rowOf){
  SECTIONS.forEach(sec => {
    const sub = list.filter(c => cardSection(c) === sec.key);
    if(!sub.length) return;
    const h = document.createElement("div");
    h.className = "sec";
    h.innerHTML = `<h4>${secLabel(sec.key)}</h4><span>${t("unit.cards", {n: sub.length})}</span>`;
    box.appendChild(h);
    const ul = document.createElement("ul");
    sub.slice().sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || displayName(a).localeCompare(displayName(b), "ja"))
       .forEach(c => ul.appendChild(rowOf(c)));
    box.appendChild(ul);
  });
}

/* 色の内訳（W U B R G それぞれ何枚あるか）。多色のカードは、それぞれの色に数える */
function renderColorRows(box, list){
  box.innerHTML = "";
  const counts = {W:0, U:0, B:0, R:0, G:0};
  list.forEach(c => cardColors(c).forEach(k => counts[k]++));
  const max = Math.max(1, ...Object.values(counts));
  COLORS.filter(c => "WUBRG".includes(c.key)).forEach(col => {
    const n = counts[col.key];
    const d = document.createElement("div");
    d.className = "crow";
    d.title = colorLabel(col.key);
    d.innerHTML =
      `<span>${manaIcon(col.key)}</span>` +
      `<span class="track"><i style="width:${n / max * 100}%;background:var(${col.var})"></i></span>` +
      `<span class="n">${n}</span>`;
    box.appendChild(d);
  });
}
