import { tick } from "svelte";

/**
 * Chat screen state that the client drives: scroll position, the member
 * drawer and focus. Components bind the elements; the client only calls methods.
 */
export class ViewState {
  /** Rows that arrived while scrolled up. */
  below = $state(0);
  /** The member drawer on narrow screens. */
  membersOpen = $state(false);
  log: HTMLElement | undefined = $state();
  membersToggle: HTMLElement | undefined = $state();

  /** Within 40 px of the end, new rows keep the log pinned to the bottom. */
  atBottom() {
    const log = this.log;
    return !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  }

  bottom() {
    this.below = 0;
    tick().then(() => {
      if (this.log) this.log.scrollTop = this.log.scrollHeight;
    });
  }

  scrolled() {
    if (this.atBottom()) this.below = 0;
  }

  closeMembers() {
    this.membersOpen = false;
    this.membersToggle?.focus();
  }

  async toggleMembers() {
    this.membersOpen = !this.membersOpen;
    if (this.membersOpen) {
      await tick();
      document.querySelector<HTMLElement>("#members .utog")?.focus();
    }
  }

  /** Scrolls to a quoted row and flashes it. Returns false if it is not loaded. */
  jump(ref: string) {
    const el = document.getElementById("m-" + ref);
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      el.animate(
        [{ background: "#453710" }, { background: "transparent" }],
        900,
      );
    return true;
  }
}
