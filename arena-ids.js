/* MTGアリーナのカード番号 → カード名（ドラフト補助・シールド補助で使う）。役割はこれだけ。
   ふだんは Scryfall のカード情報（arena_id）で番号からカードを特定するが、新しいセットは Scryfall への番号の登録が遅れることがある。
   そのときに、17Lands のカード一覧から作った対応表（data/arena-ids.json。「データ｜アリーナのカード番号」が毎日作る）でカード名を引く。

   await ArenaIds.load()     … 対応表を読む（1回だけ）
   ArenaIds.name(id)         … 番号のカード名。無ければ null
   ArenaIds.entries()        … [番号, カード名] の一覧
   ArenaIds.byName(cards)    … Scryfall のカードの配列から、名前（「表 // 裏」と表の名前の両方）→ カード の Map を作る */
const ArenaIds = (() => {
  let map = null, loading = null;
  const front = s => String(s || "").split(" // ")[0].trim();
  function load(){
    if(map) return Promise.resolve(map);
    if(!loading) loading = fetch("./data/arena-ids.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : {}).then(j => (map = j.ids || {})).catch(() => (map = {}));
    return loading;
  }
  function byName(list){
    const m = new Map();
    for(const c of list){ for(const k of [c.name, front(c.name)]) if(k && !m.has(k)) m.set(k, c); }
    return m;
  }
  return {
    load,
    name: id => (map && map[String(id)]) || null,
    entries: () => Object.entries(map || {}),
    byName,
    front
  };
})();
