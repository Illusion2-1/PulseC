import type { Member } from "../types";

// A mention must end at a word boundary, so "@Det" does not notify "Detour".
const word = /[\p{L}\p{N}_-]/u;
export function mentions(text: unknown, nick: string | undefined) {
  if (!nick || typeof text !== "string") return false;
  const needle = "@" + nick;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    const before = text[i - 1],
      after = text[i + needle.length];
    if ((!before || !word.test(before)) && (!after || !word.test(after)))
      return true;
  }
  return false;
}

// Distinct identities whose nick starts with the typed prefix, ignoring case.
export function completions(
  users: Pick<Member, "nick" | "trip">[],
  prefix: string,
  self: string,
) {
  const lower = prefix.toLowerCase(),
    seen = new Set<string>();
  return users
    .filter((u) => u.nick.toLowerCase().startsWith(lower))
    .map((u) => u.nick + "#" + u.trip)
    .filter((id) => id !== self && !seen.has(id) && !!seen.add(id))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** Heights in an eight-unit activity chart. A quiet minute keeps a visible baseline. */
export function pulseHeights(buckets: number[]) {
  const peak = Math.max(1, ...buckets);
  return buckets.map((count) => 1 + (7 * count) / peak);
}

/** Mean messages per bucket, to one decimal. */
export const averageRate = (a: number[]) =>
  a.length
    ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10
    : 0;
