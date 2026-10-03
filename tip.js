/* data-tip を付けた場所にカーソルを乗せる（スマホでは押す）と、短い説明を出す。
   ブラウザ標準の title より早く出て、見た目もそろえられる。 */
(function(){
  var st = document.createElement("style");
  st.textContent =
    "td[data-tip]{text-decoration:none}[data-tip]{cursor:help;text-decoration:underline dotted rgba(110,130,150,.7);text-underline-offset:3px}" +
    "#tipbox{position:fixed;z-index:9999;max-width:min(320px,calc(100vw - 24px));padding:9px 12px;border-radius:8px;background:#0A2038;color:#EAF2FB;font-size:12.5px;line-height:1.65;font-weight:400;text-align:left;letter-spacing:0;box-shadow:0 6px 18px rgba(0,0,0,.35);pointer-events:none;white-space:pre-line;opacity:0;transition:opacity .12s}" +
    "#tipbox.on{opacity:1}";
  document.head.appendChild(st);
  var box, cur = null;
  function ensure(){ if(!box){ box = document.createElement("div"); box.id = "tipbox"; box.setAttribute("role","tooltip"); document.body.appendChild(box); } return box; }
  function show(el){
    var b = ensure(); cur = el;
    b.textContent = el.getAttribute("data-tip");
    b.classList.add("on");
    var r = el.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var y = r.bottom + 8; if(y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
    b.style.left = x + "px"; b.style.top = y + "px";
  }
  function hide(){ if(box) box.classList.remove("on"); cur = null; }
  function find(e){ return e.target && e.target.closest ? e.target.closest("[data-tip]") : null; }
  document.addEventListener("mouseover", function(e){ var el = find(e); if(el && el !== cur) show(el); else if(!el && cur) hide(); });
  document.addEventListener("focusin", function(e){ var el = find(e); if(el) show(el); });
  document.addEventListener("focusout", hide);
  document.addEventListener("click", function(e){ var el = find(e); if(el && el !== cur) show(el); else hide(); });
  window.addEventListener("scroll", hide, { passive: true });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape") hide(); });
})();
