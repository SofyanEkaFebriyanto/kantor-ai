/* Kantor AI v3 — diorama 3D isometric.
   Three.js WebGL asli: karakter chibi prosedural, cutaway rooms, lighting/shadow.
   Live feed: GET /api/live -> {live:{agentId:{status,detail,updated_at}}, ...}
   Snapshot basi/kosong -> mode ambient (jelas dibedakan via badge + tanpa label). */
import * as THREE from 'three';

// Pelapor error fatal: tampilkan banner merah agar bug init langsung kelihatan
window.addEventListener('error',e=>showFatal('JS: '+(e.message||(e.error&&e.error.message)||e.error)));
function showFatal(msg){ try{ let b=document.getElementById('fatal'); if(!b){ b=document.createElement('div'); b.id='fatal'; b.style.cssText='position:fixed;top:8px;left:8px;right:8px;z-index:9999;background:#b71c1c;color:#fff;padding:10px 12px;border-radius:10px;font:12px/1.5 monospace;white-space:pre-wrap;max-height:40vh;overflow:auto'; document.body.prepend(b);} b.textContent='⚠️ '+msg; }catch(_){} }

const $ = s => document.querySelector(s);
const API = {
  async get(p){ const r = await fetch(p); if(!r.ok) throw new Error(r.status); return r.json(); },
  async post(p, b){ const r = await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    const j = await r.json(); if(!r.ok) throw new Error(j.error||r.status); return j; }
};
const STATUS_COLOR = {working:'#4caf50',reading:'#2196f3',running:'#ff9800',idle:'#9e9e9e',waiting:'#e91e63',done:'#8bc34a',sholat:'#9d4edd'};
const LIVE_TTL_MS = 120000;

// ==================== BAGIAN A2: REDESIGN DENAH TOTAL (Level Designer) ====================
// Denah "kampus organik": 4 distrik (Tech Campus / Creative Quarter / Ops Row / Social Wing),
// 3 boulevard pejalan kaki (z=15, 37, 56), 1 plaza courtyard dengan fountain sebagai focal point.
// Rect dari API TIDAK diubah di server — di-override client-side di sini, lalu posisi
// meja setiap agent di-remap proporsional ke ruangan barunya. API & fungsi inti tak tersentuh.
const LAYOUT = {
  // --- Northwest: Engineering cluster ---
  'engineering':           {x:-55, z:8, w:50, d:18},
  'specialized':        {x:-10, z:6, w:36, d:18},
  'spatial-computing':     {x:12, z:8, w:22, d:16},
  'gis':                   {x:42, z:6, w:26, d:16},
  'design':                {x:68, z:6, w:18, d:15},
  // --- Mid: Business/Creative (stagger) ---
  'marketing':             {x:-60, z:30, w:30, d:15},
  'product':            {x:-34, z:30, w:16, d:15},
  'project-management': {x:-14, z:32, w:20, d:15},
  'game-development':      {x:0, z:30, w:16, d:15},
  'academic':              {x:20, z:32, w:18, d:15},
  'research':              {x:40, z:30, w:16, d:15},
  'finance':               {x:60, z:32, w:22, d:13},
  // --- South-mid: Ops (stagger) ---
  'sales':                 {x:-62, z:48, w:22, d:13},
  'paid-media':            {x:-42, z:48, w:16, d:13},
  'support':               {x:-22, z:50, w:20, d:13},
  'security':              {x:0, z:48, w:18, d:13},
  'testing':               {x:20, z:50, w:18, d:13},
  'healthcare':            {x:40, z:48, w:14, d:13},
  // --- Social hub (tengah-selatan) ---
  'lobby':                 {x:-8, z:68, w:34, d:16},
  'owner':                 {x:-40, z:68, w:18, d:12},
  'musholla':              {x:18, z:68, w:14, d:12},
  'pool':                  {x:42, z:68, w:20, d:14},
  'cafe':                  {x:66, z:68, w:24, d:14, baseY:3},
  'meeting':               {x:-40, z:84, w:16, d:12},
}
// boulevard pejalan kaki (koridor sirkulasi utama)
const WALKS = [20, 40, 54];
// ==================== BAGIAN B2: REDESIGN VISUAL TOTAL (3D & Scene Developer) ====================
// (1) Pecah grid pabrik: tiap divisi punya GAYA LAYOUT furnitur sendiri.
//     rows=baris longgar bervariasi, pod=cluster 4 meja menghadap tengah,
//     L=dua lengan tegak lurus, arc=amfiteater menghadap titik fokus,
//     U=bentuk-U menghadap papan, studio=sudut meja miring ala studio desain.
// (2) Identitas warna KUAT: lantai gelap kaya + dinding tinted + pita aksen
//     tebal dari warna divisi — bukan trim tipis.
const ZONE_LAYOUT = {
  'engineering': 'pod',   'specialized': 'L',     'spatial-computing': 'pod',
  'gis': 'pod',           'design': 'studio',    'marketing': 'longtable',
  'product': 'arc',       'project-management': 'rows', 'game-development': 'pod',
  'academic': 'rows',     'research': 'rows',    'finance': 'U',
  'sales': 'rows',        'paid-media': 'L',     'support': 'U',
  'security': 'U',        'testing': 'pod',      'healthcare': 'rows',
};
// palet identitas per divisi: accent = warna divisi penuh, lantai = kaya & gelap,
// dinding = krem yang di-tint kuat ke warna divisi. Untuk zona spesial ada override.
const ZONE_STYLE_OVERRIDES = {
  'lobby':    {floor:0xcdb287, wall:0xe6d3ae, accent:0xc96f2e},
  'owner':    {floor:0x4a3a26, wall:0xd9c49a, accent:0xd4af6e},
  'musholla':{floor:0x2c4a3a, wall:0xbcd8c4, accent:0x7fb89a},
  'pool':     {floor:0xbfe0ea, wall:0xdceef4, accent:0x3f9fd8},
  'cafe':     {floor:0x8a5a33, wall:0xd9b384, accent:0xc96f2e},
  'meeting':  {floor:0xc9a06a, wall:0xe6d3ae, accent:0xd4af6e},
};
function zoneStyle(d){
  const ov = ZONE_STYLE_OVERRIDES[d.id];
  if(ov) return {floor:new THREE.Color(ov.floor), wall:new THREE.Color(ov.wall),
                 accent:new THREE.Color(ov.accent), layout:ZONE_LAYOUT[d.id]||'rows'};
  const c = new THREE.Color(d.color);
  return {
    accent: c,
    floor: c.clone().multiplyScalar(0.42),                    // lantai kaya & berani
    wall: new THREE.Color(0xf5eedd).lerp(c, 0.38),            // dinding tinted jelas
    layout: ZONE_LAYOUT[d.id]||'rows',
  };
}
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
    const spots=S.social.spots;
    // ritme harian: jam istirahat -> rooftop cafe ramai; berdatangan -> lobi/plaza
    const fz=S.rhythm?S.rhythm.fase:null;
    const weights=fz==='istirahat'?{cafe:8,plaza:2.5,lobby:1,pool:1,musholla:0.7}
      :fz==='berdatangan'?{cafe:1,plaza:4,lobby:5,pool:1,musholla:0.7}
      :{cafe:3,plaza:3,lobby:1.5,pool:1.5,musholla:0.7};
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
  if(S.sholatMode){ // fase sholat: semua ke musholla, bubble ngobrol dimatikan
    redirectCrowdToMusholla();
    return;
  }
  // ritme harian: weekend & malam -> aktivitas minimal
  const fz=S.rhythm?S.rhythm.fase:null, night=S.rhythm&&S.rhythm.ritme==='malam';
  const cap=fz==='weekend'?8:(night?6:42);
  const socP=fz==='weekend'?0.25:(night?0.15:0.55);
  let n=0; for(const it of crowd.items) if(it.mode!=='desk') n++;
  for(let i=0;i<crowd.items.length;i++){
    const it=crowd.items[i];
    if(crowd.hidden.has(i)) continue; // karakter live: jangan diganggu
    if(it.mode==='desk'){
      it.nextSocial-=dt;
      if(it.nextSocial<=0){ it.nextSocial=25+Math.random()*55;
        if(n<cap&&Math.random()<socP){ sendToSocial(it); n++; } }
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
  approvals: [],       // sistem approval Bos (Fase 2)
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
const hemi=new THREE.HemisphereLight(0xfff2dd, 0x5a4a38, 0.85); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe7c4, 1.9);
sun.position.set(70, 110, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); // ringan untuk HP
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
  // ============ (3) ISI DEAD SPACE: hamparan cokelat jangan melompong ============
  const slab=(px,pz,sw,sd,c=0xcfc4ae)=>{ const m=box(sw,0.07,sd,c,px,0.035,pz); m.castShadow=false; return m; };
  // jalan setapak BARAT (sisi kiri yang kosong): lempengan batu zig-zag
  for(let i=0;i<32;i++){ const pz=-12+i*2.9;
    slab(-82+(i%2?0.55:-0.55), pz, 2.3, 2.5, i%2?0xcfc4ae:0xc4b89e); }
  // taman linear UTARA di belakang Tech Campus: pohon + bangku
  for(let x=-70;x<=70;x+=14){
    plant(x,0,-14.5,1.15,(x/14)%2===0);
    if((x/14)%2!==0){ box(1.8,0.12,0.5, 0x8a5f3a, x+7, 0.45, -13); // bangku
      box(0.12,0.45,0.45, 0x6e4a2f, x+6.2, 0.22, -13); box(0.12,0.45,0.45, 0x6e4a2f, x+7.8, 0.22, -13); }
    slab(x, -11.5, 2.0, 1.6);
  }
  // taman saku barat: bed bunga + pagar heji + gazebo
  const garden=(gx,gz,withGazebo)=>{
    const bed=cyl(3.2,3.4,0.35, 0x4d7c3a, gx, 0.17, gz, 20); bed.receiveShadow=true;
    cyl(2.5,2.6,0.42, 0x5a8a42, gx, 0.2, gz, 20);
    const fl=[0xf76fa0,0xffd54f,0xff6f61,0xffffff,0xba68c8];
    for(let i=0;i<10;i++){ const a=i/10*Math.PI*2, fr=1.1+(i%3)*0.55;
      const f=new THREE.Mesh(new THREE.IcosahedronGeometry(0.22,0),
        new THREE.MeshStandardMaterial({color:fl[i%5], roughness:0.8}));
      f.position.set(gx+Math.cos(a)*fr, 0.62, gz+Math.sin(a)*fr); f.castShadow=true; scene.add(f);
      cyl(0.04,0.04,0.35, 0x3f6b32, gx+Math.cos(a)*fr, 0.3, gz+Math.sin(a)*fr, 6);
    }
    for(let i=0;i<8;i++){ const a=i/8*Math.PI*2+0.4; // heji keliling
      box(1.9,0.7,0.5, 0x3f6b32, gx+Math.cos(a)*4.1, 0.35, gz+Math.sin(a)*4.1, -a); }
    if(withGazebo){
      for(const [ox,oz] of [[-1.6,-1.6],[1.6,-1.6],[-1.6,1.6],[1.6,1.6]])
        cyl(0.12,0.12,2.4, 0x6e4a2f, gx+ox, 1.2, gz+oz, 8);
      const roof=new THREE.Mesh(new THREE.ConeGeometry(2.9,1.3,4),
        new THREE.MeshStandardMaterial({color:0x9c5f33, roughness:0.85, flatShading:true}));
      roof.position.set(gx, 3.0, gz); roof.rotation.y=Math.PI/4; roof.castShadow=true; scene.add(roof);
      cyl(1.1,1.1,0.35, 0x8a5f3a, gx, 0.35, gz, 14); // meja gazebo
    }
  };
  garden(-81, 30, true);
  garden(-81, 64, false);
  // kolam kecil barat + jembatan (di sisi luar setapak)
  const pond=cyl(2.6,2.8,0.3, 0x4fa8d8, -84.8, 0.12, 47, 22);
  pond.material=new THREE.MeshStandardMaterial({color:0x4fa8d8, roughness:0.25, transparent:true, opacity:0.9});
  for(let i=0;i<9;i++){ const a=i/9*Math.PI*2;
    const st=new THREE.Mesh(new THREE.DodecahedronGeometry(0.32,0),
      new THREE.MeshStandardMaterial({color:0x9a938a, roughness:0.95}));
    st.position.set(-84.8+Math.cos(a)*3.0, 0.2, 47+Math.sin(a)*3.0); st.castShadow=true; scene.add(st); }
  box(3.6,0.25,1.2, 0x9c6b43, -84.8, 0.45, 47); // jembatan kayu mini
  plant(-80.5,0,43.5,0.9); plant(-87.5,0,50.5,1.0,true);
  // promenade SELATAN di depan Social Wing: setapak + lampu
  for(let x=-78;x<=78;x+=6) slab(x, 84, 4.6, 2.2, (x/6)%2?0xcfc4ae:0xc9bfa8);
  for(const x of [-60,-30,0,30,60]){ floorLamp(x, 0, 86.2); plant(x+4,0,86.2,0.85); }
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
    const zs = zoneStyle(d); // identitas warna KUAT per divisi (bukan trim tipis)
    const col = zs.accent;
    const rnd = hashStr(d.id), openPlan = d.kind!=='special' && rnd%3===0;
    // lantai zona: warna kaya dari identitas divisi
    const h = d.id==='cafe' ? 3 : 0.5;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd),
      new THREE.MeshStandardMaterial({color:zs.floor, roughness:0.95}));
    fl.position.set(x, baseY + h/2, z);
    if(d.id==='cafe') fl.position.y = baseY - h/2 + 0.25; // top slab di baseY+0.25
    fl.receiveShadow = true; scene.add(fl);
    // PITA AKSEN TEBAL mengelilingi lantai — identitas zona terbaca dari jauh
    const band = new THREE.Mesh(new THREE.BoxGeometry(w+0.7, 0.3, dd+0.7),
      new THREE.MeshStandardMaterial({color:col, roughness:0.7}));
    band.position.set(x, top-0.08, z); band.receiveShadow=true; scene.add(band);
    // karpet tematik: pastel dari warna divisi, di tengah zona
    const carpet = box(w*0.62, 0.07, dd*0.55,
      col.clone().lerp(new THREE.Color(0xffffff), 0.55).getHex(), x, top+0.06, z);
    carpet.castShadow = false;
    // dinding cutaway: tinted KUAT ke warna divisi + tinggi bervariasi per zona
    const wh = 2.35 + (rnd%5)*0.12, wt = 0.35;
    const wallMat = new THREE.MeshStandardMaterial({color:zs.wall, roughness:0.95});
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
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, wt+0.1), trimMat);
      trim.position.set(x, top+wh+0.16, z-dd/2+wt/2); scene.add(trim);
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
    else buildProps(d, top); // properti tematik khas tiap divisi
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
    // --- isi zona melompong: perpustakaan mini + globe + lampu baca ---
    const bx=x+w/2-1.1;
    for(let i=0;i<4;i++) box(0.7,0.09,2.6, 0x9c6b43, bx, top+0.7+i*0.7, z); // rak buku dinding
    for(let sI=0;sI<4;sI++) for(let bI=0;bI<5;bI++)
      box(0.4,0.5,0.32, [0x7a4a2e,0x4a6b8a,0x8a2e3a,0x3a6b4a,0x5a4a7a][(sI*5+bI)%5],
        bx, top+1.0+sI*0.7, z-1+bI*0.5);
    cyl(0.08,0.08,0.8, 0x6e4a2f, x+2.8, top+0.4, z+2.6, 8);
    const globe2=new THREE.Mesh(new THREE.SphereGeometry(0.45,16,12),
      new THREE.MeshStandardMaterial({color:0x3f8fd0, roughness:0.5}));
    globe2.position.set(x+2.8, top+1.15, z+2.6); globe2.castShadow=true; scene.add(globe2);
    box(0.9,0.5,0.9, 0x6e4a2f, x-2.8, top+0.25, z+2.6);                // meja samping
    cyl(0.28,0.28,0.5, 0xd4af6e, x-2.8, top+0.75, z+2.6, 12);          // vas
    floorLamp(x-w/2+1.4, top, z+dd/2-1.4);
    artFrame(x, top+1.8, z-dd/2+0.42, 0xd4af6e, 3.0, 1.8);             // lukisan besar
  }
  if(d.id==='musholla'){
    for(let r=0;r<3;r++) for(let c=0;c<4;c++)                          // saf salat 3x4
      box(1.1,0.07,1.7, r%2? 0x7a9b7a:0x9b8a7a, x-2.7+c*1.8, top+0.035, z-2.2+r*2.1);
    box(0.15,1.6,dd-2, 0xd8cba8, x+w/2-1, top+0.8, z);                 // partisi
    box(1.6,0.9,0.5, 0x9c6b43, x-w/2+1.2, top+0.45, z-dd/2+1);         // rak mukena
    // mihrab: ceruk + lengkung di dinding kiblat
    box(2.2,2.2,0.25, 0xc9b98a, x, top+1.1, z-dd/2+0.3);
    const arch=new THREE.Mesh(new THREE.TorusGeometry(0.8,0.14,10,20,Math.PI),
      new THREE.MeshStandardMaterial({color:0x7fb89a, roughness:0.7}));
    arch.position.set(x, top+1.5, z-dd/2+0.45); scene.add(arch);
    box(1.8,0.5,0.4, 0x8a5f3a, x-w/2+1.2, top+0.25, z+dd/2-1);         // rak sepatu
    plant(x+w/2-1.3, top, z+dd/2-1.3, 0.8);
  }
  if(d.id==='pool'){
    const water = box(9,0.5,5.5, 0x3f9fd8, x, top+0.1, z);
    water.material = new THREE.MeshStandardMaterial({color:0x3f9fd8, roughness:0.25,
      metalness:0.1, transparent:true, opacity:0.92});
    S.water = water;
    box(9.8,0.35,0.4, 0xe8dfcf, x, top+0.18, z-2.95); box(9.8,0.35,0.4, 0xe8dfcf, x, top+0.18, z+2.95);
    box(0.4,0.35,6.3, 0xe8dfcf, x-5.1, top+0.18, z); box(0.4,0.35,6.3, 0xe8dfcf, x+5.1, top+0.18, z);
    for(let i=0;i<4;i++){ const lx=x-4.5+i*3;                          // kursi santai x4
      box(0.8,0.25,1.8, 0xd88a4a, lx, top+0.35, z+4.4);
      box(0.8,0.7,0.15, 0xd88a4a, lx, top+0.7, z+5.2);
      cyl(0.06,0.06,1.9, 0x8a5f3a, lx+1.4, top+0.95, z+4.4, 8);        // tiang payung
      const um2=new THREE.Mesh(new THREE.ConeGeometry(1.1,0.5,10),
        new THREE.MeshStandardMaterial({color:[0x4dd0e1,0xffb74d,0xf76fa0,0x34b37a][i], roughness:0.8}));
      um2.position.set(lx+1.4, top+2.0, z+4.4); um2.castShadow=true; scene.add(um2);
    }
    for(let i=0;i<5;i++) box(1.1,0.08,0.5, 0xc9a06a, x-4+i*2, top+0.04, z-4.2); // deck setapak
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
// (4) Properti khas per divisi — dekorasi tematik sesuai bidangnya supaya tiap
// zona punya karakter sendiri, tidak identik. Low-poly, dipanggil dari buildZones.
function buildProps(d, top){
  const {x, z, w, dd} = {x:d.rect.x, z:d.rect.z, w:d.rect.w, dd:d.rect.d};
  const zb = z-dd/2+0.35; // muka dinding belakang
  const em=(bw,bh,bd,c,px,py,pz,ei=0.9)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),
    new THREE.MeshStandardMaterial({color:c, emissive:c, emissiveIntensity:ei, roughness:0.4}));
    m.position.set(px,py,pz); scene.add(m); return m; };
  const shelf=(px,pz,sw)=>{ for(let i=0;i<3;i++) box(sw,0.09,0.7, 0x9c6b43, px, top+0.7+i*0.8, pz); };
  const id=d.id;
  if(id==='engineering'){ // rak server + lampu status
    const n=Math.max(3,Math.min(7,(w/2.4)|0));
    for(let i=0;i<n;i++){ const rx=x-w/2+1.6+i*((w-3.2)/(n-1||1));
      box(1.7,2.3,0.9, 0x23262e, rx, top+1.15, zb+0.65);
      for(let l=0;l<4;l++) em(1.3,0.06,0.05, l%2?0x39d353:0x4f8ff7, rx, top+0.55+l*0.42, zb+1.12);
    }
    box(w*0.6,0.12,0.35, 0x3a3f4a, x, top+2.62, zb+0.65); // cable tray
  } else if(id==='specialized'){ // meja hologram
    cyl(1.4,1.6,0.5, 0x2c2f3a, x, top+0.25, z, 20);
    const beam=new THREE.Mesh(new THREE.ConeGeometry(1.1,2.2,16,1,true),
      new THREE.MeshStandardMaterial({color:0x9b7ede, transparent:true, opacity:0.28,
        emissive:0x9b7ede, emissiveIntensity:0.5, side:THREE.DoubleSide}));
    beam.position.set(x, top+1.6, z); scene.add(beam);
    const holo=new THREE.Mesh(new THREE.OctahedronGeometry(0.5),
      new THREE.MeshStandardMaterial({color:0x9b7ede, emissive:0x9b7ede, emissiveIntensity:0.8, roughness:0.3}));
    holo.position.set(x, top+2.2, z); scene.add(holo); S.holo=holo;
  } else if(id==='spatial-computing'){ // stasiun VR + kubah proyektor
    for(const [ox,oz] of [[-3,-1],[3,-1],[-3,2],[3,2]]){
      cyl(0.12,0.12,1.6, 0x4a4f5a, x+ox, top+0.8, z+oz, 8);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(0.35,0.07,8,18),
        new THREE.MeshStandardMaterial({color:0x90a4ae, roughness:0.5}));
      ring.position.set(x+ox, top+1.75, z+oz); ring.rotation.x=Math.PI/2.4; scene.add(ring);
    }
    const dome=new THREE.Mesh(new THREE.SphereGeometry(1.6,16,10,0,Math.PI*2,0,Math.PI/2),
      new THREE.MeshStandardMaterial({color:0x90a4ae, transparent:true, opacity:0.35, roughness:0.3}));
    dome.position.set(x, top, z); scene.add(dome);
  } else if(id==='gis'){ // meja peta + globe
    box(4.2,0.12,2.6, 0x6e4a2f, x, top+0.85, z);
    box(3.9,0.06,2.3, 0x4d8a4d, x, top+0.94, z); // permukaan peta hijau
    box(1.2,0.07,0.8, 0x3f6fb5, x-0.8, top+0.98, z+0.3); // danau di peta
    box(0.5,0.25,0.5, 0x8a8a8a, x+1.1, top+1.05, z-0.5); // kota mini
    for(const [ox,oz] of [[-1.9,-1.1],[1.9,-1.1],[-1.9,1.1],[1.9,1.1]])
      box(0.12,0.85,0.12, 0x4a3222, x+ox, top+0.42, z+oz);
    cyl(0.08,0.08,0.9, 0x6e4a2f, x+3.4, top+0.45, z, 8);
    const globe=new THREE.Mesh(new THREE.SphereGeometry(0.55,16,12),
      new THREE.MeshStandardMaterial({color:0x3f8fd0, roughness:0.5}));
    globe.position.set(x+3.4, top+1.35, z); globe.castShadow=true; scene.add(globe);
  } else if(id==='design'){ // easel + kanvas
    for(let i=0;i<3;i++){ const ex=x-3+i*3;
      const l1=box(0.09,2.2,0.09, 0x8a5f3a, ex-0.3, top+1.05, zb+0.9); l1.rotation.z=0.18;
      const l2=box(0.09,2.2,0.09, 0x8a5f3a, ex+0.3, top+1.05, zb+0.9); l2.rotation.z=-0.18;
      box(1.3,1.0,0.06, [0xf76fa0,0x4f8ff7,0xffb74d][i], ex, top+1.35, zb+0.85);
    }
    box(2.6,0.1,1.4, 0xd8cba8, x+4.5, top+0.9, z+2); // meja potong
  } else if(id==='marketing'){ // layar kampanye raksasa + speaker
    em(w*0.5,2.2,0.15, 0xf76fa0, x, top+1.9, zb+0.2, 0.55);
    box(w*0.5+0.3,2.5,0.1, 0x2b2b33, x, top+1.9, zb+0.1);
    for(const sx of [-1,1]){ box(0.8,1.4,0.8, 0x2b2b33, x+sx*(w*0.28), top+0.7, zb+0.8);
      em(0.5,0.5,0.06, 0x333344, x+sx*(w*0.28), top+0.9, zb+1.22, 0.2); }
  } else if(id==='product'){ // papan kanban
    box(5.2,2.0,0.12, 0xfafafa, x, top+1.6, zb+0.15);
    const cols=[0x4f8ff7,0xffb74d,0x34b37a];
    for(let cI=0;cI<3;cI++) for(let rI=0;rI<3;rI++)
      box(0.7,0.5,0.05, cols[cI], x-1.7+cI*1.7, top+1.9-rI*0.6, zb+0.24);
    cyl(1.1,1.1,0.08, 0x8a5f3a, x, top+0.75, z+2, 20); // meja bundar diskusi
    cyl(0.1,0.1,0.75, 0x6e4a2f, x, top+0.37, z+2, 10);
  } else if(id==='project-management'){ // papan gantt + jam dinding
    box(5.2,1.8,0.12, 0xfafafa, x, top+1.6, zb+0.15);
    for(let rI=0;rI<4;rI++){ const bw2=1+rI*0.7;
      box(bw2,0.22,0.05, [0x4f8ff7,0xf76fa0,0x34b37a,0xffb74d][rI], x-2+bw2/2, top+2.05-rI*0.4, zb+0.24); }
    const clk=cyl(0.55,0.55,0.08, 0xfafafa, x+w/2-1.5, top+1.9, zb+0.2, 24); clk.rotation.x=Math.PI/2;
    em(0.06,0.4,0.05, 0x333333, x+w/2-1.5, top+1.95, zb+0.22, 0.1);
  } else if(id==='game-development'){ // kabinet arcade + neon
    for(let i=0;i<2;i++){ const ax2=x-2+i*3.4;
      box(1.1,1.9,0.9, [0x7a3fa0,0x2f6fb0][i], ax2, top+0.95, zb+0.8);
      em(0.8,0.6,0.06, [0xff4fd8,0x4fd8ff][i], ax2, top+1.35, zb+1.28, 0.7);
      box(1.0,0.12,0.5, 0x222222, ax2, top+0.85, zb+1.15);
    }
    em(w*0.4,0.18,0.18, 0xff8a65, x, top+2.5, zb+0.2, 1.2); // strip neon
  } else if(id==='academic'){ // rak buku + podium
    shelf(x-w/2+1.6, zb+0.8, 3.2);
    for(let sI=0;sI<3;sI++) for(let bI=0;bI<6;bI++)
      box(0.32,0.55,0.5, [0x4f8ff7,0xf76fa0,0xffb74d,0x34b37a,0x9b7ede,0xef5350][(sI*6+bI)%6],
        x-w/2+0.5+bI*0.42, top+1.02+sI*0.8, zb+0.8);
    box(0.9,1.15,0.6, 0x6e4a2f, x+2.5, top+0.57, zb+1.2); // podium
    box(1.0,0.08,0.7, 0x8a5f3a, x+2.5, top+1.18, zb+1.2);
  } else if(id==='research'){ // meja lab + gelas ukur
    box(4.6,0.12,1.6, 0xdfe5ea, x, top+0.9, z);
    for(const [ox,oz] of [[-2,-0.6],[2,-0.6],[-2,0.6],[2,0.6]]) box(0.12,0.9,0.12, 0x8a949c, x+ox, top+0.45, z+oz);
    const cols2=[0x4fd8ff,0xff4f6f,0x7bff9e];
    for(let i=0;i<3;i++){ const bx=x-1.5+i*1.5;
      const bk=cyl(0.22,0.26,0.7, cols2[i], bx, top+1.3, z, 12);
      bk.material=new THREE.MeshStandardMaterial({color:cols2[i], transparent:true, opacity:0.75, roughness:0.2});
    }
    box(3.4,1.6,0.1, 0xfafafa, x, top+1.7, zb+0.15); // papan rumus
  } else if(id==='finance'){ // papan grafik batang + brankas
    box(4.4,2.0,0.12, 0xfafafa, x-1, top+1.7, zb+0.15);
    for(let i=0;i<5;i++){ const bh=0.5+((i*37)%100)/100*1.1;
      box(0.5,bh,0.06, i===4?0x34b37a:0xffd54f, x-2.6+i*0.85, top+1.05+bh/2, zb+0.24); }
    box(1.3,1.5,1.1, 0x3a3f4a, x+3.6, top+0.75, zb+0.9); // brankas
    cyl(0.16,0.16,0.1, 0xc0c6cc, x+3.6, top+0.9, zb+1.48, 16).rotation.x=Math.PI/2;
  } else if(id==='sales'){ // rak trofi + podium juara
    shelf(x, zb+0.8, 3.4);
    for(let i=0;i<3;i++){ const tx2=x-1.1+i*1.1;
      cyl(0.16,0.1,0.35, 0xd4af37, tx2, top+1.28+(i%2)*0.8, zb+0.8, 12);
      const cup=new THREE.Mesh(new THREE.SphereGeometry(0.16,10,8),
        new THREE.MeshStandardMaterial({color:0xd4af37, metalness:0.7, roughness:0.3}));
      cup.position.set(tx2, top+1.5+(i%2)*0.8, zb+0.8); scene.add(cup);
    }
    box(1.2,0.5,1.2, 0xc96f2e, x+3.2, top+0.25, z+1.5); // podium
    box(0.9,0.35,0.9, 0xe09a4a, x+3.2, top+0.67, z+1.5);
  } else if(id==='paid-media'){ // tripod kamera + ring light
    for(const a2 of [0,2.1,4.2]){ const leg=box(0.08,1.8,0.08, 0x3a3a3a, x-2, top+0.85, zb+1.6);
      leg.rotation.z=Math.cos(a2)*0.35; leg.rotation.x=Math.sin(a2)*0.35; }
    box(0.7,0.45,0.5, 0x22242a, x-2, top+1.85, zb+1.6);
    em(0.4,0.28,0.06, 0x222831, x-2, top+1.85, zb+1.88, 0.25);
    const rl=new THREE.Mesh(new THREE.TorusGeometry(0.55,0.08,10,24),
      new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xfff2d0, emissiveIntensity:1.1}));
    rl.position.set(x+1.5, top+1.7, zb+1.4); scene.add(rl);
    cyl(0.09,0.09,1.4, 0x3a3a3a, x+1.5, top+0.7, zb+1.4, 8);
  } else if(id==='support'){ // meja help-desk + headset
    box(4.4,0.12,1.2, 0x8a5f3a, x, top+0.95, z+1);
    box(4.4,0.9,0.15, 0x6e4a2f, x, top+0.5, z+0.45);
    for(let i=0;i<3;i++){ const hx=x-1.4+i*1.4;
      cyl(0.07,0.07,0.5, 0x3a3a3a, hx, top+1.25, z+1);
      const hb=new THREE.Mesh(new THREE.TorusGeometry(0.16,0.05,8,16),
        new THREE.MeshStandardMaterial({color:0x3a3a3a, roughness:0.6}));
      hb.position.set(hx, top+1.55, z+1); scene.add(hb);
    }
  } else if(id==='security'){ // dinding monitor CCTV + beacon
    box(4.6,2.2,0.15, 0x1c1e24, x, top+1.7, zb+0.15);
    for(let rI=0;rI<2;rI++) for(let cI=0;cI<3;cI++)
      em(1.25,0.8,0.06, [0x2a4a5a,0x3a5a4a,0x4a3a5a][(rI*3+cI)%3], x-1.5+cI*1.5, top+1.7+(rI?0.5:-0.5), zb+0.26, 0.5);
    cyl(0.12,0.16,0.5, 0x333333, x+w/2-1.2, top+2.9, zb+0.8, 10);
    em(0.22,0.22,0.22, 0xff2222, x+w/2-1.2, top+3.25, zb+0.8, 1.4); // beacon merah
  } else if(id==='testing'){ // bangku uji + papan checklist
    box(3.8,0.12,1.5, 0xb9c2c9, x, top+0.9, z);
    for(const [ox,oz] of [[-1.7,-0.6],[1.7,-0.6],[-1.7,0.6],[1.7,0.6]]) box(0.12,0.9,0.12, 0x7a8288, x+ox, top+0.45, z+oz);
    box(0.9,0.5,0.7, 0x4a5560, x-1, top+1.2, z); // perangkat diuji
    em(0.12,0.12,0.06, 0x39d353, x-1, top+1.25, z+0.38, 1);
    box(2.2,1.5,0.1, 0xfafafa, x+2.8, top+1.5, zb+0.15);
    for(let i=0;i<4;i++){ box(0.28,0.28,0.06, i<3?0x39d353:0xff5252, x+1.9, top+1.95-i*0.4, zb+0.24);
      box(1.0,0.12,0.05, 0x9aa0a6, x+2.7, top+1.95-i*0.4, zb+0.24); }
  } else if(id==='healthcare'){ // kabinet P3K + ranjang
    box(1.4,1.8,0.5, 0xfafafa, x-2, top+0.9, zb+0.6);
    box(0.5,0.16,0.06, 0xef5350, x-2, top+1.2, zb+0.88);
    box(0.16,0.5,0.06, 0xef5350, x-2, top+1.2, zb+0.88);
    box(2.2,0.35,1.0, 0xe8f0f2, x+1.5, top+0.55, z+1); // ranjang
    box(0.5,0.18,0.7, 0xffffff, x+0.7, top+0.8, z+1);  // bantal
    for(const [ox,oz] of [[-0.9,-0.4],[0.9,-0.4],[-0.9,0.4],[0.9,0.4]])
      box(0.08,0.4,0.08, 0x8a949c, x+1.5+ox, top+0.2, z+1+oz);
  }
  // sudut baca/pojok khas untuk zona kecil — rak mini + beanbag
  if(w<17 && !['research','healthcare'].includes(id)){
    shelf(x+w/2-1.8, z+dd/2-1.6, 2.2);
    const bb=new THREE.Mesh(new THREE.SphereGeometry(0.55,12,10),
      new THREE.MeshStandardMaterial({color:new THREE.Color(d.color).lerp(new THREE.Color(0xffffff),0.3), roughness:0.95}));
    bb.scale.set(1,0.62,1); bb.position.set(x+w/2-3.4, top+0.34, z+dd/2-1.6);
    bb.castShadow=true; scene.add(bb);
  }
  // sudut lounge untuk layout L: isi void kiri-belakang dengan sofa + meja kopi
  if((ZONE_LAYOUT[id]||'rows')==='L'){
    const vx=x-w/2+2.6, vz=z+dd/2-2.6;
    const rug=cyl(2.1,2.1,0.06, 0xa85252, vx, top+0.03, vz, 24); rug.receiveShadow=true;
    sofa(vx-0.6, top, vz+0.9, 0.25);
    box(1.0,0.45,1.0, 0x6e4a2f, vx+1.6, top+0.22, vz-0.9); // meja kopi
    cyl(0.22,0.22,0.4, 0xd4af6e, vx+1.6, top+0.65, vz-0.9, 10); // vas
    plant(vx+2.4, top, vz+1.6, 0.9);
    floorLamp(vx-2.2, top, vz-1.4);
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

// (1) Mesin layout furnitur: tiap divisi gayanya beda — pecah grid pabrik.
// Slot: {x, z, fx, fz (arah hadap penghuni, unit), s (skala meja)}.
// a.desk ikut di-update supaya karakter/label/klik tetap akurat.
function computeDeskSlots(){
  const R=(div,i,salt=0)=>{ const h=hashStr(div+':'+i+':'+salt); return (h%10000)/10000; };
  const clampR=(rect,px,pz,m=1.7)=>({
    x:Math.max(rect.x-rect.w/2+m, Math.min(rect.x+rect.w/2-m, px)),
    z:Math.max(rect.z-rect.d/2+m, Math.min(rect.z+rect.d/2-m, pz))});
  for(const divId of Object.keys(S.byDiv)){
    const zn=S.zones[divId]; if(!zn) continue;
    const rect=zn.rect, kind=(ZONE_LAYOUT[divId]||'rows');
    const list=[...S.byDiv[divId]].sort((a,b)=>a.id<b.id?-1:1);
    const n=list.length, slots=[];
    const push=(px,pz,fx,fz,i)=>{
      const c=clampR(rect,px,pz), L=Math.hypot(fx,fz)||1;
      slots.push({x:c.x, z:c.z, fx:fx/L, fz:fz/L, s:0.9+R(divId,i)*0.35});
    };
    if(kind==='pod'){ // cluster 4 meja menghadap titik tengah pod
      const small=n<=8, pradius=small?1.45:1.55, cell=small?4.9:5.2, ins=small?3.0:3.3;
      const per=4, cols=Math.max(1,((rect.w-ins*2)/cell)|0),
            rows=Math.max(1,Math.ceil((rect.d-ins*2)/cell));
      let i=0;
      for(let pr=0;pr<rows&&i<n;pr++) for(let pc=0;pc<cols&&i<n;pc++){
        const cx=rect.x-rect.w/2+ins+pc*((rect.w-ins*2)/Math.max(1,cols-1)||0);
        const cz=rect.z-rect.d/2+ins+pr*((rect.d-ins*2)/Math.max(1,rows-1)||0);
        const rot=R(divId,pc*7+pr*13)*Math.PI*2;
        for(let k=0;k<per&&i<n;k++,i++){
          const a=rot+k*Math.PI*2/per;
          push(cx+Math.sin(a)*pradius, cz+Math.cos(a)*pradius, -Math.sin(a), -Math.cos(a), i);
        }
      }
      // sisa: meja cadangan rapi di baris belakang (bukan acak)
      while(i<n){ push(rect.x-rect.w/2+2.6+(i%9)*((rect.w-5.2)/8),
        rect.z+rect.d/2-2.4-(((i/9)|0)%3)*2.8, 0, -1, i); i++; }
    } else if(kind==='arc'){ // amfiteater: busur menghadap titik fokus depan ruangan
      const fx0=rect.x, fz0=rect.z-rect.d/2+2.2, span=1.0;
      let i=0, t=0;
      const maxRad=rect.d-4;
      while(i<n){
        const rad=Math.min(3.6+t*3.1, maxRad);
        const cap=Math.max(3,(2*span*rad/2.7)|0); // kapasitas dari panjang busur
        for(let k=0;k<cap&&i<n;k++,i++){
          const a=cap===1?0:-span+2*span*(k/(cap-1));
          const px=fx0+Math.sin(a)*rad, pz=fz0+Math.cos(a)*rad;
          push(px,pz,fx0-px,fz0-pz,i);
        }
        t++;
        if(t>8){ while(i<n){ push(rect.x+(R(divId,i,1)-0.5)*(rect.w-4),
          rect.z+(R(divId,i,2)-0.5)*(rect.d-4), 0, -1, i); i++; } }
      }
    } else if(kind==='L'){ // blok-L: void sudut kiri-belakang jadi lounge (bukan meja)
      const perRow=Math.max(2,((rect.w-3)/2.6)|0), rowGap=2.7;
      let i=0, r=0;
      const voidC=(px,pz)=>{
        const fz=(pz-(rect.z-rect.d/2))/rect.d;
        return fz>0.72 && px<rect.x-rect.w*0.22;
      };
      while(i<n&&r<40){
        const pz=rect.z-rect.d/2+2.4+r*rowGap;
        if(pz>rect.z+rect.d/2-1.7) break;
        for(let c=0;c<perRow&&i<n;c++){
          const px=rect.x-rect.w/2+2.2+c*2.6;
          if(voidC(px,pz)) continue; // sudut lounge: kosong, diisi sofa di buildProps
          push(px,pz,(R(divId,i,3)-0.5)*0.2, r%2?-1:1, i); i++;
        }
        r++;
      }
      while(i<n){ push(rect.x+(R(divId,i,1)-0.5)*(rect.w-4),
        rect.z+(R(divId,i,2)-0.5)*(rect.d-4), 0, 1, i); i++; }
    } else if(kind==='U'){ // bentuk-U menghadap area tengah-depan
      const cx0=rect.x, cz0=rect.z-rect.d/2+2.6, perSide=Math.max(2,Math.ceil(n/3));
      const x0=cx0-rect.w/2+4.6, x1=cx0+rect.w/2-4.6; // sisi bawah di-inset
      for(let i=0;i<n;i++){
        const side=(i/perSide)|0, k=i%perSide;
        if(side===0) push(x0+k*((x1-x0)/Math.max(1,perSide-1)||0), cz0+3.4, 0, -1, i);
        else if(side===1) push(cx0-rect.w/2+2.0, cz0+0.4+k*2.9, 1, -0.35, i);
        else push(cx0+rect.w/2-2.0, cz0+0.4+k*2.9, -1, -0.35, i);
      }
    } else if(kind==='longtable'){ // meja komunal panjang: dua sisi berhadapan
      const perT=10, nT=Math.ceil(n/perT);
      const tCols=Math.min(nT,Math.max(1,Math.round(rect.w/14))), tRows=Math.ceil(nT/tCols);
      let i=0;
      for(let tr=0;tr<tRows&&i<n;tr++) for(let tc=0;tc<tCols&&i<n;tc++){
        const cx=rect.x-rect.w/2+(tc+0.5)*(rect.w/tCols);
        const cz=rect.z-rect.d/2+(tr+0.5)*(rect.d/tRows);
        const cnt=Math.min(perT,n-i), sideA=Math.ceil(cnt/2), sideB=cnt-sideA;
        const tW=Math.min(rect.w/tCols-3.5, 11);
        for(let k=0;k<sideA;k++,i++)
          push(cx-tW/2+k*(tW/Math.max(1,sideA-1)||0), cz-0.85, 0, 1, i);
        for(let k=0;k<sideB;k++,i++)
          push(cx-tW/2+k*(tW/Math.max(1,sideB-1)||0), cz+0.85, 0, -1, i);
      }
    } else if(kind==='studio'){ // meja miring ala studio desain
      const perRow=Math.max(2,((rect.w-3)/3.2)|0);
      for(let i=0;i<n;i++){
        const r=(i/perRow)|0, c=i%perRow;
        const tilt=(c%2?0.38:-0.38)+(R(divId,i)-0.5)*0.12, dir=r%2?-1:1;
        push(rect.x-rect.w/2+2.2+c*3.2, rect.z-rect.d/2+2.6+r*3.1,
             Math.sin(tilt)*dir, -dir*Math.cos(tilt), i);
      }
    } else { // rows: baris longgar, pasangan baris saling berhadapan + jitter
      const perRow=Math.max(2,((rect.w-3)/2.8)|0);
      for(let i=0;i<n;i++){
        const r=(i/perRow)|0, c=i%perRow;
        push(rect.x-rect.w/2+2.0+c*2.8+(R(divId,i,1)-0.5)*0.7,
             rect.z-rect.d/2+2.3+r*2.9+(R(divId,i,2)-0.5)*0.5,
             (R(divId,i,3)-0.5)*0.2, r%2?-1:1, i);
      }
    }
    list.forEach((a,k)=>{ const s=slots[k]||slots[slots.length-1]||{x:rect.x,z:rect.z,fx:0,fz:-1,s:1};
      a.desk={x:s.x, y:0, z:s.z}; a._slot=s; });
  }
}

// meja + kursi untuk SEMUA agent: 5 InstancedMesh (1 draw call per jenis).
// Orientasi & ukuran meja bervariasi mengikuti slot tiap divisi.
function buildFurniture(){
  computeDeskSlots();
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
  const M=new THREE.Matrix4(), Q=new THREE.Quaternion(), E=new THREE.Euler(),
        V=new THREE.Vector3(), SC=new THREE.Vector3();
  S.agents.forEach((a,i)=>{
    const zn=S.zones[a.division], top=zn.top;
    const s=a._slot||{x:a.desk.x, z:a.desk.z, fx:0, fz:-1, s:1};
    const ry=Math.atan2(-s.fx,-s.fz); // local -z (arah hadap) -> (fx,fz)
    E.set(0,ry,0); Q.setFromEuler(E); SC.set(s.s,s.s,s.s);
    const put=(im,ox,oy,oz)=>{ V.set(s.x+ox, top+oy, s.z+oz); M.compose(V,Q,SC); im.setMatrixAt(i,M); };
    put(tT, 0, 0.74*s.s, 0); put(tB, 0, 0.37*s.s, 0);
    put(tS, -s.fx*1.05, 0.47*s.s, -s.fz*1.05);   // kursi di belakang (sisi -facing)
    put(tB2, -s.fx*1.32, 0.82*s.s, -s.fz*1.32);
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
  // monitor: 1 instanced lagi (layar), ikut orientasi meja
  const monG = new THREE.BoxGeometry(0.62,0.4,0.06);
  const monM = new THREE.MeshStandardMaterial({color:0x2b3a4a, roughness:0.4, emissive:0x1a2a3a, emissiveIntensity:0.5});
  const tM = mk(monG, monM);
  S.agents.forEach((a,i)=>{ const zn=S.zones[a.division], s=a._slot||{x:a.desk.x,z:a.desk.z,fx:0,fz:-1,s:1};
    E.set(0,Math.atan2(-s.fx,-s.fz),0); Q.setFromEuler(E); SC.set(s.s,s.s,s.s);
    V.set(s.x+s.fx*0.28, zn.top+1.02*s.s, s.z+s.fz*0.28); M.compose(V,Q,SC); tM.setMatrixAt(i,M); });
  tM.instanceMatrix.needsUpdate = true;
}

// ==================== BAGIAN C: karakter chibi ====================
const _c = h => new THREE.Color(h);
// ---------- karakter pixel-art (sprite, ringan, gaya video) ----------
// Satu agent = 1 sprite + texture kanvas 24x32 (cache per kombinasi warna).
// Jauh lebih ringan dari chibi 3D artikulasi (dulu 1 agent = ~12 mesh).
const PIXEL_TEX_CACHE={};
function pixelTex(o={}){
  const key=[o.shirt,o.skin,o.hair,o.style,o.headphone?'hp':'x'].join('|');
  if(PIXEL_TEX_CACHE[key]) return PIXEL_TEX_CACHE[key];
  const W=24,H=32;
  const mk=(pose)=>{
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const c=cv.getContext('2d');
    const P=(x,y,w,h,col)=>{ c.fillStyle=col; c.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h)); };
    const shirt=o.shirt||'#4f8ff7', skin=o.skin||'#f1c27d', hairC=o.hair||'#232323';
    const pants='#333948', shoe='#1e1e24', shade='rgba(0,0,0,0.16)';
    const dy=pose==='sit'?5:0;
    // kaki
    if(pose==='sit'){ P(9,26,7,3,pants); }
    else if(pose==='walk'){ P(7,25,4,5,pants); P(14,26,4,5,pants); P(7,29,4,2,shoe); P(14,30,4,2,shoe); }
    else { P(9,25,3,6,pants); P(13,25,3,6,pants); P(9,30,3,2,shoe); P(13,30,3,2,shoe); }
    // badan + lengan + tangan
    P(7,14+dy,11,12,shirt); P(7,14+dy,11,2,shade);
    P(4,15+dy,3,8,shirt); P(18,15+dy,3,8,shirt);
    P(4,22+dy,3,3,skin); P(18,22+dy,3,3,skin);
    // kepala + wajah
    P(8,5+dy,9,9,skin);
    P(10,8+dy,2,2,'#20242c'); P(14,8+dy,2,2,'#20242c');
    P(11,11+dy,4,1,'#9c6b4f');
    P(8,5+dy,9,1,shade);
    // gaya rambut khas (0 pendek, 1 spiky, 2 panjang, 3 peci, 4 hijab)
    const st=o.style||0;
    if(st===3){ P(7,3+dy,11,4,'#141414'); P(7,7+dy,11,1,'#141414'); }
    else if(st===4){
      P(6,2+dy,13,13,hairC); P(8,5+dy,9,9,skin);
      P(10,8+dy,2,2,'#20242c'); P(14,8+dy,2,2,'#20242c'); P(11,11+dy,4,1,'#9c6b4f');
      P(6,15+dy,13,12,hairC); P(7,14+dy,11,12,shirt);
      P(4,15+dy,3,8,shirt); P(18,15+dy,3,8,shirt);
    } else {
      P(7,2+dy,11,4,hairC);
      if(st===1){ P(8,0+dy,2,2,hairC); P(12,-1+dy,2,3,hairC); P(16,0+dy,2,2,hairC); }
      if(st===2){ P(5,3+dy,3,9,hairC); P(17,3+dy,3,9,hairC); }
    }
    if(o.headphone){ // Noir: headphone + mata glow
      P(5,6+dy,3,7,'#101014'); P(17,6+dy,3,7,'#101014'); P(5,4+dy,15,2,'#101014');
      P(10,8+dy,2,1,'#7df9ff'); P(14,8+dy,2,1,'#7df9ff');
    }
    const tx=new THREE.CanvasTexture(cv);
    tx.magFilter=THREE.NearestFilter; tx.minFilter=THREE.NearestFilter;
    tx.generateMipmaps=false; tx.colorSpace=THREE.SRGBColorSpace;
    return tx;
  };
  const out={idle:mk('idle'), walk:mk('walk'), sit:mk('sit')};
  PIXEL_TEX_CACHE[key]=out; return out;
}
const SPR_W=2.3, SPR_H=3.07; // ukuran sprite di dunia
// Nama fungsi dipertahankan (makeChibi) agar semua pemanggil tetap jalan.
function makeChibi(o={}){
  const tex=pixelTex(o);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex.idle, transparent:true, alphaTest:0.4}));
  sp.scale.set(SPR_W,SPR_H,1);
  scene.add(sp);
  return {g:sp, tex, sprite:true, status:'idle', t:Math.random()*10,
          moveTo:null, yaw:0, baseY:0, label:o.label||null,
          isSpecial:o.isSpecial||null, isDemo:!!o.isDemo};
}

function animChibi(ch, dt){
  if(!ch.sprite) return;
  const t=ch.t+=dt, sp=ch.g, st=ch.status;
  let bob=0, frame=ch.tex.idle;
  if(st==='working') bob=Math.abs(Math.sin(t*13))*0.07;
  else if(st==='reading') bob=Math.abs(Math.sin(t*2))*0.03;
  else if(st==='waiting') bob=Math.abs(Math.sin(t*2.2))*0.05;
  else if(st==='meeting'){ frame=ch.tex.sit; bob=Math.abs(Math.sin(t*1.4))*0.02; }
  else if(st==='running'||st==='walk'){
    const f=st==='running'?11:6.5;
    frame=(Math.sin(t*f)>0)?ch.tex.walk:ch.tex.idle;
    bob=Math.abs(Math.sin(t*f))*(st==='running'?0.14:0.08);
  }
  else if(st==='done') bob=Math.abs(Math.sin(t*5))*0.55;
  else if(st==='sholat') bob=Math.abs(Math.sin(t*1.2))*0.02; // sholat: tenang menunduk
  else bob=Math.abs(Math.sin(t*2.1))*0.045; // idle: napas
  // gerakan menuju target
  if(ch.moveTo){
    const m=ch.moveTo, dx=m.x-sp.position.x, dz=m.z-sp.position.z;
    const dist=Math.hypot(dx,dz);
    if(dist<0.35){ sp.position.x=m.x; sp.position.z=m.z; const cb=m.onDone; ch.moveTo=null; cb&&cb(); }
    else{
      sp.position.x+=dx/dist*m.speed*dt; sp.position.z+=dz/dist*m.speed*dt;
      sp.scale.x=((dx-dz)>=0?1:-1)*SPR_W; // hadap arah gerak (kamera iso 45°)
      ch.yaw=Math.atan2(dx,dz);
      frame=(Math.sin(t*9)>0)?ch.tex.walk:ch.tex.idle;
      bob=Math.max(bob,Math.abs(Math.sin(t*9))*0.08);
    }
  } else sp.scale.x=SPR_W;
  if(sp.material.map!==frame){ sp.material.map=frame; sp.material.needsUpdate=true; }
  sp.position.y=ch.baseY+SPR_H/2+bob;
}

// ---------- crowd ambient: 3 InstancedMesh ----------
let crowd=null;
function buildCrowd(){
  crowd={ items:[], hidden:new Set() };
  S.agents.forEach((a,i)=>{
    const zn=S.zones[a.division];
    const tex=pixelTex({shirt:a.color, skin:a.skin, hair:a.hair, style:i%5});
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex.idle, transparent:true, alphaTest:0.4}));
    sp.scale.set(SPR_W,SPR_H,1);
    const it={ x:a.desk.x+(Math.random()-0.5)*3, z:a.desk.z+(Math.random()-0.5)*3,
      tx:0,tz:0,ty:zn.top,y:zn.top, speed:0.9+Math.random()*0.7, ph:Math.random()*9,
      zn, wait:Math.random()*4, mode:'desk', path:[], spot:null, onArrive:null,
      nextSocial:8+Math.random()*50, sp, tex };
    pickTarget(it); it.x=it.tx; it.z=it.tz; pickTarget(it); it.y=it.ty;
    sp.position.set(it.x, it.y+SPR_H/2, it.z);
    scene.add(sp);
    crowd.items.push(it);
  });
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
  crowd.items.forEach((it,i)=>{
    const sp=it.sp;
    if(crowd.hidden.has(i)){ sp.visible=false; return; }
    sp.visible=true;
    let bob=0, moving=false, mdx=0, mdz=0;
    if(it.path&&it.path.length){
      // mode sosial: jalan via waypoint koridor (bukan patroli acak)
      const wp=it.path[0], dx=wp.x-it.x, dz=wp.z-it.z, dist=Math.hypot(dx,dz);
      if(it.path.length===1) it.y+=((it.ty!==undefined?it.ty:it.y)-it.y)*Math.min(1,dt*2.5);
      if(dist<0.5){ it.path.shift();
        if(!it.path.length&&it.onArrive){ const f=it.onArrive; it.onArrive=null; f(); } }
      else{ const s=it.speed*1.5;
        it.x+=dx/dist*s*dt; it.z+=dz/dist*s*dt;
        moving=true; mdx=dx; mdz=dz; bob=Math.abs(Math.sin(t*7+it.ph))*0.09; }
    } else if(it.mode==='hangout'){
      bob=Math.abs(Math.sin(t*2+it.ph))*0.03; // diam ngobrol
    } else {
      it.y += ((it.ty!==undefined?it.ty:it.y)-it.y)*Math.min(1,dt*2.5); // transisi level halus
      const dx=it.tx-it.x, dz=it.tz-it.z, dist=Math.hypot(dx,dz);
      if(dist>0.4){
        // berdatangan (06-08): semua bergegas ke meja masing-masing
        const rush=(S.rhythm&&S.rhythm.fase==='berdatangan')?2.4:1;
        it.x+=dx/dist*it.speed*rush*dt; it.z+=dz/dist*it.speed*rush*dt;
        moving=true; mdx=dx; mdz=dz; bob=Math.abs(Math.sin(t*7+it.ph))*0.09;
      } else if((it.wait-=dt)<=0) pickTarget(it);
    }
    const fr=moving?((Math.sin(t*7+it.ph)>0)?it.tex.walk:it.tex.idle):it.tex.idle;
    if(sp.material.map!==fr){ sp.material.map=fr; sp.material.needsUpdate=true; }
    sp.scale.x=moving?(((mdx-mdz)>=0?1:-1)*SPR_W):SPR_W;
    sp.position.set(it.x, it.y+SPR_H/2+bob, it.z);
  });
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
    if(ch){ if(ch._sholatPaused){ // pause visual saat sholat: status live disimpan, bukan ditimpa
        ch._liveStatus=e.status; ch.detail='🕌 pause sholat — kembali setelah adzan';
      } else { if(ch.status!==e.status&&e.status!=='running'){ch.status=e.status;ch.moveTo=null;} ch.detail=e.detail||''; } }
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

// ==================== FITUR RITME REALTIME (SISTEM KANTOR HIDUP) ====================
// Poll GET /api/rhythm tiap 60 detik. Fase "sholat": SEMUA aktivitas pause —
// karakter live (termasuk yang sedang live-working perintah Bos) jalan ke
// musholla, lalu kembali & lanjut lagi setelah window selesai. Frontend bunyikan
// adzan: coba /static/adzan.mp3 bila ada, fallback chime WebAudio + banner besar.
// Ritme harian: berdatangan/kerja/istirahat/kerja_sore/pulang (malam redup)/
// weekend (santai, aktivitas minimal).
S.rhythm=null; S.sholatMode=false; S.nightMode=false;
const RHYTHM_POLL_MS=60000;

function setNight(on){ // mode malam: kantor redup
  if(S.nightMode===on) return; S.nightMode=on;
  try{ sun.intensity=on?0.45:1.9; hemi.intensity=on?0.28:0.85; }catch(e){}
}
function mushollaPoint(){
  const r=S.zones.musholla.rect;
  return {x:r.x+(Math.random()-0.5)*6, z:r.z+(Math.random()-0.5)*4, top:S.zones.musholla.top};
}
function sendToMusholla(it){
  if(it.spot){ it.spot.occupants.delete(it); it.spot=null; }
  const s=mushollaPoint();
  it.path=routeTo(it.x,it.z,s.x,s.z); it.ty=s.top; it.mode='toMusholla';
  it.onArrive=()=>{ it.mode='hangout'; it.hangT=1200; it.faceT=0; };
}
function playAdzan(nama){
  const b=$('#adzan-banner');
  b.innerHTML='🕌 ADZAN '+(nama||'').toUpperCase()
    +'<span>seluruh kantor pause sholat — kembali setelah selesai</span>';
  b.classList.remove('hidden');
  const fallback=()=>chimeAdzan();
  try{
    const a=new Audio('static/adzan.mp3');
    a.addEventListener('error',fallback);
    const p=a.play(); if(p&&p.catch) p.catch(fallback);
  }catch(e){ fallback(); }
}
let _ac=null;
function chimeAdzan(){ // fallback bila adzan.mp3 tidak ada / autoplay diblokir
  try{
    _ac=_ac||new (window.AudioContext||window.webkitAudioContext)();
    if(_ac.state==='suspended') _ac.resume();
    const t0=_ac.currentTime;
    [523.25,659.25,783.99,1046.5].forEach((f,i)=>{
      const o=_ac.createOscillator(), g=_ac.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,t0+i*0.45);
      g.gain.exponentialRampToValueAtTime(0.22,t0+i*0.45+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+i*0.45+0.9);
      o.connect(g).connect(_ac.destination);
      o.start(t0+i*0.45); o.stop(t0+i*0.45+1);
    });
  }catch(e){}
}
function enterSholat(nama){
  if(S.sholatMode) return; S.sholatMode=true;
  playAdzan(nama);
  const walkM=(ch)=>{ const s=mushollaPoint();
    ch.moveTo={x:s.x+(Math.random()-0.5)*4, z:s.z+(Math.random()-0.5)*3, speed:3.2}; };
  // karakter live: pause visual tapi status server tetap dicatat (_liveStatus)
  for(const ch of Object.values(S.liveChars)){
    ch._prevPos={x:ch.g.position.x, z:ch.g.position.z};
    ch._prevStatus=ch.status; ch._prevDetail=ch.detail||''; ch._liveStatus=null;
    ch._sholatPaused=true; ch.status='sholat';
    ch.detail='🕌 pause sholat — kembali setelah adzan';
    walkM(ch);
  }
  for(const ch of (S.specialChars||[])){
    ch._prevPos={x:ch.g.position.x, z:ch.g.position.z};
    ch._sholatPaused=true; ch.status='sholat'; walkM(ch);
  }
  redirectCrowdToMusholla();
}
// hangT 1200 hanya dipakai jemaah musholla (sosial biasa max ~62 dtk)
function atMusholla(it){ return it.mode==='toMusholla'||(it.mode==='hangout'&&it.hangT>900); }
function redirectCrowdToMusholla(){
  if(!crowd) return;
  for(let i=0;i<crowd.items.length;i++){
    if(crowd.hidden.has(i)) continue;
    const it=crowd.items[i];
    if(!atMusholla(it)) sendToMusholla(it);
  }
}
function exitSholat(){
  if(!S.sholatMode) return; S.sholatMode=false;
  $('#adzan-banner').classList.add('hidden');
  for(const ch of Object.values(S.liveChars)){
    ch._sholatPaused=false;
    ch.status=ch._liveStatus||ch._prevStatus||'idle'; ch._liveStatus=null;
    ch.detail=ch._prevDetail||''; ch._prevDetail=null;
    if(ch._prevPos){ ch.moveTo={x:ch._prevPos.x, z:ch._prevPos.z, speed:3.0}; ch._prevPos=null; }
    else ch.moveTo=null;
  }
  for(const ch of (S.specialChars||[])){
    ch._sholatPaused=false; ch.status='idle'; ch.moveTo=null; ch._prevPos=null;
  }
  if(crowd) for(let i=0;i<crowd.items.length;i++){
    if(crowd.hidden.has(i)) continue;
    const it=crowd.items[i];
    if(atMusholla(it)) sendHome(it);
  }
}
function applyRhythm(r){
  S.rhythm=r;
  if(r.fase==='sholat') enterSholat(r.sholat_sekarang);
  else exitSholat();
  setNight(r.ritme==='malam');
  const el=$('#rhythm-badge');
  if(el) el.textContent=(r.fase==='sholat'?('🕌 '+(r.sholat_sekarang||'').toUpperCase())
    :r.fase.toUpperCase())+' · '+r.waktu;
}
async function pollRhythm(){
  try{ applyRhythm(await API.get('api/rhythm')); }
  catch(e){ /* diam; coba lagi 60 detik berikutnya */ }
}
// ================== /FITUR RITME REALTIME ==================

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
  // 1. karakter live (prioritas tertinggi) + bubble status natural ala video
  if(!farZoom) for(const [id,ch] of Object.entries(S.liveChars)){
    const a=S.byId[id], nm=a?a.name:(id==='noir'?'Noir':id==='bos'?'Bos':id);
    const e=fresh[id]||{status:ch.status,detail:ch.detail};
    const gp=ch.g.position;
    const det=String(e.detail||ch.detail||'').trim();
    const bub=det?`<span class="bubble">${esc(det.length>90?det.slice(0,90)+'…':det)}</span>`:'';
    add('live:'+id, gp.x, gp.y+2.15, gp.z,
      `<span class="st" style="background:${STATUS_COLOR[e.status]||'#999'}"></span>${esc(nm)}${bub}`,
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
  // 5b. (5) badge nama crowd HANYA saat kamera dekat (zoom>=1.8): 10 terdekat
  if(zoom>=1.8&&crowd&&!farZoom){
    const cx=S.camTarget.x, cz=S.camTarget.z, cand=[];
    for(let i=0;i<crowd.items.length;i++){
      if(crowd.hidden.has(i)) continue;
      const it=crowd.items[i], dd=(it.x-cx)*(it.x-cx)+(it.z-cz)*(it.z-cz);
      if(dd<1024) cand.push({i,dd});
    }
    cand.sort((a,b)=>a.dd-b.dd);
    for(const {i} of cand.slice(0,10)){
      const it=crowd.items[i], a=S.agents[i];
      add('crowd:'+a.id, it.x, it.y+3.5, it.z, `${a.name}`, 1, 'mini',
        ()=>showCard(a.id,a.desk.x,(S.zones[a.division]||{}).top+2.15,a.desk.z));
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
  $('#fab-cmd').classList.toggle('show', collapsed); // FAB tampil tiap panel dilipat (desktop+mobile)
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
  ['cmd','chat','queue','appr','log'].forEach(k=>$('#tab-'+k).classList.toggle('hidden',k!==t.dataset.tab));
  if(t.dataset.tab==='chat') scrollChatBottom();
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
// ---------- goals / target ----------
S.goals=[];
async function fetchGoals(){
  try{
    const j=await API.get('api/goals');
    S.goals=j.goals||[];
    renderGoals();
  }catch(e){}
}
function renderGoals(){
  const box=$('#goal-list');
  if(!S.goals.length){
    box.innerHTML='<p class="hint">Belum ada target. Tambah target di atas — progresnya bisa diupdate manual atau oleh worker.</p>';
    return;
  }
  box.innerHTML=S.goals.map(g=>
    `<div class="aitem"><div class="qt"><b>🎯 ${esc(g.title)}</b></div>
     <div class="meta">${g.target?`<span>target: ${esc(g.target)}</span>`:''}
     ${g.division?`<span>📁 ${esc(g.division)}</span>`:''}
     <span class="chip ${g.status}">${g.status}</span></div>
     <div class="gbar"><div class="gfill" style="width:${g.progress}%"></div></div>
     <div class="grow">
       <input type="range" min="0" max="100" value="${g.progress}" data-gid="${g.id}" class="gslider">
       <span class="gpct">${g.progress}%</span>
     </div>
     ${g.catatan?`<div class="ringkasan">📝 ${esc(g.catatan)}</div>`:''}
    </div>`).join('');
  box.querySelectorAll('.gslider').forEach(s=>{
    s.onchange=async()=>{
      try{
        await API.post('api/goals/'+encodeURIComponent(s.dataset.gid)+'/progress',{progress:+s.value});
        await fetchGoals();
      }catch(e){ toast('Gagal update: '+e.message); }
    };
  });
}
async function addGoal(){
  const t=$('#goal-title').value.trim(), tg=$('#goal-target').value.trim();
  if(!t){ toast('Judul target wajib diisi'); return; }
  try{
    await API.post('api/goals',{title:t,target:tg});
    $('#goal-title').value=''; $('#goal-target').value='';
    await fetchGoals(); toast('🎯 Target ditambahkan');
  }catch(e){ toast('Gagal: '+e.message); }
}
// ---------- sistem approval Bos (Fase 2) ----------
let apprSeenIds = new Set(); // id approval menunggu yang sudah dinotifikasi
async function fetchApprovals(){
  try{
    const j = await API.get('api/approvals');
    S.approvals = j.approvals || [];
    const pending = S.approvals.filter(a=>a.status==='menunggu');
    $('#appr-count').textContent = pending.length || '';
    // notifikasi: approval menunggu yang baru muncul -> toast
    for(const a of pending){
      if(apprSeenIds.has(a.id)) continue;
      apprSeenIds.add(a.id);
      toast('🛡️ Approval diminta: ' + a.title.slice(0,70));
    }
    renderApprovals();
  }catch(e){ /* biarkan polling berikutnya */ }
}
function renderApprovals(){
  const box = $('#appr-list');
  if(!S.approvals.length){
    box.innerHTML = '<p class="hint">Belum ada permintaan approval. Worker meminta approval sebelum menjalankan aksi berisiko.</p>';
    return;
  }
  box.innerHTML = S.approvals.map(a=>
    `<div class="aitem"><div class="qt"><b>🛡️ ${esc(a.title)}</b></div>
     <div class="meta"><span class="chip ${a.status}">${a.status}</span>
     <span class="kind">${esc(a.kind)}</span>
     ${a.command_id?`<span>🔗 ${esc(a.command_id)}</span>`:''}
     <span>${wib(a.created_at)}</span></div>
     ${a.detail?`<div class="adetail">${truncText(a.detail)}</div>`:''}
     ${a.status==='menunggu'
       ?`<div class="arow">
          <button class="abtn ok" onclick="apprDecide('${a.id}',true,this)">✅ Setuju</button>
          <button class="abtn no" onclick="apprDecide('${a.id}',false,this)">⛔ Tolak</button>
        </div>`
       :''}
     ${a.catatan?`<div class="ringkasan">📝 ${esc(a.catatan)}</div>`:''}
     ${a.decided_at?`<div class="meta" style="margin-top:4px"><span>diputus ${wib(a.decided_at)}</span></div>`:''}
    </div>`).join('');
}
// dipanggil dari inline onclick -> harus di window (modul tidak global)
window.apprDecide = async function(id, setuju, btn){
  if(btn) btn.disabled = true;
  try{
    const r = await API.post('api/approvals/'+encodeURIComponent(id)+'/putuskan', {setuju});
    toast((setuju?'✅ Disetujui: ':'⛔ Ditolak: ') + r.approval.title.slice(0,60));
    await fetchApprovals();   // refresh daftar + badge
    await pollLive();         // activity log ikut tercatat di server
  }catch(e){
    toast('Gagal memutuskan: ' + e.message);
    if(btn) btn.disabled = false;
  }
};

function renderQueue(){  const box=$('#queue-list');
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

// ---------- chat Noir ----------
// Frontend HANYA menampilkan. Balasan ditulis cron kantor-v3-chat-responder
// (dibuat terpisah) — jangan pernah jawab sendiri di sini.
const CHAT_POLL_MS=5000;
const chatSeen=new Set();
function chatImgUrl(u){ return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(u||''); }
function renderChatBubble(m){
  const cls=m.from==='noir'?'noir':'bos';
  let inner=`<div class="ctxt">${esc(m.text)}</div>`;
  if(m.lampiran){
    const u=esc(m.lampiran), fn=u.split('/').pop();
    inner+=chatImgUrl(m.lampiran)
      ?`<a href="${u}" target="_blank" rel="noopener"><img class="cimg" src="${u}" loading="lazy" alt="${fn}"></a>`
      :`<a class="cfile" href="${u}" target="_blank" rel="noopener">📎 ${fn}</a>`;
  }
  if(m.from==='noir') inner+=`<button class="cplay" data-mid="${esc(m.id)}" title="Dengarkan">🔊</button>`;
  return `<div class="cbubble ${cls}">${inner}<span class="cts">${wib(m.created_at)}</span></div>`;
}
// ---------- voice: TTS + dictation (browser-native, tanpa server) ----------
const chatTextById=new Map();
function speakText(t){
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(t);
    u.lang='id-ID'; u.rate=1;
    const v=speechSynthesis.getVoices().find(v=>v.lang&&v.lang.toLowerCase().startsWith('id'));
    if(v) u.voice=v;
    speechSynthesis.speak(u);
  }catch(e){ toast('TTS tidak didukung browser ini'); }
}
let recog=null, recogOn=false;
function initVoice(){
  $('#chat-list').addEventListener('click',e=>{
    const b=e.target.closest('.cplay'); if(!b) return;
    const t=chatTextById.get(b.dataset.mid); if(t) speakText(t);
  });
  $('#chat-mic').onclick=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ toast('Voice input tidak didukung browser ini'); return; }
    if(recogOn){ try{recog.stop();}catch(e){} return; }
    recog=new SR(); recog.lang='id-ID'; recog.interimResults=false;
    recog.onresult=e=>{
      const t=e.results[0][0].transcript;
      const inp=$('#chat-input'); inp.value=(inp.value?inp.value+' ':'')+t; inp.focus();
    };
    recog.onend=()=>{ recogOn=false; $('#chat-mic').classList.remove('on'); };
    recog.onerror=()=>{ recogOn=false; $('#chat-mic').classList.remove('on'); };
    try{ recog.start(); recogOn=true; $('#chat-mic').classList.add('on'); toast('🎤 Bicara sekarang...'); }
    catch(e){ toast('Mic gagal dimulai'); }
  };
}
function scrollChatBottom(){ const b=$('#chat-list'); if(b) b.scrollTop=b.scrollHeight; }
// ---------- chat threads: Noir + manager per divisi ----------
S.chatThread='noir'; S.managers=[];
async function fetchManagers(){
  try{
    const j=await API.get('api/managers');
    S.managers=j.managers||[];
    const sel=$('#chat-thread');
    sel.innerHTML='<option value="noir">🤖 Noir (langsung)</option>'+
      S.managers.map(m=>`<option value="mgr:${m.division}">💼 ${esc(m.role)}</option>`).join('');
    sel.value=S.chatThread;
    sel.onchange=()=>{ S.chatThread=sel.value; updateChatHint(); pollChat(); };
    updateChatHint();
  }catch(e){ /* biarkan default Noir */ }
}
function threadLabel(){
  if(S.chatThread==='noir') return 'Noir';
  const m=S.managers.find(x=>'mgr:'+x.division===S.chatThread);
  return m?m.role:'Manager';
}
function updateChatHint(){
  $('#chat-input').placeholder = S.chatThread==='noir'
    ? 'Ngobrol sama Noir...'
    : `Briefing ${threadLabel()}...`;
}
async function pollChat(){
  try{
    const j=await API.get('api/chat?thread='+encodeURIComponent(S.chatThread));
    const msgs=j.messages||[];
    $('#chat-list').innerHTML=msgs.length?msgs.map(renderChatBubble).join('')
      :'<p class="hint">Belum ada obrolan. Sapa Noir 👋</p>';
    chatTextById.clear();
    for(const m of msgs){ chatTextById.set(m.id, m.text); chatSeen.add(m.id); }
    // indikator "sedang mengetik": pesan terakhir dari Bos & status masih baru
    const last=msgs[msgs.length-1];
    $('#chat-typing-who').textContent=threadLabel();
    $('#chat-typing').classList.toggle('hidden',!(last&&last.from==='bos'&&last.status==='baru'));
    if(!$('#tab-chat').classList.contains('hidden')) scrollChatBottom();
  }catch(e){ /* diam; status koneksi ditangani pollLive */ }
}
let pendingAttach=null; // {url,name} dari /api/upload
$('#chat-attach').onclick=()=>$('#chat-file').click();
$('#chat-file').onchange=async()=>{
  const f=$('#chat-file').files[0]; if(!f) return;
  if(f.size>10*1024*1024){ $('#chat-status').textContent='File terlalu besar (max 10MB)'; $('#chat-file').value=''; return; }
  $('#chat-status').textContent='Mengupload '+f.name+'...';
  try{
    const fd=new FormData(); fd.append('file',f);
    const r=await fetch('api/upload',{method:'POST',body:fd});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
    pendingAttach=j;
    $('#chat-status').textContent='📎 '+j.name+' siap dilampirkan — tulis pesan lalu kirim';
  }catch(e){ $('#chat-status').textContent='Upload gagal: '+e.message; }
  $('#chat-file').value='';
};
async function sendChat(){
  const inp=$('#chat-input'), text=inp.value.trim();
  if(!text&&!pendingAttach) return;
  const payload={message: text||('📎 '+pendingAttach.name), thread: S.chatThread};
  if(pendingAttach) payload.lampiran=pendingAttach.url;
  $('#chat-status').textContent='Mengirim...';
  try{
    await API.post('api/chat',payload);
    inp.value=''; pendingAttach=null; $('#chat-status').textContent='';
    await pollChat();
  }catch(e){ $('#chat-status').textContent='Gagal: '+e.message; }
}
$('#chat-send').onclick=sendChat;
$('#chat-input').addEventListener('keydown',e=>{ if(e.key==='Enter') sendChat(); });
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
    await fetchApprovals();
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
    const visSp=crowd.items.map((it,i)=>({it,i})).filter(o=>!crowd.hidden.has(o.i)).map(o=>o.it.sp);
    const hit=ray.intersectObjects(visSp,false)[0];
    if(hit){ const i=crowd.items.findIndex(it=>it.sp===hit.object);
      if(i>=0) hov=S.agents[i].id; }
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
  if(crowd){
    const visSp=crowd.items.map((it,i)=>({it,i})).filter(o=>!crowd.hidden.has(o.i)).map(o=>o.it.sp);
    const hit=ray.intersectObjects(visSp,false)[0];
    if(hit){ const i=crowd.items.findIndex(it=>it.sp===hit.object);
      if(i>=0){ const a=S.agents[i], zn=S.zones[a.division];
        showCard(a.id,a.desk.x,zn.top+2.15,a.desk.z); return; } }
    $('#agent-card').classList.add('hidden');
  } else $('#agent-card').classList.add('hidden');
});

// ---------- main loop ----------
const clockT=new THREE.Clock();
function loop(){
  requestAnimationFrame(loop);
  loop._n=(loop._n||0)+1;
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
  if(S.holo){ S.holo.rotation.y+=dt*0.9; S.holo.position.y+=Math.sin(t*2.2)*0.003; }
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
  // tiap tahap dibungkus: kalau ada yang throw, banner merah langsung tunjuk pelakunya
  const BOOT=[['buildZones',buildZones],['buildMeeting',buildMeeting],['buildFurniture',buildFurniture],['buildCrowd',buildCrowd],['initSocial',initSocial],['initSpecials',initSpecials],['buildDirectory',buildDirectory],['initMeetBubbles',initMeetBubbles]];
  for(const [nm,fn] of BOOT){ try{ fn(); }catch(e){ showFatal('BOOT '+nm+': '+(e&&e.message)+' | '+(e&&e.stack?e.stack.split('\n')[1]:'')); throw e; } }
  document.title='[boot] polling';
  await pollLive(); setInterval(pollLive,3000);
  await pollRhythm(); setInterval(pollRhythm,RHYTHM_POLL_MS); // ritme realtime WIB
  pollChat(); setInterval(pollChat,CHAT_POLL_MS); // chat Noir: polling 5 detik
  initVoice(); // mic dictation + TTS di pesan Noir
  fetchManagers(); // daftar manager per divisi untuk chat thread
  $('#goal-add').onclick=addGoal;
  fetchGoals(); setInterval(fetchGoals,30000); // target/progres: polling 30 detik
  loop();
  if(innerWidth<=760) setPanelCollapsed(true); // HP: panel mulai terlipat, buka via tombol 💬
  toast('Kantor AI v3 siap — 267 agent dalam 23 zona');
})();
