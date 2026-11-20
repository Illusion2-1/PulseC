import { test } from "vitest";
import assert from "node:assert/strict";
import {
  quoteLaneCount,
  quoteRelations,
  sameDay,
  threads,
  traceQuotes,
} from "../src/lib/core/timeline";
import type { LogEntry } from "../src/lib/types";

test("day boundaries follow local dates", () => {
  const morning = new Date(2026, 10, 10, 8).getTime();
  assert.equal(sameDay(morning, new Date(2026, 10, 10, 23).getTime()), true);
  assert.equal(sameDay(morning, new Date(2026, 10, 11, 0).getTime()), false);
});

const msg = (
  nick: string,
  time: number,
  text = "x",
  kind: LogEntry["kind"] = "chat",
  ref?: string,
): LogEntry => ({
  nick,
  trip: nick.padEnd(16, "0").slice(0, 16),
  time,
  text,
  kind,
  ref,
});

test("consecutive lines form trees until interrupted or ten minutes pass", () => {
  const t0 = new Date(2026, 10, 10, 12).getTime();
  const a1 = msg("a", t0),
    a2 = msg("a", t0 + 1000, "y", "me"),
    a3 = msg("a", t0 + 2000),
    b = msg("b", t0 + 3000),
    a4 = msg("a", t0 + 4000),
    sys: LogEntry = { kind: "sys", text: "notice", time: t0 + 5000 },
    a5 = msg("a", t0 + 6000),
    a6 = msg("a", t0 + 6000 + 600000),
    a7 = msg("a", t0 + 6000 + 600001);
  const items = [a1, a2, a3, b, a4, sys, a5, a6, a7];
  const shape = threads(items);
  assert.deepEqual(
    shape.map((s) => [items.indexOf(s.root), s.leaf, s.last, s.size]),
    [
      [0, false, false, 3],
      [0, true, false, 1],
      [0, true, true, 1],
      [3, false, true, 1],
      [4, false, true, 1],
      [5, false, true, 1],
      [6, false, true, 1],
      [7, false, false, 2], // ten minutes after a5: a new tree
      [7, true, true, 1],
    ],
  );
  assert.equal(threads(items, new Set([a2]))[1].leaf, false, "divider breaks");
});

test("fan-out, chains and multiple sources keep their direction", () => {
  const items = [
    msg("a", 1, "first", "chat", "aaaaaaaaaaaa"),
    msg("b", 2, ">>aaaaaaaaaaaa", "chat", "bbbbbbbbbbbb"),
    msg("c", 3, ">>aaaaaaaaaaaa >>bbbbbbbbbbbb and >>aaaaaaaaaaaa"),
    msg("d", 4, ">>bbbbbbbbbbbb"),
    msg("e", 5, "`>>bbbbbbbbbbbb` and >>ffffffffffff missing"),
    msg("f", 6, "$$\\text{>>aaaaaaaaaaaa}$$ inside math"),
  ];
  const links = quoteRelations(items);
  assert.deepEqual(
    links,
    new Map([
      [0, { sources: new Set(), replies: new Set([1, 2]) }],
      [1, { sources: new Set([0]), replies: new Set([2, 3]) }],
      [2, { sources: new Set([0, 1]), replies: new Set() }],
      [3, { sources: new Set([1]), replies: new Set() }],
    ]),
  );
  assert.deepEqual(
    quoteRelations(items.slice(2)),
    new Map(),
    "sources left history",
  );
});

test("dense quotes retain every source and exclude forward and self references", () => {
  const refs = Array.from({ length: 9 }, (_, i) =>
    i.toString(16).padStart(12, "0"),
  );
  const items = refs.map((ref, i) =>
    msg("a", i, ">>" + refs.at(-1), "chat", ref),
  );
  items.push(msg("b", 10, refs.map((ref) => ">>" + ref).join(" ")));
  const links = quoteRelations(items);
  assert.deepEqual(links.get(9)?.sources, new Set(refs.keys()));
  for (let i = 0; i < refs.length; i++) {
    assert.deepEqual(links.get(i), {
      sources: new Set(),
      replies: new Set([9]),
    });
  }
});

function graph(parents: number[][]) {
  const ref = (i: number) => i.toString(16).padStart(12, "0");
  return quoteRelations(
    parents.map((sources, i) =>
      msg(
        "u",
        i,
        sources.map((row) => ">>" + ref(row)).join(" "),
        "chat",
        ref(i),
      ),
    ),
  );
}

test("pin follows ancestors and descendants through forks and joins", () => {
  const links = graph([[], [0], [0], [1, 2], [3], [3], [4, 5], [2], [6]]);
  const preview = traceQuotes(links, 3, "replies", false);
  assert.deepEqual([...preview.routes.keys()], [3]);
  assert.deepEqual(preview.ends, new Set([4, 5]));
  const up = traceQuotes(links, 3, "sources", true);
  const down = traceQuotes(links, 3, "replies", true);
  assert.deepEqual(up.ends, new Set([0, 1, 2]));
  assert.deepEqual(down.ends, new Set([4, 5, 6, 8]));
  assert.deepEqual([...down.routes.keys()], [3, 4, 5, 6]);
  assert.deepEqual(
    [...down.routes.values()].map((r) => r.lane),
    [0, 1, 2, 0],
  );
  assert.deepEqual(down.routes.get(4)?.targets, new Set([6]));
  assert.deepEqual(down.routes.get(5)?.targets, new Set([6]));
});

test("busy lanes fold at a visible message that can become the new focus", () => {
  const forks = Array.from({ length: quoteLaneCount + 2 }, (_, i) => i + 1);
  const links = graph([[], ...forks.map(() => [0]), forks]);
  const trace = traceQuotes(links, 0, "replies", true);
  assert.equal(trace.routes.size, quoteLaneCount);
  assert.deepEqual(trace.folded, new Set(forks.slice(quoteLaneCount - 1)));
  for (const row of trace.folded) {
    assert.ok(trace.ends.has(row));
    const focused = traceQuotes(links, row, "replies", true);
    assert.deepEqual(
      focused.routes.get(row)?.targets,
      new Set([forks.length + 1]),
    );
    assert.equal(focused.folded.size, 0);
  }
});
