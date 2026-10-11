/* 環境レポート：全勝デッキのサンプル（reports.html から使う）
   data/trophies/<SET>_<draft|sealed>.json（maintenance/build-trophies.mjs が作る）を読み、
   全勝の多い色の組み合わせ（上位3つ）と、ねらい目の組み合わせ（reports.html の sleeperPairs）をタブで並べる。
   デッキは土地を除いたカード画像の一覧。サンプルは「前／次」で切り替える。
   ページ側の t・esc・pct・manaI・imageUrls・displayName・sleeperPairs を使う */
(function(){
  const cache = {};
  let state = null;          // { data, tabs, tab, idx, box, report }

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

  /* タブ：全勝の多い2色の上位3つ＋ねらい目（重複は1つに） */
  function tabsOf(data, report){
    const two = data.colors.filter(c => /^[WUBRG]{2}$/.test(c.colors));
    const top = two.slice(0, 3).map((c, i) => ({ colors: c.colors, kind: "top", i: i + 1 }));
    const sleepers = typeof sleeperPairs === "function" ? sleeperPairs(report) : [];
    top.forEach(x => { x.sleeper = sleepers.includes(x.colors); });   // 上位でもねらい目なら印を付ける
    const sl = sleepers.filter(c => !top.some(x => x.colors === c)).map(c => ({ colors: c, kind: "sleeper", sleeper: true }));
    return [...top, ...sl].map(x => ({ ...x, entry: data.colors.find(c => c.colors === x.colors) || null }));
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
    const { data, tabs, tab, idx, box, report } = state;
    const cur = tabs[tab], e = cur && cur.entry, samples = e ? e.samples : [];
    const s = samples[Math.min(idx, samples.length - 1)];   // samples はレアの少ない順（sortSamples）
    const tabBtn = (x, i) => `<button type="button" class="ttab${i === tab ? " on" : ""}" data-tab="${i}">${[...x.colors].map(manaI).join("")}${esc(pairName(x.colors))}${x.kind === "top" ? `<small>${esc(t("reports.trophy.top", { i: x.i }))}</small>` : ""}${x.sleeper ? `<span class="slp">${esc(t("reports.tier.sleeper"))}</span>` : ""}</button>`;
    box.innerHTML = `<h2>${esc(t("reports.trophy.h"))}</h2>
      <p class="lead">${esc(t(report.mode === "sealed" ? "reports.trophy.leadS" : "reports.trophy.lead"))}</p>
      <div class="ttabs">${tabs.map(tabBtn).join("")}</div>
      ${e ? `<p class="tstat">${esc(t("reports.trophy.stat", { n: e.trophies.toLocaleString(), s: pctTxt(e.share), r: pctTxt(e.trophy_rate) }))}</p>` : ""}
      ${s ? `<div class="tnav"><button type="button" data-nav="-1" aria-label="${esc(t("reports.trophy.prev"))}" ${idx <= 0 ? "disabled" : ""}>‹</button>
        <span>${esc(t("reports.trophy.sample", { i: idx + 1, n: samples.length }))}　${esc(t("reports.trophy.info", {
          w: s.wins, l: s.losses, rank: t("rank." + (s.rank || "")), ev: t("ev." + s.event), r: raresOf(s),
          splash: s.splash ? t("reports.trophy.splash", { c: [...s.splash].map(k => t("color." + k)).join("") }) : "" }))}</span>
        <button type="button" data-nav="1" aria-label="${esc(t("reports.trophy.next"))}" ${idx >= samples.length - 1 ? "disabled" : ""}>›</button></div>
        ${deckHtml(s)}` : `<p class="tnote">${esc(t("reports.trophy.none"))}</p>`}
      <p class="tnote">${esc(t("reports.trophy.src"))}</p>`;
    box.hidden = false;
  }

  async function show(set, mode, box){
    if(!box) return;
    box.hidden = true;
    const data = await fetchData(set, mode);
    const report = (typeof window.__report === "function") ? window.__report() : null;
    if(!data || !data.colors || !data.colors.length || !box.isConnected) return;
    const keep = state && state.data === data ? state : null;
    state = { data, report: report || { set, mode, archetypes: [], overall_win_rate: 0.5 }, box, tabs: [], tab: keep ? keep.tab : 0, idx: keep ? keep.idx : 0 };
    sortSamples(data);
    state.tabs = tabsOf(data, state.report);
    if(state.tab >= state.tabs.length) state.tab = 0;
    paint();
  }

  document.addEventListener("click", ev => {
    if(!state || !state.box.contains(ev.target)) return;
    const tb = ev.target.closest("[data-tab]");
    if(tb){ state.tab = +tb.dataset.tab; state.idx = 0; paint(); return; }
    const nv = ev.target.closest("[data-nav]");
    if(nv && !nv.disabled){ state.idx += +nv.dataset.nav; paint(); }
  });

  window.Trophies = { show };
})();
