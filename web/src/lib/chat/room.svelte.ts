import type { LogEntry, RoomState } from "../types";

export const blankState: RoomState = Object.freeze({
  users: [],
  pulse: Array(30).fill(0),
  topic: "",
});

/** One open channel tab. Its log outlives the relay membership. */
export class Room {
  readonly name: string;
  /** Requested or confirmed directory listing, sent again on every rejoin. */
  listed = $state(false);
  /** Rows in display order. Entries are compared by identity, so not proxied. */
  log = $state.raw<LogEntry[]>([]);
  /** The latest relay snapshot; null while not joined. */
  live = $state.raw<RoomState | null>(null);
  /** The relay has confirmed membership on this connection. */
  joined = $state(false);
  /** Removed by kick, ban or lock. The tab stays open for reading. */
  parted = $state(false);
  unread = $state(0);
  mentioned = $state(false);
  /** When the relay last acknowledged one of our sends here. */
  acknowledged = $state(0);

  constructor(name: string, listed: boolean, log: LogEntry[]) {
    this.name = name;
    this.listed = listed;
    this.log = log;
  }

  /** The snapshot, or an empty one before the first state arrives. */
  get state(): RoomState {
    return this.live ?? blankState;
  }

  /** Forgets the relay's view of this room after a disconnect or part. */
  reset() {
    this.joined = false;
    this.live = null;
  }
}
