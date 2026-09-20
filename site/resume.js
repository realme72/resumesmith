/* The resume renderer, in the browser.
   A port of the Python renderer (text.py, model.py and the Jinja template) so both produce the
   same HTML from the same data — the Python command line and this page can't drift apart. */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PRESENT_WORDS = ["present", "current", "now", "ongoing", "till date", "today"];
const SECTION_TITLES = {
  summary: "Summary", skills: "Skills", experience: "Experience", projects: "Projects",
  education: "Education", certifications: "Certifications", achievements: "Achievements",
};
const PAGE_SIZES = { A4: { w: "210mm", h: "297mm" }, Letter: { w: "8.5in", h: "11in" } };

/* ---------- dates ---------- */

/** 'Mar 2022', '2022-03', '03/2022', 2022, 'present' -> '2022-03', '2022' or 'present'. */
export function normalizeDate(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (PRESENT_WORDS.includes(text.toLowerCase())) return "present";
  if (/^(19|20)\d\d$/.test(text)) return text;

  let year = null;
  let month = null;
  let m;
  if ((m = text.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})$/))) {
    [year, month] = [Number(m[1]), Number(m[2])];
  } else if ((m = text.match(/^(\d{1,2})\s*[-/.]\s*(\d{4})$/))) {
    [month, year] = [Number(m[1]), Number(m[2])];
  } else if ((m = text.match(/^([A-Za-z]{3,9})\.?,?\s*['’]?(\d{4}|\d{2})$/))) {
    const index = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (index >= 0) {
      month = index + 1;
      year = Number(m[2]);
      if (year < 100) year += 2000;
    }
  }
  if (year && month && month >= 1 && month <= 12 && year >= 1950 && year <= 2100) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  throw new Error(`can't read the date "${value}" — write it like Mar 2022, 2022-03, 2022 or present`);
}

export function fmtDate(value) {
  if (!value) return "";
  if (value === "present") return "Present";
  if (value.includes("-")) {
    const [year, month] = value.split("-");
    return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
  }
  return value;
}

export function dateRange(start, end) {
  const a = fmtDate(start);
  const b = fmtDate(end);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a || b;
}

export function dateKey(value) {
  if (!value) return [0, 0];
  if (value === "present") return [9999, 12];
  const [year, month] = value.split("-");
  return [Number(year), Number(month || 0)];
}

/* ---------- links and inline markup ---------- */

export const fullUrl = (url) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
export const bareUrl = (url) => String(url).replace(/^(https?:\/\/)?(www\.)?/i, "").replace(/\/+$/, "");

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits text into plain, bold and link pieces — the same markup the Python renderer accepts. */
export function segments(text) {
  const out = [];
  let position = 0;
  for (const match of String(text).matchAll(INLINE)) {
    if (match.index > position) out.push({ text: text.slice(position, match.index) });
    if (match[1] !== undefined) out.push({ text: match[1], bold: true });
    else out.push({ text: match[2], href: fullUrl(match[3]) });
    position = match.index + match[0].length;
  }
  if (position < text.length) out.push({ text: text.slice(position) });
  return out;
}

export function toHtml(text) {
  return segments(text).map((seg) => {
    let piece = escapeHtml(seg.text);
    if (seg.bold) piece = `<strong>${piece}</strong>`;
    if (seg.href) piece = `<a href="${escapeHtml(seg.href)}">${piece}</a>`;
    return piece;
  }).join("");
}

export function plainText(text) {
  return segments(text).map((seg) =>
    (seg.href && bareUrl(seg.href) !== seg.text ? `${seg.text} (${bareUrl(seg.href)})` : seg.text)).join("");
}

/* ---------- shaping the data ---------- */

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const asItems = (value) => (Array.isArray(value)
  ? value.map((v) => String(v).trim()).filter(Boolean)
  : String(value || "").split(",").map((v) => v.trim()).filter(Boolean));
const clean = (value) => String(value ?? "").trim();
const filled = (list) => asList(list).map(clean).filter(Boolean);

/** Skills arrive either as a list of groups or as {Languages: "Python, Go"} — accept both. */
const asGroups = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.entries(value).map(([category, items]) => ({ category, items }));
  }
  return [];
};

/** What an entry needs before it can be drawn; anything less is still being typed. */
const NEEDED = {
  experience: ["company", "role", "start"], projects: ["name"], education: ["school", "degree"],
  certifications: ["name"], skills: ["category", "items"], extra: ["title", "items"],
};
const FIELD_NAMES = {
  company: "company", role: "job title", start: "start date", name: "name", school: "school",
  degree: "degree", category: "group name", items: "items", title: "title",
};

const ALL_SECTIONS = [...Object.keys(SECTION_TITLES), "extra"];

/** The order sections print in; data that names none gets all of them, like the resume file format. */
const sectionOrder = (order) => {
  const listed = asList(order).filter((key) => ALL_SECTIONS.includes(key));
  return listed.length ? listed : ALL_SECTIONS;
};

/**
 * Turns what the form holds into a resume ready to render.
 * Returns the resume, a note for each entry still being filled in, and any unreadable dates.
 */
export function prepare(state) {
  const hidden = [];
  const problems = [];
  const date = (value, where) => {
    try {
      return normalizeDate(value);
    } catch (e) {
      problems.push({ where, message: e.message });
      return "";
    }
  };
  const keep = (section, item, position) => {
    const missing = NEEDED[section].filter((field) => {
      const value = item[field];
      return Array.isArray(value) ? !value.length : !clean(value);
    });
    if (!missing.length) return true;
    if (missing.length < NEEDED[section].length) {
      const label = NEEDED[section].map((f) => clean(item[f])).find(Boolean) || `Entry ${position}`;
      hidden.push({ label, missing: missing.map((f) => FIELD_NAMES[f] || f) });
    }
    return false;
  };

  const basics = state.basics || {};
  const resume = {
    basics: {
      name: clean(basics.name),
      title: clean(basics.title),
      email: clean(basics.email),
      phone: clean(basics.phone),
      location: clean(basics.location),
      links: asList(basics.links)
        .map((link) => (typeof link === "string"
          ? { url: clean(link), label: "" }
          : { url: clean(link.url), label: clean(link.label) }))
        .filter((link) => link.url),
    },
    summary: clean(state.summary),
    skills: asGroups(state.skills)
      .map((group) => ({ category: clean(group.category), items: asItems(group.items) }))
      .filter((group, i) => keep("skills", group, i + 1)),
    experience: asList(state.experience)
      .map((job, i) => ({
        company: clean(job.company),
        role: clean(job.role),
        location: clean(job.location),
        url: clean(job.url),
        start: date(job.start, `Experience #${i + 1}`),
        end: date(job.end, `Experience #${i + 1}`) || "present",
        summary: clean(job.summary),
        bullets: filled(job.bullets),
        tech: asItems(job.tech),
      }))
      .filter((job, i) => keep("experience", job, i + 1)),
    projects: asList(state.projects)
      .map((project, i) => ({
        name: clean(project.name),
        url: clean(project.url),
        tech: asItems(project.tech),
        start: date(project.start, `Projects #${i + 1}`),
        end: date(project.end, `Projects #${i + 1}`),
        description: clean(project.description),
        bullets: filled(project.bullets),
      }))
      .filter((project, i) => keep("projects", project, i + 1)),
    education: asList(state.education)
      .map((entry, i) => ({
        school: clean(entry.school),
        degree: clean(entry.degree),
        location: clean(entry.location),
        start: date(entry.start, `Education #${i + 1}`),
        end: date(entry.end, `Education #${i + 1}`),
        score: clean(entry.score),
        bullets: filled(entry.bullets),
      }))
      .filter((entry, i) => keep("education", entry, i + 1)),
    certifications: asList(state.certifications)
      .map((cert, i) => ({
        name: clean(cert.name),
        issuer: clean(cert.issuer),
        date: date(cert.date, `Certifications #${i + 1}`),
        url: clean(cert.url),
      }))
      .filter((cert, i) => keep("certifications", cert, i + 1)),
    achievements: filled(state.achievements),
    extra: asList(state.extra)
      .map((section) => ({ title: clean(section.title), items: filled(section.items) }))
      .filter((section, i) => keep("extra", section, i + 1)),
    settings: {
      theme: state.settings?.theme || "classic",
      accent: state.settings?.accent || "#1f4e79",
      page: state.settings?.page === "Letter" ? "Letter" : "A4",
      one_page: state.settings?.one_page !== false,
      margin_mm: Number(state.settings?.margin_mm) || 13,
      sections: sectionOrder(state.settings?.sections),
    },
  };
  return { resume, hidden, problems };
}

/* ---------- structure ---------- */

export function contactItems(resume) {
  const b = resume.basics;
  const items = [];
  if (b.location) items.push([b.location, null]);
  if (b.phone) items.push([b.phone, `tel:${b.phone.replace(/[^\d+]/g, "")}`]);
  if (b.email) items.push([b.email, `mailto:${b.email}`]);
  for (const link of b.links) items.push([link.label || bareUrl(link.url), fullUrl(link.url)]);
  return items;
}

/** Links move to their own line when the contact details are long, so no URL is ever split. */
export function contactLines(resume, maxChars = 70) {
  const items = contactItems(resume);
  if (!items.length) return [];
  if (items.reduce((total, [text]) => total + text.length + 3, 0) <= maxChars) return [items];
  const linkCount = resume.basics.links.length;
  return [items.slice(0, items.length - linkCount), items.slice(items.length - linkCount)]
    .filter((line) => line.length);
}

/** Consecutive roles at one company (a promotion) print under a single company line. */
export function groupJobs(jobs) {
  const groups = [];
  for (const job of jobs) {
    const last = groups[groups.length - 1];
    if (last && last.company.toLowerCase() === job.company.toLowerCase()) {
      last.jobs.push(job);
      last.location = last.location || job.location;
    } else {
      groups.push({ company: job.company, location: job.location, url: job.url, jobs: [job] });
    }
  }
  return groups;
}

export function visibleSections(resume) {
  const out = [];
  for (const key of resume.settings.sections) {
    if (key === "extra") {
      resume.extra.forEach((section, i) => {
        if (section.items.length) out.push([`extra:${i}`, section.title]);
      });
    } else if (resume[key] && (Array.isArray(resume[key]) ? resume[key].length : true)) {
      out.push([key, SECTION_TITLES[key]]);
    }
  }
  return out;
}

/* ---------- the page itself ---------- */

const tag = (name, cls, inner) => `<${name}${cls ? ` class="${cls}"` : ""}>${inner}</${name}>`;
const linked = (text, url) => (url ? `<a href="${escapeHtml(fullUrl(url))}">${escapeHtml(text)}</a>` : escapeHtml(text));

function contactBlock(resume) {
  const lines = contactLines(resume);
  if (!lines.length) return "";
  const rendered = lines.map((line) => tag("p", "contact-line", line.map(([text, href], i) =>
    `${i ? '<span class="sep"> · </span>' : ""}<span class="ci">${href
      ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text)}</span>`).join(""))).join("\n");
  return tag("div", "contact", rendered);
}

function entryRow(left, right) {
  return tag("div", "row", left + (right ? tag("span", "date", escapeHtml(right)) : ""));
}

function bulletsBlock(bullets) {
  if (!bullets.length) return "";
  return tag("ul", "bullets", bullets.map((b) => tag("li", "", toHtml(b))).join("\n"));
}

function sectionBody(resume, key) {
  if (key === "summary") return tag("p", "summary", toHtml(resume.summary));

  if (key === "skills") {
    return tag("div", "skills", resume.skills.map((group) =>
      tag("p", "skill", `${tag("span", "skill-cat", `${escapeHtml(group.category)}:`)} ${escapeHtml(group.items.join(", "))}`)).join("\n"));
  }

  if (key === "experience") {
    return groupJobs(resume.experience).map((group) => {
      const company = tag("div", "row",
        tag("span", "org", linked(group.company, group.url))
        + (group.location ? tag("span", "loc", escapeHtml(group.location)) : ""));
      const roles = group.jobs.map((job) => tag("div", "role-block",
        entryRow(tag("span", "role", escapeHtml(job.role)), dateRange(job.start, job.end))
        + (job.summary ? tag("p", "blurb", toHtml(job.summary)) : "")
        + bulletsBlock(job.bullets)
        + (job.tech.length
          ? tag("p", "tech", `${tag("span", "tech-label", "Tech:")} ${escapeHtml(job.tech.join(", "))}`)
          : ""))).join("\n");
      return tag("div", "entry", company + roles);
    }).join("\n");
  }

  if (key === "projects") {
    return resume.projects.map((project) => {
      const name = tag("span", "org", linked(project.name, project.url));
      // the address is spelled out, so it survives being printed and reads as something to visit
      const site = project.url
        ? `<span class="sep"> · </span>${tag("span", "site", linked(bareUrl(project.url), project.url))}` : "";
      const stack = project.tech.length
        ? `<span class="sep"> | </span>${tag("span", "stack", escapeHtml(project.tech.join(", ")))}` : "";
      const dates = project.start || project.end ? dateRange(project.start, project.end) : "";
      return tag("div", "entry",
        entryRow(`<span>${name}${site}${stack}</span>`, dates)
        + (project.description ? tag("p", "blurb", toHtml(project.description)) : "")
        + bulletsBlock(project.bullets));
    }).join("\n");
  }

  if (key === "education") {
    return resume.education.map((entry) => {
      const score = entry.score
        ? `<span class="sep"> — </span>${tag("span", "score", escapeHtml(entry.score))}` : "";
      const dates = entry.start || entry.end ? dateRange(entry.start, entry.end) : "";
      return tag("div", "entry",
        tag("div", "row", tag("span", "org", escapeHtml(entry.school))
          + (entry.location ? tag("span", "loc", escapeHtml(entry.location)) : ""))
        + entryRow(tag("span", "role", escapeHtml(entry.degree) + score), dates)
        + bulletsBlock(entry.bullets));
    }).join("\n");
  }

  if (key === "certifications") {
    return tag("ul", "bullets list", resume.certifications.map((cert) => {
      const issuer = cert.issuer ? `<span class="sep"> — </span>${escapeHtml(cert.issuer)}` : "";
      const when = cert.date ? tag("span", "date", escapeHtml(dateRange(cert.date, ""))) : "";
      return tag("li", "", tag("div", "row",
        `<span>${tag("span", "cert", linked(cert.name, cert.url))}${issuer}</span>${when}`));
    }).join("\n"));
  }

  if (key === "achievements") {
    return tag("ul", "bullets list", resume.achievements.map((item) => tag("li", "", toHtml(item))).join("\n"));
  }

  const extra = resume.extra[Number(key.split(":")[1])];
  return tag("ul", "bullets list", extra.items.map((item) => tag("li", "", toHtml(item))).join("\n"));
}

/**
 * The resume as a standalone HTML page — the same markup the Python renderer produces.
 * `css` is the theme stylesheet (base + theme), `bare` drops the grey desk around the sheet.
 */
export function renderHtml(resume, { css = "", scale = 1, margin = null, bare = false } = {}) {
  const settings = resume.settings;
  const page = PAGE_SIZES[settings.page] || PAGE_SIZES.A4;
  const marginMm = margin === null ? settings.margin_mm : margin;
  const sections = visibleSections(resume).map(([key, title]) =>
    tag("section", `section section-${key.split(":")[0]}`,
      tag("h2", "section-title", escapeHtml(title)) + "\n" + sectionBody(resume, key))).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(resume.basics.name)} – Resume</title>
<meta name="author" content="${escapeHtml(resume.basics.name)}">
<style>
:root { --s: ${scale}; --accent: ${escapeHtml(settings.accent)}; --page-w: ${page.w}; --page-h: ${page.h}; --margin: ${marginMm}mm; }
@page { size: ${settings.page}; margin: ${marginMm}mm; }
${css}
</style>
</head>
<body class="theme-${escapeHtml(settings.theme)}${bare ? " bare" : ""}">
<main class="sheet">
  <header class="head">
    <div class="id">
      <h1 class="name">${escapeHtml(resume.basics.name)}</h1>
      ${resume.basics.title ? tag("p", "headline", escapeHtml(resume.basics.title)) : ""}
    </div>
    ${contactBlock(resume)}
  </header>
${sections}
</main>
</body>
</html>
`;
}

/* ---------- the plain-text shapes ---------- */

export function renderMarkdown(resume) {
  const b = resume.basics;
  const out = [`# ${b.name}`];
  if (b.title) out.push(`**${b.title}**`);
  const items = contactItems(resume);
  if (items.length) out.push(items.map(([text, href]) => (href ? `[${text}](${href})` : text)).join(" · "));

  for (const [key, title] of visibleSections(resume)) {
    out.push(`## ${title}`);
    if (key === "summary") out.push(resume.summary);
    else if (key === "skills") out.push(resume.skills.map((g) => `- **${g.category}:** ${g.items.join(", ")}`).join("\n"));
    else if (key === "experience") {
      for (const group of groupJobs(resume.experience)) {
        out.push(`### ${group.url ? `[${group.company}](${group.url})` : group.company}${group.location ? ` · ${group.location}` : ""}`);
        for (const job of group.jobs) {
          const block = [`**${job.role}** · ${dateRange(job.start, job.end)}`];
          if (job.summary) block.push(`*${job.summary}*`);
          block.push(...job.bullets.map((x) => `- ${x}`));
          if (job.tech.length) block.push(`\n*Tech:* ${job.tech.join(", ")}`);
          out.push(block.join("\n"));
        }
      }
    } else if (key === "projects") {
      for (const p of resume.projects) {
        const meta = [];
        if (p.tech.length) meta.push(p.tech.join(", "));
        if (p.start || p.end) meta.push(dateRange(p.start, p.end));
        const block = [`### ${p.url ? `[${p.name}](${p.url})` : p.name}`];
        if (meta.length) block.push(`*${meta.join(" · ")}*`);
        if (p.description) block.push(p.description);
        block.push(...p.bullets.map((x) => `- ${x}`));
        out.push(block.join("\n"));
      }
    } else if (key === "education") {
      for (const e of resume.education) {
        const block = [`### ${e.school}${e.location ? ` · ${e.location}` : ""}`];
        let line = `**${e.degree}**${e.score ? ` — ${e.score}` : ""}`;
        if (e.start || e.end) line += ` · ${dateRange(e.start, e.end)}`;
        block.push(line);
        block.push(...e.bullets.map((x) => `- ${x}`));
        out.push(block.join("\n"));
      }
    } else if (key === "certifications") {
      out.push(resume.certifications.map((c) =>
        `- ${c.url ? `[${c.name}](${c.url})` : c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${dateRange(c.date, "")})` : ""}`).join("\n"));
    } else {
      const list = key === "achievements" ? resume.achievements : resume.extra[Number(key.split(":")[1])].items;
      out.push(list.map((x) => `- ${x}`).join("\n"));
    }
  }
  return `${out.join("\n\n")}\n`;
}

export function renderText(resume) {
  const b = resume.basics;
  const out = [b.name.toUpperCase()];
  if (b.title) out.push(b.title);
  const items = contactItems(resume);
  if (items.length) {
    out.push(items.map(([text, href]) =>
      (!href || href.startsWith("mailto:") || href.startsWith("tel:") ? text : plainText(`[${text}](${href})`))).join(" | "));
  }

  for (const [key, title] of visibleSections(resume)) {
    out.push("", title.toUpperCase(), "-".repeat(title.length));
    if (key === "summary") out.push(plainText(resume.summary));
    else if (key === "skills") out.push(...resume.skills.map((g) => `${g.category}: ${g.items.join(", ")}`));
    else if (key === "experience") {
      groupJobs(resume.experience).forEach((group, i) => {
        if (i) out.push("");
        out.push(group.company + (group.location ? `, ${group.location}` : ""));
        for (const job of group.jobs) {
          out.push(`${job.role} | ${dateRange(job.start, job.end)}`);
          if (job.summary) out.push(plainText(job.summary));
          out.push(...job.bullets.map((x) => `- ${plainText(x)}`));
          if (job.tech.length) out.push(`Tech: ${job.tech.join(", ")}`);
        }
      });
    } else if (key === "projects") {
      resume.projects.forEach((p, i) => {
        if (i) out.push("");
        let line = p.name + (p.url ? ` (${p.url})` : "");
        if (p.tech.length) line += ` | ${p.tech.join(", ")}`;
        if (p.start || p.end) line += ` | ${dateRange(p.start, p.end)}`;
        out.push(line);
        if (p.description) out.push(plainText(p.description));
        out.push(...p.bullets.map((x) => `- ${plainText(x)}`));
      });
    } else if (key === "education") {
      for (const e of resume.education) {
        out.push(e.school + (e.location ? `, ${e.location}` : ""));
        let line = e.degree + (e.score ? ` - ${e.score}` : "");
        if (e.start || e.end) line += ` | ${dateRange(e.start, e.end)}`;
        out.push(line);
        out.push(...e.bullets.map((x) => `- ${plainText(x)}`));
      }
    } else if (key === "certifications") {
      out.push(...resume.certifications.map((c) =>
        `- ${c.name}${c.issuer ? `, ${c.issuer}` : ""}${c.date ? ` (${dateRange(c.date, "")})` : ""}`));
    } else {
      const list = key === "achievements" ? resume.achievements : resume.extra[Number(key.split(":")[1])].items;
      out.push(...list.map((x) => `- ${plainText(x)}`));
    }
  }
  return `${out.join("\n")}\n`;
}

/* ---------- theme stylesheets ---------- */

const cssCache = new Map();

export async function themeCss(theme) {
  if (!cssCache.has(theme)) {
    const [base, skin] = await Promise.all([
      fetch("themes/base.css").then((r) => r.text()),
      fetch(`themes/${theme}.css`).then((r) => r.text()),
    ]);
    cssCache.set(theme, `${base}\n${skin}`);
  }
  return cssCache.get(theme);
}
