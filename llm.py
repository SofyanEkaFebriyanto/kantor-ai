"""llm.py — client OpenAI-compatible ke 9Router (stdlib only: urllib).

API key resolution (tidak pernah disimpan ke disk oleh modul ini):
  1. env NINEROUTER_API_KEY
  2. LLM_API_KEY dari /opt/noir-brain/.env (dibaca transient tiap init)
Base URL: env NINEROUTER_BASE_URL > config.yaml > default.
"""
import json
import os
import time
import urllib.request
import urllib.error


def resolve_api_key():
    key = os.environ.get("NINEROUTER_API_KEY", "").strip()
    if key:
        return key
    for path in ("/opt/noir-brain/.env", os.path.expanduser("~/.config/kantor-ai/.env")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("LLM_API_KEY="):
                        v = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if v:
                            return v
        except OSError:
            continue
    return ""


class LLMClient:
    def __init__(self, base_url, model, timeout_secs=90, max_retries=1):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout_secs
        self.max_retries = max_retries
        self.api_key = resolve_api_key()

    def chat(self, messages, tools=None, max_tokens=800, temperature=0.7):
        """Return (text, tool_calls). tool_calls = [{'id','name','arguments'(dict)}]."""
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key

        last_err = None
        for attempt in range(self.max_retries + 1):
            try:
                req = urllib.request.Request(
                    self.base_url + "/chat/completions", data=data, headers=headers, method="POST"
                )
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                # 9Router kadang menempelkan sisa SSE ("data: [DONE]") setelah JSON
                obj, _ = json.JSONDecoder().raw_decode(raw)
                msg = obj["choices"][0]["message"]
                text = msg.get("content") or ""
                tool_calls = []
                for tc in msg.get("tool_calls") or []:
                    fn = tc.get("function", {})
                    args = fn.get("arguments") or "{}"
                    try:
                        args = json.loads(args) if isinstance(args, str) else args
                    except json.JSONDecodeError:
                        args = {"_raw": args}
                    tool_calls.append({
                        "id": tc.get("id", ""),
                        "name": fn.get("name", ""),
                        "arguments": args if isinstance(args, dict) else {"_raw": args},
                    })
                return text, tool_calls
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError,
                    KeyError, IndexError) as e:
                last_err = e
                if attempt < self.max_retries:
                    time.sleep(2)
        raise RuntimeError(f"LLM call gagal setelah {self.max_retries + 1}x: {last_err}")
