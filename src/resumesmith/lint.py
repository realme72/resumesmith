"""Offline resume review: the wording and structure problems recruiters and ATS filters punish."""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter
from dataclasses import dataclass

from .model import Resume
from .text import date_key, plain

LEVELS = ("error", "warn", "tip")  # fix before sending / should fix / worth considering


@dataclass
class Issue:
    level: str
    where: str
    message: str


WEAK_OPENERS = ("responsible for", "was responsible", "worked on", "working on", "helped", "assisted",
                "involved in", "tasked with", "duties included", "participated in", "part of", "handled")
BUZZWORDS = ("hard-working", "hardworking", "team player", "go-getter", "synergy", "detail-oriented",
             "detail oriented", "passionate", "self-motivated", "results-driven", "results driven",
             "think outside the box", "quick learner", "fast learner", "dynamic individual")
_PRONOUN = re.compile(r"\b(I|[Mm]y|[Mm]e|[Ww]e|[Oo]ur)\b")
_PLACEHOLDER = re.compile(r"\b(TODO|TBD|XXX?)\b|\?\?|\[\s*[xX?]?\s*\]")
_NUMBER = re.compile(r"\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|doubled?|tripled?|halved|"
                     r"dozens?|hundreds|thousands|millions)\b", re.I)
_PASSIVE = re.compile(r"\b(was|were|been|being)\s+\w+(ed|en)\b", re.I)


def bullet_tips(text: str) -> list[tuple[str, str]]:
    """(level, message) for one achievement line."""
    t = plain(text).strip()
    low = t.lower()
    out = []
    if _PLACEHOLDER.search(t):
        out.append(("error", "placeholder left in — fill it in or remove it"))
    if opener := next((w for w in WEAK_OPENERS if low.startswith(w)), None):
        out.append(("warn", f'starts with "{t[:len(opener)]}" — lead with what you did: Built, Led, Cut, Shipped…'))
    elif low.split(" ", 1)[0].endswith("ing"):
        out.append(("tip", "starts with an -ing word — past tense reads stronger (Built, not Building)"))
    if _PRONOUN.search(t):
        out.append(("warn", "uses I/my/we — resumes leave out pronouns"))
    if not _NUMBER.search(t):
        out.append(("tip", "no number — add scale or impact if you can (users, %, ms, ₹/$, team size)"))
    if len(t) > 220:
        out.append(("warn", f"long ({len(t)} characters, about 3 lines) — split it or keep one idea"))
    elif len(t) < 30:
        out.append(("tip", "very short — what was the result?"))
    if _PASSIVE.search(t):
        out.append(("tip", "passive voice — say what you did"))
    if buzz := next((w for w in BUZZWORDS if w in low), None):
        out.append(("tip", f'"{buzz}" is filler — show it with a result instead'))
    if text.count("**") >= 4:
        out.append(("tip", "bold sparingly — one key number per bullet at most"))
    return out


def _month_index(s: str, today: dt.date) -> int:
    if s == "present":
        return today.year * 12 + today.month - 1
    year, month = date_key(s)
    return year * 12 + max(month, 1) - 1


def experience_years(r: Resume, today: dt.date | None = None) -> float:
    """Total time employed, overlapping roles counted once."""
    today = today or dt.date.today()
    spans = sorted((_month_index(j.start, today), _month_index(j.end, today) + 1) for j in r.experience)
    total, cur = 0, None
    for s, e in spans:
        if cur and s <= cur[1]:
            cur = (cur[0], max(cur[1], e))
        else:
            if cur:
                total += cur[1] - cur[0]
            cur = (s, e)
    if cur:
        total += cur[1] - cur[0]
    return total / 12


def _snippet(text: str) -> str:
    words = plain(text).split()
    return " ".join(words[:5]) + ("…" if len(words) > 5 else "")


def check(r: Resume, pages: int | None = None, today: dt.date | None = None) -> list[Issue]:
    today = today or dt.date.today()
    now = (today.year, today.month)
    issues: list[Issue] = []

    def add(level: str, where: str, msg: str) -> None:
        issues.append(Issue(level, where, msg))

    def bullets(where: str, lines: list[str]) -> None:
        for text in lines:
            for level, msg in bullet_tips(text):
                add(level, f"{where} · “{_snippet(text)}”", msg)

    # contact
    b = r.basics
    if not b.email:
        add("error", "Contact", "no email address")
    elif not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", b.email):
        add("error", "Contact", f"{b.email!r} doesn't look like an email address")
    if not b.phone:
        add("warn", "Contact", "no phone number — most recruiters call first")
    if not any("linkedin." in link.url.lower() for link in b.links):
        add("tip", "Contact", "add your LinkedIn URL — recruiters look you up there")

    # summary
    if r.summary:
        s = plain(r.summary)
        if (words := len(s.split())) > 75:
            add("warn", "Summary", f"{words} words — keep it to 2–3 lines (under ~60 words)")
        if buzz := next((w for w in BUZZWORDS if w in s.lower()), None):
            add("tip", "Summary", f'"{buzz}" is filler — name a result instead')
        if _PLACEHOLDER.search(s):
            add("error", "Summary", "placeholder left in")
    elif r.experience:
        add("tip", "Summary", "a 2–3 line summary helps a recruiter place you in seconds")

    # experience
    if not r.experience and not r.projects:
        add("warn", "Experience", "no experience or projects — add internships, projects or open-source work")
    for prev, job in zip(r.experience, r.experience[1:]):
        if date_key(job.start) > date_key(prev.start):
            add("warn", "Experience", "jobs aren't most-recent-first — reorder them")
            break
    everything: list[str] = []
    for n, j in enumerate(r.experience):
        where = f"{j.company} ({j.role})"
        if j.end != "present" and date_key(j.end) < date_key(j.start):
            add("error", where, "ends before it starts")
        if date_key(j.start) > now:
            add("error", where, "start date is in the future")
        if j.end != "present" and date_key(j.end) > now:
            add("warn", where, "end date is in the future — use present if you still work there")
        if not j.bullets:
            add("warn", where, "no achievements listed — add 2–5")
        elif len(j.bullets) > 6:
            add("tip", where, f"{len(j.bullets)} bullets — your 3–5 strongest read better")
        elif n >= 2 and len(j.bullets) > 4:
            add("tip", where, "an older role — 2–3 bullets is plenty")
        bullets(where, j.bullets)
        everything += j.bullets

    for p in r.projects:
        bullets(p.name, p.bullets)
        everything += p.bullets

    # education and skills
    if not r.education:
        add("tip", "Education", "no education listed")
    for e in r.education:
        if e.start and e.end and e.end != "present" and date_key(e.end) < date_key(e.start):
            add("error", e.school, "ends before it starts")
    if not r.skills:
        add("warn", "Skills", "no skills section — ATS filters search it for keywords")
    counts = Counter(item.casefold() for g in r.skills for item in g.items)
    if dupes := [k for k, c in counts.items() if c > 1]:
        add("tip", "Skills", f"listed more than once: {', '.join(dupes)}")
    for g in r.skills:
        if len(g.items) > 14:
            add("tip", "Skills", f"{g.category} has {len(g.items)} items — keep the ones you'd happily be interviewed on")

    # across all bullets
    if everything:
        firsts = Counter(plain(x).split(" ", 1)[0].lower() for x in everything if plain(x).strip())
        for verb, count in firsts.most_common():
            if count >= 3:
                add("tip", "Wording", f'"{verb.title()}" starts {count} bullets — vary it (Built, Designed, Led, Cut, Shipped…)')
        numbered = sum(bool(_NUMBER.search(plain(x))) for x in everything)
        if len(everything) >= 4 and numbered / len(everything) < 0.4:
            add("tip", "Wording", f"only {numbered} of {len(everything)} bullets have a number — numbers are what recruiters skim for")
        stops = [plain(x).rstrip().endswith(".") for x in everything]
        if 0 < sum(stops) < len(stops):
            add("tip", "Wording", "some bullets end with a full stop and some don't — pick one style")

    years = experience_years(r, today)
    if pages and pages > 1 and years < 10:
        add("warn", "Length", f"{pages} pages — with about {years:.0f} years of experience one page is expected; "
                              "trim older roles and weaker bullets first")

    return sorted(issues, key=lambda i: LEVELS.index(i.level))
