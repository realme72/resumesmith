/* The spoken interview: a few questions, answered out loud, turned into a first draft.

   It runs as a panel over the builder rather than a page of its own, so the moment it finishes the
   form is filled in and the preview redraws behind it — there's nothing to carry across. */

import { listen, supported } from "./speech.js";
import { organise, SKIPPED } from "./organise.js";

export const QUESTIONS = [
  { key: "basics", title: "Who you are",
    ask: "Your name, the job title you're going for, and the city you're in." },
  { key: "job", title: "Your most recent job",
    ask: "The company, your title, when you started, and whether you're still there. Then what you actually did — the tools you used, and any numbers you remember: users, requests a second, money, time saved." },
  { key: "job", title: "The job before that",
    ask: "Same again: company, title, when, and what you did. Say “skip” if there isn't one." },
  { key: "job", title: "Anything earlier",
    ask: "One more if you have it, otherwise say “skip”." },
  { key: "projects", title: "What you've built",
    ask: "Side projects, open source, anything outside work — what it does and what you built it with. Say “skip” if there's nothing." },
  { key: "skills", title: "Your tools",
    ask: "The languages, frameworks, databases and cloud tools you'd be happy to be interviewed on." },
  { key: "education", title: "Where you studied",
    ask: "The institution, the degree, and the years." },
];

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "hidden") node.hidden = !!value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) if (kid || kid === 0) node.append(kid);
  return node;
};

/**
 * Opens the interview. Resolves with a resume once the person finishes, or with null if they back
 * out — the caller decides what to do with it, so nothing here touches the form.
 */
export function runInterview() {
  return new Promise((resolve) => {
    const answers = [];
    let index = 0;
    let session = null;
    let settled = "";

    const heading = el("h2", { class: "iv-title" });
    const prompt = el("p", { class: "iv-ask" });
    const count = el("span", { class: "iv-count" });
    const text = el("textarea", { class: "input area iv-text", rows: 6,
      placeholder: "Press Start and talk. The words appear here — you can also type or correct them." });
    const partial = el("span", { class: "iv-partial" });
    const status = el("p", { class: "iv-status" });
    const mic = el("button", { type: "button", class: "btn primary iv-mic" }, "Start talking");
    const next = el("button", { type: "button", class: "btn" }, "Next");
    const finish = el("button", { type: "button", class: "btn primary", hidden: true }, "Build my resume");

    const stopListening = () => {
      if (session) session.stop();
      session = null;
      mic.textContent = "Start talking";
      mic.classList.remove("listening");
      partial.textContent = "";
    };

    const show = () => {
      const q = QUESTIONS[index];
      heading.textContent = q.title;
      prompt.textContent = q.ask;
      count.textContent = `${index + 1} of ${QUESTIONS.length}`;
      text.value = answers[index]?.text || "";
      settled = text.value;
      next.textContent = index === QUESTIONS.length - 1 ? "Done" : "Next";
      next.hidden = index === QUESTIONS.length - 1;
      finish.hidden = index !== QUESTIONS.length - 1;
      status.textContent = "";
      text.focus();
    };

    const record = () => {
      answers[index] = { key: QUESTIONS[index].key, text: text.value.trim() };
    };

    mic.addEventListener("click", () => {
      if (session) return stopListening();
      try {
        settled = text.value.trim();
        session = listen({
          onPartial: (words) => { partial.textContent = words; },
          onFinal: (phrase) => {
            settled = `${settled} ${phrase}`.trim();
            text.value = settled;
            partial.textContent = "";
            text.scrollTop = text.scrollHeight;
          },
          onError: (message) => { status.textContent = message; stopListening(); },
          onEnd: () => stopListening(),
        });
        mic.textContent = "Stop";
        mic.classList.add("listening");
        status.textContent = "Listening — speak normally, and pause whenever you like.";
      } catch (e) {
        status.textContent = e.message;
      }
    });

    next.addEventListener("click", () => {
      stopListening();
      record();
      index = Math.min(index + 1, QUESTIONS.length - 1);
      show();
    });

    const back = el("button", { type: "button", class: "btn ghost", onclick: () => {
      stopListening();
      record();
      index = Math.max(index - 1, 0);
      show();
    } }, "Back");

    const close = (value) => {
      stopListening();
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };

    finish.addEventListener("click", () => {
      stopListening();
      record();
      const spoken = answers.filter((a) => a && a.text && !SKIPPED.test(a.text));
      if (!spoken.length) return close(null);
      close(organise(answers.filter(Boolean)));
    });

    const onKey = (event) => { if (event.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);

    const overlay = el("div", { class: "iv-back", role: "dialog", "aria-modal": "true" },
      el("div", { class: "iv-panel" },
        el("div", { class: "iv-head" },
          el("div", {}, heading, count),
          el("button", { type: "button", class: "btn ghost", onclick: () => close(null) }, "✕")),
        prompt,
        el("div", { class: "iv-box" }, text, partial),
        status,
        el("p", { class: "iv-privacy" },
          "Your words are sent to the browser's own transcription service to be turned into text. "
          + "Everything else about your resume stays on this machine."),
        el("div", { class: "iv-foot" }, back, el("span", { class: "iv-spacer" }), mic, next, finish)));

    if (!supported()) {
      status.textContent = "This browser can't listen — try Chrome, Edge or Safari. "
        + "You can still type the answers here.";
      mic.disabled = true;
    }

    document.body.append(overlay);
    show();
  });
}
