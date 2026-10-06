"""web.py — web UI kantor-ai (stdlib http.server).

Routes (SEMUA butuh token, kecuali form login):
  GET  /                  -> halaman utama (butuh token) / form login (tanpa token)
  GET  /api/messages?since=N
  GET  /api/tasks
  GET  /api/agents        -> status agent
  POST /api/boss          -> {"text": "..."} ; perintah "/tugas @Nama judul" = assign
  GET  /static/*          -> aset publik (avatar dkk, tanpa auth)

Auth: query param ?token=... atau header Authorization: Bearer ...
Token: env KANTOR_TOKEN, fallback file <data_dir>/.ui_token
(generate secrets.token_urlsafe(32) saat pertama kali, chmod 600).
Token TIDAK PERNAH ditulis ke log.
"""
import hashlib
import hmac
import html as htmlmod
import json
import os
import re
import secrets
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN_FILE = ".ui_token"

# Direktori aset statis publik (avatar dkk). BUKAN rahasia -> boleh tanpa auth.
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
_STATIC_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".css": "text/css", ".js": "application/javascript",
}


def load_token(data_dir):
    """Kembalikan (token, sumber). Sumber: 'env' | 'file' | 'generated'."""
    env = os.environ.get("KANTOR_TOKEN", "").strip()
    if env:
        return env, "env"
    path = os.path.join(data_dir, TOKEN_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            t = f.read().strip()
        if t:
            return t, "file"
    except FileNotFoundError:
        pass
    t = secrets.token_urlsafe(32)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(t + "\n")
        return t, "generated"
    except FileExistsError:
        with open(path, encoding="utf-8") as f:
            return f.read().strip(), "file"


PAGE = """<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>kantor-ai</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0f1115;color:#e8eaf0;
font-family:system-ui,-apple-system,sans-serif;font-size:15px}
header{padding:12px 16px;background:#161a22;border-bottom:1px solid #262c38;
position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center}
header h1{margin:0;font-size:17px}header small{color:#8b93a7}
main{max-width:900px;margin:0 auto;padding:12px;display:grid;gap:12px}
@media(min-width:800px){main{grid-template-columns:2fr 1fr}}
.card{background:#161a22;border:1px solid #262c38;border-radius:10px;padding:12px}
.card h2{margin:0 0 8px;font-size:14px;color:#9aa4b8;text-transform:uppercase;letter-spacing:.5px}
#feed{height:52vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.msg{background:#1d2230;border-radius:8px;padding:8px 10px}
.msg .who{font-weight:700;font-size:13px;margin-bottom:2px}
.msg .ts{color:#6b7488;font-size:11px;margin-left:6px;font-weight:400}
.msg.task{border-left:3px solid #f0a832}.msg.system{border-left:3px solid #5aa9ff;opacity:.85}
.Bagas .who{color:#f0a832}.Dimas .who{color:#5ad08a}.Putri .who{color:#e06ba8}
.Eko .who{color:#c9a0ff}.Intan .who{color:#5ac8e0}.Bos .who{color:#ff6b6b}
.board{display:flex;gap:8px}.col{flex:1;min-width:0}.col h3{font-size:12px;color:#9aa4b8;margin:0 0 6px}
.task{background:#1d2230;border-radius:6px;padding:6px 8px;margin-bottom:6px;font-size:13px}
.task small{color:#8b93a7;display:block}
#agents .a{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #222836;font-size:14px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.working{background:#5ad08a}.idle{background:#6b7488}
/* --- avatar & animasi --- */
.av{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none;background:#222836}
.acard{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #222836}
.acard:last-child{border-bottom:0}
.acard .nm{font-weight:700;font-size:14px}
.acard .rl{color:#8b93a7;font-size:12px}
.acard .st{margin-left:auto;font-size:12px;text-align:right}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes popglow{0%{transform:scale(1)}30%{transform:scale(1.28)}100%{transform:scale(1)}}
@keyframes glowring{0%,100%{box-shadow:0 0 0 0 rgba(90,208,138,0)}35%{box-shadow:0 0 0 6px rgba(90,208,138,.5)}}
.av.idle{animation:floaty 4s ease-in-out infinite}
.av.working{animation:bounce 1.1s ease-in-out infinite}
.av.pop{animation:popglow .6s ease,glowring 2s ease}
.typing i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#5ad08a;margin:0 1px;animation:tblink 1.2s infinite}
.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
@keyframes tblink{0%,60%,100%{opacity:.25}30%{opacity:1}}
@keyframes slidein{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
.msg{display:flex;gap:8px;align-items:flex-start}
.msg .body{flex:1;min-width:0}
.msg .txt{overflow-wrap:break-word}
.msg.new{animation:slidein .35s ease}
#bossbox{display:flex;gap:8px}#bossbox input{flex:1;background:#0f1115;border:1px solid #2c3342;
color:#e8eaf0;border-radius:8px;padding:10px}#bossbox button{background:#2f6fed;border:0;color:#fff;
border-radius:8px;padding:10px 16px;font-weight:700}
.hint{color:#6b7488;font-size:12px;margin-top:6px}
</style></head><body>
<header><h1>&#127970; kantor-ai <small>tim AI yang kerja beneran</small></h1>
<small id="clock"></small></header>
<main>
<div>
<div class="card"><h2>Obrolan kantor</h2><div id="feed"></div></div>
<div class="card" style="margin-top:12px"><h2>Ngomong sebagai Bos</h2>
<div id="bossbox"><input id="bosin" placeholder="Ketik pesan... /tugas @Dimas bikin API auth">
<button onclick="sendBos()">Kirim</button></div>
<div class="hint">Perintah: <b>/tugas @Nama judul task</b> untuk assign kerjaan.</div></div>
</div>
<div>
<div class="card"><h2>Task board</h2><div class="board">
<div class="col"><h3>BACKLOG</h3><div id="b_backlog"></div></div>
<div class="col"><h3>DOING</h3><div id="b_doing"></div></div>
<div class="col"><h3>DONE</h3><div id="b_done"></div></div>
</div></div>
<div class="card" style="margin-top:12px"><h2>Tim</h2><div id="agents"></div></div>
</div>
</main>
<script>
const TOKEN=new URLSearchParams(location.search).get('token')||'';
function api(p,opts){
  const sep=p.includes('?')?'&':'?';
  opts=opts||{};
  opts.headers=Object.assign({'Authorization':'Bearer '+TOKEN},opts.headers||{});
  return fetch(p+sep+'token='+encodeURIComponent(TOKEN),opts);
}
let lastId=0;
let firstPoll=true;
const AVATARS={Bagas:'bagas.png',Dimas:'dimas.png',Putri:'putri.png',Eko:'eko.png',Intan:'intan.png'};
const ROLES={Bagas:'Project Manager',Dimas:'Backend Developer',Putri:'Frontend Developer',Eko:'QA Engineer',Intan:'Researcher'};
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function avatarFor(s,cls){return AVATARS[s]?`<img class="av ${cls||''}" src="/static/avatars/${AVATARS[s]}" alt="${esc(s)}" loading="lazy">`:''}
function renderMsg(m,isNew){
  const d=new Date(m.ts*1000);
  const ts=d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  return `<div class="msg ${m.kind} ${esc(m.sender)}${isNew?' new':''}">${avatarFor(m.sender)}<div class="body"><div class="who">${esc(m.sender)}<span class="ts">${ts}</span></div><div class="txt">${esc(m.text)}</div></div></div>`;
}
function popAvatar(name){
  const img=document.querySelector('#ac-'+CSS.escape(name)+' .av');
  if(!img)return;
  img.classList.remove('pop');void img.offsetWidth;img.classList.add('pop');
  setTimeout(()=>img.classList.remove('pop'),2100);
}
function renderAgents(list){
  document.getElementById('agents').innerHTML=list.map(x=>{
    const st=x.state==='working'?'working':'idle';
    const right=x.state==='working'
      ?'<span class="typing"><i></i><i></i><i></i></span> <span class="hint">kerja...</span>'
      :`<span class="hint">${esc(x.current_task||'idle')}</span>`;
    return `<div class="acard" id="ac-${esc(x.agent)}">${avatarFor(x.agent,st)}<div><div class="nm">${esc(x.agent)}</div><div class="rl">${ROLES[x.agent]||''}</div></div><div class="st">${right}</div></div>`;
  }).join('');
}
async function poll(){
  try{
    const r=await api('/api/messages?since='+lastId);
    if(r.status===401){location.href='/';return;}
    const j=await r.json();
    const feed=document.getElementById('feed');
    const fresh=[];
    for(const m of j.messages){
      feed.insertAdjacentHTML('beforeend',renderMsg(m,!firstPoll));
      lastId=m.id;
      if(!firstPoll&&AVATARS[m.sender])fresh.push(m.sender);
    }
    if(j.messages.length)feed.scrollTop=feed.scrollHeight;
    const t=await (await api('/api/tasks')).json();
    for(const s of ['backlog','doing','done']){
      document.getElementById('b_'+s).innerHTML=t.tasks.filter(x=>x.status===s)
        .map(x=>`<div class="task">#${x.id} ${esc(x.title)}<small>${esc(x.assignee)} · ${esc(x.created_by)}</small></div>`).join('')||'<div class="hint">-</div>';
    }
    const a=await (await api('/api/agents')).json();
    renderAgents(a.agents);
    fresh.forEach(popAvatar);
    firstPoll=false;
  }catch(e){}
}
async function sendBos(){
  const inp=document.getElementById('bosin');const v=inp.value.trim();if(!v)return;
  await api('/api/boss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:v})});
  inp.value='';poll();
}
document.getElementById('bosin').addEventListener('keydown',e=>{if(e.key==='Enter')sendBos()});
setInterval(poll,5000);poll();
setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleString('id-ID')},1000);
</script></body></html>
"""

LOGIN_PAGE = """<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>kantor-ai — login</title>
<style>body{margin:0;background:#0f1115;color:#e8eaf0;font-family:system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161a22;border:1px solid #262c38;border-radius:12px;padding:28px;width:320px;text-align:center}
h1{font-size:20px;margin:0 0 6px}p{color:#8b93a7;font-size:13px}
input{width:100%;background:#0f1115;border:1px solid #2c3342;color:#e8eaf0;border-radius:8px;
padding:10px;margin:12px 0;box-sizing:border-box}
button{width:100%;background:#2f6fed;border:0;color:#fff;border-radius:8px;padding:10px;font-weight:700;cursor:pointer}
</style></head><body><div class="card">
<h1>&#127970; kantor-ai</h1><p>Masukin token akses buat buka dashboard kantor.</p>
<input id="t" type="password" placeholder="token" autocomplete="off">
<button onclick="go()">Masuk</button></div>
<script>function go(){const v=document.getElementById('t').value.trim();if(v)location.href='/?token='+encodeURIComponent(v);}
document.getElementById('t').addEventListener('keydown',e=>{if(e.key==='Enter')go()});</script>
</body></html>
"""


class Handler(BaseHTTPRequestHandler):
    db = None
    agent_names = []
    ui_token = ""

    def _authed(self):
        parsed = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parsed.query)
        tok = q.get("token", [""])[0]
        if not tok:
            ah = self.headers.get("Authorization", "")
            if ah.startswith("Bearer "):
                tok = ah[7:].strip()
        return bool(tok) and hmac.compare_digest(tok, self.ui_token)

    def _html(self, page, code=200):
        body = page.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _unauthorized(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Bearer realm="kantor-ai"')
        body = b'{"error":"unauthorized"}'
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, rel):
        # Serve file di bawah STATIC_DIR saja. Tolak traversal & tipe tak dikenal.
        rel = urllib.parse.unquote(rel)
        if not rel or rel.startswith("/") or ".." in rel.split("/"):
            self.send_error(404)
            return
        base = os.path.realpath(STATIC_DIR)
        full = os.path.realpath(os.path.join(base, rel))
        if not full.startswith(base + os.sep) or not os.path.isfile(full):
            self.send_error(404)
            return
        ctype = _STATIC_TYPES.get(os.path.splitext(full)[1].lower())
        if not ctype:
            self.send_error(404)
            return
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/static/" or parsed.path.startswith("/static/"):
            self._serve_static(parsed.path[len("/static/"):])
            return
        if parsed.path == "/":
            if self._authed():
                self._html(PAGE)
            else:
                self._html(LOGIN_PAGE)
            return
        if not self._authed():
            self._unauthorized()
            return
        if parsed.path == "/api/messages":
            q = urllib.parse.parse_qs(parsed.query)
            try:
                since = int(q.get("since", ["0"])[0])
            except ValueError:
                since = 0
            msgs = self.db.messages_since(since)
            if not msgs and since == 0:
                msgs = self.db.recent_messages(50)
            self._json({"messages": msgs})
            return
        if parsed.path == "/api/tasks":
            self._json({"tasks": self.db.list_tasks()})
            return
        if parsed.path == "/api/agents":
            self._json({"agents": self.db.all_status()})
            return
        self.send_error(404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/boss":
            self.send_error(404)
            return
        if not self._authed():
            self._unauthorized()
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            data = {}
        text = (data.get("text") or "").strip()
        if not text:
            self._json({"ok": False})
            return
        m = re.match(r"^/tugas\s+@(\w+)\s+(.+)$", text)
        if m:
            who, title = m.group(1), m.group(2)
            names = [a["name"] for a in self.db.list_agents()]
            if who in names:
                tid = self.db.add_task(title, who, created_by="Bos")
                self.db.add_message("Bos", "task", f"/tugas: #{tid} untuk {who}: {title}")
                self._json({"ok": True, "task_id": tid})
                return
            self._json({"ok": False, "error": f"tidak kenal @{who}"})
            return
        self.db.add_message("Bos", "chat", text)
        self._json({"ok": True})

    def log_message(self, *a):
        pass


def run(db, agent_names, host, port, data_dir):
    token, src = load_token(data_dir)
    Handler.db = db
    Handler.agent_names = agent_names
    Handler.ui_token = token
    # NOTE: nilai token TIDAK PERNAH di-log
    print(f"[web] token auth aktif (sumber: {src}); UI di http://{host}:{port}", flush=True)
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.serve_forever()
