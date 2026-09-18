import datetime as dt

from resumesmith.lint import bullet_tips, check, experience_years
from resumesmith.model import ROOT, load, parse


def levels(text):
    return {level for level, _ in bullet_tips(text)}


def test_strong_bullet_passes():
    assert bullet_tips("Cut p99 latency of the payments API from 850 ms to 190 ms with Redis caching") == []


def test_weak_bullets_are_flagged():
    assert any('"Responsible for"' in m for _, m in bullet_tips("Responsible for maintaining billing APIs for 3 teams"))
    assert "warn" in levels("I built the billing service used by 3 teams")
    assert "error" in levels("Reduced cloud costs by XX% TODO")
    assert any("no number" in m for _, m in bullet_tips("Built the internal admin dashboard for support staff"))


def resume(*jobs):
    return parse({"basics": {"name": "R", "email": "r@example.com"}, "experience": list(jobs)})


def test_dates_and_order():
    r = resume({"company": "Old", "role": "Eng", "start": "2019-01", "end": "2020-01"},
               {"company": "New", "role": "Eng", "start": "2021-01", "end": "2020-06"})
    messages = {(i.where, i.message) for i in check(r, today=dt.date(2026, 1, 1))}
    assert ("Experience", "jobs aren't most-recent-first — reorder them") in messages
    assert ("New (Eng)", "ends before it starts") in messages


def test_overlapping_jobs_count_once():
    r = resume({"company": "A", "role": "x", "start": "2020-01", "end": "2021-12"},
               {"company": "B", "role": "y", "start": "2021-01", "end": "2022-12"})
    assert experience_years(r) == 3


def test_example_resume_has_nothing_serious():
    r = load(ROOT / "resumes" / "example.yaml")
    assert [i for i in check(r, pages=1) if i.level != "tip"] == []
