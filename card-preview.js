/* data-img（カード画像のURL）を持つ要素で、カードの画像を見せる。役割はこれだけ（セット別ページの Tier 表・カード一覧で使う）。
   パソコン：カーソルを合わせると、カーソルの横に出す
   スマホ（カーソルの無い端末）：タップか長押しで画面の中央に出し、どこかをタップすると閉じる */
(function(){
  var TOUCH = window.matchMedia && window.matchMedia("(hover: none)").matches;
  var css =
    "#cprev{position:fixed;z-index:60;pointer-events:none;display:none;filter:drop-shadow(0 10px 24px rgba(15,28,23,.35))}" +
    "#cprev img{display:block;width:244px;height:auto;border-radius:11px}" +
    "#cprev.tap{display:block;left:50% !important;top:50% !important;transform:translate(-50%,-50%);pointer-events:auto}" +
    "#cprev.tap img{width:min(300px,78vw)}" +
    "#cprevdim{display:none;position:fixed;inset:0;z-index:59;background:rgba(15,28,23,.55)}" +
    "#cprevdim.on{display:block}" +
    "[data-img]{cursor:zoom-in}" +
    "@media (hover:none){[data-img]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var box, dim;
  function ensure(){
    if(box) return;
    box = document.createElement("div"); box.id = "cprev"; box.setAttribute("aria-hidden", "true");
    dim = document.createElement("div"); dim.id = "cprevdim";
    document.body.appendChild(dim); document.body.appendChild(box);
    dim.addEventListener("click", close);
  }
  function fill(el){
    ensure();
    box.innerHTML = "";
    var img = document.createElement("img");
    img.src = el.getAttribute("data-img"); img.alt = el.getAttribute("data-alt") || "";
    box.appendChild(img);
  }
  function place(x, y){
    var w = 252, h = box.offsetHeight || 350;
    var left = x + 18, top = y - h / 2;
    if(left + w > window.innerWidth - 8) left = x - w - 18;
    if(left < 8) left = 8;
    top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
    box.style.left = left + "px"; box.style.top = top + "px";
  }
  function hide(){ if(box && !box.classList.contains("tap")){ box.style.display = "none"; box.innerHTML = ""; } }
  function openTap(el){ fill(el); box.classList.add("tap"); box.style.display = "block"; box.style.left = ""; box.style.top = ""; dim.classList.add("on"); }
  function close(){ if(!box) return; box.classList.remove("tap"); box.style.display = "none"; box.innerHTML = ""; dim.classList.remove("on"); }
  var isOpen = function(){ return box && box.classList.contains("tap"); };

  if(!TOUCH){
    // パソコン：カーソルを合わせているあいだだけ出す
    var cur = null;
    document.addEventListener("mouseover", function(e){
      var el = e.target.closest && e.target.closest("[data-img]");
      if(el === cur) return;
      cur = el;
      if(!el){ hide(); return; }
      fill(el); box.style.display = "block"; place(e.clientX, e.clientY);
    });
    document.addEventListener("mousemove", function(e){ if(cur && box && box.style.display === "block") place(e.clientX, e.clientY); });
    window.addEventListener("scroll", function(){ cur = null; hide(); }, { passive: true });
    return;
  }

  // スマホ：タップで開く。開いているときのタップは閉じる
  document.addEventListener("click", function(e){
    var el = e.target.closest && e.target.closest("[data-img]");
    if(isOpen()){ close(); return; }
    if(el) openTap(el);
  });
  // 長押し（約0.45秒）でも開く。長押しに続くタップは打ち消す。指が動いたら（スクロール）取りやめる
  var timer = null, fired = false;
  document.addEventListener("touchstart", function(e){
    var el = e.target.closest && e.target.closest("[data-img]");
    fired = false; clearTimeout(timer);
    if(!el || isOpen()) return;
    timer = setTimeout(function(){ fired = true; openTap(el); }, 450);
  }, { passive: true });
  document.addEventListener("touchmove", function(){ clearTimeout(timer); }, { passive: true });
  document.addEventListener("touchcancel", function(){ clearTimeout(timer); }, { passive: true });
  document.addEventListener("touchend", function(e){ clearTimeout(timer); if(fired){ e.preventDefault(); fired = false; } }, { passive: false });
  document.addEventListener("contextmenu", function(e){ if(e.target.closest && e.target.closest("[data-img]")) e.preventDefault(); });
})();
