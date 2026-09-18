import pytest
import yaml

from resumesmith.model import ResumeError, normalize_date, parse


def minimal(**extra):
    return {"basics": {"name": "Riya Sen", "email": "riya@example.com"}, **extra}


@pytest.mark.parametrize("raw, want", [
    ("Mar 2022", "2022-03"), ("march 2022", "2022-03"), ("Sept 2021", "2021-09"), ("Jan '20", "2020-01"),
    ("2022-03", "2022-03"), ("03/2022", "2022-03"), (2022, "2022"), ("Present", "present"),
])
def test_dates(raw, want):
    assert normalize_date(raw) == want


def test_unreadable_date_says_how_to_write_it():
    with pytest.raises(ValueError, match="Mar 2022"):
        normalize_date("sometime")


def test_bullet_with_a_colon_survives_yaml():
    data = yaml.safe_load("""
basics: {name: Riya Sen}
experience:
  - company: Acme
    role: Engineer
    start: 2020
    bullets:
      - "Plain bullet"
      - Cut costs: saved 20% on AWS
""")
    assert parse(data).experience[0].bullets == ["Plain bullet", "Cut costs: saved 20% on AWS"]


def test_skills_as_mapping_with_comma_lists():
    r = parse(minimal(skills={"Languages": "Python, Go", "Cloud": ["AWS"]}))
    assert [(g.category, g.items) for g in r.skills] == [("Languages", ["Python", "Go"]), ("Cloud", ["AWS"])]


def test_links_can_be_plain_urls():
    r = parse(minimal(basics={"name": "Riya Sen", "links": ["github.com/riya", {"url": "riya.dev", "label": "Site"}]}))
    assert [(link.url, link.label) for link in r.basics.links] == [("github.com/riya", None), ("riya.dev", "Site")]


def test_errors_point_at_the_field():
    with pytest.raises(ResumeError) as e:
        parse({"basics": {"name": "Riya"},
               "experience": [{"company": "Acme", "role": "Eng", "start": "whenever", "bulets": []}]})
    msg = str(e.value)
    assert "experience #1 → start: can't read the date" in msg
    assert "experience #1 → bulets: unknown field" in msg


def test_settings_are_normalised():
    s = parse(minimal(settings={"accent": "#abc", "page": "letter", "formats": "PDF, word"})).settings
    assert (s.accent, s.page, s.formats) == ("#aabbcc", "Letter", ["pdf", "docx"])
    with pytest.raises(ResumeError, match="unknown theme"):
        parse(minimal(settings={"theme": "fancy"}))
