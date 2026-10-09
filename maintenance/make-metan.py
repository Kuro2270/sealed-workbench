from psd_tools import PSDImage
from PIL import Image, ImageFilter, ImageDraw
import numpy as np, matplotlib.colors as mc, random, sys
psd=PSDImage.open("metan.psd"); CW,CH=psd.size
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

def hair_orange(im):
    # 髪（桃〜紫の色相）をオレンジに。明るさはそのまま、色相だけ回して少し鮮やかに
    a=np.array(im.convert("RGBA")).astype(float)/255
    hsv=mc.rgb_to_hsv(a[...,:3]); hue=hsv[...,0]*360; sat=hsv[...,1]; val=hsv[...,2]
    mask=(hue>250)&(hue<340)&(sat>0.15)&(a[...,3]>0.1)
    hsv2=hsv.copy()
    hsv2[...,0]=np.where(mask, (14/360.0), hsv[...,0])          # 赤寄りのオレンジ
    hsv2[...,1]=np.where(mask, np.clip(sat*1.15+0.08,0,1), sat)
    rgb=mc.hsv_to_rgb(hsv2)
    out=a.copy(); out[...,:3]=np.where(mask[...,None], rgb, a[...,:3])
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
def _noise(W,H,seed,scales=((8,1.0),(16,0.6),(32,0.35),(64,0.2)),stretch=3.0):
    # 乱流っぽいノイズ：粗い乱数を拡大してぼかしたものを数段重ねる。縦に引き伸ばして炎の流れにする
    rng=np.random.default_rng(seed); acc=np.zeros((H,W)); tot=0
    for cells,w in scales:
        g=rng.random((max(2,int(cells/stretch)),cells))
        im=Image.fromarray((g*255).astype(np.uint8)).resize((W,H),Image.BICUBIC)
        acc+=np.array(im).astype(float)/255*w; tot+=w
    return acc/tot
def flames(size, seed=1):
    random.seed(seed); W,H=size
    # 1) 舌の形（なめらかなマスク）：左右の肩の外側と頭の後ろ
    shape=Image.new("L",size,0); d=ImageDraw.Draw(shape)
    spots=[]
    for i in range(16):
        side=random.choice([-1,1]); cx=W*0.5+side*random.uniform(W*0.2,W*0.46); base=random.uniform(H*0.78,H*1.05)
        spots.append((cx,base,random.uniform(H*0.6,H*1.0),random.uniform(W*0.06,W*0.12),-side*random.uniform(0.25,0.55),i))
    for i in range(7):
        cx=W*0.5+random.uniform(-W*0.28,W*0.28); base=random.uniform(H*0.5,H*0.72)
        spots.append((cx,base,random.uniform(H*0.4,H*0.7),random.uniform(W*0.05,W*0.1),(-0.25 if cx>W*0.5 else 0.25)*random.uniform(0.5,1.0),20+i))
    for (cx,base,h,w,lean,k) in spots: tongue(d,cx,base,h,w,255,lean,k)
    shape=np.array(shape.filter(ImageFilter.GaussianBlur(9))).astype(float)/255
    # 2) 乱流で縁をちぎる・内部にむらを作る。下ほど濃く、上ほど細く消える
    n=_noise(W,H,seed)
    yy,xx=np.mgrid[0:H,0:W]; up=np.clip((yy/H-0.1)/0.9,0,1)          # 0=上 … 1=下
    inten=shape*np.clip((n-0.3)*2.4,0,1)*(0.4+0.6*up)
    half=W*(0.14+0.44*up)                                   # 上に行くほど許す幅を狭める（頭の上へ収束）
    taper=np.clip((half-np.abs(xx-W*0.5))/(W*0.12)+0.5,0,1); taper=taper*taper*(3-2*taper)
    inten=np.clip(inten*1.6*taper,0,1)
    # 3) 色：暗い赤 → 橙 → 黄 → 白（強さで決める）。中心ほど明るい
    core=shape*np.clip((n-0.45)*2.6,0,1)*(0.5+0.5*up)
    t=np.clip(inten*0.85+core*0.8,0,1)
    stops=[(0.00,(200,40,8)),(0.3,(240,85,12)),(0.55,(255,140,20)),(0.8,(255,215,80)),(1.0,(255,252,225))]
    rgb=np.zeros((H,W,3))
    for (t0,c0),(t1,c1) in zip(stops[:-1],stops[1:]):
        m=(t>=t0)&(t<=t1); f=((t-t0)/(t1-t0))[...,None]
        rgb=np.where(m[...,None], np.array(c0)+(np.array(c1)-np.array(c0))*f, rgb)
    alpha=np.clip(inten*1.9,0,1)
    # 4) 外側の光（ぼかした加算）
    glow=Image.fromarray((alpha*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(26))
    ga=np.array(glow).astype(float)/255*0.55
    out=np.zeros((H,W,4))
    out[...,:3]=rgb; out[...,3]=np.clip(alpha+ga*(1-alpha),0,1)*255
    out[...,:3]=np.where((alpha<0.05)[...,None], np.array([255,90,10]), out[...,:3])   # 光の部分は橙
    # 4b) 火の粉：小さな明るい点を上のほうにまく
    sp=Image.new("RGBA",size,(0,0,0,0)); sd=ImageDraw.Draw(sp); rs=random.Random(seed+99)
    for i in range(70):
        x=rs.uniform(W*0.05,W*0.95); y=rs.uniform(H*0.05,H*0.75); rr=rs.uniform(1.2,3.2)
        c=rs.choice([(255,230,120),(255,170,40),(255,120,20)])
        sd.ellipse((x-rr,y-rr,x+rr,y+rr),fill=c+(rs.randint(140,230),))
    sp=sp.filter(ImageFilter.GaussianBlur(0.8)); spa=np.array(sp).astype(float)
    a2=spa[...,3:4]/255
    out[...,:3]=out[...,:3]*(1-a2)+spa[...,:3]*a2
    out[...,3]=np.clip(out[...,3]+a2[...,0]*255*(1-out[...,3]/255),0,255)
    # 5) 端は透明に
    dx=(xx-W*0.5)/(W*0.52); dy=(yy-H*0.62)/(H*0.62); r=np.sqrt(dx*dx+dy*dy)
    edge=np.clip((1.12-r)/0.5,0,1); edge=edge*edge*(3-2*edge)
    out[...,3]*=edge
    return Image.fromarray(out.astype(np.uint8))
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
    def put(path, red=False, hair=False):
        im,bb=layer_img(path)
        if im is None: return
        if red: im=redden(im)
        if hair: im=hair_orange(im)
        canvas.alpha_composite(im,(bb[0],bb[1]))
    put(["ツインドリル右"],hair=True); put(["ツインドリル左"],hair=True)
    put(["*白ロリ服","!体"],red=True,hair=True)
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
    put(["!前髪もみあげ"],hair=True)
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
        out.save(f"{eye}_{mouth}.png")
print("ok")
