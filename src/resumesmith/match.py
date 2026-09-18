"""Compare a resume with a job description: which skills it asks for that the resume doesn't show."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from .model import Resume
from .text import plain

TERMS = [
    # languages
    "python", "java", "javascript", "typescript", "golang", "c++", "c#", "rust", "kotlin", "scala", "ruby",
    "php", "swift", "sql", "bash", "dart", "elixir", "perl",
    # frameworks and libraries
    "django", "flask", "fastapi", "spring", "spring boot", "hibernate", "node.js", "express", "nestjs",
    "react", "next.js", "redux", "angular", "vue", "svelte", "rails", "laravel", ".net", "asp.net",
    "graphql", "rest", "grpc", "celery", "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn",
    "html", "css", "tailwind", "webpack", "android", "ios", "flutter", "react native",
    # data
    "postgresql", "mysql", "mongodb", "cassandra", "dynamodb", "sqlite", "oracle", "redis", "memcached",
    "elasticsearch", "opensearch", "kafka", "rabbitmq", "sqs", "spark", "pyspark", "airflow", "flink",
    "hadoop", "hive", "dbt", "snowflake", "bigquery", "redshift", "clickhouse", "etl", "data pipelines",
    "tableau", "power bi", "looker",
    # cloud and ops
    "aws", "gcp", "azure", "lambda", "ec2", "s3", "docker", "kubernetes", "helm", "terraform", "ansible",
    "jenkins", "github actions", "gitlab ci", "ci/cd", "linux", "git", "nginx", "prometheus", "grafana",
    "datadog", "elk", "splunk", "opentelemetry", "sentry", "observability", "sre",
    # practices and concepts
    "microservices", "distributed systems", "system design", "event-driven", "message queues", "caching",
    "websockets", "oauth", "jwt", "security", "scalability", "high availability", "performance tuning",
    "load balancing", "sharding", "data structures", "algorithms", "oop", "design patterns",
    "unit testing", "integration testing", "tdd", "pytest", "junit", "selenium", "playwright", "cypress",
    "jest", "agile", "scrum", "code review", "mentoring",
    # ml / ai
    "machine learning", "deep learning", "nlp", "computer vision", "llm", "generative ai", "rag",
    "langchain", "prompt engineering", "mlops",
]
ALIASES = {
    "postgres": "postgresql", "k8s": "kubernetes", "nodejs": "node.js", "node js": "node.js",
    "reactjs": "react", "react.js": "react", "nextjs": "next.js", "vue.js": "vue", "vuejs": "vue",
    "go lang": "golang", "amazon web services": "aws", "google cloud": "gcp", "restful": "rest",
    "rest api": "rest", "rest apis": "rest", "ci cd": "ci/cd", "cicd": "ci/cd", "gen ai": "generative ai",
    "genai": "generative ai", "ml": "machine learning", "sklearn": "scikit-learn", "springboot": "spring boot",
    "ruby on rails": "rails", "js": "javascript", "dsa": "data structures", "message queue": "message queues",
    "microservice": "microservices", "websocket": "websockets", "large language models": "llm",
    "llms": "llm", "event driven": "event-driven", "object oriented": "oop", "unit tests": "unit testing",
    "k8": "kubernetes", "mongo": "mongodb", "elastic search": "elasticsearch",
}
STOPWORDS = set("""
a about above across after again against all also an and any are as at be because been before being
below between both but by can could did do does doing down during each either etc few for from further
had has have having here how i if in into is it its itself just may might more most must my no nor not
now of off on once only or other our out over own per plus same shall should so some such than that the
their them then there these they this those through to too under until up upon us very via was we well
were what when where which while who whom why will with within without would you your yours
ability able work working works team teams teammates experience experienced years year strong good
great excellent knowledge understanding skills skill role roles candidate candidates looking join
responsibilities requirements required preferred qualification qualifications including include
using use used build building develop developing development developer developers engineer engineers
engineering software company across new help ensure make across related relevant familiarity
proficiency proficient hands-on minimum bonus nice have opportunity environment within apply job
""".split())


def _has(text_low: str, term: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text_low) is not None


def find_terms(text: str, extra: list[str] = ()) -> set[str]:
    low = text.lower()
    found = {t for t in [*TERMS, *extra] if _has(low, t)}
    found |= {canon for alias, canon in ALIASES.items() if _has(low, alias)}
    if re.search(r"\bGo\b", text):  # the language, written capitalised; lowercase "go" is just a verb
        found.add("golang")
    return found


def resume_text(r: Resume) -> str:
    parts = [r.basics.title or "", r.summary or ""]
    parts += [f"{g.category} {' '.join(g.items)}" for g in r.skills]
    for j in r.experience:
        parts += [j.role, j.summary or "", *j.bullets, *j.tech]
    for p in r.projects:
        parts += [p.name, p.description or "", *p.bullets, *p.tech]
    parts += [e.degree for e in r.education] + [c.name for c in r.certifications] + r.achievements
    parts += [item for s in r.extra for item in s.items]
    return plain("\n".join(parts))


@dataclass
class MatchReport:
    present: list[str]
    missing: list[str]
    repeated_missing: list[tuple[str, int]]  # other words the job post keeps using

    @property
    def coverage(self) -> float:
        total = len(self.present) + len(self.missing)
        return len(self.present) / total if total else 1.0


def match(r: Resume, jd: str) -> MatchReport:
    own = [item.lower() for g in r.skills for item in g.items if len(item) > 1]
    cv = resume_text(r)
    wanted = find_terms(jd, own)
    have = find_terms(cv, own)
    present = sorted(wanted & have)
    missing = sorted(wanted - have)

    jd_low, cv_low = jd.lower(), cv.lower()
    words = re.findall(r"[a-z][a-z0-9+#.-]*[a-z0-9+#]", jd_low)
    covered = {w for t in wanted for w in t.split()} | set(ALIASES)
    counts = Counter(w for w in words if len(w) > 2 and w not in STOPWORDS and w not in covered)
    repeated = [(w, n) for w, n in counts.most_common() if n >= 2 and not _has(cv_low, w)][:12]
    return MatchReport(present, missing, repeated)
