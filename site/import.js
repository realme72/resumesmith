/* Reading a resume someone already has.

   A .docx is a zip of XML and a .pdf keeps its text in positioned fragments, so both can be read
   here in the browser — the file never leaves the machine. What comes out is a best guess at the
   structure, which the person then corrects in the form: this is a head start, not an oracle. */

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const MONTH_YEAR = String.raw`(?:${MONTHS})[a-z]*\.?,?\s*'?\d{2,4}`;
const PRESENT = String.raw`present|current|now|ongoing|till\s+date|to\s+date`;

/** A date range, the strongest signal that a line starts a new job or degree. */
const DATE_RANGE = new RegExp(
  String.raw`(${MONTH_YEAR}|(?:19|20)\d\d)\s*(?:[-–—]|to)\s*(${MONTH_YEAR}|(?:19|20)\d\d|${PRESENT})`, "i");
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/;
const URL_LIKE = /\b(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|in|io|dev|org|net|me|co|ai|app|tech)\b\S*/i;
const BULLET = /^\s*[•·▪◦‣⁃*•●-]\s+/;

const HEADINGS = {
  summary: /^(summary|profile|about|objective|professional summary|career objective)$/i,
  skills: /^(skills|technical skills|core skills|skills & tools|technologies|tech stack|competencies)$/i,
  experience: /^(experience|work experience|professional experience|employment|employment history|work history|career history)$/i,
  projects: /^(projects?|personal projects|side projects|selected projects)$/i,
  education: /^(education|academics?|qualifications|academic background)$/i,
  certifications: /^(certifications?|licenses?|courses)$/i,
  achievements: /^(achievements?|awards?|honou?rs|accomplishments|activities)$/i,
};

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/* ---------- reading a .docx ---------- */

/** The smallest zip reader that will do: find one file in the archive and inflate it. */
async function unzipEntry(buffer, wanted) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // walk back from the end for the end-of-central-directory record
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("that file isn't a Word document");

  let offset = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === wanted) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return new TextDecoder().decode(data);       // stored
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();                            // deflated, the usual case
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("that Word file has no document inside it");
}

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Which paragraph styles carry list numbering — a paragraph can be a bullet by style alone. */
async function bulletStyles(buffer) {
  const names = new Set();
  try {
    const xml = await unzipEntry(buffer, "word/styles.xml");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    for (const style of doc.getElementsByTagNameNS(WORD_NS, "style")) {
      if (style.getElementsByTagNameNS(WORD_NS, "numPr").length) {
        names.add(style.getAttributeNS(WORD_NS, "styleId"));
      }
    }
  } catch {
    // no styles part, or an unreadable one: direct formatting alone still works
  }
  names.add("ListParagraph").add("ListBullet");
  return names;
}

/** Lines of text from a .docx, with list paragraphs marked so they read as bullets. */
export async function readDocx(file) {
  const buffer = await file.arrayBuffer();
  const [xml, listStyles] = await Promise.all([
    unzipEntry(buffer, "word/document.xml"), bulletStyles(buffer)]);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const lines = [];

  for (const paragraph of doc.getElementsByTagNameNS(WORD_NS, "p")) {
    // Runs separated by a tab are columns of one row — a company and its location, say. Joining
    // them with a separator keeps "Finlo Payments" and "Bengaluru" from becoming one word.
    const pieces = [];
    for (const node of paragraph.getElementsByTagNameNS(WORD_NS, "*")) {
      if (node.localName === "t") pieces.push(node.textContent);
      else if (node.localName === "tab") pieces.push("\t");
    }
    const text = clean(pieces.join("").replace(/\t+/g, " | "));
    if (!text) continue;

    const styleNode = paragraph.getElementsByTagNameNS(WORD_NS, "pStyle")[0];
    const style = styleNode ? styleNode.getAttributeNS(WORD_NS, "val") : "";
    const listed = paragraph.getElementsByTagNameNS(WORD_NS, "numPr").length > 0
      || listStyles.has(style);
    lines.push(listed && !BULLET.test(text) ? `• ${text}` : text);
  }
  if (!lines.length) throw new Error("that Word file has no text in it");
  return lines;
}

/* ---------- reading a .pdf ---------- */

let pdfjs = null;

async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

/** Lines of text from a PDF: fragments sharing a baseline belong to the same line. */
export async function readPdf(file) {
  const library = await loadPdfjs();
  const pdf = await library.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);           // baseline; same baseline, same line
      const key = [...rows.keys()].find((existing) => Math.abs(existing - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: item.transform[4], width: item.width || 0, text: item.str });
    }
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])                       // top of the page downwards
      .forEach(([, pieces]) => {
        // A wide horizontal gap means these are separate columns — a name and the contact block,
        // or a company and its location. Mark it, or the two run together as one phrase.
        const sorted = pieces.sort((a, b) => a.x - b.x);
        let text = sorted[0].text;
        for (let i = 1; i < sorted.length; i += 1) {
          const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
          text += (gap > 12 ? " | " : " ") + sorted[i].text;
        }
        const line = clean(text).replace(/(?:\s*\|\s*)+/g, " | ").replace(/^\s*\|\s*|\s*\|\s*$/g, "");
        if (line) lines.push(line);
      });
  }
  if (!lines.length) {
    throw new Error("that PDF has no text in it — it may be a scan, which can't be read");
  }
  return rejoinWrapped(lines);  // a PDF wraps long bullets across lines; put them back together
}

/* ---------- turning lines into a resume ---------- */

/**
 * Letter-spaced headings arrive pulled apart, and raggedly: "S U M M A R Y", and real output like
 * "C E R T I F I C AT I O N S". Any short line that becomes a heading once its spaces are removed
 * is a heading — no pattern survives that unevenness, so close the spaces and compare.
 */
const headingFor = (line) => {
  const text = clean(line).replace(/[:•\-–—]+$/, "").trim();
  if (text.length > 40 || BULLET.test(line)) return null;
  const closed = text.replace(/\s+/g, "");
  const match = (candidate) => Object.keys(HEADINGS).find((key) => HEADINGS[key].test(candidate));
  return match(text) || (closed.length <= 24 ? match(closed) : null) || null;
};

const looksLikeName = (line) => {
  const words = clean(line).split(" ");
  return words.length >= 2 && words.length <= 4 && !/\d|@/.test(line)
    && words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word));
};

/** Splits a header line like "Acme Corp | Senior Engineer | Mar 2022 – Present". */
function splitParts(line) {
  const parts = line.split(/\s*[|·•—]\s+|\s{3,}/).map(clean).filter(Boolean);
  // A PDF loses the column gap, so "Finlo Payments Bengaluru" arrives as one run: peel a
  // place name off the end when what remains still reads like a name.
  if (parts.length === 1) {
    const match = parts[0].match(/^(.+?)\s+((?:Remote|Hybrid|[A-Z][\w.'-]+(?:,\s*[A-Z][\w.'-]+)?))$/);
    if (match && match[1].split(" ").length <= 5 && !JOB_WORDS.test(match[2])) {
      return [clean(match[1]), clean(match[2])];
    }
  }
  return parts;
}

/**
 * A PDF has no idea what a bullet is: the marker glyph never survives extraction and a long
 * bullet arrives split across lines. Rejoin a line onto the one above when that one was left
 * hanging — no closing punctuation, and this line doesn't start something new.
 */
function rejoinWrapped(lines) {
  // A wrapped tail is short and follows a line that ran to the page edge ("…payouts from T+2 to
  // under" / "15 minutes for 2M+ merchants"). Punctuation is no guide: bullets rarely end in a
  // full stop, and keying on that glues every bullet to the one above it.
  const titleish = /^[A-Z][\w.'&-]*(?: [A-Z][\w.'&-]*){0,2}$/;  // "ShipKart Pune" starts something
  const out = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    // A line holding a column separator is a row of its own ("ShipKart | Pune"), never a tail.
    const continues = previous && previous.length > 60 && !titleish.test(line) && !line.includes("|")
      && (line.length < 20 || (line.length < 40 && /^[a-z\d(]/.test(line)))
      && !headingFor(line) && !DATE_RANGE.test(line) && !BULLET.test(line)
      && !/^[^:：]{2,40}[:：]\s+\S/.test(line);
    if (continues) out[out.length - 1] = `${previous} ${line}`;
    else out.push(line);
  }
  return out;
}

function stripDates(text) {
  const match = text.match(DATE_RANGE);
  if (!match) return { text: clean(text), start: "", end: "" };
  return {
    text: clean(text.replace(match[0], "").replace(/[,|·—-]\s*$/, "")),
    start: match[1],
    end: /present|current|now|ongoing|till|to date/i.test(match[2]) ? "" : match[2],
  };
}

/* A place is a short phrase with no job words in it: "Bengaluru", "Pune, India", "Remote". */
const PLACE = /^(remote|hybrid|[A-Z][\w.'-]+(?:[ -][A-Z][\w.'-]+){0,2}(?:,\s*[A-Z][\w.'-]+(?:\s[A-Z][\w.'-]+)?)?)$/;
const JOB_WORDS = /\b(engineer|developer|manager|designer|analyst|scientist|architect|consultant|intern|lead|head|director|officer|specialist|administrator|associate|president|founder|sde|swe)\b/i;

/** Sorts the pieces of a header row by what they look like, not by where they sit. */
function placeParts(parts, entry) {
  for (const part of parts) {
    if (!part) continue;
    if (!entry.role && JOB_WORDS.test(part)) entry.role = part;
    else if (!entry.location && PLACE.test(part) && !JOB_WORDS.test(part) && entry.company) entry.location = part;
    else if (!entry.company) entry.company = part;
    else if (!entry.role) entry.role = part;
    else if (!entry.location) entry.location = part;
  }
}

const newEntry = () => ({ company: "", role: "", location: "", start: "", end: "", bullets: [], tech: "" });

function parseExperience(lines) {
  const jobs = [];
  let current = null;
  for (const line of lines) {
    if (BULLET.test(line)) {
      if (current) current.bullets.push(clean(line.replace(BULLET, "")));
      continue;
    }
    if (/^tech(nologies)?\s*[:：]/i.test(line)) {
      if (current) current.tech = clean(line.replace(/^tech(nologies)?\s*[:：]/i, ""));
      continue;
    }
    if (DATE_RANGE.test(line)) {
      const { text, start, end } = stripDates(line);
      const parts = splitParts(text);
      // A dated row with only a job title in it is a promotion: another role, same employer.
      const promotion = current && current.company && parts.length <= 1
        && (!parts[0] || JOB_WORDS.test(parts[0]));
      if (promotion && current.start) {
        current = { ...newEntry(), company: current.company, location: current.location,
                    role: parts[0] || "", start, end };
        jobs.push(current);
        continue;
      }
      if (current && !current.start && (current.company || current.role)) {
        current.start = start;                        // dates on the line under the company
        current.end = end;
        placeParts(parts, current);
        continue;
      }
      current = { ...newEntry(), start, end };
      placeParts(parts, current);
      jobs.push(current);
      continue;
    }
    if (current && !current.role && !current.bullets.length && JOB_WORDS.test(line)) {
      current.role = clean(line);                     // the line under a company is usually the title
      continue;
    }
    // Inside a job, a sentence with no marker is a bullet whose glyph the PDF didn't keep.
    if (current && (current.start || current.bullets.length) && /\s/.test(line)
        && (line.length > 45 || /[.%\d]/.test(line))) {
      current.bullets.push(clean(line));
      continue;
    }
    current = newEntry();
    placeParts(splitParts(line), current);
    jobs.push(current);
  }
  return jobs.filter((job) => job.company || job.role);
}

function parseSkills(lines) {
  const groups = [];
  for (const line of lines) {
    const text = clean(line.replace(BULLET, ""));
    const [, category, items] = text.match(/^([^:：]{2,40})\s*[:：]\s*(.+)$/) || [];
    if (items) groups.push({ category: clean(category), items: clean(items) });
    else if (text) groups.push({ category: "Skills", items: text });
  }
  return groups;
}

function parseEducation(lines) {
  const entries = [];
  for (const line of lines) {
    const { text, start, end } = stripDates(line);
    const parts = splitParts(text);
    const last = entries[entries.length - 1];
    if (last && !last.degree && (start || /b\.?tech|b\.?e\b|m\.?tech|bachelor|master|diploma|b\.?sc|m\.?sc|mba|phd/i.test(text))) {
      last.degree = parts[0] || text;
      last.start = last.start || start;
      last.end = last.end || end;
      continue;
    }
    entries.push({ school: parts[0] || text, degree: parts[1] || "", location: parts[2] || "",
                   start, end, score: (text.match(/(cgpa|gpa|\d+(?:\.\d+)?\s*%)[^,|]*/i) || [""])[0] });
  }
  return entries.filter((entry) => entry.school);
}

function parseProjects(lines) {
  const projects = [];
  for (const line of lines) {
    if (BULLET.test(line) && projects.length) {
      projects[projects.length - 1].bullets.push(clean(line.replace(BULLET, "")));
      continue;
    }
    const { text } = stripDates(line);
    const parts = splitParts(text);
    const url = (text.match(URL_LIKE) || [""])[0];
    projects.push({ name: clean((parts[0] || text).replace(URL_LIKE, "")) || "Project",
                    url, tech: parts[1] && !URL_LIKE.test(parts[1]) ? parts[1] : "",
                    description: "", bullets: [] });
  }
  return projects;
}

/**
 * A best guess at the resume behind those lines.
 * Anything it can't place with confidence is left out rather than invented — the form is where
 * the person fixes it, and a wrong entry is more annoying than a missing one.
 */
export function linesToResume(lines) {
  const sections = { header: [] };
  let currentKey = "header";
  for (const line of lines) {
    const heading = headingFor(line);
    if (heading) {
      currentKey = heading;
      sections[currentKey] = sections[currentKey] || [];
    } else {
      (sections[currentKey] = sections[currentKey] || []).push(line);
    }
  }

  const header = sections.header || [];
  const joined = header.join(" | ");
  const email = (joined.match(EMAIL) || [""])[0];
  // strip the address first, or its own domain reads as a link
  const withoutEmail = joined.replace(new RegExp(EMAIL.source, "gi"), " ");
  const links = [...new Set((withoutEmail.match(new RegExp(URL_LIKE, "gi")) || [])
    .map((url) => url.replace(/[.,;|]+$/, "").trim())
    .filter(Boolean))];

  // A header laid out in columns arrives as one line ("Aarav Mehta | Bengaluru · +91 … · a@b.com"),
  // so look at the pieces of each line rather than the line itself.
  const fragments = header.flatMap((line) => line.split(/\s*[·•|]\s*/).map(clean).filter(Boolean));
  const plain = (text) => !EMAIL.test(text) && !URL_LIKE.test(text) && !/\d{4,}/.test(text);

  const basics = {
    name: fragments.find(looksLikeName) || "",
    title: "",
    email,
    // a phone number sits between separators on the contact line, often with a country code
    phone: clean((withoutEmail.match(/(?:\+\d{1,3}[\s-]?)?(?:\d[\d\s-]{7,13}\d)/) || [""])[0]),
    location: "",
    links: links.map((url) => ({ url, label: "" })),
  };
  // The headline sits on the line below the name. Looking at the next *fragment* instead would
  // pick up whatever shares the name's line — in a two-column header, that's the city.
  const nameLine = header.findIndex((line) => line.split(/\s*[·•|]\s*/).map(clean).includes(basics.name));
  const below = nameLine >= 0 ? (header[nameLine + 1] || "") : "";
  // A city and a headline have the same shape — "Bengaluru, India" and "Senior Backend Engineer"
  // are both short runs of capitalised words — so a job word is what tells them apart, as it does
  // in placeParts. A headline carrying none of those is left blank rather than guessed at.
  basics.title = clean((below.split(/\s*[·•|]\s*/).map(clean)
    .find((piece) => plain(piece) && piece.length < 60 && /[a-z]/.test(piece)
      && !(PLACE.test(piece) && !JOB_WORDS.test(piece)) && piece !== basics.name)) || "");

  return {
    basics,
    summary: (sections.summary || []).map((l) => clean(l.replace(BULLET, ""))).join(" "),
    skills: parseSkills(sections.skills || []),
    experience: parseExperience(sections.experience || []),
    projects: parseProjects(sections.projects || []),
    education: parseEducation(sections.education || []),
    certifications: (sections.certifications || [])
      .map((l) => ({ name: clean(l.replace(BULLET, "")), issuer: "", date: "", url: "" })),
    achievements: (sections.achievements || []).map((l) => clean(l.replace(BULLET, ""))),
    extra: [],
  };
}

/** Read a file the person picked, whatever kind it is. */
export async function readResume(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return linesToResume(await readDocx(file));
  if (name.endsWith(".pdf")) return linesToResume(await readPdf(file));
  if (name.endsWith(".doc")) {
    throw new Error("old .doc files can't be read — open it in Word and save as .docx");
  }
  throw new Error("pick a .pdf or .docx file");
}
