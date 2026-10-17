/*
 * 共有画像（OGP・X に添える画像）で使う、色・文字と「8人卓」の図。
 *   ドラフト練習（対人戦）の共有画像（build-ogp-room.mjs）と、X の告知に添える画像（x-release-image.mjs）で同じ見た目にするため。
 * 役割はこれだけ（画像のファイルは作らない）。
 */
export const PINE = "#10304F", PINE_DEEP = "#0A2038", GOLD = "#2F7DF6", PAPER = "#F5F8FC", MUTED = "#A9C2DE";
export const MANA = ["#E7CF86", "#7FB4D8", "#7A7480", "#DB8068", "#79A87F"];
export const FONT_JA = "'Noto Sans CJK JP','Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic',sans-serif";
export const FONT_EN = "'DejaVu Sans','Noto Sans','Helvetica Neue',Arial,sans-serif";
export const esc = s => String(s).replace(/[&<>]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));

/* 8人卓：人の席（3つ）は明るく、CPU の席は暗く。真ん中にパック、周りに回す向きの矢印。
   cx, cy は卓の中心、R は席までの半径。you / cpu は席に添える文字 */
export function tableSvg({ cx, cy, R, you, cpu, font }){
  const humans = new Set([0, 3, 5]);
  const seats = Array.from({ length: 8 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 4;
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    if(humans.has(i)){
      const me = i === 0;
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <circle r="36" fill="${me ? GOLD : MANA[i % 5]}" stroke="${PAPER}" stroke-width="${me ? 4 : 0}"/>
        <circle cy="-9" r="10" fill="${PINE_DEEP}" opacity="0.85"/>
        <path d="M -17 18 Q 0 -4 17 18 Z" fill="${PINE_DEEP}" opacity="0.85"/>
        ${me ? `<text y="-48" text-anchor="middle" font-family="${font}" font-size="20" font-weight="700" fill="${PAPER}">${esc(you)}</text>` : ""}
      </g>`;
    }
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle r="31" fill="${PINE_DEEP}" stroke="${MUTED}" stroke-width="2" opacity="0.95"/>
      <text y="7" text-anchor="middle" font-family="${FONT_EN}" font-size="17" font-weight="700" fill="${MUTED}">${cpu}</text>
    </g>`;
  }).join("\n");
  const ring = R - 66;
  const arrow = `<g fill="none" stroke="${GOLD}" stroke-width="5" stroke-linecap="round" opacity="0.9">
      <path d="M ${cx + ring} ${cy} A ${ring} ${ring} 0 0 1 ${cx} ${cy + ring}"/>
      <path d="M ${cx - ring} ${cy} A ${ring} ${ring} 0 0 1 ${cx} ${cy - ring}"/>
    </g>
    <path d="M ${cx - 2} ${cy + ring - 11} L ${cx - 18} ${cy + ring} L ${cx - 2} ${cy + ring + 11} Z" fill="${GOLD}"/>
    <path d="M ${cx + 2} ${cy - ring - 11} L ${cx + 18} ${cy - ring} L ${cx + 2} ${cy - ring + 11} Z" fill="${GOLD}"/>`;
  const pack = `<g transform="translate(${cx} ${cy}) rotate(-8)">
      <rect x="-30" y="-42" width="60" height="84" rx="7" fill="${PINE_DEEP}" stroke="${GOLD}" stroke-width="3"/>
      <rect x="-21" y="-33" width="42" height="30" rx="4" fill="${MANA[3]}" opacity="0.55"/>
      <rect x="-21" y="6" width="42" height="5" rx="2.5" fill="${MUTED}" opacity="0.5"/>
      <rect x="-21" y="16" width="30" height="5" rx="2.5" fill="${MUTED}" opacity="0.4"/>
    </g>`;
  return `${arrow}\n  ${pack}\n  ${seats}`;
}
