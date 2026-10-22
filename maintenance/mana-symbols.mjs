/*
 * マナ・シンボル（白・青・黒・赤・緑）を、SVG の部品として描く。役割はこれだけ（チャンネルのバナー・アイコンから使う）。
 *
 *   const mana = await loadMana();
 *   mana("W", cx, cy, d)   … 中心 (cx, cy)、直径 d の、色つきの丸と記号（カードのコストの見た目）
 *
 * 記号の形は maintenance/mana-glyphs.json（サイトで使っているフォント assets/mana/mana.woff2 から、記号の輪郭だけを取り出したもの。
 *   フォントは SIL Open Font License。作り方：fontTools で uniE600〜E604 の輪郭を SVG のパスにした）。
 *   画像を作る環境にフォントを入れなくても描けるように、輪郭をファイルにしてある。
 */
import { readFile } from "node:fs/promises";

/* 丸の色（サイトの assets/mana/mana.min.css の .ms-cost と同じ） */
export const MANA_FILL = { W: "#F0F2C0", U: "#B5CDE3", B: "#ACA29A", R: "#DB8664", G: "#93B483" };
export const MANA_ORDER = ["W", "U", "B", "R", "G"];

export async function loadMana(file = "maintenance/mana-glyphs.json"){
  const font = JSON.parse(await readFile(file, "utf8"));
  return (c, cx, cy, d, o = {}) => {
    const g = font.glyphs[c];
    const [x0, y0, x1, y1] = g.bounds, gw = x1 - x0, gh = y1 - y0;
    const k = d * (o.glyph ?? 0.72) / Math.max(gw, gh);              // 記号は丸の 72% の大きさ
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const shadow = o.shadow === false ? "" : `<circle cx="${cx + d * 0.03}" cy="${cy + d * 0.06}" r="${d / 2}" fill="#000" opacity=".45"/>`;
    return `${shadow}<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="${MANA_FILL[c]}"/>` +
      `<path d="${g.d}" fill="#0D0F0F" transform="translate(${cx} ${cy}) scale(${k} ${-k}) translate(${-mx} ${-my})"/>`;
  };
}
