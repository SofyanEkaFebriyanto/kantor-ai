#!/usr/bin/env python3
"""Build divisions.json + agents.json from ~/workspace/agency-agents/INDEX.json.

Deterministic layout (seed 42): 18 division zones shelf-packed + 5 special rooms.
"""
import json, math, random, os

BASE = os.path.expanduser("~/workspace/kantor-ai-v3")
IDX = json.load(open(os.path.expanduser("~/workspace/agency-agents/INDEX.json")))
rng = random.Random(42)

DIV_COLORS = {
    "engineering": "#4f8ff7", "specialized": "#9b7ede", "marketing": "#f76fa0",
    "gis": "#34b37a", "security": "#ef5350", "design": "#ffb74d",
    "sales": "#4dd0e1", "testing": "#aed581", "paid-media": "#ba68c8",
    "project-management": "#7986cb", "academic": "#fff176",
    "game-development": "#ff8a65", "product": "#80cbc4",
    "spatial-computing": "#90a4ae", "support": "#d7ccc8", "finance": "#ffd54f",
    "healthcare": "#f48fb1", "research": "#ce93d8",
}
DIV_LABEL = {
    "engineering": "Engineering", "specialized": "Specialized", "marketing": "Marketing",
    "gis": "GIS", "security": "Security", "design": "Design",
    "sales": "Sales", "testing": "Testing", "paid-media": "Paid Media",
    "project-management": "Project Mgmt", "academic": "Academic",
    "game-development": "Game Dev", "product": "Product",
    "spatial-computing": "Spatial", "support": "Support", "finance": "Finance",
    "healthcare": "Healthcare", "research": "Research",
}
SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"]
HAIR = ["#232323", "#4a3222", "#7a4a21", "#9e9e9e", "#e8e8e8", "#6d4c41"]

# group agents per division
by_div = {}
for a in IDX:
    by_div.setdefault(a["division"], []).append(a)

# zone size from headcount
zones = []
for div, agents in by_div.items():
    n = len(agents)
    cols = math.ceil(math.sqrt(n * 1.5))
    rows = math.ceil(n / cols)
    w = cols * 2.4 + 5
    d = rows * 2.2 + 5
    zones.append({"id": div, "n": n, "w": w, "d": d, "cols": cols, "rows": rows})

# shelf packing, tallest first
zones.sort(key=lambda z: -z["d"])
MAXW, GAP = 150, 5
x, z, row_h, max_z = 0, 0, 0, 0
for zn in zones:
    if x + zn["w"] > MAXW:
        x = 0
        z += row_h + GAP
        row_h = 0
    zn["rect"] = {"x": x + zn["w"] / 2, "z": z + zn["d"] / 2, "w": zn["w"], "d": zn["d"]}
    x += zn["w"] + GAP
    row_h = max(row_h, zn["d"])
    max_z = max(max_z, z + zn["d"])
# center on x
cx = MAXW / 2
for zn in zones:
    zn["rect"]["x"] -= cx

divisions = []
agents_out = []
for zn in zones:
    div = zn["id"]
    r = zn["rect"]
    divisions.append({
        "id": div, "kind": "division",
        "name": "Divisi " + DIV_LABEL.get(div, div.title()),
        "count": zn["n"], "color": DIV_COLORS.get(div, "#90a4ae"),
        "rect": r, "baseY": 0, "cols": zn["cols"], "rows": zn["rows"],
    })
    for i, a in enumerate(by_div[div]):
        col = i % zn["cols"]
        row = (i // zn["cols"]) % zn["rows"]
        dx = r["x"] - r["w"] / 2 + 2.5 + col * 2.4
        dz = r["z"] - r["d"] / 2 + 2.6 + row * 2.2
        agents_out.append({
            "id": a["slug"], "name": a["name"], "division": div,
            "desc": a["description"], "vibe": a.get("vibe", ""),
            "brief_path": a["path"],
            "color": DIV_COLORS.get(div, "#90a4ae"),
            "skin": rng.choice(SKIN), "hair": rng.choice(HAIR),
            "desk": {"x": round(dx, 2), "y": 0, "z": round(dz, 2)},
        })

# ---- special rooms: front strip ----
front_z = max_z + GAP + 7
specials = [
    ("lobby", "Lobi", 22, 13, "#e8dcc8"),
    ("owner", "Ruang Owner", 15, 11, "#d4af6e"),
    ("musholla", "Musholla", 13, 11, "#a8c8a8"),
    ("pool", "Kolam Renang", 17, 13, "#7fc4e8"),
    ("cafe", "Rooftop Café", 19, 13, "#e8b48a"),
]
sx = -cx
for sid, label, w, d, color in specials:
    if sx + w > MAXW - cx:
        break
    divisions.append({
        "id": sid, "kind": "special", "name": label, "count": 0,
        "color": color, "rect": {"x": sx + w / 2, "z": front_z, "w": w, "d": d},
        "baseY": 3.0 if sid == "cafe" else 0,
    })
    sx += w + GAP

os.makedirs(f"{BASE}/data", exist_ok=True)
json.dump(divisions, open(f"{BASE}/data/divisions.json", "w"), ensure_ascii=False, indent=1)
json.dump(agents_out, open(f"{BASE}/data/agents.json", "w"), ensure_ascii=False, indent=1)
print(f"divisions: {len(divisions)} (18 divisi + {len(divisions)-18} ruang khusus)")
print(f"agents: {len(agents_out)}")
print("footprint x:[%.1f, %.1f] z:[0, %.1f]" % (-cx, MAXW - cx, front_z + 8))
