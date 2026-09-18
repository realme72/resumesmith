# ResumeSmith

A resume builder that runs entirely in your browser. Fill in the form, watch the page redraw as you
type, and download a PDF or a Word file. No account, no upload, no paid tier.

**Your details never leave your machine.** There is no server to send them to: the page renders the
resume, checks the wording and builds the files locally. What you type is kept in this browser's own
storage so a reload doesn't lose it, and **Save a copy** hands you a file you can keep.

## What it does

- **Live preview** — the page you see is the page that prints.
- **One page** — when the content spills over, it tightens the margins, then the type, down to about
  9 pt. If it still doesn't fit, it tells you rather than cramming.
- **Written for the machines that read it first** — one column, real selectable text, standard
  headings, no ligature glyphs, URLs that survive copy-and-paste.
- **Coaching as you type** — write "Responsible for the billing APIs" and it answers: *lead with what
  you did: Built, Led, Cut, Shipped…*. It also flags bullets with no numbers, pronouns, buzzwords,
  dates that run backwards and jobs out of order.
- **Your layout** — drag sections by the ⠿ handle to put Skills below Experience, or lead with
  Education. Three designs (classic, modern, compact), your own accent colour, A4 or US Letter.
- **Links that read well** — paste a LinkedIn address and it prints as "LinkedIn", clickable.

## Formats

| Format | How it works |
|---|---|
| **PDF** | Opens your browser's print dialog — choose *Save as PDF*. Untick "Headers and footers" so the page URL doesn't print. The text stays real text, which is what resume scanners need. |
| **Word (.docx)** | Built in the browser and downloaded. Opens in Word, Pages or Google Docs. |

Want Markdown, plain text, HTML or PNG as well? The command-line version below produces all of them.

## Run it yourself

It's a static site — any web server will do:

```bash
python3 -m http.server -d site 8000   # then open http://localhost:8000
```

## Deploy your own

The whole app is the `site/` folder, so hosting is free on any static host.

**Vercel:** import the repository, and it picks up `vercel.json` (which sets the output directory to
`site`). No build step, no environment variables.

**Anywhere else:** upload `site/` — Cloudflare Pages, Netlify, GitHub Pages and S3 all work the same
way. Note that Vercel's free Hobby plan is for non-commercial use, so if you add advertising or
donations you'll need their Pro plan or a host whose free tier allows it.

## The command line

The repository also carries a Python version for people who'd rather keep their resume as a file.
It renders with a real browser engine, so it exports **PDF, Word, HTML, Markdown, plain text and
PNG**, and it can compare a resume with a job description.

```bash
./resumesmith build resumes/example.yaml -f pdf,docx
./resumesmith check resumes/example.yaml         # the same review, in your terminal
./resumesmith match resumes/example.yaml jd.txt  # which skills a job asks for that you don't show
./resumesmith                                    # a menu, if you prefer
```

`resumes/example.yaml` documents every field. Inside any text, `**bold**` and `[text](https://link)`
work; dates accept `Mar 2022`, `2022-03`, `2022` or `present`.

## Working on it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

- `site/` — the browser app. `resume.js` renders, `review.js` checks the wording, `docx.js` writes
  the Word file, `app.js` is the page itself, `themes/*.css` are the designs.
- `src/resumesmith/` — the Python command line, which shares those same theme files.
- Both renderers are kept in step: their HTML output is compared against each other, so a change to
  one without the other shows up immediately.

## Licence

MIT — see [LICENSE](LICENSE).
