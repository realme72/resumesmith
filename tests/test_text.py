from resumesmith.model import parse
from resumesmith.text import (bare_url, contact_items, contact_lines, date_range, group_jobs, plain,
                              to_html)


def test_inline_markup_and_escaping():
    assert to_html("Cut **40%** <b> [site](example.com)") == \
        'Cut <strong>40%</strong> &lt;b&gt; <a href="https://example.com">site</a>'


def test_plain_keeps_link_targets():
    assert plain("See [repo](https://github.com/x/y) **now**") == "See repo (github.com/x/y) now"


def test_date_ranges():
    assert date_range("2022-03", "present") == "Mar 2022 – Present"
    assert date_range("2019", "2019") == "2019"
    assert date_range(None, "2020") == "2020"


def test_bare_url():
    assert bare_url("https://www.linkedin.com/in/riya/") == "linkedin.com/in/riya"


def test_a_labelled_link_prints_its_label_and_keeps_its_address():
    r = parse({"basics": {"name": "Riya Sen", "links": [
        {"url": "https://www.linkedin.com/in/riya/", "label": "LinkedIn"},
        "github.com/riya",
    ]}})
    assert contact_items(r) == [("LinkedIn", "https://www.linkedin.com/in/riya/"),
                                ("github.com/riya", "https://github.com/riya")]


def test_long_contact_puts_links_on_their_own_line():
    basics = {"name": "R", "email": "riya.sen@example.com", "phone": "+91 98765 43210", "location": "Pune, India"}
    short = parse({"basics": basics})
    long = parse({"basics": {**basics, "links": ["linkedin.com/in/riya-sen-example", "github.com/riya-sen"]}})
    assert len(contact_lines(short)) == 1
    assert [[t for t, _ in line] for line in contact_lines(long)] == [
        ["Pune, India", "+91 98765 43210", "riya.sen@example.com"],
        ["linkedin.com/in/riya-sen-example", "github.com/riya-sen"],
    ]


def test_promotions_share_a_company_heading():
    jobs = [{"company": "Acme", "role": "SDE 2", "start": 2023}, {"company": "acme", "role": "SDE 1", "start": 2021},
            {"company": "Initech", "role": "Intern", "start": 2020, "end": 2020}]
    groups = group_jobs(parse({"basics": {"name": "R"}, "experience": jobs}).experience)
    assert [(g.company, [j.role for j in g.jobs]) for g in groups] == \
        [("Acme", ["SDE 2", "SDE 1"]), ("Initech", ["Intern"])]
