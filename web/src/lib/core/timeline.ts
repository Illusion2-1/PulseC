import type { LogEntry } from "../types";
import { messageMarks } from "./markup";

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

/** A quoted row and the rows quoting it, drawn in one lane. */
export interface Link {
  /** The quoted row. */
  from: number;
  /** Quoting rows in order; the line ends at the last one. */
  to: number[];
  /** 0 is the lane nearest the text. */
  lane: number;
}

/** The line from a lane toward the text on a row where links join it. */
export interface Branch {
  row: number;
  /** The outermost lane joining on this row. */
  lane: number;
  /** Lanes passing this row that the branch crosses, nearest the branch first. */
  over: number[];
}

export interface Lanes {
  links: Link[];
  /** One per row with a joint, in row order. */
  branches: Branch[];
  /** Lanes in use, for the gutter width. */
  lanes: number;
}

// Quote links. Each quoted row gets one lane that runs down to its last quoter,
// with a branch at every quoter in between. Shorter links take inner lanes and
// pack tightly near the text; long links go outside, and are the ones left out
// when they do not fit in `max` lanes (the >>ref stays clickable).
export function quoteLanes(items: LogEntry[], max = 6): Lanes {
  const at = new Map<string, number>();
  items.forEach((m, i) => m.ref && at.set(m.ref, i));
  const groups = new Map<number, number[]>();
  items.forEach((m, i) => {
    if (!m.trip || typeof m.text !== "string" || !m.text.includes(">>")) return;
    for (const [mark] of m.text.matchAll(messageMarks)) {
      if (!mark.startsWith(">>")) continue;
      const from = at.get(mark.slice(2));
      if (from === undefined || from >= i) continue;
      const list = groups.get(from) || [];
      if (list.at(-1) !== i) list.push(i);
      groups.set(from, list);
    }
  });
  const end = (l: { from: number; to: number[] }) => l.to.at(-1)!;
  const spans = [...groups]
    .map(([from, to]) => ({ from, to }))
    .sort((a, b) => end(a) - a.from - (end(b) - b.from) || a.from - b.from);
  // Rows each lane covers. Two links may share a lane only with a row between
  // them, otherwise their ends would touch and read as one line.
  const taken: [number, number][][] = Array.from({ length: max }, () => []);
  const links: Link[] = [];
  for (const s of spans) {
    const lane = taken.findIndex((used) =>
      used.every(([a, b]) => b < s.from || a > end(s)),
    );
    if (lane < 0) continue;
    taken[lane].push([s.from, end(s)]);
    links.push({ ...s, lane });
  }
  links.sort((a, b) => a.from - b.from || a.lane - b.lane);

  // On each row with a joint, the branch from the outermost joining lane
  // crosses every lane inside it that only passes through.
  const joints = new Map<number, Set<number>>();
  const passing = new Map<number, Set<number>>();
  const add = (map: Map<number, Set<number>>, row: number, lane: number) =>
    (map.get(row) ?? map.set(row, new Set()).get(row)!).add(lane);
  for (const l of links) {
    add(joints, l.from, l.lane);
    for (const row of l.to) add(joints, row, l.lane);
    for (let row = l.from + 1; row < end(l); row++)
      if (!l.to.includes(row)) add(passing, row, l.lane);
  }
  const branches = [...joints]
    .sort(([a], [b]) => a - b)
    .map(([row, lanes]): Branch => {
      const lane = Math.max(...lanes);
      const over = [...(passing.get(row) ?? [])]
        .filter((l) => l < lane)
        .sort((a, b) => b - a);
      return { row, lane, over };
    });
  const lanes = Math.max(0, ...links.map((l) => l.lane + 1));
  return { links, branches, lanes };
}

/** Pixel positions measured from the rendered log. */
export interface LaneGeometry {
  /** x of each lane, by lane index. */
  x: (lane: number) => number;
  /** x where branches stop, just before the left column. */
  tip: number;
  /** Midline y of each row's first line; undefined if not rendered. */
  y: (row: number) => number | undefined;
  /** Radius of the arc where a branch hops over a lane. */
  hop: number;
}

/** SVG path data: one vertical per link and one horizontal per branch. */
export function lanePath(layout: Lanes, g: LaneGeometry) {
  const d: string[] = [];
  for (const l of layout.links) {
    const top = g.y(l.from),
      bottom = g.y(l.to.at(-1)!);
    if (top === undefined || bottom === undefined) continue;
    d.push(`M${g.x(l.lane)} ${top}V${bottom}`);
  }
  for (const b of layout.branches) {
    const y = g.y(b.row);
    if (y === undefined) continue;
    let path = `M${g.x(b.lane)} ${y}`;
    // A crossing is drawn as a half circle over the lane, never as a gap or
    // a plain cross, so it cannot be mistaken for a joint or a break.
    for (const lane of b.over) {
      const x = g.x(lane);
      path += `H${x - g.hop}A${g.hop} ${g.hop} 0 0 1 ${x + g.hop} ${y}`;
    }
    d.push(path + `H${g.tip}`);
  }
  return d.join("");
}
