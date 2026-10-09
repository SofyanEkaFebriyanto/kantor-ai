// ==================== ISO2D: engine isometric 2D pixel-art ====================
// Menggunakan asset dari Sofyan (static/assets/): tiles 64x32, props + anchor,
// karakter sprite-sheet 240x224 (6x4 frame @40x56).
// Rumus proyeksi dari _generator/compose.py:
//   P(gx,gy) = (OX + (gx-gy)*32, OY + (gx+gy)*16)
// Tile digambar di (x-32, y). Depth sort by (gx+gy).

const ISO2D = {
  manifest: null,
  img: {},          // cache Image per path
  OX: 0, OY: 0,     // origin layar (diatur kamera)
  zoom: 1,
  ready: false,
};

async function iso2dLoad(basePath){
  // basePath: 'static/assets/' (dari /kantorv3/) atau 'assets/' (dari /kantorv3/static/)
  // otomatis deteksi jika tidak diberikan
  if(!basePath){
    basePath = location.pathname.includes('/static/') ? 'assets/' : 'static/assets/';
  }
  const r = await fetch(basePath+'manifest.json?v=1');
  const j = await r.json();
  if(j.error) throw new Error('manifest: '+j.error);
  ISO2D.manifest = j;
  const base = basePath;
  const paths = new Set();
  const M = ISO2D.manifest;
  for(const k of ['tiles','props','walls','fx'])
    for(const n in M[k]){ const v=M[k][n]; if(v.file) paths.add(v.file); if(v.frames) v.frames.forEach(f=>paths.add(f)); }
  for(const n in M.characters) paths.add(M.characters[n].file);
  await Promise.all([...paths].map(p=>new Promise(res=>{
    const im = new Image();
    im.onload = ()=>{ ISO2D.img[p]=im; res(); };
    im.onerror = ()=>res();
    im.src = base+p;
  })));
  ISO2D.ready = true;
  ISO2D.loadedCount = Object.keys(ISO2D.img).length;
}

// --- proyeksi grid -> layar ---
function isoP(gx, gy){
  return [ISO2D.OX + (gx-gy)*32*ISO2D.zoom, ISO2D.OY + (gx+gy)*16*ISO2D.zoom];
}

// --- daftar gambar yang akan digambar (depth sort) ---
class IsoScene {
  constructor(){ this.items=[]; }
  clear(){ this.items.length=0; }
  // tile di sel (gx,gy) — simpan grid, hitung posisi saat draw (ikut kamera)
  tile(name, gx, gy){
    const t = ISO2D.manifest.tiles[name]; if(!t) return;
    this.items.push({depth: gx+gy-0.5, img: ISO2D.img[t.file], gx, gy, type:'tile'});
  }
  // prop dengan anchor & footprint dari manifest
  prop(kind, name, gx, gy, depthBoost=0){
    const m = ISO2D.manifest[kind][name]; if(!m) return;
    const fw=m.footprint[0], fd=m.footprint[1];
    this.items.push({depth: gx+gy+fw+fd+depthBoost, img: ISO2D.img[m.file],
      gx, gy, fw, fd, m, type:'prop'});
  }
  // karakter: sprite-sheet 6x4, frame (col,row), posisi grid (bisa pecahan)
  char(name, gx, gy, col, row, tint=null, dz=0){
    const m = ISO2D.manifest.characters[name]; if(!m) return;
    const sheet = ISO2D.img[m.file]; if(!sheet) return;
    this.items.push({depth: gx+gy+1.2, sheet,
      sx: col*40, sy: row*56, sw: 40, sh: 56,
      gx, gy, dz, tint, type:'char'});
  }
  // gambar datar (fx, badge) di posisi layar
  fx(name, gx, gy, dz=0){
    const m = ISO2D.manifest.fx[name]; if(!m) return;
    this.items.push({depth: gx+gy+1.5, img: ISO2D.img[m.file],
      gx, gy, dz, m, type:'fx'});
  }
  draw(ctx){
    this.items.sort((a,b)=>a.depth-b.depth);
    ctx.imageSmoothingEnabled = false;
    const z = ISO2D.zoom;
    for(const it of this.items){
      // hitung posisi layar dari grid + kamera saat ini (agar ikut pan/zoom)
      let dx, dy, dw, dh;
      if(it.type==='tile'){
        const [x,y] = isoP(it.gx, it.gy);
        dx=x-32*z; dy=y; dw=64*z; dh=32*z;
      } else if(it.type==='prop'){
        const [cx,cy] = isoP(it.gx+it.fw/2, it.gy+it.fd/2);
        dw=it.m.w*z; dh=it.m.h*z;
        dx=cx-it.m.anchor[0]*z; dy=cy-it.m.anchor[1]*z;
      } else if(it.type==='char'){
        const [cx,cy] = isoP(it.gx+0.5, it.gy+0.5);
        dw=40*z; dh=56*z;
        dx=cx-20*z; dy=cy-50*z-it.dz*z;
      } else if(it.type==='fx'){
        const [cx,cy] = isoP(it.gx+0.5, it.gy+0.5);
        dw=it.m.w*z; dh=it.m.h*z;
        dx=cx-(it.m.w/2)*z; dy=cy-it.m.h*z-it.dz*z;
      } else { continue; }
      if(it.sheet){
        if(it.tint){
          ctx.save();
          ctx.drawImage(it.sheet, it.sx,it.sy,it.sw,it.sh, dx,dy,dw,dh);
          ctx.globalCompositeOperation='multiply';
          ctx.fillStyle=it.tint;
          ctx.fillRect(dx,dy,dw,dh);
          ctx.restore();
        } else {
          ctx.drawImage(it.sheet, it.sx,it.sy,it.sw,it.sh, dx,dy,dw,dh);
        }
      } else if(it.img){
        ctx.drawImage(it.img, dx,dy,dw,dh);
      }
    }
  }
}
