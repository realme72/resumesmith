/* The spoken interview: answered out loud or typed, and turned into a first draft.

   Anything with a shape — a name, an address, a phone number, a date — gets its own box instead of
   being picked out of a sentence afterwards, because that is exactly what speech recognition is
   worst at: it hears "gmail" as "gameil" and drops the "@" entirely, and no amount of parsing
   recovers an address that was never transcribed. What stays free-form is the part where sentences
   are the point — what you actually did in a job — and that is all the organiser has to read. */

import { listen, supported } from "./speech.js";
import { spokenBullets, spokenSkills, tidyDate } from "./organise.js";

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "hidden" || key === "disabled") node[key] = !!value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) if (kid || kid === 0) node.append(kid);
  return node;
};

const JOB_FIELDS = [
  { name: "company", label: "Company", placeholder: "Finlo Payments", mic: true },
  { name: "role", label: "Your title", placeholder: "Senior Backend Engineer", mic: true },
  { name: "location", label: "Where", placeholder: "Bengaluru, or Remote", mic: true },
  { name: "start", label: "Started", placeholder: "Mar 2022", mic: true },
  { name: "end", label: "Until", placeholder: "present", mic: true },
  { name: "did", label: "What you did there", area: true, wide: true, mic: true,
    placeholder: "Say what you built and what it changed. Numbers help: users, requests a second, "
      + "money, hours saved. Pause whenever you like — say it in as many sentences as you want." },
  { name: "tech", label: "Tech used (optional)", wide: true, mic: true, placeholder: "Python, Kafka, AWS" },
];

const PROJECT_FIELDS = [
  { name: "name", label: "What it's called", placeholder: "pgwatch-lite", mic: true },
  { name: "url", label: "Link (optional)", placeholder: "github.com/you/project" },
  { name: "tech", label: "Built with", placeholder: "Python, PostgreSQL", mic: true },
  { name: "did", label: "What it does", area: true, wide: true, mic: true,
    placeholder: "One or two sentences about what it does and who uses it." },
];

const SCHOOL_FIELDS = [
  { name: "school", label: "Institution", placeholder: "NIT Tiruchirappalli", mic: true },
  { name: "degree", label: "Degree", placeholder: "B.Tech, Computer Science", mic: true },
  { name: "location", label: "Where", placeholder: "Tiruchirappalli, India", mic: true },
  { name: "start", label: "From", placeholder: "2018", mic: true },
  { name: "end", label: "To", placeholder: "2022", mic: true },
  { name: "score", label: "Score (optional)", placeholder: "CGPA 8.4/10", mic: true },
];

const STEPS = [
  {
    key: "basics", title: "Who you are",
    ask: "The parts a machine has to read exactly. Dictate the words, but type the address and the "
      + "phone number — speech gets those wrong more often than not.",
    fields: [
      { name: "name", label: "Full name", placeholder: "Aarav Mehta", mic: true },
      { name: "title", label: "The job you're going for", placeholder: "Senior Backend Engineer", mic: true },
      { name: "location", label: "City", placeholder: "Bengaluru, India", mic: true },
      { name: "email", label: "Email", type: "email", placeholder: "you@example.com" },
      { name: "phone", label: "Phone", type: "tel", placeholder: "+91 98765 43210" },
      { name: "linkedin", label: "LinkedIn (optional)", placeholder: "linkedin.com/in/you" },
      { name: "github", label: "GitHub or your site (optional)", placeholder: "github.com/you" },
    ],
  },
  {
    key: "summary", title: "Your summary", optional: true,
    ask: "Two or three sentences: what you do, how long you've done it, and one result you're "
      + "proud of. Skip it and the form will still prompt you later.",
    text: { placeholder: "Backend engineer with six years building payment systems in Python and Go…" },
  },
  {
    key: "experience", title: "Where you've worked", repeat: true, fields: JOB_FIELDS,
    add: "Add another job",
    ask: "Start with the job you're in now, then add the ones before it. Leave it empty to move on.",
  },
  {
    key: "projects", title: "What you've built", repeat: true, fields: PROJECT_FIELDS, optional: true,
    add: "Add another project",
    ask: "Side projects, open source, anything outside work. Skip if there's nothing.",
  },
  {
    key: "skills", title: "Your tools", optional: true,
    ask: "The languages, frameworks, databases and cloud tools you'd be happy to be interviewed on. "
      + "Say them in a list — they'll be grouped in the form.",
    text: { placeholder: "Python, Go, SQL, PostgreSQL, Redis, Docker, AWS" },
  },
  {
    key: "education", title: "Where you studied", repeat: true, fields: SCHOOL_FIELDS, optional: true,
    add: "Add another",
    ask: "The institution, the degree and the years.",
  },
];

const blank = (fields) => Object.fromEntries(fields.map((f) => [f.name, ""]));
const filled = (entry) => Object.values(entry).some((value) => String(value).trim());

/** Only one microphone runs at a time; starting another stops the one before it. */
function stopMic(mic) {
  if (mic.session) mic.session.stop();
  mic.session = null;
  if (mic.button) mic.button.classList.remove("listening");
  if (mic.field) mic.field.classList.remove("dictating");
  mic.button = null;
  mic.field = null;
  if (mic.changed) mic.changed();
}

/**
 * Starts filling one box by voice. Both ways in end up here — the button in the footer, which is
 * the one people find, and the small microphone beside each label.
 */
function beginDictation(input, button, mic, say) {
  const running = mic.field === input;
  stopMic(mic);
  if (running) return say("");
  if (!input) return say("Click the box you want to fill first.");
  try {
    mic.session = listen({
      onFinal: (phrase) => {
        input.value = `${input.value.trim()} ${phrase}`.trim();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.scrollTop = input.scrollHeight;
      },
      onError: (message) => { say(message); stopMic(mic); },
      onEnd: () => stopMic(mic),
    });
    mic.button = button;
    mic.field = input;
    button.classList.add("listening");
    input.classList.add("dictating");
    if (mic.changed) mic.changed();
    say(`Listening — filling “${input.dataset.label || "this box"}”. Speak normally, pause when you `
      + "like, and press Stop when you're done.");
  } catch (e) {
    say(e.message);
  }
}

function micFor(input, mic, say) {
  const button = el("button", { type: "button", class: "btn icon mic", title: "Dictate this",
                                "aria-label": "Dictate this", disabled: !supported() }, "🎙");
  button.addEventListener("click", (event) => {
    event.preventDefault();  // the button sits inside a label, which would pull focus back
    beginDictation(input, button, mic, say);
  });
  return button;
}

function fieldRow(def, target, mic, say) {
  const input = def.area
    ? el("textarea", { class: "input area", rows: 5, placeholder: def.placeholder })
    : el("input", { class: "input", type: def.type || "text", placeholder: def.placeholder });
  input.value = target[def.name] || "";
  input.dataset.label = def.label || "this box";
  input.addEventListener("input", () => { target[def.name] = input.value; });
  return el("label", { class: `iv-field${def.wide ? " wide" : ""}` },
    el("span", { class: "iv-fhead" },
      el("span", { class: "label" }, def.label || ""),
      def.mic === false ? null : micFor(input, mic, say)),
    input);
}

/** One line describing an entry already filled in, so the panel doesn't repeat every box. */
const summarise = (entry) => Object.values(entry)
  .map((value) => String(value).trim()).filter(Boolean).slice(0, 3).join(" · ");

/** Everything the answers add up to, in the shape the form takes. */
function assemble(data) {
  const basics = data.basics;
  const links = [];
  if (basics.linkedin.trim()) links.push({ url: basics.linkedin.trim(), label: "LinkedIn" });
  if (basics.github.trim()) {
    links.push({ url: basics.github.trim(), label: /github/i.test(basics.github) ? "GitHub" : "" });
  }
  const ended = (value) => (/present|now|current|ongoing/i.test(value) ? "present" : tidyDate(value));

  return {
    basics: {
      name: basics.name.trim(), title: basics.title.trim(), email: basics.email.trim(),
      phone: basics.phone.trim(), location: basics.location.trim(), links,
    },
    summary: data.summary.trim(),
    experience: data.experience.filter(filled).map((job) => ({
      company: job.company.trim(), role: job.role.trim(), location: job.location.trim(),
      start: tidyDate(job.start), end: ended(job.end), tech: job.tech.trim(),
      bullets: spokenBullets(job.did, job.company),
    })),
    projects: data.projects.filter(filled).map((project) => ({
      name: project.name.trim() || "Project", url: project.url.trim(), tech: project.tech.trim(),
      description: project.did.trim(), bullets: [],
    })),
    skills: spokenSkills(data.skills),
    education: data.education.filter(filled).map((school) => ({
      school: school.school.trim(), degree: school.degree.trim(), location: school.location.trim(),
      start: tidyDate(school.start), end: ended(school.end), score: school.score.trim(),
    })),
    certifications: [], achievements: [], extra: [],
  };
}

/**
 * Opens the interview. Resolves with a resume once the person finishes, or with null if they back
 * out or fill in nothing — the caller decides what to do with it, so nothing here touches the form.
 */
export function runInterview() {
  return new Promise((resolve) => {
    const data = {
      basics: blank(STEPS[0].fields), summary: "", skills: "",
      experience: [blank(JOB_FIELDS)], projects: [blank(PROJECT_FIELDS)],
      education: [blank(SCHOOL_FIELDS)],
    };
    const mic = { session: null, button: null, field: null, changed: null };
    let index = 0;
    let lastFocused = null;

    const heading = el("h2", { class: "iv-title" });
    const count = el("span", { class: "iv-count" });
    const prompt = el("p", { class: "iv-ask" });
    const body = el("div", { class: "iv-body" });
    const status = el("p", { class: "iv-status" });
    const HINT = supported()
      ? "Press Start talking to fill the box you're in — or the 🎙 beside any box."
      : "This browser can't listen — try Chrome, Edge or Safari. You can still type every answer.";
    const say = (message) => { status.textContent = message || HINT; };

    const back = el("button", { type: "button", class: "btn ghost" }, "Back");
    const skip = el("button", { type: "button", class: "btn ghost" }, "Skip");
    const next = el("button", { type: "button", class: "btn primary" }, "Next");
    const talk = el("button", { type: "button", class: "btn talk", disabled: !supported() },
                    "🎙 Start talking");

    // The small microphones beside each label are easy to miss, so dictation gets a button of its
    // own that fills whichever box you're in — the one you were last typing in, or the first that
    // is still empty.
    mic.changed = () => {
      talk.textContent = mic.session ? "■ Stop" : "🎙 Start talking";
      talk.classList.toggle("listening", Boolean(mic.session));
    };
    talk.addEventListener("click", () => {
      const boxes = [...body.querySelectorAll("input, textarea")];
      const target = (lastFocused && body.contains(lastFocused) ? lastFocused : null)
        || boxes.find((box) => !box.value.trim()) || boxes[0];
      if (target && target !== document.activeElement && !mic.session) target.focus();
      beginDictation(target, talk, mic, say);
    });
    body.addEventListener("focusin", (event) => {
      if (event.target.matches("input, textarea")) lastFocused = event.target;
    });

    const move = (to) => { stopMic(mic); index = Math.min(Math.max(to, 0), STEPS.length - 1); show(); };

    function show() {
      const step = STEPS[index];
      heading.textContent = step.title;
      count.textContent = `Step ${index + 1} of ${STEPS.length}`;
      prompt.textContent = step.ask;
      say("");
      back.disabled = index === 0;
      skip.hidden = !step.optional;
      next.textContent = index === STEPS.length - 1 ? "Build my resume" : "Next";

      const kids = [];
      if (step.text) {
        kids.push(fieldRow({ ...step.text, name: step.key, area: true, wide: true, mic: true },
                           data, mic, say));
      } else if (step.repeat) {
        const list = data[step.key];
        list.forEach((entry, i) => {
          if (i < list.length - 1) {
            kids.push(el("div", { class: "iv-entry" },
              el("span", {}, summarise(entry) || "(empty)"),
              el("button", { type: "button", class: "btn icon danger", title: "Remove",
                             onclick: () => { list.splice(i, 1); show(); } }, "✕")));
          } else {
            kids.push(el("div", { class: "iv-fields" },
              ...step.fields.map((def) => fieldRow(def, entry, mic, say))));
          }
        });
        kids.push(el("button", { type: "button", class: "btn add", onclick: () => {
          stopMic(mic);
          if (filled(list[list.length - 1])) list.push(blank(step.fields));
          show();
          body.querySelector(".iv-fields input, .iv-fields textarea")?.focus();
        } }, `+ ${step.add}`));
      } else {
        kids.push(el("div", { class: "iv-fields" },
          ...step.fields.map((def) => fieldRow(def, data[step.key], mic, say))));
      }
      body.replaceChildren(...kids);
      body.scrollTop = 0;
      panel.scrollTop = 0;
      body.querySelector("input, textarea")?.focus();
    }

    const close = (value) => {
      stopMic(mic);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };

    back.addEventListener("click", () => move(index - 1));
    skip.addEventListener("click", () => {
      const step = STEPS[index];
      if (step.repeat) data[step.key] = [blank(step.fields)];
      else data[step.key] = "";
      if (index === STEPS.length - 1) return finish();
      move(index + 1);
    });
    next.addEventListener("click", () => {
      if (index === STEPS.length - 1) return finish();
      move(index + 1);
    });

    function finish() {
      stopMic(mic);
      const found = assemble(data);
      const anything = found.basics.name || found.experience.length || found.projects.length
        || found.education.length || found.summary || found.skills.length;
      close(anything ? found : null);
    }

    const onKey = (event) => { if (event.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);

    const panel = el("div", { class: "iv-panel" },
      el("div", { class: "iv-head" },
        el("div", {}, heading, count),
        el("button", { type: "button", class: "btn ghost", title: "Close",
                       onclick: () => close(null) }, "✕")),
      prompt,
      body,
      status,
      el("p", { class: "iv-privacy" },
        "Dictation sends your words to the browser's own transcription service to be turned into "
        + "text. Everything else about your resume stays on this machine."),
      el("div", { class: "iv-foot" }, back, talk, el("span", { class: "iv-spacer" }), skip, next));

    const overlay = el("div", { class: "iv-back", role: "dialog", "aria-modal": "true" }, panel);

    document.body.append(overlay);
    show();
  });
}
