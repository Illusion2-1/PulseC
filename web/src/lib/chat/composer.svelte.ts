import { tick } from "svelte";
import { completions } from "../core/text";
import type { Member } from "../types";
import { commandNames, parseCommand } from "./commands";

interface People {
  users(): Member[];
  /** `nick#trip` of this tab, left out of completions. */
  self(): string;
  rooms(): string[];
  banned(): string[];
  ignored(): string[];
}

/** The draft and its completions. Shared so any row can insert text. */
export class ComposerState {
  draft = $state("");
  /** The last sent input, recalled with ↑. */
  lastInput = $state("");
  selection = $state(0);
  dismissed = $state(false);
  cursor = $state<number>();
  selectionEnd = $state<number>();
  area: HTMLTextAreaElement | undefined = $state();
  #people: People;

  constructor(people: People) {
    this.#people = people;
  }

  command = $derived(parseCommand(this.draft));
  commandState = $derived(
    !this.command
      ? ""
      : commandNames.includes(this.command.name)
        ? "valid"
        : !/\s/.test(this.draft) &&
            commandNames.some((name) => name.startsWith(this.draft))
          ? "partial"
          : "invalid",
  );

  // Complete only the token at the caret, preserving everything after it.
  context = $derived.by(() => {
    const cursor = Math.min(
      this.cursor ?? this.draft.length,
      this.draft.length,
    );
    if (this.selectionEnd !== undefined && this.selectionEnd !== cursor)
      return null;
    const before = this.draft.slice(0, cursor);
    const after = this.draft.slice(cursor);
    const tokenEnd = cursor + (after.match(/^\S*/)?.[0].length ?? 0);
    if (/^\/[^\s/]*$/.test(before) && !this.draft.startsWith("//"))
      return {
        kind: "command",
        from: 0,
        to: tokenEnd,
        prefix: before,
        values: commandNames.filter((name) => name.startsWith(before)),
      };
    const arg = before.match(/^\/(\w+)[ \t]+([^\s]*)$/);
    if (arg) {
      const [, name, prefix] = arg;
      let values: string[] = [];
      if (name === "join")
        values = this.#people
          .rooms()
          .map((room) => (prefix.startsWith("#") ? "#" + room : room));
      else if (name === "slow") values = ["0", "1", "2", "3", "4", "5"];
      else if (name === "unban") values = this.#people.banned();
      else if (name === "unignore") values = this.#people.ignored();
      else if (/^(w|kick|ban|mute|unmute|op|deop|ignore)$/.test(name))
        values = completions(this.#people.users(), "", this.#people.self());
      return {
        kind: "argument",
        from: cursor - prefix.length,
        to: tokenEnd,
        prefix,
        values: [...new Set(values)].filter((value) =>
          value.toLowerCase().startsWith(prefix.toLowerCase()),
        ),
      };
    }
    const mention = before.match(/(?:^|[^\p{L}\p{N}_-])(@[\p{L}\p{N}_-]*)$/u);
    if (!mention) return null;
    const prefix = mention[1];
    return {
      kind: "mention",
      from: cursor - prefix.length,
      to: cursor + (after.match(/^[\p{L}\p{N}_-]*/u)?.[0].length ?? 0),
      prefix,
      values: completions(
        this.#people.users(),
        prefix.slice(1),
        this.#people.self(),
      ).map((s) => "@" + s),
    };
  });

  suggestions = $derived(this.dismissed ? [] : (this.context?.values ?? []));
  selected = $derived(this.suggestions[this.selection] ?? this.suggestions[0]);
  ghost = $derived.by(() => {
    if (
      !this.context ||
      !this.selected ||
      this.context.to !== this.draft.length
    )
      return "";
    if ((this.cursor ?? this.draft.length) !== this.draft.length) return "";
    const value =
      this.context.kind === "mention"
        ? this.selected.split("#")[0]
        : this.selected;
    return value.slice(this.context.prefix.length);
  });

  focus() {
    this.area?.focus();
  }

  insert(text: string) {
    this.draft += text;
    this.cursor = this.selectionEnd = this.draft.length;
    this.dismissed = false;
    tick().then(() => {
      this.focus();
      this.area?.setSelectionRange(this.draft.length, this.draft.length);
    });
  }

  // Replaces any existing whisper target so the typed message survives.
  whisper(target: string) {
    this.draft =
      "/w " +
      target +
      " " +
      this.draft.replace(/^\/w\s+\S+\s?/, "").trimStart();
    this.cursor = this.selectionEnd = this.draft.length;
    this.dismissed = true;
    tick().then(() => {
      this.focus();
      this.area?.setSelectionRange(this.draft.length, this.draft.length);
    });
  }

  syncCursor() {
    const area = this.area;
    if (
      !area ||
      (this.cursor === area.selectionStart &&
        this.selectionEnd === area.selectionEnd)
    )
      return;
    this.cursor = area.selectionStart;
    this.selectionEnd = area.selectionEnd;
    this.selection = 0;
    this.dismissed = false;
  }

  typed() {
    this.syncCursor();
    this.selection = 0;
    this.dismissed = false;
  }

  dismiss() {
    this.dismissed = true;
  }

  #replace(from: number, to: number, value: string) {
    const tail = this.draft.slice(to);
    const space = /^[\s.,!?;:，。！？；：]/u.test(tail) ? "" : " ";
    this.draft = this.draft.slice(0, from) + value + space + tail;
    const cursor =
      from + value.length + space.length + (/^[ \t]/.test(tail) ? 1 : 0);
    this.cursor = this.selectionEnd = cursor;
    this.dismissed = true;
    this.selection = 0;
    tick().then(() => {
      this.focus();
      this.area?.setSelectionRange(cursor, cursor);
    });
  }

  pick(s: string) {
    const context = this.context;
    if (!context) return;
    this.#replace(
      context.from,
      context.to,
      context.kind === "mention" ? s.split("#")[0] : s,
    );
    if (s === "/color") this.dismissed = false;
  }

  /** Moves through every candidate, including those beyond the first page. */
  move(step: 1 | -1) {
    const n = this.suggestions.length;
    if (!n) return false;
    this.selection = (this.selection + step + n) % n;
    return true;
  }

  /** Tab: accepts the selected candidate, else completes a bare nick. */
  complete() {
    if (this.selected) {
      this.pick(this.selected);
      return true;
    }
    if (this.command || this.selectionEnd !== this.cursor) return false;
    const cursor = this.cursor ?? this.draft.length;
    const word = this.draft.slice(0, cursor).match(/[\p{L}\p{N}_-]+$/u);
    const [match] = word
      ? completions(this.#people.users(), word[0], this.#people.self())
      : [];
    if (!word || !match) return false;
    const end =
      cursor +
      (this.draft.slice(cursor).match(/^[\p{L}\p{N}_-]*/u)?.[0].length ?? 0);
    this.#replace(cursor - word[0].length, end, "@" + match.split("#")[0]);
    return true;
  }

  /** ↑ on an empty draft recalls the last input. */
  recall() {
    if (this.draft) return false;
    this.draft = this.lastInput;
    this.cursor = this.selectionEnd = this.draft.length;
    this.dismissed = true;
    tick().then(() =>
      this.area?.setSelectionRange(this.draft.length, this.draft.length),
    );
    return true;
  }
}
