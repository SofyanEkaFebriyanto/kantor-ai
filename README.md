# kantor-ai 🏢

Tim multi-agent AI yang kerja beneran — terinspirasi video TikTok "kantor AI".
5 agent (Bagas/PM, Dimas/backend, Putri/frontend, Eko/QA, Intan/riset) ngobrol,
bikin task, dan ngerjain pakai tools beneran (baca/tulis file, shell, webfetch).
Jalan 24/7 di STB via systemd, LLM numpang 9Router (model gratis).

## Arsitektur

```
main.py           entry: orchestrator thread + web UI thread
orchestrator.py   loop tiap 90 dtk: pilih siapa yang jalan
agent.py          prompt (persona + board + 30 pesan terakhir + todo) + tool loop (max 6 step)
llm.py            client OpenAI-compatible -> 9Router (urllib, stdlib)
tools.py          read/write/edit/list file, exec (sandbox), webfetch, todo, assign_task
state.py          SQLite: messages, tasks, memories, agent_status
web.py            UI: feed chat live, task board, status tim, "Ngomong sebagai Bos"
config.yaml       daftar agent + setting orchestrator
```

**Siklus kerja:** tiap tick orchestrator tentuin 1 agent jalan —
(a) yang punya task `doing` stale >10 mnt lanjutin, (b) backlog → Bagas assign /
agent ambil, (c) free chat round-robin (skip 23:00–06:00 WIB).
Event: standup 09:00, istirahat 12:00. Pacing: max 8 giliran/jam (hemat rate limit).

**API key 9Router:** dibaca transient saat start dari `NINEROUTER_API_KEY`,
atau `LLM_API_KEY` di `/opt/noir-brain/.env`. Tidak pernah ditulis ke disk kantor-ai.

## Safety model

- `exec` di-jail ke `/opt/kantor-ai/work`: path absolut di luar jail & `..` ditolak.
- Denylist: `rm -rf /`, `mkfs`, `shutdown/reboot`, `curl|sh`, `wget|sh`, fork bomb, dsb.
- File kredensial (`.env`, `*key*`, `*secret*`, `*token*`, `.ssh`, dsb) tidak bisa
  dibaca/ditulis/disebut di perintah shell.
- Web UI **tanpa auth** — aman hanya karena akses via Tailscale. JANGAN expose
  port 8091 ke publik tanpa pasang auth (basic auth / Cloudflare Access).
- Service jalan sebagai user `noir` (bukan root) — cukup untuk baca key 9Router
  dan tulis ke /opt/kantor-ai.

## Operasional (di STB)

```bash
systemctl status kantor-ai        # cek service
journalctl -u kantor-ai -f        # log systemd
tail -f /opt/kantor-ai/data/orchestrator.log
sqlite3 /opt/kantor-ai/data/office.db "select sender, substr(text,1,80) from messages order by id desc limit 10;"
systemctl restart kantor-ai
```

UI: `http://100.84.6.21:8091` (via Tailscale).
Perintah Bos di UI: `/tugas @Dimas bikin API login` → masuk backlog & di-assign.

## Tambah/ubah agent

Edit `config.yaml` → tambah entry di `agents:` (nama, role, persona, model),
lalu `systemctl restart kantor-ai`. Task untuk agent baru bisa di-assign
dari UI sebagai Bos.

## Ganti model

`model:` per agent di config.yaml, atau `llm.default_model` untuk semua.
Daftar model: `curl http://127.0.0.1:20128/v1/models` di STB.
