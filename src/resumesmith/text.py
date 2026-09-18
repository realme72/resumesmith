"""Helpers shared by every output format: dates, links, inline markup, section order."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field

from .model import MONTHS, Job, Resume

# ---------- dates ----------


def fmt_date(s: str | None) -> str:
    if not s:
        return ""
    if s == "present":
        return "Present"
    if "-" in s:
        year, month = s.split("-")
        return f"{MONTHS[int(month) - 1].title()} {year}"
    return s


def date_range(start: str | None, end: str | None) -> str:
    a, b = fmt_date(start), fmt_date(end)
    if a and b and a != b:
        return f"{a} – {b}"
    return a or b


def date_key(s: str | None) -> tuple[int, int]:
    """Sort key; 'present' sorts last."""
    if not s:
        return (0, 0)
    if s == "present":
        return (9999, 12)
    year, _, month = s.partition("-")
    return (int(year), int(month or 0))


# ---------- links ----------


def full_url(url: str) -> str:
    if re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I):
        return url
    return "https://" + url


def bare_url(url: str) -> str:
    """https://www.linkedin.com/in/x/ -> linkedin.com/in/x (what gets printed; ATS reads it too)."""
    return re.sub(r"^(https?://)?(www\.)?", "", url, flags=re.I).rstrip("/")


def contact_items(r: Resume) -> list[tuple[str, str | None]]:
    """(text, href) for the contact line, in print order."""
    b = r.basics
    items: list[tuple[str, str | None]] = []
    if b.location:
        items.append((b.location, None))
    if b.phone:
        items.append((b.phone, "tel:" + re.sub(r"[^\d+]", "", b.phone)))
    if b.email:
        items.append((b.email, "mailto:" + b.email))
    for link in b.links:
        items.append((link.label or bare_url(link.url), full_url(link.url)))
    return items


def contact_lines(r: Resume, max_chars: int = 70) -> list[list[tuple[str, str | None]]]:
    """The contact line, split so links get their own line when it's long (never wrapping mid-URL)."""
    items = contact_items(r)
    if sum(len(t) + 3 for t, _ in items) <= max_chars:
        return [items] if items else []
    n_links = len(r.basics.links)
    lines = [items[:len(items) - n_links], items[len(items) - n_links:]]
    return [line for line in lines if line]


# ---------- inline markup: **bold** and [text](url) ----------


@dataclass
class Segment:
    text: str
    bold: bool = False
    href: str | None = None


_INLINE = re.compile(r"\*\*(?P<bold>.+?)\*\*|\[(?P<label>[^\]]+)\]\((?P<url>[^)\s]+)\)")


def segments(text: str) -> list[Segment]:
    out, pos = [], 0
    for m in _INLINE.finditer(text):
        if m.start() > pos:
            out.append(Segment(text[pos:m.start()]))
        if m["bold"] is not None:
            out.append(Segment(m["bold"], bold=True))
        else:
            out.append(Segment(m["label"], href=full_url(m["url"])))
        pos = m.end()
    if pos < len(text):
        out.append(Segment(text[pos:]))
    return out


def to_html(text: str) -> str:
    parts = []
    for seg in segments(text):
        t = html.escape(seg.text)
        if seg.bold:
            t = f"<strong>{t}</strong>"
        if seg.href:
            t = f'<a href="{html.escape(seg.href)}">{t}</a>'
        parts.append(t)
    return "".join(parts)


def plain(text: str) -> str:
    """Markup removed; links keep their URL in brackets so nothing is lost in plain text."""
    return "".join(f"{s.text} ({bare_url(s.href)})" if s.href and bare_url(s.href) != s.text else s.text
                   for s in segments(text))


# ---------- structure ----------


@dataclass
class JobGroup:
    """Consecutive roles at one company (a promotion) print under a single company line."""
    company: str
    location: str | None
    url: str | None
    jobs: list[Job] = field(default_factory=list)


def group_jobs(jobs: list[Job]) -> list[JobGroup]:
    groups: list[JobGroup] = []
    for job in jobs:
        if groups and groups[-1].company.casefold() == job.company.casefold():
            groups[-1].jobs.append(job)
            groups[-1].location = groups[-1].location or job.location
        else:
            groups.append(JobGroup(job.company, job.location, job.url, [job]))
    return groups


def visible_sections(r: Resume) -> list[tuple[str, str]]:
    """(key, heading) for each section that has content, in the configured order."""
    out = []
    for key in r.settings.sections:
        if key == "extra":
            out += [(f"extra:{i}", sec.title) for i, sec in enumerate(r.extra) if sec.items]
        elif getattr(r, key):
            out.append((key, r.title_of(key)))
    return out


def output_stem(r: Resume) -> str:
    """'Aarav Mehta' -> 'Aarav_Mehta_Resume' — the filename a recruiter sees."""
    name = re.sub(r"[^\w\s-]", "", r.basics.name).strip()
    return "_".join(name.split()) + "_Resume"
