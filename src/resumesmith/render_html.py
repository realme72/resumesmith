"""HTML from the template, and PDF/PNG from that HTML via a headless browser."""

from __future__ import annotations

import io
import os
from dataclasses import dataclass

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from .model import ROOT, THEMES_DIR, Resume
from .text import (bare_url, contact_lines, date_range, full_url, group_jobs, to_html,
                   visible_sections)

PAGE_SIZES = {"A4": ("210mm", "297mm"), "Letter": ("8.5in", "11in")}
MIN_SCALE = 0.85  # 10.5pt type never drops below ~9pt


class BrowserMissing(RuntimeError):
    pass


_env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=select_autoescape(["j2", "html"]),
                   trim_blocks=True, lstrip_blocks=True)
_env.filters["md"] = lambda s: Markup(to_html(s))
_env.filters["daterange"] = date_range
_env.filters["url"] = full_url
_env.filters["bare"] = bare_url


def render_html(r: Resume, scale: float = 1.0, margin_mm: float | None = None, bare: bool = False) -> str:
    s = r.settings
    css = (THEMES_DIR / "base.css").read_text() + "\n" + (THEMES_DIR / f"{s.theme}.css").read_text()
    page_w, page_h = PAGE_SIZES[s.page]
    return _env.get_template("resume.html.j2").render(
        r=r, css=Markup(css), scale=round(scale, 3), margin=margin_mm if margin_mm is not None else s.margin_mm,
        page_w=page_w, page_h=page_h, bare=bare, contact=contact_lines(r),
        sections=visible_sections(r), job_groups=group_jobs(r.experience),
    )


class Browser:
    """One headless browser reused for every render (fitting to a page takes a few)."""

    def __enter__(self) -> Browser:
        from playwright.sync_api import Error, sync_playwright

        self._pw = sync_playwright().start()
        # A container gives Chromium a 64MB /dev/shm and no GPU; writing to /tmp instead keeps it
        # from dying part-way through a render. Hosted, it also can't have the sandbox's privileges.
        args = ["--disable-dev-shm-usage", "--disable-gpu"]
        if os.environ.get("PORT"):
            args.append("--no-sandbox")
        try:
            self._browser = self._pw.chromium.launch(args=args)
        except Error:
            try:  # Playwright's own Chromium isn't downloaded — fall back to installed Google Chrome
                self._browser = self._pw.chromium.launch(channel="chrome", args=args)
            except Error:
                self._pw.stop()
                raise BrowserMissing("PDF/PNG export needs a browser. Install Google Chrome, or run: "
                                     ".venv/bin/playwright install chromium") from None
        self._page = self._browser.new_page()
        return self

    def __exit__(self, *exc) -> None:
        self._browser.close()
        self._pw.stop()

    def pdf(self, html: str, page: str, margin_mm: float) -> bytes:
        self._page.set_content(html, wait_until="load")
        m = f"{margin_mm}mm"
        return self._page.pdf(format=page, print_background=True, tagged=True,
                              margin={"top": m, "bottom": m, "left": m, "right": m})

    def png(self, html: str) -> bytes:
        page = self._browser.new_page(device_scale_factor=2, viewport={"width": 900, "height": 1200})
        try:
            page.set_content(html, wait_until="load")
            return page.locator(".sheet").screenshot(type="png")
        finally:
            page.close()


@dataclass
class Fit:
    pdf: bytes
    pages: int
    scale: float
    margin_mm: float
    fitted: bool  # False when one_page was asked for but the content is too long


def page_count(pdf: bytes) -> int:
    from pypdf import PdfReader
    return len(PdfReader(io.BytesIO(pdf)).pages)


def fit_steps(r: Resume) -> list[tuple[float, float]]:
    """(scale, margin) to try in order: tighten the margins first, then the type."""
    m = r.settings.margin_mm
    steps = [(1.0, m)]
    if not r.settings.one_page:
        return steps
    tight = m
    for smaller in (m - 2, m - 4):
        if smaller >= 8:
            steps.append((1.0, smaller))
            tight = smaller
    scale = 0.97
    while scale >= MIN_SCALE - 1e-9:
        steps.append((round(scale, 2), tight))
        scale -= 0.03
    return steps


def fit_pdf(r: Resume, browser: Browser) -> Fit:
    first = None
    for scale, margin in fit_steps(r):
        pdf = browser.pdf(render_html(r, scale, margin), r.settings.page, margin)
        pages = page_count(pdf)
        if first is None:
            first = Fit(pdf, pages, scale, margin, pages == 1)
        if pages == 1:
            return Fit(pdf, 1, scale, margin, True)
    # Doesn't fit even at the smallest size: two comfortable pages beat one cramped one.
    first.fitted = first.pages == 1 or not r.settings.one_page
    return first
