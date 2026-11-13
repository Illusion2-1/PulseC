// Client-side limits. Most mirror relay limits; the client
// enforces them early so a user sees a local notice instead of a relay error.
export const limits = {
  /** Channels one connection may join (relay: room_limit). */
  rooms: 9,
  /** Rows kept per channel in this tab, in memory and in sessionStorage. */
  history: 500,
  /** Unconfirmed sends kept across refreshes. */
  queue: 32,
  /** Sends allowed per rate window. */
  burst: 6,
  /** The rate window in milliseconds. */
  window: 10000,
  /** Code points per message (relay: invalid_text). */
  text: 2000,
  /** Channel names remembered in localStorage (relay: too_many_known). */
  known: 50,
  /** Trips on the local mute list. */
  ignored: 100,
  /** A retry after this long, or after a relay restart, may duplicate a message. */
  retry: 120000,
} as const;

// Every key PulseC writes. Rows are `rowPrefix + room + "." + slot`.
export const storageKeys = {
  session: "pulsec.session",
  rowPrefix: "pulsec.row.",
  channels: "pulsec.channels",
  login: "pulsec.login",
  color: "pulsec.color",
  language: "pulsec.language",
} as const;
