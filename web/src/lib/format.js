export function clash(n, t, users) {
  return users.some((u) => u.nick === n && u.trip !== t);
}
export const spark = (a) =>
  a.map((x) => "▁▂▃▄▅▆▇█"[Math.round((x / Math.max(1, ...a)) * 7)]).join("");

// A mention must end at a word boundary, so "@Det" does not notify "Detour".
const word = /[\p{L}\p{N}_-]/u;
export function mentions(text, nick) {
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
export function completions(users, prefix, self) {
  const lower = prefix.toLowerCase(),
    seen = new Set();
  return users
    .filter((u) => u.nick.toLowerCase().startsWith(lower))
    .map((u) => u.nick + "#" + u.trip)
    .filter((id) => id !== self && !seen.has(id) && seen.add(id))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
}

const day = (time) => new Date(time).toDateString();
export const sameDay = (a, b) => day(a) === day(b);
