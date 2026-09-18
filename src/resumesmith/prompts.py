"""Terminal questions and answers (input/output are injectable so the wizard can be tested)."""

from __future__ import annotations

import os
import re
import sys
from typing import Callable


class Prompter:
    def __init__(self, input_fn: Callable[[str], str] = input, output_fn: Callable[[str], None] = print,
                 color: bool | None = None):
        self._in, self._out = input_fn, output_fn
        self.color = (sys.stdout.isatty() and "NO_COLOR" not in os.environ) if color is None else color

    # ---------- output ----------

    def style(self, text: str, code: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.color else text

    def bold(self, text: str) -> str:
        return self.style(text, "1")

    def dim(self, text: str) -> str:
        return self.style(text, "2")

    def say(self, text: str = "") -> None:
        self._out(text)

    def tip(self, text: str) -> None:
        self.say(self.dim(text))

    def section(self, title: str) -> None:
        self.say("")
        self.say(self.bold(f"── {title} " + "─" * max(4, 44 - len(title))))

    # ---------- questions ----------

    def ask(self, label: str, default: str | None = None, required: bool = False,
            check: Callable[[str], str] | None = None) -> str:
        """One line of text. `check` returns the cleaned value or raises ValueError with a hint."""
        suffix = f" [{default}]" if default else ""
        while True:
            answer = self._in(f"{label}{suffix}: ").strip()
            if not answer and default:
                answer = default
            if not answer:
                if required:
                    self.say("  (this one is needed)")
                    continue
                return ""
            if check:
                try:
                    return check(answer)
                except ValueError as e:
                    self.say(f"  {e}")
                    continue
            return answer

    def yes(self, label: str, default: bool = True) -> bool:
        hint = "Y/n" if default else "y/N"
        while True:
            answer = self._in(f"{label} [{hint}]: ").strip().lower()
            if not answer:
                return default
            if answer in ("y", "yes"):
                return True
            if answer in ("n", "no"):
                return False
            self.say("  (y or n)")

    def lines(self, label: str, bullet: str = "  • ", on_line: Callable[[str], None] | None = None) -> list[str]:
        """Several answers, one per line; an empty line finishes."""
        self.say(label)
        out = []
        while True:
            answer = self._in(bullet).strip()
            if not answer:
                return out
            out.append(answer)
            if on_line:
                on_line(answer)

    def _menu(self, label: str, options: list[tuple[str, str]]) -> None:
        self.say(label)
        for i, (_, text) in enumerate(options, 1):
            self.say(f"  {i}) {text}")

    def _pick(self, token: str, options: list[tuple[str, str]]) -> str | None:
        keys = [k for k, _ in options]
        if token.isdigit() and 1 <= int(token) <= len(options):
            return keys[int(token) - 1]
        return token if token in keys else None

    def choose(self, label: str, options: list[tuple[str, str]], default: str) -> str:
        self._menu(label, options)
        default_no = str([k for k, _ in options].index(default) + 1)
        while True:
            answer = self._in(f"Choose 1-{len(options)} [{default_no}]: ").strip().lower() or default_no
            if (key := self._pick(answer, options)) is not None:
                return key
            self.say(f"  (a number from 1 to {len(options)})")

    def choose_many(self, label: str, options: list[tuple[str, str]], default: list[str],
                    aliases: dict[str, str] | None = None) -> list[str]:
        self._menu(label, options)
        keys = [k for k, _ in options]
        default_nos = ",".join(str(keys.index(k) + 1) for k in default)
        while True:
            answer = self._in(f"Pick one or more, e.g. 1,2 [{default_nos}]: ").strip().lower() or default_nos
            tokens = [t.lstrip(".") for t in re.split(r"[,\s]+", answer) if t]
            if tokens == ["all"]:
                return keys
            picked = [self._pick((aliases or {}).get(t, t), options) for t in tokens]
            if picked and None not in picked:
                return list(dict.fromkeys(picked))
            self.say(f"  (numbers from 1 to {len(options)}, separated by commas)")
