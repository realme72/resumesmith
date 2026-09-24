/* The front door's own wiring: offer the draft this browser is already holding, and don't send
   anyone down the speech route in a browser that can't listen. */

import { supported } from "./speech.js";

const DRAFT_KEY = "resumesmith.draft.v1";  // written by app.js

function draft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return saved && saved.resume ? saved : null;
  } catch {
    return null;  // private window, or storage turned off
  }
}

function when(at) {
  const days = Math.floor((Date.now() - at) / 86400000);
  if (!at || days < 0) return "";
  if (days === 0) return " today";
  if (days === 1) return " yesterday";
  return days < 30 ? ` ${days} days ago` : "";
}

const saved = draft();
if (saved) {
  const name = String(saved.resume?.basics?.name || "").trim();
  const link = document.querySelector("#resume-draft");
  link.replaceChildren(
    Object.assign(document.createElement("b"), { textContent: "Pick up where you left off" }),
    document.createTextNode(` — ${name ? `${name}'s resume` : "your draft"}, saved${when(saved.at) || " in this browser"}.`),
  );
  link.hidden = false;
}

if (!supported()) {
  const door = document.querySelector("#door-speech");
  door.classList.add("unavailable");
  door.removeAttribute("href");
  document.querySelector("#speech-note").textContent =
    "This browser can't listen. Open ResumeSmith in Chrome, Edge or Safari to talk it through.";
}
