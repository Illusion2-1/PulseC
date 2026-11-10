import { limits } from "../config";
import type { Outgoing } from "../types";

// After a restart or expiry, retrying the same ID may duplicate a delivered message.
export function deliveryUnknown(
  message: Pick<Outgoing, "attempt" | "boot">,
  boot: string,
  now: number,
) {
  return (
    !!message.attempt &&
    (now - message.attempt > limits.retry || message.boot !== boot)
  );
}

/**
 * Sends wait here until acknowledged and go out one at a time, in order.
 * Entries are plain objects so retry bookkeeping can be written in place
 * and saved with the session.
 */
export class Outbox {
  queue = $state.raw<Outgoing[]>([]);
  /** The ID awaiting ack, or "". */
  inflight = $state("");
  /** No sends before this time (relay `limited` or local burst limit). */
  until = $state(0);
  /** Ack times inside the current rate window. */
  sent = $state.raw<number[]>([]);

  /** Sends left in the rate window at `now`. */
  left(now: number) {
    return Math.max(
      0,
      limits.burst - this.sent.filter((t) => now - t < limits.window).length,
    );
  }

  find(id: string | undefined) {
    return this.queue.find((q) => q.id === id);
  }

  push(message: Outgoing) {
    this.queue = [...this.queue, message];
  }

  remove(id: string) {
    this.queue = this.queue.filter((q) => q.id !== id);
  }

  /** Drops queued sends for a room except the one in flight. Returns them. */
  drop(room: string) {
    const dropped = this.queue.filter(
      (q) => q.room === room && q.id !== this.inflight,
    );
    if (dropped.length)
      this.queue = this.queue.filter((q) => !dropped.includes(q));
    return dropped;
  }

  /** /cancel: removes sends for a room that were never transmitted. */
  cancel(room: string) {
    this.queue = this.queue.filter((q) => q.room !== room || q.attempt);
  }

  /** The relay refused this send; it will not be retried. */
  failed(id: string) {
    this.remove(id);
    this.inflight = "";
  }

  acked(id: string, now: number) {
    this.remove(id);
    this.inflight = "";
    this.sent = [...this.sent.filter((t) => now - t < limits.window), now];
  }

  /** The relay rejected this attempt explicitly, so a retry cannot duplicate it. */
  limited(message: Outgoing, wait: number, now: number) {
    delete message.attempt;
    delete message.boot;
    this.inflight = "";
    this.until = now + wait + 100;
  }

  /** Forgets the in-flight send on disconnect; it will be retried. */
  disconnected() {
    this.inflight = "";
  }
}
