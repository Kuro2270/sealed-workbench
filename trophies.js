/* 環境レポート：全勝デッキのサンプル（reports.html から使う）
   data/trophies/<SET>_<draft|sealed>.json（maintenance/build-trophies.mjs が作る）を読み、
   色の組み合わせのTier表で選んだ組み合わせ（ボタン .tchip[data-pair]）のサンプルを、Tier表のすぐ下に出す。
   はじめは、Tier表の一番上（最強）の組み合わせ。サンプルは「前／次」で切り替える（2026年10月：上位3つ＋ねらい目のタブから変更）。
   ページ側の t・esc・pct・manaI・imageUrls・displayName・fillMissing を使う */
(function(){
  const cache = {};
  let state = null;          // { data, pair, idx, box, report }

  async function fetchData(set, mode){
    const key = set + "_" + mode;
    if(key in cache) return cache[key];
    try{
      const r = await fetch(`./data/trophies/${key}.json`, { cache: "no-cache" });
      cache[key] = r.ok ? await r.json() : null;
    }catch(e){ cache[key] = null; }
    return cache[key];
  }
  const pairName = c => [...c].map(k => t("color." + k)).join(I18N.isJa() ? "／" : " / ");
  const pctTxt = v => (v * 100).toFixed(v < 0.1 ? 1 : 0) + "%";

  /* レア・神話レアの枚数。データに無ければ（古いデータ）ページの Scryfall 情報から数える */
  function raresOf(s){
    if(typeof s.rares === "number") return s.rares;
    const map = typeof nameMap === "object" ? nameMap : {};
    return [...s.cards, ...(s.land_cards || [])].reduce((m, [name, n]) => m + (/^(rare|mythic)$/.test((map[name] || {}).rarity || "") ? n : 0), 0);
  }
  /* レアの少ないデッキを先に（0枚 → 1枚 → 2枚 → それ以上）。同じなら集計側の順（ランクの高い順） */
  function sortSamples(data){
    for(const c of data.colors){
      if(c._sorted) continue;
      c.samples = c.samples.map((s, i) => ({ s, i, r: Math.min(raresOf(s), 3) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.s);
      c._sorted = true;
    }
  }

  /* Tier表のボタンの選択の印を、今の組み合わせに合わせる */
  function markChips(){
    document.querySelectorAll(".tchip[data-pair]").forEach(b => {
      const on = !!state && b.dataset.pair === state.pair;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    });
  }

  /* マナ総量 → 列（0〜1、2、3、4、5以上） */
  const COLS = [1, 2, 3, 4, 5];
  const colOf = cmc => Math.min(5, Math.max(1, cmc ?? 1));
  const colLabel = c => c === 1 ? t("reports.trophy.cost1") : c === 5 ? t("reports.trophy.cost5") : t("reports.trophy.cost", { c });

  /* セットのカード一覧に無い土地（基本土地など）は Scryfall の名前検索の画像を使う */
  const imgOf = (name, land) => imageUrls(name)[0] || (land ? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal` : "");

  function cardHtml(name, n, land){
    const u = imgOf(name, land), dn = displayName(name);
    const r = (typeof nameMap === "object" && nameMap[name] && nameMap[name].rarity) || "";
    return `<div class="tcard${/^(common|uncommon|rare|mythic)$/.test(r) ? " r-" + r : ""}" data-img="${esc(name)}" title="${esc(dn)}">${u ? `<img src="${esc(u)}" alt="${esc(dn)}">` : `<span class="nm">${esc(dn)}</span>`}${n ? `<span class="cnt">×${n}</span>` : ""}</div>`;
  }

  /* 土地：1種類1枚の画像に「×9」のように枚数を重ねる */
  function landsHtml(s){
    const list = Array.isArray(s.land_cards) ? s.land_cards : [];
    if(!list.length) return `<p class="tnote">${esc(t("reports.trophy.lands", { n: s.lands }))}</p>`;   // 古い形式のデータ
    return `<div class="tsect"><h3>${esc(t("reports.trophy.landsH", { n: s.lands }))}</h3>
      <div class="tlands">${list.map(([name, n]) => cardHtml(name, n, true)).join("")}</div></div>`;
  }

  /* 1段（クリーチャー or スペル）：マナ総量の列に分け、同じカードは枚数ぶん重ねる */
  function curveHtml(key, cards){
    const total = cards.reduce((n, c) => n + c.n, 0);
    if(!total) return "";
    const cols = COLS.map(c => {
      const list = cards.filter(x => colOf(x.cmc) === c)
        .sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || displayName(a.name).localeCompare(displayName(b.name)));
      const n = list.reduce((m, x) => m + x.n, 0);
      const body = list.flatMap(x => Array.from({ length: x.n }, () => cardHtml(x.name))).join("");
      return `<div class="tcol${n ? "" : " empty"}"><p class="ch">${esc(colLabel(c))} <b>${n}</b></p>${body}</div>`;
    }).join("");
    return `<div class="tsect"><h3>${esc(t(key, { n: total }))}</h3><div class="tcurve">${cols}</div></div>`;
  }

  function deckHtml(s){
    /* 種類とマナ総量はページで読んだ Scryfall の情報を優先（データ側は名前・枚数・マナ総量） */
    const cards = s.cards.map(([name, n, cmc]) => {
      const m = (typeof nameMap === "object" && nameMap[name]) || {};
      return { name, n, cmc: m.cmc ?? cmc, creature: typeof isCreature === "function" ? isCreature(name) : null };
    });
    /* 平均マナ総量（土地を除く。X は0として数える） */
    const nonland = cards.reduce((m, c) => m + c.n, 0);
    const avg = nonland ? cards.reduce((m, c) => m + (c.cmc ?? 0) * c.n, 0) / nonland : 0;
    return `${nonland ? `<p class="tavgmv">${t("reports.trophy.avgmv", { v: avg.toFixed(2), n: nonland })}</p>` : ""}
    <div class="tdeck">
      ${curveHtml("reports.trophy.creatures", cards.filter(c => c.creature !== false))}
      ${curveHtml("reports.trophy.spells", cards.filter(c => c.creature === false))}
      ${landsHtml(s)}
    </div>`;
  }

  function paint(){
    const { data, pair, idx, box, report } = state;
    const e = data.colors.find(c => c.colors === pair) || null, samples = e ? e.samples : [];
    const s = samples[Math.min(idx, samples.length - 1)];   // samples はレアの少ない順（sortSamples）
    const sep = I18N.isJa() ? "：" : ": ";
    box.innerHTML = `<h3 class="thead">${esc(t("reports.trophy.h"))}${esc(sep)}${[...pair].map(manaI).join("")}${esc(pairName(pair))}</h3>
      <p class="lead">${esc(t(report.mode === "sealed" ? "reports.trophy.leadS" : "reports.trophy.lead"))}</p>
      ${e ? `<p class="tstat">${esc(t("reports.trophy.stat", { n: e.trophies.toLocaleString(), s: pctTxt(e.share), r: pctTxt(e.trophy_rate) }))}</p>` : ""}
      ${s ? `<div class="tnav"><button type="button" data-nav="-1" aria-label="${esc(t("reports.trophy.prev"))}" ${idx <= 0 ? "disabled" : ""}>‹</button>
        <span>${esc(t("reports.trophy.sample", { i: idx + 1, n: samples.length }))}</span>
        <button type="button" data-nav="1" aria-label="${esc(t("reports.trophy.next"))}" ${idx >= samples.length - 1 ? "disabled" : ""}>›</button></div>
        ${deckHtml(s)}` : `<p class="tnote">${esc(t("reports.trophy.none"))}</p>`}
      ${s && !(typeof TOUCH !== "undefined" && TOUCH) ? `<p class="tnote">${esc(t("reports.trophy.tap"))}</p>` : ""}
      <p class="tnote">${esc(t("reports.trophy.src"))}</p>`;
    box.hidden = false;
    markChips();
    bindPreview(box);
  }

  /* カード画像の拡大（パソコンだけ）：カーソルを当てると横に大きく、クリックすると画面中央に大きく出す。
     スマホ・タブレットは重なった一覧のほうが見やすいので、拡大は付けない。
     （ページ側の showPreview・movePreview・hidePreview・tapPreview を使う） */
  function bindPreview(box){
    if(typeof TOUCH !== "undefined" && TOUCH) return;
    if(typeof showPreview !== "function") return;
    const big = () => document.getElementById("preview").classList.contains("tap");
    box.querySelectorAll(".tcard[data-img]").forEach(el => {
      const name = el.dataset.img;
      el.onmouseenter = ev => { if(!big()) showPreview(name, ev.clientX, ev.clientY); };
      el.onmousemove  = ev => { if(!big()) movePreview(ev.clientX, ev.clientY); };
      el.onmouseleave = () => { if(!big()) hidePreview(); };
      el.onclick = ev => {
        ev.stopPropagation();
        const u = imgOf(name, el.closest(".tlands") !== null);
        if(!u || typeof tapPreview !== "function") return;
        hidePreview();
        tapPreview([u], displayName(name));
      };
    });
  }


  async function show(set, mode, box){
    if(!box) return;
    box.hidden = true;
    const data = await fetchData(set, mode);
    const report = (typeof window.__report === "function") ? window.__report() : null;
    if(!data || !data.colors || !data.colors.length || !box.isConnected) return;
    // サンプルのデッキには、記事の上位カードに入っていないセット外のカード（スペシャルゲストなど）が出てくる。
    // ページの fillMissing で、その名前と画像を先に引いておく（引かないと画像の代わりに名前の文字だけになる）
    if(typeof fillMissing === "function"){
      const names = data.colors.flatMap(c => (c.samples || []).flatMap(s => (s.cards || []).map(x => x[0])));
      try{ await fillMissing(names); }catch(e){}
      if(!box.isConnected) return;
    }
    // 選べる組み合わせは、Tier表に並んでいるもの。同じセット・形式の表示し直しなら、選んでいた組み合わせを続ける
    const pairs = [...document.querySelectorAll(".tchip[data-pair]")].map(b => b.dataset.pair);
    if(!pairs.length) return;
    const keep = state && state.data === data && pairs.includes(state.pair) ? state : null;
    state = { data, report: report || { set, mode }, box, pair: keep ? keep.pair : pairs[0], idx: keep ? keep.idx : 0 };
    sortSamples(data);
    paint();
  }

  document.addEventListener("click", ev => {
    if(!state) return;
    // Tier表の組み合わせを押したら、その組み合わせのサンプルに切り替える
    const chip = ev.target.closest(".tchip[data-pair]");
    if(chip){
      if(chip.dataset.pair !== state.pair){ state.pair = chip.dataset.pair; state.idx = 0; paint(); }
      const r = state.box.getBoundingClientRect();
      if(r.top > window.innerHeight - 120) state.box.scrollIntoView({ behavior: "smooth", block: "start" });   // サンプルが画面の下に隠れているときだけ寄せる
      return;
    }
    if(!state.box.contains(ev.target)) return;
    const nv = ev.target.closest("[data-nav]");
    if(nv && !nv.disabled){ state.idx += +nv.dataset.nav; paint(); }
  });

  window.Trophies = { show };
})();
