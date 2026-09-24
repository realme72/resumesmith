/* Dictation, through the speech recognition built into the browser.

   This is the one part of ResumeSmith that doesn't stay on the machine: Chrome and Edge send the
   audio to a Google service to transcribe it. Every place that opens the microphone says so first
   — see the note in home.html and the one above the interview. Firefox ships no implementation at
   all and Safari's is patchy, so callers check supported() before offering it. */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const supported = () => Boolean(Recognition);

const MESSAGES = {
  "not-allowed": "the browser blocked the microphone — allow it from the address bar, then try again",
  "service-not-allowed": "the browser blocked the microphone — allow it from the address bar, then try again",
  "audio-capture": "no microphone was found",
  network: "the transcription service couldn't be reached",
};

/**
 * Starts listening. Words arrive through the callbacks — onFinal for a phrase the recogniser has
 * settled on, onPartial for the one it's still revising — and the returned handle stops it.
 */
export function listen({ onPartial = () => {}, onFinal = () => {}, onError = () => {}, onEnd = () => {} } = {}) {
  if (!Recognition) throw new Error("this browser can't listen — try Chrome, Edge or Safari");

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  let stopped = false;

  recognition.addEventListener("result", (event) => {
    let partial = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) onFinal(result[0].transcript.trim());
      else partial += result[0].transcript;
    }
    onPartial(partial.trim());
  });

  recognition.addEventListener("error", (event) => {
    // someone pausing for thought, or pressing stop, is not an error worth showing
    if (event.error === "no-speech" || event.error === "aborted") return;
    stopped = true;
    onError(MESSAGES[event.error] || `the microphone stopped: ${event.error}`);
  });

  // Chrome ends the session after a silence even with continuous set, which would cut someone off
  // mid-thought. Start it again until the caller actually asks to stop.
  recognition.addEventListener("end", () => {
    if (stopped) return onEnd();
    try {
      recognition.start();
    } catch {
      onEnd();
    }
  });

  recognition.start();

  return {
    stop() {
      stopped = true;
      try {
        recognition.stop();
      } catch { /* already finished */ }
    },
    get listening() {
      return !stopped;
    },
  };
}
