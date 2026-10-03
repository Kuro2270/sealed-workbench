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
    "}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function init(){
    var nav = document.querySelector("nav");
    if (!nav || !nav.querySelector(".ng") || document.querySelector(".navtoggle")) return;
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "navtoggle"; btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<span class="bars"><i></i><i></i><i></i></span><span class="lbl"></span><span class="cur"></span>';
    nav.parentNode.insertBefore(btn, nav);
    nav.classList.add("navfold");
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
