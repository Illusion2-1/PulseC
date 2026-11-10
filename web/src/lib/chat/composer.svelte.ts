import { tick } from "svelte";
import { completions } from "../core/text";
import type { Member } from "../types";
import { commandNames } from "./commands";

interface People {
  users(): Member[];
  /** `nick#trip` of this tab, left out of completions. */
  self(): string;
}

const visible = 9;

/** The draft and its completions. Shared so any row can insert text. */
export class ComposerState {
  draft = $state("");
  /** The last sent input, recalled with ↑. */
  lastInput = $state("");
  selection = $state(0);
  dismissed = $state(false);
  area: HTMLTextAreaElement | undefined = $state();
  #people: People;

  constructor(people: People) {
    this.#people = people;
  }

  suggestions = $derived.by(() => {
    if (this.dismissed) return [];
    if (/^\/\S*$/.test(this.draft))
      return commandNames.filter((x) => x.startsWith(this.draft));
    if (/@[\p{L}\p{N}_-]*$/u.test(this.draft))
      return completions(
        this.#people.users(),
        this.draft.split("@").pop()!,
        this.#people.self(),
      ).map((s) => "@" + s);
    return [];
  });

  shown = $derived(this.suggestions.slice(0, visible));

  focus() {
    this.area?.focus();
  }

  insert(text: string) {
    this.draft += text;
    this.dismissed = false;
    tick().then(() => this.focus());
  }

  // Replaces any existing whisper target so the typed message survives.
  whisper(target: string) {
    this.draft =
      "/w " +
      target +
      " " +
      this.draft.replace(/^\/w\s+\S+\s?/, "").trimStart();
    this.dismissed = true;
    tick().then(() => {
      this.focus();
      this.area?.setSelectionRange(this.draft.length, this.draft.length);
    });
  }

  typed() {
    this.selection = 0;
    this.dismissed = false;
  }

  dismiss() {
    this.dismissed = true;
  }

  pick(s: string) {
    this.draft = s.startsWith("@")
      ? this.draft.replace(/@[^\s]*$/, s.split("#")[0] + " ")
      : s + " ";
    this.dismissed = true;
    this.focus();
  }

  /** Moves the highlighted suggestion; returns false when none are shown. */
  move(step: 1 | -1) {
    const n = this.shown.length;
    if (!n) return false;
    this.selection = (this.selection + step + n) % n;
    return true;
  }

  /** Tab: accepts the highlighted suggestion, else completes a bare nick. */
  complete() {
    if (this.suggestions.length) {
      this.pick(this.suggestions[this.selection] || this.suggestions[0]);
      return true;
    }
    const word = this.draft.match(/[\p{L}\p{N}_-]+$/u);
    const [match] = word
      ? completions(this.#people.users(), word[0], this.#people.self())
      : [];
    if (!word || !match) return false;
    this.draft =
      this.draft.slice(0, -word[0].length) + "@" + match.split("#")[0] + " ";
    return true;
  }

  /** ↑ on an empty draft recalls the last input. */
  recall() {
    if (this.draft) return false;
    this.draft = this.lastInput;
    return true;
  }
}
