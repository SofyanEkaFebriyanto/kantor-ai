from PIL import Image
import json
O='/mnt/user-data/outputs/assets/'
M=json.load(open(O+'manifest.json'))
W,Hh=1100,820; OX,OY=550,170
img=Image.new('RGBA',(W,Hh),(10,16,48,255))
def P(gx,gy): return (OX+(gx-gy)*32, OY+(gx+gy)*16)
cache={}
def L(f):
    if f not in cache: cache[f]=Image.open(O+f).convert('RGBA')
    return cache[f]
items=[]
def tile(name,gx,gy):
    x,y=P(gx,gy); img.alpha_composite(L(f'tiles/{name}.png'),(x-32,y))
def obj(kind,name,gx,gy,key=None):
    m=M[kind][name]; fw,fd=m['footprint']; cx,cy=P(gx+fw/2,gy+fd/2)
    items.append((gx+gy+fw+fd if key is None else key, L(m["file"]),(int(round(cx-m["anchor"][0])),int(round(cy-m["anchor"][1])))))
def char(name,gx,gy,col,row,dz=0,key=None):
    m=M['characters'][name]; cx,cy=P(gx+0.5,gy+0.5)
    fr=L(m['file']).crop((col*40,row*56,col*40+40,row*56+56))
    items.append((gx+gy+1.2 if key is None else key,fr,(int(round(cx-20)),int(round(cy-50-dz)))))
N=11
for gx in range(N):
    for gy in range(N):
        t='floor_wood_a' if (gx+gy)%2==0 else 'floor_wood_b'
        if gx>=7 and gy>=7: t='floor_carpet_green'
        elif gx>=6 and gy<=3 and gx<9: t='floor_marble'
        elif gx<=2 and gy>=6 and gy<10: t='floor_rug_owner'
        tile(t,gx,gy)
for gx in range(3,6):
    for gy in range(6,10): tile('floor_marble',gx,gy)
# walls
for gy in range(0,N,2): obj('walls','wall_window_left' if gy<6 else 'wall_plain_left',-0.15,gy,key=gy*0+gy+0.1)
for gx in range(0,N,2): obj('walls','wall_ornate_right' if gx>=6 else 'wall_window_right',gx,-0.15,key=gx+0.1)
# workspace
obj('props','desk_long',2,1); obj('props','desk_long',4,1)
char('penulis',2.3,2.05,4,2,dz=6); obj('props','office_chair',2.2,2.0)
char('publisher',4.3,2.05,5,2,dz=6); obj('props','gaming_chair',4.2,2.0)
obj('props','plant_large',0.2,0.3); obj('props','bookshelf',7,0.1)
obj('props','greenscreen',6.6,2.3); obj('props','ring_light',8.2,3.7); 
obj('props','sofa_grey',1,5); obj('props','coffee_table',1.4,6.4)
obj('props','corkboard',2.5,0.0)
# owner area
obj('props','owner_desk',0.1,7.0); char('aldy_owner',1.1,8.75,4,2,dz=6,key=13.0); obj('props','leather_chair',1.0,8.6,key=13.2)
obj('props','sofa_leather',3.2,9.2); obj('props','floor_lamp',2.8,6.4)
char('arif_riset',3.4,6.2,0,0); char('qc_agent',4.5,6.4,0,1)
# lobby
obj('props','pillar',6,4.4); obj('props','plant_large',8.5,0.5)
char('kurir',7.4,5.4,1,0); 
# musala
obj('props','minbar',9.3,7.2)
for i,(gx,gy) in enumerate([(7.2,7.4),(8.2,7.4),(7.2,8.7),(8.2,8.7)]): char('jamaah_mukena' if i%2==0 else 'jamaah_pria_peci',gx,gy,0,2)
char('aldy_khatib',9.75,7.4,0,0,dz=38,key=22)
obj('props','table_round_set',4,3.3); char('penulis',3.3,3.6,0,0)
items.sort(key=lambda t:t[0])
for _,im,pos in items: img.alpha_composite(im,pos)
bb=img.convert('RGB').point(lambda v:v).getbbox()
c=img.crop((150,60,950,540)); c=c.resize((c.width*2,c.height*2),Image.NEAREST); c.save('/home/claude/gen/scene.png'); c.save('/mnt/user-data/outputs/assets/preview_scene.png')
