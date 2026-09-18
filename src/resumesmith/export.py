"""Turn a resume into the formats you asked for: always in memory, on disk only when asked.

The dashboard hands the bytes straight to the browser, so a served copy of ResumeSmith keeps no
resumes at all. The command line writes them into a folder, which is what you want on your own machine.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from .model import Resume
from .render_docx import render_docx
from .render_html import Browser, BrowserMissing, fit_pdf, render_html
from .render_text import render_markdown, render_text
from .text import output_stem

FORMATS = {
    "pdf": "PDF — best for sending and uploading",
    "docx": "Word (.docx) — editable in Word or Google Docs",
    "html": "Web page (.html)",
    "md": "Markdown (.md)",
    "txt": "Plain text (.txt) — for pasting into job-portal forms",
    "png": "Image (.png)",
}
ALIASES = {"word": "docx", "doc": "docx", "markdown": "md", "text": "txt", "web": "html", "htm": "html",
           "image": "png"}
NEEDS_BROWSER = {"pdf", "png", "html", "docx"}  # html and docx only to measure the one-page fit


def parse_formats(s: str) -> list[str]:
    """'PDF, word' -> ['pdf', 'docx']; 'all' -> every format."""
    out: list[str] = []
    for raw in re.split(r"[,\s]+", s.strip().lower()):
        raw = raw.lstrip(".")
        if not raw:
            continue
        if raw == "all":
            out += FORMATS
            continue
        fmt = ALIASES.get(raw, raw)
        if fmt not in FORMATS:
            raise ValueError(f"unknown format {raw!r} — choose from: {', '.join(FORMATS)}")
        out.append(fmt)
    if not out:
        raise ValueError("pick at least one format")
    return list(dict.fromkeys(out))


@dataclass
class Rendered:
    name: str  # what the file should be called when it lands on someone's machine
    format: str
    data: bytes


@dataclass
class Exported:
    files: list[Rendered] = field(default_factory=list)
    paths: list[Path] = field(default_factory=list)  # only when written to disk
    pages: int | None = None
    scale: float = 1.0
    fitted: bool = True
    notes: list[str] = field(default_factory=list)


def render_formats(r: Resume, formats: list[str]) -> Exported:
    res = Exported()
    fit = png = None
    if NEEDS_BROWSER & set(formats):
        try:
            with Browser() as browser:
                fit = fit_pdf(r, browser)
                if "png" in formats:
                    png = browser.png(render_html(r, fit.scale, fit.margin_mm, bare=True))
        except BrowserMissing as e:
            if {"pdf", "png"} & set(formats):
                raise
            res.notes.append(f"{e} (so spacing wasn't fitted to one page)")
    scale, margin = (fit.scale, fit.margin_mm) if fit else (1.0, r.settings.margin_mm)

    stem = output_stem(r)
    for fmt in formats:
        if fmt == "pdf":
            data = fit.pdf
        elif fmt == "png":
            data = png
        elif fmt == "html":
            data = render_html(r, scale, margin).encode()
        elif fmt == "docx":
            data = render_docx(r, scale, margin)
        elif fmt == "md":
            data = render_markdown(r).encode()
        else:
            data = render_text(r).encode()
        res.files.append(Rendered(f"{stem}.{fmt}", fmt, data))

    if fit:
        res.pages, res.scale, res.fitted = fit.pages, fit.scale, fit.fitted
    if "docx" in formats and fit and fit.pages == 1:
        res.notes.append("The Word file uses the same spacing; Word's fonts differ slightly, so glance at its page count.")
    return res


def _write(path: Path, data: bytes) -> None:
    """Write via a temp file so a PDF viewer never catches a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def export(r: Resume, formats: list[str], out_dir: Path) -> Exported:
    """Render, and also save the files into out_dir (what the command line does)."""
    res = render_formats(r, formats)
    for file in res.files:
        path = out_dir / file.name
        _write(path, file.data)
        res.paths.append(path)
    return res
