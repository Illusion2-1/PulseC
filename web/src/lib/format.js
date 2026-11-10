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

// Consecutive chat and /me lines from one identity form a tree for ten minutes
// after its first line. Any other row, a divider in `breaks`, or a new day ends it.
const groupable = (m) => !!m.trip && (m.kind === "chat" || m.kind === "me");
export function threads(items, breaks = new Set()) {
  const out = [];
  let root = -1;
  items.forEach((m, i) => {
    const head = items[root];
    const joins =
      root >= 0 &&
      groupable(m) &&
      groupable(items[i - 1]) &&
      !breaks.has(m) &&
      m.nick === head.nick &&
      m.trip === head.trip &&
      m.time - head.time < 600000 &&
      sameDay(head.time, m.time);
    if (!joins) root = i;
    out.push({ root: items[root], leaf: joins, last: true, size: 1 });
    if (joins) {
      out[i - 1].last = false;
      out[root].size++;
    }
  });
  return out;
}

// Quote links. Each quoted row gets one lane that runs down to its last quoter,
// with a branch at every quoter in between. Lanes are reused once free; links
// that do not fit in `max` lanes are left out (the >>ref stays clickable).
const quoted = /```[\s\S]*?```|`[^`\n]+`/g;
export function quoteLanes(items, max = 3) {
  const at = new Map();
  items.forEach((m, i) => m.ref && at.set(m.ref, i));
  const groups = new Map();
  items.forEach((m, i) => {
    if (!m.trip || typeof m.text !== "string") return;
    const text = m.text.replace(quoted, "");
    for (const [, ref] of text.matchAll(/>>([a-f0-9]{12})/g)) {
      const from = at.get(ref);
      if (from === undefined || from >= i) continue;
      const list = groups.get(from) || [];
      if (list.at(-1) !== i) list.push(i);
      groups.set(from, list);
    }
  });
  const spans = [...groups]
    .map(([from, to]) => ({ from, to: new Set(to), end: to.at(-1) }))
    .sort((a, b) => a.from - b.from || a.end - b.end);
  const ends = Array(max).fill(-1);
  const rows = items.map(() => []);
  const gaps = items.map(() => []);
  let lanes = 0;
  for (const s of spans) {
    const lane = ends.findIndex((end) => end < s.from);
    if (lane < 0) continue;
    ends[lane] = s.end;
    lanes = Math.max(lanes, lane + 1);
    rows[s.from].push([lane, "start"]);
    for (let i = s.from + 1; i <= s.end; i++) {
      gaps[i].push(lane);
      rows[i].push([lane, i === s.end ? "end" : s.to.has(i) ? "tee" : "pass"]);
    }
  }
  // A branch runs from its lane toward the text, crossing every lane to its
  // left. Those lanes get a gap there so a crossing does not read as a joint.
  for (const row of rows) {
    const inner = Math.min(
      ...row.filter(([, kind]) => kind !== "pass").map(([lane]) => lane),
    );
    for (const entry of row)
      if (entry[1] === "pass" && entry[0] > inner) entry.push("cut");
  }
  return { rows, gaps, lanes };
}
