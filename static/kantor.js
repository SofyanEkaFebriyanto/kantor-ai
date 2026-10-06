'use strict';
/* kantor-ai v2 — karakter full-body berinteraksi di ruangan kantor.
   Sprite 2-frame (stand/walk), background kantor malam, kamera geser. */

const TOKEN = new URLSearchParams(location.search).get('token') || '';

const AGENTS = [
  { name: 'Bagas', role: 'Project Manager',  color: '#f0a832' },
  { name: 'Dimas', role: 'Backend Developer', color: '#5ad08a' },
  { name: 'Putri', role: 'Frontend Developer',color: '#e06ba8' },
  { name: 'Eko',   role: 'QA Engineer',      color: '#c9a0ff' },
  { name: 'Intan', role: 'Researcher',       color: '#5ac8e0' },
];
const SPR = {};
for (const a of AGENTS) {
  SPR[a.name] = {
    stand: Object.assign(new Image(), { src: '/static/sprites/' + a.name.toLowerCase() + '-stand.png' }),
    walk:  Object.assign(new Image(), { src: '/static/sprites/' + a.name.toLowerCase() + '-walk.png' }),
  };
}
const BG = Object.assign(new Image(), { src: '/static/sprites/office-bg.png' });

/* virtual room 1600x900 */
const VW = 1600, VH = 900;
const DESKS = [312, 520, 723, 926, 1129].map(x => ({ x, y: 668 }));
const PANTRY = { x: 120, y: 730 };
const SOFA = { x: 1470, y: 712 };
const FLOOR_Y0 = 660, FLOOR_Y1 = 800;

const S = {
  feed: [], tasks: [], lastId: 0, first: true,
  selected: null, busy: false, followX: null, lastDrag: 0,
};
const agents = AGENTS.map((def, i) => ({
  def,
  desk: DESKS[i],
  x: DESKS[i].x + (Math.random() * 120 - 60),
  y: 700 + Math.random() * 60,
  tx: null, ty: null,            // target jalan
  mode: 'idle',                 // idle | walk | work
  st: 'idle',                   // status API: idle | working
  task: '',
  facing: 1,
  walkT: Math.random(),
  bubble: null,                 // {text, until, born}
  phase: Math.random() * 6.28,
  popUntil: 0,
}));

const scaleAt = y => 0.36 + (y - 640) * 0.0016;

/* ---------- canvas & kamera ---------- */
const cv = document.getElementById('scene');
const ctx = cv.getContext('2d');
let CW = 0, CH = 0, K = 1, camX = VW / 2;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  CW = cv.clientWidth; CH = cv.clientHeight;
  cv.width = CW * dpr; cv.height = CH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  K = CH / VH; // fit tinggi; lebar viewport mengikuti
}
window.addEventListener('resize', resize); resize();
const visW = () => CW / K;
const camLeft = () => camX - visW() / 2;
const X = vx => (vx - camLeft()) * K, Y = vy => vy * K;
function clampCam() {
  const w = visW();
  camX = w >= VW ? VW / 2 : Math.max(w / 2, Math.min(VW - w / 2, camX));
}

/* ---------- helpers ---------- */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(text, maxW) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
const $ = id => document.getElementById(id);

/* ---------- gambar karakter ---------- */
function drawAgent(a, t) {
  const s = scaleAt(a.y);
  const w = 400 * s, h = 600 * s;
  const walking = a.mode === 'walk';
  const frame = walking ? (Math.floor(a.walkT / 0.16) % 2 ? SPR[a.def.name].walk : SPR[a.def.name].stand)
                        : SPR[a.def.name].stand;
  let bob = 0;
  if (walking) bob = Math.abs(Math.sin(a.walkT * 19)) * -6 * s / 0.5;
  else if (a.mode === 'work') bob = Math.sin(t * 9 + a.phase) * -2.2;
  else bob = Math.sin(t * 1.7 + a.phase) * 3;

  const fx = X(a.x), fy = Y(a.y + bob);
  // bayangan kaki
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(X(a.x), Y(a.y) + 4 * K, 52 * s * K / 0.5 * 0.5, 12 * s * K / 0.5 * 0.5, 0, 0, 6.29); ctx.fill();

  const img = (frame.complete && frame.naturalWidth) ? frame : SPR[a.def.name].stand;
  ctx.save();
  ctx.translate(fx, 0);
  ctx.scale(a.facing * K, K);
  if (S.selected === a.def.name) { ctx.shadowColor = a.def.color; ctx.shadowBlur = 26; }
  const dw = 400 * s, dh = 600 * s;
  if (img.complete && img.naturalWidth) ctx.drawImage(img, -dw / 2, fy / K - dh, dw, dh);
  ctx.restore();
  ctx.shadowBlur = 0;

  if (S.selected === a.def.name) {
    ctx.strokeStyle = a.def.color; ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]); ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.ellipse(X(a.x), Y(a.y) + 4 * K, 62 * s, 16 * s, 0, 0, 6.29); ctx.stroke();
    ctx.setLineDash([]);
  }
  a._headY = a.y + bob - 600 * s + 30 * s; // virtual
  a._s = s;
}
function drawTag(a) {
  const s = a._s || 0.45;
  const dot = a.st === 'working' ? '#2fe07a' : '#5b6376';
  const status = a.st === 'working' ? 'KERJA' + (a.task ? ': ' + trunc(a.task, 24) : '…') : 'SANTAI';
  ctx.font = '700 14px system-ui,sans-serif';
  const nameW = ctx.measureText(a.def.name).width;
  ctx.font = '500 12.5px system-ui,sans-serif';
  const stW = ctx.measureText(status).width;
  const pw = nameW + stW + 40, ph = 30;
  const px = X(a.x) - pw / 2, py = Y(a._headY) - 14 - ph;
  ctx.fillStyle = 'rgba(8,12,24,.88)';
  rr(px, py, pw, ph, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
  rr(px, py, pw, ph, 8); ctx.stroke();
  ctx.fillStyle = dot;
  ctx.beginPath(); ctx.arc(px + 13, py + ph / 2, 5, 0, 6.29); ctx.fill();
  ctx.fillStyle = a.def.color; ctx.font = '700 14px system-ui,sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.def.name, px + 22, py + ph / 2 + 1);
  ctx.fillStyle = '#aab3c8'; ctx.font = '500 12.5px system-ui,sans-serif';
  ctx.fillText(status, px + 22 + nameW + 7, py + ph / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}
function drawBubble(a) {
  const b = a.bubble;
  if (!b) return;
  const now = performance.now();
  if (now > b.until) { a.bubble = null; return; }
  const fade = Math.min(1, (b.until - now) / 900);
  const grow = Math.min(1, (now - b.born) / 260);
  const sc = .6 + .4 * (1 - Math.pow(1 - grow, 3));
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = '400 13.5px system-ui,sans-serif';
  const lines = wrapText(b.text, 250);
  if (!lines.length) lines.push('…');
  const w = Math.min(280, Math.max(...lines.map(l => ctx.measureText(l).width)) + 28);
  const h = lines.length * 19 + 20;
  const sx = X(a.x);
  const bx = Math.max(8, Math.min(CW - w - 8, sx - w / 2));
  const by = Y(a._headY) - 52 - h;
  ctx.translate(bx + w / 2, by + h); ctx.scale(sc, sc); ctx.translate(-(bx + w / 2), -(by + h));
  ctx.fillStyle = '#f4f6ff';
  rr(bx, by, w, h, 12); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bx + w / 2 - 9, by + h - 1); ctx.lineTo(bx + w / 2 + 9, by + h - 1);
  ctx.lineTo(sx, by + h + 15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#141a2a'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 14, by + 10 + i * 19));
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

/* ---------- frame ---------- */
function frame() {
  const t = performance.now() / 1000;
  clampCam();
  ctx.clearRect(0, 0, CW, CH);
  if (BG.complete && BG.naturalWidth) {
    // bg 2048x1152 -> penuhi virtual 1600x900 (cover)
    const bs = Math.max(VW / BG.naturalWidth, VH / BG.naturalHeight);
    const bw = BG.naturalWidth * bs, bh = BG.naturalHeight * bs;
    ctx.drawImage(BG, X((VW - bw) / 2), Y((VH - bh) / 2), bw * K, bh * K);
  } else {
    ctx.fillStyle = '#0a1030'; ctx.fillRect(0, 0, CW, CH);
  }
  const order = [...agents].sort((p, q) => p.y - q.y);
  for (const a of order) drawAgent(a, t);
  for (const a of order) drawTag(a);
  for (const a of order) drawBubble(a);
  requestAnimationFrame(frame);
}

/* ---------- gerak & perilaku ---------- */
function step(dt) {
  for (const a of agents) {
    if (a.mode === 'walk' && a.tx !== null) {
      const dx = a.tx - a.x, dy = (a.ty - a.y);
      const d = Math.hypot(dx, dy);
      const sp = 115 * dt;
      if (d < Math.max(6, sp)) { a.x = a.tx; a.y = a.ty; a.tx = null; a.mode = a.st === 'working' ? 'work' : 'idle'; }
      else {
        a.x += dx / d * sp; a.y += dy / d * sp;
        a.walkT += dt;
        if (Math.abs(dx) > 4) a.facing = dx > 0 ? 1 : -1;
      }
    }
  }
  // kamera ngikutin
  const now = performance.now();
  if (S.followX !== null && now - S.lastDrag > 12000) {
    camX += (S.followX - camX) * Math.min(1, dt * 2.2);
    if (Math.abs(S.followX - camX) < 2) S.followX = null;
  }
  clampCam();
}
let lastStep = performance.now();
setInterval(() => {
  const now = performance.now();
  step((now - lastStep) / 1000);
  lastStep = now;
}, 33);

function walkTo(a, x, y) { a.tx = x; a.ty = y; a.mode = 'walk'; }
function syncBehavior() {
  for (const a of agents) {
    if (a.st === 'working') {
      const d = Math.hypot(a.desk.x - a.x, a.desk.y - a.y);
      if (d > 26 && a.mode !== 'walk') walkTo(a, a.desk.x + (Math.random() * 30 - 15), a.desk.y);
      else if (d <= 26) { a.mode = 'work'; a.tx = null; a.facing = 1; }
    } else if (a.mode === 'work') {
      a.mode = 'idle'; // selesai kerja -> santai
    }
  }
}
setInterval(() => {
  // tiap 2.5 dtk: yang idle kadang jalan-jalan
  for (const a of agents) {
    if (a.st === 'working' || a.mode === 'walk') continue;
    if (Math.random() < 0.34) {
      const opts = [PANTRY, SOFA,
        { x: 200 + Math.random() * 1200, y: FLOOR_Y0 + 20 + Math.random() * (FLOOR_Y1 - FLOOR_Y0 - 20) }];
      const p = opts[(Math.random() * opts.length) | 0];
      walkTo(a, p.x + (Math.random() * 40 - 20), p.y);
    } else if (Math.random() < 0.07 && !a.bubble) {
      const emotes = ['☕', '💤', '🎧', '🌙'];
      a.bubble = { text: emotes[(Math.random() * emotes.length) | 0], until: performance.now() + 3500, born: performance.now() };
    }
  }
  // sapa kalau berdekatan
  for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
    const p = agents[i], q = agents[j];
    if (p.mode === 'idle' && q.mode === 'idle' && !p.bubble && !q.bubble &&
        Math.hypot(p.x - q.x, p.y - q.y) < 130 && Math.random() < 0.25) {
      p.bubble = { text: '👋', until: performance.now() + 3000, born: performance.now() };
    }
  }
}, 2500);

/* ---------- interaksi: tap vs geser ---------- */
let pdown = null;
cv.addEventListener('pointerdown', e => { pdown = { x: e.clientX, y: e.clientY, cam: camX, moved: false }; });
cv.addEventListener('pointermove', e => {
  if (!pdown) return;
  const dx = e.clientX - pdown.x;
  if (Math.abs(dx) > 8) pdown.moved = true;
  if (pdown.moved) { camX = pdown.cam - dx / K; S.lastDrag = performance.now(); S.followX = null; clampCam(); }
});
cv.addEventListener('pointerup', e => {
  if (!pdown) return;
  const wasDrag = pdown.moved;
  pdown = null;
  if (wasDrag) return;
  const r = cv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  let hit = null, best = 1e9;
  for (const a of agents) {
    const s = scaleAt(a.y);
    const hx = X(a.x), hy = Y(a.y - 300 * s);
    const d = Math.hypot(mx - hx, my - hy);
    if (d < 90 * K * s + 30 && d < best) { best = d; hit = a; }
  }
  select(hit ? hit.def.name : null);
});

/* ---------- sidebar ---------- */
function setTab(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + name));
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('sideToggle').addEventListener('click', () => $('side').classList.toggle('hidden'));

function select(name) {
  S.selected = name;
  if (name) {
    const a = agents.find(x => x.def.name === name);
    if (a) S.followX = a.x;
  }
  renderCrewCard(); renderCrew();
}
function msgHTML(m) {
  const d = new Date(m.ts * 1000);
  const ts = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const av = SPR[m.sender] ? `<img class="mav" src="/static/avatars/${m.sender.toLowerCase()}.png" alt="">` : '';
  return `<div class="msg s-${esc(m.sender)}${m.kind === 'task' ? ' task' : ''}${m.kind === 'system' ? ' system' : ''}">` +
    `${av}<div class="mbody"><div class="mwho">${esc(m.sender)}<span class="ts">${ts}</span></div>` +
    `<div class="mtxt">${esc(m.text)}</div></div></div>`;
}
function renderFeed() {
  const el = $('feed');
  el.innerHTML = S.feed.slice(-80).map(msgHTML).join('');
  el.scrollTop = el.scrollHeight;
}
function renderTasks() {
  const cols = { backlog: $('b_backlog'), doing: $('b_doing'), done: $('b_done') };
  for (const k of Object.keys(cols)) {
    const list = S.tasks.filter(x => x.status === k);
    cols[k].innerHTML = list.length ? list.map(x =>
      `<div class="task${x.status === 'doing' ? ' doing' : ''}${x.status === 'done' ? ' done' : ''}">` +
      `#${x.id} ${esc(x.title)}<small>${esc(x.assignee)} · ${esc(x.created_by || '')}</small></div>`).join('')
      : '<div class="empty">—</div>';
  }
}
function renderCrew() {
  $('crewlist').innerHTML = AGENTS.map(a => {
    const st = agents.find(x => x.def.name === a.name);
    const working = st.st === 'working';
    return `<div class="crewrow${S.selected === a.name ? ' sel' : ''}" data-name="${a.name}">` +
      `<img src="/static/avatars/${a.name.toLowerCase()}.png" alt=""><div><div class="cnm">${a.name}</div>` +
      `<div class="crl">${a.role}</div></div>` +
      `<div class="cst"><span class="dot ${working ? 'working' : 'idle'}"></span>${working ? 'kerja' : 'santai'}</div></div>`;
  }).join('');
  document.querySelectorAll('.crewrow').forEach(r =>
    r.addEventListener('click', () => select(r.dataset.name)));
}
function renderCrewCard() {
  const card = $('crewcard');
  if (!S.selected) { card.classList.remove('on'); card.innerHTML = ''; return; }
  const a = agents.find(x => x.def.name === S.selected);
  const msgs = S.feed.filter(m => m.sender === a.def.name).slice(-3).reverse();
  card.innerHTML =
    `<div class="chead"><img src="/static/avatars/${a.def.name.toLowerCase()}.png" alt="">` +
    `<div><div class="cname" style="color:${a.def.color}">${a.def.name}</div><div class="crole">${a.def.role}</div></div></div>` +
    `<div class="cstatus"><b>Status:</b> ${a.st === 'working' ? '🟢 lagi kerja' : '⚪ santai'}` +
    (a.task ? `<br><b>Task:</b> ${esc(a.task)}` : '') + `</div>` +
    (msgs.length ? `<div class="cmsgs">${msgs.map(m => `<div class="cmsg"><b>${esc(m.sender)}:</b> ${esc(trunc(m.text, 110))}</div>`).join('')}</div>` : '') +
    `<button class="cclose" id="ccclose">Tutup</button>`;
  card.classList.add('on');
  $('ccclose').addEventListener('click', () => select(null));
}

/* ---------- api ---------- */
function api(p, opts) {
  const sep = p.includes('?') ? '&' : '?';
  opts = opts || {};
  opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN }, opts.headers || {});
  return fetch(p + sep + 'token=' + encodeURIComponent(TOKEN), opts);
}
function say(a, text, ms) {
  a.bubble = { text: trunc(text, 150), until: performance.now() + (ms || 7000), born: performance.now() };
  a.popUntil = performance.now() + 600;
  S.followX = a.x;
}
async function poll() {
  if (S.busy) return;
  S.busy = true;
  try {
    const r = await api('/api/messages?since=' + S.lastId);
    if (r.status === 401) { location.href = '/'; return; }
    const j = await r.json();
    for (const m of (j.messages || [])) {
      S.feed.push(m);
      if (m.id > S.lastId) S.lastId = m.id;
      const a = agents.find(x => x.def.name === m.sender);
      if (a && !S.first) say(a, m.text);
    }
    if (j.messages && j.messages.length) renderFeed();
    const t = await (await api('/api/tasks')).json();
    S.tasks = t.tasks || [];
    renderTasks();
    const g = await (await api('/api/agents')).json();
    for (const x of (g.agents || [])) {
      const a = agents.find(v => v.def.name === x.agent);
      if (!a) continue;
      a.st = x.state === 'working' ? 'working' : 'idle';
      a.task = x.current_task || '';
    }
    syncBehavior();
    renderCrew();
    if (S.selected) renderCrewCard();
    S.first = false;
  } catch (e) { /* diam: coba lagi next tick */ }
  S.busy = false;
}
async function sendBos() {
  const inp = $('bosin'), v = inp.value.trim();
  if (!v) return;
  inp.value = '';
  try {
    await api('/api/boss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: v }) });
  } catch (e) {}
  setTimeout(poll, 600);
}
$('bossend').addEventListener('click', sendBos);
$('bosin').addEventListener('keydown', e => { if (e.key === 'Enter') sendBos(); });

/* ---------- go ---------- */
setInterval(() => { $('clock').textContent = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }, 1000);
setInterval(poll, 4000);
renderCrew();
poll();
requestAnimationFrame(frame);
