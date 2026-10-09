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

  // ===== PERINTAH =====
  const cmdSend = document.getElementById('cmd-send');
  if(cmdSend) cmdSend.addEventListener('click', sendCommand);
  const cmdText = document.getElementById('cmd-text');
  if(cmdText) cmdText.addEventListener('keydown', e=>{
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendCommand(); }
  });

  // ===== CHAT =====
  const chatSend = document.getElementById('chat-send');
  if(chatSend) chatSend.addEventListener('click', sendChat);
  const chatInput = document.getElementById('chat-input');
  if(chatInput) chatInput.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); sendChat(); }
  });
  const chatThread = document.getElementById('chat-thread');
  if(chatThread) chatThread.addEventListener('change', ()=>{ pollChat(); });

  // ===== GOALS =====
  const goalAdd = document.getElementById('goal-add');
  if(goalAdd) goalAdd.addEventListener('click', addGoal);

  // ===== DIREKTORI =====
  const btnDir = document.getElementById('btn-dir');
  if(btnDir) btnDir.addEventListener('click', toggleDirectory);

  // ===== NOTIFIKASI =====
  const btnBell = document.getElementById('btn-bell');
  if(btnBell) btnBell.addEventListener('click', toggleNotif);

  // load awal
  fetchManagers();
  pollChat();
  setInterval(pollChat, 3000);
  pollQueue();
  setInterval(pollQueue, 5000);
  
  console.log('UI 2D siap');
}

// ===== PERINTAH =====
async function sendCommand(){
  const ta = document.getElementById('cmd-text');
  const st = document.getElementById('cmd-status');
  const text = ta.value.trim();
  if(!text){ st.textContent = 'Tulis dulu perintahnya.'; return; }
  st.textContent = 'Mengirim...';
  try{
    await apiPost('api/commands', {text});
    ta.value = '';
    st.textContent = '✅ Perintah masuk antrean!';
    pollQueue();
    setTimeout(()=>st.textContent='', 3000);
  }catch(e){ st.textContent = 'Gagal: '+e.message; }
}

// ===== CHAT =====
let chatThread = 'noir';
async function fetchManagers(){
  try{
    const j = await apiGet('api/managers');
    const mgrs = j.managers || j;
    const sel = document.getElementById('chat-thread');
    if(!sel) return;
    sel.innerHTML = '<option value="noir">Noir (langsung)</option>';
    mgrs.forEach(m=>{
      const o = document.createElement('option');
      o.value = 'mgr:'+m.division;
      o.textContent = m.name+' ('+m.division+')';
      sel.appendChild(o);
    });
    sel.value = chatThread;
  }catch(e){ console.error('Gagal load managers:', e); }
}

async function sendChat(){
  const inp = document.getElementById('chat-input');
  const st = document.getElementById('chat-status');
  const sel = document.getElementById('chat-thread');
  const text = inp.value.trim();
  if(!text) return;
  const thread = sel ? sel.value : 'noir';
  st.textContent = 'Mengirim...';
  try{
    await apiPost('api/chat', {message: text, thread});
    inp.value = '';
    st.textContent = '';
    await pollChat();
  }catch(e){ st.textContent = 'Gagal: '+e.message; }
}

async function pollChat(){
  try{
    const sel = document.getElementById('chat-thread');
    const thread = sel ? sel.value : 'noir';
    const j = await apiGet('api/chat?thread='+encodeURIComponent(thread));
    const msgs = j.messages || j;
    renderChat(msgs);
  }catch(e){}
}

function renderChat(msgs){
  const box = document.getElementById('chat-list');
  if(!box) return;
  box.innerHTML = '';
  (msgs||[]).slice(-50).forEach(m=>{
    const d = document.createElement('div');
    d.className = 'chat-msg '+(m.from==='bos'?'from-bos':'from-other');
    d.innerHTML = '<b>'+escapeHtml(m.from)+':</b> '+escapeHtml(m.text||'');
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s){
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== ANTREAN =====
async function pollQueue(){
  try{
    const j = await apiGet('api/live');
    renderQueue(j.queue||[]);
    renderLog(j.activity||[]);
    renderApprovals();
    fetchGoals();
  }catch(e){}
}

function renderQueue(queue){
  const box = document.getElementById('queue-list');
  const badge = document.getElementById('queue-count');
  if(badge) badge.textContent = queue.length||'';
  if(!box) return;
  if(!queue.length){ box.innerHTML = '<div class="hint">Antrean kosong.</div>'; return; }
  box.innerHTML = queue.map(q=>
    '<div class="queue-item"><b>'+escapeHtml(q.id)+'</b><br>'+escapeHtml(q.text||'')+
    '<br><small>'+escapeHtml(q.status||'')+'</small></div>'
  ).join('');
}

// ===== APPROVAL =====
async function renderApprovals(){
  try{
    const list = await apiGet('api/approvals?status=menunggu');
    const box = document.getElementById('tab-appr');
    const badge = document.getElementById('appr-count');
    if(badge) badge.textContent = list.length||'';
    if(!box) return;
    let html = '<div id="appr-list">';
    if(!list.length) html += '<div class="hint">Tidak ada approval menunggu.</div>';
    list.forEach(a=>{
      html += '<div class="appr-item"><b>'+escapeHtml(a.title)+'</b><br>'+
        '<small>'+escapeHtml(a.kind)+' | '+escapeHtml(a.detail||'')+'</small><br>'+
        '<button onclick="decideApproval(\''+a.id+'\',true)">✅ Setuju</button> '+
        '<button onclick="decideApproval(\''+a.id+'\',false)">❌ Tolak</button></div>';
    });
    html += '</div>';
    // ganti isi tab approval (jaga struktur)
    const existing = box.querySelector('#appr-list');
    if(existing) existing.outerHTML = html;
    else box.innerHTML = html;
  }catch(e){}
}

async function decideApproval(id, setuju){
  try{
    await apiPost('api/approvals/'+id+'/putuskan', {setuju});
    renderApprovals();
  }catch(e){ alert('Gagal: '+e.message); }
}

// ===== GOALS =====
async function fetchGoals(){
  try{
    const goals = await apiGet('api/goals');
    renderGoals(goals);
  }catch(e){}
}

function renderGoals(goals){
  const box = document.getElementById('goal-list');
  if(!box) return;
  if(!goals || !goals.length){ box.innerHTML = '<div class="hint">Belum ada goals.</div>'; return; }
  box.innerHTML = goals.map(g=>
    '<div class="goal-item"><b>'+escapeHtml(g.title)+'</b>'+
    '<br><small>Progress: '+escapeHtml(String(g.progress||0))+'/'+escapeHtml(String(g.target||''))+'</small>'+
    ' <button onclick="updateGoalProgress(\''+g.id+'\')">＋</button></div>'
  ).join('');
}

async function addGoal(){
  const t = document.getElementById('goal-title');
  const tg = document.getElementById('goal-target');
  if(!t.value.trim()) return;
  try{
    await apiPost('api/goals', {title: t.value.trim(), target: tg.value.trim()});
    t.value = ''; tg.value = '';
    fetchGoals();
  }catch(e){ alert('Gagal: '+e.message); }
}

async function updateGoalProgress(id){
  try{
    await apiPost('api/goals/'+id+'/progress', {increment: 1});
    fetchGoals();
  }catch(e){}
}

// ===== LOG =====
function renderLog(activity){
  const box = document.getElementById('log-list');
  if(!box) return;
  if(!activity.length){ box.innerHTML = '<div class="hint">Belum ada aktivitas.</div>'; return; }
  box.innerHTML = activity.slice(-30).reverse().map(a=>
    '<div class="log-item"><small>'+escapeHtml(a.ts||'')+'</small> <b>'+escapeHtml(a.agent_id||'')+'</b>: '+escapeHtml(a.detail||'')+'</div>'
  ).join('');
}

// ===== DIREKTORI =====
function toggleDirectory(){
  let drawer = document.getElementById('drawer');
  if(!drawer){
    drawer = document.createElement('div');
    drawer.id = 'drawer';
    drawer.innerHTML = '<div class="drawer-head"><b>Direktori Agent</b> <button onclick="document.getElementById(\'drawer\').classList.add(\'hidden\')">✕</button></div><div id="dir-list"></div>';
    document.body.appendChild(drawer);
  }
  drawer.classList.toggle('hidden');
  if(!drawer.classList.contains('hidden')) buildDirectory();
}

function buildDirectory(){
  const box = document.getElementById('dir-list');
  if(!box) return;
  const byDiv = {};
  App2D.agents.forEach(a=>{
    if(a.id==='bos') return;
    const d = a.division||'lainnya';
    if(!byDiv[d]) byDiv[d] = [];
    byDiv[d].push(a);
  });
  box.innerHTML = Object.keys(byDiv).sort().map(d=>
    '<div class="dir-div"><b>'+escapeHtml(d)+' ('+byDiv[d].length+')</b><br>'+
    byDiv[d].slice(0,10).map(a=>'<small>'+escapeHtml(a.name||a.id)+'</small>').join(', ')+
    (byDiv[d].length>10 ? ' <small>... +'+(byDiv[d].length-10)+'</small>' : '')+'</div>'
  ).join('');
}

// ===== NOTIFIKASI =====
function toggleNotif(){
  let panel = document.getElementById('notif-panel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.className = 'hidden';
    panel.innerHTML = '<div class="drawer-head"><b>Notifikasi</b> <button onclick="document.getElementById(\'notif-panel\').classList.add(\'hidden\')">✕</button></div><div id="notif-list"><div class="hint">Belum ada notifikasi.</div></div>';
    document.body.appendChild(panel);
  }
  panel.classList.toggle('hidden');
}

function setupCamera(){
  const cv = document.getElementById('iso-canvas');
  let drag = null;
  let downPos = null;
  cv.addEventListener('pointerdown', e=>{ 
    drag={x:e.clientX,y:e.clientY}; 
    downPos={x:e.clientX,y:e.clientY};
    cv.setPointerCapture(e.pointerId); 
  });
  cv.addEventListener('pointermove', e=>{ 
    if(drag){ 
      IsoRender.pan(e.clientX-drag.x, e.clientY-drag.y); 
      drag={x:e.clientX,y:e.clientY}; 
    } 
  });
  cv.addEventListener('pointerup', e=>{
    // klik (bukan drag) -> cari agent terdekat
    if(downPos && Math.hypot(e.clientX-downPos.x, e.clientY-downPos.y) < 8){
      handleAgentClick(e);
    }
    drag=null; downPos=null;
  });
  cv.addEventListener('wheel', e=>{ e.preventDefault(); IsoRender.setZoom(IsoRender.zoom * (e.deltaY<0?1.1:0.9)); }, {passive:false});
}

function handleAgentClick(e){
  const cv = document.getElementById('iso-canvas');
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  
  // cari agent terdekat dalam 40px
  let best = null, bestDist = 40;
  for(const a of App2D.agents){
    if(a._gx===undefined) continue;
    const [sx, sy] = isoP(a._gx+0.5, a._gy+0.5);
    // isoP mengembalikan koordinat world, perlu dikurangi offset kamera
    // sebenarnya isoP sudah termasuk OX/OY, jadi langsung bandingkan
    const d = Math.hypot(sx-mx, sy-my);
    if(d < bestDist){ bestDist = d; best = a; }
  }
  if(best) showAgentCard(best);
  else hideAgentCard();
}

function showAgentCard(a){
  let card = document.getElementById('agent-card');
  if(!card){
    card = document.createElement('div');
    card.id = 'agent-card';
    document.body.appendChild(card);
  }
  const lv = App2D.live[a.id];
  const status = lv ? lv.status : 'idle';
  const detail = lv ? (lv.detail||'') : '';
  card.innerHTML = '<div class="card-head"><b>'+escapeHtml(a.name||a.id)+'</b>'+
    ' <button onclick="hideAgentCard()">✕</button></div>'+
    '<div><small>ID: '+escapeHtml(a.id)+'</small></div>'+
    '<div><small>Divisi: '+escapeHtml(a.division||'-')+'</small></div>'+
    '<div>Status: <b style="color:'+statusColor(status)+'">'+escapeHtml(status)+'</b></div>'+
    (detail ? '<div><small>'+escapeHtml(detail)+'</small></div>' : '')+
    (a.desc ? '<div><small>'+escapeHtml(a.desc)+'</small></div>' : '');
  card.classList.remove('hidden');
}

function hideAgentCard(){
  const card = document.getElementById('agent-card');
  if(card) card.classList.add('hidden');
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
