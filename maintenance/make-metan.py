#!/usr/bin/env python3
"""
四国めたんの口パク用の画像（6枚）を、坂本アヒル氏の立ち絵 PSD から作る。
  python3 maintenance/make-metan.py <PSDのパス> [出力フォルダ=short/metan]
白ロリ服を赤に塗り替え、おでこに赤いゴーグル（レンズは左右の目の上。バンドは描かない）、後ろに炎の装飾を足し、
口（閉じ・半開き・開き）× 目（開き・閉じ）で保存する。
必要: pip install psd-tools pillow numpy matplotlib
"""
import sys, os
from psd_tools import PSDImage
from PIL import Image, ImageFilter, ImageDraw
import numpy as np, matplotlib.colors as mc, random, sys
PSD=sys.argv[1] if len(sys.argv)>1 else "metan.psd"; OUT=sys.argv[2] if len(sys.argv)>2 else "short/metan"; os.makedirs(OUT,exist_ok=True)
psd=PSDImage.open(PSD); CW,CH=psd.size
def find(path):
    g=psd
    for name in path: g=[l for l in g if l.name==name][0]
    return g
def layer_img(path):
    l=find(path); l.visible=True
    im=l.composite(force=True); return im, l.bbox
def redden(im):
    a=np.array(im.convert("RGBA")).astype(float)/255
    r,g,b,al=a[...,0],a[...,1],a[...,2],a[...,3]
    mx=np.max(a[...,:3],axis=2); mn=np.min(a[...,:3],axis=2); sat=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0); lum=0.299*r+0.587*g+0.114*b
    hue=mc.rgb_to_hsv(a[...,:3])[...,0]*360
    dress=((sat<0.25)|((hue>190)&(hue<250)))&(al>0.1)&(lum>0.12)
    skin=(hue>5)&(hue<50)&(sat>0.12)&(lum>0.5); hair=(hue>250)&(hue<330)&(sat>0.18)
    mask=dress&~skin&~hair
    dark=np.array([0.42,0.04,0.07]); mid=np.array([0.85,0.12,0.16]); light=np.array([1.0,0.80,0.75])
    t=np.clip((lum-0.12)/0.88,0,1)
    col=np.where((t<0.6)[...,None], dark+(mid-dark)*(t/0.6)[...,None], mid+(light-mid)*((t-0.6)/0.4)[...,None])
    out=a.copy(); out[...,:3]=np.where(mask[...,None],col,a[...,:3])
    return Image.fromarray((out*255).astype(np.uint8))
def tongue(d, cx, base_y, h, w, col, lean=0.0, k=0):
    # 炎の舌：下が丸く、上が細く揺れる形。左右にゆらぎを付ける
    pts=[]
    n=18
    for i in range(n+1):
        t=i/n; y=base_y-h*t
        ww=w*(1-t)**0.75*(0.85+0.15*np.sin(t*9+k))
        x=cx+lean*h*t*t+ 0.12*w*np.sin(t*7+k)
        pts.append((x-ww,y))
    for i in range(n,-1,-1):
        t=i/n; y=base_y-h*t
        ww=w*(1-t)**0.75*(0.85+0.15*np.sin(t*9+k+1.3))
        x=cx+lean*h*t*t+0.12*w*np.sin(t*7+k)
        pts.append((x+ww,y))
    d.polygon(pts,fill=col)
def flames(size, seed=1):
    random.seed(seed); W,H=size
    fl=Image.new("RGBA",size,(0,0,0,0))
    # 舌の配置：左右の肩の外側と、頭の後ろ。外側（赤橙）→内側（黄）の順に重ねる
    spots=[]
    for i in range(14):
        side=random.choice([-1,1]); cx=W*0.5+side*random.uniform(W*0.22,W*0.46); base=random.uniform(H*0.75,H*1.02)
        spots.append((cx,base,random.uniform(H*0.45,H*0.85),random.uniform(W*0.05,W*0.11),side*random.uniform(0.05,0.25),i))
    for i in range(6):
        cx=W*0.5+random.uniform(-W*0.25,W*0.25); base=random.uniform(H*0.5,H*0.7)
        spots.append((cx,base,random.uniform(H*0.35,H*0.6),random.uniform(W*0.05,W*0.1),random.uniform(-0.2,0.2),20+i))
    for col,shrink,blur in [((225,55,10,235),1.0,10),((255,140,20,240),0.72,6),((255,215,70,245),0.45,4),((255,250,200,230),0.22,3)]:
        layer=Image.new("RGBA",size,(0,0,0,0)); d=ImageDraw.Draw(layer)
        for (cx,base,h,w,lean,k) in spots: tongue(d,cx,base,h*shrink**0.6,w*shrink,col,lean,k)
        layer=layer.filter(ImageFilter.GaussianBlur(blur))
        fl=Image.alpha_composite(fl,layer)
    # 外周はやわらかく透明に（四角い枠に見えないように）
    a=np.array(fl); yy,xx=np.mgrid[0:H,0:W]; dx=(xx-W*0.5)/(W*0.52); dy=(yy-H*0.62)/(H*0.62); r=np.sqrt(dx*dx+dy*dy)
    edge=np.clip((1.0-r)/0.2,0,1); edge=edge*edge*(3-2*edge)
    a[...,3]=(a[...,3]*edge).astype(np.uint8); return Image.fromarray(a)

def lens(rx, ry, tilt):
    # 1枚のレンズ（縁つき・上が明るいグラデーション・ハイライト）。少し傾けて返す
    S=4; w,h=(rx+16)*2*S,(ry+16)*2*S
    im=Image.new("RGBA",(w,h),(0,0,0,0)); d=ImageDraw.Draw(im)
    cx,cy=w//2,h//2
    d.ellipse([cx-(rx+13)*S,cy-(ry+13)*S,cx+(rx+13)*S,cy+(ry+13)*S],fill=(46,14,12,255))            # 外の線
    d.ellipse([cx-(rx+10)*S,cy-(ry+10)*S,cx+(rx+10)*S,cy+(ry+10)*S],fill=(150,44,38,255))           # 縁（上）
    d.ellipse([cx-(rx+10)*S,cy-(ry+6)*S,cx+(rx+10)*S,cy+(ry+10)*S],fill=(112,30,28,255))            # 縁（下の影）
    d.ellipse([cx-(rx+3)*S,cy-(ry+3)*S,cx+(rx+3)*S,cy+(ry+3)*S],fill=(46,14,12,255))                # レンズの線
    # レンズ：上から下へ 明→暗
    for i in range(ry*S*2):
        t=i/(ry*S*2); col=(int(240-70*t),int(70-40*t),int(50-30*t),255)
        y=cy-ry*S+i
        import math
        halfw=rx*S*math.sqrt(max(0,1-((i-ry*S)/(ry*S))**2))
        d.line([(cx-halfw,y),(cx+halfw,y)],fill=col)
    d.ellipse([cx-rx*S*0.62,cy-ry*S*0.82,cx-rx*S*0.08,cy-ry*S*0.42],fill=(255,225,210,215))         # ハイライト
    d.ellipse([cx+rx*S*0.15,cy+ry*S*0.25,cx+rx*S*0.45,cy+ry*S*0.5],fill=(255,180,160,110))
    d.ellipse([cx-rx*S*0.9,cy+ry*S*0.3,cx-rx*S*0.5,cy+ry*S*0.6],fill=(255,255,255,70))
    im=im.rotate(tilt,resample=Image.BICUBIC,expand=False)
    return im.resize((w//S,h//S),Image.LANCZOS)
def goggle_band(size):
    # 髪の下に通すバンド（前髪より前に描かない）。頭に沿ってゆるく弧を描く
    im=Image.new("RGBA",size,(0,0,0,0)); d=ImageDraw.Draw(im)
    pts=[]
    for i in range(41):
        t=i/40; x=286+t*(726-286); y=214-46*np.sin(np.pi*t)   # 両端が下がる弧
        pts.append((x,y))
    d.line(pts,fill=(46,14,12,255),width=40,joint="curve")
    d.line(pts,fill=(96,26,24,255),width=30,joint="curve")
    d.line([(p[0],p[1]-6) for p in pts],fill=(140,42,38,255),width=8,joint="curve")   # 上の面の光
    return im
def goggles(size):
    # おでこのゴーグル本体（前髪の上）。レンズは左右の目のすぐ上に1枚ずつ（高さはそろえない）。影 → ブリッジ → レンズ2枚
    im=Image.new("RGBA",size,(0,0,0,0)); d=ImageDraw.Draw(im)
    L=(404,200,8); R=(566,178,-6)     # (中心x, 中心y, 傾き)：左目の上・右目の上。眉と目の傾きに合わせて左を低く
    sh=Image.new("RGBA",size,(0,0,0,0)); sd=ImageDraw.Draw(sh)
    for cx,cy,_ in (L,R): sd.ellipse([cx-56,cy-38,cx+56,cy+58],fill=(60,20,30,110))
    sh=sh.filter(ImageFilter.GaussianBlur(10)); im.alpha_composite(sh)
    # ブリッジ（2枚の内側の縁をつなぐ。高さが違うので少し斜め）
    d.line([(L[0]+40,L[1]-2),(R[0]-40,R[1]-2)],fill=(46,14,12,255),width=30)
    d.line([(L[0]+40,L[1]-2),(R[0]-40,R[1]-2)],fill=(96,26,24,255),width=20)
    d.line([(L[0]+42,L[1]-8),(R[0]-42,R[1]-8)],fill=(140,42,38,255),width=4)
    for cx,cy,tilt in (L,R):
        Lz=lens(44,38,tilt); im.alpha_composite(Lz,(cx-Lz.width//2,cy-Lz.height//2))
    return im

def build(eye, mouth):
    canvas=Image.new("RGBA",(CW,CH),(0,0,0,0))
    def put(path, red=False):
        im,bb=layer_img(path)
        if im is None: return
        if red: im=redden(im)
        canvas.alpha_composite(im,(bb[0],bb[1]))
    put(["ツインドリル右"]); put(["ツインドリル左"])
    put(["*白ロリ服","!体"],red=True)
    put(["*白ロリ服","!右腕","*普通"],red=True); put(["*白ロリ服","!左腕","*普通"],red=True)
    put(["!顔色","*普通2"])
    put(["!口",{"closed":"*ほほえみ","half":"*ゆ","open":"*わあー"}[mouth]])
    if eye=="open":
        put(["!目","*目セット","*普通白目"]); put(["!目","*目セット","!黒目","*カメラ目線"])
    else:
        put(["!目","*目閉じ"])
    put(["!眉","*ごきげん"])
    # 髪留めはゴーグルと重なるので外す
    # バンドは描かない（髪の外に出て見えると不自然なため）。レンズとブリッジだけ
    put(["!前髪もみあげ"])
    canvas.alpha_composite(goggles((CW,CH)))
    return canvas
# bust-up crop & flames
BOX=(40,-120,1040,880)   # x0,y0,x1,y1  -> 1000x1000（まわりに炎の余白）
for eye in ["open","closed"]:
    for mouth in ["closed","half","open"]:
        full=build(eye,mouth); c=Image.new("RGBA",(BOX[2]-BOX[0],BOX[3]-BOX[1]),(0,0,0,0)); c.alpha_composite(full,(-BOX[0],-BOX[1]))
        out=Image.new("RGBA",c.size,(0,0,0,0))
        out.alpha_composite(flames(c.size, seed=7))
        out.alpha_composite(c)
        out=out.resize((372,380),Image.LANCZOS)
        out.save(os.path.join(OUT,f"{eye}_{mouth}.png"))
print("ok")
