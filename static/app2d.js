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
  
  // load data
  const [ag, div] = await Promise.all([
    apiGet('api/agents'),
    apiGet('api/divisions'),
  ]);
  App2D.agents = ag;
  App2D.divisions = div;
  
  // tempatkan agent di grid (berdasarkan divisi)
  placeAgents();
  
  // UI
  setupUI();
  setupCamera();
  
  // polling
  pollLive2D();
  setInterval(pollLive2D, 5000);
  
  // render loop
  requestAnimationFrame(loop2D);
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
  const bos = {_gx: 10, _gy: 30, _char: 'aldy_owner', _col: 0, _row: 0, id: 'bos', name: 'Bos'};
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
  for(const a of App2D.agents){
    const lv = App2D.live[a.id];
    const status = lv ? lv.status : 'idle';
    // frame animasi berdasarkan status
    let col = 0, row = 0;
    if(status === 'working'){ col = Math.floor(Date.now()/300)%3; row = 0; }
    else if(status === 'sholat'){ col = 0; row = 0; a._char = 'jamaah_pria_peci'; }
    
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
  // TODO: panel chat, commands, dll — reuse dari app.js
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
