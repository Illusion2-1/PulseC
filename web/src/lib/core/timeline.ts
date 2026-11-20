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

export interface QuoteRelations {
  sources: Set<number>;
  replies: Set<number>;
}

/** Direct relationships between rows still in the visible history. */
export function quoteRelations(items: LogEntry[]) {
  const at = new Map<string, number>();
  const relations = new Map<number, QuoteRelations>();
  function row(i: number) {
    let entry = relations.get(i);
    if (!entry) {
      entry = { sources: new Set(), replies: new Set() };
      relations.set(i, entry);
    }
    return entry;
  }
  items.forEach((m, i) => {
    if (m.trip && typeof m.text === "string" && m.text.includes(">>")) {
      for (const [mark] of m.text.matchAll(messageMarks)) {
        if (!mark.startsWith(">>")) continue;
        const source = at.get(mark.slice(2));
        if (source === undefined) continue;
        row(i).sources.add(source);
        row(source).replies.add(i);
      }
    }
    if (m.ref) at.set(m.ref, i);
  });
  return relations;
}

export const quoteLaneCount = 4;

interface QuoteRoute {
  row: number;
  targets: Set<number>;
  first: number;
  last: number;
  lane: number;
}

export function traceQuotes(
  relations: Map<number, QuoteRelations>,
  activeRow: number,
  direction: keyof QuoteRelations,
  expanded: boolean,
) {
  const routes = new Map<number, QuoteRoute>();
  const ends = new Set<number>();
  const folded = new Set<number>();
  const lanes: QuoteRoute[][] = Array.from(
    { length: quoteLaneCount },
    () => [],
  );
  const queue = [activeRow];

  // Nearest relatives get first choice of lanes. A shared ancestor or reply
  // gets a terminal on every incoming route, but is expanded only once.
  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    const targets = relations.get(row)?.[direction];
    if (!targets?.size) continue;
    const first = Math.min(row, ...targets),
      last = Math.max(row, ...targets);
    const lane = lanes.findIndex((used) =>
      used.every((route) => route.last < first || last < route.first),
    );
    if (lane < 0) {
      folded.add(row);
      continue;
    }
    const route = { row, targets, first, last, lane };
    routes.set(row, route);
    lanes[lane].push(route);
    for (const target of targets) {
      if (expanded && !ends.has(target)) queue.push(target);
      ends.add(target);
    }
  }
  return { routes, ends, folded };
}
