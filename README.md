# Kantor AI v3 — Diorama 3D Isometrik

Webapp monitoring/orchestration **267 AI agent** dalam **18 divisi**, divisualkan
sebagai satu gedung kantor 3D isometrik bergaya chibi (Three.js/WebGL asli).

**Live:** https://sefy.my.id/kantorv3/

## Konsep

- 1 agent aktif = 1 karakter chibi 3D yang animasinya mencerminkan aktivitas nyatanya:
  `working` (mengetik), `reading`, `running`, `idle`, `waiting`, `done`.
- Backend mengirim snapshot live; snapshot kosong/basi → mode ambient
  (karakter bergerak prosedural, jelas dibedakan dari data live).
- 18 zona divisi + 5 ruang khusus: Lobi, Ruang Owner, Musholla, Kolam Renang,
  Rooftop Café. Label nama anti-tabrakan, HUD (jam WIB, notifikasi, activity log),
  direktori 267 agent, panel **"Perintah ke Noir"**.

## Cara jalan

```bash
python3 tools/build_data.py   # generate data/divisions.json + data/agents.json (sekali saja)
python3 server.py             # http://127.0.0.1:8092
```

Tanpa dependensi — hanya Python stdlib. Frontend: Three.js via CDN.

## Cara kerja live feed

1. Bos kirim perintah bahasa natural via panel → antrean (`POST /api/commands`).
2. Dispatcher (cron tiap 2 menit) mencocokkan perintah dengan 267 persona
   spesialis (`agency-agents`), ACK via published action, lalu spawn **worker
   subagent beneran** yang mengerjakan tugasnya.
3. Worker lapor via published actions → karakternya animasi `working` secara live
   di kantor 3D → selesai → `done` + ringkasan di antrean.

## Published actions

| Action | Method | Deskripsi |
|---|---|---|
| `report_agent_activity` | `POST /api/actions/report_agent_activity` | `{agent_id, status, detail}` |
| `get_ceo_commands` | `GET /api/actions/get_ceo_commands?status=baru` | Ambil perintah Bos |
| `ack_ceo_command` | `POST /api/actions/ack_ceo_command` | `{command_id, agent_id}` → diproses |
| `complete_ceo_command` | `POST /api/actions/complete_ceo_command` | `{command_id, ringkasan}` → selesai |

## Struktur

```
server.py          # backend stdlib: static + API + published actions
static/            # frontend Three.js (index.html, app.js, style.css)
tools/build_data.py# generate data kantor dari agency-agents/INDEX.json
data/divisions.json# 23 zona (18 divisi + 5 ruang khusus) + layout
data/agents.json   # 267 agent + posisi meja
```

## Batasan jujur

- 267 persona = brief spesialis; yang "kerja beneran" adalah worker yang
  di-spawn per perintah — sisanya tampil ambient (bukan dummy disamarkan live).
- Deploy referensi: VM (port 8092) → publik via SSH reverse tunnel ke STB →
  Cloudflare Tunnel path `/kantorv3/*`.
