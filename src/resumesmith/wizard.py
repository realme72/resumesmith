"""The questionnaire: asks for everything a resume needs and saves it as an editable file."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from .export import ALIASES, FORMATS
from .lint import bullet_tips
from .model import ResumeError, Settings, available_themes, normalize_date, parse, prune
from .prompts import Prompter

THEME_BLURBS = {
    "classic": "Classic — serif, centred, black and white (safe for every company and ATS)",
    "modern": "Modern — clean sans-serif with a colour accent",
    "compact": "Compact — dense, for long histories",
}
ACCENTS = [
    ("#1f4e79", "Navy"), ("#0f766e", "Teal"), ("#8b1e3f", "Burgundy"), ("#4338ca", "Indigo"),
    ("#333333", "Charcoal"),
]
FILE_HEADER = """\
# Your resume. Edit anything here, then re-export with:
#   ./resumesmith build {path}
# Inside any text, **bold** and [text](https://link) work. Dates: Mar 2022, 2022-03, 2022 or present.

"""


def _email(v: str) -> str:
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
        raise ValueError("that doesn't look like an email address")
    return v


def _accent(v: str) -> str:
    return Settings(accent=v).accent  # same validation the resume file gets


def _csv(v: str) -> list[str]:
    return [x.strip() for x in v.split(",") if x.strip()]


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "resume"


def save(data: dict, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = yaml.safe_dump(prune(data), sort_keys=False, allow_unicode=True, width=1000)
    path.write_text(FILE_HEADER.format(path=f"resumes/{path.name}") + body, encoding="utf-8")
    return path


class Wizard:
    def __init__(self, p: Prompter):
        self.p = p
        self.data: dict[str, Any] = {}

    def _feedback(self, line: str) -> None:
        """Instant coaching on each achievement as it's typed."""
        tips = bullet_tips(line)
        if tips:
            level, msg = min(tips, key=lambda t: ("error", "warn", "tip").index(t[0]))
            self.p.tip(f"      ↳ {msg}")

    def about(self) -> None:
        p = self.p
        p.section("About you")
        b = self.data["basics"] = {}
        b["name"] = p.ask("Full name", required=True)
        b["title"] = p.ask("Headline — the role you're after (e.g. Senior Backend Engineer)")
        b["email"] = p.ask("Email", required=True, check=_email)
        b["phone"] = p.ask("Phone, with country code (e.g. +91 98765 43210)")
        b["location"] = p.ask("City, Country (e.g. Bengaluru, India)")
        b["links"] = p.lines("Links — LinkedIn, GitHub, portfolio. One per line, empty line when done:")

    def summary(self) -> None:
        p = self.p
        p.section("Summary")
        p.tip("2–3 sentences: your role and years of experience, what you're strongest at, one result you're proud of.\n"
              "e.g. Backend engineer with 5 years building payment systems in Python and Go. Led the migration that cut infra cost 35%.")
        self.data["summary"] = " ".join(p.lines("Summary (as many lines as you like, empty line when done):", bullet="  "))

    def experience(self) -> None:
        p = self.p
        p.section("Experience")
        p.tip("Most recent job first. Start each achievement with a verb and add a number if you can:\n"
              "  ✓ Cut checkout API p99 latency from 900 ms to 180 ms by adding Redis caching\n"
              "  ✗ Responsible for working on APIs")
        jobs = self.data["experience"] = []
        while p.yes("Add another job?" if jobs else "Add a job?", default=not jobs):
            job: dict[str, Any] = {}
            jobs.append(job)
            job["company"] = p.ask("  Company", required=True)
            job["role"] = p.ask("  Your title", required=True)
            job["location"] = p.ask("  Location (city, or Remote)")
            job["start"] = p.ask("  Started (e.g. Mar 2022)", required=True, check=normalize_date)
            job["end"] = p.ask("  Ended (e.g. Jun 2024; Enter if you still work here)", default="present",
                               check=normalize_date)
            job["bullets"] = p.lines("  Achievements — one per line, empty line when done:", bullet="    • ",
                                     on_line=self._feedback)
            job["tech"] = _csv(p.ask("  Tech you used there, comma-separated (optional)"))

    def projects(self) -> None:
        p = self.p
        p.section("Projects")
        items = self.data["projects"] = []
        first_default = not self.data.get("experience")  # projects matter most when there's no job yet
        while p.yes("Add another project?" if items else "Add a project?", default=first_default and not items):
            pr: dict[str, Any] = {}
            items.append(pr)
            pr["name"] = p.ask("  Project name", required=True)
            pr["url"] = p.ask("  Link (GitHub, live site — optional)")
            pr["tech"] = _csv(p.ask("  Tech used, comma-separated"))
            pr["description"] = p.ask("  One line on what it is (optional)")
            pr["bullets"] = p.lines("  What you built or achieved — one per line, empty line when done:",
                                    bullet="    • ", on_line=self._feedback)

    def education(self) -> None:
        p = self.p
        p.section("Education")
        items = self.data["education"] = []
        while p.yes("Add more education?" if items else "Add education?", default=not items):
            e: dict[str, Any] = {}
            items.append(e)
            e["school"] = p.ask("  College / school", required=True)
            e["degree"] = p.ask("  Degree and field (e.g. B.Tech, Computer Science)", required=True)
            e["location"] = p.ask("  Location (optional)")
            e["start"] = p.ask("  Started (e.g. 2016; optional)", check=normalize_date)
            e["end"] = p.ask("  Finished or expected (e.g. 2020)", check=normalize_date)
            e["score"] = p.ask("  CGPA / percentage (optional, e.g. CGPA 8.4/10)")

    def skills(self) -> None:
        p = self.p
        p.section("Skills")
        p.tip("One group per line, like   Languages: Python, Go, SQL\n"
              "Only list what you'd happily be interviewed on.")
        groups: dict[str, list[str]] = {}
        for line in p.lines("Skills (empty line when done):"):
            category, sep, items = line.partition(":")
            if not sep:
                category, items = "Skills", line
            groups.setdefault(category.strip() or "Skills", []).extend(_csv(items))
        self.data["skills"] = {k: ", ".join(v) for k, v in groups.items() if v}

    def extras(self) -> None:
        p = self.p
        p.section("Certifications & achievements")
        certs = self.data["certifications"] = []
        while p.yes("Add another certification?" if certs else "Add a certification?", default=False):
            c = {"name": p.ask("  Certification", required=True), "issuer": p.ask("  Issued by"),
                 "date": p.ask("  When (e.g. Nov 2023; optional)", check=normalize_date), "url": p.ask("  Link (optional)")}
            certs.append(c)
        self.data["achievements"] = p.lines(
            "Achievements — awards, rankings, hackathons, talks, open source. One per line, empty line when done:")

    def look(self) -> None:
        p = self.p
        p.section("Design & format")
        themes = [(t, THEME_BLURBS.get(t, t.title())) for t in available_themes()]
        s = self.data["settings"] = {}
        s["theme"] = p.choose("Which design?", themes, default="classic")
        if s["theme"] != "classic":
            options = [(hex_, f"{name} ({hex_})") for hex_, name in ACCENTS] + [("custom", "Something else")]
            accent = p.choose("Accent colour?", options, default=ACCENTS[0][0])
            s["accent"] = p.ask("  Hex colour (e.g. #0a66c2)", required=True, check=_accent) if accent == "custom" else accent
        s["page"] = p.choose("Paper size?", [("A4", "A4 — India, Europe, most of the world"),
                                             ("Letter", "US Letter — USA and Canada")], default="A4")
        s["formats"] = p.choose_many("Which format(s) do you want?", list(FORMATS.items()), default=["pdf"],
                                     aliases=ALIASES)
        if not self.data.get("experience"):
            # no jobs yet: lead with education and projects
            s["sections"] = ["summary", "education", "skills", "projects", "experience", "certifications",
                             "achievements", "extra"]

    def run(self) -> None:
        self.p.say(self.p.bold("Let's build your resume.") + " Press Enter to skip anything optional.")
        self.p.tip("Ctrl+C stops at any point and saves what you've typed so far.")
        for step in (self.about, self.summary, self.experience, self.projects, self.education, self.skills,
                     self.extras, self.look):
            step()


def run(p: Prompter, resumes_dir: Path) -> Path | None:
    """Ask everything, save resumes/<name>.yaml, and return its path (None if stopped early)."""
    w = Wizard(p)
    try:
        w.run()
    except (KeyboardInterrupt, EOFError):
        p.say("")
        name = w.data.get("basics", {}).get("name")
        if not name:
            p.say("Stopped — nothing saved.")
            return None
        path = save(w.data, resumes_dir / f"{slug(name)}.draft.yaml")
        p.say(f"Stopped. What you typed is saved in {path} — finish it in any editor, then run:\n"
              f"  ./resumesmith build resumes/{path.name}")
        return None

    path = resumes_dir / f"{slug(w.data['basics']['name'])}.yaml"
    if path.exists() and not p.yes(f"{path.name} already exists — replace it?", default=False):
        n = 2
        while (candidate := path.with_name(f"{path.stem}-{n}.yaml")).exists():
            n += 1
        path = candidate
    save(w.data, path)
    try:
        parse(yaml.safe_load(path.read_text(encoding="utf-8")), path.name)
    except ResumeError as e:
        p.say(f"{e}\nFix that in {path}, then run: ./resumesmith build resumes/{path.name}")
        return None
    return path
