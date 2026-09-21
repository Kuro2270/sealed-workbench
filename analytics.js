/*
 * アクセス解析（Cloudflare Web Analytics）の読み込みと、自分の端末を数えないための仕組み。
 *
 * Cloudflare には「自分の訪問を除外する」設定が無いので、こちらで持つ。
 *   ・https://sealed-workbench.com/?noan=1  … このブラウザを計測から外す
 *   ・https://sealed-workbench.com/?noan=0  … 外したのをやめて、また計測する
 * 外したかどうかはブラウザの中に残るので、一度開けば以後ずっと効く。
 * 端末やブラウザを変えたときは、そちらでもう一度 ?noan=1 を開くこと。
 *
 * 使うには、Cloudflare のダッシュボードで
 *   Web Analytics → 対象サイト → Manage site → 自動挿入（Automatic setup）を切る
 * そのうえで、そこに出ているトークンを下の TOKEN に貼る。
 * 自動挿入のままだと Cloudflare 側が勝手にタグを入れてしまい、この除外が効かない。
 */
(function () {
  "use strict";

  // ← Cloudflare Web Analytics のトークン（32文字の英数字）をここに貼る。
  //    空のままなら、計測タグは一切読み込まない。
  var TOKEN = "32d21160c1494016aa4395040bf744b5";

  var KEY = "sw.noanalytics";

  function flag(v) {
    try {
      if (v === null) localStorage.removeItem(KEY);
      else if (v !== undefined) localStorage.setItem(KEY, v);
      else return localStorage.getItem(KEY);
    } catch (e) { /* 保存できない設定のブラウザでも落ちないようにする */ }
    return null;
  }

  /* 切り替えたことが分かるように、短いおしらせを出す */
  function notice(text) {
    function show() {
      var d = document.createElement("div");
      d.textContent = text;
      d.setAttribute("style", [
        "position:fixed", "left:50%", "bottom:24px", "transform:translateX(-50%)",
        "background:#23342E", "color:#F3F5F1", "padding:10px 18px", "border-radius:4px",
        "border:1px solid #B8912F", "font:500 13px/1.5 system-ui,sans-serif",
        "z-index:99999", "box-shadow:0 4px 14px rgba(0,0,0,.25)", "max-width:90vw", "text-align:center"
      ].join(";"));
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 6000);
    }
    if (document.body) show();
    else document.addEventListener("DOMContentLoaded", show);
  }

  var ja = (navigator.language || "en").toLowerCase().indexOf("ja") === 0;
  try {
    var saved = localStorage.getItem("sw.lang");
    if (saved === "ja" || saved === "en") ja = saved === "ja";
  } catch (e) {}

  /* URL の指示を処理する */
  var q = null;
  try { q = new URLSearchParams(location.search).get("noan"); } catch (e) {}
  if (q === "1") {
    flag("1");
    notice(ja ? "このブラウザからのアクセスは、以後アクセス解析に数えません。"
              : "Visits from this browser will no longer be counted.");
  } else if (q === "0") {
    flag(null);
    notice(ja ? "このブラウザからのアクセスを、また数えるようにしました。"
              : "Visits from this browser are counted again.");
  }

  if (flag() === "1") return;   // 自分の端末なので、計測タグは読み込まない
  if (!/^[0-9a-f]{20,64}$/i.test(TOKEN)) return;

  // 以前の「EUの訪問者は計測しない」設定を引き継ぐ。
  // ブラウザからは国が分からないので、時間帯がヨーロッパのものなら読み込まない（EU外の欧州も外れるが、控えめな側に倒す）
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/^Europe\//.test(tz) || /^Atlantic\/(Canary|Madeira|Azores)$/.test(tz)) return;
  } catch (e) {}

  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", '{"token":"' + TOKEN + '"}');
  (document.head || document.documentElement).appendChild(s);
})();
