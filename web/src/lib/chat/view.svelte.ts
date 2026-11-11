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
  // Keep the reader's scroll intent across pending sends and late formula layout.
  following = true;
  #followTop: number | undefined;

  bottom() {
    this.below = 0;
    this.following = true;
    tick().then(() => this.followBottom());
  }

  followBottom() {
    const log = this.log;
    if (!log || !this.following) return;
    log.scrollTop = log.scrollHeight;
    this.#followTop = log.scrollTop;
  }

  scrolled() {
    const log = this.log;
    if (!log) return;
    // Our own scroll event can arrive after new content has moved the bottom.
    if (this.following && log.scrollTop === this.#followTop) return;
    this.following = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    if (this.following) this.below = 0;
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
    this.scrolled();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      el.animate(
        [{ background: "#453710" }, { background: "transparent" }],
        900,
      );
    return true;
  }
}
