import docx
import pytest
from pypdf import PdfReader

from resumesmith.cli import main
from resumesmith.export import export, parse_formats
from resumesmith.model import ROOT, load
from resumesmith.render_html import Browser, BrowserMissing

EXAMPLE = ROOT / "resumes" / "example.yaml"
STEM = "Aarav_Mehta_Resume"


@pytest.fixture(scope="module")
def browser_ok():
    try:
        with Browser():
            pass
    except BrowserMissing as e:
        pytest.skip(str(e))


def test_parse_formats():
    assert parse_formats("PDF, word .md") == ["pdf", "docx", "md"]
    with pytest.raises(ValueError, match="unknown format"):
        parse_formats("pdf, rtf")


def test_text_formats_via_cli(tmp_path):
    assert main(["build", str(EXAMPLE), "-f", "md,txt", "-o", str(tmp_path)]) == 0
    md = (tmp_path / f"{STEM}.md").read_text()
    txt = (tmp_path / f"{STEM}.txt").read_text()
    assert "# Aarav Mehta" in md and "### Finlo Payments" in md
    assert "EXPERIENCE" in txt and "**" not in txt


def test_pdf_docx_png_html(tmp_path, browser_ok):
    res = export(load(EXAMPLE), ["pdf", "docx", "html", "png"], tmp_path)
    assert (res.pages, res.fitted) == (1, True)

    text = PdfReader(tmp_path / f"{STEM}.pdf").pages[0].extract_text()
    for expected in ("Aarav Mehta", "aarav.mehta@example.com", "Finlo Payments", "Certified"):
        assert expected in text
    assert "ﬁ" not in text  # no "fi" ligature glyph, which trips ATS parsers
    for heading in ("SUMMARY", "EXPERIENCE", "EDUCATION"):  # headings must extract as whole words
        assert heading in text

    body = "\n".join(p.text for p in docx.Document(tmp_path / f"{STEM}.docx").paragraphs)
    assert "Senior Software Engineer" in body and "Kafka" in body
    assert (tmp_path / f"{STEM}.png").read_bytes()[:4] == b"\x89PNG"
    assert "<h1 class=\"name\">Aarav Mehta</h1>" in (tmp_path / f"{STEM}.html").read_text()
