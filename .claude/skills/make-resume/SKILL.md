---
name: make-resume
description: Turn the user's details (notes, an old resume, LinkedIn text) into a polished resume with ResumeSmith, in the formats they choose (PDF, Word, HTML, Markdown, text, PNG).
---

Follow "When the user gives you their details" and "Writing rules" in CLAUDE.md.

If the user attached or pointed at an old resume, read it, then write `resumes/<first-last>.yaml`. If details are missing that a resume can't go without (email, job titles, dates), or bullets lack results you could only guess, ask once with every question in a single message.

Finish by building, running `check`, reading the PNG export to confirm the layout, and giving the user the output file paths.
