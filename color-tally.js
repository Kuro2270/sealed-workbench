/* デッキ（ドラフト中は取ったカード）の色ごとの枚数を、マナシンボルと数字で一覧の上に出す。役割はこれだけ（シールド練習・ドラフト練習で使う）。
   数え方：白・青・黒・赤・緑それぞれ。多色のカードは、それぞれの色に1枚ずつ数える。土地と無色のカードは数えない
   マナシンボルは mana-font（assets/mana/。画面に mana.min.css を読み込んでおく）。色の名前は i18n.js の t("color.W") など

     ColorTally.render(box, cards)   … box の中身を、cards の色ごとの枚数にする */
(function () {
  "use strict";
  var KEYS = ["W", "U", "B", "R", "G"];

  function colorsOf(c) {
    var front = String((c && c.type_line) || "").split("//")[0];
    if (front.indexOf("Land") >= 0) return [];
    return ((c && c.color_identity) || []).filter(function (k) { return KEYS.indexOf(k) >= 0; });
  }
  function tr(key, vars, fallback) {
    try { var s = window.t && window.t(key, vars); return s && s !== key ? s : fallback; }
    catch (e) { return fallback; }
  }
  function addStyle() {
    if (document.getElementById("ctallyStyle")) return;
    var s = document.createElement("style");
    s.id = "ctallyStyle";
    s.textContent = [
      ".ctally{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;flex-basis:100%;margin-top:8px}",
      ".ctally[hidden]{display:none}",
      ".ctally .ct{display:inline-flex;align-items:center;gap:4px;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:#0D1B2A}",
      ".ctally .ct .ms{font-size:16px;margin:0}",
      ".ctally .ct.zero{opacity:.35;font-weight:600}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function render(box, cards) {
    if (!box) return;
    addStyle();
    var n = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    (cards || []).forEach(function (c) { colorsOf(c).forEach(function (k) { n[k]++; }); });
    box.className = "ctally";
    box.setAttribute("role", "list");
    box.setAttribute("aria-label", tr("ctally.label", null, "色ごとの枚数"));
    box.innerHTML = KEYS.map(function (k) {
      var name = tr("color." + k, null, k);
      return '<span class="ct' + (n[k] ? "" : " zero") + '" role="listitem" title="' + name + " " + n[k] + '" aria-label="' + name + " " + n[k] + '">'
           + '<i class="ms ms-cost ms-' + k.toLowerCase() + '" aria-hidden="true"></i>'
           + '<span aria-hidden="true">' + n[k] + "</span></span>";
    }).join("");
    box.hidden = !(cards && cards.length);
  }

  window.ColorTally = { render: render };
})();
