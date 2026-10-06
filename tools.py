"""tools.py — toolset agent kantor-ai (definisi OpenAI function + eksekutor).

SAFETY:
- Semua akses file di-jail ke WORK_DIR (env KANTOR_WORK_DIR, default /opt/kantor-ai/work).
  Path absolut di luar jail & '..' DITOLAK.
- exec: denylist pola destruktif + blokir file kredensial + timeout 30 dtk.
- assign_task: hanya boleh dipanggil Bagas (PM) atau Bos.
"""
import html as htmlmod
import json
import os
import re
import subprocess
import urllib.request

WORK_DIR = os.environ.get("KANTOR_WORK_DIR", "/opt/kantor-ai/work")

# --- sandbox helpers -------------------------------------------------------

CRED_PATTERNS = (".env", "key", "secret", "token", "credential", "passwd", ".ssh",
                 "id_rsa", "id_ed25519", ".pem", "wallet")


def _is_cred_path(name):
    """True bila nama file terlihat seperti kredensial. Hindari false positive
    (mis. monkey.py / tokenizer.py) — hanya pola yang jelas kredensial."""
    low = os.path.basename(name).lower()
    if low.startswith(".env") or low == ".ssh":
        return True
    if low.startswith("id_rsa") or low.startswith("id_ed25519"):
        return True
    if low.endswith((".pem", ".key")):
        return True
    for p in ("secret", "credential", "passwd", "private_key", "api_key",
              "apikey", "auth_token", "access_token", "bearer"):
        if p in low:
            return True
    return False


def jail_resolve(path):
    """Resolve path di dalam WORK_DIR. Raise ValueError bila lolos dari jail."""
    if not path or not isinstance(path, str):
        raise ValueError("path kosong")
    real_work = os.path.realpath(WORK_DIR)
    # path absolut yang memang di dalam jail -> pakai langsung
    if os.path.isabs(path):
        real_p = os.path.realpath(path)
        if real_p == real_work or real_p.startswith(real_work + os.sep):
            pass
        else:
            raise ValueError(f"path di luar work dir: {path}")
    else:
        # tolak path absolut di luar jail
        p = os.path.normpath(os.path.join(WORK_DIR, path.lstrip("/")))
        real_p = os.path.realpath(p)
        if real_p != real_work and not real_p.startswith(real_work + os.sep):
            raise ValueError(f"path di luar work dir: {path}")
    if _is_cred_path(os.path.basename(real_p)):
        raise ValueError("akses file kredensial dilarang")
    return real_p


DENY_PATTERNS = [
    r"rm\s+(-rf?|--recursive).{0,4}/(\s|$)",   # rm -rf /
    r"rm\s+(-rf?|--recursive).{0,4}~",          # rm -rf ~
    r"\bmkfs\b", r"\bshutdown\b", r"\breboot\b", r"\bhalt\b", r"\bpoweroff\b",
    r"\bdd\s+if=", r":\(\)\s*{\s*:\s*|\s*:\s*&\s*}\s*;?\s*:",
    r"curl[^|]*\|\s*(ba)?sh", r"wget[^|]*\|\s*(ba)?sh",
    r"chmod\s+-R\s+777\s+/", r">\s*/dev/sd", r">\s*/dev/nvme",
    r"\bmount\b.*\s/", r"\bumount\b",
]


def _exec_allowed(cmd):
    low = cmd.lower()
    for pat in DENY_PATTERNS:
        if re.search(pat, low):
            return False, f"perintah diblokir (pola berbahaya): {pat}"
    # blokir baca/tulis file kredensial via shell
    for word in re.findall(r"[~\w./-]*\.[\w]+", cmd):
        if _is_cred_path(os.path.basename(word)):
            # izinkan hanya bila word jelas di dalam work dir relatif & bukan kredensial beneran
            return False, f"referensi file kredensial dilarang: {word}"
    return True, ""


# --- tool schemas (OpenAI function calling) ---------------------------------

TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Baca isi file teks di work dir.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "path relatif thd work dir"}},
            "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "write_file",
        "description": "Tulis/overwrite file teks di work dir (buat direktori bila perlu).",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"]}}},
    {"type": "function", "function": {
        "name": "edit_file",
        "description": "Ganti exact text old_text jadi new_text di file (harus cocok persis).",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "old_text": {"type": "string"},
            "new_text": {"type": "string"}},
            "required": ["path", "old_text", "new_text"]}}},
    {"type": "function", "function": {
        "name": "list_dir",
        "description": "List isi direktori di work dir.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "relatif, default '.'"}},
            "required": []}}},
    {"type": "function", "function": {
        "name": "exec",
        "description": ("Jalankan perintah shell di work dir (timeout 30 dtk). "
                        "DILARANG: perintah destruktif, pipe curl/wget ke shell, akses file kredensial."),
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string", "description": "perintah shell"}},
            "required": ["command"]}}},
    {"type": "function", "function": {
        "name": "webfetch",
        "description": "Ambil konten URL (GET, 15 dtk, maks 32KB, HTML di-strip).",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string"}},
            "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "todo_write",
        "description": "Simpan daftar todo pribadi lo (ganti seluruh list).",
        "parameters": {"type": "object", "properties": {
            "items": {"type": "string",
                      "description": "JSON array string, cth: '[{\"t\":\"...\",\"done\":false}]'"}},
            "required": ["items"]}}},
    {"type": "function", "function": {
        "name": "assign_task",
        "description": ("(HANYA PM/Bagas & Bos) Buat task baru di board untuk anggota tim lain. "
                        "Status awal: backlog."),
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"}, "assignee": {"type": "string"}},
            "required": ["title", "assignee"]}}},
]


class ToolRunner:
    def __init__(self, db, agent_name, log_fn):
        self.db = db
        self.agent_name = agent_name
        self.log = log_fn
        os.makedirs(WORK_DIR, exist_ok=True)

    def run(self, name, args):
        self.log(f"[tool] {self.agent_name} -> {name} {json.dumps(args)[:160]}")
        try:
            if name == "read_file":
                return self._read_file(args["path"])
            if name == "write_file":
                return self._write_file(args["path"], args.get("content", ""))
            if name == "edit_file":
                return self._edit_file(args["path"], args["old_text"], args.get("new_text", ""))
            if name == "list_dir":
                return self._list_dir(args.get("path", "."))
            if name == "exec":
                return self._exec(args["command"])
            if name == "webfetch":
                return self._webfetch(args["url"])
            if name == "todo_write":
                return self._todo_write(args["items"])
            if name == "assign_task":
                return self._assign_task(args["title"], args["assignee"])
            return f"tool tidak dikenal: {name}"
        except Exception as e:
            return f"ERROR: {e}"

    # -- file tools --
    def _read_file(self, path):
        p = jail_resolve(path)
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            data = f.read(32000)
        return data if data else "(file kosong)"

    def _write_file(self, path, content):
        p = jail_resolve(path)
        os.makedirs(os.path.dirname(p) or WORK_DIR, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        return f"OK: ditulis {len(content)} char ke {path}"

    def _edit_file(self, path, old_text, new_text):
        p = jail_resolve(path)
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            data = f.read()
        if old_text not in data:
            return "ERROR: old_text tidak cocok persis di file"
        data = data.replace(old_text, new_text, 1)
        with open(p, "w", encoding="utf-8") as f:
            f.write(data)
        return "OK: 1 bagian diganti"

    def _list_dir(self, path):
        p = jail_resolve(path)
        items = sorted(os.listdir(p))
        return "\n".join(items) if items else "(kosong)"

    # -- exec --
    def _exec(self, command):
        ok, reason = _exec_allowed(command)
        if not ok:
            return f"ERROR: {reason}"
        try:
            r = subprocess.run(command, shell=True, cwd=WORK_DIR, capture_output=True,
                               text=True, timeout=30)
            out = (r.stdout or "") + (r.stderr or "")
            if len(out) > 6000:
                out = out[:6000] + "\n...[dipotong]"
            return f"[exit {r.returncode}]\n{out.strip() or '(tanpa output)'}"
        except subprocess.TimeoutExpired:
            return "ERROR: timeout 30 dtk"

    # -- web --
    def _webfetch(self, url):
        if not re.match(r"^https?://", url):
            return "ERROR: URL harus http(s)"
        req = urllib.request.Request(url, headers={"User-Agent": "kantor-ai/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read(32768)
        text = raw.decode("utf-8", errors="replace")
        text = re.sub(r"<script.*?</script>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<style.*?</style>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = htmlmod.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:8000] or "(konten kosong)"

    # -- todos & tasks --
    def _todo_write(self, items):
        try:
            arr = json.loads(items)
            assert isinstance(arr, list)
        except Exception:
            return "ERROR: items harus JSON array string"
        self.db.set_memory(self.agent_name, "todos", json.dumps(arr, ensure_ascii=False))
        done = sum(1 for i in arr if isinstance(i, dict) and i.get("done"))
        return f"OK: {len(arr)} todo disimpan ({done} selesai)"

    def _assign_task(self, title, assignee):
        if self.agent_name not in ("Bagas", "Bos"):
            return "ERROR: hanya PM (Bagas) / Bos yang boleh assign task"
        names = [a["name"] for a in self.db.list_agents()]
        if assignee not in names:
            return (f"ERROR: assignee harus salah satu anggota tim: {', '.join(names)}. "
                    f"'{assignee}' bukan anggota tim (Bos pemberi task, bukan penerima).")
        tid = self.db.add_task(title, assignee, created_by=self.agent_name)
        self.db.add_message("system", "task",
                            f"Task baru #{tid} untuk {assignee}: {title} (dari {self.agent_name})")
        return f"OK: task #{tid} '{title}' -> {assignee} (backlog)"
