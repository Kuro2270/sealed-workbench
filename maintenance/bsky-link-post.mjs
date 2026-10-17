/*
 * Bluesky に、リンクのカード（題・説明・画像）つきで1件投稿する。
 *   本文の URL とハッシュタグは押せるようにする（位置はバイト単位で指定する決まり）。
 *   カードの画像は、ページの共有画像（ogp-*.png）をそのまま上げる。
 * 役割はこれだけ。新セットの告知（release-post.mjs）から使う。
 *
 * 環境変数：BSKY_HANDLE, BSKY_APP_PASSWORD（無ければ投稿せずに知らせるだけ）
 */
import { readFile } from "node:fs/promises";

const BASE = "https://bsky.social/xrpc";

function facets(text){
  const out = [], enc = new TextEncoder();
  const at = i => enc.encode(text.slice(0, i)).length;
  let m;
  const url = /https?:\/\/\S+/g;
  while((m = url.exec(text))) out.push({ index: { byteStart: at(m.index), byteEnd: at(m.index) + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  const tag = /(?:^|\s)(#[^\s#]+)/g;
  while((m = tag.exec(text))){
    const s = m.index + m[0].indexOf("#");
    out.push({ index: { byteStart: at(s), byteEnd: at(s) + enc.encode(m[1]).length }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1].slice(1) }] });
  }
  return out;
}

/* card = { uri, title, description, image（ファイルの場所。無くてもよい） } */
export async function postBskyLink(text, card){
  const H = process.env.BSKY_HANDLE, P = process.env.BSKY_APP_PASSWORD;
  if(!H || !P) return { ok: false, message: "Bluesky: 鍵（BSKY_HANDLE / BSKY_APP_PASSWORD）が無いので投稿しませんでした" };
  const s = await fetch(`${BASE}/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: H, password: P }) });
  if(!s.ok) throw new Error(`Bluesky のログインに失敗 HTTP ${s.status}: ${(await s.text()).slice(0, 200)}`);
  const session = await s.json();
  const auth = { Authorization: `Bearer ${session.accessJwt}` };

  const external = { uri: card.uri, title: card.title, description: card.description };
  if(card.image){
    try{
      const buf = await readFile(card.image);
      const up = await fetch(`${BASE}/com.atproto.repo.uploadBlob`, { method: "POST", headers: { ...auth, "Content-Type": "image/png" }, body: buf });
      if(up.ok) external.thumb = (await up.json()).blob;
      else console.log(`Bluesky: カードの画像は付けずに投稿します（HTTP ${up.status}）`);
    }catch(e){ console.log("Bluesky: カードの画像は付けずに投稿します（" + e.message + "）"); }
  }
  const record = {
    $type: "app.bsky.feed.post", text, facets: facets(text), createdAt: new Date().toISOString(),
    langs: [/[぀-ヿ一-鿿]/.test(text) ? "ja" : "en"],
    embed: { $type: "app.bsky.embed.external", external }
  };
  const r = await fetch(`${BASE}/com.atproto.repo.createRecord`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }) });
  if(!r.ok) throw new Error(`Bluesky の投稿に失敗 HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { ok: true, message: "Bluesky: 投稿しました" };
}
