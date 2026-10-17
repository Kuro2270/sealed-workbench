/* スマホ・タブレットでは、上部のツール一覧をたたんで、ハンバーガーボタンで開閉する。
   パソコン（幅1025px以上）では今までどおり全部並べる。 */
(function(){
  var css = ".navtoggle{display:none}" +
    "@media (max-width:1024px){" +
    ".navtoggle{display:inline-flex;align-items:center;gap:10px;margin:0 0 12px;padding:9px 16px 9px 14px;border-radius:10px;border:1px solid #4A83BF;background:linear-gradient(180deg,#2A5F96,#1C4A7C);color:#fff;font:inherit;font-size:14px;font-weight:700;letter-spacing:.02em;box-shadow:0 2px 0 #12365C,0 4px 10px rgba(0,0,0,.28);cursor:pointer}" +
    ".navtoggle:active{box-shadow:0 1px 0 #12365C}" +
    ".navtoggle .bars{display:inline-block;width:18px;height:14px;position:relative}" +
    ".navtoggle .bars i{position:absolute;left:0;right:0;height:2px;border-radius:2px;background:#fff;transition:transform .18s,opacity .18s,top .18s}" +
    ".navtoggle .bars i:nth-child(1){top:0}.navtoggle .bars i:nth-child(2){top:6px}.navtoggle .bars i:nth-child(3){top:12px}" +
    ".navtoggle[aria-expanded=true] .bars i:nth-child(1){top:6px;transform:rotate(45deg)}" +
    ".navtoggle[aria-expanded=true] .bars i:nth-child(2){opacity:0}" +
    ".navtoggle[aria-expanded=true] .bars i:nth-child(3){top:6px;transform:rotate(-45deg)}" +
    ".navtoggle .cur{font-weight:500;color:#CFE3FA;font-size:12.5px;padding-left:10px;border-left:1px solid rgba(255,255,255,.3)}" +
    "nav.navfold{display:none !important}" +
    "nav.navfold.open{display:flex !important;margin:0 0 16px;padding:14px 14px 10px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(6,22,40,.55)}" +
    "nav.navfold.open .ng{width:100%;padding-left:0;border-left:none;margin-bottom:6px}" +
    "nav.navfold.open .ngl.ngcat{cursor:pointer;text-decoration:underline;text-underline-offset:3px}" +
    "}";

  var deskCss =
    "nav.navfold .ngpanel{display:contents}" +
    "@media (min-width:1025px){" +
    "nav.navfold{display:flex !important;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 16px;position:relative;z-index:40}" +
    "nav.navfold .ng{display:flex !important;flex-wrap:nowrap;gap:8px;align-items:center;padding:0 !important;border:none !important;position:relative;width:auto}" +
    "nav.navfold .ng.direct > .ngl,nav.navfold .ng.direct > .ngs{display:none !important}" +
    "nav.navfold .ng.dd > .ngl{display:inline-flex !important;align-items:center;position:static;margin:0;padding:8px 14px;border-radius:10px;border:1px solid #4A83BF;background:linear-gradient(180deg,#2A5F96,#1C4A7C);box-shadow:0 2px 0 #12365C,0 4px 10px rgba(0,0,0,.28);color:#fff;font-size:13px;font-weight:700;letter-spacing:0;text-transform:none;line-height:1;white-space:nowrap;cursor:pointer;user-select:none}" +
    "nav.navfold .ng.dd > .ngl::after{content:'';display:inline-block;width:6px;height:6px;margin:-3px 0 0 9px;border-right:2px solid #CFE3FA;border-bottom:2px solid #CFE3FA;transform:rotate(45deg);transition:transform .15s}" +
    "nav.navfold .ng.dd.open > .ngl::after{transform:rotate(225deg);margin-top:3px}" +
    "nav.navfold .ng.dd > .ngl:hover,nav.navfold .ng.dd.open > .ngl{background:linear-gradient(180deg,#3573B3,#25609F);border-color:#6FA3DA}" +
    "nav.navfold .ng.dd.has-on > .ngl{background:#2F7DF6;border-color:#2F7DF6}" +
    "nav.navfold .ngpanel{display:none;position:absolute;top:calc(100% + 8px);left:0;min-width:230px;flex-direction:column;align-items:stretch;gap:8px;padding:12px;border:1px solid #2C4D74;border-radius:12px;background:#0A2038;box-shadow:0 14px 30px rgba(0,0,0,.45);z-index:60}" +
    "nav.navfold .ngpanel::before{content:'';position:absolute;left:0;right:0;top:-10px;height:10px}" +
    "nav.navfold .ng.open .ngpanel{display:flex}" +
    "nav.navfold .ngpanel .ngs{display:block !important;position:static;margin:0 0 2px;font-size:11.5px;line-height:1.5;color:#A9BFD8;white-space:normal;grid-column:auto}" +
    "nav.navfold .ngpanel a{width:100%;justify-content:flex-start;grid-row:auto}" +
    "}";
  var st = document.createElement("style"); st.textContent = css + deskCss; document.head.appendChild(st);

  function init(){
    var nav = document.querySelector("nav");
    if (!nav || !nav.querySelector(".ng") || document.querySelector(".navtoggle")) return;
    /* どのページにも「このサイトについて」（よくある質問・お問い合わせ）を出す */
    if (!nav.querySelector("[data-about]")) {
      var here = location.pathname.replace(/\/+$/, "");
      var g = document.createElement("div");
      g.className = "ng"; g.setAttribute("data-about", "");
      g.innerHTML = '<span class="ngl" data-i18n="navgrp.about">このサイトについて</span>' +
        '<span class="ngs" data-i18n="navsub.about">質問・連絡・規約</span>' +
        '<a href="/faq.html" data-i18n="nav.faq">よくある質問</a>' +
        '<a href="/contact.html" data-i18n="nav.contact">お問い合わせ</a>' +
        '<a href="/privacy.html" data-i18n="nav.privacy">プライバシー</a>';
      Array.prototype.forEach.call(g.querySelectorAll("a"), function(a){
        if (here === a.getAttribute("href")) a.classList.add("on");
      });
      nav.appendChild(g);
      if (window.I18N && I18N.apply) I18N.apply(g);
    }
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "navtoggle"; btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<span class="bars"><i></i><i></i><i></i></span><span class="lbl"></span><span class="cur"></span>';
    nav.parentNode.insertBefore(btn, nav);
    nav.classList.add("navfold");
    /* パソコン用：グループごとにまとめる。リンクが1つだけのグループは、そのまま並べる */
    var groups = Array.prototype.slice.call(nav.querySelectorAll(".ng"));
    groups.forEach(function(g){
      var links = g.querySelectorAll(":scope > a");
      var lab = g.querySelector(".ngl");
      if (!lab || links.length <= 1) { g.classList.add("direct"); return; }
      var panel = document.createElement("div"); panel.className = "ngpanel";
      var sub = g.querySelector(".ngs"); if (sub) panel.appendChild(sub);
      Array.prototype.forEach.call(links, function(a){ panel.appendChild(a); });
      g.appendChild(panel);
      g.classList.add("dd");
      lab.setAttribute("role", "button"); lab.setAttribute("tabindex", "0"); lab.setAttribute("aria-haspopup", "true");
      if (panel.querySelector("a.on")) g.classList.add("has-on");
    });
    /* メニューの見出し（カテゴリ）を押すと、そのカテゴリのページへ。
       セット別ページなどは見出しの書き方が違うので、グループの中にあるツールのリンクで見分ける */
    var CAT = [["sealed.html", "/practice.html"], ["sealed-assist.html", "/arena.html"], ["table.html", "/play.html"], ["start/index", "/begin.html"], ["faq.html", "/about.html"]];
    var herePath = location.pathname.replace(/\/+$/, "").replace(/\.html$/, "");
    function catOf(g){
      var hs = Array.prototype.map.call(g.querySelectorAll("a"), function(a){ return a.getAttribute("href") || ""; });
      for (var i = 0; i < CAT.length; i++) if (hs.some(function(h){ return h.indexOf(CAT[i][0]) >= 0; })) return CAT[i][1];
      return null;
    }
    groups.forEach(function(g){
      var lab = g.querySelector(".ngl"), href = lab && catOf(g);
      if (!href) return;
      g._href = href;
      lab.classList.add("ngcat");
      if (herePath === href.replace(/\.html$/, "")) g.classList.add("has-on");
    });
    var desk = window.matchMedia ? matchMedia("(min-width:1025px)") : { matches: false };
    function closeAll(except){
      groups.forEach(function(g){ if (g !== except) g.classList.remove("open"); });
    }
    var timer = 0;
    groups.forEach(function(g){
      if (!g.classList.contains("dd")) return;
      var lab = g.querySelector(".ngl");
      lab.addEventListener("click", function(){
        if (g._href) { location.href = g._href; return; }     // カテゴリのページへ（中のツールは、ホバーで開く一覧から）
        if (!desk.matches) return;
        /* ホバーで開いた直後のクリックは、閉じずに開いたままにする */
        if (Date.now() - (g._hov || 0) < 600) { closeAll(g); g.classList.add("open"); return; }
        var o = !g.classList.contains("open"); closeAll(g); g.classList.toggle("open", o);
      });
      lab.addEventListener("keydown", function(e){
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); lab.click(); }
      });
      g.addEventListener("mouseenter", function(){
        if (!desk.matches) return; clearTimeout(timer); closeAll(g); g._hov = Date.now(); g.classList.add("open");
      });
      g.addEventListener("mouseleave", function(){
        if (!desk.matches) return; clearTimeout(timer); timer = setTimeout(function(){ g.classList.remove("open"); }, 180);
      });
    });
    groups.forEach(function(g){
      if (g.classList.contains("dd") || !g._href) return;
      var lab = g.querySelector(".ngl");
      lab.setAttribute("role", "link"); lab.setAttribute("tabindex", "0");
      lab.addEventListener("click", function(){ location.href = g._href; });
      lab.addEventListener("keydown", function(e){ if (e.key === "Enter") location.href = g._href; });
    });
    document.addEventListener("click", function(e){ if (!nav.contains(e.target)) closeAll(); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") closeAll(); });
    function label(){
      var ja = (document.documentElement.lang || "ja").indexOf("ja") === 0;
      btn.querySelector(".lbl").textContent = ja ? "メニュー" : "Menu";
      var on = nav.querySelector("a.on");
      var cur = btn.querySelector(".cur");
      cur.textContent = on ? on.textContent.replace(/\s+/g, " ").trim() : "";
      cur.style.display = on ? "" : "none";
    }
    function set(open){
      nav.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.addEventListener("click", function(){ set(!nav.classList.contains("open")); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") set(false); });
    label();
    new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    setTimeout(label, 400);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
