---
name: tailor-resume
description: Tailor an existing ResumeSmith resume to a specific job description, reporting keyword coverage before and after.
---

Follow "Tailoring to a job" in CLAUDE.md.

1. Save the job description to `jd/<company>.txt` (fetch it if the user gave a URL; ask them to paste it if the page needs a login).
2. Run `./resumesmith match resumes/<base>.yaml jd/<company>.txt` and note the coverage.
3. Copy the base file to `resumes/<base>-<company>.yaml` and tailor it: reorder, reword with the posting's exact terms, and adjust the headline and summary. Only claim skills the base resume or the user supports. Ask about a missing skill rather than adding it.
4. Re-run `match` on the new file, build it, run `check`, and report coverage before → after and the output paths.
