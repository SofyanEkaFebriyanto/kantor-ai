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
<title>kantor-ai — tim AI yang kerja beneran</title>
<link rel="stylesheet" href="/static/kantor.css">
</head><body>
<div id="stage"><canvas id="scene"></canvas><div id="vignette"></div></div>
<header id="topbar">
  <div class="brand"><span style="font-size:22px">&#127970;</span><div><b>kantor-ai</b><small>tim AI yang kerja beneran</small></div></div>
  <button id="sideToggle">&#9776; Panel</button>
  <div id="livepill"><span class="pulse"></span><span id="clock"></span><span>&middot;</span><span>kantor malam</span></div>
</header>
<aside id="side">
  <div id="tabs">
    <button data-tab="feed" class="on">OBROLAN</button>
    <button data-tab="tasks">TASK</button>
    <button data-tab="crew">TIM</button>
  </div>
  <div id="panes">
    <div class="pane on" id="pane-feed"><div id="feed"></div></div>
    <div class="pane" id="pane-tasks">
      <div class="bcol"><h3>BACKLOG</h3><div id="b_backlog"></div></div>
      <div class="bcol"><h3>DOING</h3><div id="b_doing"></div></div>
      <div class="bcol"><h3>DONE</h3><div id="b_done"></div></div>
    </div>
    <div class="pane" id="pane-crew"><div id="crewlist"></div></div>
  </div>
  <div id="crewcard"></div>
</aside>
<div id="bossbar">
  <div id="bossbox"><input id="bosin" placeholder="Ngomong sebagai Bos...  /tugas @Dimas bikin API auth" autocomplete="off"><button id="bossend">Kirim</button></div>
  <div class="hint"><b>/tugas @Nama judul task</b> buat assign kerjaan &middot; klik agent di kantor buat lihat kartunya</div>
</div>
<script src="/static/kantor.js"></script>
</body></html>
"""

LOGIN_PAGE = """<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>kantor-ai — login</title>
<style>body{margin:0;color:#e8eaf0;font-family:system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;
background:radial-gradient(ellipse at 50% 120%,#1c2a63 0%,#0a1030 45%,#05081a 100%)}
.stars{position:fixed;inset:0;pointer-events:none;opacity:.7;
background-image:radial-gradient(1.5px 1.5px at 20% 30%,#dfe8ff,transparent),
radial-gradient(1px 1px at 70% 15%,#dfe8ff,transparent),
radial-gradient(2px 2px at 40% 60%,#dfe8ff,transparent),
radial-gradient(1px 1px at 85% 45%,#dfe8ff,transparent),
radial-gradient(1.5px 1.5px at 10% 70%,#dfe8ff,transparent),
radial-gradient(1px 1px at 55% 25%,#dfe8ff,transparent)}
.moon{position:fixed;top:8%;right:12%;width:90px;height:90px;border-radius:50%;
background:#f2eeda;box-shadow:0 0 60px 20px rgba(244,241,222,.25);pointer-events:none}
.card{position:relative;background:rgba(13,18,32,.94);border:1px solid #232c44;border-radius:16px;
padding:32px;width:330px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)}
h1{font-size:22px;margin:0 0 6px}p{color:#8b93a7;font-size:13px}
input{width:100%;background:#0f1115;border:1px solid #2c3342;color:#e8eaf0;border-radius:8px;
padding:10px;margin:12px 0;box-sizing:border-box}
button{width:100%;background:#2f6fed;border:0;color:#fff;border-radius:8px;padding:10px;font-weight:700;cursor:pointer}
button:hover{filter:brightness(1.15)}
</style></head><body><div class="stars"></div><div class="moon"></div><div class="card">
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
