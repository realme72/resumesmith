# ResumeSmith

Two front ends over one resume format:

- `site/` — the page served by `./resumesmith serve`: `app.js` is the form and the wiring,
  `resume.js` draws the preview, `review.js` is the wording check, `themes/*.css` are the designs.
  It draws its own preview but asks `/api/export` for finished files.
- `src/resumesmith/` — the renderer and command line: `./resumesmith build FILE -f pdf,docx
  [-t theme|all]`, `check`, `match`, `serve`, `new`. Renders with Playwright/Chromium.

**Exports go through the Python renderer, never the browser's print dialog.** That dialog stamps the
page URL, date and page number onto the resume and makes the person click through it; a PDF must come
out of Chromium clean, in one click. This was tried the other way and reverted.

Tests: `.venv/bin/python -m pytest -q`.

**The preview and the exporter must stay in step.** `site/resume.js` is a port of `text.py`, the
Jinja template and the model's normalisation; `site/review.js` is a port of `lint.py`. Change one,
change the other. The check that catches drift renders `resumes/example.yaml` both ways and compares
the markup — run it after touching either renderer.

CSS layout in `site/` can't be covered by pytest. Verify it by driving the page with Playwright
(`channel="chrome"`): check `document.body.scrollHeight - window.innerHeight`, that nothing covers
`#export`, and screenshot it.

## When someone gives you their details

1. Write `resumes/<first-last>.yaml` in the shape of `resumes/example.yaml`. **Rewrite** the content
   by the rules below rather than transcribing it. Personal resume files are gitignored — keep them
   out of the repository.
2. Never invent numbers, employers, titles, dates or skills. If a bullet needs a metric you don't
   have, ask — collect every question into one message. Don't leave `TODO` in the file.
3. Build it, run `check`, fix every ✗ and ! item, read the PNG export to confirm the layout, and
   report the file paths plus anything you guessed.

## Writing rules

- Bullet = past-tense verb + what was done + measurable result. "Cut p99 latency from 850 ms to
  190 ms by adding Redis caching", never "Responsible for API performance".
- Numbers show scale (users, requests/s, data volume, ₹/$), impact (% faster or cheaper, hours
  saved) or scope (team size, services).
- 3–5 bullets for recent roles, 2–3 for older ones; one idea per bullet, at most 2 lines.
- No pronouns (I, my, we). No buzzwords (passionate, team player, results-driven).
- Summary: 2–3 lines — target title, years, strongest area, one standout result.
- Skills grouped and ordered by relevance; only what they can be interviewed on.
- One page under ~10 years of experience; cut the oldest and weakest material first.
- Indian job market: no photo, date of birth, marital status, father's name or "Declaration".
- Freshers: put education before experience in `settings.sections`.

## Tailoring to a job

Copy the base file to `resumes/<name>-<company>.yaml`, run
`./resumesmith match <file> jd.txt`, then reorder and reword truthfully using the posting's terms.
Never add a skill they don't have. Re-run `match` and report coverage before → after.
