import { limits } from "../config";
import {
  colorPattern,
  nickPattern,
  proofPattern,
  roomPattern,
  tripPattern,
} from "../core/identity";
import type { Identity, Outgoing } from "../types";

export interface SavedSession {
  identity: Identity | null;
  /** Open tabs in order, with their directory listing. */
  rooms: [name: string, listed: boolean][];
  current: string;
  queue: Outgoing[];
  ignored: string[];
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

const isOutgoing = (q: unknown, rooms: Set<string>): q is Outgoing =>
  isObject(q) &&
  q.op === "send" &&
  typeof q.room === "string" &&
  rooms.has(q.room) &&
  typeof q.id === "string" &&
  typeof q.raw === "string" &&
  typeof q.text === "string";

/**
 * Validates the tab's saved session (`pulsec.session`). Anything malformed is
 * dropped; a login without channels counts as signed out.
 */
export function restoreSession(input: unknown): SavedSession {
  const saved = isObject(input) ? input : {};
  const out: SavedSession = {
    identity: null,
    rooms: [],
    current: "",
    queue: [],
    ignored: Array.isArray(saved.ignored)
      ? saved.ignored.filter((trip) => tripPattern.test(trip))
      : [],
  };
  const id = saved.identity;
  if (
    !isObject(id) ||
    typeof id.nick !== "string" ||
    !nickPattern.test(id.nick) ||
    typeof id.proof !== "string" ||
    !proofPattern.test(id.proof)
  )
    return out;
  out.rooms = Object.entries(isObject(saved.rooms) ? saved.rooms : {})
    .filter(([name]) => roomPattern.test(name))
    .slice(0, limits.rooms)
    .map(([name, listed]) => [name, listed === true]);
  const names = new Set(out.rooms.map(([name]) => name));
  out.current =
    typeof saved.current === "string" && names.has(saved.current)
      ? saved.current
      : out.rooms[0]?.[0] || "";
  if (!out.current) return out;
  out.identity = {
    nick: id.nick,
    proof: id.proof,
    trip:
      typeof id.trip === "string" && tripPattern.test(id.trip) ? id.trip : "",
    color:
      typeof id.color === "string" && colorPattern.test(id.color)
        ? id.color
        : "",
  };
  out.queue = Array.isArray(saved.queue)
    ? saved.queue.filter((q) => isOutgoing(q, names)).slice(0, limits.queue)
    : [];
  return out;
}

/** Validates the browser's remembered channel names (`pulsec.channels`). */
export function restoreKnown(input: unknown): string[] {
  return Array.isArray(input)
    ? input
        .filter((n) => typeof n === "string" && roomPattern.test(n))
        .slice(0, limits.known)
    : [];
}
