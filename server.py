#!/usr/bin/env python3
"""Kantor AI v3 — backend.

Melayani frontend Three.js + API live feed + published actions.
Hanya pakai stdlib (tanpa dependensi).

Published actions:
  POST /api/actions/report_agent_activity  {agent_id, status, detail}
  GET  /api/actions/get_ceo_commands?status=baru
  POST /api/actions/ack_ceo_command        {command_id, agent_id}
  POST /api/actions/complete_ceo_command   {command_id, ringkasan}

Ritme realtime (SISTEM KANTOR HIDUP):
  GET  /api/rhythm -> {fase, ritme, waktu, tanggal, hari, is_weekend, is_jumat,
                       sholat_sekarang, jadwal_hari_ini, waktu_sholat_berikutnya}
  Fase: berdatangan|kerja|istirahat|kerja_sore|pulang|weekend, di-override
  "sholat" saat window sholat (15 mnt; Jumat 11:30-13:30 = 60 mnt).
  Jadwal sholat dihitung lokal (metode Kemenag, tanpa network).

Sistem approval Bos (Fase 2):
  POST /api/approvals                      {kind, title, detail, command_id?}
                                           -> approval {status:"menunggu"}
  GET  /api/approvals[?status=menunggu]    -> daftar approval (terbaru dulu)
  POST /api/approvals/<id>/putuskan        {setuju: bool, catatan?}
                                           -> status "disetujui" / "ditolak"

KONTRAK WORKER (approval): aksi berisiko/destruktif (hapus data, deploy,
restart service, push kredensial, eksekusi eksternal, dsb) WAJIB:
  1. POST /api/approvals dulu dengan kind/title/detail yang jelas.
  2. Poll status via GET /api/approvals (atau ?status=menunggu) tiap 30 detik,
     maksimal 10 menit.
  3. Kalau "ditolak" -> BATALKAN langkah berisiko itu, dan catat pembatalan
     lewat POST /api/actions/report_agent_activity (status working/done,
     detail menjelaskan pembatalan).
  4. Kalau "disetujui" -> lanjutkan langkah, catat hasilnya seperti biasa.
Tidak ada worker yang boleh menjalankan aksi berisiko tanpa approval disetujui.

ATURAN APPROVAL TERKUNCI (gaya Lembur.id — human-in-the-loop, tidak bisa
di-override oleh worker):
  1. UANG — bayar, ubah harga, kasih diskon, aksi berbiaya.
  2. KIRIM KELUAR — posting/publish konten, email, chat ke pelanggan/pihak ketiga.
  3. HAPUS — hapus file, data, akun.
  4. DATA PELANGGAN — baca/tulis nama, nomor, alamat pembeli.
Aturan ini dikunci di level sistem (bukan cuma instruksi). Kalau worker salah
paham, perintahnya tetap ketahan di approval.
"""
import json, os, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
STATIC = os.path.join(BASE, "static")
UPLOADS = os.path.join(DATA, "uploads")
PORT = 8092
STATUSES = {"working", "reading", "running", "idle", "waiting", "done", "sholat"}
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

def approvals_path():
    return os.path.join(DATA, "approvals.json")

def goals_path():
    return os.path.join(DATA, "goals.json")

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

# ==================== FITUR CHAT NOIR ====================
# Skema pesan di data/chat.json:
#   {"id": "msg-<uuid8>", "from": "bos"|"noir", "text": "...",
#    "lampiran": "/uploads/<nama>" | null, "status": "baru"|"terbalas",
#    "created_at": "<ISO UTC>"}
# Pesan dari Bos selalu status "baru"; cron kantor-v3-chat-responder (dibuat
# terpisah) membalas dengan menambahkan pesan from="noir" status="terbalas".
CHAT_PATH = os.path.join(DATA, "chat.json")
CHAT_MAX_MSG = 2000          # panjang teks max
CHAT_KEEP = 200              # simpan max 200 pesan, GET kembalikan 50
UPLOAD_MAX = 10 * 1024 * 1024  # 10 MB
UPLOAD_ALLOW = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",   # gambar
                ".pdf", ".doc", ".docx", ".xls", ".xlsx",
                ".ppt", ".pptx", ".txt", ".md", ".csv"}            # dokumen
UPLOAD_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
               ".pdf": "application/pdf", ".doc": "application/msword",
               ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
               ".xls": "application/vnd.ms-excel",
               ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
               ".ppt": "application/vnd.ms-powerpoint",
               ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
               ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
               ".csv": "text/csv; charset=utf-8"}

import re
def _safe_filename(name):
    """Sanitasi nama file upload: buang path, hanya [A-Za-z0-9._-],
    batasi 100 char, kembalikan None bila kosong."""
    base = os.path.basename(name or "")
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._")[:100]
    if not base or "." not in base:
        return None
    return base

def _parse_multipart(handler):
    """Parse satu file dari multipart/form-data (stdlib only).
    Return (filename, content_type, data) atau None / "TOO_LARGE".
    Hard cap UPLOAD_MAX + 64KB headroom."""
    ctype = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in ctype:
        return None
    m = re.search(r'boundary=([^\s;]+)', ctype)
    if not m:
        return None
    boundary = m.group(1).strip('"').encode("latin-1")
    try:
        length = int(handler.headers.get("Content-Length", 0))
    except ValueError:
        return None
    if length <= 0 or length > UPLOAD_MAX + 65536:
        return "TOO_LARGE"
    raw = handler.rfile.read(length)
    parts = raw.split(b"--" + boundary)
    for part in parts:
        if b'filename="' not in part and b"filename='" not in part:
            continue
        head, _, body = part.partition(b"\r\n\r\n")
        if not body:
            continue
        data = body[:-2] if body.endswith(b"\r\n") else body
        fm = re.search(rb'filename="([^"]*)"', head) or re.search(rb"filename='([^']*)'", head)
        cm = re.search(rb'Content-Type:\s*([^\r\n;]+)', head)
        fname = fm.group(1).decode("latin-1", "replace") if fm else "file"
        fctype = cm.group(1).decode("latin-1", "strip").strip() if cm else "application/octet-stream"
        return (fname, fctype, data)
    return None

def chat_append(msg):
    with lock:
        msgs = load_json(CHAT_PATH, [])
        msgs.append(msg)
        msgs = msgs[-CHAT_KEEP:]
        save_json(CHAT_PATH, msgs)
    return msg
# ================== /FITUR CHAT NOIR ==================

# ==================== FITUR ORKESTRASI RAPAT ====================
# State machine rapat (SIMULASI visual yang digerakkan state server; kerja nyata
# tetap oleh worker subagent via dispatcher). Dipicu otomatis setiap POST
# /api/commands baru. Fase berbasis timestamp (transisi lazy saat dibaca):
#   gathering (kepala divisi jalan ke ruang rapat) -> in_progress (diskusi ~45 dtk)
#   -> dispersing (bubar, jalan kembali) -> idle (dibersihkan otomatis).
MEET_DUR = {"gather": 12, "discuss": 45, "disperse": 12}
MEET_IDLE = {"status": "idle"}

# keyword matching divisi (id -> daftar kata kunci, dicocokkan case-insensitive)
DIV_KEYWORDS = {
    "engineering": ["backend", "frontend", "api", "deploy", "bug", "server", "database",
                    "code", "software", "sistem", "aplikasi", "web", "devops", "cloud",
                    "ai", "model", "data", "script", "bot", "otomatis", "program"],
    "specialized": ["riset", "research", "analis", "analisis", "strategi", "strategy",
                    "konsultan", "expert", "spesialis", "audit", "insight"],
    "marketing": ["marketing", "promosi", "kampanye", "campaign", "konten", "content",
                  "brand", "iklan", "ads", "sosial media", "viral", "seo", "followers"],
    "design": ["desain", "design", "ui", "ux", "logo", "visual", "grafis", "mockup",
               "figma", "tampilan", "warna"],
    "gis": ["peta", "map", "gis", "lokasi", "geospasial", "koordinat", "wilayah", "rute"],
    "sales": ["sales", "penjualan", "jualan", "pelanggan", "customer", "lead", "closing",
              "revenue", "order"],
    "security": ["keamanan", "security", "aman", "hacker", "enkripsi", "vulnerability",
                 "firewall", "serangan"],
    "testing": ["testing", "test", "qa", "quality", "uji", "coba", "error", "lolos"],
    "academic": ["akademik", "belajar", "edukasi", "kursus", "training", "tutorial",
                 "materi", "sekolah", "siswa"],
    "finance": ["keuangan", "finance", "budget", "anggaran", "uang", "profit", "rugi",
                "akuntansi", "dividen", "saham", "investasi", "harga", "bayar"],
    "game-development": ["game", "gim", "permainan", "unity", "main", "play"],
    "paid-media": ["meta ads", "google ads", "tiktok ads", "paid", "iklan berbayar",
                   "cpc", "ctr", "budget iklan"],
    "product": ["produk", "product", "fitur", "feature", "roadmap", "rilis", "launch",
                "pengguna", "user", "pengalaman"],
    "project-management": ["proyek", "project", "timeline", "deadline", "jadwal",
                           "task", "sprint", "planning", "rencana", "progress"],
    "spatial-computing": ["ar", "vr", "3d", "spasial", "metaverse", "digital twin",
                          "immersive"],
    "support": ["support", "bantuan", "helpdesk", "cs", "keluhan", "komplain",
                "tiket", "layanan"],
    "healthcare": ["kesehatan", "health", "medis", "rumah sakit", "obat", "pasien"],
    "research": ["penelitian", "studi", "paper", "jurnal", "survei", "eksperimen",
                 "kajian", "laporan"],
}
# fallback: 5 divisi inti bila keyword tidak kena
CORE_DIVISIONS = ["engineering", "product", "marketing", "finance", "support"]

def pick_meeting_divisions(text):
    """Pilih 3-6 divisi relevan via keyword matching; fallback 5 divisi inti."""
    t = (text or "").lower()
    scored = []
    for did, kws in DIV_KEYWORDS.items():
        s = sum(1 for k in kws if k in t)
        if s:
            scored.append((s, did))
    scored.sort(key=lambda x: (-x[0], x[1]))
    picked = [d for _, d in scored[:6]]
    for d in CORE_DIVISIONS:  # pad sampai minimal 3
        if len(picked) >= 3:
            break
        if d not in picked:
            picked.append(d)
    return picked[:6]

def meeting_path():
    return os.path.join(DATA, "meeting.json")

def start_meeting(cmd_id, text):
    """Mulai rapat untuk perintah baru. Return state rapat atau None bila
    rapat sedang berjalan (jangan tumpuk)."""
    with lock:
        cur = load_json(meeting_path(), dict(MEET_IDLE))
        if cur.get("status") != "idle":
            return None
        divs = pick_meeting_divisions(text)
        parts = []
        for did in divs:
            head = next((a for a in AGENTS.values() if a["division"] == did), None)
            if not head:
                continue
            dname = next((d["name"] for d in DIVISIONS if d["id"] == did), did)
            parts.append({"agent_id": head["id"], "name": head["name"],
                          "division": did, "division_name": dname,
                          "color": head.get("color", "#4f8ff7"),
                          "skin": head.get("skin", "#f1c27d"),
                          "hair": head.get("hair", "#232323")})
        if not parts:
            return None
        now = datetime.now(timezone.utc)
        g, d, x = MEET_DUR["gather"], MEET_DUR["discuss"], MEET_DUR["disperse"]
        m = {"status": "gathering", "command_id": cmd_id, "text": text,
             "participants": parts,
             "started_at": now.isoformat(),
             "gather_until": (now + timedelta(seconds=g)).isoformat(),
             "ends_at": (now + timedelta(seconds=g + d)).isoformat(),
             "disperse_until": (now + timedelta(seconds=g + d + x)).isoformat(),
             "coord_logged": False}
        save_json(meeting_path(), m)
    names = ", ".join(p["division_name"] for p in parts)
    log_activity(f"📋 Rapat koordinasi dimulai — {len(parts)} kepala divisi "
                 f"({names}) membahas: {text[:70]}")
    return m

def _parse_iso(s):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return datetime.now(timezone.utc)

def log_meeting_done(m):
    divs = ", ".join(p["division_name"] for p in m.get("participants", []))
    q = load_json(os.path.join(DATA, "queue.json"), [])
    cmd = next((c for c in q if c["id"] == m.get("command_id")), None)
    spec = (cmd or {}).get("agent_name")
    log_activity(f"✅ Rapat selesai — {divs} sepakat mengeksekusi: "
                 f"{(m.get('text') or '')[:70]}")
    if spec:
        log_activity(f"🤝 Koordinasi antar-divisi: {spec} mulai bekerja, "
                     f"didukung {divs}.")
    else:
        log_activity("🤝 Koordinasi antar-divisi tercatat — menunggu specialist "
                     "ditugaskan dispatcher.")

def current_meeting():
    """Baca state rapat + majukan fase berdasarkan waktu (lazy transition)."""
    m = load_json(meeting_path(), dict(MEET_IDLE))
    if m.get("status") == "idle":
        return dict(MEET_IDLE)
    now = datetime.now(timezone.utc)
    if now >= _parse_iso(m.get("disperse_until", "")):
        if not m.get("coord_logged"):
            log_meeting_done(m)  # tak ada yang poll selama dispersing -> tetap laporkan
        save_json(meeting_path(), dict(MEET_IDLE))
        return dict(MEET_IDLE)
    if now >= _parse_iso(m.get("ends_at", "")):
        m["status"] = "dispersing"
    elif now >= _parse_iso(m.get("gather_until", "")):
        m["status"] = "in_progress"
    else:
        m["status"] = "gathering"
    if m["status"] == "dispersing" and not m.get("coord_logged"):
        m["coord_logged"] = True
        save_json(meeting_path(), m)
        log_meeting_done(m)
    else:
        save_json(meeting_path(), m)
    return m
# ================== /FITUR ORKESTRASI RAPAT ==================

# ==================== FITUR RITME REALTIME (SISTEM KANTOR HIDUP) ====================
# Kantor berdenyut mengikuti waktu nyata Asia/Jakarta (WIB, UTC+7).
# 5 waktu sholat dihitung SECARA LOKAL (tanpa network/API key) dengan algoritma
# posisi matahari standar, metode Kemenag: Subuh 20 derajat, Isya 18 derajat,
# lat -6.2088 lon 106.8456, ihtiyat +2 menit. Cache per hari (in-memory).
# Fase sholat (15 menit tiap waktu; Jumat 11:30-13:30 = 60 menit): semua
# aktivitas pause (status "sholat"). Ritme harian: 06-08 berdatangan,
# 08-11.30 kerja, 11.30-13.00 istirahat, 13-17 kerja sore, 17+ pulang (malam),
# Sabtu-Minggu weekend mode santai. Endpoint: GET /api/rhythm.
import math
RHYTHM_TZ = 7.0
RHYTHM_LAT, RHYTHM_LON = -6.2088, 106.8456
RHYTHM_CACHE = {}                    # "YYYY-MM-DD" -> jadwal {nama: {"jam":float,"str":"HH:MM"}}
RHYTHM_LAST_KEY = {"key": None}      # deteksi transisi fase (untuk activity log)
PRAYER_ORDER = ("subuh", "dzuhur", "ashar", "maghrib", "isya")

def _rh_fix_angle(a):
    return a % 360.0

def _rh_fix_hour(a):
    return a % 24.0

def _rh_fmt(h):
    m = int(round(_rh_fix_hour(h) * 60)) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"

def _rh_julian(y, m, d):
    if m <= 2:
        y -= 1
        m += 12
    A = y // 100
    B = 2 - A + A // 4
    return (math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1))
            + d + B - 1524.5)

def _rh_sun(jd):
    d = jd - 2451545.0
    g = _rh_fix_angle(357.529 + 0.98560028 * d)
    q = _rh_fix_angle(280.459 + 0.98564736 * d)
    L = _rh_fix_angle(q + 1.915 * math.sin(math.radians(g))
                      + 0.020 * math.sin(math.radians(2 * g)))
    e = 23.439 - 0.00000036 * d
    RA = _rh_fix_hour(math.degrees(math.atan2(
        math.cos(math.radians(e)) * math.sin(math.radians(L)),
        math.cos(math.radians(L)))) / 15.0)
    D = math.degrees(math.asin(
        math.sin(math.radians(e)) * math.sin(math.radians(L))))
    EqT = _rh_fix_hour(q / 15.0 - RA)
    return D, EqT

def _rh_hour_angle(alt_deg, lat, D):
    cosH = ((math.sin(math.radians(alt_deg))
             - math.sin(math.radians(lat)) * math.sin(math.radians(D)))
            / (math.cos(math.radians(lat)) * math.cos(math.radians(D))))
    cosH = max(-1.0, min(1.0, cosH))
    return math.degrees(math.acos(cosH)) / 15.0

def rhythm_schedule(wib):
    """Jadwal sholat hari ini (WIB). Cache per tanggal; hitung ulang bila ganti hari."""
    key = wib.strftime("%Y-%m-%d")
    if key not in RHYTHM_CACHE:
        jd = _rh_julian(wib.year, wib.month, wib.day)
        D, EqT = _rh_sun(jd)
        noon = _rh_fix_hour(12 + RHYTHM_TZ - RHYTHM_LON / 15.0 - EqT)
        def H(alt):
            return _rh_hour_angle(alt, RHYTHM_LAT, D)
        # Ashar (Syafi'i): alt = arccot(1 + tan(|lat - D|))
        asr_alt = math.degrees(math.atan(
            1.0 / (1.0 + math.tan(math.radians(abs(RHYTHM_LAT - D))))))
        raw = {"subuh": noon - H(-20.0),
               "dzuhur": noon,
               "ashar": noon + H(asr_alt),
               "maghrib": noon + H(-0.833),
               "isya": noon + H(-18.0)}
        sched = {k: {"jam": _rh_fix_hour(v + 2 / 60.0),  # ihtiyat Kemenag ~2 mnt
                     "str": _rh_fmt(v + 2 / 60.0)}
                 for k, v in raw.items()}
        RHYTHM_CACHE.clear()
        RHYTHM_CACHE[key] = sched
    return RHYTHM_CACHE[key]

def rhythm_state(now_wib=None):
    """State ritme realtime. Fase: berdatangan|kerja|istirahat|kerja_sore|
    pulang|weekend, di-override 'sholat' saat window sholat."""
    wib = now_wib or (datetime.now(timezone.utc) + timedelta(hours=RHYTHM_TZ))
    sched = rhythm_schedule(wib)
    wd = wib.weekday()  # 0=Senin..6=Minggu; Jumat=4
    t = wib.hour + wib.minute / 60.0 + wib.second / 3600.0
    friday = (wd == 4)
    # window sholat: 15 menit sejak tiap waktu sholat;
    # Jumat: 11:30-13:30 (60 menit, sholat Jumat)
    sholat_now = None
    if friday and 11.5 <= t < 13.5:
        sholat_now = "dzuhur"
    else:
        for nama in PRAYER_ORDER:
            pj = sched[nama]["jam"]
            if pj <= t < pj + 0.25:
                sholat_now = nama
                break
    if sholat_now:
        fase, ritme = "sholat", "sholat"
    elif wd >= 5:
        fase, ritme = "weekend", "weekend"
    elif 6.0 <= t < 8.0:
        fase, ritme = "berdatangan", "pagi"
    elif 8.0 <= t < 11.5:
        fase, ritme = "kerja", "pagi"
    elif 11.5 <= t < 13.0:
        fase, ritme = "istirahat", "siang"
    elif 13.0 <= t < 17.0:
        fase, ritme = "kerja_sore", "sore"
    else:
        fase, ritme = "pulang", "malam"
    nxt, nxt_in = None, None
    for nama in PRAYER_ORDER:
        pj = sched[nama]["jam"]
        if pj > t:
            nxt, nxt_in = nama, pj - t
            break
    if nxt is None:
        nxt, nxt_in = "subuh", sched["subuh"]["jam"] + 24.0 - t
    # transisi fase -> catat ke activity log (sekali per perubahan)
    with lock:
        if RHYTHM_LAST_KEY["key"] != (fase, sholat_now):
            RHYTHM_LAST_KEY["key"] = (fase, sholat_now)
            if fase == "sholat":
                log_activity(f"🕌 ADZAN {sholat_now.upper()} — seluruh kantor "
                             f"pause sholat, karakter menuju musholla")
            elif fase == "weekend":
                log_activity("🌿 Mode weekend — kantor santai, aktivitas minimal")
    return {
        "fase": fase,
        "ritme": ritme,
        "waktu": wib.strftime("%H:%M"),
        "tanggal": wib.strftime("%Y-%m-%d"),
        "hari": ["Senin", "Selasa", "Rabu", "Kamis", "Jumat",
                 "Sabtu", "Minggu"][wd],
        "is_weekend": wd >= 5,
        "is_jumat": friday,
        "sholat_sekarang": sholat_now,
        "jadwal_hari_ini": {k: v["str"] for k, v in sched.items()},
        "waktu_sholat_berikutnya": {"nama": nxt, "jam": sched[nxt]["str"],
                                    "dalam_menit": round(nxt_in * 60)},
    }
# ================== /FITUR RITME REALTIME ==================

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
        if path == "/api/meeting":
            # status rapat aktif (state machine orkestrasi rapat); bukan published action
            return self._send(200, current_meeting())
        if path == "/api/rhythm":
            # ritme realtime kantor (waktu Jakarta): fase, jadwal sholat, dsb.
            return self._send(200, rhythm_state())
        if path == "/api/approvals":
            # daftar approval (terbaru dulu); opsional ?status=menunggu|disetujui|ditolak
            want = qs.get("status", [None])[0]
            with lock:
                ap = load_json(approvals_path(), [])
            items = [a for a in ap if a["status"] == want] if want else ap
            return self._send(200, {"approvals": list(reversed(items))})
        if path == "/api/goals":
            # daftar target/progres (untuk tab Goals)
            with lock:
                goals = load_json(goals_path(), [])
            return self._send(200, {"goals": goals})
        if path == "/api/chat":
            # riwayat chat Bos <-> Noir/manager, 50 terakhir; ?thread=noir|mgr:<divisi>
            want_thread = qs.get("thread", [None])[0]
            with lock:
                msgs = load_json(CHAT_PATH, [])
            if want_thread:
                msgs = [m for m in msgs if m.get("thread", "noir") == want_thread]
            return self._send(200, {"messages": msgs[-50:]})
        if path == "/api/managers":
            # kepala tiap divisi (agent pertama) — untuk chat manager ala video TikTok
            mgrs = []
            for d in DIVISIONS:
                did = d["id"]
                head = next((a for a in AGENTS.values() if a["division"] == did), None)
                if head:
                    mgrs.append({"division": did, "division_name": d["name"],
                                 "agent_id": head["id"], "name": head["name"],
                                 "role": "Manager " + d["name"].replace("Divisi ", ""),
                                 "color": head.get("color", d.get("color", "#4f8ff7"))})
            return self._send(200, {"managers": mgrs})
        if path.startswith("/uploads/"):
            # file lampiran chat; di-serve dari data/uploads (bukan static)
            return self._serve_upload(path[len("/uploads/"):])
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

    def _serve_upload(self, rel):
        # serve file lampiran chat dari data/uploads; anti path-traversal
        from urllib.parse import unquote
        rel = unquote(rel)
        full = os.path.normpath(os.path.join(UPLOADS, rel))
        if not full.startswith(UPLOADS + os.sep) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        ext = os.path.splitext(full)[1].lower()
        ctype = UPLOAD_MIME.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._send(404, {"error": "not found"})
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", f'inline; filename="{os.path.basename(full)}"')
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def _handle_upload(self):
        """POST /api/upload — multipart/form-data, 1 file, max 10MB,
        gambar+dokumen saja. Return {ok:true, url:"/uploads/<nama-aman>"}."""
        parsed = _parse_multipart(self)
        if parsed == "TOO_LARGE":
            return self._send(413, {"error": "file terlalu besar (max 10MB)",
                                    "code": "FILE_TOO_LARGE"})
        if not parsed:
            return self._send(400, {"error": "kirim 1 file via multipart/form-data (field 'file')",
                                    "code": "NO_FILE"})
        fname, fctype, data = parsed
        if len(data) > UPLOAD_MAX:
            return self._send(413, {"error": "file terlalu besar (max 10MB)",
                                    "code": "FILE_TOO_LARGE"})
        safe = _safe_filename(fname)
        ext = os.path.splitext(safe or "")[1].lower() if safe else ""
        if not safe or ext not in UPLOAD_ALLOW:
            return self._send(400, {"error": "tipe file tidak didukung (gambar & dokumen saja)",
                                    "code": "BAD_FILETYPE"})
        os.makedirs(UPLOADS, exist_ok=True)
        stored = f"{uuid.uuid4().hex[:8]}-{safe}"
        with open(os.path.join(UPLOADS, stored), "wb") as f:
            f.write(data)
        log_activity(f"📎 Lampiran chat diupload: {safe} ({len(data)} bytes)")
        return self._send(200, {"ok": True, "url": f"/uploads/{stored}",
                                "name": safe, "size": len(data)})

    # ---------- POST ----------
    def do_POST(self):
        p = self._route_path()
        if p.startswith("REDIRECT:"):
            return self._send(400, {"error": "pakai trailing slash: /kantorv3/"})
        path = p
        if path == "/api/upload":
            # multipart/form-data — parse sebelum _body() karena body bukan JSON
            return self._handle_upload()
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
            # orkestrasi rapat: kepala divisi relevan otomatis rapat (simulasi visual)
            start_meeting(cmd["id"], text)
            return self._send(200, {"ok": True, "command": cmd})

        if path == "/api/chat":
            # kirim pesan chat dari Bos; balasan ditulis cron chat-responder
            # thread: "noir" (default) atau "mgr:<division_id>" untuk chat manager
            text = (data.get("message") or "").strip()
            lampiran = data.get("lampiran")
            thread = (data.get("thread") or "noir").strip()[:40]
            if thread != "noir":
                div_ids = set(d["id"] for d in DIVISIONS)
                if not thread.startswith("mgr:") or thread[4:] not in div_ids:
                    return self._send(400, {"error": "thread tidak valid", "code": "BAD_THREAD"})
            if not text:
                return self._send(400, {"error": "message kosong", "code": "EMPTY_MSG"})
            if len(text) > CHAT_MAX_MSG:
                return self._send(400, {"error": f"message kepanjangan (max {CHAT_MAX_MSG})",
                                        "code": "MSG_TOO_LONG"})
            if lampiran is not None:
                lampiran = str(lampiran)[:500]
                # hanya terima url lampiran yang dihasilkan /api/upload
                if not lampiran.startswith("/uploads/"):
                    return self._send(400, {"error": "lampiran tidak valid", "code": "BAD_ATTACH"})
            msg = {"id": "msg-" + uuid.uuid4().hex[:8], "from": "bos", "text": text,
                   "lampiran": lampiran or None, "status": "baru",
                   "thread": thread,
                   "created_at": now_iso()}
            chat_append(msg)
            return self._send(200, {"ok": True, "message": msg})

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

        if path == "/api/goals":
            # Buat target baru: {title, target, division?}
            title = (data.get("title") or "").strip()
            target = (data.get("target") or "").strip()
            division = (data.get("division") or "").strip() or None
            if not title:
                return self._send(400, {"error": "title kosong"})
            g = {"id": "gol-" + uuid.uuid4().hex[:8], "title": title[:200],
                 "target": target[:200], "division": division,
                 "progress": 0, "status": "jalan",
                 "created_at": now_iso(), "updated_at": now_iso()}
            with lock:
                goals = load_json(goals_path(), [])
                goals.append(g)
                save_json(goals_path(), goals)
            log_activity(f"🎯 Target baru: {title[:80]}")
            return self._send(200, {"ok": True, "goal": g})

        if path.startswith("/api/goals/") and path.endswith("/progress"):
            # Update progres: {progress: 0-100, catatan?}
            gid = path[len("/api/goals/"):-len("/progress")]
            try:
                prog = int(data.get("progress"))
            except (TypeError, ValueError):
                return self._send(400, {"error": "progress harus angka 0-100"})
            prog = max(0, min(100, prog))
            catatan = (data.get("catatan") or "").strip()[:500] or None
            with lock:
                goals = load_json(goals_path(), [])
                g = next((x for x in goals if x["id"] == gid), None)
                if not g:
                    return self._send(404, {"error": "goal tidak ketemu"})
                g["progress"] = prog
                if catatan:
                    g["catatan"] = catatan
                if prog >= 100:
                    g["status"] = "selesai"
                g["updated_at"] = now_iso()
                save_json(goals_path(), goals)
            if prog >= 100:
                log_activity(f"🏆 Target tercapai: {g['title'][:80]}")
            return self._send(200, {"ok": True, "goal": g})

        if path == "/api/approvals":
            # Minta approval Bos: status awal "menunggu".
            kind = (data.get("kind") or "umum").strip()[:60] or "umum"
            title = (data.get("title") or "").strip()
            detail = (data.get("detail") or "").strip()
            command_id = (data.get("command_id") or "").strip() or None
            if not title:
                return self._send(400, {"error": "title kosong"})
            if len(title) > 200:
                return self._send(400, {"error": "title kepanjangan (max 200)"})
            apr = {"id": "apr-" + uuid.uuid4().hex[:8], "kind": kind,
                   "title": title, "detail": detail[:2000],
                   "command_id": command_id, "status": "menunggu",
                   "catatan": None, "created_at": now_iso(), "decided_at": None}
            with lock:
                ap = load_json(approvals_path(), [])
                ap.append(apr)
                save_json(approvals_path(), ap)
            log_activity(f"🛡️ Approval diminta ({kind}): {title[:80]}")
            return self._send(200, {"ok": True, "approval": apr})

        if path.startswith("/api/approvals/") and path.endswith("/putuskan"):
            # Bos memutuskan: {setuju: bool, catatan?} -> disetujui/ditolak.
            aid = path[len("/api/approvals/"):-len("/putuskan")]
            setuju = data.get("setuju")
            catatan = (data.get("catatan") or "").strip()[:500] or None
            if not isinstance(setuju, bool):
                return self._send(400, {"error": "setuju harus bool"})
            with lock:
                ap = load_json(approvals_path(), [])
                apr = next((a for a in ap if a["id"] == aid), None)
                if not apr:
                    return self._send(404, {"error": "approval tidak ketemu"})
                if apr["status"] != "menunggu":
                    return self._send(409, {"error": f"approval sudah {apr['status']}"})
                apr["status"] = "disetujui" if setuju else "ditolak"
                apr["catatan"] = catatan
                apr["decided_at"] = now_iso()
                save_json(approvals_path(), ap)
            ikon = "✅" if setuju else "⛔"
            log_activity(f"{ikon} Approval {apr['status']}: {apr['title'][:80]}"
                         + (f" — {catatan[:60]}" if catatan else ""))
            return self._send(200, {"ok": True, "approval": apr})

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
    os.makedirs(UPLOADS, exist_ok=True)
    # single-flight: hanya 1 instance boleh jalan; pendaftar lain keluar diam-diam.
    # (mencegah race keepalive: dua start bersamaan -> Address already in use)
    _lockf = open(os.path.join(DATA, "server.lock"), "w")
    try:
        fcntl.flock(_lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f"port {PORT}: server lain sedang berjalan — keluar.", flush=True)
        raise SystemExit(0)
    for name, default in (("queue.json", []), ("live.json", {}), ("dispatch.json", {}),
                          ("meeting.json", {"status": "idle"}),
                          ("approvals.json", []), ("chat.json", [])):
        fp = os.path.join(DATA, name)
        if not os.path.exists(fp):
            save_json(fp, default)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Kantor AI v3 listening on 127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
