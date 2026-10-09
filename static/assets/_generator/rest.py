from lib import *
import json
props=json.load(open('/home/claude/gen/props_manifest.json'))['props']
MAN={'tile':{'w':64,'h':32,'note':'tile image top-left = P(gx,gy) - (32,0); P(gx,gy)=((gx-gy)*32,(gx+gy)*16)'},'tiles':{},'props':props,'walls':{},'characters':{},'fx':{}}

# ---- tiles ----
T={}
T['floor_wood_a']=save_tile('floor_wood_a',wood_fn(H('#C99A5B'),H('#B5834A')))
T['floor_wood_b']=save_tile('floor_wood_b',wood_fn(H('#D2A56A'),H('#C19058')))
T['floor_marble']=save_tile('floor_marble',marble_fn)
T['floor_carpet_green']=save_tile('floor_carpet_green',carpet_fn)
T['floor_deck']=save_tile('floor_deck',deck_fn)
T['floor_greenscreen']=save_tile('floor_greenscreen',gscreen_fn)
T['floor_coping']=save_tile('floor_coping',coping_fn)
T['floor_rug_owner']=save_tile('floor_rug_owner',rug_fn)
for i in range(4):
    T[f'water_{i}']=save_tile(f'water_{i}',water_fn(i*math.pi/2))
for k in T: MAN['tiles'][k]={'file':f'tiles/{k}.png','w':64,'h':32}
MAN['tiles']['water_anim']={'frames':['tiles/water_0.png','tiles/water_1.png','tiles/water_2.png','tiles/water_3.png'],'fps':1.6}

# ---- walls ----
CREAM=H('#E9DEC4'); WALL=H('#2B3550')
def wall(name,plane,L=2,H_=100,kind='window'):
    s=Scene(); t=0.15
    if plane=='x': w,d=t,L
    else: w,d=L,t
    s.box(0,0,0,w,d,H_,CREAM if kind=='ornate' else H('#D8CDB3'))
    k=t  # interior plane
    def R(u0,u1,z0,z1,c,o=None): s.rect(plane,k,u0,u1,z0,z1,c,o)
    base=CREAM if kind=='ornate' else H('#D8CDB3')
    R(0,L,0,H_,sh(base,0.78))  # wall face (interior)
    R(0,L,0,8,sh(DWc:=H('#4A2E1A'),1.0))  # skirting
    R(0,L,H_-6,H_,H('#E3B04B'))
    if kind=='window':
        R(0.12,L-0.12,20,92,H('#C9A24A'))
        n=36
        for i in range(n):
            z0=22+i*(68/n); c=mixc(H('#0C1633'),H('#27406E'),i/n)
            R(0.17,L-0.17,z0,z0+68/n+1,c)
        r=random.Random(5 if plane=='x' else 6)
        u=0.17
        while u<L-0.3:
            bw=r.uniform(0.12,0.3); bh=r.randint(14,44)
            R(u,min(u+bw,L-0.17),22,22+bh,H('#0A1128'))
            for zz in range(26,22+bh-2,6):
                for uu in (u+0.04,u+0.14):
                    if uu<L-0.2 and r.random()<0.55: R(uu,uu+0.05,zz,zz+3,H('#FFD87A'))
            u+=bw+0.02
        R(L/2-0.025,L/2+0.025,20,92,H('#C9A24A'))
        R(0.12,L-0.12,55,57,H('#C9A24A'))
        s.glass(plane,k,0.17,L-0.17,22,90,(180,215,235,40))
    elif kind=='ornate':
        for cu in (0.5,1.5):
            pts=[(cu-0.32,10),(cu+0.32,10),(cu+0.32,56)]
            for a in range(0,181,15):
                pts.append((cu+0.32*math.cos(math.radians(a)),56+22*math.sin(math.radians(a))))
            pts.append((cu-0.32,56))
            s.face(plane,k,pts,H('#C7B78C'),H('#B98529'))
            pts2=[(u*0.78+cu*0.22,z*0.9+8) for u,z in [(cu-0.32,10),(cu+0.32,10)]]
            s.face(plane,k,[(cu-0.2,16),(cu+0.2,16),(cu+0.2,54)]+[(cu+0.2*math.cos(math.radians(a)),54+14*math.sin(math.radians(a))) for a in range(0,181,20)]+[(cu-0.2,54)],H('#E3B04B'),None)
            s.face(plane,k,[(cu-0.14,18),(cu+0.14,18),(cu+0.14,54)]+[(cu+0.14*math.cos(math.radians(a)),54+10*math.sin(math.radians(a))) for a in range(0,181,20)]+[(cu-0.14,54)],H('#2E8B57'),None)
    elif kind=='plain':
        R(0,L,8,34,sh(base,0.62)); R(0,L,33,35,H('#C9A24A'))
    w_,d_=w,d
    s.save('walls',name,w_,d_,MAN['walls'])
wall('wall_window_left','x',kind='window'); wall('wall_window_right','y',kind='window')
wall('wall_ornate_left','x',kind='ornate'); wall('wall_ornate_right','y',kind='ornate')
wall('wall_plain_left','x',kind='plain'); wall('wall_plain_right','y',kind='plain')

# ---- characters ----
OUTLINE=(24,18,32)
def char_frame(c,back,f,pose):
    im=Image.new('RGBA',(40,56),(0,0,0,0)); d=ImageDraw.Draw(im)
    sit=pose=='sit'; walk=pose=='walk'
    bob=[0,-1,0,-1][f%4] if walk else 0
    oy=8 if sit else 0
    sk=c['skin']; hair=c.get('hair',H('#222')); shirt=c['shirt']; pants=c['pants']; shoes=c.get('shoes',H('#222'))
    muk=c.get('extra')=='mukena'
    s=2  # face shift toward facing side (SE)
    if not sit and not muk:
        lf=[0,1,2,1][f%4] if walk else 1
        for side,x0 in ((0,14),(1,21)):
            lift=(1 if (side==0 and lf==2) or (side==1 and lf==0) else 0)
            end=47-lift*2; off=(1 if (side==0 and lf==0) or (side==1 and lf==2) else (-1 if lift else 0))
            d.rectangle([x0+off,38+bob,x0+off+5,end],fill=pants if side==0 else sh(pants,0.82))
            d.rectangle([x0+off-1,end-2,x0+off+5+(0 if back else 1),end+1],fill=shoes if side==0 else sh(shoes,0.85))
    if sit and not back:
        d.rectangle([14,44,28,47],fill=pants); d.rectangle([24,45,32,48],fill=pants); d.rectangle([30,46,34,50],fill=shoes)
    ty0=27+oy+bob; ty1=39+oy+bob
    if muk:
        d.polygon([(10,20),(30,20),(33,49),(7,49)],fill=H('#F4F4F2'))
        d.polygon([(20,20),(30,20),(33,49),(20,49)],fill=H('#D9DCE0'))
        d.polygon([(8,44),(32,44),(33,49),(7,49)],fill=H('#E4E6E8'))
        d.ellipse([9,5,31,29],fill=H('#F4F4F2'))
        d.rectangle([10,47,16,50],fill=sk); d.rectangle([24,47,30,50],fill=sk)
        if not back:
            d.ellipse([12+s,11,28+s,24],fill=sk); 
            d.rectangle([17+s,16,18+s,17],fill=H('#222')); d.rectangle([23+s,16,24+s,17],fill=H('#222'))
        d.polygon([(9,24),(31,24),(30,30),(10,30)],fill=H('#E4E6E8'))
        return im
    # torso
    d.rectangle([13,ty0,27,ty1],fill=shirt)
    d.rectangle([21,ty0,27,ty1],fill=sh(shirt,0.84))
    if c.get('pattern')=='plaid':
        for x in range(13,28):
            for y in range(ty0,ty1+1):
                if ((x//3)+(y//3))%2==0: im.putpixel((x,y),sh(shirt,0.72))
                if x%6==0 or y%6==0: im.putpixel((x,y),sh(shirt,1.18))
    if c.get('extra')=='hoodie':
        d.ellipse([11,ty0-3,29,ty0+5],fill=sh(shirt,0.9))
        d.rectangle([17,ty0+6,23,ty1-1],fill=sh(shirt,0.88))
    if c.get('extra')=='jacket':
        d.line([(20,ty0),(20,ty1)],fill=sh(shirt,0.5)); d.rectangle([13,ty1-1,27,ty1],fill=sh(shirt,0.7))
    # arms
    sw=[0,1,0,-1][f%4] if walk else 0
    if sit:
        ay=ty0+1
        a1=ay+(f%2)*2; a2=ay+((f+1)%2)*2
        d.rectangle([10,ty0,13,ty0+8],fill=shirt); d.rectangle([27,ty0,30,ty0+8],fill=sh(shirt,0.84))
        d.rectangle([11,ty0+7,14,ty0+9+(f%2)],fill=sk); d.rectangle([26,ty0+7,29,ty0+9+((f+1)%2)],fill=sk)
    else:
        d.rectangle([10,ty0+1+sw,13,ty1-3+sw],fill=shirt); d.rectangle([27,ty0+1-sw,30,ty1-3-sw],fill=sh(shirt,0.84))
        d.rectangle([10,ty1-3+sw,13,ty1-1+sw],fill=sk); d.rectangle([27,ty1-3-sw,30,ty1-1-sw],fill=sk)
    # head
    hy=oy+bob
    d.rectangle([17,ty0-4,23,ty0],fill=sk)
    d.ellipse([11,7+hy,29,26+hy],fill=sk)
    d.ellipse([22,9+hy,29,25+hy],fill=sh(sk,0.92)) if False else None
    style=c.get('hair_style','short'); hat=c.get('hat')
    if style in('short','long','peci','cap','beanie'):
        if back:
            d.ellipse([10,5+hy,30,24+hy],fill=hair)
            if style=='long': d.rectangle([11,15+hy,29,31+hy],fill=hair); d.ellipse([10,22+hy,30,33+hy],fill=hair)
        else:
            d.ellipse([10,5+hy,30,20+hy],fill=hair)
            d.ellipse([12+s,11+hy,28+s,26+hy],fill=sk)
            if style=='long':
                d.rectangle([10,13+hy,13,31+hy],fill=hair); d.rectangle([27,13+hy,30,31+hy],fill=hair)
    if style=='hijab':
        col=c.get('scarf',H('#F4F4F2'))
        d.ellipse([9,4+hy,31,30+hy],fill=col)
        if not back: d.ellipse([13+s,11+hy,27+s,25+hy],fill=sk)
        d.polygon([(9,22+hy),(31,22+hy),(30,33+hy),(10,33+hy)],fill=sh(col,0.9))
    if hat=='peci':
        d.rectangle([12,4+hy,28,12+hy],fill=H('#111114')); d.rectangle([12,12+hy,28,13+hy],fill=H('#2A2A30'))
    if hat=='cap':
        cc=c.get('cap_col',H('#C0392B'))
        d.ellipse([10,3+hy,30,17+hy],fill=cc)
        if not back: d.rectangle([14+s,13+hy,32+s*2,15+hy],fill=sh(cc,0.7))
    if hat=='beanie':
        cc=c.get('cap_col',H('#333'))
        d.ellipse([10,3+hy,30,16+hy],fill=cc); d.rectangle([10,12+hy,30,14+hy],fill=sh(cc,0.7))
    if hat=='headphones':
        d.arc([10,3+hy,30,22+hy],200,340,fill=H('#222'),width=2); d.rectangle([9,14+hy,12,20+hy],fill=H('#222')); d.rectangle([28,14+hy,31,20+hy],fill=H('#222'))
    if not back and style!='hijab':
        if c.get('beard'):
            bc=c['beard']
            d.polygon([(14+s,20+hy),(26+s,20+hy),(25+s,26+hy),(20+s,29+hy),(15+s,26+hy)],fill=bc)
            d.rectangle([18+s,23+hy,22+s,23+hy],fill=sh(sk,0.75))
        else:
            d.rectangle([19+s,22+hy,21+s,22+hy],fill=sh(sk,0.7))
        ey=17+hy
        d.rectangle([16+s,ey,17+s,ey+2],fill=H('#1a1a1a')); d.rectangle([23+s,ey,24+s,ey+2],fill=H('#1a1a1a'))
        if c.get('glasses'):
            g=H('#15151c')
            d.rectangle([14+s,ey-2,19+s,ey+4],outline=g); d.rectangle([21+s,ey-2,26+s,ey+4],outline=g); d.line([(19+s,ey),(21+s,ey)],fill=g)
    elif not back and style=='hijab':
        ey=17+hy; d.rectangle([17+s,ey,18+s,ey+2],fill=H('#1a1a1a')); d.rectangle([23+s,ey,24+s,ey+2],fill=H('#1a1a1a'))
    return im

def outline(im):
    a=im.getchannel('A').point(lambda v:255 if v>0 else 0)
    dil=a.filter(ImageFilter.MaxFilter(3)); edge=ImageChops.subtract(dil,a)
    out=Image.new('RGBA',im.size,(0,0,0,0)); out.paste(Image.new('RGBA',im.size,OUTLINE+(255,)),(0,0),edge)
    out.alpha_composite(im); return out

def sheet(name,c):
    cols=6; sh_=Image.new('RGBA',(40*cols,56*4),(0,0,0,0))
    for r,(dirn,back,flip) in enumerate([('SE',False,False),('SW',False,True),('NE',True,False),('NW',True,True)]):
        for i in range(6):
            pose='walk' if i<4 else 'sit'
            fr=outline(char_frame(c,back,i if i<4 else i-4,pose))
            if flip: fr=fr.transpose(Image.FLIP_LEFT_RIGHT)
            sh_.alpha_composite(fr,(i*40,r*56))
    sh_.save(f'{OUT}/characters/{name}.png')
    MAN['characters'][name]={'file':f'characters/{name}.png','frame':[40,56],'anchor':[20,50],
      'rows':['SE','SW','NE','NW'],'cols':['walk0','walk1','walk2','walk3','sit0','sit1'],'walk_fps':8,'sit_fps':3}
    return sh_

SK=[H('#F2C9A0'),H('#E0A878'),H('#C68B5E'),H('#8D5B3A')]
CH={
 'aldy_owner':dict(skin=SK[1],hair_style='short',hair=H('#2A1E18'),beard=H('#2A1E18'),shirt=H('#F4F2EC'),pants=H('#B9A27C'),shoes=H('#D84A3A')),
 'aldy_khatib':dict(skin=SK[1],hair_style='short',hair=H('#2A1E18'),hat='peci',beard=H('#2A1E18'),shirt=H('#F4F2EC'),pants=H('#B9A27C'),shoes=H('#D84A3A')),
 'arif_riset':dict(skin=SK[0],hair_style='short',hair=H('#3A2A1E'),glasses=True,shirt=H('#B5322B'),pattern='plaid',pants=H('#4A5568'),shoes=H('#2A2A30')),
 'kurir':dict(skin=SK[2],hair_style='short',hair=H('#222'),hat='cap',cap_col=H('#E53935'),glasses=True,shirt=H('#B5322B'),pattern='plaid',pants=H('#3B2F2A'),shoes=H('#2A2A30')),
 'penulis':dict(skin=SK[0],hair_style='long',hair=H('#2EC4B6'),shirt=H('#F4C430'),extra='hoodie',pants=H('#2E3340'),shoes=H('#F1EDE4')),
 'publisher':dict(skin=SK[1],hair_style='bald',shirt=H('#23262F'),pants=H('#3A4150'),shoes=H('#111')),
 'satpam_slop':dict(skin=SK[2],hair_style='short',hair=H('#111'),hat='cap',cap_col=H('#1B1D26'),shirt=H('#1F2430'),extra='jacket',pants=H('#151822'),shoes=H('#0C0C10')),
 'sutradara':dict(skin=SK[3],hair_style='short',hair=H('#111'),hat='headphones',shirt=H('#6C3FB5'),pants=H('#2E3340'),shoes=H('#ddd')),
 'qc_agent':dict(skin=SK[0],hair_style='short',hair=H('#5A4636'),beard=H('#5A4636'),shirt=H('#2E3A4F'),extra='jacket',pants=H('#1E212C'),shoes=H('#2A2A30')),
 'npc_male_a':dict(skin=SK[2],hair_style='short',hair=H('#222'),shirt=H('#3C8D6E'),pants=H('#3A4150'),shoes=H('#222')),
 'npc_female_hijab':dict(skin=SK[1],hair_style='hijab',scarf=H('#E85D9A'),shirt=H('#7A4AA8'),pants=H('#2E3340'),shoes=H('#222')),
 'jamaah_mukena':dict(skin=SK[1],hair_style='hijab',extra='mukena',shirt=H('#fff'),pants=H('#fff')),
 'jamaah_pria_peci':dict(skin=SK[2],hair_style='short',hair=H('#222'),hat='peci',shirt=H('#F4F2EC'),pants=H('#F4F2EC'),shoes=H('#ddd')),
}
for k,v in CH.items(): sheet(k,v)

# ---- fx ----
def pizza():
    im=Image.new('RGBA',(18,18),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.polygon([(2,3),(16,3),(9,16)],fill=H('#F2B134'),outline=H('#7A3E12'))
    d.rectangle([2,2,16,4],fill=H('#D9923A'),outline=H('#7A3E12'))
    for x,y in [(6,6),(11,6),(9,10)]: d.ellipse([x-1,y-1,x+1,y+1],fill=H('#C0392B'))
    d.point((8,7),fill=H('#FFF3A0')); d.point((10,9),fill=H('#4DA06A'))
    return im
pizza().save(f'{OUT}/fx/pizza_slice.png')
bd=Image.new('RGBA',(16,16),(0,0,0,0)); ImageDraw.Draw(bd).ellipse([0,0,15,15],fill=H('#E53935'),outline=H('#7A1511')); bd.save(f'{OUT}/fx/badge_red.png')
gl=Image.new('RGBA',(128,128),(0,0,0,0))
for y in range(128):
    for x in range(128):
        r=math.hypot(x-63.5,y-63.5)/64
        if r<1: gl.putpixel((x,y),(255,214,140,int(150*(1-r)**2)))
gl.save(f'{OUT}/fx/glow_warm.png')
for col,n in [('green','#3DDC97'),('yellow','#FFD23F'),('red','#FF4D4D'),('grey','#8892A6')]:
    im=Image.new('RGBA',(7,7),(0,0,0,0)); ImageDraw.Draw(im).ellipse([0,0,6,6],fill=H(n),outline=(20,20,30)); im.save(f'{OUT}/fx/status_dot_{col}.png')
for n in ['pizza_slice','badge_red','glow_warm','status_dot_green','status_dot_yellow','status_dot_red','status_dot_grey']:
    MAN['fx'][n]={'file':f'fx/{n}.png'}
json.dump(MAN,open(f'{OUT}/manifest.json','w'),indent=1)
print('done',len(CH),'chars')
