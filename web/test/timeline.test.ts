import { test } from "vitest";
import assert from "node:assert/strict";
import {
  lanePath,
  quoteLanes,
  sameDay,
  threads,
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

test("quote lanes connect quoted and quoting rows", () => {
  const items = [
    msg("a", 1, "first", "chat", "aaaaaaaaaaaa"),
    msg("b", 2, "second", "chat", "bbbbbbbbbbbb"),
    msg("c", 3, ">>aaaaaaaaaaaa yes"),
    msg("d", 4, ">>bbbbbbbbbbbb and >>aaaaaaaaaaaa"),
    msg("e", 5, "`>>bbbbbbbbbbbb` in code, >>ffffffffffff missing"),
  ];
  const layout = quoteLanes(items);
  assert.equal(layout.lanes, 2);
  // b→d is shorter, so it takes the inner lane; a's branch to c hops over it.
  assert.deepEqual(layout.links, [
    { from: 0, to: [2, 3], lane: 1 },
    { from: 1, to: [3], lane: 0 },
  ]);
  assert.deepEqual(layout.branches, [
    { row: 0, lane: 1, over: [] },
    { row: 1, lane: 0, over: [] },
    { row: 2, lane: 1, over: [0] },
    { row: 3, lane: 1, over: [] },
  ]);
  const one = quoteLanes(items, 1);
  assert.deepEqual(
    one.links,
    [{ from: 1, to: [3], lane: 0 }],
    "longest dropped",
  );
});

test("quote lanes only cross where links overlap", () => {
  const ref = (n: number) => String(n).repeat(12);
  const row = (n: number, text = "x") => msg("u" + n, n, text, "chat", ref(n));
  // 0→2 and 1→3 overlap without nesting; 4→5 fits back into a free lane.
  const items = [
    row(0),
    row(1),
    row(2, ">>" + ref(0)),
    row(3, ">>" + ref(1)),
    row(4),
    row(5, ">>" + ref(4)),
  ];
  const layout = quoteLanes(items);
  assert.equal(layout.lanes, 2);
  assert.deepEqual(layout.links, [
    { from: 0, to: [2], lane: 0 },
    { from: 1, to: [3], lane: 1 },
    { from: 4, to: [5], lane: 0 },
  ]);
  // Lane 1 starts while lane 0 runs: its branch hops over lane 0 on row 1.
  // Lane 1 passes row 2, but lane 0's branch runs the other way and misses it.
  assert.deepEqual(
    layout.branches.map((b) => [b.row, b.lane, b.over]),
    [
      [0, 0, []],
      [1, 1, [0]],
      [2, 0, []],
      [3, 1, []],
      [4, 0, []],
      [5, 0, []],
    ],
  );
});

test("lane paths are continuous and hop over crossed lanes", () => {
  const layout = {
    lanes: 2,
    links: [
      { from: 0, to: [2], lane: 0 },
      { from: 1, to: [3], lane: 1 },
    ],
    branches: [
      { row: 1, lane: 1, over: [0] },
      { row: 3, lane: 1, over: [] },
    ],
  };
  const d = lanePath(layout, {
    x: (lane) => 20 - lane * 10,
    tip: 30,
    y: (row) => (row === 2 ? undefined : row * 20),
    hop: 3,
  });
  assert.equal(
    d,
    // 0→2 is skipped: row 2 is not rendered.
    "M10 20V60" + "M10 20H17A3 3 0 0 1 23 20H30" + "M10 60H30",
  );
});
