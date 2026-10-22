/*
 * 構築画面（シールド練習・ドラフト練習）で、「アリーナ用テキストをコピー」をいつでも押せるようにする。役割はこれだけ。
 *   広い画面：デッキの枠の高さを、画面に見えている分に合わせる（枠の下に固定したボタンが、ページの一番上でも見えるように）。
 *             枠の中のスクロールと、ボタンの固定はページの CSS（.deck-actions）が受け持つ
 *   狭い画面：デッキの枠が画面の外にある間だけ、画面の下に小さな帯を出す。
 *     帯の中身：デッキの枚数／「デッキを見る」（デッキの枠までスクロール）／「アリーナ用テキストをコピー」
 *     コピーは、ページの #copyBtn を押すのと同じ（文言の「コピーしました」もそのまま映す）
 *
 * ページ側は、デッキの枠に data-dock-panel（値は、デッキの枠が下に回る画面の幅。例 "900"）、枚数の表示に data-dock-count を付けて、このファイルを読み込むだけ。
 * #copyBtn が見えていないとき（ドラフトのピック中など）は、帯も出さない。
 * （2026年10月：コピーのボタンがページの一番下にあり、気付きにくかったため）
 */
(function(){
  var css = ".deck-dock{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;align-items:center;gap:8px;" +
    "padding:8px 12px calc(8px + env(safe-area-inset-bottom));background:rgba(13,27,42,.96);color:#F5F8FC;" +
    "box-shadow:0 -6px 18px rgba(0,0,0,.25);font-family:inherit}" +
    ".deck-dock[hidden]{display:none}body.has-dock{padding-bottom:64px}" +
    ".deck-dock .dk-count{font-size:13px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}" +
    ".deck-dock button{min-height:0;padding:9px 12px;font-size:13px;font-weight:700;border-radius:8px;cursor:pointer;font-family:inherit;white-space:nowrap}" +
    ".deck-dock .dk-go{margin-left:auto;background:transparent;color:#F5F8FC;border:1px solid rgba(245,248,252,.45)}" +
    ".deck-dock .dk-copy{background:#2F7DF6;color:#fff;border:1px solid #2F7DF6;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis}";

  function t(key, fallback){ try{ var s = window.I18N && window.I18N.t(key); return s && s !== key ? s : fallback; }catch(e){ return fallback; } }

  function init(){
    var panel = document.querySelector("[data-dock-panel]"), copy = document.getElementById("copyBtn"), count = document.querySelector("[data-dock-count]");
    if(!panel || !copy) return;
    var style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
    var bar = document.createElement("div");
    bar.className = "deck-dock"; bar.hidden = true;
    bar.innerHTML = '<span class="dk-count"></span><button type="button" class="dk-go"></button><button type="button" class="dk-copy"></button>';
    document.body.appendChild(bar);
    var cEl = bar.querySelector(".dk-count"), go = bar.querySelector(".dk-go"), cp = bar.querySelector(".dk-copy");
    var mq = window.matchMedia("(max-width: " + (parseInt(panel.getAttribute("data-dock-panel"), 10) || 900) + "px)"), panelInView = true;

    function update(){
      cEl.textContent = t("deck.title", "デッキ") + " " + (count ? count.textContent.replace(/\s+/g, " ").trim() : "");
      go.textContent = t("deck.dockGo", "デッキを見る");
      // 帯は幅が狭いので、ふだんは短い文言にする（「コピーしました」などに変わったときは、そのまま映す）
      cp.textContent = copy.textContent === t("deck.copy", copy.textContent) ? t("deck.dockCopy", "アリーナ用にコピー") : copy.textContent;
      // #copyBtn が表示されている（祖先が hidden でない）ときだけ
      var usable = copy.getClientRects().length > 0;
      bar.hidden = !(mq.matches && !panelInView && usable);
      document.body.classList.toggle("has-dock", !bar.hidden);   // 帯でページの一番下が隠れないように
    }
    go.onclick = function(){ panel.scrollIntoView({ behavior: "smooth", block: "start" }); };
    cp.onclick = function(){ copy.click(); };

    // 広い画面：枠の上端が画面の上から離れている間（ページの一番上など）は、その分だけ枠を低くして、下のボタンを画面に入れる
    var raf = 0;
    function fit(){
      raf = 0;
      if(mq.matches){ panel.style.maxHeight = ""; return; }
      var top = Math.max(16, panel.getBoundingClientRect().top);
      panel.style.maxHeight = Math.max(320, window.innerHeight - top - 16) + "px";
    }
    function queueFit(){ if(!raf) raf = requestAnimationFrame(fit); }
    window.addEventListener("scroll", queueFit, { passive: true });
    window.addEventListener("resize", queueFit);
    if(mq.addEventListener) mq.addEventListener("change", queueFit);
    fit();

    if("IntersectionObserver" in window)
      new IntersectionObserver(function(es){ panelInView = es[0].isIntersecting; update(); }).observe(panel);
    var mo = new MutationObserver(update);
    mo.observe(copy, { childList: true, characterData: true, subtree: true });
    if(count) mo.observe(count, { childList: true, characterData: true, subtree: true });
    mo.observe(panel, { attributes: true, subtree: true, attributeFilter: ["hidden"] });
    if(mq.addEventListener) mq.addEventListener("change", update);
    if(window.I18N && window.I18N.onChange) window.I18N.onChange(update);
    update();
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
