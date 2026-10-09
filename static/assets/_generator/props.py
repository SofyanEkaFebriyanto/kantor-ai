from lib import *
M={}
WOOD=H('#C99A5B'); DW=H('#4A2E1A'); DW2=H('#6B4426'); GOLD=H('#E3B04B'); BLK=H('#1E212C'); DG=H('#2E3340')
LEA=H('#5A2E1B'); CREAM=H('#EFE8D8'); GRN=H('#2E7D4F'); SKY=H('#27406E')
rnd=random.Random(7)

def new(): return Scene()

def monitor(s,x,y,z,w=0.55):
    s.box(x+w/2-0.08,y+0.02,z,0.16,0.1,2,DG)
    s.box(x,y,z+2,w,0.07,9,BLK)
    s.rect('y',y+0.07,x+0.03,x+w-0.03,z+3,z+10,H('#3B7DD8'))
    for i in range(3):
        s.rect('y',y+0.07,x+0.06,x+0.06+w*(0.25+0.15*i),z+4+i*2,z+4.9+i*2,H('#BFE0FF'))

# desk_long 2x1
s=new()
s.box(0.05,0.05,0,0.12,0.9,12,DW); s.box(1.83,0.05,0,0.12,0.9,12,DW)
s.box(0,0,12,2,1,3,WOOD)
monitor(s,0.3,0.3,15); monitor(s,1.1,0.3,15)
s.box(0.5,0.62,15,0.5,0.22,1,H('#D8D4CC')); s.box(1.25,0.65,15,0.2,0.16,1,H('#D8D4CC'))
s.box(1.6,0.12,15,0.2,0.2,4,H('#E8E2D4'))  # mug/cup holder
s.save('props','desk_long',2,1,M['props'] if 'props' in M else M.setdefault('props',{}))
P=M['props']

# chairs (back toward +y / camera)
def chair(name,c,accent):
    s=new()
    s.box(0.22,0.22,0,0.16,0.16,5,BLK)
    s.box(0.05,0.05,5,0.5,0.5,3,c)
    s.box(0.07,0.46,8,0.46,0.1,15,c)
    s.box(0.05,0.05,8,0.08,0.4,4,accent); s.box(0.47,0.05,8,0.08,0.4,4,accent)
    s.save('props',name,0.6,0.6,P)
chair('office_chair',DG,BLK); chair('gaming_chair',H('#1B1D26'),H('#E53935'))

# leather chair owner
s=new()
s.box(0.05,0.05,0,0.6,0.6,6,LEA); s.box(0.05,0.55,6,0.6,0.15,22,LEA); s.box(0.05,0.05,6,0.12,0.5,9,sh(LEA,1.2)); s.box(0.53,0.05,6,0.12,0.5,9,sh(LEA,1.2))
s.box(0.17,0.12,6,0.36,0.45,3,sh(LEA,1.3))
s.save('props','leather_chair',0.7,0.7,P)

# sofa 2x1
def sofa(name,c):
    s=new()
    s.box(0,0,0,2,1,6,sh(c,0.9)); s.box(0,0,6,2,0.28,10,c)
    s.box(0.2,0.28,6,0.8,0.7,3,sh(c,1.15)); s.box(1.0,0.28,6,0.8,0.7,3,sh(c,1.15))
    s.box(0,0,6,0.2,1,6,sh(c,0.95)); s.box(1.8,0,6,0.2,1,6,sh(c,0.95))
    s.save('props',name,2,1,P)
sofa('sofa_leather',LEA); sofa('sofa_grey',H('#8A8F9C'))

# coffee table
s=new(); s.box(0.1,0.1,0,0.08,0.08,7,GOLD); s.box(0.9,0.1,0,0.08,0.08,7,GOLD); s.box(0.1,0.5,0,0.08,0.08,7,GOLD); s.box(0.9,0.5,0,0.08,0.08,7,GOLD)
s.box(0,0,7,1.1,0.7,2,H('#7A5233')); s.box(0.1,0.1,9,0.9,0.5,1,H('#E7D9B8'))
s.save('props','coffee_table',1.1,0.7,P)

# plant large
def plant(name,big):
    s=new(); s.cyl(0.5,0.5,0,0.26,10,BLK); s.cyl(0.5,0.5,9,0.28,2,GOLD)
    X,Y=s.p(0.5,0.5,10); r=random.Random(3 if big else 4)
    blobs=[]
    n=14 if big else 8; hh=34 if big else 16
    for i in range(n):
        a=r.uniform(0,6.28); rr=r.uniform(0,16 if big else 9)
        blobs.append((X+math.cos(a)*rr,Y-r.uniform(8,hh)))
    for sc,col in [(1.0,H('#1B5A37')),(0.78,GRN),(0.5,H('#4DA06A'))]:
        for bx,by in blobs:
            rad=(9 if big else 6)*sc
            s.d.ellipse([bx-rad*1.2,by-rad,bx+rad*1.2,by+rad],fill=col)
    for bx,by in blobs[::2]: s.d.point((round(bx-3),round(by-3)),fill=H('#A8E6B5'))
    s.save('props',name,1,1,P)
plant('plant_large',True); plant('plant_small',False)

# bookshelf 2x0.4 (books on +y face)
s=new(); s.box(0,0,0,2,0.4,64,DW)
s.rect('y',0.4,0.08,1.92,4,60,H('#2A1A10'))
cols=['#C0392B','#2E86C1','#F4D03F','#27AE60','#8E44AD','#E67E22','#ECF0F1','#16A085']
for row in range(4):
    z0=5+row*14; u=0.1
    while u<1.85:
        w=rnd.choice([0.05,0.07,0.09]); h=rnd.randint(8,12)
        s.rect('y',0.4,u,u+w,z0,z0+h,H(rnd.choice(cols)),sh(H('#2A1A10'),1.0)); u+=w+0.01
    s.rect('y',0.4,0.08,1.92,z0-1.5,z0,DW2)
s.save('props','bookshelf',2,0.4,P)

# bar counter 3x1
s=new(); s.box(0,0,0,3,1,22,DW); s.rect('y',1,0.1,2.9,3,18,DW2,sh(DW,0.5))
for i in range(5): s.rect('y',1,0.2+i*0.55,0.6+i*0.55,6,15,sh(DW2,0.85))
s.rect('y',1,0.0,3,18.5,20,GOLD)
s.box(-0.05,-0.05,22,3.1,1.1,3,H('#EDE6D6'))
s.box(2.2,0.2,25,0.5,0.4,5,H('#2A2E38')); s.box(0.3,0.3,25,0.2,0.2,5,H('#C0392B')); s.box(0.7,0.35,25,0.2,0.2,3,H('#E8E2D4'))
s.save('props','bar_counter',3,1,P)

# bar stool
s=new(); s.cyl(0.25,0.25,0,0.1,2,GOLD); s.cyl(0.25,0.25,0,0.035,12,GOLD); s.cyl(0.25,0.25,12,0.2,4,H('#B03A2E'))
s.save('props','bar_stool',0.5,0.5,P)

# table round set 2x2
s=new()
def wchair(x,y,bx,by,bw,bd):
    s.box(x,y,0,0.1,0.1,8,DW2); s.box(x+0.3,y+0.3,0,0.1,0.1,8,DW2)
    s.box(x,y,8,0.4,0.4,2,WOOD)
def ch(x,y,back):
    s.box(x,y,0,0.4,0.4,8,DW2); s.box(x,y,8,0.4,0.4,2,WOOD)
    if back=='n': s.box(x,y,10,0.4,0.07,9,WOOD)
    if back=='w': s.box(x,y,10,0.07,0.4,9,WOOD)
    if back=='s': s.box(x,y+0.33,10,0.4,0.07,9,WOOD)
    if back=='e': s.box(x+0.33,y,10,0.07,0.4,9,WOOD)
ch(0.8,0.1,'n'); ch(0.1,0.8,'w')
s.cyl(1,1,0,0.09,10,DW); s.cyl(1,1,10,0.5,2,WOOD)
s.cyl(1,1,12,0.09,3,H('#4DA06A'))
ch(1.5,0.8,'e'); ch(0.8,1.5,'s')
s.save('props','table_round_set',2,2,P)

# floor lamp
s=new(); s.box(0.12,0.12,0,0.2,0.2,2,GOLD); s.box(0.19,0.19,2,0.06,0.06,46,GOLD)
s.box(0.06,0.06,48,0.32,0.32,9,H('#FFE9B0'),top=H('#FFF6D8'))
s.save('props','floor_lamp',0.4,0.4,P)

# pillar
s=new(); s.box(0,0,0,0.6,0.6,4,GOLD); s.box(0.08,0.08,4,0.44,0.44,70,H('#E6DFD0')); s.box(0,0,74,0.6,0.6,5,GOLD)
s.save('props','pillar',0.6,0.6,P)

# glass railing 2x0.12 (along x) and railing_y
def railing(name,along):
    s=new(); L=2
    w,d=(L,0.12) if along=='x' else (0.12,L)
    s.box(0,0,0,w,d,3,GOLD)
    if along=='x':
        s.glass('y',0.12,0.02,L-0.02,3,22); s.glass('x',L,0.0,0.12,3,22)
        for u in (0.04,1.0,1.94): s.box(u-0.03,0,3,0.06,0.12,19,GOLD)
    else:
        s.glass('x',0.12,0.02,L-0.02,3,22)
        for u in (0.04,1.0,1.94): s.box(0,u-0.03,3,0.12,0.06,19,GOLD)
    s.box(0,0,22,w,d,2,GOLD)
    s.save('props',name,w,d,P)
railing('railing_x','x'); railing('railing_y','y')

# minbar 1.4 x 2.2
s=new()
s.box(0.1,0,0,1.2,1.0,30,DW)
s.rect('y',1.0,0.2,1.2,4,26,DW2,sh(DW,0.5))
s.rect('y',1.0,0.45,0.95,6,22,H('#2A1A10'),GOLD)
s.box(0.05,0,30,1.3,1.05,3,GOLD)
s.box(0.1,0,33,1.2,0.1,10,DW2)
for j in range(3):
    s.box(0.1,1.0+0.4*j,0,1.2,0.4,[22,13,6][j],DW2 if j%2 else DW,top=H('#D9A441') if j==0 else None)
s.save('props','minbar',1.4,2.2,P)

# sun lounger 1x2
s=new(); s.box(0.05,0.1,0,0.08,0.08,4,CREAM); s.box(0.85,0.1,0,0.08,0.08,4,CREAM); s.box(0.05,1.8,0,0.08,0.08,4,CREAM); s.box(0.85,1.8,0,0.08,0.08,4,CREAM)
s.box(0.05,0.1,4,0.9,1.8,3,CREAM); s.box(0.1,0.7,7,0.8,1.15,3,H('#BFE3F0')); s.box(0.1,0.15,7,0.8,0.55,6,H('#BFE3F0'))
s.save('props','sun_lounger',1,2,P)

# parasol
s=new(); s.cyl(0.5,0.5,0,0.03,60,CREAM)
X,Y=s.p(0.5,0.5,60)
s.d.polygon([(X-34,Y+4),(X,Y-18),(X+34,Y+4),(X+18,Y+14),(X-18,Y+14)],fill=H('#F4F4F0'),outline=H('#8E9AA6'))
s.d.polygon([(X-12,Y+13),(X,Y-18),(X+12,Y+13)],fill=H('#2FA7D6'))
s.d.polygon([(X+12,Y+13),(X,Y-18),(X+34,Y+4),(X+30,Y+8)],fill=H('#DADBD6'))
s.save('props','parasol',1,1,P)

# ring light tripod & camera tripod
s=new(); X,Y=s.p(0.5,0.5,0)
for dx,dy in [(-14,10),(14,10),(0,-6)]: s.d.line([(X,Y-44),(X+dx,Y+dy)],fill=H('#2A2E38'),width=2)
s.d.line([(X,Y-44),(X,Y-56)],fill=H('#2A2E38'),width=2)
s.d.ellipse([X-14,Y-84,X+14,Y-56],fill=H('#FFF6E0'),outline=H('#B8B8B0')); s.d.ellipse([X-8,Y-78,X+8,Y-62],fill=(0,0,0,0),outline=H('#B8B8B0'))
s.d.rectangle([X-3,Y-74,X+3,Y-66],fill=H('#2A2E38'))
s.save('props','ring_light',1,1,P)
s=new(); X,Y=s.p(0.5,0.5,0)
for dx,dy in [(-14,10),(14,10),(0,-6)]: s.d.line([(X,Y-40),(X+dx,Y+dy)],fill=H('#2A2E38'),width=2)
s.box(0.3,0.3,40,0.4,0.35,11,H('#2A2E38')); s.rect('y',0.65,0.4,0.6,43,49,H('#8FB7E8'))
s.save('props','camera_tripod',1,1,P)

# greenscreen
s=new(); s.box(0.05,0.05,0,0.08,0.08,66,DG); s.box(2.37,0.05,0,0.08,0.08,66,DG)
s.box(0,0,0,2.5,0.12,62,H('#2FBF4A'))
for i in range(1,10): s.rect('y',0.12,i*0.25,i*0.25+0.04,2,60,sh(H('#2FBF4A'),0.8))
s.save('props','greenscreen',2.5,0.12,P)

# wall tv + corkboard
s=new(); s.box(0,0,0,1.6,0.1,26,BLK); s.rect('y',0.1,0.06,1.54,2,24,H('#0E2A47'))
s.rect('y',0.1,0.2,1.0,12,22,H('#2F7DD1')); s.rect('y',0.1,1.05,1.45,5,20,H('#183E66'))
s.save('props','wall_tv',1.6,0.1,P)
s=new(); s.box(0,0,0,1.5,0.1,24,DW2); s.rect('y',0.1,0.06,1.44,2,22,H('#C79A5E'))
for i,(u,z,c) in enumerate([(0.2,14,'#FFF3A0'),(0.6,8,'#FFB3C7'),(1.0,15,'#B8E6FF'),(1.2,6,'#FFF3A0'),(0.35,5,'#C8F7C5')]):
    s.rect('y',0.1,u,u+0.2,z,z+5,H(c),H('#8A6A45'))
s.save('props','corkboard',1.5,0.1,P)

# owner desk 3x1.5
s=new(); s.box(0.1,0.1,0,0.5,1.3,16,DW); s.box(2.4,0.1,0,0.5,1.3,16,DW)
s.rect('y',1.4,0.15,0.55,3,14,DW2,sh(DW,0.5)); s.rect('y',1.4,2.45,2.85,3,14,DW2,sh(DW,0.5))
s.box(0,0,16,3,1.5,3,DW); s.box(0.15,0.15,19,2.7,1.2,0.6,H('#2E5E47'))
monitor(s,0.9,0.35,19.6,0.7); s.box(1.9,0.3,19.6,0.5,0.3,0.5,H('#E7D9B8'))
s.box(2.4,0.4,19.6,0.1,0.1,10,GOLD); s.box(2.3,0.3,29.6,0.3,0.3,5,H('#FFE9B0'))
s.box(0.2,0.9,19.6,0.5,0.35,1.5,H('#F1EDE4'))
s.save('props','owner_desk',3,1.5,P)

# palm
s=new(); X,Y=s.p(0.5,0.5,0); r=random.Random(11)
pts=[(X,Y),(X+3,Y-18),(X+5,Y-36),(X+4,Y-54),(X+2,Y-70)]
for i in range(len(pts)-1): s.d.line([pts[i],pts[i+1]],fill=H('#7A5A3A'),width=5)
for i,(px,py) in enumerate(pts): s.d.line([(px-3,py),(px+3,py-2)],fill=H('#4A3320'))
tx,ty=pts[-1]
for a in range(-170,20,28):
    ex=tx+math.cos(math.radians(a))*34; ey=ty+math.sin(math.radians(a))*18+10
    mx=(tx+ex)/2; my=min(ty,ey)-10
    s.d.line([(tx,ty),(mx,my),(ex,ey)],fill=H('#2E7D4F'),width=4)
    s.d.line([(tx,ty-1),(mx,my-2),(ex,ey-1)],fill=H('#4DA06A'),width=1)
s.d.ellipse([tx-4,ty-3,tx+4,ty+5],fill=H('#6B4426'))
s.save('props','palm',1,1,P)

# kitchen items: coffee machine, fridge
s=new(); s.box(0.1,0.1,0,0.8,0.8,60,H('#CFD8DC')); s.rect('y',0.9,0.15,0.85,4,56,H('#9FD8EA'),H('#546E7A'))
for z in (14,26,38,50): s.rect('y',0.9,0.15,0.85,z,z+1,H('#546E7A'))
s.save('props','fridge_glass',1,1,P)
s=new(); s.box(0.1,0.1,0,0.7,0.5,12,DW); s.box(0.15,0.15,12,0.6,0.4,16,H('#37474F')); s.rect('y',0.55,0.25,0.65,14,24,H('#101820'))
s.box(0.35,0.4,12,0.2,0.18,5,H('#E8E2D4'))
s.save('props','coffee_machine',1,1,P)

# pizza box stack
s=new(); s.box(0.1,0.1,0,0.7,0.7,3,H('#E8D5A8')); s.box(0.12,0.1,3,0.7,0.7,3,H('#E0C892')); s.box(0.1,0.12,6,0.7,0.7,3,H('#E8D5A8'))
s.rect('y',0.82,0.2,0.7,0.8,2.5,H('#C0392B'))
s.save('props','pizza_boxes',1,1,P)

json.dump(M,open('/home/claude/gen/props_manifest.json','w'))
print(len(P),'props')
