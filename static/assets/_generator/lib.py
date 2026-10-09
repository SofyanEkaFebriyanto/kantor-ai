import random, json, math, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT='/mnt/user-data/outputs/assets'
for sub in ['tiles','props','walls','characters','fx']:
    os.makedirs(f'{OUT}/{sub}',exist_ok=True)

def H(h):
    h=h.lstrip('#'); h=''.join(ch*2 for ch in h) if len(h)==3 else h; return tuple(int(h[i:i+2],16) for i in (0,2,4))
def sh(c,f): return tuple(max(0,min(255,int(v*f))) for v in c[:3])
def mixc(a,b,t): return tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))
def hn(x,y,s=0): return ((x*73856093)^(y*19349663)^(s*83492791))%1000/1000.0

# ---------- TILES ----------
def tile_img(fn):
    im=Image.new('RGBA',(64,32),(0,0,0,0)); px=im.load()
    for py in range(32):
        for x in range(64):
            dx=x+0.5-32; dy=py+0.5-16
            e=abs(dx)/32+abs(dy)/16
            if e<=1.0:
                u=(dy/16+dx/32)/2+0.5; v=(dy/16-dx/32)/2+0.5
                c=fn(x,py,u,v)
                if e>0.92: c=sh(c,0.88)
                px[x,py]=tuple(c[:3])+(255,)
    return im

def wood_fn(a,b,gap=H('#8a5f30')):
    def f(x,y,u,v):
        k=int(v*4); fr=v*4-k
        base=a if k%2==0 else b
        if fr<0.09: return sh(base,0.72)
        seam=(u+0.37*k)%0.5
        if seam<0.025: return sh(base,0.8)
        n=hn(x,y,k)
        if n<0.12: return sh(base,0.94)
        if n>0.9: return sh(base,1.07)
        return base
    return f
def marble_fn(x,y,u,v):
    c=int(u*2)+int(v*2)
    base=H('#ECE7DC') if c%2==0 else H('#DAD3C4')
    t=(u*7+v*3+hn(x//3,y//3)*0.4)%1
    if t<0.04: return sh(base,0.9)
    if hn(x,y,5)>0.96: return sh(base,0.95)
    return base
def carpet_fn(x,y,u,v):
    base=H('#1F6B3F')
    if u<0.07 or u>0.93 or v<0.07 or v>0.93: return H('#C9A24A')
    if u<0.12 or u>0.88 or v<0.12 or v>0.88: return H('#14472A')
    if int(v*8)%2==0: base=H('#2E8B57')
    if hn(x,y,2)>0.93: base=sh(base,1.12)
    return base
def deck_fn(x,y,u,v):
    base=H('#8A6A45'); k=int(u*5); fr=u*5-k
    if fr<0.1: return sh(base,0.6)
    if (v+0.3*k)%0.6<0.03: return sh(base,0.78)
    return sh(base,1.05) if hn(x,y,k)>0.85 else base
def gscreen_fn(x,y,u,v):
    return sh(H('#2FBF4A'),1.0+(hn(x,y)-0.5)*0.08)
def coping_fn(x,y,u,v):
    base=H('#CFC7B6')
    if int(u*2)*0.5+0<=u and (u*2)%1<0.06 or (v*2)%1<0.06: return sh(base,0.85)
    return base
def rug_fn(x,y,u,v):
    base=H('#5B1F2A')
    if u<0.06 or u>0.94 or v<0.06 or v>0.94: return H('#D9A441')
    if u<0.14 or u>0.86 or v<0.14 or v>0.86: return H('#3A1219')
    d=abs(u-0.5)+abs(v-0.5)
    if 0.22<d<0.30: return H('#D9A441')
    return sh(base,1.1) if hn(x,y,3)>0.9 else base
def water_fn(ph):
    def f(x,y,u,v):
        base=mixc(H('#2FA7D6'),H('#1E86B8'),v*0.8)
        w=math.sin(u*14+v*5+ph)+math.sin(u*5-v*11+ph*1.3)
        if w>1.45: return H('#B9ECFA')
        if w>1.0: return mixc(base,H('#7FD8F2'),0.7)
        if w<-1.5: return sh(base,0.86)
        return base
    return f

def save_tile(name,fn):
    im=tile_img(fn); im.save(f'{OUT}/tiles/{name}.png'); return im

# ---------- ISO SCENE ----------
class Scene:
    def __init__(s,W=700,Hh=700,ox=350,oy=450):
        s.img=Image.new('RGBA',(W,Hh),(0,0,0,0)); s.d=ImageDraw.Draw(s.img); s.ox=ox; s.oy=oy
    def p(s,x,y,z): return (round(s.ox+(x-y)*32), round(s.oy+(x+y)*16 - z))
    def poly(s,pts,fill,outline=None):
        s.d.polygon(pts,fill=fill,outline=outline)
    def box(s,x,y,z,w,d,h,c,top=None,line=True):
        P=s.p; dark=sh(c,0.35)
        t=top if top else sh(c,1.18)
        T=[P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)]
        L=[P(x,y+d,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x,y+d,z+h)]
        R=[P(x+w,y,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x+w,y,z+h)]
        s.poly(T,t,dark); s.poly(L,sh(c,0.84),dark); s.poly(R,sh(c,0.62),dark)
        if line:
            hl=sh(c,1.35)
            s.d.line([P(x,y+d,z+h),P(x+w,y+d,z+h),P(x+w,y,z+h)],fill=hl)
    def face(s,plane,k,pts,fill,outline=None):
        P=s.p
        if plane=='x': q=[P(k,u,z) for u,z in pts]
        else: q=[P(u,k,z) for u,z in pts]
        s.poly(q,fill,outline)
    def rect(s,plane,k,u0,u1,z0,z1,fill,outline=None):
        s.face(plane,k,[(u0,z0),(u1,z0),(u1,z1),(u0,z1)],fill,outline)
    def cyl(s,cx,cy,z,r,h,c,top=None):
        X,Y=s.p(cx,cy,z); rx=max(1,round(r*45)); ry=max(1,round(r*22.6)); dark=sh(c,0.35)
        s.d.ellipse([X-rx,Y-ry,X+rx,Y+ry],fill=sh(c,0.6),outline=dark)
        s.d.rectangle([X-rx,Y-h,X-1,Y],fill=sh(c,0.86))
        s.d.rectangle([X,Y-h,X+rx,Y],fill=sh(c,0.62))
        s.d.line([X-rx,Y-h,X-rx,Y],fill=dark); s.d.line([X+rx,Y-h,X+rx,Y],fill=dark)
        s.d.ellipse([X-rx,Y-h-ry,X+rx,Y-h+ry],fill=top if top else sh(c,1.15),outline=dark)
    def glass(s,plane,k,u0,u1,z0,z1,color=(150,205,220,95)):
        lay=Image.new('RGBA',s.img.size,(0,0,0,0)); ld=ImageDraw.Draw(lay)
        P=s.p
        pts=[(u0,z0),(u1,z0),(u1,z1),(u0,z1)]
        q=[P(k,u,z) if plane=='x' else P(u,k,z) for u,z in pts]
        ld.polygon(q,fill=color)
        s.img.alpha_composite(lay); s.d=ImageDraw.Draw(s.img)
    def save(s,sub,name,fw,fd,man,pad=1):
        bb=s.img.getbbox(); im=s.img.crop((bb[0]-pad,bb[1]-pad,bb[2]+pad,bb[3]+pad))
        cx,cy=s.p(fw/2,fd/2,0); ax,ay=cx-bb[0]+pad,cy-bb[1]+pad
        im.save(f'{OUT}/{sub}/{name}.png')
        man[name]={'file':f'{sub}/{name}.png','w':im.width,'h':im.height,'anchor':[ax,ay],'footprint':[fw,fd]}
        return im,(ax,ay)
