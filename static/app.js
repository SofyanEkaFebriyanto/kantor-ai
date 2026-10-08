/* Kantor AI v3 — diorama 3D isometric.
   Three.js WebGL asli: karakter chibi prosedural, cutaway rooms, lighting/shadow.
   Live feed: GET /api/live -> {live:{agentId:{status,detail,updated_at}}, ...}
   Snapshot basi/kosong -> mode ambient (jelas dibedakan via badge + tanpa label). */
import * as THREE from 'three';

const $ = s => document.querySelector(s);
const API = {
  async get(p){ const r = await fetch(p); if(!r.ok) throw new Error(r.status); return r.json(); },
  async post(p, b){ const r = await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    const j = await r.json(); if(!r.ok) throw new Error(j.error||r.status); return j; }
};
const STATUS_COLOR = {working:'#4caf50',reading:'#2196f3',running:'#ff9800',idle:'#9e9e9e',waiting:'#e91e63',done:'#8bc34a'};
const LIVE_TTL_MS = 120000;

// ---------- state ----------
const S = {
  divisions: [], agents: [], byId: {}, byDiv: {},
  live: {},            // agentId -> {status, detail, updated_at}
  queue: [], activity: [],
  serverOk: false, demo: false,
  selected: null, hovered: null,
  camTarget: new THREE.Vector3(0, 0, 35),
};

// ---------- renderer / scene ----------
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2118);
scene.fog = new THREE.Fog(0x2a2118, 220, 420);

// kamera isometric: orthographic, sudut tetap (azimuth 45°, elevasi ~35.26°)
// frustum responsif: layar portrait (HP) dapat frustum lebih besar agar proporsional
function baseFrustum(){ return (innerWidth/innerHeight) < 0.8 ? 125 : 95; }
let FRUSTUM = baseFrustum();
let aspect = innerWidth/innerHeight;
const camera = new THREE.OrthographicCamera(
  -FRUSTUM*aspect/2, FRUSTUM*aspect/2, FRUSTUM/2, -FRUSTUM/2, 1, 600);
const ISO_DIR = new THREE.Vector3(1,1,1).normalize();
function placeCamera(){
  camera.position.copy(S.camTarget).addScaledVector(ISO_DIR, 260);
  camera.lookAt(S.camTarget);
  camera.updateProjectionMatrix();
}
placeCamera();

// kontrol: pan (drag) + zoom (wheel/pinch). Rotasi dikunci -> isometric tetap.
let zoom = 1;
(function controls(){
  let drag=null; const pts=new Map(); let pinchD=0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e=>{ pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===1) drag={x:e.clientX,y:e.clientY};
    if(pts.size===2){ const p=[...pts.values()]; pinchD=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]); drag=null; }
    el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e=>{
    if(!pts.has(e.pointerId)) return;
    pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2){ const p=[...pts.values()];
      const d=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);
      if(pinchD>0) setZoom(zoom*d/pinchD); pinchD=d; return; }
    if(drag){ const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag={x:e.clientX,y:e.clientY};
      if(Math.abs(dx)+Math.abs(dy)<3) return;
      panBy(-dx, -dy); S._dragged=true; }
  });
  const up = e=>{ pts.delete(e.pointerId); if(pts.size<2) drag=null; if(pts.size===0) setTimeout(()=>S._dragged=false,50); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e=>{ e.preventDefault(); setZoom(zoom*(e.deltaY>0?1.12:0.89)); }, {passive:false});
  window._panBy = panBy;
})();
function panBy(dxPx, dyPx){
  const wpp = (FRUSTUM/zoom)/renderer.domElement.clientHeight; // world per pixel
  const right = new THREE.Vector3(1,0,0), up2 = new THREE.Vector3(0,0,-1);
  // proyeksi gerakan layar ke bidang tanah: kanan & "atas layar" -> -z
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y=0; fwd.normalize();
  // kanan-kamera = forward × up (grab-style: konten ngikutin jari)
  const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0));
  S.camTarget.addScaledVector(rgt, dxPx*wpp).addScaledVector(fwd, -dyPx*wpp);
  clampTarget(); placeCamera();
}
function clampTarget(){
  S.camTarget.x = Math.max(-85, Math.min(85, S.camTarget.x));
  S.camTarget.z = Math.max(-15, Math.min(90, S.camTarget.z));
}
function setZoom(z){ zoom = Math.max(0.55, Math.min(3.2, z)); camera.zoom = zoom; camera.updateProjectionMatrix(); }
setZoom(1);
function focusOn(x, z){
  const from = S.camTarget.clone(), to = new THREE.Vector3(x, 0, z);
  const t0 = performance.now();
  (function step(){ const k = Math.min(1,(performance.now()-t0)/600), e = 1-Math.pow(1-k,3);
    S.camTarget.lerpVectors(from, to, e); clampTarget(); placeCamera();
    if(k<1) requestAnimationFrame(step); })();
}

// ---------- lighting ----------
scene.add(new THREE.HemisphereLight(0xfff2dd, 0x5a4a38, 0.85));
const sun = new THREE.DirectionalLight(0xffe7c4, 1.9);
sun.position.set(70, 110, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left=-110; sun.shadow.camera.right=110;
sun.shadow.camera.top=110; sun.shadow.camera.bottom=-110;
sun.shadow.camera.far=320; sun.shadow.bias=-0.0004;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35);
fill.position.set(-60, 40, -40); scene.add(fill);

// ---------- alas diorama ----------
{
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(178, 5, 108),
    new THREE.MeshStandardMaterial({color:0x8a6742, roughness:0.9}));
  base.position.set(0, -2.55, 36); base.receiveShadow = true; scene.add(base);
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(180, 0.7, 110),
    new THREE.MeshStandardMaterial({color:0x6e4f30, roughness:0.9}));
  trim.position.set(0, -5.2, 36); scene.add(trim);
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({color:0x3a4a2e, roughness:1}));
  lawn.rotation.x = -Math.PI/2; lawn.position.y = -5.6; lawn.receiveShadow = true; scene.add(lawn);
}

function box(w,h,d,color,x,y,z,ry=0){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),
    new THREE.MeshStandardMaterial({color, roughness:0.85}));
  m.position.set(x,y,z); m.rotation.y=ry; m.castShadow=true; m.receiveShadow=true;
  scene.add(m); return m;
}
function cyl(rt,rb,h,color,x,y,z,seg=20){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),
    new THREE.MeshStandardMaterial({color, roughness:0.85}));
  m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; scene.add(m); return m;
}

// ==================== BAGIAN B: ruangan & furniture ====================
const FLOOR_TOP = z => z.baseY + 0.25;
S.zones = {};

function plant(x, y, z, s=1){
  cyl(0.28*s, 0.34*s, 0.5*s, 0xa8572f, x, y+0.25*s, z, 12);
  const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55*s, 1),
    new THREE.MeshStandardMaterial({color:0x4d7c3a, roughness:0.9, flatShading:true}));
  f.position.set(x, y+0.95*s, z); f.castShadow=true; scene.add(f);
}

function buildZones(){
  for(const d of S.divisions){
    const {x, z, w, dd} = {x:d.rect.x, z:d.rect.z, w:d.rect.w, dd:d.rect.d};
    const baseY = d.baseY||0, top = baseY+0.25;
    S.zones[d.id] = {...d, top};
    const col = new THREE.Color(d.color);
    // lantai zona
    const h = d.id==='cafe' ? 3 : 0.5;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd),
      new THREE.MeshStandardMaterial({color:0xefe6d4, roughness:0.95}));
    fl.position.set(x, baseY + h/2 - (d.id==='cafe'?0:0), z);
    if(d.id==='cafe') fl.position.y = baseY - h/2 + 0.25; // top slab di baseY+0.25
    fl.receiveShadow = true; scene.add(fl);
    // aksen warna divisi: garis tepi lantai
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w+0.3, 0.1, dd+0.3),
      new THREE.MeshStandardMaterial({color:col, roughness:0.8}));
    edge.position.set(x, top-0.12, z); scene.add(edge);
    // dinding cutaway: belakang (-z) & kiri (-x)
    const wh = 2.6, wt = 0.35;
    const wallMat = new THREE.MeshStandardMaterial({color:0xf5eedd, roughness:0.95});
    const wb = new THREE.Mesh(new THREE.BoxGeometry(w, wh, wt), wallMat);
    wb.position.set(x, top+wh/2, z-dd/2+wt/2); wb.castShadow=wb.receiveShadow=true; scene.add(wb);
    const wl = new THREE.Mesh(new THREE.BoxGeometry(wt, wh, dd), wallMat);
    wl.position.set(x-w/2+wt/2, top+wh/2, z); wl.castShadow=wl.receiveShadow=true; scene.add(wl);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, wt+0.06),
      new THREE.MeshStandardMaterial({color:col, roughness:0.7}));
    trim.position.set(x, top+wh+0.09, z-dd/2+wt/2); scene.add(trim);
    // tanaman sudut
    plant(x-w/2+1.2, top, z+dd/2-1.2, 0.9);
    if(w>14) plant(x+w/2-1.2, top, z+dd/2-1.2, 0.7);
    if(d.kind==='special') buildSpecial(d, top);
  }
}

function buildSpecial(d, top){
  const {x, z, w, dd} = {x:d.rect.x, z:d.rect.z, w:d.rect.w, dd:d.rect.d};
  if(d.id==='lobby'){
    box(5.5,1.0,1.4, 0x9c6b43, x-2, top+0.5, z-2.5);                    // meja resepsionis
    box(5.5,0.12,1.5, 0xc9a06a, x-2, top+1.05, z-2.5);
    const rug = cyl(2.2,2.2,0.06, 0xb34a4a, x+2.5, top+0.03, z+1, 28); rug.receiveShadow=true;
    sofa(x+1.2, top, z+2.2, 0); sofa(x+4.2, top, z+0.2, Math.PI/2);
    plant(x+w/2-1.5, top, z-dd/2+1.5, 1.1);
  }
  if(d.id==='owner'){
    box(2.6,0.75,1.3, 0x6e4a2f, x, top+0.38, z-1);                     // meja besar
    box(2.7,0.1,1.4, 0x8a5f3a, x, top+0.8, z-1);
    box(0.7,0.9,0.7, 0x3d2b1f, x, top+0.45, z+0.6);                    // kursi eksekutif
    box(0.7,0.9,0.15, 0x3d2b1f, x, top+1.1, z+0.95);
    for(let i=0;i<3;i++) box(2.2,0.08,0.7, 0x9c6b43, x-3, top+0.6+i*0.65, z-dd/2+1); // rak
    const rug = cyl(1.8,1.8,0.06, 0x4a6b8a, x, top+0.03, z+1.5, 26); rug.receiveShadow=true;
  }
  if(d.id==='musholla'){
    for(let r=0;r<2;r++) for(let c=0;c<3;c++)
      box(1.1,0.07,2.0, r%2? 0x7a9b7a:0x9b8a7a, x-2.4+c*2.4, top+0.035, z-1+r*2.6);
    box(0.15,1.6,dd-2, 0xd8cba8, x+w/2-1, top+0.8, z);                 // partisi
    box(1.6,0.9,0.5, 0x9c6b43, x-w/2+1.2, top+0.45, z-dd/2+1);         // rak mukena
  }
  if(d.id==='pool'){
    const water = box(9,0.5,5.5, 0x3f9fd8, x, top+0.1, z);
    water.material = new THREE.MeshStandardMaterial({color:0x3f9fd8, roughness:0.25,
      metalness:0.1, transparent:true, opacity:0.92});
    S.water = water;
    box(9.8,0.35,0.4, 0xe8dfcf, x, top+0.18, z-2.95); box(9.8,0.35,0.4, 0xe8dfcf, x, top+0.18, z+2.95);
    box(0.4,0.35,6.3, 0xe8dfcf, x-5.1, top+0.18, z); box(0.4,0.35,6.3, 0xe8dfcf, x+5.1, top+0.18, z);
    for(let i=0;i<3;i++){ const lx=x-4+i*4;
      box(0.8,0.25,1.8, 0xd88a4a, lx, top+0.35, z+4.2);                // kursi santai
      box(0.8,0.7,0.15, 0xd88a4a, lx, top+0.7, z+5.0); }
  }
  if(d.id==='cafe'){
    for(let i=0;i<4;i++){ const tx=x-5.5+(i%2)*8, tz=z-2.5+Math.floor(i/2)*5;
      cyl(0.09,0.09,0.75, 0x6e4a2f, tx, top+0.38, tz, 10);
      cyl(0.75,0.75,0.08, 0xf3ead9, tx, top+0.79, tz, 18);
      cyl(0.05,0.05,1.6, 0x8a5f3a, tx+1.6, top+0.8, tz, 8);
      const um = new THREE.Mesh(new THREE.ConeGeometry(1.25,0.55,12),
        new THREE.MeshStandardMaterial({color:[0xc96f2e,0x4f8ff7,0x8a4a6b,0x4d7c3a][i], roughness:0.8}));
      um.position.set(tx+1.6, top+1.85, tz); um.castShadow=true; scene.add(um);
    }
    // railing
    const rh=0.9, rt=0.12;
    box(w,rh,rt, 0x9c6b43, x, top+rh/2, z-dd/2+rt/2); box(w,rh,rt, 0x9c6b43, x, top+rh/2, z+dd/2-rt/2);
    box(rt,rh,dd, 0x9c6b43, x-w/2+rt/2, top+rh/2, z); box(rt,rh,dd, 0x9c6b43, x+w/2-rt/2, top+rh/2, z);
    // tangga
    for(let i=0;i<6;i++) box(2.2,0.5,0.9, 0xb08968, x-w/2-1.4, 0.25+i*0.5, z+dd/2+2.5-i*0.9);
  }
}
function sofa(x,y,z,ry){
  const g = new THREE.Group(); g.position.set(x,y,z); g.rotation.y=ry;
  const mat = new THREE.MeshStandardMaterial({color:0x8a4a5e, roughness:0.9});
  const add=(w,h,d,px,py,pz)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(px,py,pz); m.castShadow=m.receiveShadow=true; g.add(m); };
  add(2.2,0.45,0.9, 0,0.28,0); add(2.2,0.7,0.25, 0,0.75,-0.35);
  add(0.25,0.65,0.9, -1.0,0.55,0); add(0.25,0.65,0.9, 1.0,0.55,0);
  scene.add(g);
}

// meja + kursi untuk SEMUA agent: 4 InstancedMesh (1 draw call per jenis)
function buildFurniture(){
  const n = S.agents.length;
  const deskTopG = new THREE.BoxGeometry(1.7,0.09,1.0);
  const deskBodyG = new THREE.BoxGeometry(1.55,0.68,0.85);
  const seatG = new THREE.BoxGeometry(0.6,0.09,0.6);
  const backG = new THREE.BoxGeometry(0.6,0.65,0.09);
  const wood = new THREE.MeshStandardMaterial({color:0xb08968, roughness:0.85});
  const woodD = new THREE.MeshStandardMaterial({color:0x96704c, roughness:0.85});
  const chairM = new THREE.MeshStandardMaterial({color:0x5a6b7d, roughness:0.85});
  const mk = (geo, mat)=>{ const im=new THREE.InstancedMesh(geo,mat,n);
    im.castShadow=im.receiveShadow=true; scene.add(im); return im; };
  const tT=mk(deskTopG,wood), tB=mk(deskBodyG,woodD), tS=mk(seatG,chairM), tB2=mk(backG,chairM);
  const M=new THREE.Matrix4(), Q=new THREE.Quaternion(), V=new THREE.Vector3(), SC=new THREE.Vector3(1,1,1);
  S.agents.forEach((a,i)=>{
    const zn=S.zones[a.division], top=zn.top, dx=a.desk.x, dz=a.desk.z;
    const put=(im,px,py,pz)=>{ V.set(px,py,pz); M.compose(V,Q,SC); im.setMatrixAt(i,M); };
    put(tT, dx, top+0.74, dz); put(tB, dx, top+0.37, dz);
    put(tS, dx, top+0.47, dz+1.05); put(tB2, dx, top+0.82, dz+1.32);
    // monitor mungil di meja
    // (digabung ke deskBody? tidak — skip, cukup)
  });
  [tT,tB,tS,tB2].forEach(im=>im.instanceMatrix.needsUpdate=true);
  // monitor: 1 instanced lagi (layar)
  const monG = new THREE.BoxGeometry(0.62,0.4,0.06);
  const monM = new THREE.MeshStandardMaterial({color:0x2b3a4a, roughness:0.4, emissive:0x1a2a3a, emissiveIntensity:0.5});
  const tM = mk(monG, monM);
  S.agents.forEach((a,i)=>{ const zn=S.zones[a.division];
    V.set(a.desk.x, zn.top+1.05, a.desk.z-0.25); M.compose(V,Q,SC); tM.setMatrixAt(i,M); });
  tM.instanceMatrix.needsUpdate = true;
}

// ==================== BAGIAN C: karakter chibi ====================
const _c = h => new THREE.Color(h);
function makeChibi(o={}){
  const g = new THREE.Group();
  const shirt=_c(o.shirt??0x4f8ff7), skin=_c(o.skin??0xf1c27d), hairC=_c(o.hair??0x232323);
  const mS=new THREE.MeshStandardMaterial({color:shirt,roughness:0.8});
  const mK=new THREE.MeshStandardMaterial({color:skin,roughness:0.8});
  const mH=new THREE.MeshStandardMaterial({color:hairC,roughness:0.85});
  const mP=new THREE.MeshStandardMaterial({color:0x3a3f4a,roughness:0.9});
  const mE=new THREE.MeshStandardMaterial({color:0x141414,roughness:0.6});
  const parts={};
  const add=(geo,mat,px,py,pz,parent=g)=>{ const m=new THREE.Mesh(geo,mat);
    m.position.set(px,py,pz); m.castShadow=true; parent.add(m); return m; };
  for(const s of [-1,1]){
    const leg=new THREE.Group(); leg.position.set(0.14*s,0.55,0); g.add(leg);
    add(new THREE.CapsuleGeometry(0.11,0.32,4,10),mP,0,-0.27,0,leg);
    parts[s<0?'legL':'legR']=leg;
    const arm=new THREE.Group(); arm.position.set(0.37*s,1.2,0); g.add(arm);
    add(new THREE.CapsuleGeometry(0.09,0.3,4,10),mS,0,-0.24,0,arm);
    add(new THREE.SphereGeometry(0.09,10,8),mK,0,-0.46,0,arm);
    parts[s<0?'armL':'armR']=arm;
  }
  parts.body=add(new THREE.CapsuleGeometry(0.28,0.42,4,12),mS,0,0.98,0);
  parts.head=add(new THREE.SphereGeometry(0.32,18,14),mK,0,1.58,0);
  const hair=add(new THREE.SphereGeometry(0.345,18,14),mH,0,1.70,-0.02);
  hair.scale.set(1,0.72,1); parts.hair=hair;
  parts.eyeL=add(new THREE.SphereGeometry(0.05,10,8),mE,-0.12,1.60,0.285);
  parts.eyeR=add(new THREE.SphereGeometry(0.05,10,8),mE,0.12,1.60,0.285);
  const book=add(new THREE.BoxGeometry(0.36,0.06,0.28),
    new THREE.MeshStandardMaterial({color:0x8a5a3b,roughness:0.85}),0,1.02,0.38);
  book.visible=false; parts.book=book;
  scene.add(g);
  return {g, parts, status:'idle', t:Math.random()*10, blink:2+Math.random()*3,
          moveTo:null, yaw:0, baseY:0, label:null};
}

function animChibi(ch, dt){
  const p=ch.parts, t=ch.t+=dt;
  // blink
  ch.blink-=dt;
  const eyeS = ch.blink<0.13 ? 0.12 : 1;
  p.eyeL.scale.y=p.eyeR.scale.y=eyeS;
  if(ch.blink<=0) ch.blink=2+Math.random()*3.5;
  // reset pose dasar
  const A=p.armL.rotation, B=p.armR.rotation, L=p.legL.rotation, R=p.legR.rotation;
  A.set(0,0,0.12); B.set(0,0,-0.12); L.set(0,0,0); R.set(0,0,0);
  p.book.visible=false; p.head.rotation.set(0,0,0); p.body.scale.set(1,1,1);
  ch.g.position.y = ch.baseY; ch.hop=0;
  switch(ch.status){
    case 'working': // mengetik
      A.x=-1.05+Math.sin(t*13)*0.16; B.x=-1.05+Math.sin(t*13+Math.PI)*0.16;
      A.z=0.25; B.z=-0.25; p.head.rotation.x=0.3;
      ch.g.position.y=ch.baseY+Math.abs(Math.sin(t*13))*0.02; break;
    case 'reading':
      p.book.visible=true; A.x=-0.9; B.x=-0.9; A.z=0.3; B.z=-0.3;
      p.head.rotation.x=0.52; p.head.rotation.z=0.04*Math.sin(t*1.6); break;
    case 'waiting':
      p.head.rotation.y=0.65*Math.sin(t*1.15); A.x=-0.15; B.x=-0.15;
      ch.g.position.y=ch.baseY+Math.abs(Math.sin(t*2.2))*0.03; break;
    case 'running': case 'walk': {
      const run=ch.status==='running', f=run?11:6.5, amp=run?0.95:0.5;
      L.x=Math.sin(t*f)*amp; R.x=Math.sin(t*f+Math.PI)*amp;
      A.x=Math.sin(t*f+Math.PI)*(run?0.75:0.4); B.x=Math.sin(t*f)*(run?0.75:0.4);
      p.body.rotation.x=run?0.22:0.08;
      ch.g.position.y=ch.baseY+Math.abs(Math.sin(t*f))*(run?0.09:0.05); break; }
    case 'done':
      ch.g.position.y=ch.baseY+Math.abs(Math.sin(t*5))*0.55;
      A.z=2.5; B.z=-2.5; A.x=B.x=-0.2; p.head.rotation.x=-0.15; break;
    default: // idle
      p.body.scale.y=1+0.02*Math.sin(t*2);
      p.head.rotation.y=0.3*Math.sin(t*0.45);
  }
  p.body.rotation.x*=0.9; // redam lean saat tidak lari
  // gerakan menuju target
  if(ch.moveTo){
    const m=ch.moveTo, dx=m.x-ch.g.position.x, dz=m.z-ch.g.position.z;
    const dist=Math.hypot(dx,dz);
    if(dist<0.35){ ch.g.position.x=m.x; ch.g.position.z=m.z; const cb=m.onDone; ch.moveTo=null; cb&&cb(); }
    else{
      const want=Math.atan2(dx,dz), d=want-ch.yaw;
      ch.yaw+=Math.atan2(Math.sin(d),Math.cos(d))*Math.min(1,dt*8);
      ch.g.rotation.y=ch.yaw;
      ch.g.position.x+=dx/dist*m.speed*dt; ch.g.position.z+=dz/dist*m.speed*dt;
      if(ch.baseY!==undefined) ch.g.position.y=ch.baseY;
    }
  } else ch.g.rotation.y=ch.yaw;
}

// ---------- crowd ambient: 3 InstancedMesh ----------
let crowd=null;
function buildCrowd(){
  const n=S.agents.length;
  const mk=(geo)=>{ const im=new THREE.InstancedMesh(geo,
    new THREE.MeshStandardMaterial({roughness:0.85}), n);
    im.castShadow=true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(im); return im; };
  crowd={ body:mk(new THREE.CapsuleGeometry(0.28,0.42,4,10)),
          head:mk(new THREE.SphereGeometry(0.32,12,10)),
          hair:mk(new THREE.SphereGeometry(0.345,12,10)),
          items:[], hidden:new Set() };
  const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),V=new THREE.Vector3(),
        SC=new THREE.Vector3(),E=new THREE.Euler(),HS=new THREE.Vector3(1,0.72,1);
  S.agents.forEach((a,i)=>{
    const zn=S.zones[a.division];
    const it={x:a.desk.x+(Math.random()-0.5)*3, z:a.desk.z+(Math.random()-0.5)*3,
              tx:0,tz:0,y:zn.top,speed:0.9+Math.random()*0.7,ph:Math.random()*9,
              zn, wait:Math.random()*4};
    pickTarget(it); it.x=it.tx; it.z=it.tz; pickTarget(it);
    crowd.items.push(it);
    crowd.body.setColorAt(i,_c(a.color)); crowd.head.setColorAt(i,_c(a.skin)); crowd.hair.setColorAt(i,_c(a.hair));
  });
  crowd.body.instanceColor.needsUpdate=true;
  crowd.head.instanceColor.needsUpdate=true;
  crowd.hair.instanceColor.needsUpdate=true;
}
function pickTarget(it){
  const r=it.zn.rect;
  it.tx=r.x+(Math.random()-0.5)*(r.w-3); it.tz=r.z+(Math.random()-0.5)*(r.d-3);
  it.wait=2+Math.random()*7;
}
function updateCrowd(dt,t){
  if(!crowd) return;
  const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),V=new THREE.Vector3(),
        SC=new THREE.Vector3(),E=new THREE.Euler(),HS=new THREE.Vector3(1,0.72,1),
        ZERO=new THREE.Matrix4().makeScale(0,0,0);
  crowd.items.forEach((it,i)=>{
    if(crowd.hidden.has(i)){ crowd.body.setMatrixAt(i,ZERO); crowd.head.setMatrixAt(i,ZERO); crowd.hair.setMatrixAt(i,ZERO); return; }
    const dx=it.tx-it.x, dz=it.tz-it.z, dist=Math.hypot(dx,dz);
    let bob=0, yaw=it.yaw||0;
    if(dist>0.4){
      it.x+=dx/dist*it.speed*dt; it.z+=dz/dist*it.speed*dt;
      yaw=Math.atan2(dx,dz); bob=Math.abs(Math.sin(t*7+it.ph))*0.07;
    } else if((it.wait-=dt)<=0) pickTarget(it);
    it.yaw=yaw; E.set(0,yaw,0); Q.setFromEuler(E);
    V.set(it.x,it.y+0.98+bob,it.z); SC.set(1,1,1); M.compose(V,Q,SC); crowd.body.setMatrixAt(i,M);
    V.set(it.x,it.y+1.58+bob,it.z); M.compose(V,Q,SC); crowd.head.setMatrixAt(i,M);
    V.set(it.x,it.y+1.70+bob,it.z-0.02); M.compose(V,Q,HS); crowd.hair.setMatrixAt(i,M);
  });
  crowd.body.instanceMatrix.needsUpdate=true;
  crowd.head.instanceMatrix.needsUpdate=true;
  crowd.hair.instanceMatrix.needsUpdate=true;
}

// ---------- karakter live (artikulasi penuh) ----------
S.liveChars={};
function spawnLiveChar(id, entry){
  const a=S.byId[id];
  let x,z,yaw,top;
  if(id==='noir'){ const zn=S.zones.lobby; x=zn.rect.x+3; z=zn.rect.z+3; top=zn.top; yaw=Math.PI*0.75; }
  else if(id==='bos'){ const zn=S.zones.owner; x=zn.rect.x; z=zn.rect.z+0.4; top=zn.top; yaw=Math.PI; }
  else if(a){ const zn=S.zones[a.division]; x=a.desk.x; z=a.desk.z+0.62; top=zn.top; yaw=Math.PI; }
  else return null;
  const ch=makeChibi(a?{shirt:a.color,skin:a.skin,hair:a.hair}:{shirt:'#23232b',skin:'#e0ac69',hair:'#111111'});
  ch.g.position.set(x,top,z); ch.baseY=top; ch.yaw=yaw; ch.g.rotation.y=yaw;
  ch.status=entry.status; ch.detail=entry.detail||'';
  if(entry.status==='running') runLoop(ch);
  S.liveChars[id]=ch;
  const idx=a?S.agents.indexOf(a):-1;
  if(idx>=0&&crowd) crowd.hidden.add(idx);
  return ch;
}
function runLoop(ch){
  const pts=[[-60,8],[60,8],[60,62],[-60,62]];
  let k=0;
  const go=()=>{ const p=pts[k%pts.length]; k++;
    ch.status='running'; ch.moveTo={x:p[0],z:p[1],speed:5.5,onDone:go}; };
  go();
}
function removeLiveChar(id){
  const ch=S.liveChars[id]; if(!ch) return;
  scene.remove(ch.g); delete S.liveChars[id];
  const a=S.byId[id];
  if(a&&crowd) crowd.hidden.delete(S.agents.indexOf(a));
}
function freshLive(){
  const out={}, now=Date.now();
  for(const [id,e] of Object.entries(S.live)){
    if(now-new Date(e.updated_at).getTime()<LIVE_TTL_MS) out[id]=e;
  }
  return out;
}
function syncLive(){
  const fresh=freshLive();
  for(const [id,e] of Object.entries(fresh)){
    const ch=S.liveChars[id];
    if(ch){ if(ch.status!==e.status&&e.status!=='running'){ch.status=e.status;ch.moveTo=null;} ch.detail=e.detail||''; }
    else spawnLiveChar(id,e);
  }
  for(const id of Object.keys(S.liveChars)) if(!fresh[id]) removeLiveChar(id);
  // badge LIVE vs AMBIENT
  const n=Object.keys(fresh).length;
  const b=$('#live-badge');
  if(!S.serverOk){ b.textContent='OFFLINE'; b.className='badge ambient'; }
  else if(n>0){ b.textContent='● LIVE ('+n+')'; b.className='badge live'; }
  else { b.textContent='AMBIENT'; b.className='badge ambient'; }
}

// ---------- karakter spesial: Noir & Bos (selalu ada, ambient) ----------
function initSpecials(){
  const noir=makeChibi({shirt:'#23232b',skin:'#e0ac69',hair:'#0d0d0f'});
  const zn=S.zones.lobby;
  noir.g.position.set(zn.rect.x-4, zn.top, zn.rect.z+2.5); noir.baseY=zn.top;
  noir.yaw=Math.PI*0.6; noir.g.rotation.y=noir.yaw; noir.status='idle';
  noir.isSpecial='noir'; noir.label='Noir';
  const bos=makeChibi({shirt:'#d4af6e',skin:'#c68642',hair:'#4a3222'});
  const zo=S.zones.owner;
  bos.g.position.set(zo.rect.x, zo.top, zo.rect.z+0.4); bos.baseY=zo.top;
  bos.yaw=Math.PI; bos.g.rotation.y=Math.PI; bos.status='idle';
  bos.isSpecial='bos'; bos.label='Bos';
  S.specialChars=[noir,bos];
}

// ---------- mode demo: 3 karakter contoh, JELAS berlabel DEMO ----------
S.demoChars=[];
const DEMO_SCRIPT=[['working',8],['waiting',5],['done',4]];
function setDemo(on){
  S.demo=on;
  $('#demo-badge').classList.toggle('hidden',!on);
  $('#btn-demo').classList.toggle('on',on);
  $('#btn-demo').innerHTML=on?'⏹️ <span class="lbl">Stop</span>':'▶️ <span class="lbl">Demo</span>';
  if(on&&!S.demoChars.length){
    const zn=S.zones.lobby, spots=[[-3,1],[0,2.5],[3,1]];
    const names=['Contoh-1','Contoh-2','Contoh-3'];
    const cols=['#4f8ff7','#f76fa0','#34b37a'];
    spots.forEach((s,i)=>{
      const ch=makeChibi({shirt:cols[i]});
      ch.g.position.set(zn.rect.x+s[0],zn.top,zn.rect.z+s[1]); ch.baseY=zn.top;
      ch.yaw=Math.PI; ch.g.rotation.y=Math.PI;
      ch.isDemo=true; ch.label=names[i]; ch.script=0; ch.scriptT=0;
      ch.status='working'; S.demoChars.push(ch);
    });
    toast('Mode demo: 3 karakter contoh mensimulasikan working → waiting → done');
  }
  if(!on){ for(const ch of S.demoChars) scene.remove(ch.g); S.demoChars=[]; }
}
function tickDemo(dt){
  for(const ch of S.demoChars){
    ch.scriptT+=dt;
    const [st,dur]=DEMO_SCRIPT[ch.script];
    ch.status=st;
    if(ch.scriptT>=dur){ ch.script=(ch.script+1)%DEMO_SCRIPT.length; ch.scriptT=0; }
  }
}

// ==================== BAGIAN D: label, HUD, loop ====================
const labelLayer=$('#labels');
const labelEls=new Map(); // key -> div
function getLabel(key, cls){
  let el=labelEls.get(key);
  if(!el){ el=document.createElement('div'); el.className='alabel '+(cls||''); labelLayer.appendChild(el); labelEls.set(key,el); }
  return el;
}
const _v=new THREE.Vector3();
function toScreen(x,y,z){
  _v.set(x,y,z).project(camera);
  if(_v.z>1) return null;
  return {x:(_v.x*0.5+0.5)*innerWidth, y:(-_v.y*0.5+0.5)*innerHeight};
}
function overlaps(a,b){ return a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h; }

function updateLabels(){
  const fresh=freshLive(), items=[], seen=new Set();
  const add=(key,x,y,z,html,prio,cls,onclick)=>{
    const p=toScreen(x,y,z); if(!p) return;
    const el=getLabel(key,cls); el.innerHTML=html; el.style.display='block';
    el.onclick=onclick||null; el.style.cursor=onclick?'pointer':'default';
    items.push({key,el,x:p.x,y:p.y,prio}); seen.add(key);
  };
  const farZoom = zoom<0.75;
  // 1. karakter live (prioritas tertinggi)
  if(!farZoom) for(const [id,ch] of Object.entries(S.liveChars)){
    const a=S.byId[id], nm=a?a.name:(id==='noir'?'Noir':id==='bos'?'Bos':id);
    const e=fresh[id]||{status:ch.status,detail:ch.detail};
    const gp=ch.g.position;
    add('live:'+id, gp.x, gp.y+2.15, gp.z,
      `<span class="st" style="background:${STATUS_COLOR[e.status]||'#999'}"></span>${nm}`,
      0,'',{});
    const el=labelEls.get('live:'+id);
    el.onclick=()=>showCard(id, gp.x, gp.y+2.15, gp.z);
  }
  // 2. karakter spesial (Noir & Bos) — selalu berlabel, mereka "koneksi live"
  if(!farZoom) for(const ch of (S.specialChars||[])){
    const gp=ch.g.position;
    add('sp:'+ch.isSpecial, gp.x, gp.y+2.15, gp.z,
      `<span class="st" style="background:#ffd54f"></span>${ch.label}`, 1,'');
  }
  // 3. demo chars
  for(const ch of S.demoChars){
    const gp=ch.g.position;
    add('demo:'+ch.label, gp.x, gp.y+2.15, gp.z,
      `<span class="st" style="background:${STATUS_COLOR[ch.status]}"></span>${ch.label} <b>DEMO</b>`, 0,'demo-tag');
  }
  // 4. label ruangan (mengalah pada label agent)
  for(const d of S.divisions){
    const zn=S.zones[d.id]; if(!zn) continue;
    add('room:'+d.id, zn.rect.x, zn.top+3.4, zn.rect.z,
      `${d.name}`, 2,'room',()=>focusOn(zn.rect.x,zn.rect.z));
  }
  // 5. hover ambient
  if(S.hovered&&!farZoom){
    const a=S.byId[S.hovered];
    if(a){ const zn=S.zones[a.division];
      add('hov:'+a.id, a.desk.x, zn.top+2.15, a.desk.z,
        `${a.name}`, 1,'',()=>showCard(a.id,a.desk.x,zn.top+2.15,a.desk.z));
    }
  }
  // ukur & collision
  for(const it of items){ it.w=it.el.offsetWidth; it.h=it.el.offsetHeight; }
  items.sort((a,b)=>a.prio-b.prio||a.y-b.y);
  const placed=[];
  for(const it of items){
    let box={x:it.x-it.w/2,y:it.y-it.h,w:it.w,h:it.h}, ok=true;
    for(const off of [0,-18,-36,18]){
      box.y=it.y-it.h+off;
      if(!placed.some(p=>overlaps(box,p))){ ok=true; break; } ok=false;
    }
    if(!ok&&it.prio>0){ it.el.style.display='none'; continue; }
    if(!ok){ // live: paksa tampil, tumpuk ke atas
      let k=0; do{ box.y-=20; k++; }while(placed.some(p=>overlaps(box,p))&&k<8);
    }
    placed.push(box);
    it.el.style.left=box.x+'px'; it.el.style.top=box.y+'px';
  }
  for(const [k,el] of labelEls) if(!seen.has(k)) el.style.display='none';
}

// ---------- kartu info ----------
function showCard(id,x,y,z){
  const card=$('#agent-card'), a=S.byId[id], e=freshLive()[id];
  let html='';
  if(a) html=`<h4>${a.name}</h4><div class="div">${S.byId[id]?divName(a.division):''}</div>
    <div class="desc">${a.desc||''}</div>${a.vibe?`<div class="vibe">"${a.vibe}"</div>`:''}`;
  else if(id==='noir') html=`<h4>Noir</h4><div class="div">Koneksi live ke Muse</div>
    <div class="desc">Semua perintah "Perintah ke Noir" diteruskan ke Noir dan dikerjakan agent spesialis beneran.</div>`;
  else if(id==='bos') html=`<h4>Bos</h4><div class="div">Ruang Owner</div><div class="desc">Pemilik kantor. Kirim perintah lewat panel "Perintah ke Noir".</div>`;
  else if(String(id).startsWith('demo')) html=`<h4>${id}</h4><div class="div">Karakter contoh (DEMO)</div>`;
  if(e) html+=`<div class="detail"><b style="color:${STATUS_COLOR[e.status]}">● ${e.status}</b><br>${e.detail||''}</div>`;
  card.innerHTML=html+`<button class="x" onclick="this.parentElement.classList.add('hidden')">✕</button>`;
  card.classList.remove('hidden');
  const p=toScreen(x,y,z);
  if(p){ card.style.left=Math.max(120,Math.min(innerWidth-120,p.x))+'px';
        card.style.top=Math.max(140,p.y-40)+'px'; }
}
function divName(id){ const d=S.divisions.find(d=>d.id===id); return d?d.name:id; }

// ---------- HUD: jam ----------
setInterval(()=>{ $('#clock').textContent=
  new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())+' WIB';
},1000);

// ---------- notifikasi ----------
let lastSeen=Date.now(), unread=0;
$('#btn-bell').onclick=()=>{
  const d=$('#bell-drop'), willOpen=d.classList.contains('hidden');
  d.classList.toggle('hidden');
  if(willOpen && innerWidth<=760){ // di HP: tempel ke viewport, di bawah HUD — anti kepotong
    const r=$('#hud-top').getBoundingClientRect();
    d.style.top=(r.bottom+8)+'px';
  }
  if(!d.classList.contains('hidden')){ lastSeen=Date.now(); unread=0; renderBell(); }
};
function renderBell(){
  const items=S.activity.slice(-12).reverse();
  $('#bell-drop').innerHTML=items.length?items.map(a=>
    `<div class="nitem">${a.text}<span class="ts">${wib(a.ts)}</span></div>`).join('')
    :'<div class="nitem">Belum ada aktivitas.</div>';
  const bc=$('#bell-count'); bc.textContent=unread; bc.classList.toggle('hidden',unread===0);
}
function wib(iso){ try{ return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}).format(new Date(iso)); }catch(e){ return ''; } }

// ---------- direktori ----------
function buildDirectory(){
  const q=($('#dir-search').value||'').toLowerCase(), fresh=freshLive();
  const box=$('#dir-list'); box.innerHTML='';
  for(const d of S.divisions.filter(d=>d.kind==='division')){
    const agents=S.byDiv[d.id].filter(a=>!q||a.name.toLowerCase().includes(q)||d.name.toLowerCase().includes(q)||a.desc.toLowerCase().includes(q));
    if(!agents.length) continue;
    const dh=document.createElement('div'); dh.className='ddiv';
    dh.innerHTML=`<div class="ddiv-head"><span><span class="swatch" style="background:${d.color}"></span>${d.name}</span><span>${agents.length}</span></div>`;
    const list=document.createElement('div'); list.className='dagents'; list.style.display=q?'block':'none';
    dh.querySelector('.ddiv-head').onclick=()=>{ list.style.display=list.style.display==='none'?'block':'none'; };
    for(const a of agents.slice(0,60)){
      const st=fresh[a.id]?fresh[a.id].status:null;
      const row=document.createElement('div'); row.className='dagent';
      row.innerHTML=`<span class="st" style="background:${st?STATUS_COLOR[st]:'#cfc6b4'}"></span><span>${a.name}</span>`;
      row.title=a.desc||'';
      row.onclick=()=>{ const zn=S.zones[a.division]; focusOn(a.desk.x,a.desk.z); showCard(a.id,a.desk.x,zn.top+2.15,a.desk.z); };
      list.appendChild(row);
    }
    if(agents.length>60){ const m=document.createElement('div'); m.className='dagent';
      m.innerHTML=`<small>…+${agents.length-60} lainnya (persempit pencarian)</small>`; list.appendChild(m); }
    dh.appendChild(list); box.appendChild(dh);
  }
}
$('#dir-search').oninput=buildDirectory;
// (toggle drawer ditangani setDrawer di bagian mobile di bawah)
$('#btn-demo').onclick=()=>setDemo(!S.demo);

// ---------- mobile: bottom-sheet panel + drawer backdrop ----------
const isMobile = ()=>innerWidth<=760;
function setPanelCollapsed(collapsed){
  $('#panel').classList.toggle('collapsed', collapsed);
  $('#fab-cmd').classList.toggle('show', collapsed && isMobile());
}
$('#panel-handle').onclick=()=>setPanelCollapsed(!$('#panel').classList.contains('collapsed'));
$('#panel-close').onclick=()=>setPanelCollapsed(true);
$('#fab-cmd').onclick=()=>setPanelCollapsed(false);
$('#btn-home').onclick=()=>{ S.camTarget.set(0,0,35); clampTarget(); setZoom(1); toast('Tampilan di-reset'); };
function setDrawer(open){
  $('#drawer').classList.toggle('hidden', !open);
  $('#btn-dir').classList.toggle('on', open);
  $('#drawer-backdrop').classList.toggle('hidden', !(open && isMobile()));
}
$('#btn-dir').onclick=()=>setDrawer($('#drawer').classList.contains('hidden'));
$('#drawer-close').onclick=()=>setDrawer(false);
$('#drawer-backdrop').onclick=()=>setDrawer(false);

// ---------- tabs & perintah ----------
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  ['cmd','queue','log'].forEach(k=>$('#tab-'+k).classList.toggle('hidden',k!==t.dataset.tab));
});
$('#cmd-send').onclick=async()=>{
  const ta=$('#cmd-text'), text=ta.value.trim();
  if(!text) return;
  const btn=$('#cmd-send'); btn.disabled=true;
  $('#cmd-status').textContent='Mengirim...';
  try{ await API.post('api/commands',{text});
    ta.value=''; $('#cmd-status').textContent='Terkirim! Dispatcher akan menugaskan agent spesialis.';
    toast('Perintah terkirim — agent segera ditugaskan');
    await pollLive();
  }catch(e){ $('#cmd-status').textContent='Gagal: '+e.message; }
  btn.disabled=false;
};
function renderQueue(){
  const box=$('#queue-list');
  $('#queue-count').textContent=S.queue.filter(c=>c.status!=='selesai').length||'';
  box.innerHTML=S.queue.length?S.queue.map(c=>
    `<div class="qitem"><div class="qt">${c.text}</div>
     <div class="meta"><span class="chip ${c.status}">${c.status}</span>
     ${c.agent_name?`<span>👤 ${c.agent_name}</span>`:''}<span>${wib(c.created_at)}</span></div>
     ${c.ringkasan?`<div class="ringkasan">✅ ${c.ringkasan}</div>`:''}</div>`).join('')
    :'<p class="hint">Belum ada perintah. Kirim satu lewat tab Perintah.</p>';
}
function renderLog(){
  $('#log-list').innerHTML=S.activity.slice().reverse().map(a=>
    `<div class="litem">${a.text}<span class="ts">${wib(a.ts)}</span></div>`).join('')||'<p class="hint">Kosong.</p>';
}
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.add('hidden'),3200); }

// ---------- polling live ----------
async function pollLive(){
  try{
    const j=await API.get('api/live');
    S.live=j.live||{}; S.queue=j.queue||[]; S.activity=j.activity||[];
    S.serverOk=true;
    const freshCount=Object.keys(freshLive()).length;
    const newActs=S.activity.filter(a=>new Date(a.ts).getTime()>lastSeen);
    if(newActs.length&&$('#bell-drop').classList.contains('hidden')){ unread+=newActs.length; lastSeen=Date.now(); }
    renderBell(); renderQueue(); renderLog();
    if($('#dir-search').value!==undefined&&!$('#drawer').classList.contains('hidden')) buildDirectory();
    syncLive();
  }catch(e){ S.serverOk=false; syncLive(); }
}

// ---------- picking ----------
const ray=new THREE.Raycaster(), mouse=new THREE.Vector2();
let hoverT=0;
canvas.addEventListener('pointermove',e=>{
  const now=performance.now(); if(now-hoverT<140) return; hoverT=now;
  mouse.set(e.clientX/innerWidth*2-1, -(e.clientY/innerHeight)*2+1);
  ray.setFromCamera(mouse,camera);
  const targets=[...Object.values(S.liveChars).map(c=>c.g),
    ...(S.specialChars||[]).map(c=>c.g), ...S.demoChars.map(c=>c.g)];
  let hov=null;
  if(ray.intersectObjects(targets,true).length){
    // cari root chibi — skip, hover crowd saja via instance
  }
  if(crowd){
    const hit=ray.intersectObject(crowd.body)[0];
    if(hit&&hit.instanceId!==undefined&&!crowd.hidden.has(hit.instanceId))
      hov=S.agents[hit.instanceId].id;
  }
  S.hovered=hov; canvas.style.cursor=hov?'pointer':'default';
});
canvas.addEventListener('click',e=>{
  if(S._dragged) return;
  mouse.set(e.clientX/innerWidth*2-1, -(e.clientY/innerHeight)*2+1);
  ray.setFromCamera(mouse,camera);
  for(const [id,ch] of Object.entries(S.liveChars)){
    if(ray.intersectObject(ch.g,true).length){ const p=ch.g.position; showCard(id,p.x,p.y+2.15,p.z); return; }
  }
  for(const ch of (S.specialChars||[]))
    if(ray.intersectObject(ch.g,true).length){ const p=ch.g.position; showCard(ch.isSpecial,p.x,p.y+2.15,p.z); return; }
  if(crowd){ const hit=ray.intersectObject(crowd.body)[0];
    if(hit&&hit.instanceId!==undefined&&!crowd.hidden.has(hit.instanceId)){
      const a=S.agents[hit.instanceId], zn=S.zones[a.division];
      showCard(a.id,a.desk.x,zn.top+2.15,a.desk.z); return; } }
  $('#agent-card').classList.add('hidden');
});

// ---------- main loop ----------
const clockT=new THREE.Clock();
function loop(){
  requestAnimationFrame(loop);
  const dt=Math.min(clockT.getDelta(),0.05), t=clockT.elapsedTime;
  for(const ch of Object.values(S.liveChars)) animChibi(ch,dt);
  for(const ch of (S.specialChars||[])) animChibi(ch,dt);
  tickDemo(dt);
  for(const ch of S.demoChars) animChibi(ch,dt);
  updateCrowd(dt,t);
  if(S.water) S.water.position.y+=Math.sin(t*1.8)*0.0009;
  updateLabels();
  renderer.render(scene,camera);
}
function onResize(){
  FRUSTUM = baseFrustum();
  aspect=innerWidth/innerHeight;
  if(innerWidth>760){ // kembali ke desktop: pastikan panel & drawer normal
    $('#panel').classList.remove('collapsed');
    $('#fab-cmd').classList.remove('show');
    $('#drawer-backdrop').classList.add('hidden');
  }
  camera.left=-FRUSTUM*aspect/2; camera.right=FRUSTUM*aspect/2;
  camera.top=FRUSTUM/2; camera.bottom=-FRUSTUM/2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
}
addEventListener('resize',onResize); onResize();

// ---------- init ----------
(async function init(){
  try{
    S.divisions=await API.get('api/divisions');
    S.agents=await API.get('api/agents');
  }catch(e){ toast('Gagal memuat data: '+e.message); return; }
  S.byId={}; S.byDiv={};
  for(const a of S.agents){ S.byId[a.id]=a; (S.byDiv[a.division]=S.byDiv[a.division]||[]).push(a); }
  buildZones(); buildFurniture(); buildCrowd(); initSpecials(); buildDirectory();
  await pollLive(); setInterval(pollLive,3000);
  loop();
  if(innerWidth<=760) setPanelCollapsed(true); // HP: panel mulai terlipat, buka via tombol 💬
  toast('Kantor AI v3 siap — 267 agent dalam 23 zona');
})();
