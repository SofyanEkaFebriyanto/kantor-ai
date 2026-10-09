// ==================== APP 2D: Kantor AI versi isometric pixel-art ====================
// Menggunakan asset Sofyan (static/assets/). Backend API sama dengan v3.

const App2D = {
  agents: [],      // dari /api/agents
  divisions: [],
  live: {},        // dari /api/live
  selected: null,
};

async function apiGet(path){
  const r = await fetch(path);
  return r.json();
}
async function apiPost(path, data){
  const r = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
  return r.json();
}

// --- inisialisasi ---
async function init2D(){
  await IsoRender.init('iso-canvas');
  
  // langsung mulai render loop (scene statis tampil dulu)
  requestAnimationFrame(loop2D);
  
  // load data agent async
  try{
    const [ag, div] = await Promise.all([
      apiGet('api/agents'),
      apiGet('api/divisions'),
    ]);
    App2D.agents = ag;
    App2D.divisions = div;
    placeAgents();
  }catch(e){ console.error('Gagal load agents:', e); }
  
  // UI
  setupUI();
  setupCamera();
  
  // polling
  pollLive2D();
  setInterval(pollLive2D, 5000);
}

function placeAgents(){
  // hitung posisi per divisi di grid
  const perDiv = {};
  for(const a of App2D.agents){
    const div = a.division || 'engineering';
    if(!perDiv[div]) perDiv[div] = 0;
    const g = ISO_GRID[div] || ISO_GRID['engineering'];
    const idx = perDiv[div]++;
    // susun dalam grid di dalam zona
    const cols = Math.max(1, Math.floor(Math.sqrt(g.gw * g.gd / 2)));
    const gx = g.gx + 1 + (idx % cols) % (g.gw - 2);
    const gy = g.gy + 1 + Math.floor(idx / cols) % (g.gd - 2);
    a._gx = gx; a._gy = gy;
    a._char = isoCharFor(a);
    a._col = 0; a._row = 0;
  }
  // Bos di lobby
  const bos = {_gx: 10, _gy: 30, _char: 'sofyan_owner', _col: 0, _row: 0, id: 'bos', name: 'Sofyan'};
  App2D.agents.push(bos);
}

function pollLive2D(){
  apiGet('api/live').then(j=>{
    App2D.live = j.live || {};
    updateAgentVisuals();
  }).catch(()=>{});
}

function updateAgentVisuals(){
  const list = [];
  const now = Date.now();
  for(const a of App2D.agents){
    const lv = App2D.live[a.id];
    const status = lv ? lv.status : 'idle';
    
    // Inisialisasi state jalan
    if(a._tx === undefined){
      a._tx = a._gx; a._ty = a._gy;
      a._speed = 0.05 + Math.random()*0.05;
      a._phase = Math.random()*1000;
      // Langsung kasih target biar langsung jalan (untuk test)
      const g0 = ISO_GRID[a.division] || {gx: a._gx-2, gy: a._gy-2, gw: 5, gd: 5};
      a._tx = g0.gx + 1 + Math.random() * Math.max(1, g0.gw-2);
      a._ty = g0.gy + 1 + Math.random() * Math.max(1, g0.gd-2);
    }
    
    // Gerakan: jalan ke target
    const dx = a._tx - a._gx, dy = a._ty - a._gy;
    const dist = Math.hypot(dx, dy);
    let moving = false;
    if(dist > 0.15){
      moving = true;
      a._gx += (dx/dist) * a._speed;
      a._gy += (dy/dist) * a._speed;
    } else {
      // Sudah sampai, langsung pilih target baru (jangan diem lama)
      const g = ISO_GRID[a.division] || {gx: a._gx-2, gy: a._gy-2, gw: 5, gd: 5};
      a._tx = g.gx + 1 + Math.random() * Math.max(1, g.gw-2);
      a._ty = g.gy + 1 + Math.random() * Math.max(1, g.gd-2);
    }
    
    // Frame animasi: sprite 6x4
    // Row 0: idle, Row 1-3: jalan/kerja
    let col, row;
    if(moving){
      // Jalan: cycle cepat row 1
      col = Math.floor(now/150 + a._phase) % 6;
      row = 1;
    } else if(status === 'working'){
      // Kerja: cycle sedang row 0 (ngetik/aktif)
      col = Math.floor(now/300 + a._phase) % 6;
      row = 0;
    } else {
      // Idle: napas pelan (col 0-1)
      col = Math.floor(now/800 + a._phase) % 2;
      row = 0;
    }
    
    // Khusus sholat
    if(status === 'sholat'){ 
      a._char = 'jamaah_pria_peci';
      col = 0; row = 0;
    }
    
    list.push({
      id: a.id,
      gx: a._gx, gy: a._gy,
      char: a._char, col, row,
      label: a.name || a.id,
      statusColor: statusColor(status),
    });
  }
  IsoRender.setAgents(list);
}

function statusColor(s){
  return {working:'#4caf50', reading:'#2196f3', running:'#ff9800',
          idle:'#9e9e9e', waiting:'#e91e63', done:'#8bc34a', sholat:'#9d4edd'}[s] || '#9e9e9e';
}

function loop2D(){
  IsoRender.frame();
  // update animasi tiap frame untuk yang working
  updateAgentVisuals();
  requestAnimationFrame(loop2D);
}

function setupUI(){
  // tab switching
  document.querySelectorAll('.tab[data-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab[data-tab]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-body').forEach(p=>p.classList.add('hidden'));
      const body = document.getElementById('tab-'+tab);
      if(body) body.classList.remove('hidden');
    });
  });
  
  // jam
  setInterval(()=>{
    const el = document.getElementById('clock');
    if(el) el.textContent = new Date().toLocaleTimeString('id-ID', {timeZone:'Asia/Jakarta'});
  }, 1000);
  
  // tombol home (reset kamera)
  const btnHome = document.getElementById('btn-home');
  if(btnHome) btnHome.addEventListener('click', ()=>{ IsoRender.centerCamera(); });
  
  // panel close
  const panelClose = document.getElementById('panel-close');
  if(panelClose) panelClose.addEventListener('click', ()=>{
    document.getElementById('panel').classList.add('hidden');
  });
  
  console.log('UI 2D siap');
}

function setupCamera(){
  const cv = document.getElementById('iso-canvas');
  let drag = null;
  cv.addEventListener('pointerdown', e=>{ drag={x:e.clientX,y:e.clientY}; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e=>{ if(drag){ IsoRender.pan(e.clientX-drag.x, e.clientY-drag.y); drag={x:e.clientX,y:e.clientY}; } });
  cv.addEventListener('pointerup', ()=>drag=null);
  cv.addEventListener('wheel', e=>{ e.preventDefault(); IsoRender.setZoom(IsoRender.zoom * (e.deltaY<0?1.1:0.9)); }, {passive:false});
  
  // klik agent untuk detail
  cv.addEventListener('click', e=>{
    // TODO: raycast ke agent
  });
}

// start
async function start2D(){
  try{
    if(typeof IsoRender === 'undefined') throw new Error('IsoRender tidak dimuat');
    if(typeof ISO_GRID === 'undefined') throw new Error('ISO_GRID tidak dimuat');
    await init2D();
  }catch(e){
    console.error('App2D gagal:', e);
    const hud = document.querySelector('.brand');
    if(hud) hud.innerHTML += ' <span style="color:red">ERROR: '+e.message+'</span>';
  }
}
if(document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start2D);
else
  start2D();
