/* Turning what someone said into the shape of a resume.

   The spoken interview has a big advantage over reading a PDF: it already knows what each answer
   is about, so nothing here has to guess which section a sentence belongs to. What it does guess —
   the employer, the job title, the dates — it guesses from wording, and leaves the field empty
   rather than filling it with something wrong. The form is where the person fixes it, and the
   review panel tells them which bullets still need a number or a stronger verb.

   Speech arrives as one long run with little punctuation, so most of the work is deciding where
   one statement ends and the next begins. */

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_YEAR = String.raw`(?:${MONTHS})\.?,?\s*(?:of\s*)?(?:19|20)\d\d`;
const POINT = new RegExp(String.raw`(${MONTH_YEAR}|(?:19|20)\d\d)`, "i");
const RANGE = new RegExp(
  String.raw`(${MONTH_YEAR}|(?:19|20)\d\d)\s*(?:[-–—]|to|until|till|through)\s*(${MONTH_YEAR}|(?:19|20)\d\d|present|now|today)`, "i");
/* "and" only joins two years into a range when "between" introduced them — on its own it joins
   almost anything ("in 2019 and 2020 we shipped…"), so it gets its own pattern rather than a place
   in the list above. */
const BETWEEN = new RegExp(
  String.raw`\bbetween\s+(${MONTH_YEAR}|(?:19|20)\d\d)\s+and\s+(${MONTH_YEAR}|(?:19|20)\d\d)`, "i");
const SINCE = new RegExp(String.raw`\b(?:since|from|started(?:\s+in)?|joined(?:\s+in)?)\s+(${MONTH_YEAR}|(?:19|20)\d\d)`, "i");
const STILL_THERE = /\b(still (?:there|here|work|am)|current(?:ly)?|to date|present|at the moment|right now)\b/i;

/* The seniority word sits a word or two away from the noun — "senior backend engineer" — so the
   title has to reach across what's between them, or it comes out as plain "backend engineer". */
const ROLE = /\b((?:(?:senior|junior|lead|principal|staff|associate|chief|head|sr\.?|jr\.?)\s+)?(?:(?!(?:a|an|the)\s)[\w-]+\s+){0,2}?(?:engineer|developer|manager|designer|analyst|scientist|architect|consultant|administrator|specialist|director|officer|intern|teacher|lecturer|professor|tutor|instructor|accountant|technician|executive|coordinator|supervisor|assistant|nurse|writer|editor|recruiter|researcher|planner|auditor|operator))\b/i;
const EMPLOYER = /\b(?:at|for|with|joined)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/;
const DEGREE = /\b((?:b\.?tech|m\.?tech|b\.?e|m\.?e|b\.?sc|m\.?sc|b\.?com|bca|mca|mba|bachelor(?:'?s)?|master(?:'?s)?|diploma|ph\.?d)[\w\s.,&'-]{0,40})/i;
/* An institution's name runs through its lowercase joining words: "National Institute of
   Technology Tiruchirappalli" is one name, and stopping at "of" keeps only the first two words. */
const SCHOOL = /\b(?:studied at|graduated from|from|at)\s+([A-Z][\w&.'-]*(?:\s+(?:of|and|the|for)|\s+[A-Z][\w&.'-]*){0,6})/;
/* A sentence that places a job rather than describing it. Said aloud, "I work at Finlo Payments as
   a senior engineer since April 2023" is the header of the entry, not an achievement in it. */
const METADATA = /\b(?:i(?:'m|\s+am|\s+work|\s+worked|\s+was)\s+(?:at|for|with)\b|before that|after that|prior to that|earlier i|currently i|i joined)/i;
/* Speech comes out in the first person and a resume bullet doesn't: "I rebuilt the ledger" is the
   same achievement as "Rebuilt the ledger", and only one of them belongs on the page. */
const LEAD_IN = /^(?:i|we)\s+(?:also\s+|then\s+|later\s+|personally\s+|once\s+)?/i;

const titleCase = (text) => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

export const SKIPPED = /^\s*(skip|none|nothing|no|next|pass|n\/a|that'?s it|nope)\b/i;

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const strip = (text) => clean(text).replace(/^(?:and|so|um+|uh+|like|then|also|well)\b[\s,]*/i, "");

/** A spoken date as the resume file writes it: "March 2022" -> "Mar 2022". */
function tidyDate(raw) {
  const text = clean(raw);
  if (!text) return "";
  if (/^(19|20)\d\d$/.test(text)) return text;
  const match = text.match(new RegExp(String.raw`^(${MONTHS})\.?,?\s*(?:of\s*)?((?:19|20)\d\d)$`, "i"));
  if (!match) return text;
  const month = match[1].slice(0, 3);
  return `${month[0].toUpperCase()}${month.slice(1).toLowerCase()} ${match[2]}`;
}

/** Splits a run of speech into statements. Punctuation if the recogniser supplied any, else "and
 *  then" and friends, which is how people actually separate one achievement from the next. */
function statements(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .flatMap((part) => part.split(/\s*(?:,?\s*and then|;|\.\s)\s*/i))
    .map(strip)
    .filter(Boolean);
}

/** The sentences worth keeping as bullets: something happened in them, and they aren't just the
 *  job's own header read aloud. */
/**
 * A sentence naming this employer and putting a year against it is the entry's header, however it
 * was phrased — "I work at Finlo since April 2023", "Taught maths at Kendriya Vidyalaya from
 * 2021-2024". Listing the verbs that introduce one never finishes; naming the employer is the tell.
 */
function placesTheJob(line, company) {
  return Boolean(company) && POINT.test(line) && line.toLowerCase().includes(company.toLowerCase());
}

function bullets(text, used) {
  return statements(text)
    .filter((line) => line.length > 24 && /\s/.test(line))
    .filter((line) => !METADATA.test(line))
    .filter((line) => !placesTheJob(line, used[0]))
    .filter((line) => !used.some((taken) => taken && line.toLowerCase() === taken.toLowerCase()))
    .map((line) => strip(line.replace(LEAD_IN, "")).replace(/\s*[.]$/, ""))
    .filter((line) => line.length > 20)
    .map((line) => line[0].toUpperCase() + line.slice(1))
    .slice(0, 6);
}

function dates(text) {
  const range = text.match(BETWEEN) || text.match(RANGE);
  if (range) {
    return { start: tidyDate(range[1]), end: /present|now|today/i.test(range[2]) ? "present" : tidyDate(range[2]) };
  }
  const since = text.match(SINCE);
  if (since) return { start: tidyDate(since[1]), end: STILL_THERE.test(text) ? "present" : "" };
  const point = text.match(POINT);
  return point ? { start: tidyDate(point[1]), end: STILL_THERE.test(text) ? "present" : "" } : { start: "", end: "" };
}

function job(text) {
  const role = (text.match(ROLE) || [])[1] || "";
  const company = (text.match(EMPLOYER) || [])[1] || "";
  const { start, end } = dates(text);
  return {
    company: clean(company), role: titleCase(clean(role)), location: "", start, end, tech: "",
    bullets: bullets(text, [company, role]),
  };
}

/** Shortens to a limit without cutting a word in half. */
const cut = (text, limit) => (text.length <= limit
  ? text
  : text.slice(0, text.lastIndexOf(" ", limit)).replace(/[\s,]+$/, ""));

function project(text) {
  const [first, ...rest] = statements(text);
  // what it's called stops where the tools start: "a dashboard … using Google Sheets"
  const name = clean((first || "").replace(/^(?:i\s+)?(?:built|made|wrote|created)\s+(?:a|an|the)?\s*/i, ""))
    .split(/[,.]|\s+(?:using|with|in)\s+/i)[0];
  return {
    name: cut(clean(name), 60) || "Project",
    url: "", tech: "", description: cut(clean(rest.join(" ")), 220),
    bullets: bullets(text, [first]).slice(0, 3),
  };
}

/** "Python, Go and some Postgres" -> one group of items. Speech rarely names the categories, so
 *  they all land in one group the person can split up. */
function skills(text) {
  const items = clean(text)
    .replace(/^[\s\S]*?\b(?:with|using|know|use|worked with|comfortable with)\b/i, "")
    .replace(/^\s*(?:mostly|mainly|primarily|chiefly|largely|mostly just|a lot of|lots of)\s+/i, "")
    .split(/\s*(?:,|\band\b|\bplus\b|\/)\s*/i)
    // "a bit of Power BI" is Power BI — the hedge belongs in the interview, not on the page
    .map((item) => strip(item).replace(/^(?:a\s+bit\s+of|a\s+little(?:\s+of)?|bit\s+of|some|basic)\s+/i, ""))
    .map((item) => item.replace(/\s*[.]$/, ""))
    .filter((item) => item && item.length < 30 && /[a-z]/i.test(item));
  return items.length ? [{ category: "Skills", items: [...new Set(items)].join(", ") }] : [];
}

function education(text) {
  const { start, end } = dates(text);
  // The dates come out first, or the degree swallows them: "B.Tech in Computer Science, from 2015".
  const said = clean(text).replace(BETWEEN, " ").replace(RANGE, " ").replace(SINCE, " ");
  const degree = ((said.match(DEGREE) || [])[1] || "")
    // the institution, when it's named after the degree rather than before it
    .replace(/\s+(?:at|from)\s+[A-Z][\s\S]*$/, "")
    .replace(/[\s,.]+$/, "")
    .replace(/[\s,]+(?:from|in|at|since|during|between|of)$/i, "")
    .replace(/[\s,.]+$/, "");
  const school = (clean(text).match(SCHOOL) || [])[1] || "";
  return { school: clean(school), degree: clean(degree), location: "", start, end, score: "" };
}

const NAME = /^([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){1,2})/;

function basics(text) {
  const said = clean(text);
  // Take off whatever leads in — "My name is", "I'm" — and read the capitalised run that follows.
  // Matching the lead-in and the name in one pattern can't work: the lead-in has to ignore case
  // and the name mustn't, and a regex only has the one flag.
  const named = said.replace(/^.*?\b(?:my name(?:'s| is)?|i am|i'?m|this is)\s+/i, "");
  const name = (named.match(NAME) || [])[1] || (said.match(NAME) || [])[1] || "";
  const title = (said.match(ROLE) || [])[1] || "";
  const place = (said.match(/\b(?:based in|living in|from|in)\s+([A-Z][\w'-]+(?:[\s-][A-Z][\w'-]+)?(?:,\s*[A-Z][\w'-]+)?)/) || [])[1] || "";
  return {
    name: clean(name),
    title: titleCase(clean(title)),
    location: clean(place) === clean(name) ? "" : clean(place),
    email: "", phone: "", links: [],
  };
}

/**
 * Builds a resume from the interview's answers: a list of { key, text } in the order they were
 * asked. Anything skipped or empty is left out entirely rather than becoming a blank entry.
 */
export function organise(answers) {
  const said = (key) => answers.filter((a) => a.key === key && a.text && !SKIPPED.test(a.text));
  const first = (key) => (said(key)[0] || {}).text || "";

  const resume = {
    basics: basics(first("basics")),
    summary: "",
    experience: said("job").map((a) => job(a.text)).filter((j) => j.company || j.role || j.bullets.length),
    projects: said("projects").flatMap((a) => (a.text ? [project(a.text)] : [])),
    skills: skills(first("skills")),
    education: said("education").map((a) => education(a.text)).filter((e) => e.school || e.degree),
    certifications: [],
    achievements: [],
    extra: [],
  };
  // The summary is the one thing better left blank than guessed: a spoken introduction reads as
  // speech on the page, and the review panel will ask for it in the person's own words.
  return resume;
}
