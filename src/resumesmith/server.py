"""The local dashboard: a form on the left, a live preview on the right, formats along the bottom.

Everything runs on 127.0.0.1 and renders with the same code the command line uses, so the preview
is the real thing. Every API call must carry the token printed into the page, which keeps other
sites in the browser from talking to this server.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml

from .export import FORMATS, parse_formats, render_formats
from .lint import bullet_tips, check
from .model import ROOT, ResumeError, available_themes, parse, prune
from .render_html import BrowserMissing, render_html
from .wizard import save as save_resume, slug

SITE = ROOT / "site"
MAX_BODY = 4_000_000
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json",
         ".png": "image/png", ".ico": "image/x-icon", ".yaml": "text/yaml; charset=utf-8"}


def asset(path: str) -> Path | None:
    """A file inside site/, or None — so a request can't wander outside that folder."""
    candidate = (SITE / path.lstrip("/")).resolve()
    if SITE.resolve() in candidate.parents and candidate.is_file():
        return candidate
    return None


class Downloads:
    """Finished files, held in memory only long enough for the browser to fetch them.

    Nothing is written to disk, so a served copy of ResumeSmith stores no one's resume.
    """

    def __init__(self, keep_seconds: float = 900, limit: int = 24):
        self.keep_seconds = keep_seconds
        self.limit = limit
        self._items: dict[str, tuple[str, bytes, float]] = {}
        self._lock = threading.Lock()

    def add(self, name: str, data: bytes) -> str:
        token = uuid.uuid4().hex
        with self._lock:
            self._forget_stale()
            self._items[token] = (name, data, time.time())
        return token

    def get(self, token: str) -> tuple[str, bytes] | None:
        with self._lock:
            self._forget_stale()
            item = self._items.get(token)
        return (item[0], item[1]) if item else None

    def _forget_stale(self) -> None:
        cutoff = time.time() - self.keep_seconds
        for token in [t for t, (_, _, when) in self._items.items() if when < cutoff]:
            del self._items[token]
        while len(self._items) > self.limit:
            del self._items[min(self._items, key=lambda t: self._items[t][2])]


@dataclass
class Dashboard:
    """State shared by every request: the token, and the files waiting to be downloaded."""
    resumes_dir: Path = ROOT / "resumes"
    token: str = field(default_factory=lambda: uuid.uuid4().hex)
    downloads: Downloads = field(default_factory=Downloads)


def bullet_hints(data: dict) -> dict[str, list[dict]]:
    """Coaching for each achievement, keyed by the form field it belongs to."""
    hints = {}
    for section in ("experience", "projects"):
        for i, item in enumerate(data.get(section) or []):
            if not isinstance(item, dict):
                continue
            for j, line in enumerate(item.get("bullets") or []):
                if isinstance(line, str) and line.strip() and (tips := bullet_tips(line)):
                    hints[f"{section}.{i}.bullets.{j}"] = [{"level": lv, "message": m} for lv, m in tips]
    return hints


# What an entry needs before the preview will draw it; anything less is still being typed.
NEEDED = {"experience": ("company", "role", "start"), "projects": ("name",),
          "education": ("school", "degree"), "certifications": ("name",),
          "skills": ("category", "items"), "extra": ("title", "items")}


LABELS = {"company": "company", "role": "job title", "start": "start date", "name": "name",
          "school": "school", "degree": "degree", "category": "group name", "items": "items",
          "title": "title"}


def drop_incomplete(data: dict) -> tuple[dict, list[dict]]:
    """For the live preview: skip half-typed entries instead of complaining about them.

    Returns the trimmed data, plus a note for each entry that was started but can't be drawn yet
    (an untouched entry says nothing — there is nothing to tell the person about).
    """
    out = dict(data)
    hidden = []
    for section, needed in NEEDED.items():
        items = out.get(section)
        if not isinstance(items, list):
            continue
        kept = []
        for position, item in enumerate(items, 1):
            if not isinstance(item, dict):
                continue
            missing = [field for field in needed if not item.get(field)]
            if not missing:
                kept.append(item)
            elif len(missing) < len(needed):
                label = next((str(item[f]) for f in needed if item.get(f)), f"Entry {position}")
                hidden.append({"label": label, "missing": [LABELS.get(f, f) for f in missing]})
        out[section] = kept
    return out, hidden


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ResumeSmith"
    dash: Dashboard

    def log_message(self, *args) -> None:
        pass  # the terminal stays quiet; the browser is the interface

    # ---------- plumbing ----------

    def _send(self, code: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, json.dumps(payload).encode(), "application/json", {"Cache-Control": "no-store"})

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("the request was empty or too large")
        try:
            payload = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            raise ValueError("the request wasn't valid JSON") from None
        if not isinstance(payload, dict):
            raise ValueError("the request should be a JSON object")
        return payload

    def _authed(self) -> bool:
        if self.headers.get("X-ResumeSmith-Token") != self.dash.token:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin.startswith(("http://127.0.0.1", "http://localhost"))

    def _resume(self, payload: dict):
        return parse(prune(payload.get("resume") or {}))

    # ---------- routes ----------

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path == "/":
            page = (SITE / "index.html").read_text(encoding="utf-8").replace("{{TOKEN}}", self.dash.token)
            return self._send(200, page.encode(), TYPES[".html"], {"Cache-Control": "no-store"})
        if (file := asset(url.path)) is not None:
            return self._send(200, file.read_bytes(), TYPES.get(file.suffix, "application/octet-stream"),
                              {"Cache-Control": "no-store"})
        if url.path == "/download":
            found = self.dash.downloads.get(parse_qs(url.query).get("id", [""])[0])
            if not found:
                return self._json(404, {"error": "that file has expired — export again"})
            name, data = found
            return self._send(200, data, "application/octet-stream",
                              {"Content-Disposition": f'attachment; filename="{name}"'})
        if url.path == "/api/meta":
            if not self._authed():
                return self._json(403, {"error": "this page is out of date — reload it"})
            files = sorted(p.name for p in self.dash.resumes_dir.glob("*.yaml"))
            return self._json(200, {"themes": available_themes(), "formats": FORMATS, "files": files})
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self._authed():
            return self._json(403, {"error": "this page is out of date — reload it"})
        url = urlparse(self.path)
        try:
            payload = self._body()
            if url.path == "/api/preview":
                return self._preview(payload)
            if url.path == "/api/export":
                return self._export(payload)
            if url.path == "/api/save":
                return self._save(payload)
            if url.path == "/api/load":
                return self._load(payload)
        except (ResumeError, ValueError) as e:
            return self._json(400, {"error": str(e)})
        except BrowserMissing as e:
            return self._json(500, {"error": str(e)})
        self._json(404, {"error": "not found"})

    def _preview(self, payload: dict) -> None:
        data, hidden = drop_incomplete(prune(payload.get("resume") or {}))
        r = parse(data)
        self._json(200, {
            "html": render_html(r, bare=True),
            "review": [{"level": i.level, "where": i.where, "message": i.message} for i in check(r)],
            "tips": bullet_hints(payload.get("resume") or {}),
            "hidden": hidden,
        })

    def _export(self, payload: dict) -> None:
        r = self._resume(payload)
        formats = parse_formats(",".join(payload.get("formats") or []))
        result = render_formats(r, formats)  # in memory; the browser saves them where it saves downloads
        files = [{"name": f.name, "format": f.format, "size": len(f.data),
                  "url": f"/download?id={self.dash.downloads.add(f.name, f.data)}"} for f in result.files]
        self._json(200, {"files": files, "pages": result.pages, "scale": result.scale,
                         "fitted": result.fitted, "notes": result.notes})

    def _save(self, payload: dict) -> None:
        data = prune(payload.get("resume") or {})
        r = parse(data)
        path = self.dash.resumes_dir / f"{slug(payload.get('stem') or r.basics.name)}.yaml"
        if path.exists() and not payload.get("overwrite"):
            return self._json(200, {"needs_confirm": True, "file": path.name})
        save_resume(data, path)
        self._json(200, {"file": path.name, "path": str(path)})

    def _load(self, payload: dict) -> None:
        name = Path(str(payload.get("file") or "")).name
        path = self.dash.resumes_dir / name
        if path.suffix != ".yaml" or not path.is_file():
            raise ResumeError(f"no such resume file: {name}")
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        parse(data, path.name)  # fail here rather than with a blank form
        self._json(200, {"resume": data, "stem": path.stem})


def bind_handler(dash: Dashboard) -> type[Handler]:
    return type("BoundHandler", (Handler,), {"dash": dash})


# ---------- restarting when the code changes ----------
# The page's own files are read per request, but Python code is loaded once, so an edit to it would
# otherwise keep serving the old behaviour until someone remembered to restart.

def source_stamps(root: Path | None = None) -> dict[Path, float]:
    """When each Python file of this program was last modified."""
    base = root if root is not None else ROOT / "src"
    return {path: path.stat().st_mtime for path in sorted(base.rglob("*.py")) if path.is_file()}


def changed_source(stamps: dict[Path, float]) -> Path | None:
    for path, when in stamps.items():
        try:
            if path.stat().st_mtime != when:
                return path
        except OSError:  # deleted or being rewritten; the next pass will see it
            continue
    return None


def watch_sources(interval: float = 1.0) -> None:
    stamps = source_stamps()
    while True:
        time.sleep(interval)
        if path := changed_source(stamps):
            print(f"\n{path.name} changed — restarting the server (reload the page to be sure)…", flush=True)
            os.execv(sys.executable, [sys.executable, "-m", "resumesmith", *sys.argv[1:]])


def serve(port: int = 8765, open_browser: bool = True, host: str = "127.0.0.1", reload: bool = True) -> int:
    dash = Dashboard()
    httpd = None
    for candidate in range(port, port + 10):
        try:
            httpd = ThreadingHTTPServer((host, candidate), bind_handler(dash))
            break
        except OSError:
            continue
    if httpd is None:
        print(f"Ports {port}–{port + 9} are all busy. Try: ./resumesmith serve --port 9000", flush=True)
        return 1

    url = f"http://{host}:{httpd.server_address[1]}/"
    # flush: this output is often piped or backgrounded, where Python would otherwise hold it back
    print(f"ResumeSmith dashboard: {url}", flush=True)
    print("Leave this running while you work; press Ctrl+C to stop.", flush=True)
    if reload:
        print("Code changes restart it by themselves.", flush=True)
        threading.Thread(target=watch_sources, daemon=True).start()
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        httpd.server_close()
    return 0
