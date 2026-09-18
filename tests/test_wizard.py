from resumesmith import wizard
from resumesmith.model import load
from resumesmith.prompts import Prompter


def prompter(answers):
    it = iter(answers)

    def fake_input(_prompt):
        try:
            return next(it)
        except StopIteration:
            raise KeyboardInterrupt from None

    return Prompter(input_fn=fake_input, output_fn=lambda _: None, color=False)


def test_wizard_saves_a_valid_resume(tmp_path):
    p = prompter([
        "Riya Sen", "Data Engineer", "riya@example.com", "", "Pune, India",   # about you
        "linkedin.com/in/riya", "",                                             # links
        "Data engineer with 3 years building pipelines.", "",                  # summary
        "",                                                                     # add a job? (yes)
        "Acme", "Data Engineer", "Pune", "Jan 2022", "",                        # ...still there
        "Built Airflow pipelines moving 2 TB a day", "",                       # achievements
        "Python, Airflow",                                                      # tech
        "n",                                                                    # another job?
        "",                                                                     # add a project? (no)
        "",                                                                     # add education? (yes)
        "COEP", "B.E., Computer Engineering", "", "2017", "2021", "CGPA 8.1/10",
        "n",                                                                    # more education?
        "Languages: Python, SQL", "Spark", "",                                  # skills
        "",                                                                     # certification? (no)
        "",                                                                     # achievements
        "modern", "", "",                                                       # theme, accent, paper
        "pdf, word",                                                            # formats
    ])
    r = load(wizard.run(p, tmp_path))
    assert r.basics.name == "Riya Sen"
    assert r.experience[0].end == "present"
    assert [(g.category, g.items) for g in r.skills] == [("Languages", ["Python", "SQL"]), ("Skills", ["Spark"])]
    assert (r.settings.theme, r.settings.formats) == ("modern", ["pdf", "docx"])


def test_ctrl_c_keeps_what_was_typed(tmp_path):
    assert wizard.run(prompter(["Riya Sen", "Data Engineer"]), tmp_path) is None
    draft = tmp_path / "riya-sen.draft.yaml"
    assert "Data Engineer" in draft.read_text()
