/* 各ページの下に出す「日本の TCG サプライ」の小さな枠。
 * data/products/current.json（毎週月曜に Actions が作る）から 4 点を選んで、画像と購入ボタンを出す。
 * ページ側は <div id="goodsStrip"></div> を置くだけ。言語は I18N.lang に合わせる。
 * ナビの「日本のサプライ」のリンク先も言語に合わせてここで直す。 */
(function(){
  function render(){
  var lang = (window.I18N && I18N.lang) || (document.documentElement.lang === "en" ? "en" : "ja");
  var T = lang === "en"
    ? { h: "Japanese TCG supplies", lead: "Sleeves and deck boxes you can only get in Japan — ships worldwide via Buyee.", buy: "Buy via Buyee", more: "See all →", pr: "Contains affiliate links" }
    : { h: "日本の TCG サプライ", lead: "日本のプレイヤーが使っている定番と、今週のキャラクタースリーブ。", buy: "楽天市場で見る", more: "もっと見る →", pr: "PR" };
  var goodsHref = "./goods/index" + (lang === "en" ? ".en" : "") + ".html";
  document.querySelectorAll("a[data-goods-link]").forEach(function(a){ a.href = goodsHref; });

  var box = document.getElementById("goodsStrip");
  if(!box) return;
  var css = ".gstrip{max-width:1100px;margin:28px auto 20px;padding:16px 24px 0;border-top:1px solid var(--line,#D3DFEB)}" +
    ".gstrip .gh{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 4px}.gstrip h2{font-size:15px;margin:0}.gstrip .gpr{font-size:10.5px;color:var(--muted,#5C7185);border:1px solid var(--line,#D3DFEB);border-radius:3px;padding:0 5px}" +
    ".gstrip .gmore{margin-left:auto;font-size:12.5px}.gstrip .glead{font-size:12.5px;color:var(--muted,#5C7185);margin:0 0 10px}" +
    ".gstrip ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}" +
    ".gstrip li{background:#fff;border:1px solid var(--line,#D3DFEB);border-radius:8px;padding:8px;display:flex;gap:8px;align-items:flex-start}" +
    ".gstrip .gi{flex:none;width:64px;height:64px;border-radius:6px;overflow:hidden;background:var(--paper-2,#EAF0F6)}.gstrip .gi img{width:100%;height:100%;object-fit:contain;display:block}" +
    ".gstrip .gt{min-width:0}.gstrip .gn{font-size:12px;font-weight:700;line-height:1.35;margin:0 0 2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
    ".gstrip .gp{font-size:12px;margin:0 0 5px}.gstrip .gb{display:inline-block;font-size:11.5px;padding:4px 9px;border-radius:999px;background:var(--pine,#0F2A44);color:#fff;text-decoration:none}" +
    "@media (max-width:720px){.gstrip{padding:14px 12px 0}}";
  if(!document.getElementById("gstripCss")){ var st = document.createElement("style"); st.id = "gstripCss"; st.textContent = css; document.head.appendChild(st); }

  fetch("./data/products/current.json", { cache: "no-cache" }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if(!d) return;
    var rot = [].concat.apply([], Object.keys(d.rotating || {}).map(function(k){ return d.rotating[k]; }));
    var fixed = d.fixed || [];
    // 日替わりで並びを変える（同じ日は同じ並び）
    var day = Math.floor(Date.now() / 86400000);
    var pick = function(arr, n, off){ var out = []; for(var i = 0; i < arr.length && out.length < n; i++) out.push(arr[(i + off) % arr.length]); return out; };
    var items = pick(fixed, 1, day % Math.max(1, fixed.length)).concat(pick(rot, 3, day % Math.max(1, rot.length)));
    if(!items.length) return;
    var esc = function(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var html = '<section class="gstrip"><div class="gh"><h2>' + esc(T.h) + '</h2><span class="gpr">' + esc(T.pr) + '</span><a class="gmore" href="' + goodsHref + '">' + esc(T.more) + '</a></div><p class="glead">' + esc(T.lead) + '</p><ul>';
    items.forEach(function(it){
      var name = lang === "en" ? (it.labelEn || it.name) : (it.labelJa || it.name);
      var link = lang === "en" ? ((it.links && it.links.buyee) || it.affiliateUrl) : ((it.links && it.links.rakuten) || it.affiliateUrl);
      var price = "¥" + Number(it.price).toLocaleString(lang === "en" ? "en-US" : "ja-JP") + (lang === "en" ? " (~$" + Math.round(it.price / 150) + ")" : "");
      html += '<li><a class="gi" href="' + esc(it.affiliateUrl) + '" target="_blank" rel="noopener sponsored"><img src="' + esc(it.image) + '" alt="" loading="lazy"></a>' +
        '<div class="gt"><p class="gn">' + esc(name) + '</p><p class="gp">' + esc(price) + '</p><a class="gb" href="' + esc(link) + '" target="_blank" rel="noopener sponsored">' + esc(T.buy) + '</a></div></li>';
    });
    html += '</ul></section>';
    box.innerHTML = html;
  }).catch(function(){});
  }
  render();
  if(window.I18N && I18N.onChange) I18N.onChange(render);   // 言語を切り替えたら枠も出し直す
})();
