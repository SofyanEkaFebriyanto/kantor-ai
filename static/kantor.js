'use strict';
/* kantor-ai — "kantor malam" living scene.
   Canvas 2.5D: langit malam di balik dinding kaca, 5 meja, avatar agent,
   name tag + status live, speech bubble, klik agent = kartu kru. */

const TOKEN = new URLSearchParams(location.search).get('token') || '';

const AGENTS = [
  { name: 'Bagas', role: 'Project Manager',  color: '#f0a832', img: 'bagas.png' },
  { name: 'Dimas', role: 'Backend Developer', color: '#5ad08a', img: 'dimas.png' },
  { name: 'Putri', role: 'Frontend Developer',color: '#e06ba8', img: 'putri.png' },
  { name: 'Eko',   role: 'QA Engineer',      color: '#c9a0ff', img: 'eko.png'   },
  { name: 'Intan', role: 'Researcher',       color: '#5ac8e0', img: 'intan.png' },
];
const IMG = {};
for (const a of AGENTS) { const im = new Image(); im.src = '/static/avatars/' + a.img; IMG[a.name] = im; }

/* virtual stage 1600x900 */
const VW = 1600, VH = 900;
const DESK_X = [180, 490, 800, 1110, 1420];
const DESK_Y = 700;

const S = {
  agents: {},       // name -> {def, st, task, bubble:{text,until,born}, phase}
  feed: [],         // pesan cache
  tasks: [],
  lastId: 0, first: true, selected: null, busy: false,
};
for (const a of AGENTS) S.agents[a.name] = { def: a, st: 'idle', task: '', bubble: null, phase: Math.random() * 6.28 };

/* ---------- seeded rng (bintang & kota stabil) ---------- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const STARS = [];
for (let i = 0; i < 140; i++) STARS.push({ x: rnd() * VW, y: rnd() * 400, r: .5 + rnd() * 1.4, tw: rnd() * 6.28 });
const WINDOWS = [];
for (let i = 0; i < 90; i++) WINDOWS.push({ x: rnd() * VW, y: 398 + rnd() * 58, w: 2 + rnd() * 4, h: 2 + rnd() * 5, warm: rnd() > .3, a: .35 + rnd() * .5 });
const DUST = [];
for (let i = 0; i < 46; i++) DUST.push({ x: rnd() * VW, y: 480 + rnd() * 400, vx: 4 + rnd() * 10, vy: -3 - rnd() * 6, r: 1 + rnd() * 2, a: .04 + rnd() * .08 });

/* ---------- canvas ---------- */
const cv = document.getElementById('scene');
const ctx = cv.getContext('2d');
let CW = 0, CH = 0, K = 1, OX = 0, OY = 0; // scale & offset virtual->screen
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  CW = cv.clientWidth; CH = cv.clientHeight;
  cv.width = CW * dpr; cv.height = CH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  K = Math.max(CW / VW, CH / VH);
  OX = (CW - VW * K) / 2; OY = (CH - VH * K) / 2;
}
window.addEventListener('resize', resize); resize();
const X = vx => OX + vx * K, Y = vy => OY + vy * K;

/* ---------- helpers ---------- */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
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

/* ---------- scene layers ---------- */
function drawSky(t) {
  const g = ctx.createLinearGradient(0, 0, 0, 492);
  g.addColorStop(0, '#05081a'); g.addColorStop(.55, '#0d1740'); g.addColorStop(1, '#23336e');
  ctx.fillStyle = g; ctx.fillRect(X(0), Y(0), VW * K, 492 * K);
  // bintang
  for (const s of STARS) {
    ctx.globalAlpha = .25 + .55 * Math.abs(Math.sin(t * .7 + s.tw));
    ctx.fillStyle = '#dfe8ff';
    ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), s.r * K, 0, 6.29); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // bulan + glow
  const mx = X(1340), my = Y(110), mr = 46 * K;
  const glow = ctx.createRadialGradient(mx, my, mr * .4, mx, my, mr * 3.2);
  glow.addColorStop(0, 'rgba(244,241,222,.28)'); glow.addColorStop(1, 'rgba(244,241,222,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#f2eeda';
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.29); ctx.fill();
  ctx.fillStyle = 'rgba(160,160,150,.18)';
  ctx.beginPath(); ctx.arc(mx - mr * .3, my - mr * .2, mr * .22, 0, 6.29); ctx.fill();
  ctx.beginPath(); ctx.arc(mx + mr * .25, my + mr * .3, mr * .15, 0, 6.29); ctx.fill();
  // siluet kota
  ctx.fillStyle = '#04060f';
  ctx.fillRect(X(0), Y(398), VW * K, 94 * K);
  for (const w of WINDOWS) {
    ctx.globalAlpha = w.a;
    ctx.fillStyle = w.warm ? '#ffd27a' : '#9fd8ff';
    ctx.fillRect(X(w.x), Y(w.y), Math.max(1.5, w.w * K), Math.max(1.5, w.h * K));
  }
  ctx.globalAlpha = 1;
  // bokeh lampu jauh
  for (let i = 0; i < 14; i++) {
    const bx = ((i * 397) % VW), by = 300 + ((i * 211) % 150);
    ctx.globalAlpha = .05;
    ctx.fillStyle = '#ffd9a0';
    ctx.beginPath(); ctx.arc(X(bx), Y(by), (6 + (i % 5) * 3) * K, 0, 6.29); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawGlass() {
  // kusen vertikal
  ctx.fillStyle = '#090d1a';
  for (let x = 0; x <= VW; x += 200) ctx.fillRect(X(x) - 5 * K, Y(0), 10 * K, 492 * K);
  ctx.fillRect(X(0), Y(0), VW * K, 24 * K);           // balok atas
  ctx.fillRect(X(0), Y(470), VW * K, 22 * K);          // ambang bawah
  ctx.fillStyle = 'rgba(120,150,220,.12)';
  ctx.fillRect(X(0), Y(470), VW * K, 3 * K);
  // pantulan kaca diagonal
  const rg = ctx.createLinearGradient(X(200), Y(0), X(700), Y(492));
  rg.addColorStop(0, 'rgba(255,255,255,.055)'); rg.addColorStop(.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(X(240), Y(0)); ctx.lineTo(X(420), Y(0)); ctx.lineTo(X(820), Y(492)); ctx.lineTo(X(640), Y(492));
  ctx.closePath(); ctx.fill();
}
function drawFloor() {
  const g = ctx.createLinearGradient(0, Y(492), 0, Y(900));
  g.addColorStop(0, '#7a5233'); g.addColorStop(.5, '#4c3018'); g.addColorStop(1, '#241407');
  ctx.fillStyle = g; ctx.fillRect(X(0), Y(492), VW * K, 408 * K);
  // garis papan menuju titik hilang
  ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = Math.max(1, 1.4 * K);
  const vx = X(800), vy = Y(492);
  for (let x = -500; x <= 2100; x += 170) {
    ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(X(x), Y(900)); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,.20)';
  for (const y of [566, 648, 742, 842]) {
    ctx.beginPath(); ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(VW), Y(y)); ctx.stroke();
  }
  // highlight hangat tengah
  const hg = ctx.createRadialGradient(X(800), Y(700), 50, X(800), Y(700), 700 * K);
  hg.addColorStop(0, 'rgba(255,190,110,.07)'); hg.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = hg; ctx.fillRect(X(0), Y(492), VW * K, 408 * K);
}
function drawPool(cx) {
  const g = ctx.createRadialGradient(X(cx), Y(770), 10, X(cx), Y(770), 210 * K);
  g.addColorStop(0, 'rgba(255,196,120,.13)'); g.addColorStop(1, 'rgba(255,196,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(X(cx), Y(770), 210 * K, 70 * K, 0, 0, 6.29); ctx.fill();
}

/* ---------- agent ---------- */
function drawDesk(a, t) {
  const cx = a.deskX, st = a.st;
  // bayangan
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.beginPath(); ctx.ellipse(X(cx), Y(748), 135 * K, 20 * K, 0, 0, 6.29); ctx.fill();
  // avatar (di belakang meja)
  const im = IMG[a.def.name];
  const bob = st === 'working' ? Math.abs(Math.sin(t * 7 + a.phase)) * -7 : Math.sin(t * 1.6 + a.phase) * 5;
  const pop = a.popUntil && performance.now() < a.popUntil
    ? 1 + .22 * Math.sin(Math.PI * (1 - (a.popUntil - performance.now()) / 600)) : 1;
  const SZS = 128 * pop, ay = 566 + bob;
  if (a.selected) { ctx.shadowColor = a.def.color; ctx.shadowBlur = 34 * K; }
  if (im && im.complete && im.naturalWidth) {
    ctx.drawImage(im, X(cx) - SZS * K / 2, Y(ay) - SZS * K / 2, SZS * K, SZS * K);
  } else {
    ctx.fillStyle = a.def.color;
    ctx.beginPath(); ctx.arc(X(cx), Y(ay), 44 * K, 0, 6.29); ctx.fill();
  }
  ctx.shadowBlur = 0;
  if (a.selected) {
    ctx.strokeStyle = a.def.color; ctx.lineWidth = 3 * K;
    ctx.setLineDash([10 * K, 7 * K]); ctx.lineDashOffset = -t * 30 * K;
    ctx.beginPath(); ctx.arc(X(cx), Y(ay), 74 * K, 0, 6.29); ctx.stroke();
    ctx.setLineDash([]);
  }
  // meja: top + panel depan
  ctx.fillStyle = '#8a5a34';
  ctx.beginPath();
  ctx.moveTo(X(cx - 132), Y(642)); ctx.lineTo(X(cx + 132), Y(642));
  ctx.lineTo(X(cx + 152), Y(670)); ctx.lineTo(X(cx - 152), Y(670));
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#c08b52'; ctx.lineWidth = 2 * K;
  ctx.beginPath(); ctx.moveTo(X(cx - 132), Y(642)); ctx.lineTo(X(cx + 132), Y(642)); ctx.stroke();
  const pg = ctx.createLinearGradient(0, Y(670), 0, Y(742));
  pg.addColorStop(0, '#6e4526'); pg.addColorStop(1, '#3d2412');
  ctx.fillStyle = pg;
  rr(X(cx - 152), Y(670), 304 * K, 72 * K, 6 * K); ctx.fill();
  // monitor
  const mcol = st === 'working' ? '#2fe07a' : '#27406e';
  ctx.fillStyle = '#141a2a';
  ctx.fillRect(X(cx + 42), Y(600), 10 * K, 44 * K);
  ctx.shadowColor = mcol; ctx.shadowBlur = (st === 'working' ? 26 : 10) * K;
  ctx.fillStyle = '#0c1220';
  rr(X(cx + 2), Y(540), 116 * K, 70 * K, 6 * K); ctx.fill();
  ctx.shadowBlur = 0;
  const sg = ctx.createLinearGradient(0, Y(546), 0, Y(604));
  if (st === 'working') { sg.addColorStop(0, '#0f4a2c'); sg.addColorStop(1, '#189a58'); }
  else { sg.addColorStop(0, '#12203c'); sg.addColorStop(1, '#1d2f55'); }
  ctx.fillStyle = sg;
  rr(X(cx + 9), Y(547), 102 * K, 56 * K, 4 * K); ctx.fill();
  // baris "kode" di layar
  ctx.fillStyle = st === 'working' ? 'rgba(220,255,230,.55)' : 'rgba(160,190,240,.35)';
  for (let i = 0; i < 3; i++) {
    const w = (52 - i * 11 + ((t * 13 + i * 29 + cx) % 17)) * K;
    ctx.fillRect(X(cx + 16), Y(556 + i * 14), w, 4 * K);
  }
  // keyboard
  ctx.fillStyle = '#1a2133';
  ctx.beginPath();
  ctx.moveTo(X(cx - 70), Y(648)); ctx.lineTo(X(cx + 10), Y(648));
  ctx.lineTo(X(cx + 2), Y(660)); ctx.lineTo(X(cx - 78), Y(660));
  ctx.closePath(); ctx.fill();
  a._hit = { x: X(cx), y: Y(ay), r: 84 * K, desk: { x0: X(cx - 152), x1: X(cx + 152), y0: Y(540), y1: Y(742) } };
}
function drawTag(a) {
  const cx = a.deskX, ay = 566;
  const dot = a.st === 'working' ? '#2fe07a' : '#5b6376';
  const status = a.st === 'working' ? 'KERJA' + (a.task ? ': ' + trunc(a.task, 26) : '…') : 'SANTAI';
  ctx.font = '700 14px system-ui,sans-serif';
  const nameW = ctx.measureText(a.def.name).width;
  ctx.font = '500 12.5px system-ui,sans-serif';
  const stW = ctx.measureText(status).width;
  const pw = nameW + stW + 44 * K, ph = 30 * K;
  const px = X(cx) - pw / 2, py = Y(ay) - 108 * K - ph;
  ctx.fillStyle = 'rgba(8,12,24,.88)';
  rr(px, py, pw, ph, 8 * K); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
  rr(px, py, pw, ph, 8 * K); ctx.stroke();
  ctx.fillStyle = dot;
  ctx.beginPath(); ctx.arc(px + 14 * K, py + ph / 2, 5 * K, 0, 6.29); ctx.fill();
  ctx.font = '700 14px system-ui,sans-serif';
  ctx.fillStyle = a.def.color;
  ctx.textBaseline = 'middle';
  ctx.fillText(a.def.name, px + 24 * K, py + ph / 2 + 1);
  ctx.font = '500 12.5px system-ui,sans-serif';
  ctx.fillStyle = '#aab3c8';
  ctx.fillText(status, px + 24 * K + nameW + 8 * K, py + ph / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  a._tagY = py;
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
  const cx = a.deskX;
  ctx.font = '400 13.5px system-ui,sans-serif';
  const lines = wrapText(b.text, 250 * K);
  const w = Math.min(280 * K, Math.max(...lines.map(l => ctx.measureText(l).width)) + 28 * K);
  const h = lines.length * 19 * K + 20 * K;
  const bx = Math.max(10, Math.min(CW - w - 10, X(cx) - w / 2));
  const by = (a._tagY || Y(400)) - h - 16 * K;
  ctx.translate(bx + w / 2, by + h); ctx.scale(sc, sc); ctx.translate(-(bx + w / 2), -(by + h));
  ctx.fillStyle = '#f4f6ff';
  rr(bx, by, w, h, 12 * K); ctx.fill();
  // ekor
  ctx.beginPath();
  ctx.moveTo(bx + w / 2 - 9 * K, by + h - 1); ctx.lineTo(bx + w / 2 + 9 * K, by + h - 1);
  ctx.lineTo(X(cx), by + h + 16 * K); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#141a2a'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 14 * K, by + 10 * K + i * 19 * K));
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
function drawDust(t) {
  ctx.fillStyle = '#ffe9c4';
  for (const d of DUST) {
    d.x += d.vx * .016; d.y += d.vy * .016;
    if (d.y < 480) { d.y = 880; d.x = Math.random() * VW; }
    if (d.x > VW) d.x = 0;
    ctx.globalAlpha = d.a * (0.6 + 0.4 * Math.sin(t + d.x));
    ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), d.r * K, 0, 6.29); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ---------- frame ---------- */
const view = AGENTS.map((def, i) => ({ def, deskX: DESK_X[i], st: 'idle', task: '', bubble: null, phase: S.agents[def.name].phase, popUntil: 0, selected: false, _hit: null, _tagY: 0 }));
function frame() {
  const t = performance.now() / 1000;
  ctx.clearRect(0, 0, CW, CH);
  drawSky(t);
  drawGlass();
  drawFloor();
  for (const a of view) drawPool(a.deskX);
  for (const a of view) drawDesk(a, t);
  for (const a of view) drawTag(a);
  for (const a of view) drawBubble(a);
  drawDust(t);
  requestAnimationFrame(frame);
}

/* ---------- interaksi ---------- */
cv.addEventListener('click', e => {
  const r = cv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  let hit = null;
  for (const a of view) {
    const h = a._hit;
    if (!h) continue;
    const d = Math.hypot(mx - h.x, my - h.y);
    if (d < h.r || (mx > h.desk.x0 && mx < h.desk.x1 && my > h.desk.y0 && my < h.desk.y1)) { hit = a; break; }
  }
  select(hit ? hit.def.name : null);
});
function select(name) {
  S.selected = name;
  for (const a of view) a.selected = (a.def.name === name);
  renderCrewCard();
}

/* ---------- sidebar ---------- */
const $ = id => document.getElementById(id);
function setTab(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + name));
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('sideToggle').addEventListener('click', () => $('side').classList.toggle('hidden'));

function msgHTML(m, isNew) {
  const d = new Date(m.ts * 1000);
  const ts = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const av = IMG[m.sender] ? `<img class="mav" src="/static/avatars/${m.sender.toLowerCase()}.png" alt="">` : '';
  return `<div class="msg s-${esc(m.sender)}${m.kind === 'task' ? ' task' : ''}${m.kind === 'system' ? ' system' : ''}">` +
    `${av}<div class="mbody"><div class="mwho">${esc(m.sender)}<span class="ts">${ts}</span></div>` +
    `<div class="mtxt">${esc(m.text)}</div></div></div>`;
}
function renderFeed() {
  const el = $('feed');
  el.innerHTML = S.feed.slice(-80).map(m => msgHTML(m)).join('');
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
    const st = S.agents[a.name];
    const working = st.st === 'working';
    return `<div class="crewrow${S.selected === a.name ? ' sel' : ''}" data-name="${a.name}">` +
      `<img src="/static/avatars/${a.img}" alt=""><div><div class="cnm">${a.name}</div>` +
      `<div class="crl">${a.role}</div></div>` +
      `<div class="cst"><span class="dot ${working ? 'working' : 'idle'}"></span>${working ? 'kerja' : 'santai'}</div></div>`;
  }).join('');
  document.querySelectorAll('.crewrow').forEach(r =>
    r.addEventListener('click', () => select(r.dataset.name)));
}
function renderCrewCard() {
  const card = $('crewcard');
  if (!S.selected) { card.classList.remove('on'); return; }
  const st = S.agents[S.selected], a = st.def;
  const msgs = S.feed.filter(m => m.sender === a.name).slice(-3).reverse();
  card.innerHTML =
    `<div class="chead"><img src="/static/avatars/${a.img}" alt="">` +
    `<div><div class="cname" style="color:${a.color}">${a.name}</div><div class="crole">${a.role}</div></div></div>` +
    `<div class="cstatus"><b>Status:</b> ${st.st === 'working' ? '🟢 lagi kerja' : '⚪ santai'}` +
    (st.task ? `<br><b>Task:</b> ${esc(st.task)}` : '') + `</div>` +
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
      if (!S.first && S.agents[m.sender]) {
        const v = view.find(x => x.def.name === m.sender);
        v.bubble = { text: trunc(m.text, 150), until: performance.now() + 7000, born: performance.now() };
        v.popUntil = performance.now() + 600;
      }
    }
    if (j.messages && j.messages.length) renderFeed();
    const t = await (await api('/api/tasks')).json();
    S.tasks = t.tasks || [];
    renderTasks();
    const g = await (await api('/api/agents')).json();
    for (const x of (g.agents || [])) {
      const st = S.agents[x.agent];
      if (!st) continue;
      st.st = x.state === 'working' ? 'working' : 'idle';
      st.task = x.current_task || '';
      const v = view.find(vv => vv.def.name === x.agent);
      v.st = st.st; v.task = st.task;
    }
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
