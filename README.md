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

Your browser opens on the front door, which asks how you want to start: talk it through, write it
yourself, or open a resume you already have. All three arrive at the same builder on `/build` —
details on the left, a live preview on the right, formats along the bottom. Press **Export** and the
files land in your downloads.

## What it does

- **Live preview** — what you see is what the exporter produces; both draw the same markup.
- **One page** — if the content spills over, it tightens the spacing and the type (down to about
  9 pt) until it fits, and tells you plainly when it can't.
- **Written for the machines that read it first** — one column, real selectable text, standard
  headings, no ligature glyphs, URLs that survive copy-and-paste.
- **Coaching as you type** — write "Responsible for the billing APIs" and it answers: *lead with what
  you did: Built, Led, Cut, Shipped…*. It also flags bullets with no numbers, pronouns, buzzwords,
  dates that run backwards and jobs out of order.
- **Your layout** — Summary, Experience, Projects, Skills, then Education, and drag any section by
  its ⠿ handle to change that — freshers usually lead with Education. Three designs (classic,
  modern, compact), your own accent colour, A4 or US Letter.
- **Links that read well** — paste a LinkedIn address and it prints as "LinkedIn", clickable.

## Starting from a resume you already have

**Upload a resume** reads a `.pdf` or `.docx` and fills the form in, so you can edit what you have
rather than retyping it. The file is read in your browser and never uploaded.

Addresses are taken from the file rather than off the page, so a link printed as the word "LinkedIn"
keeps the address behind it — a PDF holds that in a link annotation, Word in its relationships. Only
the links in the header become contact details; a repository beside a project stays with the
project.

Treat the result as a head start, not a finished job: dates, job titles and bullet boundaries are
guessed from layout, and a resume laid out in two columns reads worst of all. Anything it couldn't
place confidently is left out rather than invented, so check every section.

PDFs are read with [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla, Apache-2.0), vendored in
`site/vendor/` so the page calls nobody at runtime.

## Talking it through

**Talk me through it** asks seven questions — who you are, where you've worked, what you've built —
and you answer them out loud. What you say is sorted into jobs, bullets, skills and education; the
first person comes off each bullet, so "I rebuilt the ledger" is written down as "Rebuilt the
ledger"; and the sentence that merely places a job ("I work at Finlo since April 2023") is dropped
rather than printed as though it were an achievement.

It won't turn you into someone more impressive than you are. It organises what you said and leaves
the wording to you, with the review panel marking every bullet that still wants a number or a
stronger verb. Names, dates and job titles are what it gets wrong most often, and anything it
couldn't place is left empty rather than invented — so read it through before exporting.

There's a microphone on every long box in the builder as well, for dictating a single bullet
without sitting through the interview.

**This is the one part of ResumeSmith that leaves your machine.** The speech recognition is the
browser's own, and Chrome and Edge send the recorded audio to a Google service to turn it into text.
Nothing else about your resume is uploaded. Firefox implements no speech recognition at all, so the
front door doesn't offer that route there.

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
