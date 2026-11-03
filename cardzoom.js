/*
 * カードを大きく見る。シールド構築とドラフト構築の両方から読むので、1か所に置いてある。
 *   ・スマホ・タブレット：カードを長押しする
 *   ・どの端末でも：カードの画像の左上の虫眼鏡ボタン（CardZoom.button(カード) で作る）を押す
 *     （2026年11月：パソコンでは、デッキに入れた小さなカードの文字が読めなかったため）
 *
 * ページ側でやることは3つだけ。
 *   1) CardZoom.setup({ images, name, sub }) を呼ぶ
 *   2) カードの要素（.card-row / .tile）に el._card = カード を入れておく
 *   3) 画像で並べるカード（.tile）には、el.appendChild(CardZoom.button(カード)) で虫眼鏡ボタンを付ける
 *
 * 長押しは、指とペンのときだけ働く（マウスのときは何もしない）。
 */
(function () {
  "use strict";

  var HOLD = 1100;                // これだけ押し続けたら「長押し」とみなす（ミリ秒）
  var PRESS = 260;                // これだけ押されたら、カードを沈ませて手応えを出す（ミリ秒）
  var MOVE = 12;                  // これ以上指が動いたらスクロールとみなして取り消す（px）
  var SEL = ".card-row, .tile";
  var SEEN = "sw.zoomHint";       // 使い方の案内を一度出したかどうか

  var api = { images: function () { return []; }, name: function () { return ""; }, sub: function () { return ""; } };
  var box = null, timer = null, pressTimer = null, pressed = null;
  var startX = 0, startY = 0, fired = false, pushed = false;

  function tr(key, fallback) {
    try { var s = window.t && window.t(key); return s && s !== key ? s : fallback; }
    catch (e) { return fallback; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- 見た目 ---------- */
  function addStyle() {
    if (document.getElementById("czStyle")) return;
    var s = document.createElement("style");
    s.id = "czStyle";
    s.textContent = [
      ".czoom{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;",
      "  padding:18px 18px 52px;background:rgba(6,15,26,.96);overflow:auto;overscroll-behavior:contain}",
      ".czoom[hidden]{display:none}",
      ".czbody{display:flex;flex-direction:column;gap:10px;align-items:center;margin:auto}",
      ".czbody img{width:min(92vw,430px);height:auto;border-radius:14px;display:block;",
      "  box-shadow:0 18px 44px rgba(0,0,0,.5);background:rgba(255,255,255,.06)}",
      /* 1枚だけのときは、縦にも画面へ収める */
      ".czbody.one img{width:auto;height:auto;max-width:min(92vw,430px);max-height:calc(100vh - 168px)}",
      "@supports (height:100dvh){.czbody.one img{max-height:calc(100dvh - 168px)}}",
      /* 画像が無いカードは、カードの形の板に名前だけ出す */
      ".czplain{width:min(92vw,430px);aspect-ratio:5/7;border-radius:14px;display:flex;",
      "  align-items:center;justify-content:center;text-align:center;padding:24px;",
      "  background:rgba(255,255,255,.08);color:#fff;font-size:17px;line-height:1.6}",
      ".czname{color:#fff;font-size:14px;text-align:center;line-height:1.6;max-width:min(92vw,430px)}",
      ".czname small{display:block;color:#B9C7D6;font-size:12px;margin-top:3px}",
      ".czclose{position:fixed;top:10px;right:12px;width:42px;height:42px;border:0;border-radius:50%;",
      "  background:rgba(255,255,255,.16);color:#fff;font-size:23px;line-height:1;cursor:pointer;",
      "  display:flex;align-items:center;justify-content:center;font-family:inherit}",
      ".czfoot{position:fixed;left:0;right:0;bottom:14px;text-align:center;color:#9FB3C4;font-size:11.5px}",
      /* 長押しでブラウザの選択メニューが出ないようにする */
      ".card-row,.tile{-webkit-touch-callout:none;transition:transform .12s ease-out,filter .12s ease-out}",
      /* 押している間の手応え。開くまでの残り時間をかけて、じわりと沈む */
      ".card-row.czpress,.tile.czpress{transform:scale(.94);filter:brightness(.68) saturate(.85);",
      "  transition:transform " + (HOLD - PRESS) + "ms ease-out," + " filter " + (HOLD - PRESS) + "ms ease-out}",
      "@media (prefers-reduced-motion:reduce){.card-row,.tile,.card-row.czpress,.tile.czpress{transition:none}}",
      /* 初回の案内 */
      ".cztoast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:180;",
      "  max-width:88vw;background:rgba(13,27,42,.94);color:#EAF1F9;font-size:12.5px;line-height:1.6;",
      "  padding:10px 16px;border-radius:999px;box-shadow:0 10px 28px rgba(0,0,0,.35);",
      "  opacity:0;transition:opacity .25s}",
      ".cztoast.on{opacity:1}",
      /* 虫眼鏡ボタン（カードの画像の左上）。カードの絵をなるべく隠さないよう、透ける地に黄色の虫眼鏡 */
      ".czbtn{position:absolute;top:4px;left:4px;z-index:1;width:28px;height:28px;padding:0;border:0;border-radius:7px;",
      "  background:rgba(8,18,30,.5);color:#FFD640;cursor:zoom-in;display:flex;align-items:center;justify-content:center;",
      "  line-height:0;backdrop-filter:blur(1.5px);transition:background .12s}",
      ".czbtn svg{width:17px;height:17px;display:block}",
      ".czbtn:hover,.czbtn:focus-visible{background:rgba(8,18,30,.78)}",
      ".czbtn:focus-visible{outline:2px solid #FFD640;outline-offset:1px}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function ensureBox() {
    if (box) return box;
    addStyle();
    box = document.createElement("div");
    box.className = "czoom";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = '<div class="czbody"></div>'
      + '<button type="button" class="czclose" aria-label="' + esc(tr("zoom.closeLabel", "閉じる")) + '">×</button>'
      + '<div class="czfoot">' + esc(matchMedia("(pointer: fine)").matches ? tr("zoom.closePc", "画面をクリックすると閉じます") : tr("zoom.close", "画面をタップすると閉じます")) + "</div>";
    box.addEventListener("click", function () { close(); });
    document.body.appendChild(box);
    return box;
  }

  /* ---------- 開閉 ---------- */
  function open(c) {
    if (!c) return;
    ensureBox();
    var body = box.querySelector(".czbody");
    body.innerHTML = "";
    hideToast();

    var urls = [];
    try { urls = api.images(c) || []; } catch (e) { urls = []; }
    body.className = "czbody" + (urls.length === 1 ? " one" : "");
    if (urls.length) {
      urls.forEach(function (u) {
        var img = document.createElement("img");
        img.src = u;
        img.alt = "";
        body.appendChild(img);
      });
    } else {
      var d = document.createElement("div");
      d.className = "czplain";
      d.textContent = api.name(c) || "";
      body.appendChild(d);
    }

    var cap = document.createElement("div");
    cap.className = "czname";
    var sub = "";
    try { sub = api.sub(c) || ""; } catch (e) {}
    cap.innerHTML = esc(api.name(c)) + (sub ? "<small>" + esc(sub) + "</small>" : "");
    body.appendChild(cap);

    box.hidden = false;
    document.documentElement.style.overflow = "hidden";
    // Android の戻るボタンで閉じられるようにする
    try { history.pushState({ cz: 1 }, ""); pushed = true; } catch (e) { pushed = false; }
  }

  function close(fromPop) {
    if (!box || box.hidden) return;
    box.hidden = true;
    document.documentElement.style.overflow = "";
    if (!fromPop && pushed) { pushed = false; try { history.back(); } catch (e) {} }
    if (fromPop) pushed = false;
  }

  /* ---------- 長押しの判定 ---------- */
  /* 押している最中の見た目 */
  function press(el) {
    if (pressed === el) return;
    unpress();
    pressed = el;
    el.classList.add("czpress");
  }
  function unpress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (pressed) { pressed.classList.remove("czpress"); pressed = null; }
  }

  function cancel() {
    if (timer) { clearTimeout(timer); timer = null; }
    unpress();
  }

  function onDown(ev) {
    if (ev.pointerType === "mouse") return;          // パソコンはカーソルを乗せれば出る
    if (box && !box.hidden) return;                  // 開いているときは何もしない
    if (ev.target && ev.target.closest && ev.target.closest(".czbtn")) return;   // 虫眼鏡ボタンは押せば開くので、長押しの判定はしない
    fired = false;
    cancel();
    var el = ev.target && ev.target.closest ? ev.target.closest(SEL) : null;
    if (!el || !el._card) return;
    startX = ev.clientX; startY = ev.clientY;
    var card = el._card;
    addStyle();
    pressTimer = setTimeout(function () { pressTimer = null; press(el); }, PRESS);
    timer = setTimeout(function () {
      timer = null; fired = true;
      unpress();
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}   // 開いた合図（対応端末のみ）
      open(card);
      // 離したときの click が来ないブラウザ向けの保険
      setTimeout(function () { fired = false; }, 800);
    }, HOLD);
  }

  function onMove(ev) {
    if (!timer) return;
    if (Math.abs(ev.clientX - startX) > MOVE || Math.abs(ev.clientY - startY) > MOVE) cancel();
  }

  /* 長押しで開いた直後の click は、カードの追加や取り消しに使わせない。
     そのまま通すと、指を離した瞬間に背面のカードが動いたり、開いた画面がすぐ閉じたりする。 */
  function onClick(ev) {
    if (!fired) return;
    fired = false;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  }

  function onContext(ev) {
    if (ev.target && ev.target.closest && ev.target.closest(SEL)) ev.preventDefault();
  }

  /* ---------- 初回の案内 ---------- */
  var toast = null;
  function hideToast() {
    if (!toast) return;
    toast.classList.remove("on");
    var el = toast; toast = null;
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }
  function showToast() {
    if (toast) return;
    addStyle();
    toast = document.createElement("div");
    toast.className = "cztoast";
    toast.textContent = tr("zoom.hint", "カードを長押しすると大きく表示します");
    document.body.appendChild(toast);
    requestAnimationFrame(function () { if (toast) toast.classList.add("on"); });
    setTimeout(hideToast, 6000);
  }
  function maybeHint() {
    if (!matchMedia("(pointer: coarse)").matches) return;
    try { if (localStorage.getItem(SEEN)) return; localStorage.setItem(SEEN, "1"); } catch (e) {}
    showToast();
  }

  /* ---------- 虫眼鏡ボタン ---------- */
  /* カードの要素（.tile）に付けるボタンを返す。押すと拡大する。カードを足す・戻す操作にはつながらない */
  var LENS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">'
           + '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
  function button(c) {
    addStyle();
    var b = document.createElement("button");
    b.type = "button";
    b.className = "czbtn";
    b.innerHTML = LENS;
    b.title = tr("zoom.btn", "大きく見る");
    b.setAttribute("aria-label", b.title);
    b.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); open(c); });
    b.addEventListener("keydown", function (ev) {                               // Enter・スペースでカードが動かないように（Esc などはそのまま通す）
      if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation();
    });
    return b;
  }

  /* ---------- 組み込み ---------- */
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", cancel, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", onContext);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") close(); });
  window.addEventListener("popstate", function () { close(true); });
  window.addEventListener("scroll", cancel, { passive: true });

  window.CardZoom = {
    setup: function (o) {
      if (o && o.images) api.images = o.images;
      if (o && o.name) api.name = o.name;
      if (o && o.sub) api.sub = o.sub;
    },
    hint: maybeHint,
    button: button,
    open: open,
    close: close
  };
})();
