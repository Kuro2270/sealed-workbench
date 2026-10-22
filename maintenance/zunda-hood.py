#!/usr/bin/env python3
"""
フード付き（水色のパーカー）のずんだもんの絵を、立ち絵素材の PSD から作る。役割はこれだけ（手で動かす道具。Actions では使わない）。

  python3 maintenance/zunda-hood.py <PSD> <出力.png> [--face 表情] [--crop thumb|full]

  PSD   … 坂本アヒルさんの「ずんだもん立ち絵素材2.3.psd」（リポジトリには入れない。各自で用意する）
  表情  … normal（いつもの顔）／ bikkuri（びっくり）／ hawahawa（ぐるぐる目）／ hawahawa2（＞＜目）
  crop  … full（全身。既定）／ thumb（サムネイル用の胸から上）

  例: python3 maintenance/zunda-hood.py ~/ずんだもん立ち絵素材2.3.psd short/zunda-hoodie/thumb.png --face hawahawa2 --crop thumb

必要なもの: pip install psd-tools scipy pillow numpy

作り方
  ・PSD の「パーカー（裏地とセットで使用）」と「パーカー裏地」を使い、パーカーの布の部分だけを水色に塗り直す
    （線画と、枝豆・髪の鮮やかな緑はそのまま。枝豆の光っている粒は青くする）
  ・パーカーの外形の少し内側に、白い縁取りの線を1本引く。フードのてっぺんに「O」の飾りを描く
  ・しっぽはフードの後ろからはみ出すので外す。腕はパーカーの袖（ポケットに手を入れた形）を使い、いつもの服の腕は出さない
"""
import argparse
import numpy as np
from PIL import Image, ImageDraw
from psd_tools import PSDImage
from scipy import ndimage

PARKA = "/!枝豆/*パーカー(裏地とセットで使用)"
BASE = ["/パーカー裏地", "/*服装1/*いつもの服", "/*服装1/!左腕/*(非表示)", "/*服装1/!右腕/*(非表示)", "/!顔色/*ほっぺ", "/!眉/*普通眉"]
EYE_NORMAL = ["/!目/*目セット/*普通白目", "/!目/*目セット/!黒目/*普通目"]
FACES = {
    "normal":    dict(eye=EYE_NORMAL, mouth="/!口/*ほあー"),
    "bikkuri":   dict(eye=["/!目/*目セット/*見開き白目", "/!目/*目セット/!黒目/*カメラ目線"], mouth="/!口/*お", brow="/!眉/*上がり眉", symbols=["/記号など/汗1"]),
    "hawahawa":  dict(eye=["/!目/*ぐるぐる"], mouth="/!口/*はへえ", brow="/!眉/*困り眉1", cheek="/!顔色/*ほっぺ赤め", symbols=["/記号など/汗2", "/記号など/汗3"]),
    "hawahawa2": dict(eye=["/!目/*><"], mouth="/!口/*んあー", brow="/!眉/*困り眉2", cheek="/!顔色/*ほっぺ赤め", symbols=["/記号など/汗2", "/記号など/汗3"]),
}
THUMB_BOX = (180, 60, 900, 820)      # サムネイル用の胸から上（PSD の座標）
EMBLEM = (505, 198, 31, 12)          # フードのてっぺんの「O」（中心 x, y、横・縦の半径）


class Psd:
    def __init__(self, path):
        self.psd = PSDImage.open(path)
        self.layers = list(self._walk(self.psd))

    def _walk(self, g, pre=""):
        for l in g:
            p = pre + "/" + l.name
            yield p, l
            if l.is_group():
                yield from self._walk(l, p)

    def render(self, sel):
        """sel に挙げた層だけを見せて重ねる（グループは、中に見せる層があれば見せる）"""
        sel = set(sel)
        for p, l in self.layers:
            l.visible = any(s.startswith(p + "/") for s in sel) if l.is_group() else p in sel
        return self.psd.composite(force=True).convert("RGBA")


def _hls2rgb(H, L, S):
    C = (1 - np.abs(2 * L - 1)) * S
    X = C * (1 - np.abs((H * 6) % 2 - 1))
    m = L - C / 2
    k = (H * 6).astype(int) % 6
    z = np.zeros_like(H)
    R = np.select([k == 0, k == 1, k == 2, k == 3, k == 4, k == 5], [C, X, z, z, X, C])
    G = np.select([k == 0, k == 1, k == 2, k == 3, k == 4, k == 5], [X, C, C, X, z, z])
    B = np.select([k == 0, k == 1, k == 2, k == 3, k == 4, k == 5], [z, z, X, C, C, X])
    return np.stack([R + m, G + m, B + m], -1)


def recolor_parka(P):
    """パーカーの層を水色に塗り直し、白い縁取りの線と「O」の飾りを付ける"""
    a = np.asarray(P).astype(float) / 255
    rgb, al = a[..., :3], a[..., 3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    L = (mx + mn) / 2
    d = mx - mn
    S = np.where(d == 0, 0, d / (1 - np.abs(2 * L - 1) + 1e-9))
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / (d + 1e-9)) % 6, np.where(mx == g, (b - r) / (d + 1e-9) + 2, (r - g) / (d + 1e-9) + 4)) / 6
    h = np.where(d > 0, h, 0)
    outline = L < 0.42                                   # 線画
    vivid = (S > 0.45) & (h > 0.18) & (h < 0.40)         # 枝豆・髪の鮮やかな緑
    fabric = (al > 0.02) & ~outline & ~vivid             # 布の部分
    blue = _hls2rgb(np.full_like(L, 0.585), np.clip(0.27 + 0.38 * L, 0, 1), np.clip(0.44 + (L - 0.55) * 0.6, 0.35, 0.72))
    out = np.where(fabric[..., None], blue, rgb)
    dots = vivid & (L > 0.78) & (h < 0.25)               # 枝豆の光っている粒は青く
    out = np.where(dots[..., None], np.array([0.33, 0.55, 0.85]), out)
    dist = ndimage.distance_transform_edt(al > 0.5)      # 外形からの距離
    out = np.where((fabric & (dist > 9) & (dist < 14.5))[..., None], 1.0, out)
    im = Image.fromarray((np.concatenate([out, al[..., None]], -1) * 255).round().astype(np.uint8), "RGBA")
    cx, cy, rx, ry = EMBLEM
    ImageDraw.Draw(im).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=(255, 255, 255, 255), width=6)
    return im


def figure(psd, eye, mouth, brow=None, cheek=None, symbols=()):
    base = list(BASE)
    if brow:
        base = [x for x in base if not x.startswith("/!眉/")] + [brow]
    if cheek:
        base = [x for x in base if not x.startswith("/!顔色/")] + [cheek]
    out = psd.render(base + list(eye) + [mouth])
    out.alpha_composite(recolor_parka(psd.render([PARKA])))
    if symbols:
        out.alpha_composite(psd.render(list(symbols)))
    return out


def main():
    ap = argparse.ArgumentParser(description="フード付きのずんだもんの絵を作る")
    ap.add_argument("psd"); ap.add_argument("out")
    ap.add_argument("--face", default="normal", choices=sorted(FACES))
    ap.add_argument("--crop", default="full", choices=["full", "thumb"])
    a = ap.parse_args()
    im = figure(Psd(a.psd), **FACES[a.face])
    if a.crop == "thumb":
        im = im.crop(THUMB_BOX)
    im.save(a.out, optimize=True)
    print(f"{a.out}（{im.size[0]}×{im.size[1]}、表情 {a.face}）")


if __name__ == "__main__":
    main()
