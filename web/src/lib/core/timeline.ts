import type { LogEntry } from "../types";

const day = (time: number) => new Date(time).toDateString();
export const sameDay = (a: number, b: number) => day(a) === day(b);

export interface Shape {
  /** The first row of the tree this row belongs to. */
  root: LogEntry;
  /** A continuation row drawn under its root. */
  leaf: boolean;
  /** The last row of its tree. */
  last: boolean;
  /** Rows in the tree; meaningful on the root. */
  size: number;
}

// Consecutive chat and /me lines from one identity form a tree for ten minutes
// after its first line. Any other row, a divider in `breaks`, or a new day ends it.
const groupable = (m: LogEntry | undefined) =>
  !!m?.trip && (m.kind === "chat" || m.kind === "me");
export function threads(items: LogEntry[], breaks = new Set<LogEntry>()) {
  const out: Shape[] = [];
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

export type LaneKind = "start" | "tee" | "pass" | "end";
/** Lane index, its glyph and whether a branch crosses it on this row. */
export type LaneMark = [lane: number, kind: LaneKind, cut?: "cut"];

export interface Lanes {
  /** Marks on each row. */
  rows: LaneMark[][];
  /** Lanes running through the divider above each row. */
  gaps: number[][];
  /** Lanes in use, for the gutter width. */
  lanes: number;
}

// Quote links. Each quoted row gets one lane that runs down to its last quoter,
// with a branch at every quoter in between. Lanes are reused once free; links
// that do not fit in `max` lanes are left out (the >>ref stays clickable).
const quoted = /```[\s\S]*?```|`[^`\n]+`/g;
export function quoteLanes(items: LogEntry[], max = 3): Lanes {
  const at = new Map<string, number>();
  items.forEach((m, i) => m.ref && at.set(m.ref, i));
  const groups = new Map<number, number[]>();
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
    .map(([from, to]) => ({ from, to: new Set(to), end: to.at(-1)! }))
    .sort((a, b) => a.from - b.from || a.end - b.end);
  const ends: number[] = Array(max).fill(-1);
  const rows: LaneMark[][] = items.map(() => []);
  const gaps: number[][] = items.map(() => []);
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
