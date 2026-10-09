// ==================== ISO RENDER: bangun & gambar scene kantor 2D ====================
// Menggantikan Three.js. Menggunakan ISO2D engine + ISO_GRID mapping.

const IsoRender = {
  canvas: null, ctx: null,
  scene: null,       // IsoScene untuk static (tiles, walls, props)
  camX: 0, camY: 0,  // offset kamera (px)
  zoom: 1,
  agents: [],        // {id, gx, gy, char, col, row, tint, label}
  
  async init(canvasId){
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    await iso2dLoad();
    this.buildStatic();
    this.resize();
    window.addEventListener('resize', ()=>this.resize());
    // kamera: tengah grid
    this.centerCamera();
    ISO2D.zoom = this.zoom;
  },
  
  resize(){
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
    this.canvas.style.width = r.width+'px';
    this.canvas.style.height = r.height+'px';
    this.ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    this.centerCamera();
  },
  
  centerCamera(){
    const w = this.canvas.width/devicePixelRatio, h = this.canvas.height/devicePixelRatio;
    // titik tengah grid (32, 21) -> layar tengah
    const [cx,cy] = [ (32-21)*32, (32+21)*16 ]; // tanpa OX/OY
    ISO2D.OX = w/2 - cx*this.zoom;
    ISO2D.OY = h/2 - cy*this.zoom - 100*this.zoom;
    ISO2D.zoom = this.zoom;
  },
  
  buildStatic(){
    const sc = new IsoScene();
    // 1. tiles per zona
    for(const [id,g] of Object.entries(ISO_GRID)){
      for(let x=0;x<g.gw;x++) for(let y=0;y<g.gd;y++){
        // pool: air di tengah
        if(id==='pool' && x>=2 && x<8 && y>=2 && y<6){
          sc.tile('water_0', g.gx+x, g.gy+y); // animasi nanti
        } else {
          sc.tile(g.floor, g.gx+x, g.gy+y);
        }
      }
      // 2. dinding (sisi kiri & kanan)
      if(g.walls){
        for(let i=0;i<g.gw;i+=2)
          sc.prop('walls', `wall_${g.walls}_right`, g.gx+i, g.gy-0.6, 10);
        for(let j=0;j<g.gd;j+=2)
          sc.prop('walls', `wall_${g.walls}_left`, g.gx-0.6, g.gy+j, 10);
      }
      // 3. props
      const props = ISO_PROPS[id]||[];
      for(const [kind,name,px,py] of props)
        sc.prop(kind, name, g.gx+px, g.gy+py);
    }
    this.scene = sc;
  },
  
  // set posisi agent (dipanggil dari game logic)
  setAgents(list){
    this.agents = list;
  },
  
  frame(){
    const ctx = this.ctx;
    const w = this.canvas.width/devicePixelRatio, h = this.canvas.height/devicePixelRatio;
    ctx.fillStyle = '#0a1030';
    ctx.fillRect(0,0,w,h);
    
    // gambar static
    this.scene.draw(ctx);
    
    // gambar agents (depth sort gabung)
    const sc = new IsoScene();
    // (static sudah digambar; agents digambar di atas dengan depth sendiri)
    // Untuk depth yang benar, kita gambar agents setelah static
    // (penyederhanaan: agents selalu di atas tiles tapi di-sort antar agents)
    const items = [];
    for(const a of this.agents){
      // gunakan IsoScene.char untuk hitung posisi
      const tmp = new IsoScene();
      tmp.char(a.char, a.gx, a.gy, a.col||0, a.row||0, a.tint||null);
      items.push(...tmp.items);
    }
    items.sort((x,y)=>x.depth-y.depth);
    ctx.imageSmoothingEnabled = false;
    const z2 = ISO2D.zoom;
    for(const it of items){
      // hitung posisi dari grid (format baru)
      const [cx2,cy2] = isoP(it.gx+0.5, it.gy+0.5);
      const dw2=40*z2, dh2=56*z2;
      const dx2=cx2-20*z2, dy2=cy2-50*z2-(it.dz||0)*z2;
      if(it.tint){
        ctx.save();
        ctx.drawImage(it.sheet, it.sx,it.sy,it.sw,it.sh, dx2,dy2,dw2,dh2);
        ctx.globalCompositeOperation='multiply';
        ctx.fillStyle=it.tint;
        ctx.fillRect(dx2,dy2,dw2,dh2);
        ctx.restore();
      } else {
        ctx.drawImage(it.sheet, it.sx,it.sy,it.sw,it.sh, dx2,dy2,dw2,dh2);
      }
    }
    
    // label nama (sederhana)
    ctx.font = `${11}px sans-serif`;
    ctx.textAlign = 'center';
    for(const a of this.agents){
      if(!a.label) continue;
      const [cx,cy] = isoP(a.gx+0.5, a.gy+0.5);
      const z = ISO2D.zoom;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(a.label).width;
      ctx.fillRect(cx-tw/2-4, cy-62*z, tw+8, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(a.label, cx, cy-62*z+11);
      // status dot
      if(a.statusColor){
        ctx.fillStyle = a.statusColor;
        ctx.beginPath(); ctx.arc(cx+tw/2+8, cy-62*z+7, 4, 0, 7); ctx.fill();
      }
    }
  },
  
  // kamera: geser
  pan(dx, dy){ ISO2D.OX += dx; ISO2D.OY += dy; },
  setZoom(z){
    this.zoom = Math.max(0.4, Math.min(2.5, z));
    ISO2D.zoom = this.zoom;
    this.centerCamera();
  }
};
