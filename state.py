"""state.py — SQLite persistence kantor-ai (stdlib sqlite3)."""
import json
import os
import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  sender TEXT NOT NULL,
  kind TEXT NOT NULL,          -- chat | task | system
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog',  -- backlog | doing | done
  created_by TEXT NOT NULL,
  updated_ts REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  agent TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_ts REAL NOT NULL,
  PRIMARY KEY (agent, key)
);
CREATE TABLE IF NOT EXISTS agent_status (
  agent TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'idle',      -- idle | working
  current_task TEXT NOT NULL DEFAULT '',
  last_seen REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
"""


class DB:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def _q(self, sql, args=(), one=False, commit=False):
        with self._lock:
            cur = self._conn.execute(sql, args)
            if commit:
                self._conn.commit()
            rows = cur.fetchall()
        if one:
            return dict(rows[0]) if rows else None
        return [dict(r) for r in rows]

    # -- agents (dari config, disimpan di memori proses; helper validasi nama) --
    def set_agent_names(self, names):
        self._agent_names = list(names)
        now = time.time()
        for n in names:
            self._q("INSERT OR IGNORE INTO agent_status (agent, last_seen) VALUES (?, ?)",
                    (n, 0), commit=True)

    def list_agents(self):
        return [{"name": n} for n in getattr(self, "_agent_names", [])]

    # -- messages --
    def add_message(self, sender, kind, text):
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO messages (ts, sender, kind, text) VALUES (?, ?, ?, ?)",
                (time.time(), sender, kind, text))
            self._conn.commit()
            return cur.lastrowid

    def recent_messages(self, limit=30):
        rows = self._q(
            "SELECT * FROM messages ORDER BY id DESC LIMIT ?", (limit,))
        return list(reversed(rows))

    def messages_since(self, last_id, limit=200):
        return self._q(
            "SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?",
            (last_id, limit))

    def count_messages(self):
        r = self._q("SELECT COUNT(*) c FROM messages", one=True)
        return r["c"]

    # -- tasks --
    def add_task(self, title, assignee, created_by):
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO tasks (title, assignee, status, created_by, updated_ts)"
                " VALUES (?, ?, 'backlog', ?, ?)",
                (title, assignee, created_by, time.time()))
            self._conn.commit()
            return cur.lastrowid

    def update_task(self, task_id, status=None, assignee=None):
        sets, args = [], []
        if status:
            sets.append("status = ?")
            args.append(status)
        if assignee:
            sets.append("assignee = ?")
            args.append(assignee)
        if not sets:
            return
        sets.append("updated_ts = ?")
        args += [time.time(), task_id]
        self._q(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", args, commit=True)

    def list_tasks(self, status=None):
        if status:
            return self._q("SELECT * FROM tasks WHERE status = ? ORDER BY updated_ts DESC", (status,))
        return self._q("SELECT * FROM tasks ORDER BY updated_ts DESC")

    def get_task(self, task_id):
        return self._q("SELECT * FROM tasks WHERE id = ?", (task_id,), one=True)

    def stale_doing_tasks(self, older_than_secs):
        cutoff = time.time() - older_than_secs
        return self._q("SELECT * FROM tasks WHERE status = 'doing' AND updated_ts < ?"
                       " ORDER BY updated_ts ASC", (cutoff,))

    # -- memories --
    def set_memory(self, agent, key, value):
        self._q("INSERT INTO memories (agent, key, value, updated_ts) VALUES (?, ?, ?, ?)"
                " ON CONFLICT(agent, key) DO UPDATE SET value=excluded.value,"
                " updated_ts=excluded.updated_ts",
                (agent, key, value, time.time()), commit=True)

    def get_memory(self, agent, key, default=""):
        r = self._q("SELECT value FROM memories WHERE agent = ? AND key = ?",
                    (agent, key), one=True)
        return r["value"] if r else default

    # -- agent status --
    def set_agent_status(self, agent, state, current_task=""):
        self._q("INSERT INTO agent_status (agent, state, current_task, last_seen)"
                " VALUES (?, ?, ?, ?)"
                " ON CONFLICT(agent) DO UPDATE SET state=excluded.state,"
                " current_task=excluded.current_task, last_seen=excluded.last_seen",
                (agent, state, current_task, time.time()), commit=True)

    def get_agent_status(self, agent):
        return self._q("SELECT * FROM agent_status WHERE agent = ?", (agent,), one=True)

    def all_status(self):
        return self._q("SELECT * FROM agent_status")
