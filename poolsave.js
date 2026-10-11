/*
 * プールの自動保存（シールド／ドラフト共通）。
 *  - 状態が変わるたびに端末の localStorage へ保存。リロードしても続きから再開できる。
 *  - 新しくパックを開ける／ドラフトを始める直前に、いまのプールを「過去のプール」へ退避（最大5件）。
 *  - 最後の保存から1日たったプールは、次に開いたときに「過去のプール」へ移し、続きからは出さない。
 *  - カードは同じものを1つにまとめ、重いデータ（価格・リンク類）を捨てて小さくしてから保存する。
 */
(function(){
  const DROP = new Set(["prices","purchase_uris","related_uris","legalities","all_parts","rulings_uri",
    "scryfall_uri","uri","prints_search_uri","set_uri","set_search_uri","set_id","oracle_id","multiverse_ids",
    "mtgo_id","arena_id","tcgplayer_id","cardmarket_id","edhrec_rank","penny_rank","artist_ids","illustration_id",
    "card_back_id","games","finishes","promo_types","frame_effects","security_stamp","flavor_text","artist"]);
  const MAX_HIST = 5;
  const STALE_MS = 24 * 60 * 60 * 1000;   // 続きから出すのは最後の保存から1日以内
  const strip = c => { const o = {}; for(const k in c) if(!DROP.has(k)) o[k] = c[k]; return o; };

  /* {cards:{id:card}, arrays:{name:[id,...]}} にまとめる／元に戻す */
  function pack(obj, cardArrays){
    const cards = {}, arrays = {};
    for(const k in cardArrays){
      arrays[k] = cardArrays[k].map(c => { if(!cards[c.id]) cards[c.id] = strip(c); return c.id; });
    }
    return Object.assign({}, obj, {cards, arrays});
  }
  function unpack(s){
    const out = {}, cards = s.cards || {};
    for(const k in s.arrays) out[k] = s.arrays[k].map(id => cards[id]).filter(Boolean);
    return out;
  }

  function get(k){ try{ return JSON.parse(localStorage.getItem(k) || "null"); }catch(e){ return null; } }
  function set(k, v){
    try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; }   // 容量超過・非公開モードでも画面は動かす
  }

  window.PoolSave = {
    pack, unpack,
    save(key, snap){ set("sw.cur." + key, snap); },
    load(key){ return get("sw.cur." + key); },
    clear(key){ try{ localStorage.removeItem("sw.cur." + key); }catch(e){} },
    /* いまのプールを履歴の先頭へ。同じ保存時刻のものは重ねない */
    archive(key, snap){
      if(!snap || !snap.n) return;
      const h = get("sw.hist." + key) || [];
      if(h.length && h[0].ts === snap.ts) return;
      h.unshift(snap);
      while(h.length > MAX_HIST){
        h.pop();
      }
      while(h.length && !set("sw.hist." + key, h)) h.pop();   // 入りきらないときは古いものから捨てる
    },
    /* 最後の保存から1日（STALE_MS）たったプールは、開いたときに続きから出さず「過去のプール履歴」へ移す。
       リロードで困るのは構築中の数十分〜数時間だけなので、翌日以降はまっさらな画面から始める。移したら true */
    retireStale(key){
      const s = get("sw.cur." + key);
      if(!s || !s.n || !s.ts || Date.now() - s.ts < STALE_MS) return false;
      this.archive(key, s);
      this.clear(key);
      this.retired = true;                  // 画面の案内文で「履歴に移した」と添えるため
      if(this.redraw) this.redraw();
      return true;
    },
    history(key){ return get("sw.hist." + key) || []; },
    remove(key, i){ const h = get("sw.hist." + key) || []; h.splice(i, 1); set("sw.hist." + key, h); },
    fmt(ts){
      const d = new Date(ts), p = n => String(n).padStart(2, "0");
      return (d.getMonth()+1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
  };
  /* 「過去のプール」一覧。key=sealed/draft、onRestore(snap)=切り替え処理 */
  window.PoolSave.mountHistory = function(key, host, onRestore){
    const tt = (k, v) => (window.t ? window.t(k, v) : k);
    const draw = () => {
      const h = window.PoolSave.history(key);
      host.hidden = !h.length;
      if(!h.length){ host.innerHTML = ""; return; }
      const open = host.querySelector("details") && host.querySelector("details").open;
      host.innerHTML = "";
      const d = document.createElement("details"); d.open = !!open;
      const sm = document.createElement("summary"); sm.textContent = tt("save.hist", {n: h.length});
      d.appendChild(sm);
      const note = document.createElement("div"); note.style.cssText = "color:#A9C2DE;margin-top:6px"; note.textContent = tt("save.note");
      d.appendChild(note);
      const ul = document.createElement("ul");
      h.forEach((snap, i) => {
        const li = document.createElement("li");
        const lab = document.createElement("span");
        lab.textContent = window.PoolSave.fmt(snap.ts) + "　" + (snap.setCode || "").toUpperCase() + "　" + tt("save.cards", {n: snap.n}) +
          (snap.phase === "draft" ? "　" + tt("save.draftMid") : "");
        const r = document.createElement("button"); r.textContent = tt("save.restore");
        r.onclick = () => { window.PoolSave.remove(key, i); onRestore(snap); draw(); };
        const x = document.createElement("button"); x.textContent = tt("save.delete");
        x.onclick = () => { window.PoolSave.remove(key, i); draw(); };
        li.append(lab, r, x); ul.appendChild(li);
      });
      d.appendChild(ul); host.appendChild(d);
    };
    window.PoolSave.redraw = draw;
    draw();
    return draw;
  };
})();
