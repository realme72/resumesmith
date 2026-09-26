/* Turning what someone said into the shape of a resume.

   The interview asks for a name, a company, a date and an address in boxes of their own, so none
   of that has to be guessed at here. What's left is the free-form part — what you did in a job,
   the tools you know — where sentences are the point and the only real question is where one
   statement ends and the next begins. Speech arrives as a long run with little punctuation, so
   that question is most of the work. */

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_YEAR = String.raw`(?:${MONTHS})\.?,?\s*(?:of\s*)?(?:19|20)\d\d`;
const POINT = new RegExp(String.raw`(${MONTH_YEAR}|(?:19|20)\d\d)`, "i");

/* A sentence that places a job rather than describing one. Said aloud, "I work at Finlo Payments
   as a senior engineer since April 2023" is the header of the entry, not an achievement in it. */
const METADATA = /\b(?:i(?:'m|\s+am|\s+work|\s+worked|\s+was)\s+(?:at|for|with)\b|before that|after that|prior to that|earlier i|currently i|i joined)/i;
/* Speech comes out in the first person and a resume bullet doesn't: "I rebuilt the ledger" is the
   same achievement as "Rebuilt the ledger", and only one of them belongs on the page. */
const LEAD_IN = /^(?:i|we)\s+(?:also\s+|then\s+|later\s+|personally\s+|once\s+)?/i;

export const SKIPPED = /^\s*(skip|none|nothing|no|next|pass|n\/a|that'?s it|nope)\b/i;

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const strip = (text) => clean(text).replace(/^(?:and|so|um+|uh+|like|then|also|well)\b[\s,]*/i, "");

/** A spoken date as the resume file writes it: "March 2022" -> "Mar 2022". */
export function tidyDate(raw) {
  const text = clean(raw);
  if (!text) return "";
  if (/^(19|20)\d\d$/.test(text)) return text;
  const match = text.match(new RegExp(String.raw`^(${MONTHS})\.?,?\s*(?:of\s*)?((?:19|20)\d\d)$`, "i"));
  if (!match) return text;  // anything else goes through as said; the form reads most of it
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

/**
 * A sentence naming this employer and putting a year against it is the entry's header, however it
 * was phrased — "I work at Finlo since April 2023", "Taught maths at Kendriya Vidyalaya from
 * 2021-2024". Listing the verbs that introduce one never finishes; naming the employer is the tell.
 */
function placesTheJob(line, company) {
  return Boolean(company) && POINT.test(line) && line.toLowerCase().includes(company.toLowerCase());
}

/** The sentences worth keeping as bullets from what someone said about one job or project. */
export function spokenBullets(text, company = "") {
  if (!text || SKIPPED.test(text)) return [];
  return statements(text)
    .filter((line) => line.length > 24 && /\s/.test(line))
    .filter((line) => !METADATA.test(line))
    .filter((line) => !placesTheJob(line, clean(company)))
    .map((line) => strip(line.replace(LEAD_IN, "")).replace(/\s*[.]$/, ""))
    .filter((line) => line.length > 20)
    .map((line) => line[0].toUpperCase() + line.slice(1))
    .slice(0, 6);
}

/** "Python, Go and a bit of Postgres" -> one group of items, which the form lets you split up. */
export function spokenSkills(text) {
  if (!text || SKIPPED.test(text)) return [];
  const items = clean(text)
    .replace(/^[\s\S]*?\b(?:with|using|know|use|worked with|comfortable with)\b/i, "")
    .replace(/^\s*(?:mostly|mainly|primarily|chiefly|largely|a lot of|lots of)\s+/i, "")
    .split(/\s*(?:,|\band\b|\bplus\b|\/)\s*/i)
    // "a bit of Power BI" is Power BI — the hedge belongs in the interview, not on the page
    .map((item) => strip(item).replace(/^(?:a\s+bit\s+of|a\s+little(?:\s+of)?|bit\s+of|some|basic)\s+/i, ""))
    .map((item) => item.replace(/\s*[.]$/, ""))
    .filter((item) => item && item.length < 30 && /[a-z]/i.test(item));
  return items.length ? [{ category: "Skills", items: [...new Set(items)].join(", ") }] : [];
}
