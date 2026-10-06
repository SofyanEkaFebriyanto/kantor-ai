"""agent.py — satu anggota tim kantor-ai: prompt + tool-calling loop."""
import json
import time

SYSTEM_RULES = """Aturan main:
- Lo kerja di kantor virtual bareng tim. Semua output lo dibaca tim & Bos.
- Setiap giliran: lakukan SATU aksi bermakna — ngomong di chat ATAU kerjain sesuatu pakai tools. Jangan bertele-tele.
- Kalau pakai tools dan hasilnya penting buat tim, akhiri dengan 1 pesan ringkas (maks 2 kalimat) tentang hasilnya.
- Kalau cuma ngobrol, 1 pesan pendek (maks 3 kalimat), nyambung sama obrolan terakhir.
- Bahasa: Indonesia casual (gw/lo), profesional tapi santai. JANGAN pakai pola AI-slop (jangan sok puitis, jangan bullet-point berlebihan kalau ngobrol).
- Jangan ngarang fakta/angka. Jangan sebut lo AI generik — lo {name}, {role} di kantor ini.
- Work dir lo: {work_dir} (path relatif, mis. 'laporan.md').
- Waktu sekarang (WIB): {now_wib}
"""


def _fmt_tasks(tasks):
    if not tasks:
        return "(board kosong)"
    lines = []
    for t in tasks[:15]:
        lines.append(f"#{t['id']} [{t['status']}] {t['title']} -> {t['assignee']}")
    return "\n".join(lines)


def _fmt_msgs(msgs):
    lines = []
    for m in msgs:
        tag = {"chat": "", "task": "[TASK] ", "system": "[SYS] "}.get(m["kind"], "")
        text = m["text"]
        if len(text) > 400:
            text = text[:400] + "..."
        lines.append(f"{m['sender']}: {tag}{text}")
    return "\n".join(lines) if lines else "(belum ada pesan)"


class Agent:
    def __init__(self, cfg, llm, db, runner_factory, work_dir, log_fn):
        self.name = cfg["name"]
        self.role = cfg.get("role", "")
        self.persona = cfg.get("persona", "")
        self.llm = llm  # LLMClient (model bisa dioverride per agent via cfg)
        self.db = db
        self.runner = runner_factory(self.name)
        self.work_dir = work_dir
        self.log = log_fn
        self.max_steps = 6

    def _now_wib(self):
        return time.strftime("%A %Y-%m-%d %H:%M", time.localtime(time.time() + 0))

    def build_messages(self, directive):
        """directive: instruksi spesifik giliran ini dari orchestrator."""
        tasks = self.db.list_tasks()
        msgs = self.db.recent_messages(30)
        todos_raw = self.db.get_memory(self.name, "todos", "[]")
        try:
            todos = json.loads(todos_raw)
            todo_line = "; ".join(
                f"[{'x' if t.get('done') else ' '}] {t.get('t','')}" for t in todos[:8])
        except Exception:
            todo_line = "-"
        my_tasks = [t for t in tasks if t["assignee"] == self.name and t["status"] != "done"]

        system = (
            f"Lo adalah {self.name}, {self.role} di kantor-ai.\n{self.persona}\n\n"
            + SYSTEM_RULES.format(name=self.name, role=self.role,
                                 work_dir=self.work_dir, now_wib=self._now_wib())
        )
        context = (
            f"=== TASK BOARD ===\n{_fmt_tasks(tasks)}\n\n"
            f"=== TASK LO ({self.name}) ===\n" +
            ("\n".join(f"#{t['id']} [{t['status']}] {t['title']}" for t in my_tasks[:5])
             if my_tasks else "(tidak ada)") + "\n\n"
            f"=== TODO LO ===\n{todo_line or '-'}\n\n"
            f"=== OBROLAN TERAKHIR ===\n{_fmt_msgs(msgs)}\n\n"
            f"=== INSTRUKSI GILIRAN INI ===\n{directive}"
        )
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": context},
        ]

    def turn(self, directive, tools):
        """Jalankan 1 giliran. Return pesan akhir (atau '' bila murni tool work).
        tools=None -> chat murni tanpa tool calls."""
        messages = self.build_messages(directive)
        self.db.set_agent_status(self.name, "working")
        final_text = ""
        used_tools = False
        try:
            for step in range(self.max_steps):
                text, tool_calls = self.llm.chat(messages, tools=tools,
                                                 max_tokens=800)
                if not tool_calls:
                    final_text = (text or "").strip()
                    break
                used_tools = True
                messages.append({"role": "assistant", "content": text or "",
                                 "tool_calls": [
                                     {"id": tc["id"], "type": "function",
                                      "function": {"name": tc["name"],
                                                   "arguments": json.dumps(tc["arguments"],
                                                                           ensure_ascii=False)}}
                                     for tc in tool_calls]})
                for tc in tool_calls:
                    result = self.runner.run(tc["name"], tc["arguments"])
                    self.log(f"[tool-result] {self.name}/{tc['name']}: {str(result)[:200]}")
                    messages.append({"role": "tool", "tool_call_id": tc["id"],
                                     "content": str(result)[:4000]})
            else:
                final_text = (text or "").strip()
        except Exception as e:
            self.log(f"[agent-error] {self.name}: {e}")
            final_text = ""
        finally:
            self.db.set_agent_status(self.name, "idle")

        if final_text:
            # simpan memori singkat: rangkuman aksi terakhir (hemat, 1 baris)
            self.db.add_message(self.name, "chat", final_text)
            self.log(f"[chat] {self.name}: {final_text[:160]}")
        elif used_tools:
            self.db.add_message("system", "system",
                                f"{self.name} menyelesaikan kerjaan via tools (tanpa pesan chat).")
        return final_text
