import json
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from resumesmith import server

SAMPLE = {
    "basics": {"name": "Riya Sen", "email": "riya@example.com"},
    "experience": [{"company": "Acme", "role": "Engineer", "start": "Jan 2022",
                    "bullets": ["Worked on search", ""]}],
    "settings": {"theme": "classic", "formats": ["md"]},
}


@pytest.fixture
def dash(tmp_path):
    board = server.Dashboard(resumes_dir=tmp_path / "resumes")
    board.resumes_dir.mkdir(parents=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.bind_handler(board))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}", board
    finally:
        httpd.shutdown()
        httpd.server_close()


def post(base, path, payload, token):
    request = urllib.request.Request(
        base + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-ResumeSmith-Token": token or ""})
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def test_page_carries_its_token(dash):
    base, board = dash
    page = urllib.request.urlopen(base + "/").read().decode()
    assert board.token in page and "{{TOKEN}}" not in page


def test_api_refuses_a_wrong_token(dash):
    base, _ = dash
    with pytest.raises(urllib.error.HTTPError) as e:
        post(base, "/api/preview", {"resume": SAMPLE}, "not-the-token")
    assert e.value.code == 403


def test_preview_returns_html_review_and_coaching(dash):
    base, board = dash
    data = post(base, "/api/preview", {"resume": SAMPLE}, board.token)
    assert "Riya Sen" in data["html"]
    assert any(i["level"] == "warn" for i in data["review"])
    assert "Worked on" in data["tips"]["experience.0.bullets.0"][0]["message"]
    assert "experience.0.bullets.1" not in data["tips"]  # a blank line isn't nagged about


def test_preview_ignores_entries_still_being_typed(dash):
    base, board = dash
    half_typed = {"basics": {"name": "Riya Sen", "email": "riya@example.com"},
                  "experience": [{"end": "present"}, {"company": "Acme"}],
                  "education": [{"school": "COEP"}]}
    data = post(base, "/api/preview", {"resume": half_typed}, board.token)
    assert "Riya Sen" in data["html"]
    assert "Acme" not in data["html"]  # drawn once it has a role and a start date
    # the started entries say why they're missing; the untouched one stays quiet
    assert {"label": "Acme", "missing": ["job title", "start date"]} in data["hidden"]
    assert {"label": "COEP", "missing": ["degree"]} in data["hidden"]
    assert len(data["hidden"]) == 2


def test_export_still_insists_on_finishing_an_entry(dash):
    base, board = dash
    with pytest.raises(urllib.error.HTTPError) as e:
        post(base, "/api/export", {"resume": {"basics": {"name": "Riya Sen"},
                                              "experience": [{"company": "Acme"}]},
                                   "formats": ["md"]}, board.token)
    assert "role: required but missing" in e.value.read().decode()


def test_a_labelled_link_becomes_a_clickable_word(dash):
    base, board = dash
    resume = {"basics": {"name": "Riya Sen",
                         "links": [{"url": "https://www.linkedin.com/in/riya", "label": "LinkedIn"}]}}
    html = post(base, "/api/preview", {"resume": resume}, board.token)["html"]
    assert '<a href="https://www.linkedin.com/in/riya">LinkedIn</a>' in html


def test_section_order_is_honoured(dash):
    base, board = dash
    resume = {"basics": {"name": "Riya Sen"}, "summary": "Engineer",
              "skills": [{"category": "Languages", "items": "Python"}],
              "experience": [{"company": "Acme", "role": "Engineer", "start": "2022",
                              "bullets": ["Built the thing that made the money"]}],
              "settings": {"sections": ["summary", "experience", "skills"]}}
    html = post(base, "/api/preview", {"resume": resume}, board.token)["html"]
    assert html.index(">Experience<") < html.index(">Skills<")

    resume["settings"]["sections"] = ["summary", "skills", "experience"]
    html = post(base, "/api/preview", {"resume": resume}, board.token)["html"]
    assert html.index(">Skills<") < html.index(">Experience<")


def test_export_hands_over_the_files_and_keeps_nothing(dash, tmp_path):
    base, board = dash
    result = post(base, "/api/export", {"resume": SAMPLE, "formats": ["md", "txt"]}, board.token)
    assert [f["name"] for f in result["files"]] == ["Riya_Sen_Resume.md", "Riya_Sen_Resume.txt"]
    downloaded = urllib.request.urlopen(base + result["files"][0]["url"]).read().decode()
    assert "# Riya Sen" in downloaded
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []  # nothing written anywhere


def test_finished_files_are_handed_out_then_forgotten():
    store = server.Downloads(keep_seconds=0.05, limit=2)
    token = store.add("a.pdf", b"one")
    assert store.get(token) == ("a.pdf", b"one")
    time.sleep(0.08)
    assert store.get(token) is None, "a download should not linger in memory"

    store = server.Downloads(limit=2)
    tokens = [store.add(f"{i}.pdf", b"x") for i in range(3)]
    assert store.get(tokens[0]) is None  # the oldest makes way once the limit is reached
    assert store.get(tokens[2]) is not None


def test_unknown_format_is_rejected(dash):
    base, board = dash
    with pytest.raises(urllib.error.HTTPError) as e:
        post(base, "/api/export", {"resume": SAMPLE, "formats": ["rtf"]}, board.token)
    assert "unknown format" in e.value.read().decode()


def test_save_asks_before_replacing_then_loads_back(dash):
    base, board = dash
    assert post(base, "/api/save", {"resume": SAMPLE, "stem": "riya-sen"}, board.token)["file"] == "riya-sen.yaml"
    assert post(base, "/api/save", {"resume": SAMPLE, "stem": "riya-sen"}, board.token)["needs_confirm"] is True
    loaded = post(base, "/api/load", {"file": "riya-sen.yaml"}, board.token)
    assert loaded["resume"]["basics"]["name"] == "Riya Sen"
    assert loaded["stem"] == "riya-sen"


def test_an_edited_source_file_is_noticed(tmp_path):
    source = tmp_path / "pkg" / "thing.py"
    source.parent.mkdir()
    source.write_text("x = 1")
    stamps = server.source_stamps(tmp_path)
    assert list(stamps) == [source]
    assert server.changed_source(stamps) is None
    source.write_text("x = 2")
    os.utime(source, (stamps[source] + 5, stamps[source] + 5))
    assert server.changed_source(stamps) == source


def test_a_bad_date_comes_back_as_a_readable_message(dash):
    base, board = dash
    bad = {"basics": {"name": "R"}, "experience": [{"company": "A", "role": "B", "start": "whenever"}]}
    with pytest.raises(urllib.error.HTTPError) as e:
        post(base, "/api/preview", {"resume": bad}, board.token)
    assert "can't read the date" in e.value.read().decode()
