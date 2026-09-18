/* Word (.docx) export, built in the browser with no libraries.

   A .docx is a ZIP of XML parts, so this writes the XML and zips it (stored, no compression —
   Word is perfectly happy with that). It mirrors render_docx.py so the Word file from this page
   and the one from the Python command line look the same. */

import { contactLines, dateRange, fullUrl, groupJobs, segments, visibleSections } from "./resume.js";

const LOOKS = {
  classic: { font: "Georgia", size: 10, center: true, italicHeadline: true, accentHeadings: false },
  modern: { font: "Calibri", size: 10.5, center: false, italicHeadline: false, accentHeadings: true },
  compact: { font: "Arial", size: 9.5, center: false, italicHeadline: false, accentHeadings: true },
};
const PAGES = { A4: { w: 11906, h: 16838 }, Letter: { w: 12240, h: 15840 } };
const MM = 56.6929;           // twips per millimetre
const MUTED = "444444";
const INK = "161616";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const halfPoints = (pt) => Math.round(pt * 2);

/* ---------- a minimal ZIP writer (store only) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const put = (view) => { chunks.push(view); offset += view.length; };
  const header = (size) => new DataView(new ArrayBuffer(size));

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const sum = crc32(data);

    const local = header(30);
    local.setUint32(0, 0x04034b50, true);       // local file header
    local.setUint16(4, 20, true);               // version needed
    local.setUint16(6, 0x0800, true);           // UTF-8 names
    local.setUint16(8, 0, true);                // stored
    local.setUint32(14, sum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const start = offset;
    put(new Uint8Array(local.buffer));
    put(nameBytes);
    put(data);

    const entry = header(46);
    entry.setUint32(0, 0x02014b50, true);       // central directory entry
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint32(16, sum, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, start, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
  }

  const directoryStart = offset;
  for (const view of central) put(view);

  const end = header(22);
  end.setUint32(0, 0x06054b50, true);           // end of central directory
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, offset - directoryStart, true);
  end.setUint32(16, directoryStart, true);
  put(new Uint8Array(end.buffer));

  return new Blob(chunks, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/* ---------- the document ---------- */

class Writer {
  constructor(resume, fit) {
    this.resume = resume;
    this.look = LOOKS[resume.settings.theme] || LOOKS.classic;
    this.size = this.look.size * (fit?.scale ?? 1);
    this.accent = (resume.settings.accent || "#1f4e79").replace("#", "").toUpperCase();
    this.page = PAGES[resume.settings.page] || PAGES.A4;
    this.marginTwips = Math.round((fit?.margin ?? 13) * MM);
    this.textWidth = this.page.w - this.marginTwips * 2;
    this.body = [];
    this.links = [];  // hyperlink relationships, in the order they appear
  }

  linkId(url) {
    this.links.push(fullUrl(url));
    return `hl${this.links.length}`;
  }

  run(text, { bold, italic, color, size, href } = {}) {
    const props = [
      bold ? "<w:b/>" : "",
      italic ? "<w:i/>" : "",
      color ? `<w:color w:val="${color}"/>` : "",
      size ? `<w:sz w:val="${halfPoints(size)}"/><w:szCs w:val="${halfPoints(size)}"/>` : "",
    ].join("");
    const piece = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
    return href ? `<w:hyperlink r:id="${this.linkId(href)}">${piece}</w:hyperlink>` : piece;
  }

  /** Text with **bold** and [links](url), as runs. */
  rich(text, format = {}) {
    return segments(text)
      .map((seg) => this.run(seg.text, { ...format, bold: format.bold || seg.bold, href: seg.href }))
      .join("");
  }

  para(runs, { before = 0, after = 0, align = null, keepNext = false, tabRight = false, border = null,
               bullet = false } = {}) {
    const props = [
      bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "",
      keepNext ? "<w:keepNext/>" : "",
      border ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${border}"/></w:pBdr>` : "",
      tabRight ? `<w:tabs><w:tab w:val="right" w:pos="${this.textWidth}"/></w:tabs>` : "",
      `<w:spacing w:before="${Math.round(before * 20)}" w:after="${Math.round(after * 20)}"/>`,
      bullet ? `<w:ind w:left="${Math.round(this.size * 30)}" w:hanging="${Math.round(this.size * 20)}"/>` : "",
      align ? `<w:jc w:val="${align}"/>` : "",
    ].join("");
    this.body.push(`<w:p><w:pPr>${props}</w:pPr>${runs}</w:p>`);
  }

  /** Left text with a right-aligned date or location, like the two-column rows in the PDF. */
  row(left, right, { before = 0 } = {}) {
    const tail = right ? `<w:r><w:tab/></w:r>${this.run(right, { color: MUTED, size: this.size * 0.95 })}` : "";
    this.para(left + tail, { before, tabRight: true, keepNext: true });
  }

  heading(title) {
    const color = this.look.accentHeadings ? this.accent : INK;
    this.para(this.run(title.toUpperCase(), { bold: true, color, size: this.size }),
              { before: this.size * 0.95, after: this.size * 0.4, keepNext: true, border: color });
  }

  bullet(text) {
    this.para(this.rich(text), { before: this.size * 0.15, bullet: true });
  }

  header() {
    const b = this.resume.basics;
    const align = this.look.center ? "center" : "left";
    this.para(this.run(b.name, {
      bold: true, size: this.size * 2.2, color: this.look.accentHeadings ? this.accent : INK,
    }), { align });
    if (b.title) {
      this.para(this.run(b.title, { italic: this.look.italicHeadline, size: this.size * 1.1 }),
                { before: this.size * 0.2, align });
    }
    contactLines(this.resume).forEach((line, n) => {
      const runs = line.map(([text, href], i) =>
        (i ? this.run("  ·  ", { color: MUTED, size: this.size * 0.93 }) : "")
        + this.run(text, { color: MUTED, size: this.size * 0.93, href })).join("");
      this.para(runs, { before: this.size * (n ? 0.1 : 0.35), align });
    });
  }

  section(key) {
    const r = this.resume;
    if (key === "summary") return this.para(this.rich(r.summary));

    if (key === "skills") {
      return r.skills.forEach((group, i) => this.para(
        this.run(`${group.category}: `, { bold: true }) + this.run(group.items.join(", ")),
        { before: i ? this.size * 0.12 : 0 }));
    }

    if (key === "experience") {
      return groupJobs(r.experience).forEach((group, i) => {
        this.row(this.run(group.company, { bold: true, href: group.url || undefined }), group.location,
                 { before: i ? this.size * 0.55 : 0 });
        group.jobs.forEach((job, k) => {
          this.row(this.run(job.role, { italic: true }), dateRange(job.start, job.end),
                   { before: k ? this.size * 0.3 : 0 });
          if (job.summary) this.para(this.rich(job.summary, { italic: true, color: MUTED }));
          job.bullets.forEach((line) => this.bullet(line));
          if (job.tech.length) {
            this.para(this.run("Tech: ", { bold: true, size: this.size * 0.93 })
                      + this.run(job.tech.join(", "), { color: MUTED, size: this.size * 0.93 }),
                      { before: this.size * 0.15 });
          }
        });
      });
    }

    if (key === "projects") {
      return r.projects.forEach((project, i) => {
        const tech = project.tech.length
          ? this.run(` | ${project.tech.join(", ")}`, { italic: true, color: MUTED }) : "";
        const dates = project.start || project.end ? dateRange(project.start, project.end) : "";
        this.row(this.run(project.name, { bold: true, href: project.url || undefined }) + tech, dates,
                 { before: i ? this.size * 0.5 : 0 });
        if (project.description) this.para(this.rich(project.description, { italic: true, color: MUTED }));
        project.bullets.forEach((line) => this.bullet(line));
      });
    }

    if (key === "education") {
      return r.education.forEach((entry, i) => {
        this.row(this.run(entry.school, { bold: true }), entry.location, { before: i ? this.size * 0.5 : 0 });
        const score = entry.score ? this.run(` — ${entry.score}`, { italic: true }) : "";
        const dates = entry.start || entry.end ? dateRange(entry.start, entry.end) : "";
        this.row(this.run(entry.degree, { italic: true }) + score, dates);
        entry.bullets.forEach((line) => this.bullet(line));
      });
    }

    if (key === "certifications") {
      return r.certifications.forEach((cert) => {
        const name = cert.url ? `[${cert.name}](${cert.url})` : cert.name;
        this.bullet(name + (cert.issuer ? ` — ${cert.issuer}` : "")
          + (cert.date ? ` (${dateRange(cert.date, "")})` : ""));
      });
    }

    if (key === "achievements") return r.achievements.forEach((line) => this.bullet(line));
    return r.extra[Number(key.split(":")[1])].items.forEach((line) => this.bullet(line));
  }

  build() {
    this.header();
    for (const [key, title] of visibleSections(this.resume)) {
      this.heading(title);
      this.section(key);
    }
    const sectPr = `<w:sectPr><w:pgSz w:w="${this.page.w}" w:h="${this.page.h}"/>`
      + `<w:pgMar w:top="${this.marginTwips}" w:right="${this.marginTwips}" w:bottom="${this.marginTwips}"`
      + ` w:left="${this.marginTwips}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${this.body.join("")}${sectPr}</w:body></w:document>`;
  }
}

/* ---------- the fixed parts of the package ---------- */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const styles = (font, size) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}" w:eastAsia="${esc(font)}"/><w:color w:val="${INK}"/><w:sz w:val="${halfPoints(size)}"/><w:szCs w:val="${halfPoints(size)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="245" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

const core = (name) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(name)} – Resume</dc:title><dc:creator>${esc(name)}</dc:creator></cp:coreProperties>`;

const documentRels = (links) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${
  links.map((url, i) => `<Relationship Id="hl${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`).join("")
}</Relationships>`;

/** The resume as a Word file, ready to hand to the browser. */
export function buildDocx(resume, fit = null) {
  const writer = new Writer(resume, fit);
  const document = writer.build();
  return zip({
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "docProps/core.xml": core(resume.basics.name),
    "word/document.xml": document,
    "word/_rels/document.xml.rels": documentRels(writer.links),
    "word/numbering.xml": NUMBERING,
    "word/styles.xml": styles(writer.look.font, writer.size),
  });
}
