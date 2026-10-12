/*
 * Buyee で注文できない楽天のショップを見分ける（英語ページの「Buy via Buyee」が行き止まりにならないように）。
 *
 * Buyee は楽天の一部のショップ（例：Joshin web＝jism）の商品を代理購入できず、商品ページに
 * 「We are unable to proceed with your order from this store.」と出る。楽天の API ではこれが分からないので、
 *   1. data/products/config.json の buyeeNgShops（手で書いた一覧）
 *   2. data/products/buyee-ng-shops.json（このファイルが Buyee の商品ページを見て見つけたもの。次回以降も使う）
 * の2つでショップを除く。
 * 2 の見分けは「Buyee の商品ページの HTML にその文言が入っていれば注文不可」という確かめ方で、
 * 文言が画面の読み込み後に出る作りだと見つけられない（そのときは何もしない＝今までどおり）。見つからなければ 1 に手で足す。
 * 役割はこれだけ。商品の選定は build-products.mjs。
 */
import { readFile, writeFile } from "node:fs/promises";

const LEARNED = "data/products/buyee-ng-shops.json";
const NG_TEXT = [/unable to proceed with your order from this store/i, /このストアの商品は.{0,20}(ご注文|購入).{0,10}できません/];
const UA = "Mozilla/5.0 (sealed-workbench product builder)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function createBuyeeChecker(manualShops = [], itemUrl){
  const learned = await readFile(LEARNED, "utf8").then(JSON.parse).catch(() => ({}));   // { shopCode: "見つけた日" }
  const ng = new Set([...manualShops, ...Object.keys(learned)]);
  const okShops = new Set();
  let lastCall = 0, checks = 0, found = [];

  /* そのショップの商品を Buyee で注文できるか。分からないとき（通信できない等）は true（できる扱い） */
  async function orderable(it){
    const shop = it.shopCode || String(it.code || "").split(":")[0];
    if(ng.has(shop)) return false;
    if(okShops.has(shop) || checks >= 60) return true;    // 1回の実行で見に行くのは60ショップまで
    checks++;
    const wait = 1500 - (Date.now() - lastCall); if(wait > 0) await sleep(wait);
    lastCall = Date.now();
    try{
      const r = await fetch(itemUrl(it), { headers: { "User-Agent": UA, "Accept-Language": "en" }, redirect: "follow" });
      if(!r.ok){ okShops.add(shop); return true; }
      const html = await r.text();
      if(NG_TEXT.some(re => re.test(html))){
        ng.add(shop); learned[shop] = new Date().toISOString().slice(0, 10); found.push(`${shop}（${it.shop || ""}）`);
        console.error(`Buyee: 注文できないショップを見つけたので外します → ${shop} ${it.shop || ""}`);
        return false;
      }
      okShops.add(shop); return true;
    }catch(e){ okShops.add(shop); return true; }
  }
  /* 見つけたショップを次回のために残す */
  async function save(){
    if(found.length) await writeFile(LEARNED, JSON.stringify(learned, null, 1) + "\n", "utf8");
    return found;
  }
  return { orderable, save, isNg: shop => ng.has(shop) };
}
