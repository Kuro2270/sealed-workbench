/*
 * セットの外から入っているカード（スペシャルゲストなどの特別枠）を Scryfall で引く。役割はこれだけ。
 *
 *   import { lookupOutside } from "./outside-cards.mjs";
 *   const info = await lookupOutside(["Sublime Epiphany"], "FRA");
 *   // → { "Sublime Epiphany": { ja: "崇高な天啓", img: 日本語版の画像, imgEn: 英語版の画像, slot: "spg" } }
 *
 * 発売直後の速報データ（17Lands）には、セット外の特別枠のカードもそのまま入ってくる。
 * セットの検索（set:fra）では出てこないので、日本語名もカード画像も無いまま動画に載ってしまう。そこで名前で引き直す。
 *   ・英語版の画像と oracle_id：名前で引く（/cards/collection）
 *   ・日本語名と日本語版の画像：同じ oracle_id の日本語版を探す（無ければ英語版の画像のまま）
 *   ・slot：スペシャルゲスト（Scryfall のセット spg）に入っているカードなら "spg"、それ以外の特別枠は "other"。
 *     そのセット（set）自体に入っているカードなら null（カード一覧が古いだけ。特別枠ではない）
 * 引けなかったカードは結果に入れない（呼ぶ側は今までどおり名前の札で出す）。
 */

const SCRY = process.env.SCRY_API || "https://api.scryfall.com";
const HEADERS = { "User-Agent": "sealed-workbench/1.0 (https://sealed-workbench.com)", Accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const front = s => String(s || "").split(" // ")[0].trim();
const imgOf = c => (c.image_uris && c.image_uris.normal) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal) || "";
const noRuby = s => String(s || "").replace(/([\u4E00-\u9FFF々〆ヵヶ])[（(][\u3041-\u3096ー]+[）)]/g, "$1");   // 漢字のふりがなを外す（build-set-pages.mjs と同じ）

async function search(q){
  const out = [];
  let url = `${SCRY}/cards/search?q=${encodeURIComponent(q)}`;
  while(url){
    let d;
    try{
      const r = await fetch(url, { headers: HEADERS });
      if(!r.ok) break;
      d = await r.json();
    }catch(e){ break; }
    out.push(...(d.data || []));
    url = d.has_more ? d.next_page : null;
    await sleep(120);
  }
  return out;
}

export async function lookupOutside(names, set){
  const want = [...new Set((names || []).map(front).filter(Boolean))];
  const out = {};
  if(!want.length) return out;
  const byOracle = {};
  for(let i = 0; i < want.length; i += 75){
    try{
      const r = await fetch(`${SCRY}/cards/collection`, { method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: want.slice(i, i + 75).map(name => ({ name })) }) });
      if(r.ok) for(const c of (await r.json()).data || []){
        const name = front(c.name);
        if(!c.oracle_id) continue;
        byOracle[c.oracle_id] = name;
        out[name] = { ja: "", img: imgOf(c), imgEn: imgOf(c), slot: "other" };
      }
    }catch(e){}
    await sleep(120);
  }
  const ids = Object.keys(byOracle);
  for(let i = 0; i < ids.length; i += 15){
    const or = "(" + ids.slice(i, i + 15).map(x => "oracleid:" + x).join(" or ") + ")";
    // 日本語版（名前と画像）
    for(const c of await search(`lang:ja ${or} unique:prints`)){
      const o = out[byOracle[c.oracle_id]];
      if(!o || c.lang !== "ja" || o.ja) continue;
      o.ja = noRuby((c.card_faces && c.card_faces[0] && c.card_faces[0].printed_name) || front(c.printed_name));
      if(imgOf(c)) o.img = imgOf(c);
    }
    // スペシャルゲストに入っているか（英語版の画像も、特別枠の版にそろえる）
    for(const c of await search(`set:spg ${or} unique:prints`)){
      const o = out[byOracle[c.oracle_id]];
      if(!o) continue;
      o.slot = "spg";
      if(imgOf(c)) o.imgEn = imgOf(c);
    }
    // そのセット自体に入っているなら、特別枠ではない
    if(set) for(const c of await search(`set:${String(set).toLowerCase()} ${or} unique:prints`)){
      const o = out[byOracle[c.oracle_id]];
      if(o) o.slot = null;
    }
  }
  return out;
}
