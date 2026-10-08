#!/usr/bin/env python3
"""Kantor AI v3 — backend.

Melayani frontend Three.js + API live feed + published actions.
Hanya pakai stdlib (tanpa dependensi).

Published actions:
  POST /api/actions/report_agent_activity  {agent_id, status, detail}
  GET  /api/actions/get_ceo_commands?status=baru
  POST /api/actions/ack_ceo_command        {command_id, agent_id}
  POST /api/actions/complete_ceo_command   {command_id, ringkasan}
"""
import json, os, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
STATIC = os.path.join(BASE, "static")
PORT = 8092
STATUSES = {"working", "reading", "running", "idle", "waiting", "done"}
SPECIAL_IDS = {"noir", "bos"}

lock = threading.Lock()

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)

def log_activity(text):
    entry = {"ts": now_iso(), "text": text}
    with open(os.path.join(DATA, "activity.log"), "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def tail_activity(n=40):
    out = []
    try:
        with open(os.path.join(DATA, "activity.log")) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    except FileNotFoundError:
        pass
    return out[-n:]

AGENTS = {a["id"]: a for a in load_json(os.path.join(DATA, "agents.json"), [])}
DIVISIONS = load_json(os.path.join(DATA, "divisions.json"), [])
KNOWN_IDS = set(AGENTS) | SPECIAL_IDS

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json",
        ".png": "image/png", ".svg": "image/svg+xml"}

class Handler(BaseHTTPRequestHandler):
    server_version = "KantorAI/3.0"

    def log_message(self, fmt, *args):
        pass  # biar log bersih; pakai server.log dari supervisor

    def _route_path(self):
        # Dukung diakses lewat subpath publik /kantorv3/ (via tunnel STB)
        # maupun langsung di root (lokal). Kembalikan path ternormalisasi.
        p = urlparse(self.path).path
        if p == "/kantorv3":
            return "REDIRECT:/kantorv3/"
        if p == "/kantorv3/" or p.startswith("/kantorv3/"):
            p = p[len("/kantorv3"):] or "/"
        return p

    def _send(self, code, obj, ctype="application/json"):
        body = obj.encode() if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            n = 0
        raw = self.rfile.read(n) if n > 0 else b""
        try:
            return json.loads(raw.decode()) if raw else {}
        except json.JSONDecodeError:
            return {}

    # ---------- GET ----------
    def do_GET(self):
        p = self._route_path()
        if p.startswith("REDIRECT:"):
            self.send_response(301)
            self.send_header("Location", p[len("REDIRECT:"):])
            self.end_headers()
            return
        qs = parse_qs(urlparse(self.path).query)
        path = p

        if path == "/":
            return self._serve_file("index.html")
        if path.startswith("/static/"):
            return self._serve_file(path[len("/static/"):])
        if path == "/api/health":
            return self._send(200, {"ok": True, "time": now_iso()})
        if path == "/api/divisions":
            return self._send(200, DIVISIONS)
        if path == "/api/agents":
            return self._send(200, list(AGENTS.values()))
        if path == "/api/commands":
            with lock:
                q = load_json(os.path.join(DATA, "queue.json"), [])
            return self._send(200, {"commands": list(reversed(q))})
        if path == "/api/live":
            with lock:
                live = load_json(os.path.join(DATA, "live.json"), {})
                q = load_json(os.path.join(DATA, "queue.json"), [])
            return self._send(200, {
                "updated_at": now_iso(),
                "live": live,
                "queue": list(reversed(q[-30:])),
                "activity": tail_activity(40),
            })
        if path == "/api/actions/get_ceo_commands":
            want = qs.get("status", ["baru"])[0]
            with lock:
                q = load_json(os.path.join(DATA, "queue.json"), [])
            cmds = [c for c in q if c["status"] == want] if want != "semua" else q
            return self._send(200, {"commands": cmds})
        return self._send(404, {"error": "not found"})

    def _serve_file(self, rel):
        # cegah path traversal
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._send(404, {"error": "not found"})
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if ext in (".html", ".js") else "max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    # ---------- POST ----------
    def do_POST(self):
        p = self._route_path()
        if p.startswith("REDIRECT:"):
            return self._send(400, {"error": "pakai trailing slash: /kantorv3/"})
        path = p
        data = self._body()

        if path == "/api/commands":
            text = (data.get("text") or "").strip()
            if not text:
                return self._send(400, {"error": "text kosong"})
            if len(text) > 2000:
                return self._send(400, {"error": "text kepanjangan (max 2000)"})
            cmd = {"id": "cmd-" + uuid.uuid4().hex[:8], "text": text,
                   "status": "baru", "created_at": now_iso(),
                   "agent_id": None, "agent_name": None, "ringkasan": None}
            with lock:
                q = load_json(os.path.join(DATA, "queue.json"), [])
                q.append(cmd)
                save_json(os.path.join(DATA, "queue.json"), q)
            log_activity(f"Perintah baru dari Bos: {text[:90]}")
            return self._send(200, {"ok": True, "command": cmd})

        if path == "/api/actions/report_agent_activity":
            aid, status = data.get("agent_id"), data.get("status")
            detail = (data.get("detail") or "")[:300]
            if not aid or status not in STATUSES:
                return self._send(400, {"error": "agent_id/status tidak valid"})
            if aid not in KNOWN_IDS:
                return self._send(400, {"error": "agent_id tidak dikenal"})
            with lock:
                live = load_json(os.path.join(DATA, "live.json"), {})
                live[aid] = {"status": status, "detail": detail, "updated_at": now_iso()}
                save_json(os.path.join(DATA, "live.json"), live)
            if status in ("working", "done"):
                nm = AGENTS.get(aid, {}).get("name", aid)
                log_activity(f"{nm}: {status} — {detail[:80]}")
            return self._send(200, {"ok": True})

        if path == "/api/actions/ack_ceo_command":
            cid, aid = data.get("command_id"), data.get("agent_id")
            if not cid or not aid:
                return self._send(400, {"error": "command_id/agent_id wajib"})
            if aid not in KNOWN_IDS:
                return self._send(400, {"error": "agent_id tidak dikenal"})
            with lock:
                q = load_json(os.path.join(DATA, "queue.json"), [])
                cmd = next((c for c in q if c["id"] == cid), None)
                if not cmd:
                    return self._send(404, {"error": "command tidak ketemu"})
                if cmd["status"] != "baru":
                    return self._send(409, {"error": f"command sudah {cmd['status']}"})
                cmd["status"] = "diproses"
                cmd["agent_id"] = aid
                cmd["agent_name"] = AGENTS.get(aid, {}).get("name", aid)
                cmd["acked_at"] = now_iso()
                save_json(os.path.join(DATA, "queue.json"), q)
            log_activity(f"{cmd['agent_name']} mengerjakan: {cmd['text'][:80]}")
            return self._send(200, {"ok": True, "command": cmd})

        if path == "/api/actions/complete_ceo_command":
            cid = data.get("command_id")
            ringkasan = (data.get("ringkasan") or "")[:1000]
            if not cid:
                return self._send(400, {"error": "command_id wajib"})
            with lock:
                q = load_json(os.path.join(DATA, "queue.json"), [])
                cmd = next((c for c in q if c["id"] == cid), None)
                if not cmd:
                    return self._send(404, {"error": "command tidak ketemu"})
                cmd["status"] = "selesai"
                cmd["ringkasan"] = ringkasan
                cmd["completed_at"] = now_iso()
                save_json(os.path.join(DATA, "queue.json"), q)
                live = load_json(os.path.join(DATA, "live.json"), {})
                if cmd.get("agent_id"):
                    live[cmd["agent_id"]] = {"status": "done", "detail": ringkasan[:300],
                                             "updated_at": now_iso()}
                    save_json(os.path.join(DATA, "live.json"), live)
            log_activity(f"Selesai: {cmd['text'][:60]} — {ringkasan[:80]}")
            return self._send(200, {"ok": True, "command": cmd})

        return self._send(404, {"error": "not found"})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

if __name__ == "__main__":
    import fcntl
    os.makedirs(DATA, exist_ok=True)
    # single-flight: hanya 1 instance boleh jalan; pendaftar lain keluar diam-diam.
    # (mencegah race keepalive: dua start bersamaan -> Address already in use)
    _lockf = open(os.path.join(DATA, "server.lock"), "w")
    try:
        fcntl.flock(_lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f"port {PORT}: server lain sedang berjalan — keluar.", flush=True)
        raise SystemExit(0)
    for name, default in (("queue.json", []), ("live.json", {}), ("dispatch.json", {})):
        fp = os.path.join(DATA, name)
        if not os.path.exists(fp):
            save_json(fp, default)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Kantor AI v3 listening on 127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
