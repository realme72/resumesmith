/* ResumeSmith: form on the left, live preview on the right, formats along the bottom.

   Everything runs in this browser. Your details never leave the machine: the draft lives in
   localStorage, the resume is rendered here, and exports are built here and handed to the browser
   to save. There is no account and no server-side copy. */

import { outputStem, prepare, renderHtml, themeCss } from "./resume.js";
import { bulletTips, review } from "./review.js";
import { buildDocx } from "./docx.js";

const THEMES = ["classic", "compact", "modern"];
const FORMATS = {
  pdf: "PDF — opens your print dialog; pick “Save as PDF”",
  docx: "Word (.docx) — editable in Word or Google Docs",
};
const MIN_SCALE = 0.85;
/* A few millimetres held back for rounding between what we measure here and how the print engine
   lays the page out. Without any slack, a resume that exactly fills the page tips its last line
   onto a second one. */
const PRINT_RESERVE_MM = 5;
const mmToPx = (mm) => (mm / 25.4) * 96;

/* ---------- small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "value") node.value = value;
    else if (["checked", "disabled", "hidden", "open"].includes(key)) node[key] = !!value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) if (kid || kid === 0) node.append(kid);
  return node;
}

const isIndex = (part) => /^\d+$/.test(part);
const step = (obj, part) => (obj == null ? obj : obj[isIndex(part) ? Number(part) : part]);
const getPath = (obj, path) => path.split(".").reduce(step, obj);

function setPath(obj, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const parent = parts.reduce(step, obj);
  parent[isIndex(last) ? Number(last) : last] = value;
}

/* ---------- the data behind the form ---------- */

const newJob = () => ({ company: "", role: "", location: "", start: "", end: "", bullets: [""], tech: "" });
const newProject = () => ({ name: "", url: "", tech: "", description: "", bullets: [""] });
const newEducation = () => ({ school: "", degree: "", location: "", start: "", end: "", score: "" });
const newSkillGroup = () => ({ category: "", items: "" });
const newCertification = () => ({ name: "", issuer: "", date: "", url: "" });
const newSection = () => ({ title: "", items: [""] });
const newLink = () => ({ url: "", label: "" });

/* A link prints as its label when it has one ("LinkedIn"), and as its address when it doesn't. */
const LINK_LABELS = [
  [/(^|\.)linkedin\.com$/, "LinkedIn"], [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)gitlab\.com$/, "GitLab"], [/(^|\.)(twitter|x)\.com$/, "X"],
  [/(^|\.)medium\.com$/, "Medium"], [/(^|\.)stackoverflow\.com$/, "Stack Overflow"],
  [/(^|\.)leetcode\.com$/, "LeetCode"], [/(^|\.)kaggle\.com$/, "Kaggle"],
  [/(^|\.)behance\.net$/, "Behance"], [/(^|\.)dribbble\.com$/, "Dribbble"],
  [/(^|\.)youtube\.com$/, "YouTube"], [/(^|\.)dev\.to$/, "Blog"],
  [/(^|\.)hashnode\.(dev|com)$/, "Blog"], [/(^|\.)substack\.com$/, "Newsletter"],
];

function suggestLabel(url) {
  const host = String(url || "").trim().replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "")
    .split(/[/?#]/)[0].toLowerCase();
  if (!host.includes(".")) return "";
  const match = LINK_LABELS.find(([pattern]) => pattern.test(host));
  return match ? match[1] : "";
}

const blank = () => ({
  basics: { name: "", title: "", email: "", phone: "", location: "", links: [newLink()] },
  summary: "",
  skills: [newSkillGroup()],
  experience: [newJob()],
  projects: [],
  education: [newEducation()],
  certifications: [],
  achievements: [],
  extra: [],
  settings: { theme: "classic", accent: "#1f4e79", page: "A4", one_page: true, formats: ["pdf"] },
});

const asText = (value) => (Array.isArray(value) ? value.join(", ") : value ?? "");

/** A saved file may use lists where the form uses comma-separated text. */
function adapt(data = {}) {
  const out = blank();
  out.basics = { ...out.basics, ...(data.basics || {}) };
  out.basics.links = (data.basics?.links || []).map((link) => (typeof link === "string"
    ? { url: link, label: "" }
    : { url: link.url || "", label: link.label || "" }));
  if (!out.basics.links.length) out.basics.links = [newLink()];
  out.summary = typeof data.summary === "string" ? data.summary : "";
  const skills = Array.isArray(data.skills)
    ? data.skills.map((g) => ({ category: g.category || "", items: asText(g.items) }))
    : Object.entries(data.skills || {}).map(([category, items]) => ({ category, items: asText(items) }));
  out.skills = skills.length ? skills : [newSkillGroup()];
  out.experience = (data.experience || []).map((j) => ({ ...newJob(), ...j, tech: asText(j.tech), bullets: [...(j.bullets || [])] }));
  out.projects = (data.projects || []).map((p) => ({ ...newProject(), ...p, tech: asText(p.tech), bullets: [...(p.bullets || [])] }));
  out.education = (data.education || []).map((e) => ({ ...newEducation(), ...e }));
  out.certifications = (data.certifications || []).map((c) => ({ ...newCertification(), ...c }));
  out.achievements = [...(data.achievements || [])];
  out.extra = (data.extra || []).map((s) => ({ title: s.title || "", items: [...(s.items || [])] }));
  out.settings = { ...out.settings, ...(data.settings || {}) };
  out.settings.sections = normalizeOrder(out.settings.sections);
  out.settings.formats = (out.settings.formats || ["pdf"]).filter((f) => f in FORMATS);
  if (!out.settings.formats.length) out.settings.formats = ["pdf"];
  return out;
}

let state = blank();
let tips = {};

/* ---------- the draft kept in this browser ---------- */

const DRAFT_KEY = "resumesmith.draft.v1";

/** True once anything outside the design settings has been typed. */
function hasContent(value) {
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === "object") return Object.values(value).some(hasContent);
  return false;
}

function saveDraft() {
  const { settings, ...typed } = state;
  // An untouched form saves nothing — and never clears what another tab may have written.
  if (!hasContent(typed)) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ resume: state, at: Date.now() }));
  } catch {
    // private window, or storage turned off — the form still works, it just won't remember
  }
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return draft && draft.resume ? draft : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch { /* nothing to clear */ }
}

window.addEventListener("beforeunload", saveDraft);

/* ---------- section order ---------- */

const SECTION_KEYS = ["summary", "skills", "experience", "projects", "education", "certifications",
                      "achievements", "extra"];
const SECTION_LABELS = {
  summary: "Summary", skills: "Skills", experience: "Experience", projects: "Projects",
  education: "Education", certifications: "Certifications", achievements: "Achievements",
  extra: "Other sections",
};

function normalizeOrder(order) {
  return [...new Set([...(order || []).filter((key) => SECTION_KEYS.includes(key)), ...SECTION_KEYS])];
}

let draggingSection = null;
const swallow = (event) => { event.preventDefault(); event.stopPropagation(); };

function clearDropMarks() {
  $$(".sec.drop-above, .sec.drop-below").forEach((node) => node.classList.remove("drop-above", "drop-below"));
}

function moveSection(key, delta) {
  const order = [...state.settings.sections];
  const from = order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  state.settings.sections = order;
  refresh();
}

function dropSection(moved, target, after) {
  const order = state.settings.sections.filter((key) => key !== moved);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, moved);
  state.settings.sections = order;
  refresh();
}

function makeDraggable(card, grip, key) {
  card.dataset.section = key;
  const belowMiddle = (event) => {
    const box = card.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  };
  grip.addEventListener("dragstart", (event) => {
    draggingSection = key;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    event.dataTransfer.setDragImage(card, 12, 12);
  });
  grip.addEventListener("dragend", () => {
    draggingSection = null;
    card.classList.remove("dragging");
    clearDropMarks();
  });
  card.addEventListener("dragover", (event) => {
    if (!draggingSection || draggingSection === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropMarks();
    card.classList.add(belowMiddle(event) ? "drop-below" : "drop-above");
  });
  card.addEventListener("dragleave", () => card.classList.remove("drop-above", "drop-below"));
  card.addEventListener("drop", (event) => {
    if (!draggingSection || draggingSection === key) return;
    event.preventDefault();
    const moved = draggingSection;
    draggingSection = null;
    dropSection(moved, key, belowMiddle(event));
  });
}

/* ---------- form pieces ---------- */

const openSections = new Set(["basics", "summary", "experience", "skills", "education"]);
const countLabel = (list) => (list && list.length ? ` (${list.length})` : "");
const hint = (text) => el("p", { class: "hint" }, text);
const row = (...kids) => el("div", { class: "row" }, ...kids);
const labelText = (text) => el("span", { class: "label" }, text);

function button(label, onClick, { cls = "btn", title = "", disabled = false } = {}) {
  return el("button", { type: "button", class: cls, title, disabled, onclick: onClick }, label);
}
const addButton = (label, onClick) => button(`+ ${label}`, onClick, { cls: "btn add" });

function section(key, label, kids, { movable = false } = {}) {
  const grip = movable
    ? el("span", { class: "grip", draggable: "true", title: "Drag to reorder" }, "⠿")
    : null;
  const tools = movable
    ? el("span", { class: "sec-tools" },
        button("↑", (event) => { swallow(event); moveSection(key, -1); },
               { cls: "btn icon", title: "Move section up" }),
        button("↓", (event) => { swallow(event); moveSection(key, 1); },
               { cls: "btn icon", title: "Move section down" }))
    : null;
  const details = el("details", { class: "sec", open: openSections.has(key) },
    el("summary", {}, grip, el("span", { class: "sec-label" }, label), tools),
    el("div", { class: "sec-body" }, ...kids));
  details.addEventListener("toggle", () => (details.open ? openSections.add(key) : openSections.delete(key)));
  if (movable) makeDraggable(details, grip, key);
  return details;
}

function field(label, path, { placeholder = "", type = "text", wide = false } = {}) {
  return el("label", { class: `field${wide ? " wide" : ""}` }, labelText(label),
    el("input", { type, class: "input", placeholder, "data-path": path, value: getPath(state, path) ?? "" }));
}

function areaField(label, path, { placeholder = "", rows = 3 } = {}) {
  const area = el("textarea", { class: "input area", rows, placeholder, "data-path": path });
  area.value = getPath(state, path) ?? "";
  return el("label", { class: "field wide" }, label ? labelText(label) : null, area);
}

function refresh() {
  render();
  schedulePreview();
}

function focusLast(path) {
  const list = getPath(state, path) || [];
  $(`[data-path="${path}.${list.length - 1}"]`)?.focus();
}

function card(listPath, index, count, title, kids) {
  const list = getPath(state, listPath);
  const move = (delta) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    refresh();
  };
  return el("div", { class: "card" },
    el("div", { class: "card-head" },
      el("span", { class: "card-title" }, title || `#${index + 1}`),
      el("div", { class: "tools" },
        button("↑", () => move(-1), { cls: "btn icon", title: "Move up", disabled: index === 0 }),
        button("↓", () => move(1), { cls: "btn icon", title: "Move down", disabled: index === count - 1 }),
        button("✕", () => { list.splice(index, 1); refresh(); }, { cls: "btn icon danger", title: "Remove" }))),
    ...kids);
}

function stringList(path, { placeholder = "", addLabel = "Add" } = {}) {
  const list = getPath(state, path) || [];
  return el("div", { class: "stack" },
    ...list.map((value, i) => el("div", { class: "line" },
      el("input", { class: "input", placeholder, "data-path": `${path}.${i}`, value: value ?? "" }),
      button("✕", () => { list.splice(i, 1); refresh(); }, { cls: "btn icon danger", title: "Remove" }))),
    addButton(addLabel, () => { list.push(""); render(); focusLast(path); }));
}

function linkList() {
  const list = state.basics.links;
  return el("div", { class: "stack" },
    ...list.map((link, i) => el("div", { class: "line" },
      el("input", { class: "input link-label", placeholder: "LinkedIn",
                    "data-path": `basics.links.${i}.label`, value: link.label ?? "" }),
      el("input", { class: "input", placeholder: "linkedin.com/in/you",
                    "data-path": `basics.links.${i}.url`, value: link.url ?? "" }),
      button("✕", () => { list.splice(i, 1); refresh(); }, { cls: "btn icon danger", title: "Remove" }))),
    addButton("Add link", () => {
      list.push(newLink());
      render();
      $(`[data-path="basics.links.${list.length - 1}.url"]`)?.focus();
    }));
}

function bulletList(path, placeholder) {
  const list = getPath(state, path) || [];
  return el("div", { class: "bullets" },
    ...list.map((value, i) => {
      const key = `${path}.${i}`;
      const area = el("textarea", { class: "input area bullet", rows: 2, placeholder, "data-path": key });
      area.value = value ?? "";
      return el("div", { class: "bullet-row", "data-tip-for": key },
        el("div", { class: "bullet-main" }, area, el("p", { class: "tip", hidden: true })),
        button("✕", () => { list.splice(i, 1); refresh(); }, { cls: "btn icon danger", title: "Remove" }));
    }),
    addButton("Add achievement", () => { list.push(""); render(); focusLast(path); }));
}

/* ---------- one card per kind of entry ---------- */

function jobCard(i, count) {
  const path = `experience.${i}`;
  const job = state.experience[i];
  return card("experience", i, count, job.company || "New role", [
    row(field("Company", `${path}.company`, { placeholder: "Finlo Payments" }),
        field("Your title", `${path}.role`, { placeholder: "Senior Software Engineer" })),
    row(field("Location", `${path}.location`, { placeholder: "Bengaluru, or Remote" }),
        field("Start", `${path}.start`, { placeholder: "Mar 2022" }),
        field("End", `${path}.end`, { placeholder: "present" })),
    labelText("Achievements"),
    bulletList(`${path}.bullets`, "Cut checkout API p99 latency from 900 ms to 180 ms by adding Redis caching"),
    field("Tech used", `${path}.tech`, { placeholder: "Python, Kafka, AWS", wide: true }),
  ]);
}

function projectCard(i, count) {
  const path = `projects.${i}`;
  const project = state.projects[i];
  return card("projects", i, count, project.name || "New project", [
    row(field("Name", `${path}.name`), field("Link", `${path}.url`, { placeholder: "github.com/you/project" })),
    row(field("Tech", `${path}.tech`, { placeholder: "Go, PostgreSQL" }),
        field("Dates", `${path}.end`, { placeholder: "2024 (optional)" })),
    field("One line about it", `${path}.description`, { wide: true }),
    bulletList(`${path}.bullets`, "Open-source Postgres monitor with 1.4K GitHub stars"),
  ]);
}

function educationCard(i, count) {
  const path = `education.${i}`;
  const entry = state.education[i];
  return card("education", i, count, entry.school || "New entry", [
    row(field("College / school", `${path}.school`), field("Location", `${path}.location`)),
    field("Degree and field", `${path}.degree`, { placeholder: "B.Tech, Computer Science", wide: true }),
    row(field("Start", `${path}.start`, { placeholder: "2016" }),
        field("Finished", `${path}.end`, { placeholder: "2020" }),
        field("Score", `${path}.score`, { placeholder: "CGPA 8.4/10" })),
  ]);
}

function skillCard(i, count) {
  const path = `skills.${i}`;
  const group = state.skills[i];
  return card("skills", i, count, group.category || "New group", [
    row(field("Group", `${path}.category`, { placeholder: "Languages" })),
    field("Items, comma separated", `${path}.items`, { placeholder: "Python, Go, SQL", wide: true }),
  ]);
}

function certificationCard(i, count) {
  const path = `certifications.${i}`;
  const cert = state.certifications[i];
  return card("certifications", i, count, cert.name || "New certification", [
    row(field("Name", `${path}.name`), field("Issued by", `${path}.issuer`)),
    row(field("When", `${path}.date`, { placeholder: "Nov 2023" }), field("Link", `${path}.url`)),
  ]);
}

function extraCard(i, count) {
  const path = `extra.${i}`;
  const extra = state.extra[i];
  return card("extra", i, count, extra.title || "New section", [
    field("Section title", `${path}.title`, { placeholder: "Languages", wide: true }),
    stringList(`${path}.items`, { placeholder: "English (fluent)", addLabel: "Add line" }),
  ]);
}

function listSection(key, cardFn, factory, addLabel, hintText) {
  const list = state[key];
  const kids = hintText ? [hint(hintText)] : [];
  list.forEach((_, i) => kids.push(cardFn(i, list.length)));
  kids.push(addButton(addLabel, () => {
    list.push(factory());
    openSections.add(key);
    render();
    $(`[data-path="${key}.${list.length - 1}.${Object.keys(factory())[0]}"]`)?.focus();
    schedulePreview();
  }));
  return section(key, `${SECTION_LABELS[key]}${countLabel(list)}`, kids, { movable: true });
}

const SECTION_VIEWS = {
  summary: () => section("summary", "Summary", [
    areaField("", "summary", { rows: 4, placeholder: "Backend engineer with 6 years building payment systems in Python and Go…" }),
    hint("2–3 sentences: your role and years of experience, what you're strongest at, one result you're proud of."),
  ], { movable: true }),
  skills: () => listSection("skills", skillCard, newSkillGroup, "Add skill group",
    "Group them: Languages, Backend, Data, Cloud & DevOps…"),
  experience: () => listSection("experience", jobCard, newJob, "Add job",
    "Most recent first. Start each achievement with a verb, and add a number where you can."),
  projects: () => listSection("projects", projectCard, newProject, "Add project"),
  education: () => listSection("education", educationCard, newEducation, "Add education"),
  certifications: () => listSection("certifications", certificationCard, newCertification, "Add certification"),
  achievements: () => section("achievements", `Achievements${countLabel(state.achievements)}`, [
    hint("Awards, rankings, hackathons, talks, open source."),
    stringList("achievements", { placeholder: "Won first place out of 400+ teams…", addLabel: "Add achievement" }),
  ], { movable: true }),
  extra: () => listSection("extra", extraCard, newSection, "Add section",
    "Anything else: languages, publications, volunteering…"),
};

function render() {
  const panel = $("#form");
  const scroll = panel.scrollTop;
  state.settings.sections = normalizeOrder(state.settings.sections);
  panel.replaceChildren(
    section("basics", "Basics", [
      row(field("Full name", "basics.name", { placeholder: "Aarav Mehta" }),
          field("Headline", "basics.title", { placeholder: "Senior Backend Engineer" })),
      row(field("Email", "basics.email", { type: "email", placeholder: "you@example.com" }),
          field("Phone", "basics.phone", { placeholder: "+91 98765 43210" })),
      field("Location", "basics.location", { placeholder: "Bengaluru, India", wide: true }),
      labelText("Links — the left box is what prints; clear it to print the address itself"),
      linkList(),
    ]),
    hint("Drag ⠿ to reorder sections — this is the order they print in."),
    ...state.settings.sections.map((key) => SECTION_VIEWS[key]()),
  );
  panel.scrollTop = scroll;
  $$("textarea.area", panel).forEach(autogrow);
  applyTips();
}

function autogrow(area) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + 2}px`;
}

const labelsTyped = new Set();  // links whose label you wrote yourself — never overwritten

/** Paste an address and its label writes itself; type or clear your own and it is left alone. */
function fillLinkLabel(index) {
  const link = state.basics.links[index];
  if (!link || link.label || labelsTyped.has(index)) return;
  const guess = suggestLabel(link.url);
  if (!guess) return;
  link.label = guess;
  const box = $(`[data-path="basics.links.${index}.label"]`);
  if (box) box.value = guess;
}

$("#form").addEventListener("input", (event) => {
  const path = event.target.dataset.path;
  if (!path) return;
  setPath(state, path, event.target.value);
  if (event.target.classList.contains("area")) autogrow(event.target);
  const typedLabel = path.match(/^basics\.links\.(\d+)\.label$/);
  if (typedLabel) labelsTyped.add(Number(typedLabel[1]));
  const typedUrl = path.match(/^basics\.links\.(\d+)\.url$/);
  if (typedUrl) fillLinkLabel(Number(typedUrl[1]));
  schedulePreview();
});

/* ---------- preview ---------- */

const frame = $("#preview");
let previewTimer = null;
let previewing = false;
let previewPending = false;

const setStatus = (text) => { $("#status").textContent = text; };
function setError(text) {
  const bar = $("#error");
  bar.textContent = text || "";
  bar.hidden = !text;
}

function schedulePreview() {
  clearTimeout(previewTimer);
  setStatus("Updating…");
  previewTimer = setTimeout(() => { saveDraft(); runPreview(); }, 250);
}

/** Coaching for every achievement, keyed by the form field it belongs to. */
function collectTips() {
  const out = {};
  for (const sectionName of ["experience", "projects"]) {
    (state[sectionName] || []).forEach((item, i) => {
      (item.bullets || []).forEach((line, j) => {
        if (typeof line === "string" && line.trim()) {
          const found = bulletTips(line);
          if (found.length) out[`${sectionName}.${i}.bullets.${j}`] = found;
        }
      });
    });
  }
  return out;
}

async function runPreview() {
  if (!state.basics.name.trim()) return showEmptyPreview();
  if (previewing) { previewPending = true; return; }
  previewing = true;
  try {
    const { resume, hidden, problems } = prepare(state);
    const css = await themeCss(resume.settings.theme);
    frame.srcdoc = renderHtml(resume, { css, bare: true });
    showReview(review(resume));
    showHidden(hidden);
    tips = collectTips();
    applyTips();
    setError(problems.map((p) => `${p.where}: ${p.message}`).join("\n"));
    setStatus("");
  } catch (e) {
    setError(e.message);
    setStatus("");
  } finally {
    previewing = false;
    if (previewPending) { previewPending = false; schedulePreview(); }
  }
}

function showEmptyPreview() {
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100%;display:flex;
    align-items:center;justify-content:center;background:#fff;color:#8a93a3;
    font:14px -apple-system,system-ui,sans-serif">Type your name and the preview appears here</body>`;
  $("#page-badge").textContent = "—";
  $("#page-badge").className = "badge";
  setStatus("");
}

const pagePx = () => (state.settings.page === "Letter"
  ? { w: 8.5 * 96, h: 11 * 96 }
  : { w: (210 / 25.4) * 96, h: (297 / 25.4) * 96 });

function fitPreview() {
  const { w, h } = pagePx();
  const sheet = frame.contentDocument?.querySelector(".sheet");
  const contentH = Math.max(sheet?.scrollHeight || 0, h);
  frame.style.width = `${w}px`;
  frame.style.height = `${contentH}px`;
  const wrap = $("#paper-wrap");
  const scale = Math.min(1, Math.max(0.2, (wrap.clientWidth - 48) / w));
  frame.style.transform = `scale(${scale})`;
  const paper = $("#paper");
  paper.style.width = `${w * scale}px`;
  paper.style.height = `${contentH * scale}px`;
  const measured = contentHeight(frame.contentDocument);
  if (measured !== null) setPages(measured / (h - mmToPx(PRINT_RESERVE_MM)));
}

/** `pages` is how much of the printable page the content takes, 1 being exactly full. */
function setPages(pages) {
  const badge = $("#page-badge");
  if (pages <= 1) {
    badge.textContent = "Fits one page";
    badge.className = "badge good";
  } else if (state.settings.one_page !== false && pages <= 1.2) {
    badge.textContent = "Just over — will be tightened to fit";
    badge.className = "badge warn";
  } else {
    badge.textContent = `About ${pages.toFixed(1)} pages`;
    badge.className = "badge warn";
  }
}

frame.addEventListener("load", fitPreview);
new ResizeObserver(fitPreview).observe($("#paper-wrap"));

function applyTips() {
  $$("[data-tip-for]").forEach((rowEl) => {
    const list = tips[rowEl.dataset.tipFor];
    const tip = $(".tip", rowEl);
    if (!tip) return;
    const worst = list?.find((t) => t.level === "error") || list?.find((t) => t.level === "warn") || list?.[0];
    tip.textContent = worst ? `↳ ${worst.message}` : "";
    tip.className = `tip ${worst ? worst.level : ""}`;
    tip.hidden = !worst;
  });
}

/** Entries you've started but that can't be drawn yet — say so rather than dropping them silently. */
function showHidden(hidden) {
  const note = $("#hidden-note");
  note.textContent = hidden
    .map((item) => `${item.label} isn't in the preview yet — add its ${item.missing.join(" and ")}.`)
    .join("  ");
  note.hidden = !hidden.length;
}

function showReview(issues) {
  $("#review-count").textContent = issues.length;
  const icons = { error: "✗", warn: "!", tip: "·" };
  $("#review").replaceChildren(issues.length
    ? el("ul", { class: "issues" }, ...issues.map((issue) => el("li", { class: issue.level },
        el("span", { class: "ic" }, icons[issue.level]),
        el("span", {}, el("b", {}, issue.where), ` — ${issue.message}`))))
    : hint("Nothing to flag — nice."));
}

$("#review-toggle").addEventListener("click", () => {
  const panel = $("#review");
  panel.hidden = !panel.hidden;
});

/* ---------- fitting one page, measured in a hidden frame ---------- */

const ruler = $("#ruler");

/* The margins stay where they are: Chrome prints its header and footer in that band, and squeezing
   it is what pushed a line onto page two. Only the type gets smaller. */
function fitSteps(settings) {
  const margin = 13;
  const steps = [[1, margin]];
  if (!settings.one_page) return steps;
  for (let scale = 0.97; scale >= MIN_SCALE - 1e-9; scale -= 0.03) {
    steps.push([Math.round(scale * 100) / 100, margin]);
  }
  return steps;
}

const frameLoaded = (target) => new Promise((resolve) => {
  target.addEventListener("load", resolve, { once: true });
});

/** Tries the same steps the Python exporter does: tighter margins first, then slightly smaller type. */
/**
 * How much of the page the content really takes, top margin to bottom margin.
 * `.sheet` has a min-height so the preview looks like a sheet of paper, which would otherwise hide
 * a short resume and make every measurement read as a full page.
 */
function contentHeight(doc) {
  const sheet = doc?.querySelector(".sheet");
  const last = sheet?.lastElementChild;
  if (!sheet || !last) return null;
  const padding = parseFloat(doc.defaultView.getComputedStyle(sheet).paddingBottom);
  return last.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + padding;
}

async function fitToPage(resume, css) {
  const limit = pagePx().h - mmToPx(PRINT_RESERVE_MM);
  let height = null;
  for (const [scale, margin] of fitSteps(resume.settings)) {
    ruler.srcdoc = renderHtml(resume, { css, scale, margin, bare: true });
    await frameLoaded(ruler);
    height = contentHeight(ruler.contentDocument);
    if (height === null) break;
    if (height <= limit) return { scale, margin, pages: 1, fitted: true };
  }
  return { scale: 1, margin: 13, fitted: !resume.settings.one_page,
           pages: height ? Math.ceil(height / limit) : 1 };
}

/* ---------- saving files ---------- */

function saveBlob(name, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = el("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The PDF comes from the browser's own print engine, so the text stays real text. */
async function printResume(resume, css, fit) {
  const sheet = $("#printer");
  sheet.srcdoc = renderHtml(resume, { css, scale: fit.scale, margin: fit.margin });
  await frameLoaded(sheet);
  sheet.contentWindow.focus();
  sheet.contentWindow.print();
}

const setExportNote = (text, bad = false) => {
  const note = $("#export-note");
  note.textContent = text;
  note.classList.toggle("bad", bad);
};

$("#export").addEventListener("click", async () => {
  const formats = $$("#formats input:checked").map((box) => box.value);
  if (!formats.length) return setExportNote("Pick at least one format.", true);
  if (!state.basics.name.trim()) return setExportNote("Add your name first.", true);
  state.settings.formats = formats;
  const trigger = $("#export");
  trigger.disabled = true;
  setExportNote("Making your files…");
  try {
    const { resume, problems } = prepare(state);
    if (problems.length) throw new Error(problems.map((p) => `${p.where}: ${p.message}`).join("\n"));
    const css = await themeCss(resume.settings.theme);
    const fit = await fitToPage(resume, css);
    const stem = outputStem(resume);

    if (formats.includes("docx")) saveBlob(`${stem}.docx`, buildDocx(resume, fit));
    if (formats.includes("pdf")) await printResume(resume, css, fit);

    const fitNote = fit.fitted === false && fit.pages > 1
      ? `${fit.pages} pages — too long for one`
      : fit.scale < 1 ? `Fitted onto one page (type at ${Math.round(fit.scale * 100)}%)` : "One page";
    const done = [];
    if (formats.includes("docx")) done.push("Word file saved to your downloads");
    if (formats.includes("pdf")) done.push("in the print window choose “Save as PDF”");
    setExportNote(`${fitNote} · ${done.join(" · ")}`, fit.fitted === false);
    setError("");
  } catch (e) {
    setExportNote("Couldn't export — see the message above", true);
    setError(e.message);
  } finally {
    trigger.disabled = false;
  }
});

/* ---------- your data, as a file ---------- */

$("#download-data").addEventListener("click", () => {
  const { resume } = prepare(state);
  const name = outputStem(resume).replace(/_Resume$/, "") || "resume";
  saveBlob(`${name}.json`, `${JSON.stringify(state, null, 2)}\n`, "application/json");
  setStatus("Saved a copy of your details");
});

$("#open-data").addEventListener("click", () => $("#open-file").click());

$("#open-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state = adapt(JSON.parse(await file.text()));
    labelsTyped.clear();
    syncSettings();
    render();
    runPreview();
    setStatus(`Opened ${file.name}`);
  } catch {
    setError(`${file.name} isn't a ResumeSmith file — pick a .json you downloaded from here.`);
  } finally {
    event.target.value = "";
  }
});

$("#new-resume").addEventListener("click", () => {
  if (!confirm("Start a new, empty resume? Anything unsaved is lost.")) return;
  state = blank();
  tips = {};
  labelsTyped.clear();
  clearDraft();
  syncSettings();
  render();
  showEmptyPreview();
  showReview([]);
  showHidden([]);
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
    event.preventDefault();
    $("#download-data").click();
  }
});

/* ---------- design controls ---------- */

function syncSettings() {
  $("#theme").value = state.settings.theme;
  $("#accent").value = state.settings.accent;
  $("#page").value = state.settings.page;
  $("#one_page").checked = state.settings.one_page !== false;
  $$("#formats input").forEach((box) => { box.checked = state.settings.formats.includes(box.value); });
}

function wireSettings() {
  $("#theme").replaceChildren(...THEMES.map((name) =>
    el("option", { value: name }, name[0].toUpperCase() + name.slice(1))));
  const bind = (id, key, read) => $(id).addEventListener("change", (e) => {
    state.settings[key] = read(e.target);
    schedulePreview();
  });
  bind("#theme", "theme", (t) => t.value);
  bind("#page", "page", (t) => t.value);
  bind("#one_page", "one_page", (t) => t.checked);
  $("#accent").addEventListener("input", (e) => { state.settings.accent = e.target.value; schedulePreview(); });

  $("#formats").replaceChildren(...Object.entries(FORMATS).map(([key, label]) =>
    el("label", { class: "fmt", title: label },
      el("input", { type: "checkbox", value: key }),
      el("span", {}, label.split("—")[0].trim()))));
  syncSettings();
}

/* ---------- start ---------- */

(async function init() {
  const draft = loadDraft();
  if (draft) state = adapt(draft.resume);
  wireSettings();
  render();
  if (draft) {
    await runPreview();
    setStatus("Picked up where you left off");
  } else {
    showEmptyPreview();
  }
})();
