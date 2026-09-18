"""The resume schema: what a resume file may contain, validated with friendly errors."""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, BeforeValidator, ConfigDict, ValidationError, field_validator

ROOT = Path(__file__).resolve().parents[2]  # src/resumesmith/model.py -> project folder
THEMES_DIR = ROOT / "site" / "themes"  # shared with the browser app, which fetches them directly

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
PRESENT_WORDS = {"present", "current", "now", "ongoing", "till date", "today"}
SECTIONS = ("summary", "skills", "experience", "projects", "education", "certifications",
            "achievements", "extra")
DEFAULT_TITLES = {
    "summary": "Summary", "skills": "Skills", "experience": "Experience", "projects": "Projects",
    "education": "Education", "certifications": "Certifications", "achievements": "Achievements",
}


class ResumeError(Exception):
    """A resume file that can't be read; the message is meant for the user."""


# ---------- field types ----------

def normalize_date(v: Any) -> str:
    """'Mar 2022', '2022-03', '03/2022', 2022, 'present' -> '2022-03', '2022' or 'present'."""
    if isinstance(v, (dt.date, dt.datetime)):
        return f"{v.year:04d}-{v.month:02d}"
    s = str(v).strip()
    if s.lower() in PRESENT_WORDS:
        return "present"
    if re.fullmatch(r"(19|20)\d\d", s):
        return s
    year = month = None
    if m := re.fullmatch(r"(\d{4})\s*[-/.]\s*(\d{1,2})", s):
        year, month = int(m[1]), int(m[2])
    elif m := re.fullmatch(r"(\d{1,2})\s*[-/.]\s*(\d{4})", s):
        month, year = int(m[1]), int(m[2])
    elif (m := re.fullmatch(r"([A-Za-z]{3,9})\.?,?\s*['’]?(\d{4}|\d{2})", s)) and m[1][:3].lower() in MONTHS:
        month, year = MONTHS.index(m[1][:3].lower()) + 1, int(m[2])
        year += 2000 if year < 100 else 0
    if year and month and 1 <= month <= 12 and 1950 <= year <= 2100:
        return f"{year:04d}-{month:02d}"
    raise ValueError(f"can't read the date {v!r} — write it like Mar 2022, 2022-03, 2022 or present")


def as_text(v: Any) -> Any:
    """YAML reads `- Cut costs: saved 20%` as a mapping; turn it back into the line that was typed."""
    if v is None:
        return ""
    if isinstance(v, dict) and len(v) == 1:
        (key, value), = v.items()
        return f"{key}: {as_text(value)}".rstrip(": ")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    return v


def as_list(v: Any) -> Any:
    """A single string where a list belongs becomes a one-item list."""
    if v is None:
        return []
    return [v] if isinstance(v, (str, dict)) else v


def as_csv_list(v: Any) -> Any:
    """'Python, Go, SQL' -> ['Python', 'Go', 'SQL']."""
    if v is None:
        return []
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    return v


def prune(value: Any) -> Any:
    """Drop empty fields, so blank answers (wizard or dashboard) don't become empty sections."""
    if isinstance(value, dict):
        cleaned = {k: prune(v) for k, v in value.items()}
        return {k: v for k, v in cleaned.items() if v not in ("", None, [], {})}
    if isinstance(value, list):
        return [v for v in (prune(x) for x in value) if v not in ("", None, [], {})]
    if isinstance(value, str):
        return value.strip()
    return value


Date = Annotated[str, BeforeValidator(normalize_date)]
Text = Annotated[str, BeforeValidator(as_text)]
Lines = Annotated[list[Text], BeforeValidator(as_list)]
Tags = Annotated[list[Text], BeforeValidator(as_csv_list)]


class Base(BaseModel):
    # extra="forbid" turns a typo like `bulets:` into an error instead of silently dropping it
    model_config = ConfigDict(extra="forbid", coerce_numbers_to_str=True, str_strip_whitespace=True)


# ---------- sections ----------

class Link(Base):
    url: str
    label: str | None = None  # shown instead of the URL, e.g. "Portfolio"


class Basics(Base):
    name: str
    title: str | None = None  # headline under the name, e.g. "Senior Backend Engineer"
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    links: list[Link] = []

    @field_validator("links", mode="before")
    @classmethod
    def _links(cls, v: Any) -> Any:
        return [{"url": x} if isinstance(x, str) else x for x in as_list(v)]


class SkillGroup(Base):
    category: str
    items: Tags


class Job(Base):
    company: str
    role: str
    location: str | None = None
    url: str | None = None
    start: Date
    end: Date = "present"
    summary: Text | None = None  # optional one line about the company or team
    bullets: Lines = []
    tech: Tags = []


class Project(Base):
    name: str
    url: str | None = None
    tech: Tags = []
    start: Date | None = None
    end: Date | None = None
    description: Text | None = None
    bullets: Lines = []


class Education(Base):
    school: str
    degree: str
    location: str | None = None
    start: Date | None = None
    end: Date | None = None
    score: str | None = None  # "CGPA 8.6/10", "87%"
    bullets: Lines = []


class Certification(Base):
    name: str
    issuer: str | None = None
    date: Date | None = None
    url: str | None = None


class Section(Base):
    """Any other section: Publications, Languages, Volunteering…"""
    title: str
    items: Lines


class Settings(Base):
    theme: str = "classic"
    accent: str = "#1f4e79"
    page: Literal["A4", "Letter"] = "A4"
    one_page: bool = True  # shrink spacing and type a little if needed to fit one page
    margin_mm: float = 13
    sections: list[str] = list(SECTIONS)  # order; leave one out to hide it
    titles: dict[str, str] = {}  # rename headings, e.g. {experience: Work Experience}
    formats: list[str] = ["pdf"]  # what to export when you don't say

    @field_validator("theme")
    @classmethod
    def _theme(cls, v: str) -> str:
        known = available_themes()
        if v not in known:
            raise ValueError(f"unknown theme {v!r} — pick one of: {', '.join(known)}")
        return v

    @field_validator("accent")
    @classmethod
    def _accent(cls, v: str) -> str:
        v = v.strip().lower()
        if m := re.fullmatch(r"#?([0-9a-f])([0-9a-f])([0-9a-f])", v):
            v = "#" + "".join(c * 2 for c in m.groups())
        if not re.fullmatch(r"#?[0-9a-f]{6}", v):
            raise ValueError(f"accent must be a hex colour like #1f4e79, not {v!r}")
        return v if v.startswith("#") else "#" + v

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: Any) -> Any:
        return {"a4": "A4", "letter": "Letter"}.get(str(v).strip().lower(), v)

    @field_validator("sections")
    @classmethod
    def _sections(cls, v: list[str]) -> list[str]:
        v = [s.strip().lower() for s in v]
        if bad := [s for s in v if s not in SECTIONS]:
            raise ValueError(f"unknown section(s) {', '.join(bad)} — use: {', '.join(SECTIONS)}")
        return list(dict.fromkeys(v))

    @field_validator("formats", mode="before")
    @classmethod
    def _formats(cls, v: Any) -> Any:
        from .export import parse_formats  # export imports this module
        return parse_formats(",".join(as_csv_list(v)))


class Resume(Base):
    basics: Basics
    summary: Text | None = None
    skills: list[SkillGroup] = []
    experience: list[Job] = []
    projects: list[Project] = []
    education: list[Education] = []
    certifications: list[Certification] = []
    achievements: Lines = []
    extra: list[Section] = []
    settings: Settings = Settings()

    @field_validator("skills", mode="before")
    @classmethod
    def _skills(cls, v: Any) -> Any:
        """Also accept `skills: {Languages: [Python, Go], Cloud: AWS, GCP}`."""
        if isinstance(v, dict):
            return [{"category": k, "items": items} for k, items in v.items()]
        return as_list(v)

    def title_of(self, section: str) -> str:
        return self.settings.titles.get(section) or DEFAULT_TITLES.get(section, section.title())


# ---------- loading ----------

def available_themes() -> list[str]:
    return sorted(p.stem for p in THEMES_DIR.glob("*.css") if p.stem != "base")


def _where(loc: tuple) -> str:
    out = ""
    for part in loc:
        if isinstance(part, int):
            out += f" #{part + 1}"
        elif not str(part).startswith("function-"):
            out += f" → {part}" if out else str(part)
    return out


def describe(e: ValidationError) -> str:
    lines = []
    for err in e.errors():
        msg = err["msg"].removeprefix("Value error, ")
        if err["type"] == "missing":
            msg = "required but missing"
        elif err["type"] == "extra_forbidden":
            msg = "unknown field — a typo?"
        lines.append(f"  {_where(err['loc'])}: {msg}")
    return "\n".join(lines)


def parse(data: Any, source: str = "resume") -> Resume:
    if not isinstance(data, dict):
        raise ResumeError(f"{source} should be a set of fields (basics:, experience:, …)")
    try:
        return Resume.model_validate(data)
    except ValidationError as e:
        raise ResumeError(f"{source} has problems:\n{describe(e)}") from None


def load(path: Path) -> Resume:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ResumeError(f"no such file: {path}") from None
    except yaml.YAMLError as e:
        raise ResumeError(f"{path.name} isn't valid YAML:\n  {e}") from None
    return parse(data, path.name)
