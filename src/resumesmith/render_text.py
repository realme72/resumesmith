"""Markdown and plain-text exports (plain text is what you paste into job-portal forms)."""

from __future__ import annotations

from .model import Resume
from .text import contact_items, date_range, group_jobs, plain, visible_sections


def _items(r: Resume, key: str) -> list[str]:
    if key == "achievements":
        return r.achievements
    return r.extra[int(key.split(":")[1])].items


def render_markdown(r: Resume) -> str:
    b = r.basics
    out = [f"# {b.name}"]
    if b.title:
        out.append(f"**{b.title}**")
    if items := contact_items(r):
        out.append(" · ".join(f"[{t}]({h})" if h else t for t, h in items))
    for key, title in visible_sections(r):
        out.append(f"## {title}")
        if key == "summary":
            out.append(r.summary)
        elif key == "skills":
            out.append("\n".join(f"- **{g.category}:** {', '.join(g.items)}" for g in r.skills))
        elif key == "experience":
            for g in group_jobs(r.experience):
                company = f"[{g.company}]({g.url})" if g.url else g.company
                out.append(f"### {company}" + (f" · {g.location}" if g.location else ""))
                for j in g.jobs:
                    block = [f"**{j.role}** · {date_range(j.start, j.end)}"]
                    if j.summary:
                        block.append(f"*{j.summary}*")
                    block += [f"- {x}" for x in j.bullets]
                    if j.tech:
                        block.append(f"\n*Tech:* {', '.join(j.tech)}")
                    out.append("\n".join(block))
        elif key == "projects":
            for p in r.projects:
                head = f"### [{p.name}]({p.url})" if p.url else f"### {p.name}"
                meta = [", ".join(p.tech)] if p.tech else []
                if p.start or p.end:
                    meta.append(date_range(p.start, p.end))
                block = [head] + ([f"*{' · '.join(meta)}*"] if meta else [])
                if p.description:
                    block.append(p.description)
                block += [f"- {x}" for x in p.bullets]
                out.append("\n".join(block))
        elif key == "education":
            for e in r.education:
                block = [f"### {e.school}" + (f" · {e.location}" if e.location else "")]
                line = f"**{e.degree}**" + (f" — {e.score}" if e.score else "")
                if e.start or e.end:
                    line += f" · {date_range(e.start, e.end)}"
                block.append(line)
                block += [f"- {x}" for x in e.bullets]
                out.append("\n".join(block))
        elif key == "certifications":
            out.append("\n".join(
                f"- {f'[{c.name}]({c.url})' if c.url else c.name}"
                + (f" — {c.issuer}" if c.issuer else "") + (f" ({date_range(c.date, None)})" if c.date else "")
                for c in r.certifications))
        else:
            out.append("\n".join(f"- {x}" for x in _items(r, key)))
    return "\n\n".join(out) + "\n"


def render_text(r: Resume) -> str:
    b = r.basics
    out = [b.name.upper()]
    if b.title:
        out.append(b.title)
    if items := contact_items(r):
        out.append(" | ".join(t if not h or h.startswith(("mailto:", "tel:")) else plain(f"[{t}]({h})")
                              for t, h in items))

    def heading(title: str) -> None:
        out.append("")
        out.append(title.upper())
        out.append("-" * len(title))

    for key, title in visible_sections(r):
        heading(title)
        if key == "summary":
            out.append(plain(r.summary))
        elif key == "skills":
            out += [f"{g.category}: {', '.join(g.items)}" for g in r.skills]
        elif key == "experience":
            for i, g in enumerate(group_jobs(r.experience)):
                if i:
                    out.append("")
                out.append(g.company + (f", {g.location}" if g.location else ""))
                for j in g.jobs:
                    out.append(f"{j.role} | {date_range(j.start, j.end)}")
                    if j.summary:
                        out.append(plain(j.summary))
                    out += [f"- {plain(x)}" for x in j.bullets]
                    if j.tech:
                        out.append(f"Tech: {', '.join(j.tech)}")
        elif key == "projects":
            for i, p in enumerate(r.projects):
                if i:
                    out.append("")
                line = p.name + (f" ({p.url})" if p.url else "")
                if p.tech:
                    line += f" | {', '.join(p.tech)}"
                if p.start or p.end:
                    line += f" | {date_range(p.start, p.end)}"
                out.append(line)
                if p.description:
                    out.append(plain(p.description))
                out += [f"- {plain(x)}" for x in p.bullets]
        elif key == "education":
            for e in r.education:
                out.append(e.school + (f", {e.location}" if e.location else ""))
                line = e.degree + (f" - {e.score}" if e.score else "")
                if e.start or e.end:
                    line += f" | {date_range(e.start, e.end)}"
                out.append(line)
                out += [f"- {plain(x)}" for x in e.bullets]
        elif key == "certifications":
            out += [f"- {c.name}" + (f", {c.issuer}" if c.issuer else "")
                    + (f" ({date_range(c.date, None)})" if c.date else "") for c in r.certifications]
        else:
            out += [f"- {plain(x)}" for x in _items(r, key)]
    return "\n".join(out) + "\n"
