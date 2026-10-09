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
    im.src = base+'assets/'+p;
  })));
  ISO2D.ready = true;
}

// --- proyeksi grid -> layar ---
function isoP(gx, gy){
  return [ISO2D.OX + (gx-gy)*32*ISO2D.zoom, ISO2D.OY + (gx+gy)*16*ISO2D.zoom];
}

// --- daftar gambar yang akan digambar (depth sort) ---
class IsoScene {
  constructor(){ this.items=[]; }
  clear(){ this.items.length=0; }
  // tile di sel (gx,gy)
  tile(name, gx, gy){
    const t = ISO2D.manifest.tiles[name]; if(!t) return;
    const [x,y] = isoP(gx,gy);
    this.items.push({depth: gx+gy-0.5, img: ISO2D.img[t.file],
      dx: x-32*ISO2D.zoom, dy: y, dw: 64*ISO2D.zoom, dh: 32*ISO2D.zoom});
  }
  // prop dengan anchor & footprint dari manifest
  prop(kind, name, gx, gy, depthBoost=0){
    const m = ISO2D.manifest[kind][name]; if(!m) return;
    const fw=m.footprint[0], fd=m.footprint[1];
    const [cx,cy] = isoP(gx+fw/2, gy+fd/2);
    const z = ISO2D.zoom;
    this.items.push({depth: gx+gy+fw+fd+depthBoost, img: ISO2D.img[m.file],
      dx: cx-m.anchor[0]*z, dy: cy-m.anchor[1]*z, dw: m.w*z, dh: m.h*z});
  }
  // karakter: sprite-sheet 6x4, frame (col,row), posisi grid (bisa pecahan)
  char(name, gx, gy, col, row, tint=null, dz=0){
    const m = ISO2D.manifest.characters[name]; if(!m) return;
    const sheet = ISO2D.img[m.file]; if(!sheet) return;
    const [cx,cy] = isoP(gx+0.5, gy+0.5);
    const z = ISO2D.zoom;
    this.items.push({depth: gx+gy+1.2, sheet,
      sx: col*40, sy: row*56, sw: 40, sh: 56,
      dx: cx-20*z, dy: cy-50*z-dz*z, dw: 40*z, dh: 56*z, tint});
  }
  // gambar datar (fx, badge) di posisi layar
  fx(name, gx, gy, dz=0){
    const m = ISO2D.manifest.fx[name]; if(!m) return;
    const [cx,cy] = isoP(gx+0.5, gy+0.5);
    const z = ISO2D.zoom;
    this.items.push({depth: gx+gy+1.5, img: ISO2D.img[m.file],
      dx: cx-(m.w/2)*z, dy: cy-m.h*z-dz*z, dw: m.w*z, dh: m.h*z});
  }
  draw(ctx){
    this.items.sort((a,b)=>a.depth-b.depth);
    ctx.imageSmoothingEnabled = false;
    for(const it of this.items){
      if(it.sheet){
        if(it.tint){
          // tint via offscreen: gambar frame lalu overlay warna multiply
          ctx.save();
          ctx.drawImage(it.sheet, it.sx,it.sy,it.sw,it.sh, it.dx,it.dy,it.dw,it.dh);
          ctx.globalCompositeOperation='multiply';
          ctx.fillStyle=it.tint;
          ctx.fillRect(it.dx,it.dy,it.dw,it.dh);
          ctx.restore();
        } else {
          ctx.drawImage(it.sheet, it.sx,it.sy,it.sw,it.sh, it.dx,it.dy,it.dw,it.dh);
        }
      } else if(it.img){
        ctx.drawImage(it.img, it.dx,it.dy,it.dw,it.dh);
      }
    }
  }
}
