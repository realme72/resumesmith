from resumesmith.match import match
from resumesmith.model import parse


def test_match_finds_gaps_and_understands_aliases():
    r = parse({
        "basics": {"name": "Riya Sen"},
        "skills": {"Languages": "Python, JavaScript"},
        "experience": [{"company": "Acme", "role": "Engineer", "start": 2020,
                        "bullets": ["Built services on Postgres and k8s"]}],
    })
    rep = match(r, "We need Python, Java, PostgreSQL, Kubernetes and Go. Payments experience; payments at scale; payments.")
    assert {"python", "postgresql", "kubernetes"} <= set(rep.present)
    assert "java" in rep.missing  # JavaScript doesn't count as Java
    assert "golang" in rep.missing
    assert ("payments", 3) in rep.repeated_missing
