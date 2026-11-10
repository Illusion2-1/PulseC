import { test } from "vitest";
import assert from "node:assert/strict";
import { quoteLanes, sameDay, threads } from "../src/lib/core/timeline";
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
  const { rows, gaps, lanes } = quoteLanes(items);
  assert.equal(lanes, 2);
  assert.deepEqual(rows, [
    [[0, "start"]],
    [
      [0, "pass"],
      [1, "start"],
    ],
    [
      [0, "tee"],
      [1, "pass", "cut"],
    ],
    [
      [0, "end"],
      [1, "end"],
    ],
    [],
  ]);
  assert.deepEqual(gaps[3], [0, 1]);
  assert.equal(quoteLanes(items, 1).lanes, 1, "extra links are dropped");
});
