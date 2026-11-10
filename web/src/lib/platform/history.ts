import { limits, storageKeys } from "../config";
import type { LogEntry } from "../types";
import type { Store } from "./storage";

interface Row {
  seq: number;
  message: LogEntry;
}

const prefix = storageKeys.rowPrefix;
const keyFor = (room: string) => prefix + room + ".";

// A fixed ring per channel makes the synchronous write on receipt independent
// of history size. Rows are `{seq, message}`; the slot is `seq % size`.
export class History {
  #store: Store;
  #size: number;
  #cursors = new Map<string, number>();

  constructor(store: Store, size: number = limits.history) {
    this.#store = store;
    this.#size = size;
  }

  #decode(key: string): Row | null {
    try {
      const row = JSON.parse(this.#store.get(key) ?? "null");
      if (
        Number.isSafeInteger(row?.seq) &&
        Number.isFinite(row.message?.time) &&
        typeof row.message.text === "string"
      )
        return row;
    } catch {}
    return null;
  }

  read(room: string): LogEntry[] {
    const own = keyFor(room);
    const rows = this.#store
      .keys()
      .filter((k) => k.startsWith(own))
      .map((k) => this.#decode(k))
      .filter((r) => r !== null);
    rows.sort((a, b) => a.seq - b.seq);
    this.#cursors.set(room, (rows.at(-1)?.seq ?? -1) + 1);
    return rows.map((r) => r.message);
  }

  /** Writes one row. `replaceLast` overwrites the previous row (merged presence). */
  append(room: string, message: LogEntry, replaceLast = false) {
    const seq = Math.max(
        0,
        (this.#cursors.get(room) ?? 0) - Number(replaceLast),
      ),
      key = keyFor(room) + (seq % this.#size);
    const value = JSON.stringify({ seq, message });
    try {
      this.#store.set(key, value);
    } catch (error) {
      if ((error as Error).name !== "QuotaExceededError") throw error;
      // Drop the oldest tenth of all channels' rows and retry once.
      const oldest = this.#store
        .keys()
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key, time: this.#decode(key)?.message.time ?? 0 }))
        .sort((a, b) => a.time - b.time);
      for (const { key } of oldest.slice(
        0,
        Math.max(1, Math.ceil(oldest.length / 10)),
      ))
        this.#store.remove(key);
      this.#store.set(key, value);
    }
    this.#cursors.set(room, seq + 1);
  }

  /** Total appended rows, including slots overwritten by the history ring. */
  count(room: string) {
    return this.#cursors.get(room) ?? 0;
  }

  clear(room: string) {
    for (const k of this.#store.keys())
      if (k.startsWith(keyFor(room))) this.#store.remove(k);
    this.#cursors.delete(room);
  }
}
