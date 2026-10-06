"""web.py — web UI kantor-ai (stdlib http.server).

Routes:
  GET  /                  -> halaman utama (HTML inline)
  GET  /api/messages?since=N
  GET  /api/tasks
  GET  /api/agents        -> status agent
  POST /api/boss          -> {"text": "..."} ; perintah "/tugas @Nama judul" = assign
"""
import html as htmlmod
import json
import re
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
let lastId=0;
function esc(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function renderMsg(m){
  const d=new Date(m.ts*1000);
  const ts=d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  return `<div class="msg ${m.kind} ${esc(m.sender)}"><div class="who">${esc(m.sender)}<span class="ts">${ts}</span></div><div>${esc(m.text)}</div></div>`;
}
async function poll(){
  try{
    const r=await fetch('/api/messages?since='+lastId);const j=await r.json();
    const feed=document.getElementById('feed');
    for(const m of j.messages){feed.insertAdjacentHTML('beforeend',renderMsg(m));lastId=m.id;}
    if(j.messages.length)feed.scrollTop=feed.scrollHeight;
    const t=await (await fetch('/api/tasks')).json();
    for(const s of ['backlog','doing','done']){
      document.getElementById('b_'+s).innerHTML=t.tasks.filter(x=>x.status===s)
        .map(x=>`<div class="task">#${x.id} ${esc(x.title)}<small>${esc(x.assignee)} · ${esc(x.created_by)}</small></div>`).join('')||'<div class="hint">-</div>';
    }
    const a=await (await fetch('/api/agents')).json();
    document.getElementById('agents').innerHTML=a.agents.map(x=>
      `<div class="a"><span><span class="dot ${x.state}"></span>${esc(x.agent)}</span><span class="hint">${esc(x.current_task||x.state)}</span></div>`).join('');
  }catch(e){}
}
async function sendBos(){
  const inp=document.getElementById('bosin');const v=inp.value.trim();if(!v)return;
  await fetch('/api/boss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:v})});
  inp.value='';poll();
}
document.getElementById('bosin').addEventListener('keydown',e=>{if(e.key==='Enter')sendBos()});
setInterval(poll,5000);poll();
setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleString('id-ID')},1000);
</script></body></html>
"""


class Handler(BaseHTTPRequestHandler):
    db = None
    agent_names = []

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            body = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/messages":
            q = urllib.parse.parse_qs(parsed.query)
            since = int(q.get("since", ["0"])[0])
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


def run(db, agent_names, host, port):
    Handler.db = db
    Handler.agent_names = agent_names
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.serve_forever()
