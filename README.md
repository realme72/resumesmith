# ResumeSmith

A resume builder you run yourself. Fill in the form, watch the page redraw as you type, and download
a polished PDF or Word file in one click. No account, no upload to anyone else, no paid tier.

Your draft is kept in your browser's own storage, so a reload never costs you anything, and the
renderer that turns it into a file runs on the machine you started it on. Nothing is kept once a
file has been handed to you.

## Start

```bash
cd resumesmith
./resumesmith serve
```

Your browser opens on the dashboard: details on the left, a live preview on the right, formats along
the bottom. Press **Export** and the files land in your downloads.

## What it does

- **Live preview** — what you see is what the exporter produces; both draw the same markup.
- **One page** — if the content spills over, it tightens the spacing and the type (down to about
  9 pt) until it fits, and tells you plainly when it can't.
- **Written for the machines that read it first** — one column, real selectable text, standard
  headings, no ligature glyphs, URLs that survive copy-and-paste.
- **Coaching as you type** — write "Responsible for the billing APIs" and it answers: *lead with what
  you did: Built, Led, Cut, Shipped…*. It also flags bullets with no numbers, pronouns, buzzwords,
  dates that run backwards and jobs out of order.
- **Your layout** — drag sections by the ⠿ handle to put Skills below Experience, or lead with
  Education. Three designs (classic, modern, compact), your own accent colour, A4 or US Letter.
- **Links that read well** — paste a LinkedIn address and it prints as "LinkedIn", clickable.

## Formats

| Format | How it's made |
|---|---|
| **PDF** | Rendered by Chromium: selectable text, working links, exact page fitting, and none of the URL/date headers a browser's print dialog stamps on. |
| **Word (.docx)** | A real Word document — editable in Word, Pages or Google Docs. |

The command line below adds HTML, Markdown, plain text and PNG.

## The command line

```bash
./resumesmith build resumes/example.yaml -f pdf,docx   # or html, md, txt, png, or all
./resumesmith check resumes/example.yaml               # the wording review, in your terminal
./resumesmith match resumes/example.yaml jd.txt        # skills a job asks for that you don't show
./resumesmith new                                      # build one by answering questions
```

`resumes/example.yaml` documents every field. Inside any text, `**bold**` and `[text](https://link)`
work; dates accept `Mar 2022`, `2022-03`, `2022` or `present`.

## Hosting it for other people

ResumeSmith renders with Chromium, so it wants a container host — Render, Fly.io, Railway and
friends — with about 1 GB of memory, rather than a static host like GitHub Pages.

```bash
docker build -t resumesmith .
docker run -p 8000:8000 resumesmith        # then open http://localhost:8000
```

The image reads `PORT` (and `HOST`, default `0.0.0.0`), which is what those hosts set for you.

A served copy keeps nothing. There is no database and no upload: the visitor's draft stays in their
browser, a finished file lives in memory only until it's fetched, and there are deliberately no
endpoints that read or write files beside the server. Exports are limited per visitor and only a
couple render at a time, so one caller can't tie up the machine.

A purely static build is possible but costs you the thing that makes this worth using: without a
renderer, the PDF has to come from the visitor's own print dialog, which stamps the page URL, the
date and a page number across the top and bottom of the resume. That trade isn't worth making.

## How it's put together

- `site/` — the page: `app.js` (the form and the wiring), `resume.js` (draws the preview),
  `review.js` (the wording check), `themes/*.css` (the designs).
- `src/resumesmith/` — the renderer and the command line, sharing `site/themes/`.
- The preview and the exporter must agree: `site/resume.js` is a port of the Python renderer, and a
  check renders `resumes/example.yaml` both ways and compares the markup.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

## Licence

MIT — see [LICENSE](LICENSE).
