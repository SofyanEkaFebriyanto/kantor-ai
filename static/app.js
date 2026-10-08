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

// ==================== BAGIAN A2: REDESIGN DENAH TOTAL (Level Designer) ====================
// Denah "kampus organik": 4 distrik (Tech Campus / Creative Quarter / Ops Row / Social Wing),
// 3 boulevard pejalan kaki (z=15, 37, 56), 1 plaza courtyard dengan fountain sebagai focal point.
// Rect dari API TIDAK diubah di server — di-override client-side di sini, lalu posisi
// meja setiap agent di-remap proporsional ke ruangan barunya. API & fungsi inti tak tersentuh.
const LAYOUT = {
  // --- Tech Campus (utara) ---
  'engineering':       {x:-52, z:3,  w:44, d:18},
  'specialized':       {x:-14, z:3,  w:30, d:18},
  'spatial-computing': {x:18,  z:2,  w:26, d:16},
  'gis':               {x:52,  z:4,  w:28, d:16},
  // --- Creative Quarter (tengah-utara) ---
  'design':            {x:-62, z:27, w:26, d:15},
  'marketing':         {x:-34, z:27, w:22, d:15},
  'product':           {x:-8,  z:27, w:20, d:15},
  'project-management':{x:16,  z:27, w:20, d:15},
  'game-development':  {x:38,  z:27, w:16, d:15},
  'academic':          {x:58,  z:27, w:18, d:15},
  'research':          {x:76,  z:27, w:16, d:15},
  // --- Ops Row (tengah-selatan; celah di tengah = plaza courtyard) ---
  'finance':           {x:-64, z:47, w:22, d:13},
  'sales':             {x:-40, z:47, w:22, d:13},
  'paid-media':        {x:-20, z:47, w:16, d:13},
  'support':           {x:16,  z:47, w:20, d:13},
  'security':          {x:36,  z:47, w:18, d:13},
  'testing':           {x:58,  z:47, w:18, d:13},
  'healthcare':        {x:77,  z:47, w:14, d:13},
  // --- Social Wing (selatan) ---
  'lobby':             {x:-8,  z:72, w:34, d:16},
  'owner':             {x:-42, z:72, w:18, d:12},
  'musholla':         {x:24,  z:72, w:14, d:12},
  'pool':              {x:46,  z:72, w:20, d:14},
  'cafe':              {x:70,  z:72, w:24, d:14, baseY:3}, // rooftop cafe: dek elevated
  // --- Ruang Rapat (client-side; dekat Ruang Owner, bukan bagian divisions.json) ---
  'meeting':           {x:-62, z:72, w:16, d:12},
};
// boulevard pejalan kaki (koridor sirkulasi utama)
const WALKS = [15, 37, 56];
// label distrik untuk zonasi yang terbaca
const DISTRICTS = [
  {name:'TECH CAMPUS',     x:-18, z:3,  y:9},
  {name:'CREATIVE QUARTER',x:2,   z:27, y:8.5},
  {name:'OPS ROW',         x:-30, z:47, y:8},
  {name:'SOCIAL WING',     x:14,  z:72, y:10},
];
// obrolan kantin: singkat, natural, kasual
const CHATTER = [
  'eh, deploy tadi lolos QA nggak?',
  'kopi di rooftop juara sih',
  'nanti standup jam 3 ya',
  'PR-ku udah di-review belum?',
  'habis ini makan di mana?',
  'bug kemarin ternyata typo doang',
  'desain barunya udah di-approve?',
  'sore ini jadi futsal kan?',
  'nanti pulang bareng yuk',
  'brief besok siapa yang pegang?',
  'eh lihat dashboard barunya belum?',
  'kopi pahitnya nendang banget',
];

function applyNewLayout(){
  const byDiv = {}; for(const d of S.divisions) byDiv[d.id]=d;
  const orig = {}; for(const d of S.divisions) orig[d.id]={...d.rect};
  for(const [id,L] of Object.entries(LAYOUT)){
    const d=byDiv[id]; if(!d) continue;
    d.rect={x:L.x, z:L.z, w:L.w, d:L.d};
    if(L.baseY!==undefined) d.baseY=L.baseY;
  }
  // remap meja: posisi relatif di ruangan lama -> ruangan baru
  for(const a of S.agents){
    const o=orig[a.division], d=byDiv[a.division]; if(!o||!d) continue;
    const n=d.rect;
    const fx=Math.min(0.92,Math.max(0.08,(a.desk.x-(o.x-o.w/2))/o.w));
    const fz=Math.min(0.92,Math.max(0.08,(a.desk.z-(o.z-o.d/2))/o.d));
    a.desk={x:n.x-n.w/2+fx*n.w, y:0, z:n.z-n.d/2+fz*n.d};
  }
}
function nearestWalk(z){
  let b=WALKS[0],bd=1e12;
  for(const w of WALKS){ const dd=Math.abs(z-w); if(dd<bd){bd=dd;b=w;} }
  return b;
}
// rute jalan kaki via boulevard: keluar ruangan -> susur koridor -> masuk tujuan
function routeTo(fx,fz,tx,tz){
  const w1=nearestWalk(fz), w2=nearestWalk(tz), path=[];
  if(Math.abs(fz-w1)>1.2) path.push({x:fx,z:w1});
  if(w1!==w2){ path.push({x:tx,z:w1}); path.push({x:tx,z:w2}); }
  else if(Math.abs(fx-tx)>1.2) path.push({x:tx,z:w1});
  path.push({x:tx,z:tz});
  return path;
}

// ---------- kehidupan sosial: spot nongkrong, grup ngobrol, bubble chat ----------
function initSocial(){
  S.social={spots:[],bubbles:[]};
  const Z=id=>S.zones[id]; if(!Z('cafe')) return;
  const add=(id,dx,dz,kind)=>{ const zn=Z(id); if(!zn) return;
    S.social.spots.push({x:zn.rect.x+dx, z:zn.rect.z+dz, top:zn.top,
      zone:id, kind, occupants:new Set()}); };
  add('cafe',-6,-2,'cafe'); add('cafe',2,-2,'cafe');   // meja rooftop cafe
  add('cafe',-2,3,'cafe');  add('cafe',6,3,'cafe');
  add('pool',-3,5.5,'pool'); add('pool',3,5.5,'pool'); // dek kolam
  add('lobby',3.5,3,'lobby'); add('lobby',-6,4,'lobby');// sofa lobi
  add('musholla',0,1,'musholla');                      // sudut tenang
  for(let i=0;i<6;i++){ const a=i/6*Math.PI*2;          // ring plaza fountain (focal point)
    S.social.spots.push({x:-3+Math.cos(a)*5, z:47+Math.sin(a)*4.4, top:0.25,
      zone:'plaza', kind:'plaza', occupants:new Set()}); }
  for(let i=0;i<6;i++){
    const el=document.createElement('div'); el.className='chat-bubble'; el.style.display='none';
    labelLayer.appendChild(el); S.social.bubbles.push({el,g:null,line:0,textT:0});
  }
}
function sendToSocial(it){
  const r=Math.random();
  let tx,tz,ttop,spot=null;
  if(r<0.24){
    // kunjungan antar divisi: mampir ke ruangan divisi lain
    const others=S.divisions.filter(d=>d.kind==='division'&&d.id!==(it.zn&&it.zn.id));
    const dd=others[(Math.random()*others.length)|0]; if(!dd) return;
    const zn=S.zones[dd.id];
    tx=zn.rect.x+(Math.random()-0.5)*zn.rect.w*0.55;
    tz=zn.rect.z+(Math.random()-0.5)*zn.rect.d*0.55;
    ttop=zn.top;
  } else {
    const spots=S.social.spots, weights={cafe:3,plaza:3,lobby:1.5,pool:1.5,musholla:0.7};
    let tot=0; for(const s of spots) tot+=weights[s.kind]||1;
    let pick=Math.random()*tot, sp=spots[0];
    for(const s of spots){ pick-=weights[s.kind]||1; if(pick<=0){ sp=s; break; } }
    spot=sp; tx=sp.x+(Math.random()-0.5)*1.6; tz=sp.z+(Math.random()-0.5)*1.6; ttop=sp.top;
  }
  let path;
  if(spot&&spot.kind==='cafe'){ // naik tangga ke dek rooftop
    const cz=S.zones.cafe.rect;
    path=routeTo(it.x,it.z, cz.x-cz.w/2-1.4, cz.z+cz.d/2+2.5);
    path.push({x:tx,z:tz,top:ttop});
  } else path=routeTo(it.x,it.z,tx,tz);
  it.path=path; it.ty=ttop; it.spot=spot; it.mode='toSocial';
  it.onArrive=()=>{ it.mode='hangout'; it.hangT=22+Math.random()*40; it.faceT=0;
    if(it.spot) it.spot.occupants.add(it); };
}
function sendHome(it){
  if(it.spot){ it.spot.occupants.delete(it); it.spot=null; }
  const hx=it.zn? it.zn.rect.x+(Math.random()-0.5)*it.zn.rect.w*0.4 : it.x;
  const hz=it.zn? it.zn.rect.z+(Math.random()-0.5)*it.zn.rect.d*0.4 : it.z;
  it.path=routeTo(it.x,it.z,hx,hz);
  it.ty=it.zn?it.zn.top:0.25; it.mode='toDesk';
  it.onArrive=()=>{ it.mode='desk'; pickTarget(it); };
}
function updateSocial(dt){
  const soc=S.social; if(!soc||!crowd) return;
  let n=0; for(const it of crowd.items) if(it.mode!=='desk') n++;
  for(let i=0;i<crowd.items.length;i++){
    const it=crowd.items[i];
    if(crowd.hidden.has(i)) continue; // karakter live: jangan diganggu
    if(it.mode==='desk'){
      it.nextSocial-=dt;
      if(it.nextSocial<=0){ it.nextSocial=25+Math.random()*55;
        if(n<42&&Math.random()<0.55){ sendToSocial(it); n++; } }
    } else if(it.mode==='hangout'){
      it.hangT-=dt;
      if(it.spot) it.y+=(it.spot.top-it.y)*Math.min(1,dt*2);
      it.faceT-=dt; // hadap lawan bicara — ngobrol beneran, bukan patroli
      if(it.faceT<=0&&it.spot&&it.spot.occupants.size>1){
        it.faceT=2+Math.random()*3;
        const others=[...it.spot.occupants].filter(o=>o!==it);
        const o=others[(Math.random()*others.length)|0];
        if(o) it.yaw=Math.atan2(o.x-it.x,o.z-it.z);
      }
      if(it.hangT<=0) sendHome(it);
    }
  }
  updateBubbles(dt);
}
function updateBubbles(dt){
  const soc=S.social;
  const groups=soc.spots.filter(s=>s.occupants.size>=2)
    .map(s=>({s,n:s.occupants.size})).sort((a,b)=>b.n-a.n).slice(0,soc.bubbles.length);
  soc.bubbles.forEach((b,i)=>{
    const g=groups[i];
    if(!g){ b.el.style.display='none'; b.g=null; return; }
    let x=0,z=0,top=0.25;
    for(const it of g.s.occupants){ x+=it.x; z+=it.z; top=Math.max(top,it.y||0.25); }
    x/=g.s.occupants.size; z/=g.s.occupants.size;
    b.textT-=dt;
    if(b.g!==g.s||b.textT<=0){ b.g=g.s; b.line=(b.line+1)%CHATTER.length; b.textT=4+Math.random()*3; }
    const p=toScreen(x,top+2.9,z);
    if(!p){ b.el.style.display='none'; return; }
    b.el.style.display='block'; b.el.textContent=CHATTER[b.line];
    b.el.style.left=p.x+'px'; b.el.style.top=p.y+'px';
  });
}

// style bubble chat + label distrik (di-inject agar tetap 1 file)
{
  const st=document.createElement('style'); st.textContent=
    '.chat-bubble{position:absolute;transform:translate(-50%,-115%);background:rgba(255,255,255,.95);'+
    'color:#333;font-size:11px;padding:5px 10px;border-radius:12px;pointer-events:none;white-space:nowrap;'+
    'box-shadow:0 2px 8px rgba(0,0,0,.25);z-index:5}'+
    '.chat-bubble:after{content:"";position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);'+
    'border:6px solid transparent;border-top-color:rgba(255,255,255,.95);border-bottom:0}'+
    '.alabel.district{font-size:10px;letter-spacing:2px;color:#ffe9c4;background:rgba(40,28,16,.55);'+
    'border:1px solid rgba(255,220,160,.35);border-radius:6px;padding:3px 10px}';
  document.head.appendChild(st);
}

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

function plant(x, y, z, s=1, tall=false){
  cyl(0.28*s, 0.34*s, 0.5*s, 0xa8572f, x, y+0.25*s, z, 12);
  if(tall){ // pohon: batang + tajuk tinggi
    cyl(0.09*s, 0.12*s, 1.4*s, 0x6e4a2f, x, y+1.1*s, z, 8);
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85*s, 1),
      new THREE.MeshStandardMaterial({color:0x3f6b32, roughness:0.9, flatShading:true}));
    f.position.set(x, y+2.2*s, z); f.castShadow=true; scene.add(f);
    return;
  }
  const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55*s, 1),
    new THREE.MeshStandardMaterial({color:0x4d7c3a, roughness:0.9, flatShading:true}));
  f.position.set(x, y+0.95*s, z); f.castShadow=true; scene.add(f);
}

// hash deterministik per string -> variasi dekor tiap zona stabil antar reload
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }

// bingkai karya seni di dinding
function artFrame(x,y,z,color,w=2.2,h=1.4){
  const g=new THREE.Group(); g.position.set(x,y,z);
  const fr=new THREE.Mesh(new THREE.BoxGeometry(w,h,0.08),
    new THREE.MeshStandardMaterial({color:0x4a3a2a,roughness:0.7}));
  fr.castShadow=true; g.add(fr);
  const cv=new THREE.Mesh(new THREE.BoxGeometry(w-0.24,h-0.24,0.1),
    new THREE.MeshStandardMaterial({color,roughness:0.9}));
  g.add(cv); scene.add(g);
}

// lampu lantai: tiang + kap + bohlam emissive (tanpa point light -> murah)
function floorLamp(x,y,z){
  cyl(0.09,0.12,2.2, 0x3a3a3a, x, y+1.1, z, 10);
  const shade=new THREE.Mesh(new THREE.ConeGeometry(0.42,0.5,14,1,true),
    new THREE.MeshStandardMaterial({color:0xf7ead2, roughness:0.9, side:THREE.DoubleSide}));
  shade.position.set(x, y+2.15, z); shade.castShadow=true; scene.add(shade);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(0.2,12,10),
    new THREE.MeshStandardMaterial({color:0xfff3d6, emissive:0xffd98a, emissiveIntensity:1.8}));
  bulb.position.set(x, y+2.05, z); scene.add(bulb);
}

// halaman kampus: 3 boulevard berpohon + plaza courtyard (focal point) + taman sudut
function buildOutdoors(){
  // deretan pohon & lampu di sepanjang boulevard (sisi hijau di selatan tiap koridor)
  for(const z of WALKS){
    for(let i=0;i<10;i++){
      const x=-76+i*(152/9);
      if(Math.abs(x+3)<10&&z===56) continue; // beri napas di depan plaza
      plant(x, 0, z-2.6, 0.8, i%3===0);
    }
    for(const x of [-60,-20,20,60]) floorLamp(x, 0, z+2.6);
  }
  // PLAZA COURTYARD — focal point: di celah Ops Row, dikelilingi ruangan
  const px=-3, pz=47;
  const ring=cyl(8.6,8.6,0.12, 0xb09a72, px, 0.06, pz, 36); ring.receiveShadow=true;
  const disc=cyl(7.6,7.9,0.2, 0xdccdaa, px, 0.1, pz, 36); disc.receiveShadow=true;
  // fountain
  cyl(2.6,2.9,0.9, 0xcfc0a0, px, 0.45, pz, 24);
  const wtr=cyl(2.3,2.3,0.25, 0x4fa8d8, px, 0.85, pz, 24);
  wtr.material=new THREE.MeshStandardMaterial({color:0x4fa8d8,roughness:0.2,transparent:true,opacity:0.9});
  S.fountain=wtr;
  cyl(0.35,0.5,1.7, 0xbfb090, px, 1.45, pz, 12);
  const orb=new THREE.Mesh(new THREE.SphereGeometry(0.45,14,12),
    new THREE.MeshStandardMaterial({color:0x9fd4f0,roughness:0.15,metalness:0.3}));
  orb.position.set(px,2.5,pz); orb.castShadow=true; scene.add(orb);
  for(let i=0;i<6;i++){ const a=i/6*Math.PI*2+0.26; // bangku keliling plaza
    box(1.7,0.35,0.6, 0x8a5f3a, px+Math.cos(a)*6.4, 0.18, pz+Math.sin(a)*5.6, -a); }
  plant(px-10, 0, pz-4, 1.5, true); plant(px+10, 0, pz+3, 1.3, true);
  const pgl=new THREE.PointLight(0xffd9a0, 40, 42, 2); pgl.position.set(px,6,pz); scene.add(pgl);
  // taman sudut diorama
  plant(-82,0,4,1.6,true); plant(82,0,74,1.7,true); plant(82,0,0,1.3,true); plant(-82,0,76,1.4,true);
  // pilar penyangga dek rooftop cafe (elevated)
  const cz={x:70,z:72,w:24,d:14};
  for(const [ox,oz] of [[-10,-5],[0,-5],[10,-5],[-10,5],[0,5],[10,5]])
    box(0.6,3,0.6, 0x8a6a45, cz.x+ox, 1.5, cz.z+oz);
  // lampu aksen ruang khusus (tanpa shadow — murah di forward renderer)
  const glow=(x,y,z,color,i,dist)=>{
    const L=new THREE.PointLight(color, i, dist, 2); L.position.set(x,y,z); scene.add(L);
  };
  glow(-8, 5, 72, 0xffd9a0, 30, 44);   // lobi atrium
  glow(46, 4, 72, 0x7fd4ff, 22, 36);   // kolam sejuk
  glow(70, 8, 72, 0xffc890, 30, 44);   // rooftop cafe hangat
  glow(-42, 4.5, 72, 0xffe2b0, 18, 30);// ruang owner
}

function buildZones(){
  for(const d of S.divisions){
    const {x, z, w, dd} = {x:d.rect.x, z:d.rect.z, w:d.rect.w, dd:d.rect.d};
    const baseY = d.baseY||0, top = baseY+0.25;
    S.zones[d.id] = {...d, top};
    const col = new THREE.Color(d.color);
    const rnd = hashStr(d.id), openPlan = d.kind!=='special' && rnd%3===0;
    // lantai zona: dua tone hangat bergantian agar tidak seragam
    const h = d.id==='cafe' ? 3 : 0.5;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd),
      new THREE.MeshStandardMaterial({color:(rnd%2)?0xefe6d4:0xe7dac0, roughness:0.95}));
    fl.position.set(x, baseY + h/2 - (d.id==='cafe'?0:0), z);
    if(d.id==='cafe') fl.position.y = baseY - h/2 + 0.25; // top slab di baseY+0.25
    fl.receiveShadow = true; scene.add(fl);
    // aksen warna divisi: garis tepi lantai
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w+0.3, 0.1, dd+0.3),
      new THREE.MeshStandardMaterial({color:col, roughness:0.8}));
    edge.position.set(x, top-0.12, z); scene.add(edge);
    // karpet tematik: pastel dari warna divisi, di tengah zona
    const carpet = box(w*0.62, 0.07, dd*0.55,
      col.clone().lerp(new THREE.Color(0xffffff), 0.62).getHex(), x, top+0.035, z);
    carpet.castShadow = false;
    // dinding cutaway: tinted ke warna divisi + tinggi bervariasi per zona
    const wh = 2.35 + (rnd%5)*0.12, wt = 0.35;
    const wallMat = new THREE.MeshStandardMaterial(
      {color:new THREE.Color(0xf5eedd).lerp(col, 0.10), roughness:0.95});
    const trimMat = new THREE.MeshStandardMaterial({color:col, roughness:0.7});
    if(openPlan){
      // open-plan: divider rendah di belakang + satu divider aksen miring di tengah
      const dv = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.22), wallMat);
      dv.position.set(x, top+0.55, z-dd/2+0.11); dv.castShadow=dv.receiveShadow=true; scene.add(dv);
      const tr2 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.26), trimMat);
      tr2.position.set(x, top+1.17, z-dd/2+0.11); scene.add(tr2);
      const dv2 = new THREE.Mesh(new THREE.BoxGeometry(w*0.45, 1.1, 0.22),
        new THREE.MeshStandardMaterial({color:col.clone().lerp(new THREE.Color(0xffffff),0.45), roughness:0.9}));
      dv2.position.set(x-w*0.12, top+0.55, z+dd*0.08);
      dv2.rotation.y = (rnd%2?1:-1)*0.35;
      dv2.castShadow=dv2.receiveShadow=true; scene.add(dv2);
    } else {
      // dinding cutaway: belakang (-z) & kiri (-x)
      const wb = new THREE.Mesh(new THREE.BoxGeometry(w, wh, wt), wallMat);
      wb.position.set(x, top+wh/2, z-dd/2+wt/2); wb.castShadow=wb.receiveShadow=true; scene.add(wb);
      const wl = new THREE.Mesh(new THREE.BoxGeometry(wt, wh, dd), wallMat);
      wl.position.set(x-w/2+wt/2, top+wh/2, z); wl.castShadow=wl.receiveShadow=true; scene.add(wl);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, wt+0.06), trimMat);
      trim.position.set(x, top+wh+0.09, z-dd/2+wt/2); scene.add(trim);
      // karya seni di dinding belakang (zona divisi lebar berdinding; ruang khusus punya dekor sendiri)
      if(w>12 && d.kind!=='special'){
        const nArt = w>24 ? 3 : 2;
        const pal = [0x4f8ff7, 0xf76fa0, 0xffb74d, 0x34b37a, 0x9b7ede];
        for(let i=0;i<nArt;i++)
          artFrame(x-w/2+w*(i+1)/(nArt+1), top+wh-0.95, z-dd/2+wt+0.07, pal[(rnd+i)%pal.length]);
      }
    }
    // lampu lantai di sudut (zona besar)
    if(w>16){
      floorLamp(x-w/2+1.7, top, z+dd/2-1.7);
      if(dd>12) floorLamp(x+w/2-1.7, top, z-dd/2+1.7);
    }
    // tanaman sudut, bentuk bervariasi
    plant(x-w/2+1.2, top, z+dd/2-1.2, 0.9, rnd%3===0);
    if(w>14) plant(x+w/2-1.2, top, z+dd/2-1.2, 0.7, rnd%4===0);
    if(d.kind==='special') buildSpecial(d, top);
  }
  buildOutdoors();
}

function buildSpecial(d, top){
  const {x, z, w, dd} = {x:d.rect.x, z:d.rect.z, w:d.rect.w, dd:d.rect.d};
  if(d.id==='lobby'){
    box(5.5,1.0,1.4, 0x9c6b43, x-2, top+0.5, z-2.5);                    // meja resepsionis
    box(5.5,0.12,1.5, 0xc9a06a, x-2, top+1.05, z-2.5);
    const rug = cyl(2.2,2.2,0.06, 0xb34a4a, x+2.5, top+0.03, z+1, 28); rug.receiveShadow=true;
    sofa(x+1.2, top, z+2.2, 0); sofa(x+4.2, top, z+0.2, Math.PI/2);
    plant(x+w/2-1.5, top, z-dd/2+1.5, 1.1);
    // galeri mini di dinding belakang lobi
    artFrame(x-4, top+1.7, z-dd/2+0.42, 0x4f8ff7);
    artFrame(x-1.4, top+1.7, z-dd/2+0.42, 0xf76fa0);
    artFrame(x+1.2, top+1.7, z-dd/2+0.42, 0x34b37a, 1.6, 1.1);
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
  // variasi warna meja & kursi per divisi -> tiap zona punya karakter sendiri
  const woodTints=[0xffffff,0xf5e8d4,0xe6d3b3,0xd8c2a0], _wht=new THREE.Color(0xffffff);
  S.agents.forEach((a,i)=>{
    const zc=new THREE.Color((S.zones[a.division]||{}).color||'#888888');
    tT.setColorAt(i, new THREE.Color(woodTints[hashStr(a.id)%4]));
    tB.setColorAt(i, new THREE.Color(woodTints[(hashStr(a.id)+1)%4]));
    tS.setColorAt(i, zc.clone().lerp(_wht, 0.55));
    tB2.setColorAt(i, zc.clone().lerp(_wht, 0.55));
  });
  [tT,tB,tS,tB2].forEach(im=>{ if(im.instanceColor) im.instanceColor.needsUpdate=true; });
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
    case 'meeting': // duduk di kursi rapat: paha ke depan, tegak, angguk sesekali
      L.x=-1.35; R.x=-1.35; L.z=0.06; R.z=-0.06;
      A.x=-0.55; B.x=-0.55; A.z=0.2; B.z=-0.2;
      p.head.rotation.x=0.14+0.08*Math.sin(t*1.4);
      p.head.rotation.y=0.28*Math.sin(t*0.45+1);
      ch.g.position.y=ch.baseY+Math.abs(Math.sin(t*1.4))*0.015; break;
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
              tx:0,tz:0,ty:zn.top,y:zn.top,speed:0.9+Math.random()*0.7,ph:Math.random()*9,
              zn, wait:Math.random()*4,
              mode:'desk', path:[], spot:null, onArrive:null, nextSocial:8+Math.random()*50};
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
  if(Math.random()<0.3){
    // spot menawan: sudut dekat lampu/tanaman, bukan tengah kerumunan meja
    it.tx=r.x+(Math.random()<0.5?-1:1)*(r.w/2-2.2);
    it.tz=r.z+(Math.random()<0.5?-1:1)*(r.d/2-2.2);
  } else {
    it.tx=r.x+(Math.random()-0.5)*(r.w-3); it.tz=r.z+(Math.random()-0.5)*(r.d-3);
  }
  it.ty=it.zn.top;
  it.wait=2+Math.random()*7;
}
function updateCrowd(dt,t){
  if(!crowd) return;
  const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),V=new THREE.Vector3(),
        SC=new THREE.Vector3(),E=new THREE.Euler(),HS=new THREE.Vector3(1,0.72,1),
        ZERO=new THREE.Matrix4().makeScale(0,0,0);
  crowd.items.forEach((it,i)=>{
    if(crowd.hidden.has(i)){ crowd.body.setMatrixAt(i,ZERO); crowd.head.setMatrixAt(i,ZERO); crowd.hair.setMatrixAt(i,ZERO); return; }
    let bob=0, yaw=it.yaw||0;
    if(it.path&&it.path.length){
      // mode sosial: jalan via waypoint koridor (bukan patroli acak)
      const wp=it.path[0], dx=wp.x-it.x, dz=wp.z-it.z, dist=Math.hypot(dx,dz);
      if(it.path.length===1) it.y+=((it.ty!==undefined?it.ty:it.y)-it.y)*Math.min(1,dt*2.5);
      if(dist<0.5){ it.path.shift();
        if(!it.path.length&&it.onArrive){ const f=it.onArrive; it.onArrive=null; f(); } }
      else{ const sp=it.speed*1.5;
        it.x+=dx/dist*sp*dt; it.z+=dz/dist*sp*dt;
        yaw=Math.atan2(dx,dz); bob=Math.abs(Math.sin(t*7+it.ph))*0.07; }
    } else if(it.mode==='hangout'){
      bob=Math.abs(Math.sin(t*2+it.ph))*0.02; // diam ngobrol
    } else {
      it.y += ((it.ty!==undefined?it.ty:it.y)-it.y)*Math.min(1,dt*2.5); // transisi level halus
      const dx=it.tx-it.x, dz=it.tz-it.z, dist=Math.hypot(dx,dz);
      if(dist>0.4){
        it.x+=dx/dist*it.speed*dt; it.z+=dz/dist*it.speed*dt;
        yaw=Math.atan2(dx,dz); bob=Math.abs(Math.sin(t*7+it.ph))*0.07;
      } else if((it.wait-=dt)<=0) pickTarget(it);
    }
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

// ==================== FITUR ORKESTRASI RAPAT (visual) ====================
// Rapat = SIMULASI visual yang digerakkan state server (GET /api/meeting).
// Kepala divisi (agent pertama tiap divisi terpilih) berjalan ke ruang rapat,
// duduk mengelilingi meja bundar dengan bubble diskusi, lalu bubar kembali.
// Kerja nyata tetap oleh worker subagent via dispatcher — tidak disentuh di sini.
const MEET_TALK=[
  'setuju, eksekusi dari sisi kami',
  'butuh data divisi lain dulu',
  'timeline-nya realistis?',
  'catat ya, action item-nya jelas',
  'kita support penuh',
  'nanti sync lagi habis ini',
  'oke, gas eksekusi!',
  'siapa PIC-nya?',
  'risiko-nya kita mitigasi bareng',
  'deal, jalan!',
];
function meetChair(x,y,z,yaw){
  const g=new THREE.Group(); g.position.set(x,y,z); g.rotation.y=yaw;
  const mat=new THREE.MeshStandardMaterial({color:0x7a5a8a,roughness:0.85});
  const seat=new THREE.Mesh(new THREE.BoxGeometry(0.72,0.12,0.72),mat);
  seat.position.y=0.45; seat.castShadow=true; g.add(seat);
  const back=new THREE.Mesh(new THREE.BoxGeometry(0.72,0.75,0.12),mat);
  back.position.set(0,0.85,-0.34); back.castShadow=true; g.add(back);
  for(const [sx,sz] of [[-0.3,-0.3],[0.3,-0.3],[-0.3,0.3],[0.3,0.3]]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.45,8),mat);
    leg.position.set(sx,0.22,sz); g.add(leg);
  }
  scene.add(g);
}
function buildMeeting(){
  const L=LAYOUT.meeting, top=0.25;
  S.zones.meeting={id:'meeting',name:'Ruang Rapat',kind:'special',
    rect:{x:L.x,z:L.z,w:L.w,d:L.d},top,color:'#d4af6e'};
  const fl=new THREE.Mesh(new THREE.BoxGeometry(L.w,0.5,L.d),
    new THREE.MeshStandardMaterial({color:0xe9dcc2,roughness:0.95}));
  fl.position.set(L.x,0,L.z); fl.receiveShadow=true; scene.add(fl);
  const edge=new THREE.Mesh(new THREE.BoxGeometry(L.w+0.3,0.1,L.d+0.3),
    new THREE.MeshStandardMaterial({color:0xd4af6e,roughness:0.8}));
  edge.position.set(L.x,top-0.12,L.z); scene.add(edge);
  const rug=cyl(4.6,4.6,0.06, 0xc9a06a, L.x, top+0.03, L.z, 32); rug.receiveShadow=true;
  const wallMat=new THREE.MeshStandardMaterial({color:0xf5eedd,roughness:0.95});
  const wb=new THREE.Mesh(new THREE.BoxGeometry(L.w,2.6,0.35),wallMat);
  wb.position.set(L.x,top+1.3,L.z-L.d/2+0.17); wb.castShadow=wb.receiveShadow=true; scene.add(wb);
  const wl=new THREE.Mesh(new THREE.BoxGeometry(0.35,2.6,L.d),wallMat);
  wl.position.set(L.x-L.w/2+0.17,top+1.3,L.z); wl.castShadow=wl.receiveShadow=true; scene.add(wl);
  const trim=new THREE.Mesh(new THREE.BoxGeometry(L.w,0.18,0.41),
    new THREE.MeshStandardMaterial({color:0xd4af6e,roughness:0.7}));
  trim.position.set(L.x,top+2.69,L.z-L.d/2+0.17); scene.add(trim);
  const board=box(5,2,0.1, 0xfafafa, L.x, top+1.6, L.z-L.d/2+0.45); board.castShadow=false;
  cyl(2.3,2.3,0.14, 0x9c6b43, L.x, 0.95, L.z, 28);   // meja bundar
  cyl(0.28,0.42,0.9, 0x6e4a2f, L.x, 0.48, L.z, 12); // kaki meja
  S.meetSeats=[];
  for(let i=0;i<8;i++){
    const a=i/8*Math.PI*2, cx=L.x+Math.cos(a)*3.7, cz=L.z+Math.sin(a)*3.7;
    const yaw=Math.atan2(L.x-cx,L.z-cz);
    meetChair(cx,top,cz,yaw);
    S.meetSeats.push({x:cx,z:cz,yaw});
  }
  plant(L.x+L.w/2-1.2, top, L.z+L.d/2-1.2, 0.9);
  floorLamp(L.x-L.w/2+1.7, top, L.z+L.d/2-1.7);
}
function initMeetBubbles(){
  S.meetChars={}; S.meetId=null; S.meetData=null; S.meetBubbleT=0; S.meetBubbles=[];
  for(let i=0;i<4;i++){
    const el=document.createElement('div'); el.className='chat-bubble'; el.style.display='none';
    labelLayer.appendChild(el); S.meetBubbles.push({el,x:0,y:0,z:0,t:0});
  }
}
// jalan via chain waypoint (chibi moveTo hanya 1 target)
function walkPath(ch,path,done){
  const step=()=>{
    if(!path.length){ ch.status='idle'; ch.moveTo=null; done&&done(); return; }
    const w=path.shift();
    ch.status='walk';
    ch.moveTo={x:w.x,z:w.z,speed:3.4,onDone:step};
  };
  step();
}
async function pollMeeting(){
  try{ const m=await API.get('api/meeting'); onMeetingState(m); }catch(e){}
}
function onMeetingState(m){
  const st=(m&&m.status)||'idle';
  if(st==='idle'){ if(S.meetId) cleanupMeeting(); return; }
  if(m.command_id===S.meetId){
    S.meetData=m;
    if(st==='dispersing'&&!S._dispersing){ S._dispersing=true; disperseMeeting(); }
    return;
  }
  startMeetingVisual(m,st);
}
function startMeetingVisual(m,st){
  if(st==='dispersing'){ return; } // telat join: lewati visual
  S.meetId=m.command_id; S.meetData=m; S._dispersing=false;
  S.meetChars={};
  const parts=m.participants||[], n=parts.length;
  parts.forEach((p,i)=>{
    const a=S.byId[p.agent_id];
    const ch=makeChibi({shirt:p.color||'#4f8ff7',skin:p.skin||'#f1c27d',hair:p.hair||'#232323'});
    let sx,sz,stop;
    if(a){ const zn=S.zones[a.division]; sx=a.desk.x; sz=a.desk.z; stop=zn.top;
      const idx=S.agents.indexOf(a); if(idx>=0&&crowd) crowd.hidden.add(idx);
    } else { const zn=S.zones.lobby; sx=zn.rect.x; sz=zn.rect.z; stop=zn.top; }
    ch.g.position.set(sx,stop,sz); ch.baseY=stop;
    ch.yaw=Math.PI; ch.g.rotation.y=Math.PI; ch.status='idle';
    const seat=S.meetSeats[n>1?Math.round(i*(S.meetSeats.length-1)/(n-1)):3];
    S.meetChars[p.agent_id]={ch,seat,agent:a||null,origTop:stop,seated:false};
  });
  if(st==='gathering'){
    const mz=S.zones.meeting; focusOn(mz.rect.x,mz.rect.z);
    toast('📋 Rapat koordinasi dimulai — kepala divisi menuju ruang rapat');
    for(const id of Object.keys(S.meetChars)) sendToSeat(S.meetChars[id]);
  } else { // in_progress: join tengah jalan -> langsung duduk
    for(const id of Object.keys(S.meetChars)){
      const e=S.meetChars[id], seatY=S.zones.meeting.top+0.51;
      e.ch.baseY=seatY; e.ch.g.position.set(e.seat.x,seatY,e.seat.z);
      e.ch.status='meeting'; e.ch.yaw=e.seat.yaw; e.ch.g.rotation.y=e.seat.yaw;
      e.seated=true;
    }
  }
}
function sendToSeat(e){
  const {ch,seat}=e;
  const path=routeTo(ch.g.position.x,ch.g.position.z,seat.x,seat.z);
  walkPath(ch,path,()=>{
    ch.baseY=S.zones.meeting.top+0.51; // tinggi dudukan kursi
    ch.g.position.set(seat.x,ch.baseY,seat.z);
    ch.status='meeting'; ch.yaw=seat.yaw; ch.g.rotation.y=seat.yaw;
    e.seated=true;
  });
}
function disperseMeeting(){
  toast('✅ Rapat selesai — ringkasan tercatat di activity log');
  for(const id of Object.keys(S.meetChars)){
    const e=S.meetChars[id];
    e.seated=false; e.ch.baseY=e.origTop;
    const home=e.agent
      ? {x:e.agent.desk.x+(Math.random()-0.5)*2, z:e.agent.desk.z+(Math.random()-0.5)*2}
      : {x:S.zones.lobby.rect.x, z:S.zones.lobby.rect.z};
    const path=routeTo(e.ch.g.position.x,e.ch.g.position.z,home.x,home.z);
    walkPath(e.ch,path,()=>removeMeetChar(id));
  }
}
function removeMeetChar(id){
  const e=S.meetChars[id]; if(!e) return;
  scene.remove(e.ch.g);
  if(e.agent&&crowd) crowd.hidden.delete(S.agents.indexOf(e.agent));
  delete S.meetChars[id];
}
function cleanupMeeting(){
  for(const id of Object.keys(S.meetChars||{})) removeMeetChar(id);
  S.meetId=null; S.meetData=null; S._dispersing=false;
}
function updateMeeting(dt){
  const active=S.meetId&&S.meetData&&S.meetData.status==='in_progress';
  if(!active){
    for(const b of (S.meetBubbles||[])){ b.el.style.display='none'; b.t=0; }
    S.meetBubbleT=1.5; return;
  }
  S.meetBubbleT-=dt;
  for(const b of S.meetBubbles){
    if(b.t>0){ b.t-=dt;
      if(b.t<=0) b.el.style.display='none';
      else { const p=toScreen(b.x,b.y,b.z);
        if(p){ b.el.style.left=p.x+'px'; b.el.style.top=p.y+'px'; } } }
  }
  if(S.meetBubbleT>0) return;
  S.meetBubbleT=3+Math.random()*2.5;
  const seated=Object.values(S.meetChars).filter(e=>e.seated);
  const free=S.meetBubbles.find(b=>b.t<=0);
  if(!seated.length||!free) return;
  const e=seated[(Math.random()*seated.length)|0], p=e.ch.g.position;
  const s=toScreen(p.x,p.y+2.9,p.z); if(!s) return;
  free.x=p.x; free.y=p.y+2.9; free.z=p.z; free.t=3.2;
  free.el.textContent=MEET_TALK[(Math.random()*MEET_TALK.length)|0];
  free.el.style.display='block'; free.el.style.left=s.x+'px'; free.el.style.top=s.y+'px';
}
// ================== /FITUR ORKESTRASI RAPAT ==================

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
  // 4b2. label ruang rapat (zona client-side, dekat Ruang Owner)
  if(S.zones.meeting){ const mz=S.zones.meeting;
    add('room:meeting', mz.rect.x, mz.top+3.4, mz.rect.z,
      'Ruang Rapat', 2,'room',()=>focusOn(mz.rect.x,mz.rect.z)); }
  // 4b. label distrik — zonasi terbaca tanpa minimap
  if(zoom>0.55) for(const ds of DISTRICTS){
    add('dist:'+ds.name, ds.x, ds.y, ds.z, ds.name, 3, 'district');
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
    `<div class="nitem">${truncText(a.text)}<span class="ts">${wib(a.ts)}</span></div>`).join('')
    :'<div class="nitem">Belum ada aktivitas.</div>';
  const bc=$('#bell-count'); bc.textContent=unread; bc.classList.toggle('hidden',unread===0);
}
// Teks panjang: tampil ringkas + "baca selengkapnya" yang bisa buka-tutup
const MORE_N=140;
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function truncText(t){
  t=String(t==null?'':t);
  if(t.length<=MORE_N) return esc(t);
  return `<span class="ltxt">${esc(t.slice(0,MORE_N))}…</span><span class="lfull hidden">${esc(t)}</span><button class="more" onclick="const b=this,f=b.previousElementSibling,p=f.previousElementSibling;f.classList.toggle('hidden');p.classList.toggle('hidden');b.textContent=b.textContent==='baca selengkapnya'?'tutup':'baca selengkapnya'">baca selengkapnya</button>`;
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
    `<div class="litem">${truncText(a.text)}<span class="ts">${wib(a.ts)}</span></div>`).join('')||'<p class="hint">Kosong.</p>';
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
    syncLive(); pollMeeting();
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
  for(const id of Object.keys(S.meetChars||{})) animChibi(S.meetChars[id].ch,dt);
  tickDemo(dt);
  for(const ch of S.demoChars) animChibi(ch,dt);
  updateSocial(dt);
  updateCrowd(dt,t);
  updateMeeting(dt);
  if(S.water) S.water.position.y+=Math.sin(t*1.8)*0.0009;
  if(S.fountain){ const fs=1+Math.sin(t*3)*0.035; S.fountain.scale.set(fs,1,fs); }
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
  applyNewLayout(); // redesign denah: override rect API -> tata kampus organik
  buildZones(); buildMeeting(); buildFurniture(); buildCrowd(); initSocial(); initSpecials(); buildDirectory();
  initMeetBubbles();
  await pollLive(); setInterval(pollLive,3000);
  loop();
  if(innerWidth<=760) setPanelCollapsed(true); // HP: panel mulai terlipat, buka via tombol 💬
  toast('Kantor AI v3 siap — 267 agent dalam 23 zona');
})();
