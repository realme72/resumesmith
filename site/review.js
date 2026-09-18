/* The wording review, in the browser — a port of lint.py, so the page and the command line
   flag the same things in the same words. */

import { dateKey, plainText } from "./resume.js";

const LEVELS = ["error", "warn", "tip"];

const WEAK_OPENERS = ["responsible for", "was responsible", "worked on", "working on", "helped",
  "assisted", "involved in", "tasked with", "duties included", "participated in", "part of", "handled"];
const BUZZWORDS = ["hard-working", "hardworking", "team player", "go-getter", "synergy",
  "detail-oriented", "detail oriented", "passionate", "self-motivated", "results-driven",
  "results driven", "think outside the box", "quick learner", "fast learner", "dynamic individual"];

const PRONOUN = /\b(I|[Mm]y|[Mm]e|[Ww]e|[Oo]ur)\b/;
const PLACEHOLDER = /\b(TODO|TBD|XXX?)\b|\?\?|\[\s*[xX?]?\s*\]/;
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|doubled?|tripled?|halved|dozens?|hundreds|thousands|millions)\b/i;
const PASSIVE = /\b(was|were|been|being)\s+\w+(ed|en)\b/i;

/** Coaching for a single achievement line. */
export function bulletTips(text) {
  const t = plainText(text).trim();
  const low = t.toLowerCase();
  const out = [];
  if (PLACEHOLDER.test(t)) out.push({ level: "error", message: "placeholder left in — fill it in or remove it" });
  const opener = WEAK_OPENERS.find((word) => low.startsWith(word));
  if (opener) {
    out.push({ level: "warn", message: `starts with "${t.slice(0, opener.length)}" — lead with what you did: Built, Led, Cut, Shipped…` });
  } else if (low.split(" ")[0]?.endsWith("ing")) {
    out.push({ level: "tip", message: "starts with an -ing word — past tense reads stronger (Built, not Building)" });
  }
  if (PRONOUN.test(t)) out.push({ level: "warn", message: "uses I/my/we — resumes leave out pronouns" });
  if (!NUMBER.test(t)) out.push({ level: "tip", message: "no number — add scale or impact if you can (users, %, ms, ₹/$, team size)" });
  if (t.length > 220) out.push({ level: "warn", message: `long (${t.length} characters, about 3 lines) — split it or keep one idea` });
  else if (t.length < 30) out.push({ level: "tip", message: "very short — what was the result?" });
  if (PASSIVE.test(t)) out.push({ level: "tip", message: "passive voice — say what you did" });
  const buzz = BUZZWORDS.find((word) => low.includes(word));
  if (buzz) out.push({ level: "tip", message: `"${buzz}" is filler — show it with a result instead` });
  if ((text.match(/\*\*/g) || []).length >= 4) out.push({ level: "tip", message: "bold sparingly — one key number per bullet at most" });
  return out;
}

const monthIndex = (value, today) => {
  if (value === "present") return today.getFullYear() * 12 + today.getMonth();
  const [year, month] = dateKey(value);
  return year * 12 + Math.max(month, 1) - 1;
};

/** Total time employed, overlapping roles counted once. */
export function experienceYears(resume, today = new Date()) {
  const spans = resume.experience
    .map((job) => [monthIndex(job.start, today), monthIndex(job.end, today) + 1])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current = null;
  for (const [start, end] of spans) {
    if (current && start <= current[1]) current[1] = Math.max(current[1], end);
    else {
      if (current) total += current[1] - current[0];
      current = [start, end];
    }
  }
  if (current) total += current[1] - current[0];
  return total / 12;
}

const snippet = (text) => {
  const words = plainText(text).split(/\s+/);
  return words.slice(0, 5).join(" ") + (words.length > 5 ? "…" : "");
};

const before = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]);

export function review(resume, pages = null, today = new Date()) {
  const issues = [];
  const add = (level, where, message) => issues.push({ level, where, message });
  const now = [today.getFullYear(), today.getMonth() + 1];
  const bullets = (where, lines) => {
    for (const line of lines) {
      for (const tip of bulletTips(line)) add(tip.level, `${where} · “${snippet(line)}”`, tip.message);
    }
  };

  const b = resume.basics;
  if (!b.email) add("error", "Contact", "no email address");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) add("error", "Contact", `"${b.email}" doesn't look like an email address`);
  if (!b.phone) add("warn", "Contact", "no phone number — most recruiters call first");
  if (!b.links.some((link) => link.url.toLowerCase().includes("linkedin."))) {
    add("tip", "Contact", "add your LinkedIn URL — recruiters look you up there");
  }

  if (resume.summary) {
    const words = plainText(resume.summary).split(/\s+/).length;
    if (words > 75) add("warn", "Summary", `${words} words — keep it to 2–3 lines (under ~60 words)`);
    const buzz = BUZZWORDS.find((word) => resume.summary.toLowerCase().includes(word));
    if (buzz) add("tip", "Summary", `"${buzz}" is filler — name a result instead`);
    if (PLACEHOLDER.test(resume.summary)) add("error", "Summary", "placeholder left in");
  } else if (resume.experience.length) {
    add("tip", "Summary", "a 2–3 line summary helps a recruiter place you in seconds");
  }

  if (!resume.experience.length && !resume.projects.length) {
    add("warn", "Experience", "no experience or projects — add internships, projects or open-source work");
  }
  for (let i = 1; i < resume.experience.length; i += 1) {
    if (before(dateKey(resume.experience[i - 1].start), dateKey(resume.experience[i].start))) {
      add("warn", "Experience", "jobs aren't most-recent-first — reorder them");
      break;
    }
  }

  const everything = [];
  resume.experience.forEach((job, n) => {
    const where = `${job.company} (${job.role})`;
    if (job.end !== "present" && before(dateKey(job.end), dateKey(job.start))) add("error", where, "ends before it starts");
    if (before(now, dateKey(job.start))) add("error", where, "start date is in the future");
    if (job.end !== "present" && before(now, dateKey(job.end))) {
      add("warn", where, "end date is in the future — use present if you still work there");
    }
    if (!job.bullets.length) add("warn", where, "no achievements listed — add 2–5");
    else if (job.bullets.length > 6) add("tip", where, `${job.bullets.length} bullets — your 3–5 strongest read better`);
    else if (n >= 2 && job.bullets.length > 4) add("tip", where, "an older role — 2–3 bullets is plenty");
    bullets(where, job.bullets);
    everything.push(...job.bullets);
  });

  for (const project of resume.projects) {
    bullets(project.name, project.bullets);
    everything.push(...project.bullets);
  }

  if (!resume.education.length) add("tip", "Education", "no education listed");
  for (const entry of resume.education) {
    if (entry.start && entry.end && entry.end !== "present" && before(dateKey(entry.end), dateKey(entry.start))) {
      add("error", entry.school, "ends before it starts");
    }
  }

  if (!resume.skills.length) add("warn", "Skills", "no skills section — ATS filters search it for keywords");
  const seen = new Map();
  for (const group of resume.skills) {
    for (const item of group.items) {
      const key = item.toLowerCase();
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    if (group.items.length > 14) {
      add("tip", "Skills", `${group.category} has ${group.items.length} items — keep the ones you'd happily be interviewed on`);
    }
  }
  const dupes = [...seen].filter(([, count]) => count > 1).map(([item]) => item);
  if (dupes.length) add("tip", "Skills", `listed more than once: ${dupes.join(", ")}`);

  if (everything.length) {
    const verbs = new Map();
    for (const line of everything) {
      const first = plainText(line).trim().split(/\s+/)[0]?.toLowerCase();
      if (first) verbs.set(first, (verbs.get(first) || 0) + 1);
    }
    for (const [verb, count] of [...verbs].sort((a, b) => b[1] - a[1])) {
      if (count >= 3) {
        const shown = verb.charAt(0).toUpperCase() + verb.slice(1);
        add("tip", "Wording", `"${shown}" starts ${count} bullets — vary it (Built, Designed, Led, Cut, Shipped…)`);
      }
    }
    const numbered = everything.filter((line) => NUMBER.test(plainText(line))).length;
    if (everything.length >= 4 && numbered / everything.length < 0.4) {
      add("tip", "Wording", `only ${numbered} of ${everything.length} bullets have a number — numbers are what recruiters skim for`);
    }
    const stops = everything.filter((line) => plainText(line).trimEnd().endsWith(".")).length;
    if (stops > 0 && stops < everything.length) {
      add("tip", "Wording", "some bullets end with a full stop and some don't — pick one style");
    }
  }

  const years = experienceYears(resume, today);
  if (pages && pages > 1 && years < 10) {
    add("warn", "Length", `${pages} pages — with about ${years.toFixed(0)} years of experience one page is expected; trim older roles and weaker bullets first`);
  }

  return issues.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}
