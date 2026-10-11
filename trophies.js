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

  /* タブ：全勝の多い2色の上位3つ＋ねらい目（重複は1つに） */
  function tabsOf(data, report){
    const two = data.colors.filter(c => /^[WUBRG]{2}$/.test(c.colors));
    const top = two.slice(0, 3).map((c, i) => ({ colors: c.colors, kind: "top", i: i + 1 }));
    const sl = (typeof sleeperPairs === "function" ? sleeperPairs(report) : [])
      .filter(c => !top.some(x => x.colors === c)).map(c => ({ colors: c, kind: "sleeper" }));
    return [...top, ...sl].map(x => ({ ...x, entry: data.colors.find(c => c.colors === x.colors) || null }));
  }

  function deckHtml(s){
    const cards = s.cards.slice().sort((a, b) => (a[2] ?? 99) - (b[2] ?? 99) || displayName(a[0]).localeCompare(displayName(b[0])));
    return `<div class="tgrid">${cards.map(([name, n]) => {
      const u = imageUrls(name)[0];
      return `<div class="tcard" data-img="${esc(name)}" title="${esc(displayName(name))}">${u ? `<img src="${esc(u)}" alt="${esc(displayName(name))}" loading="lazy">` : `<span class="nm">${esc(displayName(name))}</span>`}${n > 1 ? `<span class="cnt">×${n}</span>` : ""}</div>`;
    }).join("")}</div>
    <p class="tnote">${esc(t("reports.trophy.lands", { n: s.lands }))}</p>`;
  }

  function paint(){
    const { data, tabs, tab, idx, box, report } = state;
    const cur = tabs[tab], e = cur && cur.entry, samples = e ? e.samples : [];
    const s = samples[Math.min(idx, samples.length - 1)];
    const tabBtn = (x, i) => `<button type="button" class="ttab${i === tab ? " on" : ""}" data-tab="${i}">${[...x.colors].map(manaI).join("")}${esc(pairName(x.colors))}${x.kind === "sleeper" ? `<span class="slp">${esc(t("reports.tier.sleeper"))}</span>` : `<small>${esc(t("reports.trophy.top", { i: x.i }))}</small>`}</button>`;
    box.innerHTML = `<h2>${esc(t("reports.trophy.h"))}</h2>
      <p class="lead">${esc(t(report.mode === "sealed" ? "reports.trophy.leadS" : "reports.trophy.lead"))}</p>
      <div class="ttabs">${tabs.map(tabBtn).join("")}</div>
      ${e ? `<p class="tstat">${esc(t("reports.trophy.stat", { n: e.trophies.toLocaleString(), s: pctTxt(e.share), r: pctTxt(e.trophy_rate) }))}</p>` : ""}
      ${s ? `<div class="tnav"><button type="button" data-nav="-1" aria-label="${esc(t("reports.trophy.prev"))}" ${idx <= 0 ? "disabled" : ""}>‹</button>
        <span>${esc(t("reports.trophy.sample", { i: idx + 1, n: samples.length }))}　${esc(t("reports.trophy.info", {
          w: s.wins, l: s.losses, rank: t("rank." + (s.rank || "")), ev: t("ev." + s.event),
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
