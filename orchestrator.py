"""orchestrator.py — loop utama kantor-ai.

Tiap tick:
  (a) agent dengan task 'doing' yang stale (>idle_nudge_mins) -> lanjutin
  (b) ada task backlog -> Bagas assign / agent ambil
  (c) round-robin free chat (1 pesan pendek), kecuali quiet hours
Event: standup 09:00, istirahat 12:00 (sekali sehari, WIB).
Pacing: max_turns_per_hour giliran agent per jam.
"""
import re
import time
import traceback

WIB = 7 * 3600


def now_wib():
    return time.gmtime(time.time() + WIB)


def hhmm():
    t = now_wib()
    return f"{t.tm_hour:02d}:{t.tm_min:02d}"


def today():
    t = now_wib()
    return f"{t.tm_year:04d}-{t.tm_mon:02d}-{t.tm_mday:02d}"


def in_quiet(now_hhmm, qstart, qend):
    if qstart <= qend:
        return qstart <= now_hhmm < qend
    return now_hhmm >= qstart or now_hhmm < qend


class Orchestrator:
    def __init__(self, cfg, db, agents, llm_factory, log_fn):
        self.cfg = cfg
        self.db = db
        self.agents = {a.name: a for a in agents}   # name -> Agent
        self.order = [a.name for a in agents]       # round-robin
        self.llm_factory = llm_factory
        self.log = log_fn
        o = cfg["orchestrator"]
        self.tick_secs = o.get("tick_secs", 90)
        self.max_turns = o.get("max_turns_per_hour", 8)
        self.nudge_mins = o.get("idle_nudge_mins", 10)
        self.standup_at = o.get("standup_time", "09:00")
        self.lunch_at = o.get("lunch_time", "12:00")
        self.qstart = o.get("quiet_start", "23:00")
        self.qend = o.get("quiet_end", "06:00")
        self._rr_idx = 0
        self._turn_times = []

    # -- pacing --
    def _budget_ok(self):
        cutoff = time.time() - 3600
        self._turn_times = [t for t in self._turn_times if t > cutoff]
        return len(self._turn_times) < self.max_turns

    def _spend(self):
        self._turn_times.append(time.time())

    # -- events --
    def _maybe_event(self):
        day = today()
        now = hhmm()
        if now >= self.standup_at and \
                not self.db.get_memory("Bagas", f"event:standup:{day}"):
            self.db.set_memory("Bagas", f"event:standup:{day}", "1")
            self.db.add_message(
                "Bagas", "chat",
                "Standup pagi! Satu baris aja per orang: kemarin ngapain, hari ini mau ngapain, ada blocker apa. Mulai dari gw: mastiin board rapi dan task ke-assign. Lanjut!")
            self.log("[event] standup")
            return True
        if now >= self.lunch_at and \
                not self.db.get_memory("Bagas", f"event:lunch:{day}"):
            self.db.set_memory("Bagas", f"event:lunch:{day}", "1")
            self.db.add_message(
                "Bagas", "chat",
                "Jam 12 nih, istirahat dulu gih. Yang task-nya doing boleh lanjut kalau tanggung, yang lain santai dulu.")
            self.log("[event] lunch")
            return True
        return False

    # -- turn selection --
    def _pick(self):
        """Return (agent_name, directive) atau (None, None)."""
        quiet = in_quiet(hhmm(), self.qstart, self.qend)

        # (0) Bos baru ngomong -> wajib dibales duluan (prioritas tertinggi)
        boss_mid = self.db.get_memory("orchestrator", "boss_pending", "")
        replied = self.db.get_memory("orchestrator", "boss_replied", "")
        if boss_mid and boss_mid != replied:
            self.db.set_memory("orchestrator", "boss_replied", boss_mid)
            text = ""
            for m in self.db.recent_messages(30):
                if str(m["id"]) == str(boss_mid) and m["sender"] == "Bos":
                    text = m["text"]
                    break
            # kalau mention @Nama, yang disebut yang jawab; kalau bukan, round-robin
            responder = None
            mm = re.search(r"@(\w+)", text or "")
            if mm and mm.group(1) in self.agents:
                responder = mm.group(1)
            if not responder:
                responder = self.order[self._rr_idx % len(self.order)]
                self._rr_idx += 1
            return responder, (
                f"Bos baru aja bilang di chat: \"{text}\". "
                f"JAWAB LANGSUNG 1-3 kalimat, natural kayak rekan kerja. "
                f"Kalau itu perintah kerjaan konkret dan lo bisa, kerjain pakai tools "
                f"lalu lapor singkat. Kalau cuma sapaan/tes, jawab santai aja, jangan lebay.")

        # (a) task doing yang stale -> assignee lanjutin (max 1 nudge per task per nudge_mins)
        stale = self.db.stale_doing_tasks(self.nudge_mins * 60)
        now_ts = time.time()
        fresh = []
        for t in stale:
            try:
                last_nudge = float(self.db.get_memory("orchestrator", f"nudge:{t['id']}", "0"))
            except ValueError:
                last_nudge = 0
            if now_ts - last_nudge >= self.nudge_mins * 60:
                fresh.append(t)
        if fresh:
            t = fresh[0]
            if t["assignee"] in self.agents:
                self.db.set_memory("orchestrator", f"nudge:{t['id']}", str(now_ts))
                return t["assignee"], (
                    f"Task #{t['id']} '{t['title']}' status doing tapi {self.nudge_mins}+ menit "
                    f"tanpa update. LANJUTIN pakai tools sampai ada progres nyata, lalu lapor "
                    f"1-2 kalimat. Kalau selesai, update task jadi done via... "
                    f"(catatan: ubah status task dengan menulis pesan '[DONE #id]' di chat, "
                    f"orchestrator yang akan update board).")

        # (b) backlog -> Bagas assign, atau agent ambil sendiri
        backlog = self.db.list_tasks("backlog")
        # abaikan task yang assignee-nya bukan anggota tim (data sampah)
        backlog = [t for t in backlog if t["assignee"] in self.agents]
        if backlog:
            t = backlog[0]
            members = ", ".join(self.order)
            if t["assignee"] != "Bagas":
                return t["assignee"], (
                    f"Ada task backlog #{t['id']} '{t['title']}' untuk lo. "
                    f"MULAI kerjain sekarang pakai tools. Pertama: bikin todo list via todo_write, "
                    f"lalu eksekusi sampai SELESAI BENERAN (file ada, bisa dibaca balik). "
                    f"JANGAN klaim selesai sebelum hasilnya terverifikasi via read_file/list_dir. "
                    f"Kalau selesai, tulis '[DONE #id]' di pesan terakhir lo.")
            # Bagas assign
            return "Bagas", (
                f"Ada {len(backlog)} task backlog. Pilih 1 yang paling prioritas, assign ke anggota "
                f"tim pakai assign_task. ATURAN KERAS: assignee HARUS salah satu dari: {members}. "
                f"DILARANG assign ke diri sendiri (Bagas) atau ke Bos. "
                f"Jelaskan singkat di chat kenapa lo pilih dia. "
                f"Task: " + "; ".join(f"#{x['id']} '{x['title']}'" for x in backlog[:5]))

        # (c) free chat round-robin (skip saat quiet hours)
        if quiet:
            return None, None
        name = self.order[self._rr_idx % len(self.order)]
        self._rr_idx += 1
        return name, (
            "Obrolan santai kantor 1 pesan pendek (maks 3 kalimat). Boleh nanggepin obrolan "
            "terakhir, nanya kabar kerjaan tim, atau lempar ide. Jangan bahas task board "
            "kecuali relevan. Natural aja kayak lagi di pantry.")

    def _apply_done_markers(self, text, agent_name):
        import re
        for m in re.findall(r"\[DONE\s+#(\d+)\]", text or ""):
            tid = int(m)
            t = self.db.get_task(tid)
            if t and t["status"] != "done":
                self.db.update_task(tid, status="done")
                self.db.add_message("system", "task",
                                    f"Task #{tid} '{t['title']}' DONE (ditandai {agent_name}).")
                self.log(f"[task] #{tid} done by {agent_name}")

    def tick(self):
        try:
            if self._maybe_event():
                return
            if not self._budget_ok():
                return
            pick = self._pick()
            if not pick[0]:
                return
            name, directive = pick
            agent = self.agents[name]
            self.log(f"[turn] {name}: {directive[:80]}...")
            # tools: semua agent dapat full set; assign_task dibatasi di eksekutor
            from tools import TOOL_SCHEMAS
            text = agent.turn(directive, TOOL_SCHEMAS)
            self._apply_done_markers(text, name)
            # tandai doing: kalau agent mulai task backlog miliknya -> doing
            for t in self.db.list_tasks("backlog"):
                if t["assignee"] == name:
                    self.db.update_task(t["id"], status="doing")
                    self.log(f"[task] #{t['id']} -> doing ({name})")
                    break
            self._spend()
        except Exception:
            self.log("[orchestrator-error]\n" + traceback.format_exc())

    def run_forever(self):
        self.log(f"[orchestrator] start, tick {self.tick_secs}s, agents={self.order}")
        self.db.add_message("system", "system", "kantor-ai mulai shift. Selamat bekerja!")
        while True:
            self.tick()
            time.sleep(self.tick_secs)
