"""Command line. With no command it shows a menu; otherwise: new, build, check, match."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from . import wizard
from .export import ALIASES, FORMATS, export, parse_formats
from .lint import Issue, check
from .match import match
from .model import ROOT, ResumeError, available_themes, load
from .prompts import Prompter
from .render_html import BrowserMissing
from .server import serve

RESUMES = ROOT / "resumes"
OUT = ROOT / "out"
ICONS = {"error": ("✗", "31"), "warn": ("!", "33"), "tip": ("·", "36")}


def _rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def _clean_path(raw: str) -> Path:
    """A typed, quoted, or Terminal drag-and-dropped path."""
    s = raw.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        s = s[1:-1]
    return Path(s.replace("\\ ", " ")).expanduser()


def _existing(raw: str) -> str:
    if not _clean_path(raw).is_file():
        raise ValueError(f"can't find the file {raw!r}")
    return raw


def _interactive() -> bool:
    return sys.stdin.isatty()


def print_issues(p: Prompter, issues: list[Issue], limit: int | None = None) -> None:
    if not issues:
        p.say("  Nothing to flag — nice.")
        return
    for i in issues[:limit]:
        icon, color = ICONS[i.level]
        p.say(f"  {p.style(icon, color)} {p.bold(i.where)}: {i.message}")
    if limit and len(issues) > limit:
        p.say(p.dim(f"  …and {len(issues) - limit} more."))


# ---------- commands ----------


def build(p: Prompter, path: Path, formats: list[str] | None, theme: str | None = None,
          out: Path | None = None, offer_open: bool = True) -> int:
    r = load(path)
    if formats is None:
        formats = (p.choose_many("Which format(s) do you want?", list(FORMATS.items()), r.settings.formats,
                                 aliases=ALIASES) if _interactive() else r.settings.formats)
    themes = available_themes() if theme == "all" else [theme or r.settings.theme]
    for t in themes:
        if t not in available_themes():
            raise ResumeError(f"unknown theme {t!r} — pick one of: {', '.join(available_themes())}, or all")

    first = None
    for t in themes:
        rt = r.model_copy(update={"settings": r.settings.model_copy(update={"theme": t})})
        out_dir = (out or OUT / path.stem.removesuffix(".draft")) / (t if theme == "all" else "")
        p.say(p.dim(f"Making {', '.join(formats)}{f' ({t})' if theme == 'all' else ''}…"))
        res = export(rt, formats, out_dir)
        first = first or res
        p.say(p.bold("Your resume is ready:"))
        for path in res.paths:
            p.say(f"  {_rel(path)}")
        if res.pages is not None:
            if not res.fitted:
                p.say(p.style(f"  It runs to {res.pages} pages, even with tighter spacing — see the review below "
                              "for what to trim, or set one_page: false in the file.", "33"))
            elif res.scale < 1:
                p.say(p.dim(f"  Fitted onto one page (type at {res.scale:.0%})."))
            else:
                p.say(p.dim(f"  {res.pages} page{'s' if res.pages > 1 else ''}."))
        for note in res.notes:
            p.say(p.dim(f"  {note}"))

    issues = check(r, first.pages)
    serious = [i for i in issues if i.level != "tip"]
    tips = len(issues) - len(serious)
    p.say("")
    if serious:
        p.say(p.bold("Worth fixing before you send it:"))
        print_issues(p, serious, limit=8)
    if tips:
        p.say(p.dim(f"{tips} smaller suggestion{'s' if tips > 1 else ''} — see them with: ./resumesmith check {_rel(path)}"))
    if not issues:
        p.say("Review: nothing to flag.")

    if offer_open and _interactive() and sys.platform == "darwin" and p.yes("Open it now?", default=True):
        subprocess.run(["open", str(first.paths[0])], check=False)
    return 0


def new(p: Prompter) -> int:
    path = wizard.run(p, RESUMES)
    if path is None:
        return 1
    p.say("")
    p.say(f"Saved your answers in {_rel(path)} — edit it any time and re-export with:")
    p.say(f"  ./resumesmith build {_rel(path)}")
    p.say("")
    return build(p, path, load(path).settings.formats)


def check_cmd(p: Prompter, path: Path) -> int:
    issues = check(load(path))
    p.say(p.bold(f"Review of {path.name}"))
    print_issues(p, issues)
    return 1 if any(i.level == "error" for i in issues) else 0


def match_cmd(p: Prompter, path: Path, jd_source: str) -> int:
    r = load(path)
    jd = sys.stdin.read() if jd_source == "-" else _clean_path(jd_source).read_text(encoding="utf-8", errors="ignore")
    rep = match(r, jd)
    total = len(rep.present) + len(rep.missing)
    if not total:
        p.say("Couldn't spot specific skills or tools in that job description.")
    else:
        p.say(p.bold(f"The job asks for {total} skills/tools; your resume shows {len(rep.present)} ({rep.coverage:.0%})."))
        if rep.present:
            p.say(f"  {p.style('✓', '32')} Have: {', '.join(rep.present)}")
        if rep.missing:
            p.say(f"  {p.style('✗', '31')} Missing: {', '.join(rep.missing)}")
    if rep.repeated_missing:
        p.say(f"  {p.style('·', '36')} The post keeps saying these, and your resume doesn't: "
              + ", ".join(f"{w} ({n}×)" for w, n in rep.repeated_missing))
    if rep.missing or rep.repeated_missing:
        p.say(p.dim("Add the ones that are true — in Skills, or better, in a bullet that shows you used them. "
                    "Copy the post's exact wording (ATS filters match words, not meaning)."))
    return 0


def _pick_resume(p: Prompter) -> Path | None:
    files = sorted(RESUMES.glob("*.yaml"), key=lambda f: (f.name == "example.yaml", -f.stat().st_mtime))
    if not files:
        p.say("No resume files yet — pick 'Create a new resume' first.")
        return None
    options = [(str(f), f.name) for f in files]
    return Path(p.choose("Which resume?", options, default=options[0][0]))


def menu(p: Prompter) -> int:
    p.say(p.bold("ResumeSmith") + p.dim(" — a polished resume from your details, in the format you want"))
    p.say("")
    choice = p.choose("What would you like to do?", [
        ("dashboard", "Open the dashboard — fill in a form and watch the preview"),
        ("new", "Create a new resume here in the terminal (question by question)"),
        ("export", "Export a resume I already made (PDF, Word, …)"),
        ("check", "Review a resume's wording"),
        ("match", "Compare a resume with a job description"),
    ], default="dashboard")
    if choice == "dashboard":
        return serve()
    if choice == "new":
        return new(p)
    if (path := _pick_resume(p)) is None:
        return 1
    if choice == "export":
        return build(p, path, None)
    if choice == "check":
        return check_cmd(p, path)
    jd = p.ask("Job description file (save the post as a .txt and drag it here)", required=True, check=_existing)
    return match_cmd(p, path, jd)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="resumesmith",
                                 description="A polished resume from your details — PDF, Word, HTML, Markdown, text or PNG. "
                                             "Run with no command for a guided menu.")
    sub = ap.add_subparsers(dest="cmd", metavar="command")
    sub.add_parser("new", help="create a resume by answering questions")
    d = sub.add_parser("serve", help="open the dashboard in your browser")
    d.add_argument("-p", "--port", type=int, default=8765)
    d.add_argument("--no-open", action="store_true", help="don't open a browser window")
    d.add_argument("--no-reload", action="store_true", help="don't restart when the code changes")
    b = sub.add_parser("build", help="export a resume file (asks which formats)")
    b.add_argument("file", type=_clean_path)
    b.add_argument("-f", "--format", help=f"comma-separated: {', '.join(FORMATS)} — or all")
    b.add_argument("-t", "--theme", help=f"{', '.join(available_themes())} — or all, to compare them")
    b.add_argument("-o", "--out", type=_clean_path, help="output folder (default: out/<file name>/)")
    c = sub.add_parser("check", help="review the wording and flag weak spots")
    c.add_argument("file", type=_clean_path)
    m = sub.add_parser("match", help="compare a resume with a job description")
    m.add_argument("file", type=_clean_path)
    m.add_argument("jd", help="text file with the job description, or - to paste it")
    args = ap.parse_args(argv)

    formats = None
    if getattr(args, "format", None):
        try:
            formats = parse_formats(args.format)
        except ValueError as e:
            ap.error(str(e))

    p = Prompter()
    try:
        if args.cmd is None:
            return menu(p)
        if args.cmd == "new":
            return new(p)
        if args.cmd == "serve":
            return serve(args.port, not args.no_open, reload=not args.no_reload)
        if args.cmd == "build":
            return build(p, args.file, formats, args.theme, args.out)
        if args.cmd == "check":
            return check_cmd(p, args.file)
        return match_cmd(p, args.file, args.jd)
    except (ResumeError, BrowserMissing) as e:
        p.say(p.style(f"✗ {e}", "31"))
        return 1
    except (KeyboardInterrupt, EOFError):
        p.say("")
        return 130
